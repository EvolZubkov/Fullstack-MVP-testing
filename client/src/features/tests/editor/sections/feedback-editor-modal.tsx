/**
 * @module features/tests/editor/sections/feedback-editor-modal
 * @description Unified feedback editor modal (PRD-7 FR-36 / FR-37).
 *
 * Wireframe: `prd7-editor-drawer.html` state `s-feedback-edit` (line 1025+).
 * The same composite UI is used across all feedback editing contexts:
 *   - test-level overall feedback (Настройки → Основное)
 *   - topic-level «failureFeedback» in adaptive mode (Адаптивный режим)
 *   - per-level feedback inside an adaptive level card
 *   - per-topic feedback in Состав tab (TopicRow)
 *
 * Composition:
 *   1. Format selector (SegmentedControl) — plain / richText / html.
 *   2. Body editor:
 *      - plain/html: ui-kit Textarea with appropriate placeholder.
 *      - richText: execCommand-based RTE toolbar (B / I / link) + contenteditable
 *        area. No external RTE library (tiptap/slate) — browser execCommand only.
 *        innerHTML is initialized once on format-switch or modal-open; never
 *        re-bound on each setDraft to avoid cursor disruption.
 *   3. Links list — array of {title, url} editable rows + «Добавить ссылку» button.
 *      The button is wrapped in a <div> to prevent flex-column stretching.
 *   4. PDF assets list — client-side only. Server upload integration ships separately
 *      (FR-37 next PR). The local DraftAsset type extends FeedbackAsset with optional
 *      `size` / `file` fields for UI display; those fields are stripped before onSave
 *      so callers only receive canonical FeedbackAsset fields.
 *
 * Footer: «Отменить» (secondary) + «Сохранить» (primary).
 * The modal owns a draft copy of the values; on Save it emits via `onSave`.
 */
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Link as LinkIcon, Paperclip, Plus, Trash2 } from "lucide-react";
import {
  Banner,
  Button,
  IconButton,
  Input,
  ModalDialog,
  SegmentedControl,
  Textarea,
} from "@universityrt/ui-kit";
import type { FeedbackAsset } from "../test-editor.types";

// ─── Public types ────────────────────────────────────────────────────────────

export type FeedbackFormat = "plain" | "richText" | "html";

/** Course recommendation — URL required (label «Курсы» in the UI). */
export type FeedbackLink = { title: string; url: string };

/** Event recommendation (TD-02) — URL optional. */
export type FeedbackEvent = { title: string; url?: string };

/** Value shape passed in and emitted by the modal. `assets` are canonical — no UI-only fields. */
export type FeedbackEditorValue = {
  format: FeedbackFormat;
  text: string;
  /** Recommended courses (UI label «Курсы»). */
  links: FeedbackLink[];
  assets: FeedbackAsset[];
  /** Recommended events (TD-02). Optional in the type so legacy callers compile. */
  events?: FeedbackEvent[];
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
  /** When true, the «Мероприятия» section is hidden (contexts that do not persist events). */
  hideEvents?: boolean;
  onCancel: () => void;
  onSave: (value: FeedbackEditorValue) => void;
  /** Optional test id for the modal root. */
  testId?: string;
};

// ─── Local draft type ─────────────────────────────────────────────────────────

/**
 * Draft-only asset. Extends canonical FeedbackAsset with UI-only fields:
 *   `size`  — bytes shown as «245 KB» next to the file name.
 *   `file`  — original File blob kept until server upload ships.
 * Both are stripped before emitting via onSave.
 */
type DraftAsset = FeedbackAsset & { size?: number; file?: File };

type DraftValue = Omit<FeedbackEditorValue, "assets" | "events"> & {
  assets: DraftAsset[];
  /** Always a concrete array in the draft (normalized from the optional prop). */
  events: FeedbackEvent[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format byte count as human-readable KB / MB string (1 decimal place).
 * @param n - size in bytes
 */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** @public */
export function FeedbackEditorModal(props: FeedbackEditorModalProps) {
  const [draft, setDraft] = useState<DraftValue>(() => ({
    ...props.value,
    events: props.value.events ?? [],
  }));
  /** Ref to the contenteditable RTE area (richText mode only). */
  const rteRef = useRef<HTMLDivElement>(null);
  /** Hidden file input for PDF upload. */
  const fileInputRef = useRef<HTMLInputElement>(null);

  // S13.1-G39: link-insert modal state. `savedRange` captures the user's
  // selection inside the RTE before the modal steals focus, so submitting
  // the form can restore it and `createLink` wraps the original text.
  const [linkInsert, setLinkInsert] = useState<{
    url: string;
    text: string;
    savedRange: Range | null;
  } | null>(null);

  // S13.1-G40: list of files rejected for exceeding the 5 MB limit. Rendered
  // as an in-modal warning banner instead of window.alert. Dismissible.
  const [oversizedFiles, setOversizedFiles] = useState<string[]>([]);

  // Reset draft when the modal re-opens or receives a new value.
  // For richText format: initialize the RTE innerHTML via requestAnimationFrame
  // so the div is guaranteed to be mounted after the re-render triggered by setDraft.
  useEffect(() => {
    if (!props.open) return;
    const newVal = props.value;
    setDraft({ ...newVal, events: newVal.events ?? [] });
    if (newVal.format === "richText") {
      requestAnimationFrame(() => {
        if (rteRef.current) rteRef.current.innerHTML = newVal.text;
      });
    }
  }, [props.open, props.value]);

  // When the user switches format TO richText inside the modal, initialize the
  // RTE area with the current draft text. Intentionally omits draft.text from
  // the dependency array — re-binding on every keystroke would destroy the cursor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (draft.format === "richText" && rteRef.current) {
      rteRef.current.innerHTML = draft.text;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.format]);

  /** Focus the RTE area and run an execCommand. */
  function execRteCommand(command: string, value?: string) {
    rteRef.current?.focus();
    // execCommand is deprecated but still the only cross-browser solution at
    // wireframe scope without pulling in tiptap/slate (blocked per task constraints).
    document.execCommand(command, false, value);
  }

  /**
   * Open the link-insert modal (S13.1-G39). Captures the current selection
   * range so the modal submit can restore it and wrap the original text in
   * `<a>`. If there is no selection, the modal falls back to using its
   * «Display text» field as the inserted text.
   */
  function handleLinkInsert() {
    const sel = window.getSelection();
    let savedRange: Range | null = null;
    let selectedText = "";
    if (sel && sel.rangeCount > 0 && rteRef.current?.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
      selectedText = sel.toString();
    }
    setLinkInsert({ url: "", text: selectedText, savedRange });
  }

  /**
   * Commit the link-insert modal: restore the saved selection (if any) and
   * either wrap it with `createLink` or insert a new `<a>` element at the
   * cursor for the empty-selection case.
   */
  function handleLinkInsertSubmit() {
    if (!linkInsert) return;
    const url = linkInsert.url.trim();
    if (!url) return;
    const text = linkInsert.text.trim();
    rteRef.current?.focus();
    if (linkInsert.savedRange) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(linkInsert.savedRange);
      if (linkInsert.savedRange.collapsed) {
        // No selection — insert <a>text</a> at cursor.
        const a = document.createElement("a");
        a.href = url;
        a.textContent = text || url;
        linkInsert.savedRange.insertNode(a);
        // Move cursor after the inserted link.
        const range = document.createRange();
        range.setStartAfter(a);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      } else {
        // Wrap the existing selection.
        document.execCommand("createLink", false, url);
      }
    } else {
      // Editor was never focused; insert at the end.
      const a = document.createElement("a");
      a.href = url;
      a.textContent = text || url;
      rteRef.current?.appendChild(a);
    }
    if (rteRef.current) {
      setDraft((d) => ({ ...d, text: rteRef.current!.innerHTML }));
    }
    setLinkInsert(null);
  }

  /** Handle file picker change: validate size, build draft assets. */
  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
    const oversized = files.filter((f) => f.size > MAX_BYTES);
    if (oversized.length > 0) {
      // S13.1-G40: surface as an in-modal Banner instead of window.alert.
      setOversizedFiles(oversized.map((f) => f.name));
    } else {
      setOversizedFiles([]);
    }
    const valid = files.filter((f) => f.size <= MAX_BYTES);
    if (valid.length === 0) {
      e.target.value = "";
      return;
    }
    const newAssets: DraftAsset[] = valid.map((file) => ({
      title: file.name.replace(/\.pdf$/i, ""),
      fileName: file.name,
      mimeType: "application/pdf" as const,
      size: file.size,
      file,
    }));
    setDraft((d) => ({ ...d, assets: [...d.assets, ...newAssets] }));
    // Reset so the same file can be re-selected after removal.
    e.target.value = "";
  }

  /** Strip UI-only fields (size, file) before emitting to the caller. */
  function handleSave() {
    const canonical: FeedbackEditorValue = {
      ...draft,
      assets: draft.assets.map(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ({ size: _s, file: _f, ...rest }) => rest,
      ),
    };
    props.onSave(canonical);
  }

  return (
    <>
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
            onClick={handleSave}
            data-testid="feedback-editor-save"
          >
            Сохранить
          </Button>
        </>
      }
      data-testid={props.testId ?? "feedback-editor"}
    >
      <div className="tb-feedback-editor">
        {/* ── S13.1-G40: oversize-file warning banner ─────────────────── */}
        {oversizedFiles.length > 0 && (
          <Banner
            tone="warning"
            title="Файл(ы) превышают 5 MB и не были добавлены"
            description={oversizedFiles.join(", ")}
            onClose={() => setOversizedFiles([])}
            data-testid="feedback-editor-oversize-banner"
          />
        )}

        {/* ── Format selector ──────────────────────────────────────────── */}
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

        {/* ── Body editor ──────────────────────────────────────────────── */}
        {draft.format === "richText" ? (
          /* richText: execCommand-based RTE toolbar + contenteditable area. */
          <div className="tb-feedback-editor__section">
            <div className="tb-feedback-editor__sec-title">Текст обратной связи</div>
            <div className="tb-rte">
              <div className="tb-rte__toolbar" role="toolbar" aria-label="Форматирование">
                <button
                  type="button"
                  className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
                  aria-label="Жирный (Ctrl+B)"
                  aria-pressed="false"
                  onClick={() => execRteCommand("bold")}
                  data-testid="rte-bold"
                >
                  <strong>B</strong>
                </button>
                <button
                  type="button"
                  className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
                  aria-label="Курсив (Ctrl+I)"
                  aria-pressed="false"
                  onClick={() => execRteCommand("italic")}
                  data-testid="rte-italic"
                >
                  <em>I</em>
                </button>
                <span className="tb-rte__sep" aria-hidden="true" />
                <button
                  type="button"
                  className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
                  aria-label="Вставить ссылку"
                  onClick={handleLinkInsert}
                  data-testid="rte-link"
                >
                  <LinkIcon width={14} height={14} aria-hidden="true" />
                </button>
              </div>
              {/* contentEditable area — innerHTML is managed via ref, not React state,
                  to avoid cursor disruption on every keystroke. */}
              <div
                className="tb-rte__area"
                contentEditable
                role="textbox"
                aria-multiline="true"
                aria-label="Текст обратной связи"
                ref={rteRef}
                onInput={() => {
                  if (rteRef.current) {
                    setDraft((d) => ({ ...d, text: rteRef.current!.innerHTML }));
                  }
                }}
                data-testid="feedback-editor-rte-area"
                suppressContentEditableWarning
              />
            </div>
          </div>
        ) : (
          /* plain / html: standard Textarea. */
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
          </div>
        )}

        {/* ── Courses section (data field `links`; UI label «Курсы») ────── */}
        <div className="tb-feedback-editor__section">
          <div className="tb-feedback-editor__sec-title">
            <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Курсы
          </div>
          {/* No empty-state per wireframe — just the list (if any) + button. */}
          {draft.links.length > 0 && (
            <ul className="tb-feedback-editor__list" aria-label="Курсы">
              {draft.links.map((link, idx) => (
                <li key={idx} className="tb-feedback-editor__item">
                  <div className="tb-feedback-editor__item-fields">
                    <Input
                      size="s"
                      fullWidth
                      aria-label="Название курса"
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
                      aria-label="URL курса"
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
                    aria-label={`Удалить курс ${idx + 1}`}
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
          {/* Wrap in <div> so flex-column parent does not stretch the button full-width. */}
          <div>
            <Button
              variant="secondary"
              size="s"
              leadingIcon={<Plus className="h-3 w-3" aria-hidden="true" />}
              onClick={() =>
                setDraft((d) => ({ ...d, links: [...d.links, { title: "", url: "" }] }))
              }
              data-testid="feedback-editor-link-add"
            >
              Добавить курс
            </Button>
          </div>
        </div>

        {/* ── Events section (TD-02; URL optional) ─────────────────────── */}
        {!props.hideEvents && (
        <div className="tb-feedback-editor__section">
          <div className="tb-feedback-editor__sec-title">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            Мероприятия
          </div>
          {draft.events.length > 0 && (
            <ul className="tb-feedback-editor__list" aria-label="Мероприятия">
              {draft.events.map((event, idx) => (
                <li key={idx} className="tb-feedback-editor__item">
                  <div className="tb-feedback-editor__item-fields">
                    <Input
                      size="s"
                      fullWidth
                      aria-label="Название мероприятия"
                      value={event.title}
                      placeholder="Название"
                      onChange={(e) => {
                        const title = e.target.value;
                        setDraft((d) => {
                          const events = [...d.events];
                          events[idx] = { ...events[idx], title };
                          return { ...d, events };
                        });
                      }}
                      data-testid={`feedback-editor-event-title-${idx}`}
                    />
                    <Input
                      size="s"
                      fullWidth
                      type="url"
                      aria-label="Ссылка на мероприятие (необязательно)"
                      value={event.url ?? ""}
                      placeholder="https://… (необязательно)"
                      onChange={(e) => {
                        const url = e.target.value;
                        setDraft((d) => {
                          const events = [...d.events];
                          events[idx] = { ...events[idx], url };
                          return { ...d, events };
                        });
                      }}
                      data-testid={`feedback-editor-event-url-${idx}`}
                    />
                  </div>
                  <IconButton
                    icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    aria-label={`Удалить мероприятие ${idx + 1}`}
                    variant="ghost"
                    size="s"
                    onClick={() => {
                      setDraft((d) => {
                        const events = [...d.events];
                        events.splice(idx, 1);
                        return { ...d, events };
                      });
                    }}
                    data-testid={`feedback-editor-event-remove-${idx}`}
                  />
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button
              variant="secondary"
              size="s"
              leadingIcon={<Plus className="h-3 w-3" aria-hidden="true" />}
              onClick={() =>
                setDraft((d) => ({ ...d, events: [...d.events, { title: "", url: "" }] }))
              }
              data-testid="feedback-editor-event-add"
            >
              Добавить мероприятие
            </Button>
          </div>
        </div>
        )}

        {/* ── PDF assets section ───────────────────────────────────────── */}
        {!props.hideAssets && (
          <div className="tb-feedback-editor__section">
            <div className="tb-feedback-editor__sec-title">
              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
              Прикреплённые файлы (PDF)
            </div>
            {draft.assets.length > 0 && (
              <ul className="tb-feedback-editor__list" aria-label="Прикреплённые файлы">
                {draft.assets.map((asset, i) => (
                  <li className="tb-feedback-editor__item" key={asset.id ?? i}>
                    <div className="tb-feedback-editor__asset">
                      <Paperclip
                        className="tb-feedback-editor__asset-ico"
                        width={20}
                        height={20}
                        aria-hidden="true"
                      />
                      <div className="tb-feedback-editor__asset-meta">
                        <Input
                          size="s"
                          fullWidth
                          aria-label="Название файла"
                          value={asset.title}
                          onChange={(e) => {
                            const title = e.target.value;
                            setDraft((d) => {
                              const assets = [...d.assets];
                              assets[i] = { ...assets[i], title };
                              return { ...d, assets };
                            });
                          }}
                          data-testid={`feedback-editor-asset-title-${i}`}
                        />
                        <div className="tb-feedback-editor__asset-file">
                          {asset.fileName}
                          {asset.size ? ` · ${formatBytes(asset.size)}` : ""}
                        </div>
                      </div>
                    </div>
                    <IconButton
                      icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      aria-label={`Удалить файл ${i + 1}`}
                      variant="ghost"
                      size="s"
                      onClick={() => {
                        setDraft((d) => {
                          const assets = [...d.assets];
                          assets.splice(i, 1);
                          return { ...d, assets };
                        });
                      }}
                      data-testid={`feedback-editor-asset-remove-${i}`}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="tb-feedback-editor__upload">
              <Button
                variant="secondary"
                size="s"
                leadingIcon={<Plus className="h-3 w-3" aria-hidden="true" />}
                onClick={() => fileInputRef.current?.click()}
                data-testid="feedback-editor-asset-upload"
              >
                Загрузить PDF
              </Button>
              <span className="tb-feedback-editor__upload-hint">
                PDF до 5 MB; попадёт в SCORM-пакет и доступен по download-link
              </span>
              {/* Hidden file input; triggered programmatically by the button above. */}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: "none" }}
                multiple
                onChange={handleFilePick}
                data-testid="feedback-editor-asset-input"
              />
            </div>
          </div>
        )}
      </div>
    </ModalDialog>

    {/* ── S13.1-G39: link-insert sub-modal (replaces window.prompt) ─── */}
    {linkInsert !== null && (
      <ModalDialog
        open
        onClose={() => setLinkInsert(null)}
        size="s"
        title="Вставить ссылку"
        description="Укажите URL и текст, который увидит обучающийся"
        data-testid="rte-link-modal"
        footer={
          <>
            <Button
              variant="ghost"
              size="s"
              onClick={() => setLinkInsert(null)}
              data-testid="rte-link-cancel"
            >
              Отмена
            </Button>
            <Button
              variant="primary"
              size="s"
              onClick={handleLinkInsertSubmit}
              disabled={linkInsert.url.trim() === ""}
              data-testid="rte-link-submit"
            >
              Вставить
            </Button>
          </>
        }
      >
        <div className="tb-link-insert">
          <Input
            size="m"
            fullWidth
            type="url"
            label="URL"
            placeholder="https://…"
            value={linkInsert.url}
            autoFocus
            onChange={(e) =>
              setLinkInsert((s) => (s ? { ...s, url: e.target.value } : s))
            }
            data-testid="rte-link-url"
          />
          <Input
            size="m"
            fullWidth
            label="Текст ссылки"
            placeholder="Оставьте пустым, чтобы показать URL"
            value={linkInsert.text}
            onChange={(e) =>
              setLinkInsert((s) => (s ? { ...s, text: e.target.value } : s))
            }
            data-testid="rte-link-text"
          />
        </div>
      </ModalDialog>
    )}
    </>
  );
}
