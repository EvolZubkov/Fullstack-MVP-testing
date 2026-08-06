/**
 * @module features/tests/editor/sections/page-preview-modal
 * @description Single content-page preview modal for the «Структура» tab
 * (PRD-7 S13.4-G17 / FR-44).
 *
 * Renders ONLY the page being previewed, through the SAME unified renderer the
 * runtime and «Шаблоны» use ({@link TemplateScreen} → `renderScreenInto`) — no
 * second preview engine. The page's current placeholder values are fed into the
 * renderer's content channel ({@link buildContentPageScreen}); the template +
 * branding come from the DESIGN DRAFT (the in-progress «Оформление» selection),
 * not the saved design — so switching the template in «Оформление» is reflected
 * here immediately, consistent with the template preview. Resolved server-side
 * via `sourcePath`, so uploaded (PRD-3) templates preview too.
 *
 * Static visual evaluation only — interactions are demo-only and persist nothing.
 */
import { useMemo } from "react";
import { Banner, Button, ModalDialog } from "@universityrt/ui-kit";
import { TemplateScreen } from "@/components/template-screen";
import { buildContentPageScreen, buildScreenInputs, type PreviewDemoDataset } from "@shared/template/preview-context";
import type { SequencePlacement } from "@shared/template/page-sequences";
import { buildSectionIntroContext } from "@shared/template/result-context";
import { buildTemplateCssVars } from "@shared/template/params-css";
import { startImageForVariant, type StartVariantDecl } from "@shared/template/start-image";
import { useTemplateBundle } from "./use-template-bundle";

// ─── Public API ───────────────────────────────────────────────────────────────

/** The content-page fields the preview reads (structural — date shapes vary by host). */
export interface PagePreviewPage {
  id: string;
  /** Variant-binding kind (PRD-1 §4.3): intro | info | summary | router | questions. */
  kind?: string | null;
  /** Topic this page belongs to (per-topic kinds, e.g. `intro`) — picks the real section. */
  topicId?: string | null;
  templateKey?: string | null;
  valuesJson?: unknown;
  /** PRD-22 page settings — the `page.*` properties the layout binds (e.g. `nextLabel`). */
  settingsJson?: Record<string, unknown> | null;
}

export type PagePreviewModalProps = {
  open: boolean;
  onClose: () => void;
  /** Draft design template id — the page previews against the IN-PROGRESS template. */
  templateId: string | undefined;
  /** Draft design params (branding), applied as CSS variables. */
  params: Record<string, unknown>;
  /** The content page being previewed (its current values are rendered). */
  page: PagePreviewPage;
  /** Display title for the modal header («Предпросмотр: <title>»). */
  pageTitle: string;
  /**
   * REAL test data so previews render the actual test where possible (FR-44): the
   * test title, its topics (router topic-menu + section/topic labels) and total
   * question count override the template's demo dataset. Falls back to the demo
   * when a field is absent (e.g. real questions are not loaded in the editor).
   */
  realData?: {
    courseTitle?: string;
    /** Real test description → «Старт» subtitle. */
    description?: string;
    /** Pass threshold percent (null when the rule is absolute/none). */
    passPercent?: number | null;
    timeLimitMinutes?: number | null;
    maxAttempts?: number | null;
    topics?: Array<{ id: string; title: string }>;
    questionCount?: number;
    /** Per-section data for the «Введение раздела» preview (topic name + count). */
    sections?: Array<{ topicId: string; topicName: string; questionCount: number }>;
  };
  /**
   * PRD-22: the page's place in its sequence, computed by the editor over the whole
   * test. Supplied ⇒ the preview shows the navigation indicator the learner sees;
   * absent ⇒ none, since a single page cannot imply a sequence.
   */
  sequencePlacement?: SequencePlacement | null;
};

// ─── Design-media helpers ───────────────────────────────────────────────────────

/**
 * Unwrap a media design param (`logoUrl` / `startImageUrl`) to a plain URL,
 * mirroring both hosts' `resolveMediaUrl`: an image param is stored as a media
 * envelope `{ url, name, … }` (or a bare string for legacy values), but the start
 * layout binds a plain URL string.
 */
function mediaUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string") {
    return (value as { url: string }).url || undefined;
  }
  return undefined;
}

/**
 * The `design.*` context the start layouts bind, unwrapped from the draft params.
 *
 * PRD-22: the illustration comes from the START PAGE's own property, but only for
 * the variant that DECLARES it; a variant without the property shows the test-wide
 * branding illustration, exactly as its layout does in a run ({@link startImageForVariant}).
 */
function previewDesign(
  params: Record<string, unknown>,
  variant: StartVariantDecl | null | undefined,
  pageSettings?: Record<string, unknown> | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  const logo = mediaUrl(params.logoUrl);
  if (logo) out.logoUrl = logo;
  const startImage = startImageForVariant(variant, pageSettings, params);
  if (startImage) out.startImageUrl = startImage;
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PagePreviewModal({
  open,
  onClose,
  templateId,
  params,
  page,
  pageTitle,
  realData,
  sequencePlacement,
}: PagePreviewModalProps) {
  const bundleQuery = useTemplateBundle(templateId, open);
  const bundle = bundleQuery.data;

  // REAL test data overlaid on the template's demo dataset (FR-44: preview from
  // real data where possible). Real title + topics + question count drive the
  // router topic-menu, section/итоги labels and counters; demo fills the rest
  // (e.g. example questions, which the structure editor does not load).
  const effectiveDemo = useMemo<PreviewDemoDataset | null>(() => {
    const base = (bundle?.demo as PreviewDemoDataset | undefined) ?? undefined;
    if (!base) return null;
    if (!realData) return base;
    const topics = realData.topics?.length
      ? realData.topics.map((t) => ({ id: t.id, title: t.title, status: "available" }))
      : base.course.topics;
    return {
      ...base,
      course: {
        ...base.course,
        ...(realData.courseTitle ? { title: realData.courseTitle } : {}),
        ...(topics ? { topics } : {}),
        ...(realData.questionCount != null ? { questionCount: realData.questionCount } : {}),
        // Start-screen facts: overlaid whenever the editor provides them (using
        // `!== undefined` so a real `null` — e.g. "no time limit" — overrides the
        // demo value instead of leaving the demo's number).
        ...(realData.description !== undefined ? { description: realData.description } : {}),
        ...(realData.passPercent !== undefined ? { passPercent: realData.passPercent } : {}),
        ...(realData.timeLimitMinutes !== undefined ? { timeLimitMinutes: realData.timeLimitMinutes } : {}),
        ...(realData.maxAttempts !== undefined ? { maxAttempts: realData.maxAttempts } : {}),
      },
    };
  }, [bundle, realData]);

  // One ScreenSpec for THIS page. `start` / `results` / `questions` and the PRD-19
  // system nodes `review` (обзор) / `section-results` (итоги раздела) are rendered
  // by their OWN runtimes (not as content pages) — preview them from the (real-data
  // overlaid) demo dataset via the SAME builders the player/«Предпросмотр» use
  // (buildStartState / buildResultContext / buildReviewContext /
  // buildSectionResultContext / demo question). Content kinds (intro/info/summary/
  // router) render the page's own values; router also gets the REAL topic-menu.
  const spec = useMemo(() => {
    if (!bundle) return null;
    // The start screen honours the author's chosen VARIANT (start.image-right, …):
    // match the demo screen by the page's `templateKey` (its route equals the
    // variant key), falling back to the canonical `start`. The design illustration
    // is injected into `design.*` from the draft branding params — the same
    // `startImageUrl`/`logoUrl` both hosts resolve — so the picked image shows here.
    if (page.kind === "start") {
      const demoScreens = effectiveDemo ? buildScreenInputs(effectiveDemo, bundle.manifest) : [];
      const byVariant = page.templateKey
        ? demoScreens.find((s) => s.route === page.templateKey)
        : undefined;
      const chosen = byVariant ?? demoScreens.find((s) => s.route === "start") ?? null;
      if (!chosen) return null;
      const declaration = (bundle.manifest.contentTemplates ?? []).find(
        (ct) => ct.key === page.templateKey,
      ) as StartVariantDecl | undefined;
      const design = previewDesign(params, declaration, page.settingsJson as Record<string, unknown> | null);
      return {
        ...chosen,
        input: { ...chosen.input, context: { ...(chosen.input?.context ?? {}), design } },
      };
    }
    if (
      page.kind === "results" ||
      page.kind === "questions" ||
      page.kind === "review" ||
      page.kind === "section-results"
    ) {
      const demoScreens = effectiveDemo ? buildScreenInputs(effectiveDemo, bundle.manifest) : [];
      const matches =
        page.kind === "results"
          ? (r: string) => r === "results" || r === "results.adaptive"
          : page.kind === "review"
            ? (r: string) => r === "review"
            : page.kind === "section-results"
              ? (r: string) => r === "section-results"
              : (r: string) => r.startsWith("question");
      return demoScreens.find((s) => matches(s.route)) ?? null;
    }
    // PRD-1 §4.3: «Введение раздела» (intro) renders via its own section-intro layout
    // — real topic name + question count (from the editor sections) + the author
    // instruction (slot). Topic description / time limit are shown in the real run
    // (the export carries them); not loaded in the editor, so the preview omits them.
    if (page.kind === "intro" && bundle.layouts["section-intro"]) {
      const sections = realData?.sections ?? [];
      const i = sections.findIndex((s) => s.topicId === page.topicId);
      const section = i >= 0 ? sections[i] : sections[0];
      const instr = String(
        (page.valuesJson as { values?: { instruction?: unknown } } | null)?.values?.instruction ?? "",
      );
      const built = buildSectionIntroContext({
        sectionNumber: i >= 0 ? i + 1 : 1,
        topicName: section?.topicName ?? effectiveDemo?.course.topics?.[0]?.title ?? "Раздел",
        questionCount: section?.questionCount ?? effectiveDemo?.course.questionCount ?? 0,
        instruction: instr,
      });
      return {
        id: page.id,
        route: "content.intro",
        layoutKey: "section-intro",
        expectedSlots: [],
        input: {
          context: { course: built.course, sectionIntro: built.sectionIntro },
          slots: { instruction: instr },
        },
      };
    }
    const values = (page.valuesJson as { values?: Record<string, unknown> } | null)?.values ?? {};
    const tpl = (bundle.manifest.contentTemplates ?? []).find((c) => c.key === page.templateKey);
    const route = tpl?.pageKind ?? `content.${page.kind ?? "info"}`;
    const runtime = effectiveDemo?.runtime;
    const rr = runtime?.sectionResult ?? runtime?.result;
    const result = rr
      ? { scorePercent: Number(rr.scorePercent) || 0, status: rr.status ?? "", passed: !!rr.passed }
      : undefined;
    return buildContentPageScreen({
      manifest: bundle.manifest,
      route,
      templateKey: page.templateKey ?? undefined,
      values,
      settings: page.settingsJson ?? null,
      sequencePlacement,
      courseTitle: realData?.courseTitle ?? effectiveDemo?.course.title ?? "",
      result,
      // Real topics → the router preview renders the actual topic-menu cards.
      routerTopics: (effectiveDemo?.course.topics ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    });
  }, [bundle, page, effectiveDemo, realData, sequencePlacement, params]);

  // Draft branding → CSS variables, via the SAME mapping the runtime uses.
  const cssVars = useMemo(() => buildTemplateCssVars(params, bundle?.manifest.params), [params, bundle]);

  if (!open) return null;

  const layout = spec && bundle ? bundle.layouts[spec.layoutKey] : undefined;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      className="tpl-preview-modal"
      title={`Предпросмотр: ${pageTitle}`}
      description="Так страница выглядит в плеере. Прогресс не сохраняется."
      footer={
        <div className="tpl-preview-foot" data-testid="page-preview-foot">
          <span className="tpl-preview-foot__info">
            предпросмотр одной страницы · стиль и шрифты — из текущего «Оформления»
          </span>
          <Button variant="secondary" size="m" onClick={onClose} data-testid="page-preview-close">
            Закрыть
          </Button>
        </div>
      }
    >
      <div className="tpl-preview-frame" data-testid="page-preview-modal">
        {bundleQuery.isLoading && <p className="tpl-upload-hint">Загружаем шаблон…</p>}
        {bundleQuery.error && (
          <Banner tone="error" title="Не удалось загрузить файлы шаблона" description={(bundleQuery.error as Error).message} />
        )}
        {bundle && spec && layout != null ? (
          <div className="tpl-check-stage__frame">
            <TemplateScreen
              layout={layout}
              context={spec.input.context}
              slots={spec.input.slots}
              content={spec.input.content}
              css={bundle.css}
              cssVars={cssVars}
              shell={(bundle.manifest as { mountShell?: boolean }).mountShell ? bundle.layouts.shell : undefined}
            />
          </div>
        ) : (
          bundle && (
            <Banner
              tone="warning"
              title="Не удалось собрать предпросмотр страницы"
              description={spec ? `Макет «${spec.layoutKey}» не найден в шаблоне.` : "Выбранный шаблон не содержит подходящего макета."}
            />
          )
        )}
      </div>
    </ModalDialog>
  );
}
