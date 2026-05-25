/**
 * @module features/tests/editor/sections/feedback-editor-modal
 * @description Unified feedback editor modal (PRD-7 FR-36 / FR-37).
 *
 * Wireframe: `prd7-editor-drawer.html` state `s-feedback-edit` (line 984+).
 * The same composite UI is used across all feedback editing contexts:
 *   - test-level overall feedback (Настройки → Основное)
 *   - topic-level «failureFeedback» in adaptive mode (Адаптивный режим)
 *   - per-level feedback inside an adaptive level card
 *   - per-topic feedback in pass-rules / composition tabs (deferred trigger)
 *
 * Composition:
 *   1. Format selector (SegmentedControl) — plain / richText / html.
 *   2. Body editor — Textarea for plain/html, deferred RTE toolbar for
 *      richText (UI slot is reserved, real RTE ships separately).
 *   3. Links list — array of `{title, url}` editable rows + «Добавить ссылку».
 *   4. PDF assets list — deferred placeholder (Banner) until file-upload
 *      integration ships (FR-37).
 *
 * Footer: «Отменить» + «Сохранить» (primary). The modal owns a draft copy
 * of the values; on Save it merges back via the supplied `onSave` callback.
 */
import { useEffect, useState } from "react";
import { Link as LinkIcon, Paperclip, Plus, Trash2 } from "lucide-react";
import {
  Banner,
  Button,
  IconButton,
  Input,
  ModalDialog,
  SegmentedControl,
  Textarea,
} from "@universityrt/ui-kit";

// ─── Public types ────────────────────────────────────────────────────────────

export type FeedbackFormat = "plain" | "richText" | "html";

export type FeedbackLink = { title: string; url: string };

export type FeedbackEditorValue = {
  format: FeedbackFormat;
  text: string;
  links: FeedbackLink[];
  /**
   * PDF assets are deferred until the asset uploader integration lands.
   * The modal still surfaces the slot so authors see where future files
   * will appear, and the caller can keep its array intact unchanged.
   */
  assetCount?: number;
};

export type FeedbackEditorModalProps = {
  open: boolean;
  /** Modal title — e.g. «Обратная связь по теме «Основы ИБ»». */
  title: string;
  /** Subtitle / description rendered under the title. */
  description?: string;
  value: FeedbackEditorValue;
  /** When true, the «PDF» section is hidden entirely (e.g. for level feedback). */
  hideAssets?: boolean;
  onCancel: () => void;
  onSave: (value: FeedbackEditorValue) => void;
  /** Optional test id for the modal root. */
  testId?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function FeedbackEditorModal(props: FeedbackEditorModalProps) {
  const [draft, setDraft] = useState<FeedbackEditorValue>(props.value);

  // Reset draft when the modal re-opens with a different value (e.g. user
  // switches between different feedback sources without unmount/remount).
  useEffect(() => {
    if (props.open) setDraft(props.value);
  }, [props.open, props.value]);

  return (
    <ModalDialog
      open={props.open}
      onClose={props.onCancel}
      size="l"
      title={props.title}
      description={props.description}
      footer={
        <>
          <Button
            variant="secondary"
            size="m"
            onClick={props.onCancel}
            data-testid="feedback-editor-cancel"
          >
            Отменить
          </Button>
          <Button
            variant="primary"
            size="m"
            onClick={() => props.onSave(draft)}
            data-testid="feedback-editor-save"
          >
            Сохранить
          </Button>
        </>
      }
      data-testid={props.testId ?? "feedback-editor"}
    >
      <div className="tb-feedback-editor">
        {/* ── Format selector ─────────────────────────────────────────── */}
        <div className="tb-feedback-editor__section tb-feedback-editor__section--inline">
          <span className="tb-feedback-editor__sec-title">Формат</span>
          <SegmentedControl<FeedbackFormat>
            size="s"
            value={draft.format}
            aria-label="Формат текста"
            items={[
              { value: "plain", label: "Простой" },
              { value: "richText", label: "Форматированный" },
              { value: "html", label: "HTML" },
            ]}
            onChange={(format) => setDraft((d) => ({ ...d, format }))}
          />
        </div>

        {/* ── Body editor ─────────────────────────────────────────────── */}
        <div className="tb-feedback-editor__section">
          <Textarea
            size="m"
            fullWidth
            rows={6}
            label="Текст обратной связи"
            value={draft.text}
            placeholder={
              draft.format === "html"
                ? "Введите HTML-разметку…"
                : "Текст, который увидит обучающийся…"
            }
            onChange={(e) => {
              const text = e.target.value;
              setDraft((d) => ({ ...d, text }));
            }}
            data-testid="feedback-editor-text"
          />
          {draft.format === "richText" && (
            <Banner
              tone="info"
              size="sm"
              description="Полноценный редактор форматирования (жирный / курсив / списки) реализуется в отдельном шаге PRD-7 (FR-36). Пока сохраняем текст как есть."
              data-testid="feedback-editor-rte-stub"
            />
          )}
        </div>

        {/* ── Links section ───────────────────────────────────────────── */}
        <div className="tb-feedback-editor__section">
          <div className="tb-feedback-editor__sec-title">
            <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Ссылки на материалы
          </div>
          {draft.links.length === 0 ? (
            <div className="page-row--empty">Ссылок ещё нет.</div>
          ) : (
            <ul className="tb-feedback-editor__list" aria-label="Ссылки">
              {draft.links.map((link, idx) => (
                <li key={idx} className="tb-feedback-editor__item">
                  <div className="tb-feedback-editor__item-fields">
                    <Input
                      size="s"
                      fullWidth
                      aria-label="Название ссылки"
                      value={link.title}
                      placeholder="Название"
                      onChange={(e) => {
                        const title = e.target.value;
                        setDraft((d) => {
                          const links = [...d.links];
                          links[idx] = { ...links[idx], title };
                          return { ...d, links };
                        });
                      }}
                      data-testid={`feedback-editor-link-title-${idx}`}
                    />
                    <Input
                      size="s"
                      fullWidth
                      type="url"
                      aria-label="URL ссылки"
                      value={link.url}
                      placeholder="https://…"
                      onChange={(e) => {
                        const url = e.target.value;
                        setDraft((d) => {
                          const links = [...d.links];
                          links[idx] = { ...links[idx], url };
                          return { ...d, links };
                        });
                      }}
                      data-testid={`feedback-editor-link-url-${idx}`}
                    />
                  </div>
                  <IconButton
                    icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    aria-label={`Удалить ссылку ${idx + 1}`}
                    variant="ghost"
                    size="s"
                    onClick={() => {
                      setDraft((d) => {
                        const links = [...d.links];
                        links.splice(idx, 1);
                        return { ...d, links };
                      });
                    }}
                    data-testid={`feedback-editor-link-remove-${idx}`}
                  />
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="secondary"
            size="s"
            leadingIcon={<Plus className="h-3 w-3" aria-hidden="true" />}
            onClick={() =>
              setDraft((d) => ({ ...d, links: [...d.links, { title: "", url: "" }] }))
            }
            data-testid="feedback-editor-link-add"
          >
            Добавить ссылку
          </Button>
        </div>

        {/* ── PDF assets section (deferred uploader) ──────────────────── */}
        {!props.hideAssets && (
          <div className="tb-feedback-editor__section">
            <div className="tb-feedback-editor__sec-title">
              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
              Прикреплённые файлы (PDF)
            </div>
            <Banner
              tone="info"
              size="sm"
              description={
                props.value.assetCount && props.value.assetCount > 0
                  ? `Уже прикреплено: ${props.value.assetCount}. Полноценная загрузка PDF реализуется отдельным шагом (FR-37).`
                  : "Загрузка PDF-материалов реализуется отдельным шагом PRD-7 (FR-37)."
              }
              data-testid="feedback-editor-assets-stub"
            />
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
