/**
 * @module scorm/build-export-data
 * @description Assembles the SCORM {@link ExportData} (the input of
 * `generateScormPackage`) from a test, decoupled from the HTTP layer so BOTH the
 * production export route and the PRD-18 debug player build the SAME deliverable
 * from the SAME source (NFR-18, R-4: "you debug what will ship"). Request-specific
 * telemetry, the package build and the HTTP response stay in the caller — this
 * returns data only.
 */

import { config } from "../config";
import { logger } from "../logger";
import { storage } from "../storage";
import { drawnScaleKeys, isTestIpsative } from "../services/scale-composition";
import {
  deliverySectionName,
  exportSourceForTest,
  ExportVersionUnavailableError,
  isScenarioSection,
  liveDataSource,
  type ExportVersion,
} from "../services/test-snapshot";
import { resolveTemplateDir } from "../services/template-dir";
import { readResultsDeclarations } from "../services/template-render";
import { resolveScreenLabels } from "../services/result-context";
import { templateBlockOrder } from "@shared/template/results-order";
import type { DesignSettings } from "@shared/schema";
import { isSupportedTemplateApiVersion } from "../template-registry";
import type { ExportData } from "./builders/test-json";

/** `ExportData` ready for `generateScormPackage`, minus request-specific telemetry. */
export type ScormExportData = Omit<ExportData, "telemetry">;

/** Source of the test content for the bake. */
export interface BuildScormExportDataOptions {
  /**
   * `export` — snapshot-aware source: a published test exports from its active
   * snapshot, a draft from live storage (PRD-15 FR-16). `debug` — ALWAYS live
   * storage (PRD-18 D-4: the debug player reflects the current editable state and
   * never a snapshot).
   */
  source: "export" | "debug";
  /**
   * Stage E5: the version an `export` bakes — published snapshot or working draft. Omitted —
   * the snapshot-aware default. Ignored by `debug`, which is always live.
   */
  version?: ExportVersion;
}

/**
 * Build failure mapped to an HTTP status by the route: a missing test (`404`) or
 * an unsupported design `templateApiVersion` (`422`). Lets the debug player
 * (Phase 3) surface the same failures with a friendly message (FR-16) instead of
 * a bare `500`.
 */
export class ScormBuildError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ScormBuildError";
  }
}

/**
 * Assemble {@link ScormExportData} for `testId`. Throws {@link ScormBuildError} on
 * a missing test (`404`) or an unsupported design `templateApiVersion` (`422`).
 */
export async function buildScormExportData(
  testId: string,
  opts: BuildScormExportDataOptions,
): Promise<ScormExportData> {
  // PRD-56 FR-19a: вместе с источником состава берётся и снимок, из которого он собран —
  // его номер уезжает в пакет. У отладочной сборки снимка нет по определению (PRD-18 D-4:
  // живое состояние, а не версия), поэтому её путь снимок и не спрашивает.
  const { src, snapshot } = opts.source === "debug"
    ? { src: liveDataSource(), snapshot: null }
    : await exportSourceForTest(testId, opts.version).catch((error: unknown) => {
      // A published version asked for and absent is the caller's conflict, not a server fault.
      if (error instanceof ExportVersionUnavailableError) throw new ScormBuildError(error.message, 409);
      throw error;
    });
  const test = await src.getTest(testId);
  if (!test) {
    throw new ScormBuildError("Test not found", 404);
  }

  const sections = await src.getTestSections(test.id);

  /**
   * PRD-56 FR-17a: задания, снятые с выдачи ЭТОГО теста.
   *
   * Только для ЖИВОЙ сборки — черновика и отладочного прогона. Пакет по снимку состав не
   * меняет: снимок уже отфильтрован публикацией, и применять к нему сегодняшние настройки
   * значило бы переписать опубликованную версию задним числом (PRD-15). То же правило и та
   * же оговорка, что на старте попытки.
   */
  const excludedFromDelivery = new Set<string>();
  if (snapshot === null) {
    for (const row of await src.getTestQuestionScoring(test.id)) {
      if (row.excludedFromDelivery) excludedFromDelivery.add(row.questionId);
    }
  }

  const exportSections = await Promise.all(
    sections.map(async (s) => {
      // «Сценарий в ИС»: раздел пункта-сценария (тест «Сценарий» или пункт роутера). Тема у
      // него — тема-банк под ИМЕНЕМ пункта и с ключом пункта вместо идентификатора: под этим
      // ключом раздел живёт в хабе, в правилах разблокировки и в итогах, как на вебе. Пул —
      // сценарии темы (или один фиксированный); пакет несёт его весь, с весами экспозиции, и
      // выбирает один тем же отбором, что и раздел темы. Своих текстов и материалов у пункта
      // нет — тексты темы-банка относятся к ней, а не к заданию.
      if (isScenarioSection(s)) {
        const bank = await src.getTopic(s.scenarioItem.topicId);
        const questions = (await src.getScenarioPool(s.scenarioItem))
          .filter((question) => !excludedFromDelivery.has(question.id));
        const name = deliverySectionName(s, () => bank?.name);
        if (!bank || questions.length === 0) {
          throw new ScormBuildError(`В пункте «${name}» нет сценариев: пакет без задания не собирается`, 422);
        }
        const topic = {
          ...bank,
          id: s.topicId,
          name,
          code: null,
          description: null,
          feedback: null,
          feedbackJson: null,
          interpretationJson: null,
        };
        return { ...s, topic, questions, courses: [], events: [] };
      }
      const topic = await src.getTopic(s.topicId);
      const questions = (await src.getQuestionsByTopic(s.topicId))
        .filter((question) => !excludedFromDelivery.has(question.id));
      const courses = await src.getTopicCourses(s.topicId);
      const events = await src.getTopicEvents(s.topicId);
      return { ...s, topic: topic!, questions, courses, events };
    }),
  );

  // Validate the design template before packaging.
  const rawDesignSettings = test.designSettingsJson as Record<string, unknown> | null;
  const designTemplateId = (rawDesignSettings?.templateId as string | undefined) || "default";
  const designTemplateApiVersion = rawDesignSettings?.templateApiVersion as string | undefined;

  if (designTemplateApiVersion && !isSupportedTemplateApiVersion(designTemplateApiVersion)) {
    throw new ScormBuildError(
      `Unsupported templateApiVersion in design settings: ${designTemplateApiVersion}`,
      422,
      "templateApiVersion",
    );
  }

  // The package is a learner-facing artifact: a non-active template must not ship —
  // `resolveTemplateDir` falls back to `default` (same in debug, which shows what
  // would ship). Resolved here, ahead of the design settings, because the PRD-49
  // labels are resolved against THIS template's manifest.
  const templateDir = await resolveTemplateDir(designTemplateId, { activeOnly: true });

  // PRD-49 §8. There is no manifest inside an LMS, so the package carries the ALREADY
  // RESOLVED wording — the template default with the test's own words on top — exactly
  // as it carries the resolved report variant. The runtime unfolds nothing: it picks its
  // screen's flat «key → text» map and hands it to the shared builder, which alone turns
  // it into the `labels.*` tree, so there is only ever ONE place that shapes it.
  //
  // Resolved PER SCREEN, because `defaults.<экран>` is part of the declaration: a template
  // that words the adaptive results screen differently would otherwise get the standard
  // screen's wording in the package while the web host — which resolves per screen —
  // printed its own. That is precisely the host drift §2.5 forbids, so the answer is baked
  // for every screen that renders labels rather than reduced to one map. The report layer
  // is not here: it carries its own overrides and is resolved by the report builder.
  const declarations = readResultsDeclarations(templateDir);
  const design = (rawDesignSettings ?? null) as DesignSettings | null;
  const labels = declarations.labels.length
    ? {
        results: resolveScreenLabels(declarations.labels, design, "results"),
        "results.adaptive": resolveScreenLabels(declarations.labels, design, "results.adaptive"),
        "section-results": resolveScreenLabels(declarations.labels, design, "section-results"),
      }
    : null;
  // The ORDER is resolved per screen for the same reason, and for one more: the shipped
  // manifest gives the adaptive results screen its own composition (topics first, no score
  // summary). Итоги раздела подблоков не имеют — списка у них и нет.
  const screenBlockOrder = declarations.blockOrder
    ? {
        results: templateBlockOrder(declarations.blockOrder, "results"),
        "results.adaptive": templateBlockOrder(declarations.blockOrder, "results.adaptive"),
      }
    : null;
  // Rides on the TEMPLATE, not on the test having design settings: a test that never
  // opened «Оформление» still renders from the template's layouts, and the web host
  // resolves its labels all the same. Leaving these out of the `else` branch below would
  // give such a test headings on the web and none in the package — the very drift PRD-49
  // §2.5 forbids. Every key is still absent for a template that declares nothing.
  const prd49 = {
    ...(labels ? { labels } : {}),
    ...(design?.resultsBlockOrder ? { resultsBlockOrder: design.resultsBlockOrder } : {}),
    // Absent for a template that declares no order at all: the runtime then falls back
    // to the shipped list inside the shared builder, which is what it did before.
    ...(screenBlockOrder ? { templateBlockOrder: screenBlockOrder } : {}),
  };

  const designSettings = rawDesignSettings && Object.keys(rawDesignSettings).length > 0
    ? {
        templateId: designTemplateId,
        templateVersion: rawDesignSettings.templateVersion as string | undefined,
        templateApiVersion: rawDesignSettings.templateApiVersion as string | undefined,
        params: (rawDesignSettings.params as Record<string, unknown>) ?? {},
        // PRD-23: the palette choice and the per-theme colours travel with the
        // package — without them the runtime repaints from the template defaults
        // and the exported test looks unlike the one the author saw.
        ...(rawDesignSettings.theme ? { theme: rawDesignSettings.theme as string } : {}),
        ...(rawDesignSettings.paramsByTheme
          ? { paramsByTheme: rawDesignSettings.paramsByTheme as Record<string, Record<string, unknown>> }
          : {}),
        // PRD-49: надписи и порядок подблоков — см. `prd49` выше.
        ...prd49,
      }
    : { templateId: "default", params: {}, ...prd49 };

  const contentPages = await src.getContentPages(test.id);
  // PRD-51: строки документа отчёта. Идут ЧЕРЕЗ источник, а не мимо него: снапшот
  // публикации морозит их вместе с рядом теста, и живой экспорт черновика обязан брать
  // их из того же места, откуда берёт остальной состав.
  const reportBlocks = await src.getReportBlocks(
    test.id,
    test.mode === "adaptive" ? "adaptive" : "standard",
  );
  const resultVariables = await src.getResultVariables(test.id);
  const scales = await src.getScales(test.id);
  const measurements = await src.getQuestionMeasurements(test.id);

  // PRD-46 §5: do the scales divide ONE WHOLE? Resolved HERE and baked, because the
  // in-package runtime holds neither the contribution rows nor the allocation budgets
  // the verdict is read from — only the answer.
  //
  // Unconditional, unlike the web host. There the computation is guarded by the `auto`
  // setting because it runs on every rendering of the results screen; a build has no
  // such loop, so the price is paid once per package — and a package whose author later
  // switches the setting to `auto` must already carry the answer.
  //
  // Hidden scales are excluded by `drawnScaleKeys` — the same rule the renderer draws by.
  const ipsativeScales = isTestIpsative({
    scales,
    scaleKeys: drawnScaleKeys(scales),
    measurements,
    questions: exportSections.flatMap((s) => s.questions),
  });

  // PRD-15 block D (FR-32): per-test scoring overrides — the bake resolves the
  // effective points/scoring/difficulty into TEST_DATA. Snapshot exports read the
  // frozen rows; drafts/debug read live.
  const questionScoring = await src.getTestQuestionScoring(test.id);

  // PRD-55 (FR-27/FR-29): накопленные выдачи на момент СБОРКИ пакета. Берутся всегда живыми, в
  // том числе для снимка публикации: экспозиция — СТАТИСТИКА, а не содержание, поэтому она не
  // замораживается вместе с версией и не делает снимок устаревшим. Сбой чтения не имеет права
  // сорвать экспорт: без счётчиков веса равны, и пакет собирается как до PRD-55.
  let exposureCounts = new Map<string, number>();
  try {
    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - config.delivery.exposureWindowMonths);
    exposureCounts = await storage.getDeliveryCounts(
      exportSections.flatMap((s) => s.questions.map((q) => q.id)),
      windowStart,
    );
  } catch (error) {
    logger.warn("PRD-55: счётчики выдач не прочитаны при сборке пакета — " + (error as Error).message);
  }

  let adaptiveSettings = null;
  if (test.mode === "adaptive") {
    const topicSettings = await src.getAdaptiveTopicSettingsByTest(test.id);
    const levels = await src.getAdaptiveLevelsByTest(test.id);
    const levelsWithLinks = await Promise.all(
      levels.map(async (level) => {
        const links = await src.getAdaptiveLevelLinks(level.id);
        return { ...level, links };
      }),
    );
    adaptiveSettings = { topicSettings, levels: levelsWithLinks };
  }

  return {
    test,
    // PRD-56 FR-19a: НОМЕР версии, а не идентификатор снимка — он уникален внутри теста
    // (`test_snapshots_test_version_idx`), читается человеком в отчёте LMS и не выносит
    // наружу внутренних ключей. Ключа нет вовсе, когда версии нет: черновик и отладочная
    // сборка обязаны дать прежний пакет до байта.
    ...(snapshot ? { publicationVersion: snapshot.version } : {}),
    sections: exportSections,
    questionScoring,
    adaptiveSettings,
    contentPages,
    reportBlocks,
    resultVariables,
    scales,
    measurements,
    ipsativeScales,
    exposureCounts,
    designSettings,
    templateDir,
    // PRD-34 (FR-26): признак сборки едет в бейк — отладочный пакет запекается с
    // выключенной защитой. Отдельного канала для этого не заводится.
    source: opts.source,
  };
}
