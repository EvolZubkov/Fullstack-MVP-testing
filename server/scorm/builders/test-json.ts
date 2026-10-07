import type { Test, TestSection, Topic, Question, TopicCourse, TopicEvent, PassRule, AdaptiveTopicSettings, AdaptiveLevel, AdaptiveLevelLink, ContentPage, ResultVariable, Scale, QuestionMeasurement, RetakePolicy, TestQuestionScoring, ReportBlockRow } from "@shared/schema";
import { sanitizeHtml, placeholderScope } from "../../utils/html-sanitizer";
import { findEligibilityPlugin, findEligibilityConfig } from "@shared/eligibility/registry";
import { resolveAnswerCommitScope } from "@shared/flow/answer-commit-scope";
import { resolveFlowPolicy } from "@shared/flow/flow-policy";
import { effectiveSectionOrder } from "@shared/draw/assemble-delivery";
import { computeWeights } from "@shared/draw/exposure";
import { withEffectiveMaxLength } from "@shared/questions/short-answer";
import { config } from "../../config";
import { promptHtmlOf } from "../../services/prompt-html";
import { buildTestScoringContext, type TestScoringContext } from "../../services/effective-scoring";
import { withResolvedScaleIcons } from "../../services/scale-icons";
import { parseScaleInterpretation } from "@shared/scales/interpretation";
import { hasGradedContent } from "@shared/questions/question-type";
// PRD-32: ONE address rule for a feedback attachment, and ONE source-priority rule for
// the topic's feedback text — the same helpers the web grader runs.
import { hasOptionFeedback } from "@shared/questions/option-feedback";
import { feedbackAssets, normalizeFeedback, topicFeedbackTexts } from "@shared/template/result-context";
import type { ReportBake } from "@shared/report/report-variants";

interface AdaptiveLevelWithLinks extends AdaptiveLevel {
  links: AdaptiveLevelLink[];
}

interface AdaptiveSettingsExport {
  topicSettings: AdaptiveTopicSettings[];
  levels: AdaptiveLevelWithLinks[];
}

interface DesignSettingsExport {
  templateId: string;
  templateVersion?: string;
  templateApiVersion?: string;
  params: Record<string, unknown>;
  /** PRD-23: palette the author pinned (`light`/`dark`/`auto`). */
  theme?: string;
  /** PRD-23: colour overrides per declared palette. */
  paramsByTheme?: Record<string, Record<string, unknown>>;
  /**
   * System variant kinds (`start`/`results`) the active template does NOT declare
   * in its `contentTemplates`, so the runtime must render them from the bundled
   * `default` template (PRD-7 G21). Set by the exporter when it bundles the
   * `template-default/` files; absent/empty means no fallback.
   */
  /**
   * LAYOUT KEYS of the system screens the active template does not declare; the
   * runtime renders these from the bundled `default` template (PRD-1 §4.3.2,
   * PRD-3 NFR-05/NFR-06). Layout keys, not variant kinds — that is what
   * `systemLayout()` looks up.
   */
  fallbackLayoutKeys?: string[];
  /**
   * PRD-27 FR-22: разрешённый выбор ВАРИАНТА отчёта — макет, стиль и значения полей.
   * Считает {@link module:shared/report/report-variants resolveReportBake} на стороне
   * сборщика (он один видит манифест шаблона), рантайм только читает. Отсутствие =
   * отчёт собирается канонической деградацией, как до этого PRD (FR-28).
   */
  report?: ReportBake;
  /**
   * PRD-49 §8: the ALREADY RESOLVED interface labels, BY SCREEN — `{ results: {…},
   * "results.adaptive": {…}, "section-results": {…} }`, each a flat «key → text» map
   * where an empty string means «do not print this label».
   *
   * Resolved by the assembler (`build-export-data`) because the manifest that declares
   * the defaults does not travel into an LMS — and resolved per SCREEN because those
   * defaults are per screen (`defaults.<screen>`): one map for all three would print the
   * results screen's wording on the adaptive screen while the web host printed the
   * screen's own, which is the host drift this PRD exists to remove. The runtime picks
   * its screen's map and hands it over unchanged; the shared builder alone turns it into
   * the `labels.*` tree.
   *
   * Absent for a template that declares no labels — its layouts print their own strings,
   * as before this PRD. Packages baked before the split carry a FLAT map here instead;
   * the runtime tells the two shapes apart (`vrScreenLabels`, viewResults.js).
   */
  labels?: Record<string, Record<string, string>>;
  /** PRD-49: the author's order of the results sub-blocks (`design_settings_json`). */
  resultsBlockOrder?: string[];
  /**
   * PRD-49: what each results SCREEN of this template prints, and in what order — the
   * list the author's order is cleaned against. Per screen, because composition differs:
   * the adaptive results screen has no score summary. Resolved from the manifest at bake
   * for the same reason the labels are.
   */
  templateBlockOrder?: Record<string, readonly string[]>;
}

interface ExportData {
  test: Test;
  /**
   * PRD-56 FR-19a: номер версии публикации (`test_snapshots.version`), из снимка которой
   * собран пакет. Рантайм сообщает его телеметрией и служебным блоком отчёта LMS, так что
   * прохождение из пакета попадает в свою версию, а не в текущую.
   *
   * Отсутствует у черновика и у отладочной сборки: версии у них нет, и пакет такого теста
   * обязан остаться байт-в-байт прежним (FR-02).
   */
  publicationVersion?: number;
  sections: (TestSection & { topic: Topic; questions: Question[]; courses: TopicCourse[]; events: TopicEvent[] })[];
  /**
   * PRD-15 block D (FR-32): per-(test, question) scoring overrides. The bake
   * resolves the EFFECTIVE price / graded config / difficulty per question and
   * writes the resolved values into TEST_DATA, so the in-package runtime keeps
   * reading plain `q.points`/`q.scoring`/`q.difficulty` from the baked JSON
   * (not a DB column — unaffected by the T-40 column drop). Absent/empty = the
   * chain falls through to the section/test defaults and the system default.
   */
  questionScoring?: TestQuestionScoring[];
  adaptiveSettings?: AdaptiveSettingsExport | null;
  contentPages?: ContentPage[];
  /**
   * PRD-51: строки ДОКУМЕНТА ОТЧЁТА теста для его режима — состав и порядок блоков,
   * которые автор собрал. Разрешает их в печатный документ сборщик пакета
   * (`resolveReportBundle`), а не рантайм: манифеста шаблона в LMS нет.
   *
   * Отсутствуют/пусты ⇒ документ по умолчанию шаблона.
   */
  reportBlocks?: ReportBlockRow[];
  resultVariables?: ResultVariable[];
  scales?: Scale[];
  measurements?: QuestionMeasurement[];
  /**
   * PRD-46 §5: do the visible scales divide one whole? Resolved by the ASSEMBLER
   * (`build-export-data`) — the only place that sees the contribution rows and the
   * allocation budgets — and baked, because the runtime holds neither. Absent/false ⇒
   * the runtime reads «not ipsative», i.e. the `auto` setting draws a radar, which is
   * exactly what a package built before this PRD does.
   */
  ipsativeScales?: boolean;
  /**
   * PRD-55 (FR-27): накопленные выдачи заданий за окно наблюдения, собранные ассемблером
   * (`build-export-data`) на момент СБОРКИ пакета. Сборщик превращает их в вес, нормированный
   * в пределах раздела; сам счётчик в пакет не уезжает — рантайм всё равно не смог бы его
   * обновлять. Отсутствует/пусто ⇒ все веса равны единице, то есть выдача как до PRD-55.
   */
  exposureCounts?: Map<string, number>;
  designSettings?: DesignSettingsExport;
  /**
   * Already-resolved on-disk directory of the selected template (built-in or
   * uploaded PRD-3), provided by the route via `resolveTemplateDir`. When absent
   * the exporter falls back to the built-in convention `server/scorm/templates/<id>`.
   */
  templateDir?: string;
  /**
   * PRD-34 (FR-26): how this package is being built. `debug` ⇒ the PRD-18 test run,
   * where copy protection and the focus-loss veil are OFF so the author can select and
   * copy the text of their own question (FR-25). The watermark is NOT gated by it
   * (FR-19). Absent ⇒ a normal export, i.e. protection active.
   */
  source?: "export" | "debug";
  // Telemetry config
  telemetry?: {
    enabled: boolean;
    packageId: string;
    secretKey: string;
    apiBaseUrl: string;
  } | null;
}

/**
 * PRD-50 FR-50: тексты подтем раздела для пакета — `{ ключ: блок }` либо `null`.
 *
 * `null` вместо пустого объекта не украшение: раздел без текстов НЕ добавляет ключа в
 * `TEST_DATA`, и пакет теста, не пользовавшегося настройкой, остаётся прежним до байта.
 */
function bakeBreakdownFeedback(raw: unknown): Record<string, unknown> | null {
  const keys = (raw as { keys?: Record<string, unknown> } | null | undefined)?.keys;
  if (!keys) return null;
  const out: Record<string, unknown> = {};
  for (const [key, content] of Object.entries(keys)) {
    const block = normalizeFeedback(content);
    if (block) out[key] = block;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Толкование для пакета: запись с непустым текстом либо `null`.
 *
 * Тот же гейт на ТЕКСТЕ, что и в общем разрешителе: запись с пустой строкой (автор написал
 * и стёр) не должна ни ехать в пакет, ни печатать пустой блок.
 */
function bakeInterpretation(raw: unknown): { format: string; text: string } | null {
  const value = raw as { format?: string; text?: string | null } | null | undefined;
  const text = typeof value?.text === "string" ? value.text : "";
  return text.trim().length > 0 ? { format: value?.format ?? "plain", text } : null;
}

/**
 * Толкования подтем раздела для пакета — `{ ключ: запись }` либо `null`.
 *
 * `null` по той же причине, что и у {@link bakeBreakdownFeedback}: раздел без толкований не
 * добавляет ключа в `TEST_DATA`, и пакет теста, их не заводившего, остаётся прежним до байта.
 */
function bakeBreakdownInterpretation(raw: unknown): Record<string, unknown> | null {
  const keys = (raw as { keys?: Record<string, unknown> } | null | undefined)?.keys;
  if (!keys) return null;
  const out: Record<string, unknown> = {};
  for (const [key, content] of Object.entries(keys)) {
    const value = bakeInterpretation(content);
    if (value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function buildTestJson(data: ExportData): string {
  const testMode = data.test.mode || "standard";
  // PRD-15 block D (FR-32): one resolution context for the whole bake. With no
  // overrides and no defaults the chain returns the legacy question values, so
  // packages of untouched tests stay byte-identical.
  const scoringCtx: TestScoringContext = buildTestScoringContext(
    data.test,
    data.sections,
    data.questionScoring ?? [],
  );
  /** Bake one question's effective scoring into the TEST_DATA shape. */
  const bakeScoring = (q: Question): { points: number; difficulty: number; scoring?: unknown } => {
    const eff = scoringCtx.resolve(q);
    return {
      points: eff.points,
      // `|| 50` keeps the historical coercion of the SCORM bake (FR-02).
      difficulty: scoringCtx.difficultyOf(q) || 50,
      // PRD-10: included only when authored (override or legacy) so packages
      // for unscored questions stay byte-identical (FR-02).
      // «Сценарий в ИС»: штрафы сценария печатаются ВСЕГДА — их задаёт и уровень теста, которого
      // в источнике оценки вопроса не видно (`source` остаётся «system»), а без них пакет считал бы
      // по системным умолчаниям. Пакетов со сценариями до Э5а не было, байт-идентичности беречь нечего.
      ...(eff.source.scoring !== "system" || eff.scoring.kind === "simulation" ? { scoring: eff.scoring } : {}),
    };
  };
  // Effective per-topic draw count. `drawAll` (or adaptive mode, which always
  // feeds the whole pool to the level engine) means "draw every question the
  // topic currently has" — resolved dynamically here, not from the stored
  // drawCount, so adding questions after save still draws all of them.
  const effectiveDraw = (
    s: ExportData["sections"][number],
  ): number => (testMode === "adaptive" || s.drawAll ? s.questions.length : s.drawCount);

  const totalQuestions = data.sections.reduce((sum, s) => sum + effectiveDraw(s), 0);
  const overallPassRule = data.test.overallPassRuleJson as PassRule;

  // PRD-36 FR-02/FR-18: канонический список ключей разреза пакета. Запись разреза в
  // состоянии прогона адресует ключ НОМЕРОМ в этом списке, поэтому список обязан быть
  // полным и детерминированным: порядок — первое появление при обходе разделов, состав —
  // и теги вопросов (из них ключи и возникают, PRD-50 FR-15), и ключи порогов раздела,
  // у которых собственного вопроса в банке может не оказаться вовсе.
  const breakdownKeys: string[] = [];
  const seenBreakdownKey = new Set<string>();
  const noteBreakdownKey = (key: unknown): void => {
    if (typeof key !== "string" || !key || seenBreakdownKey.has(key)) return;
    seenBreakdownKey.add(key);
    breakdownKeys.push(key);
  };
  for (const s of data.sections) {
    for (const q of s.questions) for (const tag of q.tags ?? []) noteBreakdownKey(tag);
  }

  const passPercent =
    overallPassRule.type === "percent"
      ? overallPassRule.value
      : totalQuestions > 0
        ? Math.round((overallPassRule.value / totalQuestions) * 100)
        : 80;

  // PRD-4 v1.1: export `flowPolicy` so the runtime can switch traversal
  // strategy (legacy_flat / linear_by_topics / router_by_topics) and apply
  // router-specific gating (routerCompletionPolicy, sectionUnlockRules).
  // Missing flowPolicyJson defaults to `{ mode: "linear_flat" }` per FR-40
  // to keep legacy SCORMs identical to pre-v1.1 behaviour.
  //
  // Resolved by the SHARED normaliser, which the web attempt payload also runs:
  // the two hosts used to clamp the mode and carry the router gating by their own
  // rules, and that is exactly how the web run ended up with no unlock rules and no
  // completion policy at all.
  const exportedFlowPolicy = resolveFlowPolicy(data.test.flowPolicyJson);

  const test: any = {
    id: data.test.id,
    title: data.test.title,
    description: data.test.description,
    // PRD-59 FR-12: формат рядом с текстом. Исходник остаётся исходником — разметку
    // строит рантайм тем же общим строителем, что и веб.
    descriptionFormat: data.test.descriptionFormat ?? "plain",
    mode: data.test.mode || "standard",
    // PRD-56 FR-19a: версия публикации, из снимка которой собран пакет. Печатается только
    // когда ассемблер её дал (см. `publicationVersion` в `ExportData`).
    ...(data.publicationVersion !== undefined
      ? { publicationVersion: data.publicationVersion }
      : {}),
    flowPolicy: exportedFlowPolicy,
    // PRD-30 FR-16/FR-23: the test-wide delivery order, and the default every
    // topic inherits. Baked only when it is not the default `random`, so packages
    // of tests that never touched the setting stay byte-identical; the runtime
    // reads TEST_DATA.questionOrder and falls back to `random` when absent.
    ...(data.test.questionOrder && data.test.questionOrder !== "random"
      ? { questionOrder: data.test.questionOrder }
      : {}),
    showDifficultyLevel: data.test.showDifficultyLevel ?? true,
    overallPassRule: overallPassRule,
    // «Тест пройден, если»: HOW the overall rule and the topic gates combine into the
    // verdict. Baked so the package decides exactly like the web host; a package built
    // before this shipped carries none and the shared engine then keeps the old rule.
    passDecisionPolicy: data.test.passDecisionPolicy ?? null,
    // PRD-50 FR-53: выпекается ТОЛЬКО когда автор включил, поэтому пакет теста, который его не
    // трогал, остаётся байт-в-байт прежним; рантайм читает отсутствие как «выключено».
    ...(data.test.breakdownGateEnabled ? { breakdownGateEnabled: true } : {}),
    // `webhookUrl` в пакет не запекается: рантайм его никогда не читал, а адрес, куда пакет
    // шлёт данные, — это адрес телеметрии из конфигурации установки, а не настройка теста.
    // PRD-61 §10: обратная связь УРОВНЯ ТЕСТА снята — ни легаси-текст (`tests.feedback`),
    // ни блок (`tests.feedback_json`) в пакет больше не запекаются. Рантайм их и не ищет:
    // сводный блок рекомендаций собирается из тем, шкал и показателей. Обратная связь ТЕМ
    // и РАЗДЕЛОВ едет как ехала — снят ровно один уровень.
    // Вводные блоки экрана и отчёта (PRD-27 §7.1). Едут одним полем: рантайм сам берёт
    // свою ветвь — экран печатает свой текст, конвейер отчёта свой.
    ...(data.test.introJson ? { introJson: data.test.introJson } : {}),
    // PRD-50 FR-13: key-breakdown display setting. Baked ONLY when the author saved
    // one AND turned it on (`visibility !== "hidden"`), so packages of tests that
    // never touched the setting stay byte-identical (FR-02); the runtime reads
    // TEST_DATA.breakdownDisplay and an absent value means «no breakdown rows»,
    // exactly the behaviour every package had before this PRD.
    ...(data.test.breakdownDisplayJson && data.test.breakdownDisplayJson.visibility !== "hidden"
      ? { breakdownDisplay: data.test.breakdownDisplayJson }
      : {}),
    // PRD-50 FR-11: блоки разделов теста. Выпекаются ТОЛЬКО когда автор их завёл, поэтому
    // пакет теста без блоков остаётся байт-в-байт прежним (FR-02); рантайм читает
    // `TEST_DATA.sectionGroups`, а отсутствие значит «блоков нет» — тот самый плоский
    // список тем, который печатал каждый пакет до этого PRD.
    ...(data.test.sectionGroupsJson?.length ? { sectionGroups: data.test.sectionGroupsJson } : {}),
    timeLimitMinutes: data.test.timeLimitMinutes || null,
    maxAttempts: data.test.maxAttempts || null,
    showCorrectAnswers: data.test.showCorrectAnswers || false,
    // PRD-19 (Блок A): правила навигации/завершения для рантайма (применение — Блок B/C/D).
    allowReturnToUnanswered: data.test.allowReturnToUnanswered ?? true,
    allowAnswerChange: data.test.allowAnswerChange ?? false,
    // PRD-19 (FR-11a/FR-11b): свободная навигация внутри раздела. Адаптивный тест её
    // ИГНОРИРУЕТ — порядок там ведёт лестница уровней, поэтому значение автора в пакет
    // такого теста не попадает.
    allowFreeSectionNavigation:
      data.test.mode === "adaptive" ? false : (data.test.allowFreeSectionNavigation ?? false),
    // PRD-43: independent of allowReturnToUnanswered.
    quickAdvance: data.test.quickAdvance ?? false,
    showSectionResults: data.test.showSectionResults ?? true,
    // Что уходит в LMS при нескольких попытках. Выпекается ТОЛЬКО когда автор выбрал
    // «последнюю»: рантайм читает отсутствие как «лучшая», поэтому пакет теста, который
    // настройки не касался, остаётся байт-в-байт прежним.
    ...(data.test.lmsAttemptResult === "last" ? { lmsAttemptResult: "last" } : {}),
    skipReviewWhenComplete: data.test.skipReviewWhenComplete ?? false,
    // PRD-67: baked ONLY when on — the runtime reads absence as the old freeze-on-leave, so
    // the package of a test that never touched the setting stays byte-for-byte the same.
    ...(data.test.closeSectionOnLeave ? { closeSectionOnLeave: true } : {}),
    // PRD-34 (FR-01, FR-26): настройки защиты для рантайма пакета. `protectionActive`
    // отдельным полем: в отладочном прогоне защита и скрытие выключены, а водяной знак
    // остаётся (FR-19, FR-25).
    copyProtection: data.test.copyProtection ?? true,
    protectionWatermark: data.test.protectionWatermark ?? false,
    protectionHideOnBlur: data.test.protectionHideOnBlur ?? false,
    protectionActive: data.source !== "debug",
    // PRD-19 (Блок B): единый резолв гранулярности фиксации ответа — оба хоста
    // читают готовое значение (без повторного вывода из flowMode), что
    // исключает дрейф skip/return/freeze между SCORM и вебом.
    answerCommitScope: resolveAnswerCommitScope({
      mode: data.test.mode,
      flowMode: exportedFlowPolicy.mode,
    }),
    // PRD-7 S10: legacy `start_page_content` is no longer exported into TEST_DATA.
    // Its content is migrated to a `content_pages` 'intro' row (migration 003 §4.2)
    // and rendered by the content-flow runtime; the DB column is kept write-only
    // for legacy clients (decisions §1, S10 §3.3).
    passPercent: passPercent,
    // Does this test grade at all? Baked only when the answer is NO, so packages of
    // every control test stay byte-identical and the runtime's `!== false` reading
    // keeps stored packages behaving as before (FR-02 style). A measurement method
    // carries the default 70 % threshold it was created with, and the start screen
    // must not advertise it — see the rule in `shared/template/start-state`.
    ...(hasGradedContent(data.sections.flatMap((s) => s.questions))
      ? {}
      : { hasGradedContent: false }),
    totalQuestions: totalQuestions,
    // PRD-36 FR-02: адрес ключа разреза в состоянии прогона. Выпекается только когда ключи
    // есть, поэтому пакет теста без тегов и порогов остаётся байт-в-байт прежним (FR-02
    // стиля PRD-50), а рантайм читает отсутствие как «ключей нет».
    ...(breakdownKeys.length ? { breakdownKeys } : {}),
    sections: data.sections.map((s) => {
      // PRD-32: attachments of the TOPIC and of THIS test's section over it, resolved
      // once per section (see where they are baked below).
      const sectionFeedbackAssets = feedbackAssets(s.topic.feedbackJson, s.feedbackJson);
      // Feedback TEXTS of the same two authoring points, through the same shared rule the
      // web grader runs — source priority and the topic-before-section order included.
      const sectionFeedbackTexts = topicFeedbackTexts(s.topic, s.feedbackJson);
      // PRD-50 FR-50: тексты ПОДТЕМ этого раздела (`test_sections.breakdown_feedback_json`)
      // через тот же нормализатор, что и остальные источники блока рекомендаций: адреса
      // вложений становятся `/api/media/<id>`, а упаковщик медиа переписывает их в
      // внутрипакетные пути вместе со всем деревом.
      const sectionBreakdownFeedback = bakeBreakdownFeedback(s.breakdownFeedbackJson);
      // Толкования: своё у темы, своё у этого теста и по подтемам. Разрешение (что кого
      // заменяет) здесь НЕ делается — см. комментарий у самих полей ниже.
      const sectionTopicInterpretation = bakeInterpretation(s.topic.interpretationJson);
      const sectionOwnInterpretation = bakeInterpretation(s.interpretationJson);
      const sectionBreakdownInterpretation = bakeBreakdownInterpretation(s.breakdownInterpretationJson);
      return {
        topicId: s.topic.id,
        topicName: s.topic.name,
        // PRD-1 §4.3: topic description (from topic properties) — rendered on the
        // «Введение раздела» (section-intro) screen. null/empty → no description block.
        topicDescription: s.topic.description ?? null,
        // Author-defined readable id (slug) for `topicById("<code>")`; null → UUID.
        topicCode: s.topic.code ?? null,
        drawCount: effectiveDraw(s),
        // PRD-4 v1.1 §4.7: `required` drives routerCompletionPolicy's
        // «all_required_*» calculation; `false` means optional (the test can
        // finish even if this section is skipped/incomplete).
        required: s.required ?? true,
        // PRD-4 v1.1 §3.2 / §4.6 per-section time limit (Phase 4e).
        // null = inherit_test (section uses the test-wide timer, no extra timer);
        // number = custom limit in minutes (section timer starts on entry).
        timeLimitMinutes: s.timeLimitMinutes ?? null,
        // PRD-24: the rule may now be `{source:'by_variant', byForm}` as well, so it is
        // baked as authored — the runtime resolves it through the shared engine.
        topicPassRule: (s.topicPassRuleJson as unknown) ?? null,
        // PRD-11: stratified-draw blueprint. Included only when set so packages
        // without quotas stay byte-identical (FR-02); runtime reads section.drawBlueprint.
        ...(s.drawBlueprintJson ? { drawBlueprint: s.drawBlueprintJson } : {}),
        // PRD-17 (BR-12): fixed-variant set. Included only when present so packages
        // without variants stay byte-identical (FR-02); the runtime (selectForm in
        // app.js) picks one variant and delivers it whole, overriding the uniform/
        // stratified draw. SCORM has no cross-attempt store (NFR-17) so rotation
        // degrades to a random pick (R-6). The whole bank ships (every variant's
        // questions+keys, R-7) — selection happens client-side.
        ...(s.formSetJson ? { formSet: s.formSetJson } : {}),
        // Пороги подтем в пакет НЕ пекутся: рантайм их больше не читает — вердикт темы
        // считается её собственным правилом (решение владельца 2026-09-03). Сохранённые
        // пороги остаются в базе и в переносе теста, но в доставке им делать нечего.
        // PRD-50 FR-11: блок, в который автор поместил ЭТОТ раздел. Как и список блоков
        // выше — только когда он есть, иначе пакет прежний до байта; ссылка на ключ,
        // которого в списке нет, значит «без блока», и разрешает это ядро (FR-12).
        ...(s.groupKey ? { groupKey: s.groupKey } : {}),
        // PRD-30 FR-02/FR-18/FR-23: the topic's OVERRIDE of the test-wide order.
        // Baked only when the topic actually overrides (a null column = «как в
        // тесте»), so packages of tests that never touched the setting stay
        // byte-identical; the runtime resolves an absent value against
        // TEST_DATA.questionOrder.
        ...(s.questionOrder === "fixed" || s.questionOrder === "random"
          ? { questionOrder: s.questionOrder }
          : {}),
        // Feedback TEXTS of the TOPIC (`topics.feedback_json.text`, falling back to the
        // legacy `topics.feedback` column) and of THIS test's section over it
        // (`test_sections.feedback_json.text`) — the general before the specific, which
        // is the order the consolidated recommendations block de-duplicates on. ONE name
        // with the web host, which stores the very same list on the attempt
        // (`TopicResult.feedbackTexts`): the shared results builder reads it and nothing
        // else, so neither host can drift into showing a different text.
        //
        // Replaces the former `topicFeedback`, which baked the legacy column ALONE — a
        // column today's topic editor never writes, under a name the shared builder never
        // read. Baked only when something is actually written, so packages of tests
        // without feedback stay byte-identical (FR-02); the runtime falls back to an
        // empty list.
        ...(sectionFeedbackTexts.length > 0 ? { feedbackTexts: sectionFeedbackTexts } : {}),
        // PRD-50 FR-50: тексты подтем. Выпекаются только когда автор их написал, поэтому
        // пакет теста без них байт-в-байт прежний; кого из них прочитает человек, решает
        // ОБЩИЙ построитель по порогу теста — рантайм только отдаёт написанное.
        ...(sectionBreakdownFeedback ? { breakdownFeedback: sectionBreakdownFeedback } : {}),
        // Толкования: текст самой ТЕМЫ и текст, которым его заменил ЭТОТ тест, — обоими
        // полями, не разрешённым значением. Правило замены применяет общий построитель
        // (`shared/interpretation/resolve`), и применяет его в ОДНОЙ точке для обоих хостов:
        // разреши сборка — правило жило бы в двух местах и разошлось бы первой же правкой.
        // Имена полей — имена входа темы у построителя, рантайм отдаёт их как есть.
        ...(sectionTopicInterpretation ? { interpretation: sectionTopicInterpretation } : {}),
        ...(sectionOwnInterpretation ? { sectionInterpretation: sectionOwnInterpretation } : {}),
        // Толкования подтем — того же раздела и по тем же ключам, что и их тексты выше.
        ...(sectionBreakdownInterpretation
          ? { breakdownInterpretation: sectionBreakdownInterpretation }
          : {}),
        recommendedCourses: s.courses.map((c) => ({ title: c.title, url: c.url })),
        recommendedEvents: s.events.map((e) => ({ title: e.title })),
        // PRD-32: PDF attachments of the TOPIC (`topics.feedback_json`) and of THIS test's
        // section over it (`test_sections.feedback_json`) — two storage points, one list,
        // topic first (the general before the specific). Baked as `/api/media/<id>`; the
        // media packer rewrites every address in the tree to an in-package path, so the
        // file travels with the ZIP. The runtime pours them into the shared «Материалы»
        // block, exactly as the web host does with the same two blocks. Baked only when
        // something is actually attached, so packages of tests that never used the feature
        // stay byte-identical (FR-02); the runtime falls back to an empty list.
        ...(sectionFeedbackAssets.length > 0 ? { recommendedAssets: sectionFeedbackAssets } : {}),
        questions: ((): unknown[] => {
        // PRD-55 (FR-27): веса считаются ОДИН раз на раздел и нормируются в его пределах —
        // ровно так же, как это делает веб внутри пула отбора. Пакет автономен, счётчика по
        // популяции у него нет, поэтому в TEST_DATA уезжает готовое число.
        const exposureWeights = computeWeights(
          s.questions.map((q) => q.id),
          data.exposureCounts ?? new Map<string, number>(),
        );
        return s.questions.map((q) => {
          // PRD-15 block D: effective price / graded config / difficulty are
          // resolved here, at bake time; the runtime keeps its plain reads.
          const baked = bakeScoring(q);
          const exposureWeight = exposureWeights.get(q.id) ?? 1;
          return {
            id: q.id,
            type: q.type,
            prompt: q.prompt,
            // PRD-57 FR-03a: подсветка листинга печётся в пакет готовой разметкой —
            // библиотека подсветки в ZIP не едет.
            ...promptHtmlOf(q),
            // PRD-57 FR-28v: предел печётся в пакет — конфигурации в рантайме там нет.
            data: withEffectiveMaxLength(q.type, q.dataJson, config.limits.shortAnswerMaxLength),
            correct: q.correctJson,
            points: baked.points,
            difficulty: baked.difficulty,
            mediaUrl: q.mediaUrl || null,
            mediaType: q.mediaType || null,
            feedback: q.feedback || null,
            feedbackMode: q.feedbackMode || "general",
            feedbackCorrect: q.feedbackCorrect || null,
            feedbackIncorrect: q.feedbackIncorrect || null,
            // Per-option feedback texts (single choice): the chosen option's text replaces
            // the question's feedback in `feedbackTextFor`. Included only when some option
            // has one, so packages of questions without them stay byte-identical.
            ...(hasOptionFeedback(q.optionFeedbackJson) ? { optionFeedbackJson: q.optionFeedbackJson } : {}),
            // PRD-10: graded answer scoring. Included only when authored so packages
            // for unscored questions stay byte-identical (FR-02); runtime reads q.scoring.
            ...(baked.scoring ? { scoring: baked.scoring } : {}),
            // PRD-11: sub-topic tags drive the stratified draw (drawSection matches a
            // stratum tag against q.tags). Included only when non-empty so packages
            // for untagged questions stay byte-identical (FR-02); the draw blueprint
            // is useless without them.
            ...(Array.isArray(q.tags) && q.tags.length ? { tags: q.tags } : {}),
            // PRD-16 FR-41: «Случайный порядок вариантов» off — the runtime must
            // deliver the authored order (shuffleMappingFor). Baked only when off
            // (the default is on) so packages of untouched tests stay
            // byte-identical (FR-02).
            ...(q.shuffleAnswers === false ? { shuffleAnswers: false } : {}),
            // PRD-30 FR-01: the author's index inside the topic. Baked only when
            // the topic EFFECTIVELY orders by it (its own value, or the test's
            // when it inherits) AND the question has one, so packages of
            // untouched tests stay byte-identical (FR-14/FR-23); the runtime
            // treats an absent value as «not set» (delivered last).
            ...(effectiveSectionOrder(data.test.questionOrder, s.questionOrder) === "fixed" &&
            typeof q.orderIndex === "number"
              ? { orderIndex: q.orderIndex }
              : {}),
            // PRD-55 (FR-27/FR-30): вес по накопленной экспозиции, нормированный в пределах
            // РАЗДЕЛА на момент сборки. Пишется только когда отличается от единицы — то же
            // правило байт-идентичности, что у `tags` и `orderIndex` выше: рантайм читает
            // отсутствие поля как вес 1, то есть как прежнее поведение.
            ...(exposureWeight !== 1 ? { exposureWeight } : {}),
          };
        });
        })(),
      };
    }),
  };

  // PRD-6 / PRD-31: the access policy and, for the cooldown, the resolved plugin.
  // The condition SPLITS by barrier: the gate and its plugin are still baked only for
  // barrier A (the cooldown), while barrier B — the hour interval inside one
  // assignment — needs the policy in TEST_DATA with no plugin at all, because it is
  // decided after Initialize from suspend_data. A test with NEITHER barrier gets
  // neither field, so its package stays byte-identical (FR-14).
  const rp = data.test.retakePolicyJson as RetakePolicy | null | undefined;
  const gatePlugin =
    rp && rp.enabled && rp.eligibilityPlugin?.key ? findEligibilityPlugin(rp.eligibilityPlugin.key) : undefined;
  const intervalOn = rp?.attemptInterval?.enabled === true && rp.attemptInterval.hours != null;
  if (rp && (gatePlugin || intervalOn)) {
    test.retakePolicy = {
      // `enabled` stays the COOLDOWN's switch: RetakeGate.isGated reads it, and an
      // interval-only test must not look gated to the pre-Initialize gate.
      enabled: rp.enabled === true && !!gatePlugin,
      cooldownPeriodDays: rp.cooldownPeriodDays,
      // PRD-40: outcome-split cooldown. Baked unconditionally like cooldownPeriodDays
      // above — JSON.stringify drops the `undefined` ones for a non-split policy, so
      // this does not affect the byte-identical-export guarantee (FR-02/FR-14).
      cooldownByOutcome: rp.cooldownByOutcome,
      cooldownPeriodDaysPassed: rp.cooldownPeriodDaysPassed,
      cooldownPeriodDaysFailed: rp.cooldownPeriodDaysFailed,
      gateMode: rp.gateMode,
      eligibilityPlugin: gatePlugin ? rp.eligibilityPlugin : null,
      blockedPageId: rp.blockedPageId ?? null,
      ...(intervalOn ? { attemptInterval: rp.attemptInterval } : {}),
      // The WebTutor course name the gate matches records by; absent = the test title.
      // Only a gated package needs it, and only when set — otherwise the key is left out.
      ...(gatePlugin && rp.lmsCourseName?.trim() ? { lmsCourseName: rp.lmsCourseName.trim() } : {}),
    };
  }
  if (rp && gatePlugin) {
    const cfg = findEligibilityConfig(rp.eligibilityPlugin!.key, rp.eligibilityPlugin!.configId);
    test.retakePlugin = {
      key: gatePlugin.key,
      runtimeEntry: gatePlugin.runtimeEntry,
      bestEffort: gatePlugin.bestEffort,
      config: cfg?.config ?? {},
    };
  }

  // Add adaptive settings if present
  if (data.test.mode === "adaptive" && data.adaptiveSettings) {
    const { topicSettings, levels } = data.adaptiveSettings;

    // Group levels by topicId
    const levelsByTopic: Record<string, any[]> = {};
    for (const level of levels) {
      if (!levelsByTopic[level.topicId]) {
        levelsByTopic[level.topicId] = [];
      }
      levelsByTopic[level.topicId].push({
        levelIndex: level.levelIndex,
        levelName: level.levelName,
        minDifficulty: level.minDifficulty,
        maxDifficulty: level.maxDifficulty,
        questionsCount: level.questionsCount,
        passThreshold: level.passThreshold,
        passThresholdType: level.passThresholdType,
        feedback: level.feedback || null,
        links: level.links.map((l) => ({ title: l.title, url: l.url })),
      });
    }

    // Sort levels by levelIndex within each topic
    for (const topicId of Object.keys(levelsByTopic)) {
      levelsByTopic[topicId].sort((a, b) => a.levelIndex - b.levelIndex);
    }

    // Create adaptive topics array
    test.adaptiveTopics = data.sections.map((s) => {
      const topicSetting = topicSettings.find((ts) => ts.topicId === s.topic.id);
      return {
        topicId: s.topic.id,
        topicName: s.topic.name,
        failureFeedback: topicSetting?.failureFeedback || null,
        levels: levelsByTopic[s.topic.id] || [],
        // Include all questions for this topic (they will be filtered by difficulty
        // in runtime — against the baked EFFECTIVE difficulty, FR-34).
        questions: ((): unknown[] => {
        // PRD-55 (FR-27): вес считается по ТЕМЕ — из неё уровень и отбирает, отсекая полосой
        // трудности. Нормировка по теме, а не по уровню: полосы задаёт автор и они меняются
        // правкой теста, а пакет уже собран. Внутри уровня шкала остаётся сравнительной —
        // `weightedPick` смотрит на отношение весов, а не на их абсолют.
        const exposureWeights = computeWeights(
          s.questions.map((q) => q.id),
          data.exposureCounts ?? new Map<string, number>(),
        );
        return s.questions.map((q) => {
          const baked = bakeScoring(q);
          const exposureWeight = exposureWeights.get(q.id) ?? 1;
          return {
            id: q.id,
            type: q.type,
            prompt: q.prompt,
            // PRD-57 FR-03a: подсветка листинга печётся в пакет готовой разметкой —
            // библиотека подсветки в ZIP не едет.
            ...promptHtmlOf(q),
            // PRD-57 FR-28v: предел печётся в пакет — конфигурации в рантайме там нет.
            data: withEffectiveMaxLength(q.type, q.dataJson, config.limits.shortAnswerMaxLength),
            correct: q.correctJson,
            points: baked.points,
            difficulty: baked.difficulty,
            mediaUrl: q.mediaUrl || null,
            mediaType: q.mediaType || null,
            feedback: q.feedback || null,
            feedbackMode: q.feedbackMode || "general",
            feedbackCorrect: q.feedbackCorrect || null,
            feedbackIncorrect: q.feedbackIncorrect || null,
            // Per-option feedback texts (see standard-section map above).
            ...(hasOptionFeedback(q.optionFeedbackJson) ? { optionFeedbackJson: q.optionFeedbackJson } : {}),
            // PRD-10: graded answer scoring (see standard-section map above).
            ...(baked.scoring ? { scoring: baked.scoring } : {}),
            // PRD-16 FR-41 (see standard-section map above).
            ...(q.shuffleAnswers === false ? { shuffleAnswers: false } : {}),
            // PRD-50 FR-17: axis keys are needed in adaptive mode too. Include only
            // a non-empty list so packages without tags stay byte-identical (FR-02).
            ...(Array.isArray(q.tags) && q.tags.length ? { tags: q.tags } : {}),
            // Единица — прежнее поведение, поэтому поле не добавляется вовсе (FR-30).
            ...(exposureWeight !== 1 ? { exposureWeight } : {}),
          };
        });
        })(),
      };
    });
  }
  // Add design settings (template selection + params)
  if (data.designSettings) {
    test.designSettings = {
      templateId: data.designSettings.templateId,
      templateVersion: data.designSettings.templateVersion,
      templateApiVersion: data.designSettings.templateApiVersion,
      params: data.designSettings.params,
      // PRD-23: omitted for a template without themes, so a themeless package keeps
      // exactly the TEST_DATA shape it had before.
      ...(data.designSettings.theme ? { theme: data.designSettings.theme } : {}),
      ...(data.designSettings.paramsByTheme
        ? { paramsByTheme: data.designSettings.paramsByTheme }
        : {}),
      ...(data.designSettings.fallbackLayoutKeys && data.designSettings.fallbackLayoutKeys.length > 0
        ? { fallbackLayoutKeys: data.designSettings.fallbackLayoutKeys }
        : {}),
      // PRD-27: включается только когда шаблон вид отчёта объявил — пакет теста на
      // шаблоне без отчёта сохраняет прежнюю форму TEST_DATA (FR-28).
      ...(data.designSettings.report ? { report: data.designSettings.report } : {}),
      // PRD-49: в пакет едут УЖЕ РАЗРЕШЁННЫЕ надписи и разрешённые по экранам списки
      // подблоков — манифеста в LMS нет, и второго источника умолчаний у рантайма быть не
      // может (так же устроен признак выдачи отчёта). Ни одно из трёх полей не появляется
      // у шаблона, который надписей не объявлял: форма TEST_DATA остаётся прежней.
      ...(data.designSettings.labels ? { labels: data.designSettings.labels } : {}),
      ...(data.designSettings.resultsBlockOrder
        ? { resultsBlockOrder: data.designSettings.resultsBlockOrder }
        : {}),
      ...(data.designSettings.templateBlockOrder
        ? { templateBlockOrder: data.designSettings.templateBlockOrder }
        : {}),
    };
  }

  // Add content pages (re-sanitize richText/html values before packaging)
  if (data.contentPages && data.contentPages.length > 0) {
    test.contentPages = data.contentPages.map((page) => {
      const rawValues = (page.valuesJson as { values?: Record<string, unknown>; placeholderStyles?: Record<string, unknown> }) ?? {};
      const values = rawValues.values ?? {};
      // Re-sanitize all string values that may contain HTML. Author CSS is also
      // confined to the placeholder region it renders into: inside the package the
      // markup lands in the REAL document, where a pasted `body { … }` rule would
      // restyle the whole player (a fixed-stage template collapses to a blank
      // screen). Re-scoping on every build also repairs pages saved before the fix;
      // it is idempotent, so already-scoped values pass through unchanged.
      const sanitizedValues: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        sanitizedValues[k] = typeof v === "string" ? sanitizeHtml(v, { scope: placeholderScope(k) }) : v;
      }
      // PRD-22 FR-30: page SETTINGS travel with the page. Without this the LMS
      // package loses the sequence identifier (no navigation dots) and the media
      // packer never sees the background image, leaving a dead link to /uploads.
      const rawSettings = (page.settingsJson ?? {}) as Record<string, unknown>;
      const sanitizedSettings: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawSettings)) {
        sanitizedSettings[k] = typeof v === "string" ? sanitizeHtml(v) : v;
      }
      // PRD-46: the scale pictogram is stored as a NAME and drawn as contours. Nothing inside a
      // package can look a name up — no React, no icon font, no library — so the geometry is
      // baked in HERE, alongside the settings it belongs to. Unconditional, like the ipsativity
      // verdict: the answer costs one lookup per build and has to be in the package before it
      // is known under which settings it will be read.
      const packedSettings = withResolvedScaleIcons(sanitizedSettings);

      return {
        id: page.id,
        topicId: page.topicId,
        position: page.position,
        mode: page.mode,
        type: page.type,
        // PRD-4 v1.1 / PRD-1 §4.3: `kind` is the new variant-kind dimension
        // (intro/info/summary/router/questions). Runtime distinguishes router
        // pages from regular content pages by `kind === "router"` (Phase 4c).
        // Legacy `type` is kept for backward compat.
        kind: page.kind,
        templateKey: page.templateKey,
        sortOrder: page.sortOrder,
        values: sanitizedValues,
        placeholderStyles: rawValues.placeholderStyles ?? {},
        settings: packedSettings,
        autoAdvance: page.autoAdvance,
        autoAdvanceDelayMs: page.autoAdvanceDelayMs,
        // Скрытая страница едет в пакет ВМЕСТЕ с признаком, а не вырезается сборщиком:
        // системные экраны (старт, итоги, обзор) — ещё и привязка макета, и без строки
        // рантайм потерял бы оформление. Что не показывать, решает общий фильтр потока.
        hidden: page.hidden ?? false,
      };
    });
  }

  // PRD-51: ДОКУМЕНТ ОТЧЁТА теста. В пакет едут СЫРЫЕ строки: связать их с раскладками
  // блоков может только сторона, видящая манифест шаблона, и делает это сборщик
  // (`resolveReportBundle`), а не рантайм.
  //
  // Значения областей чистятся повторно ТЕМ ЖЕ вызовом, каким чистятся значения
  // контентных страниц: в пакете разметка попадает в НАСТОЯЩИЙ документ, где вставленное
  // автором правило `body { … }` перекрасило бы плеер. Повторная очистка идемпотентна и
  // заодно чинит строки, сохранённые до появления очистки на сервере.
  if (data.reportBlocks && data.reportBlocks.length > 0) {
    test.reportBlocks = data.reportBlocks.map((row) => {
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row.valuesJson ?? {})) {
        values[k] = typeof v === "string" ? sanitizeHtml(v, { scope: placeholderScope(k) }) : v;
      }
      const settings: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row.settingsJson ?? {})) {
        settings[k] = typeof v === "string" ? sanitizeHtml(v) : v;
      }
      return {
        block: row.block,
        templateKey: row.templateKey,
        sortOrder: row.sortOrder,
        enabled: row.enabled,
        values,
        settings,
      };
    });
  }

  // PRD-2: user-defined result variables, ordered by sort_order. The runtime
  // (resultsPage.js) evaluates `formula` via FormulaDSL after standard scoring
  // and publishes result.*; `controlsStatus` may override pass/completion.
  if (data.resultVariables && data.resultVariables.length > 0) {
    test.resultVariables = data.resultVariables.map((rv) => ({
      id: rv.id,
      name: rv.name,
      // Label is optional; fall back to the name so the package never shows blank.
      label: rv.label.trim() ? rv.label : rv.name,
      type: rv.type,
      formula: rv.formula,
      learnerVisibility: rv.learnerVisibility,
      scormTarget: rv.scormTarget,
      controlsStatus: rv.controlsStatus,
      sortOrder: rv.sortOrder,
      // PRD-29: the indicator's interpretation (outcomes for string/boolean, bands for
      // numbers) travels raw — the runtime parses it with the SAME shared parser the
      // web host uses, so the card is built from one source.
      configJson: rv.configJson ?? {},
    }));
  }

  // PRD-5 (B5): measurement scales + per-question contributions. The runtime
  // (scales/engine.js) computes scale.* before result.* at completion; the
  // interpretation `bands` live in config_json. Measurements are flattened to the
  // engine's MeasurementSpec shape with scaleId resolved to the stable scale key
  // — the runtime never sees uuids. Gate on scales: rows without a scale are
  // meaningless, and a scale with no rows is still valid (empty aggregate).
  if (data.scales && data.scales.length > 0) {
    test.scales = data.scales.map((s) => {
      // PRD-29: the package draws the SAME scale cards as the web host, so it needs the
      // WHOLE interpretation — the domain, the favourable direction and the per-level
      // label/text/feedback — not only the bands the scale engine grades with. Parsed
      // here (once, at bake time) with the shared parser, and laid out FLAT so the
      // runtime can re-read it through that very same parser.
      //
      // Spread WHOLE, never field by field. The enumeration this replaces was not a filter
      // anybody chose — it was the residue of PRD-5, where the package needed one key
      // (`bands`) for the scale engine, extended once by hand in PRD-29. Nothing was ever
      // deliberately kept out, and the cost of the shape was paid in PRD-46: `displayMax`
      // was added to the interpretation, nobody remembered this literal, and the package
      // silently drew a different figure than the web host from the same test. A field of
      // `ScaleInterpretation` is by definition something the card is built from, so the
      // default has to be «travels», with omission the thing that needs a reason.
      const interpretation = parseScaleInterpretation(s.configJson);
      return {
        key: s.key,
        // Label is optional; fall back to the key so the package never shows blank.
        label: s.label.trim() ? s.label : s.key,
        type: s.type,
        aggregation: s.aggregation,
        normalization: s.normalization,
        direction: s.direction,
        ...interpretation,
        learnerVisibility: s.learnerVisibility,
        scormTarget: s.scormTarget,
        sortOrder: s.sortOrder,
        // PRD-49 §6: the card's name/level slot toggles, RESOLVED to a plain boolean here
        // (not the raw `config_json`) — the runtime only ever needs the answer, and the
        // author's config object is not something the package is meant to leak. `!== false`
        // because an absent key means "show"; every scale baked before this PRD carries
        // neither key and keeps both slots.
        showName: (s.configJson as Record<string, unknown>).showName !== false,
        showLevel: (s.configJson as Record<string, unknown>).showLevel !== false,
        // PRD-53 §4.4: собственное описание шкалы — источник текста блока «вне профиля».
        // Пустая строка вместо пропуска: рантайм читает поле безусловно.
        description: s.description ?? "",
      };
    });

    const scaleKeyById = new Map(data.scales.map((s) => [s.id, s.key]));
    test.measurements = (data.measurements ?? [])
      .map((m) => {
        const scaleKey = scaleKeyById.get(m.scaleId);
        // Orphan row (scale was deleted but cascade missed it): skip silently.
        if (!scaleKey) return null;
        return {
          questionId: m.questionId,
          scaleKey,
          sourceType: m.sourceType,
          sourceKey: m.sourceKey ?? null,
          value: m.valueJson,
          weight: m.weight ?? 1,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    // PRD-46 §5. Written only when TRUE: absence already means «not ipsative» to the
    // runtime, so a `false` would change the bytes of every measurement package built
    // so far without changing a pixel of it (FR-02). Inside the scales gate on purpose
    // — with no scales there is no figure the verdict could describe.
    if (data.ipsativeScales) test.ipsativeScales = true;
  }

  // Add telemetry config if present
  if (data.telemetry && data.telemetry.enabled) {
    test.telemetry = {
      enabled: true,
      packageId: data.telemetry.packageId,
      secretKey: data.telemetry.secretKey,
      apiBaseUrl: data.telemetry.apiBaseUrl,
    };
  }

  return JSON.stringify(test, null, 2);
}

export type { ExportData };
