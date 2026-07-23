/**
 * @module client/src/pages/learner/template-content-screen
 *
 * Renders one author content page on the WEB host, from the same design-template
 * layout and through the same assembler the SCORM package uses
 * (`shared/template/content-page` + `renderScreenInto`).
 *
 * This screen is what PRD-12 FR-6 was missing: the web run delivered only the
 * drawn questions, so every page the author placed in «Структура» — the test-scope
 * zones and the per-topic zones alike — was silently skipped at run time.
 */
import { useMemo } from "react";
import { TemplateScreen } from "@/components/template-screen";
import {
  buildContentPageRender,
  type ContentTemplateDef,
  type RenderableContentPage,
} from "@shared/template/content-page";
import {
  buildPageContextFor,
  type SequenceContentPage,
} from "@shared/template/page-sequences";
import { withTemplateAssetBaseInValues } from "@shared/template/asset-base";

export interface ContentScreenTemplate {
  layout: string;
  css?: string;
  cssVars?: Record<string, string>;

  /** PRD-23: per-theme colour overrides, printed as CSS. */

  themeCss?: string;

  /** PRD-23: palette pinned by the author; absent means «Авто». */

  dataTheme?: "light" | "dark";
  contentTemplates?: ContentTemplateDef[];
  design?: { logoUrl?: string };
  /**
   * Layouts the content templates address by their own `layoutFile`, keyed by
   * file name (e.g. `"layouts/section-intro.html"`). A variant's own layout WINS
   * over the generic wrapper (spec §8.2): «Введение раздела» has a dedicated
   * layout, and rendering it through `content.html` produced a blank page with
   * nothing but «Далее» — its `instruction` placeholder is the only thing that
   * wrapper knows how to fill.
   */
  variantLayouts?: Record<string, string>;
  /**
   * PRD-22 FR-36: prefix for RELATIVE links in author content (`images/x.png`)
   * pointing at the template's own files. Absent ⇒ such links are left as they
   * are, which is the pre-PRD-22 behaviour.
   */
  assetsBase?: string;
}

export interface TemplateContentScreenProps {
  page: RenderableContentPage;
  template: ContentScreenTemplate;
  /** Course/test title for the layout's `course.*` bindings. */
  courseTitle: string;
  /**
   * Extra context merged over the default `course.*` — e.g. the `sectionIntro.*`
   * block that «Введение раздела» binds against.
   */
  extraContext?: Record<string, unknown>;
  /** «Далее» — advance past this page. */
  onNext: () => void;
  /**
   * Extra HTML appended inside the page-content slot — the router hub's section
   * cards, built by the shared builder. When set, the layout's own «Далее» is
   * suppressed: the hub navigates by card, not by a linear next.
   */
  bodyHtml?: string;
  /** Actions from `bodyHtml` (e.g. `router-select:<id>`, `router-finish`). */
  onBodyAction?: (action: string) => void;
  /**
   * «Назад» on a layout that offers it (section-intro). Omitted ⇒ the affordance
   * is inert, as it was before — never a dead-end, just no reverse.
   */
  onBack?: () => void;
  /**
   * All content pages of the test — the structure the navigation dots are
   * computed from (PRD-22). Omitted ⇒ no page belongs to a sequence, so a layout
   * with an indicator simply renders none.
   */
  allPages?: SequenceContentPage[];
  className?: string;
}

/**
 * The layout owns its own navigation (`[data-nav="next"]`), which TemplateScreen
 * delegates as the action `nav:next` — so the button the author sees in the
 * template is the button the learner clicks, with no host-side re-creation.
 */
export function TemplateContentScreen({
  page,
  template,
  courseTitle,
  extraContext,
  onNext,
  bodyHtml,
  onBodyAction,
  onBack,
  allPages,
  className,
}: TemplateContentScreenProps) {
  const built = useMemo(
    () => buildContentPageRender(page, template.contentTemplates),
    [page, template.contentTemplates],
  );

  // The variant's own layout wins; the generic `content` wrapper is the fallback
  // (mirrors the SCORM runtime's resolution order).
  const layout = useMemo(() => {
    const own = built.layoutKey !== "content" ? template.variantLayouts?.[built.layoutKey] : null;
    const chosen = own || template.layout;
    if (!bodyHtml) return chosen;
    // A hub navigates by card, so the wrapper's linear «Далее» is not just inert —
    // it must not be there at all, or the learner is offered a button that does
    // nothing. The SCORM runtime drops the same `.navigation` block.
    try {
      const doc = new DOMParser().parseFromString(chosen, "text/html");
      doc.querySelectorAll(".navigation").forEach((n) => n.remove());
      return doc.body.innerHTML;
    } catch {
      return chosen; // parsing failed — better a stray button than no screen
    }
  }, [built.layoutKey, template.variantLayouts, template.layout, bodyHtml]);

  // PRD-22: navigation dots of the page's sequence, computed by the SHARED core
  // from the test structure — the same call the SCORM runtime makes, so the two
  // hosts cannot count differently. `canGoBack` is host state: the web run knows
  // whether a previous screen exists, the structure does not.
  const pageContext = useMemo(
    () => buildPageContextFor(String(page.id ?? ""), allPages ?? [], { canGoBack: Boolean(onBack) }),
    [page.id, allPages, onBack],
  );

  // PRD-22 FR-36: a relative link in author content points at the TEMPLATE's
  // files. The stored value is host-independent, so the base is applied here,
  // right before rendering, with the route this host serves them from.
  const contentWithAssetBase = useMemo(
    () =>
      template.assetsBase
        ? {
            ...built.content,
            values: withTemplateAssetBaseInValues(built.content.values, template.assetsBase),
          }
        : built.content,
    [built.content, template.assetsBase],
  );

  const context = useMemo(
    () => ({
      course: { title: courseTitle },
      page: pageContext,
      ...(template.design ? { design: template.design } : {}),
      ...(extraContext || {}),
    }),
    [courseTitle, pageContext, template.design, extraContext],
  );

  return (
    <TemplateScreen
      layout={layout}
      css={template.css}
      cssVars={template.cssVars}

      themeCss={template.themeCss}

      dataTheme={template.dataTheme}
      context={context}
      slots={{
        // The hub's cards live INSIDE the page-content slot, next to the page's own
        // placeholders — the same DOM the SCORM runtime builds, so both hosts get
        // the template's content styling around identical markup.
        "page-content": bodyHtml ? built.skeleton + bodyHtml : built.skeleton,
      }}
      content={contentWithAssetBase}
      className={className}
      onAction={(action) => {
        if (bodyHtml && onBodyAction && action !== "nav:next") {
          onBodyAction(action);
          return;
        }
        // A hub navigates by card; the wrapper's linear «Далее» must not skip it.
        if (bodyHtml) return;
        if (action === "section-intro-back" || action === "back") {
          onBack?.();
          return;
        }
        // Every «дальше» spelling the shipped layouts use reaches here: the generic
        // wrapper's `data-nav="next"`, the section-intro's
        // `data-action="section-intro-continue"`, and the plainer variants a custom
        // template might use. Anything unrecognised is ignored rather than
        // advancing — a stray click must not skip a screen.
        if (
          action === "nav:next" ||
          action === "next" ||
          action === "continue" ||
          action === "section-intro-continue"
        ) {
          onNext();
        }
      }}
    />
  );
}
