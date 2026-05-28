/**
 * @module features/tests/editor/sections/template-gallery-modal
 * @description Template gallery (PRD-7 S12-G3 / FR-33).
 *
 * Modal dialog opened from the «Заменить шаблон» button in the design tab.
 * Lists all active templates as a grid of cards with miniature preview, name,
 * description, version + builtin tags. Supports search by name/description,
 * pre-selects the current template (disabled), and confirms a switch.
 *
 * Apply flow:
 *   - If the selected template equals current → «Применить» disabled.
 *   - If the test has dirty params (`design.draft.params` non-empty) → an
 *     inline warning Banner replaces the «Применить» button with a
 *     «Заменить и сбросить параметры» destructive variant; clicking it
 *     applies AND clears params.
 *   - Otherwise → applies cleanly.
 *
 * The modal does NOT save to the server; it patches `design.draft.templateId`
 * + clears `params`. The Drawer footer's primary Save persists.
 */
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Banner, Button, ModalDialog, Tag } from "@universityrt/ui-kit";
import { useQuery } from "@tanstack/react-query";
import type { TemplateRow } from "../use-design-settings";

// ─── Public API ───────────────────────────────────────────────────────────────

export type TemplateGalleryModalProps = {
  open: boolean;
  onClose: () => void;
  /** Currently applied template id (from `design.draft.templateId`). */
  currentTemplateId: string;
  /** True when `design.draft.params` has entries that would be lost on switch. */
  hasDirtyParams: boolean;
  /** Patch the design draft with `{ templateId: newId, params: {} }`. */
  onApply: (templateId: string) => void;
};

// ─── Network ─────────────────────────────────────────────────────────────────

async function fetchTemplates(): Promise<TemplateRow[]> {
  const res = await fetch("/api/templates", { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load templates: ${res.status}`);
  return res.json();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplateGalleryModal(props: TemplateGalleryModalProps) {
  const [selectedId, setSelectedId] = useState<string>(props.currentTemplateId);
  const [query, setQuery] = useState("");

  // Reset on open so each fresh open starts pre-selected on the current template.
  useEffect(() => {
    if (props.open) {
      setSelectedId(props.currentTemplateId);
      setQuery("");
    }
  }, [props.open, props.currentTemplateId]);

  const templatesQuery = useQuery({
    queryKey: ["templates", "list"],
    queryFn: fetchTemplates,
    enabled: props.open,
  });

  const templates = templatesQuery.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return templates;
    return templates.filter((t) => {
      const haystack = `${t.manifest.name ?? t.name} ${t.manifest.description ?? t.description ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [templates, query]);

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const isSameAsCurrent = selectedId === props.currentTemplateId;
  // PRD-7 S12-G3: dirty-params confirm renders a destructive Apply button +
  // a warning banner. Banner content lists the param-keys that will be lost
  // (the actual labels live in the OLD template's manifest, which we still
  // have via templates[]).
  const needsDirtyConfirm = !isSameAsCurrent && props.hasDirtyParams;

  if (!props.open) return null;

  return (
    <ModalDialog
      open={props.open}
      onClose={props.onClose}
      size="xl"
      className="tpl-gallery-modal"
      title="Выбор шаблона"
      description={
        templates.length > 0 ? `${templates.length} шаблонов` : undefined
      }
      footer={
        <div
          className="tpl-gallery-foot"
          data-testid="design-gallery-foot"
        >
          <span className="tpl-gallery-foot__info">
            Выбран:{" "}
            <strong>
              {selected ? selected.manifest.name ?? selected.name : "—"}
            </strong>
          </span>
          <div className="tpl-gallery-foot__actions">
            <Button
              variant="secondary"
              size="m"
              onClick={props.onClose}
              data-testid="design-gallery-cancel"
            >
              Отмена
            </Button>
            <Button
              variant={needsDirtyConfirm ? "destructive" : "primary"}
              size="m"
              disabled={isSameAsCurrent}
              onClick={() => {
                if (isSameAsCurrent) return;
                props.onApply(selectedId);
                props.onClose();
              }}
              data-testid="design-gallery-apply"
            >
              {needsDirtyConfirm
                ? "Заменить и сбросить параметры"
                : "Применить шаблон"}
            </Button>
          </div>
        </div>
      }
      data-testid="design-gallery-modal"
    >
      <div className="tpl-gallery-search">
        <Search
          width={14}
          height={14}
          className="variant-search__icon"
          aria-hidden="true"
        />
        <input
          type="search"
          className="variant-search__input"
          placeholder="Поиск шаблонов…"
          aria-label="Поиск шаблонов"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="design-gallery-search"
        />
      </div>
      {needsDirtyConfirm && (
        <Banner
          tone="warning"
          title="Замена шаблона сбросит текущие параметры оформления"
          description="При смене шаблона все настройки брендирования, макета и прогресса вернутся к значениям нового шаблона по умолчанию."
          data-testid="design-gallery-confirm-banner"
        />
      )}
      {templatesQuery.isLoading && (
        <p
          className="tpl-gallery-empty"
          data-testid="design-gallery-loading"
        >
          Загружаем шаблоны…
        </p>
      )}
      {templatesQuery.error && (
        <Banner
          tone="error"
          title="Не удалось загрузить список шаблонов"
          description={(templatesQuery.error as Error).message}
          data-testid="design-gallery-error"
        />
      )}
      {!templatesQuery.isLoading && filtered.length === 0 && (
        <p
          className="tpl-gallery-empty"
          data-testid="design-gallery-empty"
        >
          {query.trim() === "" ? "Активные шаблоны не найдены." : "Ничего не найдено"}
        </p>
      )}
      {filtered.length > 0 && (
        <div
          className="tpl-gallery-grid"
          role="listbox"
          aria-label="Шаблоны оформления"
          data-testid="design-gallery-grid"
        >
          {filtered.map((tpl) => {
            const isCurrent = tpl.id === props.currentTemplateId;
            const isSelected = tpl.id === selectedId;
            const name = tpl.manifest.name ?? tpl.name;
            const description = tpl.manifest.description ?? tpl.description ?? "";
            return (
              <div
                key={tpl.id}
                role="option"
                aria-selected={isSelected ? "true" : "false"}
                tabIndex={0}
                className={
                  "tpl-gallery-card" +
                  (isSelected ? " is-selected" : "") +
                  (isCurrent && !isSelected ? " is-current" : "")
                }
                onClick={() => setSelectedId(tpl.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(tpl.id);
                  }
                }}
                data-testid={`design-gallery-card-${tpl.id}`}
              >
                <div className="tpl-gallery-card__thumb">
                  <div className="preview-sketch">
                    <div className="ps-header">
                      <div className="ps-logo" />
                      <div className="ps-title">{name.slice(0, 3).toUpperCase()}</div>
                    </div>
                    <div className="ps-body">
                      <div className="ps-content">
                        <div className="ps-q">Вопрос…</div>
                        <div className="ps-opt sel" />
                        <div className="ps-opt" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="tpl-gallery-card__body">
                  <div className="tpl-gallery-card__name">
                    {name}
                    {isCurrent && (
                      <Tag tone="accent" size="s" data-testid={`design-gallery-card-${tpl.id}-current`}>
                        Текущий
                      </Tag>
                    )}
                  </div>
                  {description && (
                    <div className="tpl-gallery-card__desc">{description}</div>
                  )}
                  <div className="tpl-gallery-card__footer">
                    {tpl.isBuiltin && (
                      <Tag tone="neutral" variant="outline" size="s">
                        Встроенный
                      </Tag>
                    )}
                    <Tag tone="info" variant="outline" size="s">
                      v{tpl.manifest.version ?? tpl.version}
                    </Tag>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ModalDialog>
  );
}
