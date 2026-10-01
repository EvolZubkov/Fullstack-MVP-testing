/**
 * @module features/tests/editor/questions/question-summary
 * @description Сводка вопроса В КОНТЕКСТЕ ОДНОГО ТЕСТА для списка «Вопросы теста».
 *
 * Сводка только читается: всё, что в ней названо, правится на своих вкладках ящика
 * (балл и цена ответа — «Оценка ответа», вклады — «Вклады вопросов», варианты и квоты —
 * «Состав»), а содержание вопроса — в ящике вопроса. Здесь автор видит, что с вопросом
 * происходит в этом тесте, не обходя эти вкладки по очереди.
 *
 * Строка сводки — перечень свойств через « · »; отметки — ТОЛЬКО отклонения от обычного,
 * чтобы простой вопрос не пестрел метками.
 *
 * Функция чистая и без DOM: на входе вопрос из банка и срез черновика теста.
 */
import { resolveEffectiveScoring } from "@shared/scoring/effective-scoring";
import { tagKey } from "@shared/tags";
import type { Question } from "@shared/schema";
import { pluralize } from "@/lib/i18n";
import {
  sectionDrawsAll,
  type EditorSection,
  type QuestionMeasurementModel,
  type ScaleModel,
  type TestMode,
} from "../test-editor.types";
import { overridesScoring, type QuestionScoringOverride } from "../scoring-api";

/** Поля вопроса из банка, которые нужны сводке. */
export type SummaryQuestion = Pick<
  Question,
  "id" | "tags" | "difficulty" | "contentHash" | "feedbackMode" | "feedback" | "feedbackCorrect" | "feedbackIncorrect"
>;

/** Отметка об отклонении. `key` стабилен и служит адресом в тестах и разметке. */
export type SummaryFlag = {
  key: "override" | "stale" | "no-variant" | "outside-quota" | "excluded" | "comments";
  label: string;
  tone: "warning" | "neutral" | "info";
};

/** Сводка вопроса: строка свойств и отметки. */
export type QuestionSummary = {
  meta: string[];
  flags: SummaryFlag[];
};

/** Входные данные сводки: вопрос и то, что о нём знает черновик теста. */
export type QuestionSummaryInput = {
  question: SummaryQuestion;
  /** Раздел теста, к теме которого относится вопрос. */
  section: EditorSection;
  mode: TestMode;
  /** Балл за вопрос по умолчанию для теста; `null` — системное умолчание. */
  testDefaultPoints: number | null;
  /** Переопределение оценки вопроса в этом тесте, если есть. */
  override: QuestionScoringOverride | undefined;
  /** Все вклады теста; сводка сама отбирает вклады своего вопроса. */
  measurements: readonly QuestionMeasurementModel[];
  scales: readonly Pick<ScaleModel, "key" | "label">[];
  /** Вопрос исключён из выдачи в этом тесте (решение аналитики, PRD-56). */
  excluded: boolean;
  /** Число открытых веток рецензирования, привязанных к вопросу. */
  openComments: number;
};

/** Название способа цены ответа — те же слова, что в «Оценке ответа». */
const KIND_LABEL: Record<string, string> = {
  exact: "Точное",
  weighted: "Веса",
  tiered: "Ступени",
};

function feedbackLabel(q: SummaryQuestion): string {
  if (q.feedbackMode === "conditional") {
    const has = Boolean((q.feedbackCorrect ?? "").trim() || (q.feedbackIncorrect ?? "").trim());
    return has ? "обратная связь: верно / неверно" : "без обратной связи";
  }
  return (q.feedback ?? "").trim() ? "обратная связь: общая" : "без обратной связи";
}

function scalesLabel(input: QuestionSummaryInput): string | null {
  const keys = new Set(
    input.measurements
      .filter((m) => m.questionId === input.question.id && m.value !== 0)
      .map((m) => m.scaleKey),
  );
  const names = input.scales.filter((s) => keys.has(s.key)).map((s) => `«${s.label}»`);
  if (names.length === 0) return null;
  return `${names.length === 1 ? "шкала" : "шкалы"} ${names.join(", ")}`;
}

/**
 * Отметка квоты: вопрос без тега ни одной квоты попадает в тест только на ОСТАТОК
 * выдачи сверх суммы квот (`shared/draw/blueprint`). Когда остатка нет, такой вопрос не
 * выдаётся никогда — это уже предупреждение, а не справка.
 */
function quotaFlag(input: QuestionSummaryInput): SummaryFlag | null {
  const { section, question, mode } = input;
  const strata = section.drawBlueprint?.strata ?? [];
  if (section.formSet || strata.length === 0 || sectionDrawsAll(section.drawAll, mode)) {
    return null;
  }
  const own = new Set((question.tags ?? []).map(tagKey));
  if (strata.some((s) => own.has(tagKey(s.tag)))) return null;
  const quotaSum = strata.reduce((sum, s) => sum + s.count, 0);
  return section.drawCount - quotaSum > 0
    ? { key: "outside-quota", label: "вне квот", tone: "neutral" }
    : { key: "outside-quota", label: "вне квот, не выдаётся", tone: "warning" };
}

/**
 * Собрать сводку вопроса в тесте.
 *
 * @param input вопрос и срез черновика теста
 * @returns строка свойств и отметки об отклонениях, по порядку: оценка, выдача,
 *   исключение, комментарии
 */
export function buildQuestionSummary(input: QuestionSummaryInput): QuestionSummary {
  const { question, section, override } = input;
  const effective = resolveEffectiveScoring({
    override: override
      ? {
          points: override.points,
          scoring: override.scoringJson,
          difficulty: override.difficulty,
          pinnedContentHash: override.pinnedContentHash,
        }
      : null,
    defaults: {
      sectionDefaultPoints: section.defaultPoints,
      testDefaultPoints: input.testDefaultPoints,
    },
    questionContentHash: question.contentHash ?? null,
  });
  const difficulty = override?.difficulty ?? question.difficulty;
  const tags = question.tags ?? [];

  const meta: string[] = [
    tags.length > 0 ? tags.join(", ") : "без подтемы",
    difficulty == null ? "сложность не задана" : `сложность ${difficulty}`,
    `балл ${effective.points}`,
    `цена ответа «${KIND_LABEL[effective.scoring.kind] ?? effective.scoring.kind}»`,
  ];
  const scales = scalesLabel(input);
  if (scales) meta.push(scales);
  meta.push(feedbackLabel(question));

  const flags: SummaryFlag[] = [];
  if (effective.stale) {
    flags.push({ key: "stale", label: "Настройка устарела", tone: "warning" });
  } else if (overridesScoring(override)) {
    flags.push({ key: "override", label: "задано в тесте", tone: "warning" });
  }

  if (section.formSet) {
    // Варианты часто называют «Вариант 1», «Вариант 2»: слово уже стоит перед списком,
    // и без этой правки сводка печатала «варианты Вариант 1, Вариант 3».
    const labels = section.formSet.forms
      .filter((f) => f.questionIds.includes(question.id))
      .map((f) => f.label.replace(/^вариант\s+/i, "") || f.label);
    if (labels.length > 0) {
      meta.push(`${labels.length === 1 ? "вариант" : "варианты"} ${labels.join(", ")}`);
    } else {
      flags.push({ key: "no-variant", label: "не входит в варианты", tone: "warning" });
    }
  }
  const quota = quotaFlag(input);
  if (quota) flags.push(quota);

  if (input.excluded) {
    flags.push({ key: "excluded", label: "исключён из выдачи", tone: "neutral" });
  }
  if (input.openComments > 0) {
    const n = input.openComments;
    flags.push({
      key: "comments",
      label: `${n} ${pluralize(n, "открытый комментарий", "открытых комментария", "открытых комментариев")}`,
      tone: "info",
    });
  }
  return { meta, flags };
}
