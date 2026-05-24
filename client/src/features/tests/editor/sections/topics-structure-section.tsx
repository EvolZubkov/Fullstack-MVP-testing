/**
 * @module features/tests/editor/sections/topics-structure-section
 * @description Editor section for the «Состав» tab (PRD-7 wireframe
 * `prd7-editor-drawer.html` state s-default).
 *
 * Renders the list of topics that make up the test as `tb-topic-row`s with:
 *   - header: topic name + «Обязательная» tag + total questions in the topic
 *   - body: draw-count number input (range 1..maxQuestions) and a feedback
 *     preview block (read-only for now; the edit modal — FR-36/FR-37 — lives
 *     in a separate ticket)
 *   - per-row remove button (small ghost X) that drops the section from the
 *     draft
 *
 * A «+ Добавить тему» button at the bottom opens a topic picker modal listing
 * topics not yet in the test; clicking one appends a new section with a
 * default `drawCount` of `min(maxQuestions, 5)` and `required: false`.
 *
 * The «Обязательная» flag is shown read-only here; its toggle lives in the
 * «Настройки» tab per the wireframe's aria-label hint.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, X, Link as LinkIcon, Paperclip } from "lucide-react";
import type { Topic } from "@shared/schema";
import type {
  EditorSection,
  TestEditorModel,
} from "../test-editor.types";

// ─── Public API ───────────────────────────────────────────────────────────────

export type CompositionSectionProps = {
  /** Current draft model. */
  model: TestEditorModel;
  /** Editor draft mutator (forwarded from {@link useTestEditor}). */
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
};

/** Backwards-compatible alias: original skeleton lived under this name. */
export type TopicsStructureSectionProps = CompositionSectionProps;

type TopicWithQuestionCount = Topic & { questionCount: number };

async function fetchTopicsWithCount(): Promise<TopicWithQuestionCount[]> {
  const res = await fetch("/api/topics", { credentials: "include" });
  if (!res.ok) {
    throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  }
  return res.json() as Promise<TopicWithQuestionCount[]>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CompositionSection({ model, updateModel }: CompositionSectionProps) {
  const { data: allTopics = [] } = useQuery<TopicWithQuestionCount[]>({
    queryKey: ["/api/topics"],
    queryFn: fetchTopicsWithCount,
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  const usedTopicIds = useMemo(
    () => new Set(model.sections.map((s) => s.topicId)),
    [model.sections],
  );
  const availableTopics = useMemo(
    () => allTopics.filter((t) => !usedTopicIds.has(t.id)),
    [allTopics, usedTopicIds],
  );

  const updateSection = (topicId: string, patch: Partial<EditorSection>) => {
    updateModel((m) => ({
      ...m,
      sections: m.sections.map((s) =>
        s.topicId === topicId ? { ...s, ...patch } : s,
      ),
    }));
  };

  const removeSection = (topicId: string) => {
    updateModel((m) => ({
      ...m,
      sections: m.sections.filter((s) => s.topicId !== topicId),
      passRules: {
        ...m.passRules,
        byTopic: Object.fromEntries(
          Object.entries(m.passRules.byTopic).filter(([id]) => id !== topicId),
        ),
      },
    }));
  };

  const addTopic = (topic: TopicWithQuestionCount) => {
    const drawCount = Math.min(topic.questionCount, 5) || 1;
    updateModel((m) => ({
      ...m,
      sections: [
        ...m.sections,
        {
          topicId: topic.id,
          topicName: topic.name,
          maxQuestions: topic.questionCount,
          drawCount,
          required: false,
          timeLimit: { source: "inherit_test" },
          feedback: { format: "plain", text: "" },
          feedbackLinks: [],
          feedbackAssets: [],
        },
      ],
    }));
    setPickerOpen(false);
  };

  return (
    <>
      <div className="tb-section-label">Темы и выборка вопросов</div>

      {model.sections.length === 0 && (
        <div
          className="ou-empty ou-empty--inline ou-empty--well"
          data-testid="composition-empty"
        >
          <div className="ou-empty__content">
            <div className="ou-empty__title">Пока нет ни одной темы</div>
            <div className="ou-empty__desc">
              Добавьте темы, из которых будут отбираться вопросы. Минимум одна
              тема обязательна для сохранения теста (FR-12).
            </div>
          </div>
        </div>
      )}

      {model.sections.map((section) => (
        <TopicRow
          key={section.topicId}
          section={section}
          onChangeDrawCount={(n) => updateSection(section.topicId, { drawCount: n })}
          onRemove={() => removeSection(section.topicId)}
        />
      ))}

      <button
        type="button"
        className="ou-btn ou-btn--secondary ou-btn--m ou-btn--full"
        onClick={() => setPickerOpen(true)}
        data-testid="composition-add-topic"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Добавить тему
      </button>

      {pickerOpen && (
        <TopicPickerModal
          topics={availableTopics}
          onPick={addTopic}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

/** Backwards-compatible re-export under the old skeleton name. */
export const TopicsStructureSection = CompositionSection;

// ─── Sub-components ───────────────────────────────────────────────────────────

function TopicRow(props: {
  section: EditorSection;
  onChangeDrawCount: (n: number) => void;
  onRemove: () => void;
}) {
  const { section } = props;
  const maxQ = Math.max(section.maxQuestions, 1);

  return (
    <div className="tb-topic-row" data-testid={`topic-row-${section.topicId}`}>
      <div className="tb-topic-row__header">
        <span className="tb-topic-row__name">{section.topicName}</span>
        {section.required && (
          <span
            className="ou-tag ou-tag--neutral ou-tag--outline"
            aria-label="Тема обязательная — задаётся в Настройках"
          >
            Обязательная
          </span>
        )}
        <span className="tb-topic-row__count">
          {section.maxQuestions} вопрос{plural(section.maxQuestions)}
        </span>
        <button
          type="button"
          className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
          aria-label={`Убрать тему «${section.topicName}»`}
          onClick={props.onRemove}
          data-testid={`topic-remove-${section.topicId}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="tb-topic-row__body">
        <div className="tb-draw-count-row">
          <span className="tb-draw-count-row__label">Вопросов в тест</span>
          <div className="ou-field ou-field--s">
            <div className="ou-field__box">
              <input
                className="ou-field__input"
                type="number"
                min={1}
                max={maxQ}
                value={section.drawCount}
                onChange={(e) => {
                  const next = Math.max(1, Math.min(maxQ, Number(e.target.value) || 1));
                  props.onChangeDrawCount(next);
                }}
                aria-label={`Количество вопросов из темы ${section.topicName}`}
                data-testid={`topic-drawcount-${section.topicId}`}
              />
            </div>
          </div>
          <span className="tb-draw-count-row__max">из {section.maxQuestions}</span>
        </div>
        <div className="tb-card-desc">Обратная связь по теме</div>
        <FeedbackPreview section={section} />
      </div>
    </div>
  );
}

function FeedbackPreview({ section }: { section: EditorSection }) {
  const hasText = section.feedback.text.trim() !== "";
  const linkCount = section.feedbackLinks.length;
  const assetCount = section.feedbackAssets.length;

  if (!hasText && linkCount === 0 && assetCount === 0) {
    return (
      <div
        className="tb-feedback-preview is-empty"
        title="Редактирование feedback — FR-36, реализуется отдельным шагом"
      >
        Не задано — обратная связь по теме пока не настроена
      </div>
    );
  }

  const snippet = hasText
    ? section.feedback.text.replace(/<[^>]+>/g, "").slice(0, 80)
    : "Без текста";

  return (
    <div
      className="tb-feedback-preview"
      title="Редактирование feedback — FR-36, реализуется отдельным шагом"
    >
      <div className="tb-feedback-preview__text">
        <span className="tb-feedback-preview__snippet">{snippet}</span>
        <button
          type="button"
          className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
          aria-label="Редактировать обратную связь"
          disabled
          title="Редактирование feedback — FR-36, отдельный шаг"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      {(linkCount > 0 || assetCount > 0) && (
        <div className="tb-feedback-preview__meta">
          {linkCount > 0 && (
            <>
              <LinkIcon aria-hidden="true" />
              {linkCount} ссыл{plural(linkCount, "ка", "ки", "ок")}
            </>
          )}
          {linkCount > 0 && assetCount > 0 && (
            <span className="tb-feedback-preview__sep">·</span>
          )}
          {assetCount > 0 && (
            <>
              <Paperclip aria-hidden="true" />
              {assetCount} файл{plural(assetCount)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TopicPickerModal(props: {
  topics: TopicWithQuestionCount[];
  onPick: (topic: TopicWithQuestionCount) => void;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = props.topics.filter((t) =>
    t.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div
      className="ou-modal-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="topic-picker-title"
      data-testid="topic-picker-modal"
    >
      <div className="ou-modal__backdrop" onClick={props.onCancel} />
      <div className="ou-modal ou-modal--m">
        <div className="ou-modal__head">
          <div className="ou-modal__head-text">
            <p className="ou-modal__title" id="topic-picker-title">Добавить тему</p>
            <p className="ou-modal__desc">
              Выберите тему, вопросы из которой попадут в тест.
            </p>
          </div>
          <button
            type="button"
            className="ou-modal__close"
            aria-label="Закрыть"
            onClick={props.onCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="ou-modal__body">
          <div className="ou-field ou-field--m tb-topic-picker__search">
            <div className="ou-field__box">
              <input
                className="ou-field__input"
                type="text"
                placeholder="Поиск по названию..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoFocus
                data-testid="topic-picker-search"
              />
            </div>
          </div>
          <ul className="tb-topic-picker__list">
            {filtered.length === 0 && (
              <li className="tb-topic-picker__empty">
                {props.topics.length === 0
                  ? "Все темы уже добавлены в тест"
                  : "Ничего не найдено"}
              </li>
            )}
            {filtered.map((topic) => (
              <li key={topic.id}>
                <button
                  type="button"
                  className="tb-topic-picker__item"
                  onClick={() => props.onPick(topic)}
                  data-testid={`topic-picker-item-${topic.id}`}
                >
                  <span>{topic.name}</span>
                  <span className="tb-topic-picker__item-count">
                    {topic.questionCount} вопрос{plural(topic.questionCount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="ou-modal__foot">
          <button
            type="button"
            className="ou-btn ou-btn--ghost ou-btn--s"
            onClick={props.onCancel}
            data-testid="topic-picker-cancel"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function plural(
  n: number,
  one: string = "",
  few: string = "а",
  many: string = "ов",
): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
