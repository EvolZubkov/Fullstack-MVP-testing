# Материалы обратной связи — только ссылки, без загрузки (PRD-42) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** Заменить загрузку PDF-файла в секции вложений обратной связи на обычную ссылку
{title, url} — по образцу уже существующих секций «Курсы»/«Мероприятия» — и убрать серверный
маршрут загрузки, чтобы новые вложения были настоящим внешним URL и не давали битых ссылок в
PDF-отчёте (см. [спеку PRD-42](../specs/prd-42/feedback-assets-links-only.md)).

**Architecture:** Модель вложения (`FeedbackAsset`/`feedbackAssetSchema`) упрощается — `url`
остаётся простой опциональной строкой (без формат-проверки, технический долг из спеки §7),
`fileName`/`mimeType` становятся опциональными legacy-only полями. Редактор
(`feedback-editor-modal.tsx`) заменяет секцию загрузки на редактируемый список ссылок,
дословно повторяя структуру уже существующей секции «Курсы» в том же файле. Серверный маршрут
`POST /api/media/upload?purpose=feedback-asset` удаляется вместе со своей строгой проверкой —
он был единственным потребителем этой ветки. `shared/report/export-pdf.ts`, SCORM-упаковщик и
`shared/template/result-context.ts` не меняются — они уже одинаково обрабатывают легаси
media-ref и обычный внешний URL.

**Tech Stack:** React 19 + TypeScript (клиент), Express + Zod (сервер), Vitest +
@testing-library/react (тесты).

---

## Task 1: Модель данных — необязательные `fileName`/`mimeType`

**Files:**

- Modify: `shared/schema.ts:898-916` (`feedbackAssetSchema`)
- Modify: `client/src/features/tests/editor/test-editor.types.ts:63-75` (`FeedbackAsset`)
- Test: `tests/schema-prd7-feedback.test.ts`

- [ ] **Step 1: Write the failing tests**

  В `tests/schema-prd7-feedback.test.ts` замени блок `describe("feedbackAssetSchema", ...)`
  (строки 53-78) целиком на:

  ```ts
  describe("feedbackAssetSchema", () => {
    const valid = {
      id: "asset-1",
      title: "Cert",
      fileName: "cert.pdf",
      mimeType: "application/pdf" as const,
      scormHref: "feedback/cert.pdf",
    };

    it("accepts a fully populated asset", () => {
      expect(() => feedbackAssetSchema.parse(valid)).not.toThrow();
    });

    it("accepts asset without id and scormHref (frontend draft)", () => {
      const { id: _id, scormHref: _scormHref, ...rest } = valid;
      expect(() => feedbackAssetSchema.parse(rest)).not.toThrow();
    });

    it("rejects non-pdf mimeType when mimeType is present (FR-37: PDF only)", () => {
      expect(() => feedbackAssetSchema.parse({ ...valid, mimeType: "image/png" })).toThrow();
    });

    it("accepts a material with only title and url — no file at all (PRD-42)", () => {
      expect(() =>
        feedbackAssetSchema.parse({ title: "Чек-лист", url: "https://example.com/checklist" }),
      ).not.toThrow();
    });

    it("accepts a legacy descriptor whose url is the relative media-library address (PRD-42 §7)", () => {
      const legacy = feedbackAssetSchema.parse({ title: "Памятка", url: "/api/media/asset-1" });
      expect(legacy.url).toBe("/api/media/asset-1");
    });
  });
  ```

  Также обнови блок JSDoc в шапке файла (строки 6-11) — замени:

  ```ts
   * Covers (decisions.md §3.4, §3.5, §4.3):
   *   - All required fields are enforced.
   *   - `format` enum is restricted to plain | richText | html.
   *   - `links` and `assets` arrays default to `[]` when missing.
   *   - `feedbackAsset.mimeType` is fixed to "application/pdf".
   *   - `feedbackAsset.scormHref` and `feedbackAsset.id` are optional.
  ```

  на:

  ```ts
   * Covers (decisions.md §3.4, §3.5, §4.3; PRD-42 §4):
   *   - All required fields are enforced.
   *   - `format` enum is restricted to plain | richText | html.
   *   - `links` and `assets` arrays default to `[]` when missing.
   *   - `feedbackAsset.mimeType`, when present, is fixed to "application/pdf".
   *   - `feedbackAsset.id`, `fileName`, `mimeType` and `scormHref` are all optional
   *     (PRD-42: a material is title + URL; the rest is legacy-only).
  ```

- [ ] **Step 2: Run tests to verify the new ones fail**

  Run: `npm test -- tests/schema-prd7-feedback.test.ts`
  Expected: FAIL on the two new PRD-42 tests (`fileName`/`mimeType` still required by the
  current schema, so `{ title, url }` without them throws) and on the renamed mimeType test
  (should still pass unchanged, but confirm the file runs).

- [ ] **Step 3: Relax the server schema**

  In `shared/schema.ts`, replace lines 898-916 (`export const feedbackAssetSchema = ...`) with:

  ```ts
  export const feedbackAssetSchema = z.object({
    id: z.string().optional(),
    title: z.string().min(1),
    /**
     * Legacy-only: descriptors saved through the retired upload flow (PRD-32) carry the
     * original file name. New rows (PRD-42, title + URL only) do not write it.
     */
    fileName: z.string().optional(),
    /** Legacy-only, see `fileName` above. */
    mimeType: z.literal("application/pdf").optional(),
    /**
     * The material's address. A plain, unvalidated string ON PURPOSE (PRD-42 §7 technical
     * debt): a descriptor saved through the retired upload flow still carries the relative
     * media-library address `/api/media/<id>` here, and tightening this to `.url()` (as
     * `feedbackLinkSchema` does) would make saving ANY test with such a legacy row fail
     * validation. New rows are expected to carry a real external URL, but nothing enforces it.
     */
    url: z.string().optional(),
    /**
     * Read-only legacy field: packages exported before the media library existed carry the
     * in-package address here. New code does not write it — the address belongs in `url`.
     */
    scormHref: z.string().optional(),
  });
  ```

- [ ] **Step 4: Relax the client type**

  In `client/src/features/tests/editor/test-editor.types.ts`, replace lines 63-75:

  ```ts
  /**
   * PDF asset attached to feedback. `url` is the canonical media-library address written by
   * the editor right after the upload; `scormHref` is the legacy in-package address kept for
   * reading old data only.
   */
  export type FeedbackAsset = {
    id?: string;
    title: string;
    fileName: string;
    mimeType: "application/pdf";
    url?: string;
    scormHref?: string;
  };
  ```

  with:

  ```ts
  /**
   * Material attached to feedback — title + external URL (PRD-42). `fileName`/`mimeType` are
   * legacy-only: descriptors saved through the retired upload flow (PRD-32) carry them, new
   * rows do not. `scormHref` is a legacy in-package address kept for reading old data only.
   */
  export type FeedbackAsset = {
    id?: string;
    title: string;
    fileName?: string;
    mimeType?: "application/pdf";
    url?: string;
    scormHref?: string;
  };
  ```

- [ ] **Step 5: Run tests to verify they pass**

  Run: `npm test -- tests/schema-prd7-feedback.test.ts`
  Expected: PASS, all tests including the two new ones.

  Run: `npm run check`
  Expected: no new TypeScript errors (both edits only widen types — nothing currently reads
  `fileName`/`mimeType` without a null-check that would now fail; verify this by reading the
  compiler output, not just assuming it).

- [ ] **Step 6: Commit**

  ```bash
  git add shared/schema.ts client/src/features/tests/editor/test-editor.types.ts tests/schema-prd7-feedback.test.ts
  git commit -m "$(cat <<'EOF'
  feat(prd-42): fileName/mimeType вложения обратной связи — опциональные

  Материал (PRD-42) — это title+url, без файла. fileName/mimeType остаются
  только для чтения legacy-дескрипторов, загруженных через отменённый
  аплоад (PRD-32).
  EOF
  )"
  ```

---

## Task 2: Редактор — секция «Материалы» вместо загрузки

**Files:**

- Modify: `client/src/features/tests/editor/sections/feedback-editor-modal.tsx`
- Modify: `client/src/features/tests/editor/sections/__tests__/feedback-editor-modal.test.tsx`
- Delete: `client/src/features/tests/editor/sections/__tests__/feedback-editor-modal-upload.test.tsx`

- [ ] **Step 1: Write the failing tests**

  In `client/src/features/tests/editor/sections/__tests__/feedback-editor-modal.test.tsx`,
  replace the whole `describe("<FeedbackEditorModal /> — PDF assets", ...)` block (lines
  228-337) with:

  ```tsx
  // ─── Tests: materials section (PRD-42 — link only, no upload) ───────────────

  describe("<FeedbackEditorModal /> — материалы", () => {
    it("shows no list when assets is empty, only the add button", () => {
      renderModal();
      expect(screen.queryByRole("list", { name: /Материалы/i })).not.toBeInTheDocument();
      expect(screen.getByTestId("feedback-editor-asset-add")).toBeInTheDocument();
    });

    it("hides the materials section when hideAssets=true", () => {
      renderModal({ hideAssets: true });
      expect(screen.queryByTestId("feedback-editor-asset-add")).not.toBeInTheDocument();
    });

    it("«Добавить материал» appends an editable {title, url} row", () => {
      renderModal();
      fireEvent.click(screen.getByTestId("feedback-editor-asset-add"));
      expect(screen.getByRole("list", { name: /Материалы/i })).toBeInTheDocument();
      expect(screen.getByTestId("feedback-editor-asset-title-0")).toBeInTheDocument();
      expect(screen.getByTestId("feedback-editor-asset-url-0")).toBeInTheDocument();
    });

    it("renders a legacy upload-descriptor as a plain editable row, no special banner", () => {
      renderModal({
        value: baseValue({
          assets: [
            {
              title: "Памятка по ИБ",
              fileName: "memo.pdf",
              mimeType: "application/pdf",
              url: "/api/media/asset-1",
            },
          ],
        }),
      });
      const titleInput = screen.getByTestId("feedback-editor-asset-title-0") as HTMLInputElement;
      const urlInput = screen.getByTestId("feedback-editor-asset-url-0") as HTMLInputElement;
      expect(titleInput.value).toBe("Памятка по ИБ");
      expect(urlInput.value).toBe("/api/media/asset-1");
      expect(screen.queryByTestId("feedback-editor-asset-missing-0")).not.toBeInTheDocument();
    });

    it("editing the url of a legacy row keeps its other fields on save", () => {
      const { onSave } = renderModal({
        value: baseValue({
          assets: [
            {
              title: "Памятка по ИБ",
              fileName: "memo.pdf",
              mimeType: "application/pdf",
              url: "/api/media/asset-1",
            },
          ],
        }),
      });
      fireEvent.change(screen.getByTestId("feedback-editor-asset-url-0"), {
        target: { value: "https://example.com/memo.pdf" },
      });
      fireEvent.click(screen.getByTestId("feedback-editor-save"));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          assets: [
            expect.objectContaining({
              title: "Памятка по ИБ",
              fileName: "memo.pdf",
              mimeType: "application/pdf",
              url: "https://example.com/memo.pdf",
            }),
          ],
        }),
      );
    });

    it("removes an asset row on trash click", () => {
      renderModal({
        value: baseValue({ assets: [{ title: "Doc", url: "https://example.com/doc" }] }),
      });
      expect(screen.getByRole("list", { name: /Материалы/i })).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("feedback-editor-asset-remove-0"));
      expect(screen.queryByRole("list", { name: /Материалы/i })).not.toBeInTheDocument();
    });

    it("onSave strips the UI-only uid from a newly added material", () => {
      const onSave = vi.fn();
      render(
        <FeedbackEditorModal
          open
          title="Test"
          value={baseValue()}
          onCancel={vi.fn()}
          onSave={onSave}
        />,
      );
      fireEvent.click(screen.getByTestId("feedback-editor-asset-add"));
      fireEvent.change(screen.getByTestId("feedback-editor-asset-title-0"), {
        target: { value: "Чек-лист" },
      });
      fireEvent.change(screen.getByTestId("feedback-editor-asset-url-0"), {
        target: { value: "https://example.com/checklist" },
      });
      fireEvent.click(screen.getByTestId("feedback-editor-save"));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          assets: [{ title: "Чек-лист", url: "https://example.com/checklist" }],
        }),
      );
    });
  });
  ```

  Also update the module docstring (line 11) — replace:

  ```tsx
   *   - PDF upload via hidden input: asset appears in draft; onSave strips the UI-only size.
  ```

  with:

  ```tsx
   *   - Materials list (assets): add/edit/remove a {title, url} row; a legacy upload
   *     descriptor (PRD-32) renders as a plain editable row; onSave strips the UI-only uid.
  ```

  Delete the whole file
  `client/src/features/tests/editor/sections/__tests__/feedback-editor-modal-upload.test.tsx`
  — every case in it exercises the retired upload flow (network mocking, checksum-dedup rows,
  the «Файл не загружен» replace flow), none of which exists after this task.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npm test -- client/src/features/tests/editor/sections/__tests__/feedback-editor-modal.test.tsx`
  Expected: FAIL — the component still renders the upload button/hidden input, not the
  `feedback-editor-asset-add`/`feedback-editor-asset-url-*` testids the new assertions expect.

- [ ] **Step 3: Rewrite the component**

  Replace the entire content of
  `client/src/features/tests/editor/sections/feedback-editor-modal.tsx` with:

  ```tsx
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
   *   4. Materials list — array of {title, url} editable rows + «Добавить материал»
   *      button, identical shape to the links list above (PRD-42). Not a file picker:
   *      the author types a real external URL. A descriptor saved before PRD-42
   *      through the retired upload flow (`url: /api/media/<id>`, or a legacy
   *      `scormHref`) is shown and edited the same way as any other row — its
   *      address is left as is unless the author types over it.
   *
   * Footer: «Отменить» (secondary) + «Сохранить» (primary).
   * The modal owns a draft copy of the values; on Save it emits via `onSave`.
   */
  import { useEffect, useRef, useState } from "react";
  import { CalendarDays, Link as LinkIcon, Plus, Trash2 } from "lucide-react";
  import {
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
    /** When true, the «Материалы» section is hidden entirely (e.g. for level feedback). */
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
   * Draft-only asset. Extends the canonical descriptor with a UI-only `uid` — row identity
   * for React, see {@link nextDraftUid}. Stripped before the value is emitted.
   */
  type DraftAsset = FeedbackAsset & { uid: string };

  type DraftValue = Omit<FeedbackEditorValue, "assets" | "events"> & {
    assets: DraftAsset[];
    /** Always a concrete array in the draft (normalized from the optional prop). */
    events: FeedbackEvent[];
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  let draftUidSeq = 0;

  /**
   * Issues a row identity for the assets list.
   *
   * The asset id from a legacy upload cannot serve as the React key: two rows saved from the
   * same upload (before PRD-42 retired it) can carry the SAME registry id — duplicate keys on
   * a list with editable fields and a delete button. The draft uid is unique per row by
   * construction and never leaves the modal.
   */
  function nextDraftUid(): string {
    return `draft-asset-${++draftUidSeq}`;
  }

  /** Gives every incoming descriptor a row identity (they arrive without one). */
  function toDraftAssets(assets: FeedbackAsset[]): DraftAsset[] {
    return assets.map((asset) => ({ ...asset, uid: nextDraftUid() }));
  }

  // ─── Component ────────────────────────────────────────────────────────────────

  /** @public */
  export function FeedbackEditorModal(props: FeedbackEditorModalProps) {
    const [draft, setDraft] = useState<DraftValue>(() => ({
      ...props.value,
      assets: toDraftAssets(props.value.assets),
      events: props.value.events ?? [],
    }));
    /** Ref to the contenteditable RTE area (richText mode only). */
    const rteRef = useRef<HTMLDivElement>(null);

    // S13.1-G39: link-insert modal state. `savedRange` captures the user's
    // selection inside the RTE before the modal steals focus, so submitting
    // the form can restore it and `createLink` wraps the original text.
    const [linkInsert, setLinkInsert] = useState<{
      url: string;
      text: string;
      savedRange: Range | null;
    } | null>(null);

    // Reset draft when the modal re-opens or receives a new value.
    // For richText format: initialize the RTE innerHTML via requestAnimationFrame
    // so the div is guaranteed to be mounted after the re-render triggered by setDraft.
    useEffect(() => {
      if (!props.open) return;
      const newVal = props.value;
      setDraft({ ...newVal, assets: toDraftAssets(newVal.assets), events: newVal.events ?? [] });
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

    /** Strip the UI-only `uid` before emitting to the caller. */
    function handleSave() {
      const canonical: FeedbackEditorValue = {
        ...draft,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        assets: draft.assets.map(({ uid: _u, ...rest }) => rest),
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
              <LinkIcon size={14} aria-hidden="true" />
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
                      icon={<Trash2 size={14} aria-hidden="true" />}
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
                leadingIcon={<Plus size={12} aria-hidden="true" />}
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
              <CalendarDays size={14} aria-hidden="true" />
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
                      icon={<Trash2 size={14} aria-hidden="true" />}
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
                leadingIcon={<Plus size={12} aria-hidden="true" />}
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

          {/* ── Materials section (data field `assets`; UI label «Материалы»,
              PRD-42) ─────────────────────────────────────────────────────── */}
          {!props.hideAssets && (
            <div className="tb-feedback-editor__section">
              <div className="tb-feedback-editor__sec-title">
                <LinkIcon size={14} aria-hidden="true" />
                Материалы
              </div>
              {draft.assets.length > 0 && (
                <ul className="tb-feedback-editor__list" aria-label="Материалы">
                  {/* Keyed by the draft uid, not the asset id: a legacy upload can hand two
                      rows one id. */}
                  {draft.assets.map((asset, i) => (
                    <li key={asset.uid} className="tb-feedback-editor__item">
                      <div className="tb-feedback-editor__item-fields">
                        <Input
                          size="s"
                          fullWidth
                          aria-label="Название материала"
                          value={asset.title}
                          placeholder="Название"
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
                        <Input
                          size="s"
                          fullWidth
                          type="url"
                          aria-label="URL материала"
                          value={asset.url ?? ""}
                          placeholder="https://…"
                          onChange={(e) => {
                            const url = e.target.value;
                            setDraft((d) => {
                              const assets = [...d.assets];
                              assets[i] = { ...assets[i], url };
                              return { ...d, assets };
                            });
                          }}
                          data-testid={`feedback-editor-asset-url-${i}`}
                        />
                      </div>
                      <IconButton
                        icon={<Trash2 size={14} aria-hidden="true" />}
                        aria-label={`Удалить материал ${i + 1}`}
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
              <div>
                <Button
                  variant="secondary"
                  size="s"
                  leadingIcon={<Plus size={12} aria-hidden="true" />}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      assets: [...d.assets, { uid: nextDraftUid(), title: "", url: "" }],
                    }))
                  }
                  data-testid="feedback-editor-asset-add"
                >
                  Добавить материал
                </Button>
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
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npm test -- client/src/features/tests/editor/sections/__tests__/feedback-editor-modal.test.tsx`
  Expected: PASS, every test including the new «материалы» describe block.

  Run: `npm run check`
  Expected: no TypeScript errors — confirm `Paperclip` (removed import), `Banner` (removed
  import), `fileInputRef`/`uploadsInFlight`/`visitRef`/`replaceIndex`/`oversizedFiles`/
  `uploadErrors` (all removed) do not linger anywhere else in the file, and that no other
  file in the repo imports anything that was removed from this module (this component only
  exports `FeedbackEditorModal`, `FeedbackFormat`, `FeedbackLink`, `FeedbackEvent`,
  `FeedbackEditorValue` — all kept).

- [ ] **Step 5: Confirm no other file references the retired testids**

  Run (PowerShell):

  ```powershell
  Select-String -Path client/src/features/tests/editor/**/*.tsx,client/src/features/tests/editor/**/*.ts -Pattern "feedback-editor-asset-upload|feedback-editor-asset-input|feedback-editor-asset-replace|feedback-editor-asset-missing|feedback-editor-oversize-banner|feedback-editor-upload-error-banner" -ErrorAction SilentlyContinue
  ```

  Expected: no matches (everything that used these testids was inside the deleted
  `feedback-editor-modal-upload.test.tsx` and the replaced describe block).

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/features/tests/editor/sections/feedback-editor-modal.tsx client/src/features/tests/editor/sections/__tests__/feedback-editor-modal.test.tsx
  git rm client/src/features/tests/editor/sections/__tests__/feedback-editor-modal-upload.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(prd-42): секция «Материалы» — ссылка вместо загрузки файла

  Вложение обратной связи теперь редактируемая строка {title, url}, по
  образцу «Курсы» — без выбора файла, без обращения к медиатеке. Легаси-
  строки (PRD-32, url вида /api/media/<id>) отображаются и правятся так
  же, их адрес никак не помечен и не блокирует сохранение.
  EOF
  )"
  ```

---

## Task 3: Сервер — удалить назначение `feedback-asset`

**Files:**

- Modify: `server/routes/media.ts:41-64`
- Modify: `tests/media-upload-route.test.ts:114-146`

- [ ] **Step 1: Write the failing test**

  In `tests/media-upload-route.test.ts`, replace the whole
  `describe("POST /upload?purpose=feedback-asset", ...)` block (lines 114-146) with:

  ```ts
  describe("POST /upload?purpose=feedback-asset (retired, PRD-42)", () => {
    it("больше не применяет строгую проверку — ведёт себя как обычная загрузка", async () => {
      storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue(undefined);
      storageMock.createMediaAsset.mockResolvedValue({
        id: "asset-1",
        mimeType: "image/png",
        byteSize: 5,
      });
      const res = await request(makeApp("author-1"))
        .post("/api/media/upload?purpose=feedback-asset")
        .attach("file", Buffer.from("hello"), { filename: "pic.png", contentType: "image/png" });
      // The `purpose` query param is no longer recognised: a non-PDF that used to be
      // rejected by the narrow feedback-asset rule now succeeds like any other upload.
      expect(res.status).toBe(200);
      expect(res.body.url).toBe("/api/media/asset-1");
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npm test -- tests/media-upload-route.test.ts`
  Expected: FAIL — the current handler still rejects the PNG with `400 feedback_asset_invalid`
  because `purpose=feedback-asset` is still recognised.

- [ ] **Step 3: Remove the branch**

  In `server/routes/media.ts`, delete the comment + constant at lines 41-47:

  ```ts
  /**
   * Feedback attachments are the one upload with a narrow contract (spec §8): the shared
   * filter admits 200 MB of any image, audio or video, which is right for question media and
   * far too wide for a PDF handed to a learner. The narrow rule lives here rather than in the
   * multer filter because only the request knows what the file is FOR.
   */
  const FEEDBACK_ASSET_MAX_BYTES = 5 * 1024 * 1024;

  ```

  and delete the block at (now-shifted) lines 52-64:

  ```ts
    if (req.query.purpose === "feedback-asset") {
      const wrongType = req.file.mimetype !== "application/pdf";
      const tooBig = req.file.size > FEEDBACK_ASSET_MAX_BYTES;
      if (wrongType || tooBig) {
        fs.rmSync(req.file.path, { force: true });
        return res.status(400).json({
          error: "feedback_asset_invalid",
          message: wrongType
            ? "Вложением обратной связи может быть только PDF"
            : "Размер вложения не должен превышать 5 МБ",
        });
      }
    }

  ```

  leaving the handler starting directly with:

  ```ts
  router.post("/upload", requireAuth, mediaUpload.single("file"), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const ownerId = req.session.userId as string;
    // Busboy decodes the multipart filename as latin1 by default, so a UTF-8
    // (e.g. Cyrillic) original name arrives mojibake — re-decode it to UTF-8.
    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
  ```

  Check whether `fs` is still used elsewhere in `server/routes/media.ts` (Grep the file for
  `fs\.` after the edit). If this was the only use, remove the now-unused
  `import fs from "node:fs";` too — otherwise leave the import as is.

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npm test -- tests/media-upload-route.test.ts`
  Expected: PASS, all tests in the file.

  Run: `npm run check`
  Expected: no TypeScript errors (in particular, no unused-import error for `fs` if it was
  removed, and no error if it was correctly kept because other routes in the file still use it).

- [ ] **Step 5: Commit**

  ```bash
  git add server/routes/media.ts tests/media-upload-route.test.ts
  git commit -m "$(cat <<'EOF'
  feat(prd-42): удалить назначение purpose=feedback-asset из /api/media/upload

  Единственный вызывающий (загрузка PDF-вложения обратной связи) удалён
  вместе с секцией «Материалы» — маршрут стал мёртвой веткой без клиента.
  EOF
  )"
  ```

---

## Task 4: Эскиз — обновить `prd7-editor-drawer.html`

**Files:**

- Modify: `docs/wireframes/approved/prd7-editor-drawer.html:1111-1139`

Компонент `feedback-editor-modal.tsx` в своей шапке ссылается на этот эскиз как на источник
разметки состояния `s-feedback-edit`. Блок «PDF assets section» в нём всё ещё показывает
загрузку файла — приводим его к тому же виду, что и уже принятая соседняя секция ссылок в этом
же файле (строки 1090-1109), чтобы эскиз не расходился с кодом.

- [ ] **Step 1: Replace the PDF-assets block**

  In `docs/wireframes/approved/prd7-editor-drawer.html`, replace lines 1111-1139:

  ```html
        <!-- PDF assets section (FR-37) -->
        <span class="wf-annot-wrap--block">
        <div class="tb-feedback-editor__section">
          <div class="tb-feedback-editor__sec-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="#i-paperclip"/></svg>
            Прикреплённые файлы (PDF)
          </div>
          <ul class="tb-feedback-editor__list" aria-label="Прикреплённые файлы">
            <li class="tb-feedback-editor__item">
              <div class="tb-feedback-editor__asset">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tb-feedback-editor__asset-ico" aria-hidden="true"><use href="#i-paperclip"/></svg>
                <div class="tb-feedback-editor__asset-meta">
                  <div class="ou-field ou-field--s ou-field--full"><div class="ou-field__box"><input class="ou-field__input" type="text" value="Памятка по информационной безопасности" aria-label="Название файла"></div></div>
                  <div class="tb-feedback-editor__asset-file">security-basics.pdf · 245 KB</div>
                </div>
              </div>
              <button type="button" class="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s" aria-label="Удалить файл"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#i-trash"/></svg></button>
            </li>
          </ul>
          <div class="tb-feedback-editor__upload">
            <button type="button" class="ou-btn ou-btn--secondary ou-btn--s">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="#i-plus"/></svg>
              Загрузить PDF
            </button>
            <span class="tb-feedback-editor__upload-hint">PDF до 5 MB; попадёт в SCORM-пакет и доступен по download-link</span>
          </div>
        </div>
        <span class="wf-annot">FR-37</span>
        </span>
  ```

  with:

  ```html
        <!-- Materials section (PRD-42 — link only, no upload) -->
        <span class="wf-annot-wrap--block">
        <div class="tb-feedback-editor__section">
          <div class="tb-feedback-editor__sec-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="#i-link"/></svg>
            Материалы
          </div>
          <ul class="tb-feedback-editor__list" aria-label="Материалы">
            <li class="tb-feedback-editor__item">
              <div class="tb-feedback-editor__item-fields">
                <div class="ou-field ou-field--s ou-field--full"><div class="ou-field__box"><input class="ou-field__input" type="text" value="Памятка по информационной безопасности" aria-label="Название материала"></div></div>
                <div class="ou-field ou-field--s ou-field--full"><div class="ou-field__box"><input class="ou-field__input" type="url" value="https://wiki.internal/security-basics.pdf" aria-label="URL материала"></div></div>
              </div>
              <button type="button" class="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s" aria-label="Удалить материал"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#i-trash"/></svg></button>
            </li>
          </ul>
          <button type="button" class="ou-btn ou-btn--secondary ou-btn--s">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="#i-plus"/></svg>
            Добавить материал
          </button>
        </div>
        <span class="wf-annot">PRD-42</span>
        </span>
  ```

- [ ] **Step 2: Verify the file still opens**

  Открой `docs/wireframes/approved/prd7-editor-drawer.html` в браузере (двойной клик или
  `start` на Windows), перейди в состояние `s-feedback-edit` и убедись, что секция
  «Материалы» рендерится без ошибок разметки рядом с «Ссылки на материалы» — визуально они
  теперь идентичны по структуре.

- [ ] **Step 3: Commit**

  ```bash
  git add docs/wireframes/approved/prd7-editor-drawer.html
  git commit -m "$(cat <<'EOF'
  docs(prd-42): эскиз — секция «Материалы» вместо загрузки PDF

  Синхронизирует s-feedback-edit с фактической реализацией
  feedback-editor-modal.tsx после PRD-42.
  EOF
  )"
  ```

---

## Task 5: Итоговая проверка

**Files:** нет изменений — только прогон и грепы.

- [ ] **Step 1: Целевой прогон всех затронутых тестов**

  Run:

  ```bash
  npm test -- tests/schema-prd7-feedback.test.ts tests/media-upload-route.test.ts client/src/features/tests/editor/sections/__tests__/feedback-editor-modal.test.tsx
  ```

  Expected: PASS, все тесты во всех трёх файлах.

- [ ] **Step 2: Смежные тесты, которые НЕ должны были измениться (регрессия)**

  Run:

  ```bash
  npm test -- tests/results-feedback-assets-scorm.test.ts shared/template/__tests__/result-context-feedback-assets.test.ts
  ```

  Expected: PASS без изменений — они конструируют вложения напрямую и не зависят от
  редактора/маршрута загрузки (§2 спеки — вне охвата).

- [ ] **Step 3: Полная типизация**

  Run: `npm run check`
  Expected: PASS без ошибок.

- [ ] **Step 4: Убедиться, что нигде не осталась мёртвая ссылка на удалённое поведение**

  Run (PowerShell):

  ```powershell
  Select-String -Path server,client,shared,tests -Pattern "purpose=feedback-asset|feedback_asset_invalid|FEEDBACK_ASSET_MAX_BYTES" -Recurse -ErrorAction SilentlyContinue
  ```

  Expected: 0 совпадений — маршрут, код ошибки и константа лимита нигде не упоминаются вне
  git-истории.

- [ ] **Step 5: Ручная проверка в браузере — редактор**

  Подними dev-сервер (`npm run dev` уже поднят другой сессией — либо используй
  `PORT=8099 npm run dev` для второго экземпляра, см. `reference_dev_second_instance` в
  памяти). Открой редактор теста → «Настройки» → «Обратная связь» (или любой другой контекст
  с секцией вложений) и вручную:
  - добавь материал (заполни название и `https://…` URL), сохрани, переоткрой — значения
    на месте, кнопки загрузки файла нет;
  - если под рукой есть тест с уже существующим вложением, загруженным ДО этой работы,
    открой его и убедись, что строка отображается как обычное редактируемое поле, без
    падений и без предупреждений в консоли браузера.

- [ ] **Step 6: Сквозная проверка — ссылка в PDF-отчёте рабочая**

  Это проверка самой причины задачи (см. §1 спеки), а не кода, изменённого в этом плане —
  `shared/report/export-pdf.ts` не трогали, эффект достигается только сменой модели данных.

  На тесте, у которого есть шкала или показатель с обратной связью и включённым PDF-отчётом
  (или создай временный тест с таким исходом), добавь в секции «Материалы» новую запись с
  заведомо настоящим `https://…` URL и сохрани. Через «Тестовый прогон» (`/author/tests/:id/debug`
  — см. `feedback_no_live_webtutor_verify_local` в памяти, WebTutor недоступен, проверяем
  локально) пройди тест до экрана итогов с этим исходом, скачай PDF-отчёт и открой его.
  Убедись, что:
  - ссылка на новый материал в PDF ведёт РОВНО на введённый `https://…` адрес (не на
    `/api/media/...` и не на путь внутри пакета);
  - клик по ссылке в PDF-читалке открывает её как обычный внешний URL.

  Если под рукой есть тест с легаси-вложением (загруженным до этой работы), тем же путём
  скачай его PDF-отчёт и убедись, что ссылка на материал по-прежнему битая — это ожидаемо
  и зафиксировано как технический долг (спека §7), а не регрессия этой задачи.
