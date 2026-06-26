/**
 * @module features/tests/editor/sections/variants-editor
 * @description PRD-17 (BR-12) fixed-variant editor for a topic row of the «Состав»
 * tab. A Switch turns the section into "variants mode": one author-curated variant
 * is delivered whole (the draw controls are then hidden by the parent). The inline
 * block shows a per-variant size table, a coverage line (how many of the topic's
 * questions are used in any variant, FR-18) and a «Настроить варианты…» button that
 * opens a modal — tabs per variant + a TransferList «банк темы ↔ вариант».
 *
 * Variants are positional and auto-numbered «Вариант N» (no author labels, D-10).
 * Validation (>= 2 variants, each non-empty) lives in test-editor.validation; this
 * component just edits the draft `formSet`.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleDot, CheckSquare, Unplug, ListOrdered, List, Plus, Trash2, type LucideIcon } from "lucide-react";
import { Button, ModalDialog, Switch, Tabs, Tag, TransferList, type TransferItem } from "@universityrt/ui-kit";
import type { FormSet, Form } from "@shared/schema";
import type { QuestionType } from "@shared/scales/engine";
import { pluralize } from "@/lib/i18n";

// ─── Public API ───────────────────────────────────────────────────────────────

export type VariantsEditorProps = {
  topicId: string;
  topicName: string;
  /** Current draft variant set (null = variants mode off). */
  formSet: FormSet | null;
  /** Mutate the section's variant set (null clears variants mode). */
  onChange: (formSet: FormSet | null) => void;
  /** Validation message for this section's variants (red state). */
  error?: string;
  /** Adaptive mode: variants don't apply — show the toggle disabled, not hidden. */
  disabled?: boolean;
};

// ─── Question display helpers ───────────────────────────────────────────────────

/** Minimal question shape the editor needs from `/api/questions`. */
type QuestionRow = { id: string; topicId: string; type: QuestionType; prompt: string };

const TYPE_ICON: Record<QuestionType, LucideIcon> = {
  single: CircleDot,
  multiple: CheckSquare,
  matching: Unplug,
  ranking: ListOrdered,
};
const TYPE_LABEL: Record<QuestionType, string> = {
  single: "Одиночный выбор",
  multiple: "Множественный выбор",
  matching: "Сопоставление",
  ranking: "Ранжирование",
};

function makeForm(index: number): Form {
  return { id: crypto.randomUUID(), label: `Вариант ${index}`, questionIds: [] };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VariantsEditor({ topicId, topicName, formSet, onChange, error, disabled = false }: VariantsEditorProps) {
  const [open, setOpen] = useState(false);
  const { data: allQuestions = [] } = useQuery<QuestionRow[]>({ queryKey: ["/api/questions"] });
  const topicQuestions = useMemo(
    () => allQuestions.filter((q) => q.topicId === topicId),
    [allQuestions, topicId],
  );

  const enabled = formSet != null;
  // When force-disabled (adaptive) the toggle stays visible but greyed and the
  // summary/modal collapse — the variant set, if any, is preserved but inactive.
  const active = enabled && !disabled;

  const toggle = (on: boolean) => {
    if (!on) return onChange(null);
    onChange({ forms: [makeForm(1), makeForm(2)] });
    setOpen(true);
  };

  // FR-18: coverage of the topic bank by the variants.
  const usedIds = useMemo(
    () => new Set(formSet?.forms.flatMap((f) => f.questionIds) ?? []),
    [formSet],
  );
  const present = topicQuestions.filter((q) => usedIds.has(q.id)).length;
  const orphan = topicQuestions.length - present;

  // R-9: unequal variant sizes skew fairness (an absolute pass threshold loses
  // meaning across differently sized variants) — surface a non-blocking warning.
  // Only meaningful once every variant has questions; empty variants are flagged
  // by their own «0» tag and a save-blocking validation error instead.
  const sizes = formSet?.forms.map((f) => f.questionIds.length) ?? [];
  const allFilled = sizes.length > 0 && sizes.every((n) => n > 0);
  const balanced = allFilled && sizes.every((n) => n === sizes[0]);

  return (
    <>
      <label className="tb-quota-toggle">
        <Switch
          checked={enabled}
          disabled={disabled}
          onChange={(e) => toggle(e.target.checked)}
          aria-label={`Варианты теста: ${topicName}`}
          data-testid={`topic-variants-toggle-${topicId}`}
        />
        <span className="tb-section-label">
          <List size={14} aria-hidden="true" />
          Варианты теста
        </span>
      </label>

      {disabled ? (
        <div className="tb-card-desc" data-testid={`topic-variants-disabled-${topicId}`}>
          Недоступно в адаптивном режиме — выборка идёт по уровням сложности.
        </div>
      ) : !enabled ? (
        <div className="tb-card-desc">
          Выключено — выдача из всего банка темы. Включите, чтобы раздавать заранее скурированные
          варианты и менять вариант на повторе.
        </div>
      ) : null}

      {active && formSet && (
        <div className="tb-quota-block" data-testid={`topic-variants-block-${topicId}`}>
          <table className="tb-table">
            <thead>
              <tr>
                <th>Вариант</th>
                <th>Вопросов в варианте</th>
              </tr>
            </thead>
            <tbody>
              {formSet.forms.map((f) => (
                <tr key={f.id}>
                  <td>{f.label}</td>
                  <td>
                    {f.questionIds.length === 0 ? (
                      <Tag tone="error" size="s">0</Tag>
                    ) : (
                      f.questionIds.length
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="tb-quota-actions">
            <Button
              variant="secondary"
              size="s"
              leadingIcon={<List size={16} aria-hidden="true" />}
              onClick={() => setOpen(true)}
              data-testid={`topic-variants-configure-${topicId}`}
            >
              Настроить варианты…
            </Button>
          </div>

          <div className="tb-quota-sum">
            <span>
              В вариантах задействовано <strong>{present}</strong> из {topicQuestions.length} вопросов
              темы{orphan > 0 ? ` · ${orphan} не используются` : ""}
            </span>
            {orphan > 0 ? (
              <Tag tone="warning" size="s">{orphan} не используются</Tag>
            ) : (
              <Tag tone="success" size="s">все задействованы</Tag>
            )}
          </div>

          {allFilled && (
            <div className="tb-quota-sum" data-testid={`topic-variants-balance-${topicId}`}>
              {balanced ? (
                <>
                  <span>
                    {sizes.length} {pluralize(sizes.length, "вариант", "варианта", "вариантов")} по{" "}
                    {sizes[0]} · при старте темы выпадает один, выдаётся целиком; на повторе — другой
                  </span>
                  <Tag tone="success" size="s">сбалансировано</Tag>
                </>
              ) : (
                <>
                  <span>Варианты {sizes.join(" / ")} — неравные</span>
                  <Tag tone="warning" size="s">неравные варианты</Tag>
                </>
              )}
            </div>
          )}

          {error && (
            <p className="tb-field-error" role="alert" data-testid={`topic-variants-error-${topicId}`}>
              {error}
            </p>
          )}
        </div>
      )}

      {active && formSet && (
        <VariantsModal
          open={open}
          onClose={() => setOpen(false)}
          topicName={topicName}
          formSet={formSet}
          questions={topicQuestions}
          onChange={onChange}
        />
      )}
    </>
  );
}

// ─── Modal: per-variant question picker ─────────────────────────────────────────

const ADD_TAB = "__add__";

function VariantsModal(props: {
  open: boolean;
  onClose: () => void;
  topicName: string;
  formSet: FormSet;
  questions: QuestionRow[];
  onChange: (formSet: FormSet) => void;
}) {
  const { open, onClose, topicName, formSet, questions, onChange } = props;
  const forms = formSet.forms;
  const [activeId, setActiveId] = useState<string>(forms[0]?.id ?? "");

  // Keep the active tab valid as variants are added/removed.
  const activeIndex = Math.max(0, forms.findIndex((f) => f.id === activeId));
  const active = forms[activeIndex] ?? forms[0];

  const qById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  // questionId -> variant numbers it belongs to (1-based form position).
  const membership = useMemo(() => {
    const map = new Map<string, number[]>();
    forms.forEach((f, i) => {
      for (const qid of f.questionIds) {
        const list = map.get(qid) ?? [];
        list.push(i + 1);
        map.set(qid, list);
      }
    });
    return map;
  }, [forms]);

  const setForms = (next: Form[]) => onChange({ forms: next });
  const updateForm = (id: string, questionIds: string[]) =>
    setForms(forms.map((f) => (f.id === id ? { ...f, questionIds } : f)));
  const addVariant = () => {
    const created = makeForm(forms.length + 1);
    setForms([...forms, created]);
    setActiveId(created.id);
  };
  const removeVariant = (id: string) => {
    const next = forms
      .filter((f) => f.id !== id)
      // Re-number remaining variants so labels stay «Вариант 1…N».
      .map((f, i) => ({ ...f, label: `Вариант ${i + 1}` }));
    setForms(next);
    setActiveId(next[Math.min(activeIndex, next.length - 1)]?.id ?? "");
  };

  const toItem = (q: QuestionRow): TransferItem => {
    const Icon = TYPE_ICON[q.type] ?? CircleDot;
    const others = (membership.get(q.id) ?? []).filter((n) => n !== activeIndex + 1);
    return {
      id: q.id,
      name: q.prompt,
      icon: (
        <span className="tb-variant-qtype" title={TYPE_LABEL[q.type]}>
          <Icon size={16} aria-hidden="true" />
        </span>
      ),
      meta: TYPE_LABEL[q.type],
      tag:
        others.length > 0 ? (
          <span title={`Также в вариантах: ${others.join(", ")}`}>
            {others.map((n) => (
              <Tag key={n} tone="neutral" size="s">{n}</Tag>
            ))}
          </span>
        ) : undefined,
    };
  };

  const assignedIds = new Set(active?.questionIds ?? []);
  const assigned = (active?.questionIds ?? [])
    .map((id) => qById.get(id))
    .filter((q): q is QuestionRow => Boolean(q))
    .map(toItem);
  const available = questions.filter((q) => !assignedIds.has(q.id)).map(toItem);

  const used = new Set(forms.flatMap((f) => f.questionIds));
  const orphan = questions.length - questions.filter((q) => used.has(q.id)).length;

  const tabItems = [
    ...forms.map((f) => ({ id: f.id, label: f.label, badge: f.questionIds.length })),
    { id: ADD_TAB, label: "Вариант", icon: <Plus size={14} aria-hidden="true" /> },
  ];

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      title={`Варианты теста — тема «${topicName}»`}
      description="Соберите каждый вариант из вопросов банка темы. Выпавший вариант выдаётся целиком, в случайном порядке."
      footer={
        <div className="tb-variants-modal__foot">
          <span className="tb-card-desc">
            {forms.length} вариант(а/ов) · в вариантах задействовано {questions.length - orphan} из{" "}
            {questions.length}
            {orphan > 0 ? ` · ${orphan} не используются` : ""}
          </span>
          <Button variant="primary" onClick={onClose} data-testid="variants-modal-done">
            Готово
          </Button>
        </div>
      }
      data-testid={`variants-modal-${active?.id ?? ""}`}
    >
      <div className="tb-variants-modal__toolbar">
        <Tabs
          items={tabItems}
          value={active?.id}
          onChange={(id) => (id === ADD_TAB ? addVariant() : setActiveId(id))}
          variant="underline"
          size="m"
          hidePanel
        />
        <Button
          variant="ghost"
          size="s"
          leadingIcon={<Trash2 size={16} aria-hidden="true" />}
          disabled={forms.length <= 2}
          onClick={() => active && removeVariant(active.id)}
          data-testid="variants-modal-remove"
        >
          Удалить вариант
        </Button>
      </div>

      <TransferList
        available={available}
        assigned={assigned}
        leftTitle="Банк темы"
        rightTitle={active?.label ?? "Вариант"}
        searchPlaceholder="Поиск по тексту"
        onChange={({ assigned: next }) => active && updateForm(active.id, next.map((i) => i.id))}
      />
    </ModalDialog>
  );
}
