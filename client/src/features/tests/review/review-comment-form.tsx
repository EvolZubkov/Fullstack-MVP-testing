/**
 * @module features/tests/review/review-comment-form
 * @description PRD-52 FR-18/FR-18a: форма нового комментария.
 *
 * Три режима, различающиеся ТОЛЬКО источником места:
 *   - `player` — место берётся с текущего экрана прогона и показывается как есть;
 *   - `editor` — место выбирается явно, по умолчанию «тест в целом»;
 *   - `reply`  — места нет вовсе: ответ наследует якорь ветки.
 */
import { useState } from "react";
import {
  Button, Card, CardBody, CardHeader, Cluster, FormGroup, Select, Stack, Tag, Text, Textarea,
} from "@skillum/ui-kit";
import type { ReviewAnchor } from "@shared/review/anchor";

/** Содержимое раздела, на которое можно поставить якорь: вопрос или страница. */
export type ReviewAnchorItem = {
  id: string;
  label: string;
  kind: "question" | "content-page";
  topicId: string | null;
};

export interface ReviewCommentFormProps {
  mode: "player" | "editor" | "reply";
  /** Место текущего экрана — режим `player`. */
  screenAnchor?: ReviewAnchor;
  /** Разделы теста для выбора места — режим `editor`. */
  topics?: { id: string; name: string }[];
  /**
   * Содержимое разделов для второго поля. Пусто — поле остаётся выключенным: замечание
   * тогда встаёт на раздел целиком, а не пропадает.
   */
  items?: ReviewAnchorItem[];
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (input: { body: string; anchor?: ReviewAnchor }) => void | Promise<void>;
}

/** Человеческое имя места, показываемое в режиме прогона. */
function anchorLabel(anchor?: ReviewAnchor): string {
  if (!anchor) return "Тест в целом";
  if (anchor.kind === "question") return "Текущий вопрос";
  if (anchor.kind === "content-page") return "Текущая страница";
  if (anchor.kind === "topic") return "Текущий раздел";
  if (anchor.kind === "start") return "Стартовый экран";
  if (anchor.kind === "results") return "Экран итогов";
  return "Тест в целом";
}

export function ReviewCommentForm({
  mode, screenAnchor, topics = [], items = [], busy, onCancel, onSubmit,
}: ReviewCommentFormProps) {
  const [body, setBody] = useState("");
  const [place, setPlace] = useState<string>("test");
  const [item, setItem] = useState<string>("");

  // Второе поле живёт только у РАЗДЕЛА: у «теста в целом», стартового экрана и итогов
  // содержимого, на которое можно указать, нет.
  const topicChosen = topics.some((t) => t.id === place);
  const itemsOfTopic = topicChosen ? items.filter((i) => i.topicId === place) : [];
  const chosenItem = itemsOfTopic.find((i) => i.id === item);

  const anchor: ReviewAnchor | undefined =
    mode === "reply" ? undefined
      : mode === "player" ? (screenAnchor ?? { kind: "test" })
        : place === "test" ? { kind: "test" }
          : place === "start" ? { kind: "start" }
            : place === "results" ? { kind: "results" }
              : chosenItem?.kind === "question" ? { kind: "question", questionId: chosenItem.id, topicId: place }
                : chosenItem?.kind === "content-page" ? { kind: "content-page", contentPageId: chosenItem.id, topicId: place }
                  : { kind: "topic", topicId: place };

  const placeOptions = [
    { value: "test", label: "Тест в целом" },
    ...topics.map((t) => ({ value: t.id, label: `Раздел «${t.name}»` })),
    { value: "start", label: "Стартовый экран" },
    { value: "results", label: "Экран итогов" },
  ];

  // Эскиз ставит форму нового комментария в обведённую карточку с заголовком. Ответ в ветке
  // карточки не получает: он и так вложен в свою ветку, и вторая рамка внутри неё лишняя.
  const form = (
    <Stack gap={3} className="rvp__form">
      {mode === "player" ? (
        <Stack gap={1}>
          <Text variant="body-s" tone="muted">Место</Text>
          <span>
            <Tag variant="outline" tone="accent">{anchorLabel(screenAnchor)}</Tag>
          </span>
          <Text variant="body-xs" tone="muted">Подставлено автоматически по текущему экрану.</Text>
        </Stack>
      ) : null}

      {mode === "editor" ? (
        <FormGroup columns="two">
          <Select
            size="s"
            label="Место"
            hint="По умолчанию — тест в целом."
            value={place}
            onChange={(value) => {
              setPlace(String(value));
              // Выбрали другой раздел — прежний вопрос к нему не относится.
              setItem("");
            }}
            options={placeOptions}
            data-testid="anchor-place"
          />
          <Select
            size="s"
            label="Вопрос или страница"
            hint={topicChosen ? "Пусто — замечание к разделу целиком." : "Доступно после выбора раздела."}
            disabled={itemsOfTopic.length === 0}
            value={item}
            onChange={(value) => setItem(String(value))}
            options={[
              { value: "", label: topicChosen ? "Раздел целиком" : "Выберите раздел" },
              ...itemsOfTopic.map((i) => ({ value: i.id, label: i.label })),
            ]}
            data-testid="anchor-item"
          />
        </FormGroup>
      ) : null}

      {/* Без подписи: поле занимает всю ширину формы и стоит там, где текст и ждут, —
          заполнитель говорит достаточно. Скринридеру имя даёт `aria-label`. */}
      <Textarea
        fullWidth
        rows={4}
        value={body}
        aria-label={mode === "reply" ? "Ответ" : "Комментарий"}
        placeholder="Что не так и что предлагаете изменить"
        onChange={(e) => setBody(e.target.value)}
        data-testid="comment-body"
      />

      <Cluster gap={2} align="center">
        <Button variant="ghost" size="s" onClick={onCancel}>Отмена</Button>
        <span className="rvp__spacer" />
        <Button
          variant="primary"
          size="s"
          disabled={!body.trim() || busy}
          onClick={() => onSubmit({ body: body.trim(), anchor })}
          data-testid="submit-comment"
        >
          {mode === "reply" ? "Ответить" : "Добавить"}
        </Button>
      </Cluster>
    </Stack>
  );

  if (mode === "reply") return form;

  return (
    <Card variant="outlined" size="sm" data-testid="review-comment-form-card">
      <CardHeader title="Новый комментарий" />
      <CardBody>{form}</CardBody>
    </Card>
  );
}
