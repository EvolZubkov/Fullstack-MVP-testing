/**
 * @module features/tests/editor/sections/variant-preview-picker
 * @description Variant picker for the «Структура» tab that shows a LIVE page
 * preview beside the list (replaces the text-only list). The author sees what the
 * variant looks like before adding / switching, rendered through the SAME unified
 * renderer the runtime and «Шаблоны» use ({@link TemplateScreen} → `renderScreenInto`)
 * against the in-progress «Оформление» draft — no second preview engine.
 *
 * Layout: the option list on the left, one live preview panel on the right that
 * updates as the author selects a variant (the «Список + панель превью» design).
 * The preview spec is built from the template BUNDLE ({@link useTemplateBundle}):
 * content variants reuse the demo-populated `buildScreenInputs` spec (matched by
 * `variantKey`/route), other kinds fall back to a live `buildContentPageScreen`
 * render of the variant's own layout.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Banner } from "@universityrt/ui-kit";
import { TemplateScreen } from "@/components/template-screen";
import {
  buildContentPageScreen,
  buildScreenInputs,
  type PreviewDemoDataset,
  type ScreenSpec,
} from "@shared/template/preview-context";
import { buildTemplateCssVars } from "@shared/template/params-css";
import { startImageForVariant, type StartVariantDecl } from "@shared/template/start-image";
import { useTemplateBundle, type TemplateBundle } from "./use-template-bundle";

/** One selectable variant (list row + the keys needed to build its preview spec). */
export interface VariantOption {
  key: string;
  label: string;
  description?: string;
  /** PRD-7 S13.6: mark the current variant (disabled + «Текущий» chip). */
  isCurrent?: boolean;
  /** manifest variant key — the bridge to its preview spec (absent ⇒ no preview, e.g. «Произвольный HTML»). */
  variantKey?: string;
  /** Variant kind (start / info / …) — helps resolve a system-screen preview route. */
  kind?: string;
  /** Preview route the variant renders under (e.g. `content.info`) — buildContentPageScreen fallback. */
  pageKind?: string;
}

// ─── The plain option list (left column) ────────────────────────────────────────

/** The option list — same markup/roles as before, now the left pane of the picker. */
export function VariantList(props: {
  options: VariantOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  testIdPrefix: string;
}) {
  return (
    <ul className="variant-list" role="listbox" aria-label="Варианты страниц">
      {props.options.map((o) => {
        const selected = o.key === props.selectedKey;
        const cls =
          "variant-list__item" + (selected ? " is-selected" : "") + (o.isCurrent ? " is-current" : "");
        return (
          <li
            key={o.key}
            className={cls}
            role="option"
            aria-selected={selected ? "true" : "false"}
            aria-disabled={o.isCurrent ? "true" : undefined}
            tabIndex={o.isCurrent ? -1 : 0}
            onClick={o.isCurrent ? undefined : () => props.onSelect(o.key)}
            onKeyDown={(e) => {
              if (o.isCurrent) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                props.onSelect(o.key);
              }
            }}
            data-testid={`${props.testIdPrefix}-${o.key}`}
          >
            <div>
              <div className="variant-list__name">{o.label}</div>
              {o.description && <div className="variant-list__desc">{o.description}</div>}
              {o.isCurrent && (
                <div className="variant-list__meta">
                  <span className="variant-list__meta-tag variant-list__meta-tag--current">Текущий</span>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Preview-spec builder ───────────────────────────────────────────────────────

/**
 * Resolve the ScreenSpec that previews `option`'s variant, from the template bundle.
 * Content variants are matched in the demo-populated `buildScreenInputs` output (by
 * `variantKey`, or by route for system screens whose route equals the variant key /
 * kind); anything else falls back to a live `buildContentPageScreen` render of the
 * variant's own layout with empty values. Returns null when no preview is possible
 * (e.g. the «Произвольный HTML» option, which has no variant).
 */
function buildVariantSpec(bundle: TemplateBundle | undefined, option: VariantOption | null): ScreenSpec | null {
  if (!bundle?.manifest || !bundle.layouts || !option?.variantKey) return null;
  // A malformed / partially-loaded bundle must degrade to «no preview», never crash
  // the picker — the spec builders assume a well-formed manifest.
  try {
    const demo: PreviewDemoDataset | undefined = bundle.demo ?? undefined;
    const specs = demo ? buildScreenInputs(demo, bundle.manifest) : [];
    // Content variants carry the variant key directly.
    const byVariant = specs.find((s) => s.variantKey === option.variantKey);
    if (byVariant) return byVariant;
    // System screens are keyed by route: a variant route equals its key
    // (e.g. `start.image-right`) or the kind's canonical route (`start` / `results` / …).
    const byRoute =
      specs.find((s) => s.route === option.variantKey) ||
      (option.kind ? specs.find((s) => s.route === option.kind) : undefined);
    if (byRoute) return byRoute;
    // Last resort: render the variant's own layout live from empty values.
    return buildContentPageScreen({
      manifest: bundle.manifest,
      route: option.pageKind || `content.${option.kind || "info"}`,
      templateKey: option.variantKey,
      values: {},
      settings: null,
      courseTitle: (demo?.course?.title as string | undefined) ?? "",
    });
  } catch {
    return null;
  }
}

// ─── Design-media helpers ───────────────────────────────────────────────────────

/** Unwrap a media design param to a plain URL (media envelope `{url}` or bare string). */
function mediaUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string") {
    return (value as { url: string }).url || undefined;
  }
  return undefined;
}

/**
 * The `design.*` context the start layouts bind (`logoUrl` / `startImageUrl`),
 * unwrapped from the draft branding params — so the start preview (incl. the
 * «Изображение справа» variant) shows the picked illustration, not just the
 * placeholder. Mirrors both hosts' `resolveMediaUrl`.
 */
function previewDesign(
  params: Record<string, unknown>,
  variant: StartVariantDecl | null | undefined,
  pageSettings?: Record<string, unknown> | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  const logo = mediaUrl(params.logoUrl);
  if (logo) out.logoUrl = logo;
  // PRD-22: the page's illustration belongs to the variant that DECLARES it, so a
  // variant without the property is previewed without it — otherwise «Старт:
  // стандартный» rendered the same screen as «изображение справа» and switching
  // options looked like the preview had stopped repainting.
  const startImage = startImageForVariant(variant, pageSettings, params);
  if (startImage) out.startImageUrl = startImage;
  return out;
}

// ─── Proportional fit-to-box scaler ────────────────────────────────────────────

/** Reference canvas the preview renders at (a desktop-ish 16:10) — fixed so the
 *  scene has a definite size to lay out against and the aspect never changes. */
const PREVIEW_REF_W = 1180;
const PREVIEW_REF_H = 740;

/**
 * Renders `children` at a FIXED reference size and scales the whole frame UNIFORMLY
 * (`transform: scale`) to fit its box — proportionally, no scroll, aspect preserved.
 * The box has a fixed size (set by CSS), so switching variants never resizes the modal.
 */
function ScaledPreview({ children }: { children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const recompute = () => {
      const bw = box.clientWidth;
      const bh = box.clientHeight;
      if (bw > 0 && bh > 0) {
        setScale(Math.min(bw / PREVIEW_REF_W, bh / PREVIEW_REF_H, 1));
      }
    };
    const ro = new ResizeObserver(recompute);
    ro.observe(box);
    recompute();
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} className="variant-picker__box">
      <div
        className="variant-picker__frame"
        style={{ width: PREVIEW_REF_W, height: PREVIEW_REF_H, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── The picker (list + live preview) ───────────────────────────────────────────

export function VariantPreviewPicker(props: {
  options: VariantOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  testIdPrefix: string;
  /** Draft «Оформление» template id — the preview renders against the in-progress template. */
  templateId: string | undefined;
  /** Draft branding params, applied as CSS variables (same mapping as the runtime). */
  params: Record<string, unknown>;
  /**
   * PRD-22: page PROPERTIES of the page being re-varianted (`settings_json`). The
   * start illustration lives here, so the preview of «Старт: изображение справа»
   * shows the author's own picture instead of the test-wide branding one.
   */
  pageSettings?: Record<string, unknown> | null;
  /** Only fetch the bundle while the host modal is open. */
  open: boolean;
}) {
  const bundleQuery = useTemplateBundle(props.templateId, props.open);
  const bundle = bundleQuery.data;
  const cssVars = useMemo(
    () => buildTemplateCssVars(props.params, bundle?.manifest.params),
    [props.params, bundle],
  );
  const selected = props.options.find((o) => o.key === props.selectedKey) ?? null;
  const spec = useMemo(() => {
    const s = buildVariantSpec(bundle, selected);
    // Start variants bind `design.startImageUrl` — inject it from the draft params
    // so the «Изображение справа» preview shows the picked image, not a placeholder.
    if (s && (selected?.kind === "start" || s.route === "start" || s.route.startsWith("start."))) {
      const declaration = (bundle?.manifest.contentTemplates ?? []).find(
        (ct) => ct.key === selected?.variantKey,
      ) as StartVariantDecl | undefined;
      const design = previewDesign(props.params, declaration, props.pageSettings);
      return { ...s, input: { ...s.input, context: { ...(s.input?.context ?? {}), design } } };
    }
    return s;
  }, [bundle, selected, props.params, props.pageSettings]);
  const layout = spec?.input && bundle ? bundle.layouts[spec.layoutKey] : undefined;

  return (
    <div className="variant-picker" data-testid={`${props.testIdPrefix}-picker`}>
      <div className="variant-picker__list">
        <VariantList
          options={props.options}
          selectedKey={props.selectedKey}
          onSelect={props.onSelect}
          testIdPrefix={props.testIdPrefix}
        />
      </div>
      <div className="variant-picker__preview" data-testid={`${props.testIdPrefix}-preview`}>
        {bundleQuery.isLoading && <p className="tpl-upload-hint">Загружаем шаблон…</p>}
        {bundleQuery.error && (
          <Banner
            tone="error"
            title="Не удалось загрузить шаблон"
            description={(bundleQuery.error as Error).message}
          />
        )}
        {bundle && spec?.input && layout != null ? (
          <ScaledPreview>
            <TemplateScreen
              layout={layout}
              context={spec.input.context}
              slots={spec.input.slots}
              content={spec.input.content}
              css={bundle.css}
              cssVars={cssVars}
              shell={(bundle.manifest as { mountShell?: boolean }).mountShell ? bundle.layouts.shell : undefined}
            />
          </ScaledPreview>
        ) : (
          bundle &&
          !bundleQuery.isLoading && (
            <div className="variant-picker__empty" data-testid={`${props.testIdPrefix}-preview-empty`}>
              Предпросмотр для этого варианта недоступен
            </div>
          )
        )}
      </div>
    </div>
  );
}
