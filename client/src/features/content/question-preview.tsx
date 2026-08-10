/**
 * @module features/content/question-preview
 * @description Compact READ-ONLY preview of a question's answer content, shown
 * inline under a question row in the «Темы и вопросы» tree when the row is
 * expanded. Renders the options with the correct answer(s) marked, matching
 * pairs, ranking order, an attached-media note and sub-topic tags — a quick
 * glance without opening the editor. Editing is reached via the row's ⋯ menu.
 */
import { CheckSquare, Image as ImageIcon, Music, Square, Video } from "lucide-react";
import { Chip, Cluster, Grid, Stack, Text } from "@universityrt/ui-kit";
import type { Question } from "@shared/schema";
import { hasOptionList, distributesBudget } from "@shared/questions/question-type";

export function QuestionPreview({ question }: { question: Question }) {
  const data = question.dataJson as { options?: string[]; left?: string[]; right?: string[]; items?: string[] };
  const correct = question.correctJson as { correctIndex?: number; correctIndices?: number[] };
  const type = question.type;
  const tags = Array.isArray(question.tags) ? question.tags : [];

  const media = question.mediaUrl && question.mediaType ? (
    <Cluster gap={2}>
      {question.mediaType === "image" && <ImageIcon size={14} color="var(--ou-fg-muted)" />}
      {question.mediaType === "audio" && <Music size={14} color="var(--ou-fg-muted)" />}
      {question.mediaType === "video" && <Video size={14} color="var(--ou-fg-muted)" />}
      <Text variant="body-xs" tone="muted">
        {question.mediaType === "image" ? "Изображение" : question.mediaType === "audio" ? "Аудио" : "Видео"}
      </Text>
    </Cluster>
  ) : null;

  return (
    <div className="ct-qpreview">
      <Stack gap={2}>
        {media}

        {/* PRD-44: у распределения нет верного варианта, поэтому вместо колонки
            галочек показывается бюджет и сами утверждения — иначе предпросмотр
            выглядел бы как список без единого отмеченного ответа, будто автор
            забыл его отметить. */}
        {distributesBudget(type) && (
          <Stack gap={1}>
            <Text variant="body-s" tone="muted">
              Распределить {Number((data as { budget?: number }).budget ?? 0)} баллов между утверждениями
            </Text>
            {(data.options ?? []).map((opt, i) => (
              <Text key={i} variant="body-s">{i + 1}. {opt}</Text>
            ))}
          </Stack>
        )}

        {!distributesBudget(type) && hasOptionList(type) && (
          <Stack gap={1}>
            {(data.options ?? []).map((opt, i) => {
              // PRD-26: a measurement-only scale has no key at all, so nothing is
              // marked correct — `correctIndex` is simply absent and every graduation
              // renders neutral.
              const isCorrect = type === "multiple"
                ? (correct?.correctIndices ?? []).includes(i)
                : i === correct?.correctIndex;
              return (
                <Cluster key={i} gap={2} wrap={false} align="center">
                  {isCorrect
                    ? <CheckSquare size={15} color="var(--ou-success-default)" />
                    : <Square size={15} color="var(--ou-fg-muted)" />}
                  <Text variant="body-s" tone={isCorrect ? "success" : undefined}>{opt}</Text>
                </Cluster>
              );
            })}
          </Stack>
        )}

        {type === "matching" && (
          <Grid cols={2} gap={3}>
            <Stack gap={1}>
              {(data.left ?? []).map((item, i) => <Text key={i} variant="body-s">{i + 1}. {item}</Text>)}
            </Stack>
            <Stack gap={1}>
              {(data.right ?? []).map((item, i) => <Text key={i} variant="body-s">{String.fromCharCode(65 + i)}. {item}</Text>)}
            </Stack>
          </Grid>
        )}

        {type === "ranking" && (
          <Stack gap={1}>
            {(data.items ?? []).map((item, i) => <Text key={i} variant="body-s">{i + 1}. {item}</Text>)}
          </Stack>
        )}

        {tags.length > 0 && (
          <Cluster gap={1} wrap>
            {tags.map((tg) => <Chip key={tg} size="s">{tg}</Chip>)}
          </Cluster>
        )}
      </Stack>
    </div>
  );
}
