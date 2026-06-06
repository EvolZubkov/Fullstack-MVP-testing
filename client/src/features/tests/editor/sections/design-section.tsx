/**
 * @module features/tests/editor/sections/design-section
 * @description Editor section for the «Оформление» tab (PRD-7 wireframe
 * `prd7-design-tab.html`).
 *
 * MVP scope:
 *   - Шаблон pane: shows the current template card (name + version + builtin
 *     tag + description) loaded from `/api/templates/:id`. «Заменить шаблон»
 *     is left as a placeholder (full gallery deferred to FR-30/31). «Сбросить
 *     до умолчаний» clears all params in the draft and persists empty params
 *     on save.
 *   - Брендирование pane: renders params with `section === "branding"` (or
 *     without explicit section — fallback to branding). Supports `text`,
 *     `color`, `boolean`, `select`. Other types render a read-only placeholder
 *     row — full media-library + colorpicker integration is deferred.
 *   - Макет pane: renders params with `section === "layout"`.
 *   - Прогресс и шапка pane: renders params with `section === "progress"`.
 *   - Each section shows an informational Banner when the template declares no
 *     params for that section.
 *
 * Save flow:
 *   - Design has its own endpoint (`PUT /api/tests/:id/design`) separate from
 *     the main editor save. A pane-local «Сохранить оформление» button drives
 *     the mutation; the Drawer footer's primary save stays bound to the test
 *     settings as in the rest of the editor.
 */
import { useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  Eye,
  ExternalLink,
  Image as ImageIcon,
  Layout,
  Paperclip,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Banner,
  Button,
  ColorPicker,
  Combobox,
  IconButton,
  Input,
  NumberInput,
  Select,
  Switch,
  Tag,
} from "@universityrt/ui-kit";
import {
  useDesignSettings,
  type MediaParamValue,
  type ParamSection,
  type TemplateParam,
  type UseDesignSettingsResult,
} from "../use-design-settings";
import { fromHex, toHex } from "./color-format";
import { TemplatePreviewModal } from "./template-preview-modal";
import { TemplateGalleryModal } from "./template-gallery-modal";

// ─── Public API ───────────────────────────────────────────────────────────────

export type DesignSectionProps = {
  /** Test id is required to fetch design settings; `undefined` in create mode. */
  testId: string | undefined;
  /**
   * Optional pre-hoisted design hook instance. When provided, the section
   * does NOT call `useDesignSettings` internally — caller owns the lifecycle.
   * This lets the editor's drawer footer drive design save as part of the
   * unified «Сохранить» flow (per wireframe prd7-design-tab.html — single
   * footer save, no per-pane save button).
   */
  design?: UseDesignSettingsResult;
};

type DesignRailKey = "template" | "branding" | "layout" | "progress";

const RAIL_ITEMS: { key: DesignRailKey; label: string }[] = [
  { key: "template", label: "Шаблон" },
  { key: "branding", label: "Брендирование" },
  { key: "layout", label: "Макет" },
  { key: "progress", label: "Прогресс и шапка" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function DesignSection({ testId, design: designProp }: DesignSectionProps) {
  const [active, setActive] = useState<DesignRailKey>("template");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // Fallback hook usage kept so the section still works as a standalone unit
  // (e.g., in component tests) when the parent hasn't hoisted the hook.
  const fallback = useDesignSettings(designProp ? undefined : testId);
  const design = designProp ?? fallback;

  // PRD-7 S12-G6: when the persisted templateId is unresolvable (404), force
  // the rail back to «Шаблон» (where the incompatible banner lives) and
  // disable branding / layout / progress — those panes have nothing to bind
  // to without a template manifest.
  const effectiveActive: DesignRailKey = design.templateMissing ? "template" : active;
  const isRailDisabled = (key: DesignRailKey): boolean =>
    design.templateMissing && key !== "template";

  return (
    <>
      <div className="ou-drawer__split" data-testid="design-split">
        <nav className="ou-drawer__rail" aria-label="Подразделы оформления">
          {RAIL_ITEMS.map((item) => {
            const disabled = isRailDisabled(item.key);
            const showError = item.key === "template" && design.templateMissing;
            return (
              <button
                key={item.key}
                type="button"
                className={
                  "ou-drawer__rail-item" +
                  (effectiveActive === item.key ? " is-active" : "")
                }
                aria-current={effectiveActive === item.key ? "page" : undefined}
                aria-disabled={disabled ? "true" : undefined}
                disabled={disabled}
                onClick={disabled ? undefined : () => setActive(item.key)}
                data-testid={`design-rail-${item.key}`}
              >
                {item.label}
                {showError && (
                  <span
                    className="status-dot error"
                    aria-label="Шаблон недоступен"
                    data-testid="design-rail-template-error-dot"
                  />
                )}
              </button>
            );
          })}
        </nav>
        <div className="tb-settings-content" data-testid={`design-pane-${effectiveActive}`}>
          {testId === undefined ? (
            <CreateModeNotice />
          ) : design.isLoading ? (
            <LoadingNotice />
          ) : design.templateMissing ? (
            <TemplateIncompatibleBanner
              missingId={design.draft.templateId}
              onApplyDefault={design.applyDefaultTemplate}
              onOpenGallery={() => setGalleryOpen(true)}
            />
          ) : design.error ? (
            <ErrorNotice message={design.error.message} />
          ) : effectiveActive === "template" ? (
            <TemplatePane
              design={design}
              onPreview={() => setPreviewOpen(true)}
              onOpenGallery={() => setGalleryOpen(true)}
            />
          ) : effectiveActive === "branding" ? (
            <SectionPane
              design={design}
              section="branding"
              emptyTitle="В шаблоне нет настраиваемых параметров оформления"
              emptyDesc={`У выбранного шаблона «${design.template?.manifest.name ?? ""}» в секции «Брендирование» не объявлено ни одного параметра.`}
              testId="design-branding-pane"
            />
          ) : effectiveActive === "layout" ? (
            <SectionPane
              design={design}
              section="layout"
              emptyTitle="В шаблоне нет настроек макета"
              emptyDesc={`У выбранного шаблона «${design.template?.manifest.name ?? ""}» в секции «Макет» не объявлено ни одного параметра. Шаблон поддерживает только встроенный макет.`}
              testId="design-layout-pane"
            />
          ) : (
            <SectionPane
              design={design}
              section="progress"
              emptyTitle="В шаблоне нет настроек прогресса"
              emptyDesc={`У выбранного шаблона «${design.template?.manifest.name ?? ""}» в секции «Прогресс и шапка» не объявлено ни одного параметра.`}
              testId="design-progress-pane"
            />
          )}
        </div>
      </div>
      <TemplatePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        template={design.template}
        params={design.draft.params ?? {}}
      />
      <TemplateGalleryModal
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        currentTemplateId={design.draft.templateId}
        hasDirtyParams={
          design.draft.params !== undefined &&
          Object.keys(design.draft.params).length > 0
        }
        onApply={(id) => design.setTemplate(id)}
      />
    </>
  );
}

// ─── Sub-panes ────────────────────────────────────────────────────────────────

function CreateModeNotice() {
  return (
    <Banner
      tone="info"
      title="Сначала сохраните черновик"
      description="Настройки оформления привязаны к существующему тесту. Заполните обязательные поля во вкладке «Настройки», сохраните черновик — после этого вкладка «Оформление» станет доступна для редактирования."
      data-testid="design-create-notice"
    />
  );
}

function LoadingNotice() {
  return (
    <Banner
      tone="info"
      title="Загружаем настройки оформления…"
      data-testid="design-loading"
    />
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <Banner
      tone="error"
      title="Не удалось загрузить оформление"
      description={message}
      data-testid="design-error"
    />
  );
}

/**
 * PRD-7 S12-G6 / wf-template-incompatible: the persisted templateId no longer
 * resolves to an active template (deleted, renamed, API-version bumped).
 * Replaces the template card with an error Banner offering two recovery
 * actions: open the gallery (deferred until S12-G3 lands) or apply «default».
 */
function TemplateIncompatibleBanner(props: {
  missingId: string;
  onOpenGallery: () => void;
  onApplyDefault: () => void;
}) {
  return (
    <Banner
      tone="error"
      icon={<AlertTriangle width={16} height={16} aria-hidden="true" />}
      title="Шаблон недоступен"
      description={
        <>
          Сохранённый шаблон «<strong>{props.missingId}</strong>» больше не
          поддерживается. Выберите другой шаблон или примените шаблон по
          умолчанию, чтобы продолжить редактирование оформления.
        </>
      }
      actions={[
        {
          label: "Выбрать шаблон",
          onClick: props.onOpenGallery,
        },
        {
          label: "Применить «Стандартный»",
          onClick: props.onApplyDefault,
        },
      ]}
      data-testid="design-template-incompatible"
    />
  );
}

function TemplatePane({
  design,
  onPreview,
  onOpenGallery,
}: {
  design: UseDesignSettingsResult;
  onPreview: () => void;
  /** PRD-7 S12-G3 / FR-33: opens the TemplateGalleryModal. */
  onOpenGallery: () => void;
}) {
  const tpl = design.template;
  if (!tpl) return null;
  return (
    <div data-testid="design-template-pane">
      <div className="tpl-block" data-testid="design-template-card">
        <button
          type="button"
          className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s tpl-preview-btn"
          aria-label="Предпросмотр шаблона"
          disabled={design.template === null}
          onClick={onPreview}
          data-testid="design-template-preview"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="tpl-thumb">
          <div className="preview-sketch" data-wf-demo>
            <div className="ps-header">
              <div className="ps-logo" />
              <div className="ps-title">
                {(tpl.manifest.name ?? tpl.name).slice(0, 3).toUpperCase()}
              </div>
            </div>
            <div className="ps-progress">
              <div className="ps-progress-bar" />
            </div>
            <div className="ps-body">
              <div className="ps-sidebar">
                <div className="ps-nav-item active" />
                <div className="ps-nav-item" />
                <div className="ps-nav-item" />
              </div>
              <div className="ps-content">
                <div className="ps-q">Вопрос…</div>
                <div className="ps-opt sel" />
                <div className="ps-opt" />
                <div className="ps-opt" />
              </div>
            </div>
          </div>
        </div>
        <div className="tpl-info">
          <div className="tpl-info__head">
            <div className="tpl-name" data-testid="design-template-name">
              {tpl.manifest.name ?? tpl.name}
            </div>
            {tpl.isBuiltin && (
              <Tag
                tone="neutral"
                variant="outline"
                data-testid="design-template-builtin"
              >
                Встроенный
              </Tag>
            )}
            <Tag
              tone="info"
              variant="outline"
              data-testid="design-template-version"
            >
              v{tpl.manifest.version ?? tpl.version}
            </Tag>
          </div>
          <div className="tpl-desc" data-testid="design-template-desc">
            {tpl.manifest.description ?? tpl.description ?? "Описание не указано."}
          </div>
          <div className="tpl-actions">
            <Button
              variant="secondary"
              size="s"
              leadingIcon={<Layout className="h-3 w-3" aria-hidden="true" />}
              data-testid="design-template-replace"
              onClick={onOpenGallery}
            >
              Заменить шаблон
            </Button>
            <Button
              variant="ghost"
              size="s"
              data-testid="design-template-reset"
              onClick={design.resetToDefaults}
            >
              Сбросить до умолчаний
            </Button>
          </div>
        </div>
      </div>
      <DesignSaveError design={design} />
    </div>
  );
}

/**
 * Returns params belonging to the given section. Params without an explicit
 * `section` field fall back to `"branding"` by convention.
 */
function paramsBySection(
  params: TemplateParam[] | undefined,
  section: ParamSection,
): TemplateParam[] {
  return (params ?? []).filter(
    (p) => (p.section ?? "branding") === section,
  );
}

/**
 * Generic pane that renders template params for a given `ParamSection`.
 * When no params are declared for the section an informational Banner is shown.
 */
function SectionPane({
  design,
  section,
  emptyTitle,
  emptyDesc,
  testId,
}: {
  design: UseDesignSettingsResult;
  section: ParamSection;
  emptyTitle: string;
  emptyDesc: string;
  testId: string;
}) {
  const tpl = design.template;
  if (!tpl) return null;
  const params = paramsBySection(tpl.manifest.params, section);
  if (params.length === 0) {
    return (
      <div data-testid={testId}>
        <Banner
          tone="info"
          title={emptyTitle}
          description={emptyDesc}
          data-testid={`${testId}-empty`}
        />
        <DesignSaveError design={design} />
      </div>
    );
  }
  return (
    <div data-testid={testId}>
      {params.map((p) => (
        <ParamRow
          key={p.key}
          param={p}
          value={design.draft.params?.[p.key]}
          onChange={(v) => design.setParam(p.key, v)}
        />
      ))}
      <DesignSaveError design={design} />
    </div>
  );
}

function ParamRow({
  param,
  value,
  onChange,
}: {
  param: TemplateParam;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const fieldId = `design-param-${param.key}`;
  if (param.type === "text") {
    const v = typeof value === "string" ? value : "";
    return (
      <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
        <Input
          id={fieldId}
          size="m"
          fullWidth
          label={param.label}
          value={v}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`design-param-input-${param.key}`}
        />
      </div>
    );
  }
  if (param.type === "color") {
    const stored =
      typeof value === "string" && value
        ? value
        : (param.default as string | undefined) ?? "";
    const hexValue = toHex(stored, "#000000");
    return (
      <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
        <label
          className="ou-formfield__lbl"
          htmlFor={fieldId}
          id={`${fieldId}-label`}
        >
          {param.label}
        </label>
        <ColorPicker
          id={fieldId}
          value={hexValue}
          aria-labelledby={`${fieldId}-label`}
          onChange={(hex) => onChange(fromHex(hex, stored))}
          data-testid={`design-param-input-${param.key}`}
        />
      </div>
    );
  }
  if (param.type === "boolean") {
    const v = typeof value === "boolean" ? value : Boolean(param.default ?? false);
    return (
      <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
        <Switch
          id={fieldId}
          label={param.label}
          checked={v}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={`design-param-input-${param.key}`}
        />
      </div>
    );
  }
  if (param.type === "select") {
    const opts = param.options ?? [];
    const v = typeof value === "string" ? value : (param.default as string) ?? opts[0] ?? "";
    return (
      <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
        <Select<string>
          id={fieldId}
          size="m"
          fullWidth
          label={param.label}
          value={v}
          options={opts.map((o) => ({ value: o, label: param.optionLabels?.[o] ?? o }))}
          onChange={(next) => onChange(next)}
          data-testid={`design-param-input-${param.key}`}
        />
      </div>
    );
  }
  if (param.type === "number") {
    const v =
      typeof value === "number"
        ? value
        : typeof param.default === "number"
          ? param.default
          : 0;
    return (
      <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
        <NumberInput
          id={fieldId}
          size="m"
          label={param.label}
          value={v}
          min={param.min}
          max={param.max}
          step={param.step}
          onChange={(next) => onChange(next)}
          data-testid={`design-param-input-${param.key}`}
        />
      </div>
    );
  }
  if (param.type === "url") {
    const v = typeof value === "string" ? value : (param.default as string) ?? "";
    return (
      <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
        <Input
          id={fieldId}
          type="url"
          size="m"
          fullWidth
          label={param.label}
          placeholder="https://…"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`design-param-input-${param.key}`}
          suffix={
            v && /^https?:\/\//i.test(v) ? (
              <IconButton
                icon={<ExternalLink width={14} height={14} aria-hidden="true" />}
                aria-label={`Открыть ${v} в новой вкладке`}
                variant="ghost"
                size="s"
                onClick={() => window.open(v, "_blank", "noopener,noreferrer")}
                data-testid={`design-param-input-${param.key}-open`}
              />
            ) : undefined
          }
        />
      </div>
    );
  }
  if (param.type === "multiselect") {
    const opts = param.options ?? [];
    const arr = Array.isArray(value)
      ? (value as string[])
      : Array.isArray(param.default)
        ? ((param.default as unknown[]).filter((x) => typeof x === "string") as string[])
        : [];
    return (
      <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
        <Combobox<string>
          id={fieldId}
          size="m"
          fullWidth
          multiple
          label={param.label}
          values={arr}
          options={opts.map((o) => ({ value: o, label: param.optionLabels?.[o] ?? o }))}
          onValuesChange={(next) => onChange(next)}
          data-testid={`design-param-input-${param.key}`}
        />
      </div>
    );
  }
  if (
    param.type === "image" ||
    param.type === "asset" ||
    param.type === "file" ||
    param.type === "downloadLink"
  ) {
    return (
      <MediaParamRow
        param={param}
        value={value}
        onChange={onChange}
        fieldId={fieldId}
      />
    );
  }
  return (
    <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
      <label className="ou-formfield__lbl">{param.label}</label>
      <Banner
        tone="info"
        size="sm"
        description={`Тип «${param.type}» не поддерживается этой версией редактора.`}
        data-testid={`design-param-unsupported-${param.key}`}
      />
    </div>
  );
}

/**
 * PRD-7 S12-G4: shared row for media-typed params (image / asset / file /
 * downloadLink). Reads/writes the {@link MediaParamValue} envelope. Upload
 * goes through `POST /api/media/upload` (multer disk storage) which returns
 * `{ url, mime, originalName, size }`. The hidden file input is triggered by
 * a DS Button; the chosen file's name is shown as a chip with a remove (×)
 * action.
 */
function MediaParamRow({
  param,
  value,
  onChange,
  fieldId,
}: {
  param: TemplateParam;
  value: unknown;
  onChange: (v: unknown) => void;
  fieldId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored: MediaParamValue | null =
    value && typeof value === "object" && (value as MediaParamValue).url
      ? (value as MediaParamValue)
      : null;

  const acceptDefault =
    param.type === "image"
      ? "image/png,image/jpeg,image/svg+xml,image/webp"
      : undefined;
  const accept = param.accept ?? acceptDefault;
  const maxSizeKb = param.maxSizeKb ?? (param.type === "image" ? 512 : 5 * 1024);

  const buttonLabel: Record<typeof param.type, string> = {
    image: stored ? "Заменить изображение" : "Загрузить изображение",
    asset: stored ? "Заменить файл" : "Выбрать из медиатеки",
    file: stored ? "Заменить файл" : "Загрузить файл",
    downloadLink: stored ? "Заменить файл" : "Добавить файл",
    // The four-key record covers the only types this component handles.
    text: "",
    color: "",
    boolean: "",
    select: "",
    multiselect: "",
    number: "",
    url: "",
  };

  const Icon =
    param.type === "image"
      ? ImageIcon
      : param.type === "downloadLink"
        ? Download
        : Paperclip;

  async function handleFile(file: File) {
    setError(null);
    if (file.size > maxSizeKb * 1024) {
      setError(
        `Файл превышает ${maxSizeKb < 1024 ? `${maxSizeKb} КБ` : `${Math.round(maxSizeKb / 1024)} МБ`}.`,
      );
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      const res = await fetch("/api/media/upload", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        url: string;
        mime: string;
        originalName: string;
        size: number;
      };
      const next: MediaParamValue = {
        url: body.url,
        name: body.originalName,
        mime: body.mime,
        size: body.size,
      };
      onChange(next);
    } catch (err) {
      setError((err as Error)?.message ?? "Не удалось загрузить файл");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
      <label className="ou-formfield__lbl" htmlFor={fieldId}>
        {param.label}
      </label>
      <div className="design-media-row">
        <Button
          id={fieldId}
          variant="secondary"
          size="s"
          leadingIcon={<Upload width={12} height={12} aria-hidden="true" />}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          loading={uploading}
          data-testid={`design-param-input-${param.key}`}
        >
          {uploading ? "Загрузка…" : buttonLabel[param.type]}
        </Button>
        {stored && (
          <span
            className="design-media-chip"
            data-testid={`design-param-chip-${param.key}`}
          >
            <Icon className="design-media-chip__ico" width={14} height={14} aria-hidden="true" />
            <span className="design-media-chip__name">{stored.name}</span>
            <IconButton
              icon={<X width={12} height={12} aria-hidden="true" />}
              aria-label={`Удалить файл ${stored.name}`}
              variant="ghost"
              size="s"
              onClick={() => onChange(null)}
              data-testid={`design-param-chip-${param.key}-remove`}
            />
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: "none" }}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
          data-testid={`design-param-input-${param.key}-file`}
        />
      </div>
      {param.type === "image" && (
        <div className="ou-formfield__desc">
          PNG, JPEG, SVG или WebP; до {maxSizeKb < 1024 ? `${maxSizeKb} КБ` : `${Math.round(maxSizeKb / 1024)} МБ`}.
        </div>
      )}
      {param.type === "downloadLink" && (
        <div className="ou-formfield__desc">
          Файл будет доступен обучающемуся по ссылке после прохождения.
        </div>
      )}
      {error && (
        <Banner
          tone="error"
          size="sm"
          description={error}
          data-testid={`design-param-error-${param.key}`}
        />
      )}
    </div>
  );
}

/**
 * Inline-only error display for design save failures. The action controls
 * (Save / Revert) live in the shared drawer footer per wireframe — there
 * is no per-pane save button. We only surface the error so the user can
 * see why the unified save failed.
 */
function DesignSaveError({ design }: { design: UseDesignSettingsResult }) {
  if (!design.saveError) return null;
  return (
    <Banner
      tone="error"
      description={design.saveError.message}
      data-testid="design-save-error"
    />
  );
}
