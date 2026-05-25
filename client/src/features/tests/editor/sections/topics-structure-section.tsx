/**
 * @module features/tests/editor/sections/topics-structure-section
 * @description Editor section for the «Состав» tab (PRD-7 wireframe
 * `prd7-editor-drawer.html` state s-default / s-feedback-edit).
 *
 * Renders the list of topics that make up the test as `tb-topic-row`s with:
 *   - header: topic name + «Обязательная» tag + total questions in the topic
 *   - body: draw-count number input (range 1..maxQuestions) and a feedback
 *     preview block; clicking the preview opens FeedbackEditorModal (FR-36/37)
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
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  ModalDialog,
  NumberInput,
  Tag,
} from "@universityrt/ui-kit";
import { FeedbackEditorModal } from "./feedback-editor-modal";
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
        <EmptyState
          layout="inline"
          well
          title="Пока нет ни одной темы"
          description="Добавьте темы, из которых будут отбираться вопросы. Минимум одна тема обязательна для сохранения теста (FR-12)."
          data-testid="composition-empty"
        />
      )}

      {model.sections.map((section) => (
        <TopicRow
          key={section.topicId}
          section={section}
          onChangeDrawCount={(n) => updateSection(section.topicId, { drawCount: n })}
          onRemove={() => removeSection(section.topicId)}
          onSaveFeedback={(patch) => updateSection(section.topicId, patch)}
        />
      ))}

      <Button
        variant="secondary"
        size="m"
        fullWidth
        leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        onClick={() => setPickerOpen(true)}
        data-testid="composition-add-topic"
      >
        Добавить тему
      </Button>

      <TopicPickerModal
        open={pickerOpen}
        topics={availableTopics}
        onPick={addTopic}
        onCancel={() => setPickerOpen(false)}
      />
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
  /** Called with a partial EditorSection patch when feedback is saved. */
  onSaveFeedback: (patch: Partial<EditorSection>) => void;
}) {
  const { section } = props;
  const maxQ = Math.max(section.maxQuestions, 1);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <>
      <div className="tb-topic-row" data-testid={`topic-row-${section.topicId}`}>
        <div className="tb-topic-row__header">
          <span className="tb-topic-row__name">{section.topicName}</span>
          {section.required && (
            <Tag
              tone="neutral"
              variant="outline"
              aria-label="Тема обязательная — задаётся в Настройках"
            >
              Обязательная
            </Tag>
          )}
          <span className="tb-topic-row__count">
            {section.maxQuestions} вопрос{plural(section.maxQuestions)}
          </span>
          <IconButton
            icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
            aria-label={`Убрать тему «${section.topicName}»`}
            variant="ghost"
            size="s"
            onClick={props.onRemove}
            data-testid={`topic-remove-${section.topicId}`}
          />
        </div>
        <div className="tb-topic-row__body">
          <div className="tb-draw-count-row">
            <span className="tb-draw-count-row__label">Вопросов в тест</span>
            <NumberInput
              size="s"
              value={section.drawCount}
              min={1}
              max={maxQ}
              aria-label={`Количество вопросов из темы ${section.topicName}`}
              data-testid={`topic-drawcount-${section.topicId}`}
              onChange={(next) => props.onChangeDrawCount(next)}
            />
            <span className="tb-draw-count-row__max">из {section.maxQuestions}</span>
          </div>
          <div className="tb-card-desc">Обратная связь по теме</div>
          {/* Clicking the preview opens FeedbackEditorModal (FR-36 / FR-37). */}
          <FeedbackPreview
            section={section}
            onEdit={() => setFeedbackOpen(true)}
          />
        </div>
      </div>
      <FeedbackEditorModal
        open={feedbackOpen}
        title={`Обратная связь по теме «${section.topicName}»`}
        description="Показывается учащемуся после прохождения темы"
        value={{
          format: section.feedback.format,
          text: section.feedback.text,
          links: section.feedbackLinks,
          assets: section.feedbackAssets,
        }}
        onCancel={() => setFeedbackOpen(false)}
        onSave={(v) => {
          props.onSaveFeedback({
            feedback: { format: v.format, text: v.text },
            feedbackLinks: v.links,
            feedbackAssets: v.assets,
          });
          setFeedbackOpen(false);
        }}
        testId={`feedback-editor-topic-${section.topicId}`}
      />
    </>
  );
}

/**
 * Read-only preview of topic feedback content. When `onEdit` is provided,
 * renders as a clickable `<button>` that opens FeedbackEditorModal. Otherwise
 * stays a non-interactive `<div>` (backward-compatible with callers that don't
 * supply a handler).
 */
function FeedbackPreview({
  section,
  onEdit,
}: {
  section: EditorSection;
  onEdit?: () => void;
}) {
  const hasText = section.feedback.text.trim() !== "";
  const linkCount = section.feedbackLinks.length;
  const assetCount = section.feedbackAssets.length;

  if (!hasText && linkCount === 0 && assetCount === 0) {
    // Empty state.
    if (onEdit) {
      return (
        <button
          type="button"
          className="tb-feedback-preview is-empty"
          onClick={onEdit}
          aria-label="Редактировать обратную связь по теме"
          data-testid={`feedback-preview-${section.topicId}`}
        >
          Не задано — нажмите для редактирования
        </button>
      );
    }
    return (
      <div className="tb-feedback-preview is-empty">
        Не задано — обратная связь по теме пока не настроена
      </div>
    );
  }

  const snippet = hasText
    ? section.feedback.text.replace(/<[^>]+>/g, "").slice(0, 80)
    : "Без текста";

  const inner = (
    <>
      <div className="tb-feedback-preview__text">
        <span className="tb-feedback-preview__snippet">{snippet}</span>
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
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
    </>
  );

  if (onEdit) {
    return (
      <button
        type="button"
        className="tb-feedback-preview"
        onClick={onEdit}
        aria-label="Редактировать обратную связь по теме"
        data-testid={`feedback-preview-${section.topicId}`}
      >
        {inner}
      </button>
    );
  }

  return <div className="tb-feedback-preview">{inner}</div>;
}

function TopicPickerModal(props: {
  open: boolean;
  topics: TopicWithQuestionCount[];
  onPick: (topic: TopicWithQuestionCount) => void;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = props.topics.filter((t) =>
    t.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <ModalDialog
      open={props.open}
      onClose={props.onCancel}
      size="m"
      title="Добавить тему"
      description="Выберите тему, вопросы из которой попадут в тест."
      footer={
        <Button
          variant="ghost"
          size="s"
          onClick={props.onCancel}
          data-testid="topic-picker-cancel"
        >
          Отмена
        </Button>
      }
      data-testid="topic-picker-modal"
    >
      <Input
        size="m"
        fullWidth
        placeholder="Поиск по названию..."
        aria-label="Поиск темы"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
        className="tb-topic-picker__search"
        data-testid="topic-picker-search"
      />
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
    </ModalDialog>
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
