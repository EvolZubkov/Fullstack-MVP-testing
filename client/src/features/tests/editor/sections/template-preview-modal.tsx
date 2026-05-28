/**
 * @module features/tests/editor/sections/template-preview-modal
 * @description Template preview modal for the «Оформление» tab (PRD-7 S12-G2 / FR-30).
 *
 * Renders a full-size ModalDialog that lets the author preview all template
 * element types (intro, info, questions, summary) rendered inside a mock
 * SCORM chrome shell branded with the current `design.draft.params` colors.
 *
 * Architecture:
 *   - Rail (left column): groups of template element types derived from
 *     `template.manifest.contentTemplates`. Router-kind variants are skipped
 *     because they have no visual representation.
 *   - Stage (right column): mocked SCORM shell that renders demo content for
 *     the currently selected rail item. Demo data comes from
 *     `template-preview-fixtures.ts` — never from the live test content.
 *   - Shell style: CSS custom properties `--tpl-primary`, `--tpl-fg`,
 *     `--tpl-card`, `--tpl-font` are derived from `params` and applied
 *     as inline style on `.tpl-preview-shell`.
 *
 * Wireframe source: docs/wireframes/approved/prd7-design-tab.html
 * state `wf-template-preview` (lines 657-730).
 */
import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { Button, ModalDialog } from "@universityrt/ui-kit";
import type { TemplateRow } from "../use-design-settings";
import {
  PREVIEW_COURSE_CHROME,
  PREVIEW_INTRO,
  PREVIEW_INFO,
  PREVIEW_SUMMARY,
  PREVIEW_QUESTIONS,
  PREVIEW_QUESTION_TYPE_LABEL,
  type PreviewQuestionType,
} from "./template-preview-fixtures";

// ─── Public API ───────────────────────────────────────────────────────────────

export type TemplatePreviewModalProps = {
  open: boolean;
  onClose: () => void;
  /**
   * Current template (with manifest.contentTemplates[]). When null the modal
   * does not render anything — DesignSection ensures open=true is only set
   * when template != null.
   */
  template: TemplateRow | null;
  /** Current draft.params — applied as CSS variables on the preview shell. */
  params: Record<string, unknown>;
};

// ─── Internal types ───────────────────────────────────────────────────────────

/** Loose manifest content-template shape (manifest uses zod .passthrough()). */
type ContentTemplate = {
  key: string;
  label: string;
  kind: string;
  placeholders?: unknown[];
};

type RailItem =
  | {
      type: "variant";
      kind: "intro" | "info" | "summary";
      variantKey: string;
      label: string;
    }
  | { type: "question"; qType: PreviewQuestionType; label: string };

// ─── Rail derivation ──────────────────────────────────────────────────────────

/**
 * Builds the ordered list of rail items from the template's contentTemplates.
 * Order: intro → info → question subtypes (if any questions variant exists) → summary.
 * Router kind is intentionally skipped (no visual preview).
 */
function buildRail(template: TemplateRow): RailItem[] {
  const items: RailItem[] = [];
  const variants = (
    (template.manifest as unknown as { contentTemplates?: ContentTemplate[] })
      .contentTemplates ?? []
  ) as ContentTemplate[];

  // 1. intro variants
  variants
    .filter((v) => v.kind === "intro")
    .forEach((v) =>
      items.push({
        type: "variant",
        kind: "intro",
        variantKey: v.key,
        label: v.label,
      }),
    );

  // 2. info variants
  variants
    .filter((v) => v.kind === "info")
    .forEach((v) =>
      items.push({
        type: "variant",
        kind: "info",
        variantKey: v.key,
        label: v.label,
      }),
    );

  // 3. question subtypes — only if template has at least one questions variant
  const hasQuestions = variants.some((v) => v.kind === "questions");
  if (hasQuestions) {
    (["single", "multiple", "ranking", "matching"] as PreviewQuestionType[]).forEach(
      (qType) =>
        items.push({ type: "question", qType, label: PREVIEW_QUESTION_TYPE_LABEL[qType] }),
    );
  }

  // 4. summary variants
  variants
    .filter((v) => v.kind === "summary")
    .forEach((v) =>
      items.push({
        type: "variant",
        kind: "summary",
        variantKey: v.key,
        label: v.label,
      }),
    );

  return items;
}

// ─── Shell style derivation ───────────────────────────────────────────────────

/**
 * Derives CSS custom properties for the preview shell from the design draft
 * params. Handles HSL shorthand strings (e.g. "217 91% 42%") by wrapping
 * them with `hsl(...)`.
 */
function buildShellStyle(params: Record<string, unknown>): React.CSSProperties {
  const v = (key: string): string | undefined =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;

  const asColor = (s: string | undefined): string | undefined => {
    if (!s) return undefined;
    if (s.startsWith("#") || s.startsWith("rgb") || s.startsWith("hsl")) return s;
    return `hsl(${s})`;
  };

  return {
    "--tpl-primary": asColor(v("primaryColor")) ?? asColor(v("brand.primaryColor")),
    "--tpl-fg": asColor(v("foregroundColor")) ?? asColor(v("brand.foregroundColor")),
    "--tpl-card": asColor(v("cardColor")) ?? asColor(v("brand.surfaceColor")),
    "--tpl-font": v("fontFamily") ?? v("brand.fontFamily"),
  } as React.CSSProperties;
}

// ─── Stage content renderers ──────────────────────────────────────────────────

/** Intro page demo content. */
function IntroDemo() {
  return (
    <>
      <h2>{PREVIEW_INTRO.title}</h2>
      <p className="lead">{PREVIEW_INTRO.subtitle}</p>
      <div className="tpl-preview-shell__hero">
        <ImageIcon className="h-7 w-7" aria-hidden="true" />
        {PREVIEW_INTRO.heroAlt}
      </div>
      <div className="tpl-preview-shell__actions">
        <Button variant="primary" size="m">
          Далее →
        </Button>
      </div>
    </>
  );
}

/** Info / learning material page demo content. */
function InfoDemo() {
  return (
    <>
      <h2>{PREVIEW_INFO.title}</h2>
      <p className="lead">{PREVIEW_INFO.body}</p>
      <div className="tpl-preview-shell__actions">
        <Button variant="primary" size="m">
          Далее →
        </Button>
      </div>
    </>
  );
}

/** Summary / result page demo content. */
function SummaryDemo() {
  return (
    <div className="tpl-preview-result">
      <h2>{PREVIEW_SUMMARY.title}</h2>
      <div className="tpl-preview-result__score">{PREVIEW_SUMMARY.scorePercent}%</div>
      <div className="tpl-preview-result__label">{PREVIEW_SUMMARY.scoreLabel}</div>
      <div className="tpl-preview-result__hint">{PREVIEW_SUMMARY.hint}</div>
    </div>
  );
}

/** Single-choice question demo. */
function SingleQuestionDemo() {
  const q = PREVIEW_QUESTIONS.single;
  return (
    <>
      <p className="tpl-preview-q__prompt">{q.prompt}</p>
      {(q.options ?? []).map((o, i) => (
        <div
          key={i}
          className={"tpl-preview-q__option" + (o.selected ? " is-selected" : "")}
        >
          <span className="tpl-preview-q__marker" />
          <span>{o.label}</span>
        </div>
      ))}
      <div
        className="tpl-preview-shell__actions"
        style={{ marginTop: "var(--ou-space-4)" }}
      >
        <Button variant="primary" size="m">
          Ответить
        </Button>
      </div>
    </>
  );
}

/** Multiple-choice question demo. */
function MultipleQuestionDemo() {
  const q = PREVIEW_QUESTIONS.multiple;
  return (
    <>
      <p className="tpl-preview-q__prompt">{q.prompt}</p>
      {(q.options ?? []).map((o, i) => (
        <div
          key={i}
          className={"tpl-preview-q__option" + (o.selected ? " is-selected" : "")}
        >
          <span className="tpl-preview-q__marker tpl-preview-q__marker--checkbox" />
          <span>{o.label}</span>
        </div>
      ))}
      <div
        className="tpl-preview-shell__actions"
        style={{ marginTop: "var(--ou-space-4)" }}
      >
        <Button variant="primary" size="m">
          Ответить
        </Button>
      </div>
    </>
  );
}

/** Ranking question demo. */
function RankingQuestionDemo() {
  const q = PREVIEW_QUESTIONS.ranking;
  return (
    <>
      <p className="tpl-preview-q__prompt">{q.prompt}</p>
      {(q.rankItems ?? []).map((item, i) => (
        <div
          key={i}
          className="tpl-preview-q__option"
          style={{ background: "var(--ou-bg-elevated)" }}
        >
          <span>{item}</span>
        </div>
      ))}
      <div
        className="tpl-preview-shell__actions"
        style={{ marginTop: "var(--ou-space-4)" }}
      >
        <Button variant="primary" size="m">
          Ответить
        </Button>
      </div>
    </>
  );
}

/** Matching question demo. */
function MatchingQuestionDemo() {
  const q = PREVIEW_QUESTIONS.matching;
  return (
    <>
      <p className="tpl-preview-q__prompt">{q.prompt}</p>
      {(q.pairs ?? []).map((p, i) => (
        <div key={i} className="tpl-preview-q__matching-row">
          <span>{p.left}</span>
          <span className="tpl-preview-q__matching-arrow" aria-hidden="true">
            →
          </span>
          <span>{p.right}</span>
        </div>
      ))}
      <div
        className="tpl-preview-shell__actions"
        style={{ marginTop: "var(--ou-space-4)" }}
      >
        <Button variant="primary" size="m">
          Ответить
        </Button>
      </div>
    </>
  );
}

/** Dispatches stage content based on the selected rail item. */
function renderContent(selected: RailItem | null): React.ReactNode {
  if (!selected) return null;
  if (selected.type === "variant") {
    if (selected.kind === "intro") return <IntroDemo />;
    if (selected.kind === "info") return <InfoDemo />;
    if (selected.kind === "summary") return <SummaryDemo />;
  }
  if (selected.type === "question") {
    if (selected.qType === "single") return <SingleQuestionDemo />;
    if (selected.qType === "multiple") return <MultipleQuestionDemo />;
    if (selected.qType === "ranking") return <RankingQuestionDemo />;
    if (selected.qType === "matching") return <MatchingQuestionDemo />;
  }
  return null;
}

// ─── Rail groups ──────────────────────────────────────────────────────────────

type GroupDef = {
  label: string;
  filter: (item: RailItem) => boolean;
};

const GROUPS: GroupDef[] = [
  {
    label: "Введение",
    filter: (item) => item.type === "variant" && item.kind === "intro",
  },
  {
    label: "Учебный материал",
    filter: (item) => item.type === "variant" && item.kind === "info",
  },
  {
    label: "Вопросы",
    filter: (item) => item.type === "question",
  },
  {
    label: "Итог",
    filter: (item) => item.type === "variant" && item.kind === "summary",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Modal dialog that previews all element types of a template inside a mocked
 * SCORM shell. Branded with the current design draft params via CSS variables.
 */
export function TemplatePreviewModal({
  open,
  onClose,
  template,
  params,
}: TemplatePreviewModalProps) {
  const railItems = template ? buildRail(template) : [];
  const [selected, setSelected] = useState<RailItem | null>(() => railItems[0] ?? null);

  // Reset selection when the active template changes.
  useEffect(() => {
    if (template) {
      const items = buildRail(template);
      setSelected(items[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  if (!template || railItems.length === 0) return null;

  const shellStyle = buildShellStyle(params);

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      className="tpl-preview-modal"
      title={`Шаблон «${template.manifest.name}» — элементы и их вид`}
      description="Демо-данные. Элементы управления работают, но прогресс не сохраняется."
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
          }}
        >
          <span
            style={{
              font: "var(--ou-text-body-s)",
              color: "var(--ou-fg-muted)",
            }}
          >
            {railItems.length} элементов · шаблон «{template.manifest.name}» v
            {template.version}
          </span>
          <Button
            variant="secondary"
            size="m"
            onClick={onClose}
            data-testid="design-template-preview-close"
          >
            Закрыть
          </Button>
        </div>
      }
    >
      {/* Wrapper carries data-testid because DS ModalDialog does not forward arbitrary HTML attributes. */}
      <div className="ou-modal__split" data-testid="design-template-preview-modal">
        <nav
          className="ou-modal__rail"
          aria-label="Элементы шаблона"
        >
          {GROUPS.map((group) => {
            const groupItems = railItems.filter(group.filter);
            if (groupItems.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="tpl-preview-group">{group.label}</div>
                {groupItems.map((item) => {
                  const key =
                    item.type === "variant" ? item.variantKey : item.qType;
                  const isActive =
                    selected !== null &&
                    (selected.type === "variant" && item.type === "variant"
                      ? selected.variantKey === item.variantKey
                      : selected.type === "question" && item.type === "question"
                        ? selected.qType === item.qType
                        : false);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={
                        "ou-modal__rail-item" + (isActive ? " is-active" : "")
                      }
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => setSelected(item)}
                      data-testid={`design-template-preview-rail-${key}`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="tpl-preview-stage">
          <div
            className="tpl-preview-shell"
            style={shellStyle}
            data-testid="design-template-preview-stage"
          >
            <header className="tpl-preview-shell__header">
              <div className="tpl-preview-shell__logo" />
              <span className="tpl-preview-shell__title">
                {PREVIEW_COURSE_CHROME.courseTitle}
              </span>
              <span className="tpl-preview-shell__page-indicator">
                {PREVIEW_COURSE_CHROME.topicTitle} ·{" "}
                {PREVIEW_COURSE_CHROME.pageIndicator}
              </span>
            </header>
            <div className="tpl-preview-shell__progress">
              <div
                className="tpl-preview-shell__progress-bar"
                style={{ width: PREVIEW_COURSE_CHROME.progressPercent + "%" }}
              />
            </div>
            <div className="tpl-preview-shell__body">
              <aside className="tpl-preview-shell__sidebar">
                <div className="tpl-preview-shell__sidebar-label">Темы</div>
                {PREVIEW_COURSE_CHROME.sidebarTopics.map((t) => (
                  <div
                    key={t.label}
                    className={
                      "tpl-preview-shell__sidebar-item" +
                      (t.active ? " is-active" : "")
                    }
                  >
                    {t.label}
                  </div>
                ))}
              </aside>
              <div className="tpl-preview-shell__content">
                {renderContent(selected)}
              </div>
            </div>
          </div>
          <div
            className="tpl-preview-caption"
            data-testid="design-template-preview-caption"
          >
            {selected ? selected.label : ""} · демо-данные · элементы управления
            работают
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
