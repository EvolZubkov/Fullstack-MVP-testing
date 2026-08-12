/**
 * @module scorm/build-export-data
 * @description Assembles the SCORM {@link ExportData} (the input of
 * `generateScormPackage`) from a test, decoupled from the HTTP layer so BOTH the
 * production export route and the PRD-18 debug player build the SAME deliverable
 * from the SAME source (NFR-18, R-4: "you debug what will ship"). Request-specific
 * telemetry, the package build and the HTTP response stay in the caller — this
 * returns data only.
 */

import { drawnScaleKeys, isTestIpsative } from "../services/scale-composition";
import { exportSourceForTest, liveDataSource } from "../services/test-snapshot";
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
    readonly status: 404 | 422,
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
  const src = opts.source === "debug" ? liveDataSource() : await exportSourceForTest(testId);
  const test = await src.getTest(testId);
  if (!test) {
    throw new ScormBuildError("Test not found", 404);
  }

  const sections = await src.getTestSections(test.id);
  const exportSections = await Promise.all(
    sections.map(async (s) => {
      const topic = await src.getTopic(s.topicId);
      const questions = await src.getQuestionsByTopic(s.topicId);
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
  // as it carries the resolved report variant. The runtime unfolds nothing: it hands
  // this flat «key → text» map to the shared builder, and the builder alone turns it
  // into the `labels.*` tree, so there is only ever ONE place that shapes it.
  const declarations = readResultsDeclarations(templateDir);
  const design = (rawDesignSettings ?? null) as DesignSettings | null;
  const labels = resolveScreenLabels(declarations.labels, design, "results");
  // …the ORDER, on the other hand, cannot be reduced to one screen: the shipped manifest
  // gives the adaptive results screen its own composition (topics first, no score
  // summary). It is resolved per screen HERE, again because the manifest does not travel.
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
    ...(Object.keys(labels).length ? { labels } : {}),
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
    sections: exportSections,
    questionScoring,
    adaptiveSettings,
    contentPages,
    resultVariables,
    scales,
    measurements,
    ipsativeScales,
    designSettings,
    templateDir,
    // PRD-34 (FR-26): признак сборки едет в бейк — отладочный пакет запекается с
    // выключенной защитой. Отдельного канала для этого не заводится.
    source: opts.source,
  };
}
