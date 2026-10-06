/**
 * @module features/content/question-preview
 * @description Compact READ-ONLY preview of a question's answer content, shown
 * inline under a question row in the «Темы и вопросы» tree when the row is
 * expanded. Renders the options with the correct answer(s) marked, matching
 * pairs, ranking order, an attached-media note and sub-topic tags — a quick
 * glance without opening the editor. Editing is reached via the row's ⋯ menu.
 */
import { CheckSquare, Image as ImageIcon, Music, Square, Video } from "lucide-react";
import { Chip, Cluster, Grid, Stack, Text } from "@skillum/ui-kit";
import type { Question } from "@shared/schema";
import { hasBlanks, hasOptionList, distributesBudget, isOpenText, isSimulation, isTextEntry } from "@shared/questions/question-type";
import { describeRuleSet } from "@shared/answer-check/describe";
import type { AnswerRuleSet } from "@shared/answer-check";
import type { BlankRuleSet } from "@shared/questions/blanks-render";
import { summarizeScenario } from "@shared/sim/validate";
import type { Scenario } from "@shared/sim/contract";
import { summaryTags } from "@/features/questions/scenario/scenario-summary";

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

        {/* PRD-57: у текстовых типов вариантов нет — показывается эталон теми же словами, какими
            его видит автор в ящике (`describeRuleSet`). Без этого раскрытая строка была пустой. */}
        {isTextEntry(type) && (
          <Text variant="body-s" tone={describeRuleSet(correct as AnswerRuleSet) ? undefined : "muted"}>
            {describeRuleSet(correct as AnswerRuleSet) || "Правил проверки нет — ответ не оценивается"}
          </Text>
        )}
        {hasBlanks(type) && (
          <Stack gap={1}>
            {((correct as { blanks?: BlankRuleSet[] }).blanks ?? []).map((blank) => (
              <Text key={blank.id} variant="body-s">
                «{blank.id}»: {describeRuleSet(blank) || "без проверки"}
              </Text>
            ))}
          </Stack>
        )}
        {isOpenText(type) && (
          <Text variant="body-s" tone="muted">Развёрнутый ответ без автоматической проверки</Text>
        )}
        {/* «Сценарий в ИС»: вариантов нет — показывается задание и та же сводка, что в ящике. */}
        {isSimulation(type) && (data as { scenario?: Scenario }).scenario && (
          <Stack gap={1}>
            <Text variant="body-s">{question.prompt}</Text>
            <Cluster gap={1} wrap>
              {summaryTags(summarizeScenario((data as { scenario: Scenario }).scenario)).map((tag) => (
                <Chip key={tag} size="s">{tag}</Chip>
              ))}
            </Cluster>
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
