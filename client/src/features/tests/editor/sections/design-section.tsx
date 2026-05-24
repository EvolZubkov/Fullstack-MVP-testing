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
 *   - Брендирование pane: renders a dynamic form keyed by the template's
 *     `manifest.params`. Supports `text`, `color`, `boolean`, `select`. Other
 *     types (image / asset / number) render a read-only placeholder row —
 *     full media-library + colorpicker integration is deferred.
 *   - Макет / Прогресс и шапка panes: still show «следующий шаг» stubs.
 *
 * Save flow:
 *   - Design has its own endpoint (`PUT /api/tests/:id/design`) separate from
 *     the main editor save. A pane-local «Сохранить оформление» button drives
 *     the mutation; the Drawer footer's primary save stays bound to the test
 *     settings as in the rest of the editor.
 */
import { useState } from "react";
import { useDesignSettings, type TemplateParam, type TemplateRow } from "../use-design-settings";

// ─── Public API ───────────────────────────────────────────────────────────────

export type DesignSectionProps = {
  /** Test id is required to fetch design settings; `undefined` in create mode. */
  testId: string | undefined;
};

type DesignRailKey = "template" | "branding" | "layout" | "progress";

const RAIL_ITEMS: { key: DesignRailKey; label: string }[] = [
  { key: "template", label: "Шаблон" },
  { key: "branding", label: "Брендирование" },
  { key: "layout", label: "Макет" },
  { key: "progress", label: "Прогресс и шапка" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function DesignSection({ testId }: DesignSectionProps) {
  const [active, setActive] = useState<DesignRailKey>("template");
  const design = useDesignSettings(testId);

  return (
    <div className="ou-drawer__split" data-testid="design-split">
      <nav className="ou-drawer__rail" aria-label="Подразделы оформления">
        {RAIL_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={
              "ou-drawer__rail-item" + (active === item.key ? " is-active" : "")
            }
            aria-current={active === item.key ? "page" : undefined}
            onClick={() => setActive(item.key)}
            data-testid={`design-rail-${item.key}`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="tb-settings-content" data-testid={`design-pane-${active}`}>
        {testId === undefined ? (
          <CreateModeNotice />
        ) : design.isLoading ? (
          <LoadingNotice />
        ) : design.error ? (
          <ErrorNotice message={design.error.message} />
        ) : active === "template" ? (
          <TemplatePane design={design} />
        ) : active === "branding" ? (
          <BrandingPane design={design} />
        ) : (
          <StubPane railKey={active} />
        )}
      </div>
    </div>
  );
}

// ─── Sub-panes ────────────────────────────────────────────────────────────────

function CreateModeNotice() {
  return (
    <div
      className="ou-banner ou-banner--info"
      role="status"
      data-testid="design-create-notice"
    >
      <div className="ou-banner__body">
        <div className="ou-banner__title">Сначала сохраните черновик</div>
        <div className="ou-banner__desc">
          Настройки оформления привязаны к существующему тесту. Заполните
          обязательные поля во вкладке «Настройки», сохраните черновик — после
          этого вкладка «Оформление» станет доступна для редактирования.
        </div>
      </div>
    </div>
  );
}

function LoadingNotice() {
  return (
    <div
      className="ou-banner ou-banner--info"
      role="status"
      data-testid="design-loading"
    >
      <div className="ou-banner__body">
        <div className="ou-banner__title">Загружаем настройки оформления…</div>
      </div>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      className="ou-banner ou-banner--error"
      role="alert"
      data-testid="design-error"
    >
      <div className="ou-banner__body">
        <div className="ou-banner__title">Не удалось загрузить оформление</div>
        <div className="ou-banner__desc">{message}</div>
      </div>
    </div>
  );
}

function TemplatePane({ design }: { design: ReturnType<typeof useDesignSettings> }) {
  const tpl = design.template;
  if (!tpl) return null;
  return (
    <div data-testid="design-template-pane">
      <section className="ou-card ou-card--outlined" data-testid="design-template-card">
        <header className="ou-card__header">
          <div className="ou-card__heading">
            <h3 className="ou-card__title" data-testid="design-template-name">
              {tpl.manifest.name ?? tpl.name}
            </h3>
            <p className="ou-card__subtitle">
              {tpl.isBuiltin && (
                <span
                  className="ou-tag ou-tag--neutral ou-tag--outline"
                  data-testid="design-template-builtin"
                >
                  Встроенный
                </span>
              )}{" "}
              <span
                className="ou-tag ou-tag--info ou-tag--outline"
                data-testid="design-template-version"
              >
                v{tpl.manifest.version ?? tpl.version}
              </span>
            </p>
          </div>
        </header>
        <div className="ou-card__body">
          <p
            className="tb-template-card__desc"
            data-testid="design-template-desc"
          >
            {tpl.manifest.description ?? tpl.description ?? "Описание не указано."}
          </p>
          <div className="tb-template-card__actions">
            <button
              type="button"
              className="ou-btn ou-btn--secondary ou-btn--s"
              data-testid="design-template-replace"
              onClick={() =>
                window.alert(
                  "Галерея шаблонов будет доступна в следующем шаге (FR-30/31).",
                )
              }
            >
              Заменить шаблон
            </button>
            <button
              type="button"
              className="ou-btn ou-btn--ghost ou-btn--s"
              data-testid="design-template-reset"
              onClick={design.resetToDefaults}
            >
              Сбросить до умолчаний
            </button>
          </div>
        </div>
      </section>
      <DesignSaveBar design={design} />
    </div>
  );
}

function BrandingPane({ design }: { design: ReturnType<typeof useDesignSettings> }) {
  const tpl = design.template;
  if (!tpl) return null;
  const params = tpl.manifest.params ?? [];
  if (params.length === 0) {
    return (
      <div data-testid="design-branding-pane">
        <div
          className="ou-banner ou-banner--info"
          role="status"
          data-testid="design-branding-empty"
        >
          <div className="ou-banner__body">
            <div className="ou-banner__title">
              У шаблона нет настраиваемых параметров
            </div>
            <div className="ou-banner__desc">
              Шаблон «{tpl.manifest.name}» не объявляет блок params в манифесте.
              Перейдите во вкладку «Шаблон», чтобы выбрать другой шаблон.
            </div>
          </div>
        </div>
        <DesignSaveBar design={design} />
      </div>
    );
  }
  return (
    <div data-testid="design-branding-pane">
      {params.map((p) => (
        <ParamRow
          key={p.key}
          param={p}
          value={design.draft.params?.[p.key]}
          onChange={(v) => design.setParam(p.key, v)}
        />
      ))}
      <DesignSaveBar design={design} />
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
        <label className="ou-formfield__lbl" htmlFor={fieldId}>{param.label}</label>
        <div className="ou-field ou-field--m">
          <div className="ou-field__box">
            <input
              id={fieldId}
              className="ou-field__input"
              type="text"
              value={v}
              onChange={(e) => onChange(e.target.value)}
              data-testid={`design-param-input-${param.key}`}
            />
          </div>
        </div>
      </div>
    );
  }
  if (param.type === "color") {
    const v = typeof value === "string" ? value : "";
    return (
      <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
        <label className="ou-formfield__lbl" htmlFor={fieldId}>{param.label}</label>
        <div className="ou-field ou-field--m">
          <div className="ou-field__box">
            <input
              id={fieldId}
              className="ou-field__input"
              type="text"
              value={v}
              placeholder="221 83% 53%"
              onChange={(e) => onChange(e.target.value)}
              data-testid={`design-param-input-${param.key}`}
            />
          </div>
        </div>
      </div>
    );
  }
  if (param.type === "boolean") {
    const v = typeof value === "boolean" ? value : Boolean(param.default ?? false);
    return (
      <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
        <label className="ou-switch-field">
          <input
            type="checkbox"
            checked={v}
            onChange={(e) => onChange(e.target.checked)}
            data-testid={`design-param-input-${param.key}`}
          />{" "}
          {param.label}
        </label>
      </div>
    );
  }
  if (param.type === "select") {
    const opts = param.options ?? [];
    const v = typeof value === "string" ? value : (param.default as string) ?? opts[0] ?? "";
    return (
      <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
        <label className="ou-formfield__lbl" htmlFor={fieldId}>{param.label}</label>
        <select
          id={fieldId}
          className="ou-field__input"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`design-param-input-${param.key}`}
        >
          {opts.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="ou-formfield" data-testid={`design-param-row-${param.key}`}>
      <label className="ou-formfield__lbl">{param.label}</label>
      <div
        className="ou-banner ou-banner--info ou-banner--sm"
        role="status"
        data-testid={`design-param-unsupported-${param.key}`}
      >
        <div className="ou-banner__body">
          <div className="ou-banner__desc">
            Тип «{param.type}» поддерживается в следующем шаге (медиатека).
          </div>
        </div>
      </div>
    </div>
  );
}

function DesignSaveBar({ design }: { design: ReturnType<typeof useDesignSettings> }) {
  return (
    <div className="tb-design-savebar" data-testid="design-savebar">
      {design.saveError && (
        <div
          className="ou-banner ou-banner--error"
          role="alert"
          data-testid="design-save-error"
        >
          <div className="ou-banner__body">
            <div className="ou-banner__desc">{design.saveError.message}</div>
          </div>
        </div>
      )}
      <div className="tb-design-savebar__actions">
        <button
          type="button"
          className="ou-btn ou-btn--ghost ou-btn--s"
          onClick={design.revert}
          disabled={!design.isDirty || design.isSaving}
          data-testid="design-revert"
        >
          Отменить
        </button>
        <button
          type="button"
          className="ou-btn ou-btn--primary ou-btn--s"
          onClick={() => {
            design.save().catch(() => {
              // surfaced via saveError state above
            });
          }}
          disabled={!design.isDirty || design.isSaving}
          data-testid="design-save"
        >
          {design.isSaving ? "Сохранение…" : "Сохранить оформление"}
        </button>
      </div>
    </div>
  );
}

function StubPane({ railKey }: { railKey: DesignRailKey }) {
  const text: Record<DesignRailKey, { title: string; desc: string }> = {
    template: {
      title: "Шаблон — следующий шаг",
      desc: "",
    },
    branding: {
      title: "Брендирование — следующий шаг",
      desc: "",
    },
    layout: {
      title: "Макет — следующий шаг",
      desc:
        "Настройки макета (расположение блоков, плотность, мобильное представление) реализуются отдельным шагом PRD-7.",
    },
    progress: {
      title: "Прогресс и шапка — следующий шаг",
      desc:
        "Параметры шапки и индикатора прогресса (видимость, формат счётчика, breadcrumb) реализуются отдельным шагом PRD-7.",
    },
  };
  const { title, desc } = text[railKey];
  return (
    <div
      className="ou-banner ou-banner--info"
      role="status"
      data-testid={`design-stub-${railKey}`}
    >
      <div className="ou-banner__body">
        <div className="ou-banner__title">{title}</div>
        <div className="ou-banner__desc">{desc}</div>
      </div>
    </div>
  );
}
