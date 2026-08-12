/**
 * @module features/home/sections/my-topics-section
 * @description PRD-25 FR-10: recently touched topics. Recency comes from
 * `topics.updated_at`, which moves on question edits too — so a topic the user has
 * only been filling with questions still floats to the top. A topic the user owns
 * carries no ownership chip: the ABSENCE of «Доступ выдан» is what marks it as
 * theirs.
 */
import { Fragment } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Plus } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardDivider,
  CardFooter,
  CardHeader,
  Cluster,
  EmptyState,
  IconButton,
  Stack,
  Tag,
  Text,
} from "@universityrt/ui-kit";
import { formatQuestions } from "@/lib/i18n";
import type { MyTopicItem } from "@shared/home/contract";

/**
 * The «Мои темы и вопросы» section.
 *
 * @param props.items - up to six topics, most recently changed first.
 * @param props.total - how many topics the user may see in all; the footer link
 *   appears only when it exceeds the number shown.
 * @returns the section card.
 */
export function MyTopicsSection({ items, total }: { items: MyTopicItem[]; total: number }) {
  const [, navigate] = useLocation();
  const hasMore = total > items.length;

  return (
    <Card variant="outlined" data-testid="home-my-topics">
      <CardHeader title="Мои темы и вопросы" subtitle="По времени изменения темы или её вопросов" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            layout="inline"
            art={<Plus size={24} aria-hidden="true" />}
            title="Тем пока нет"
            description="Создайте первую тему и наполните её вопросами."
            actions={
              <Button size="s" onClick={() => navigate("/author/content")} data-testid="home-my-topics-create">
                Перейти к темам
              </Button>
            }
          />
        ) : (
          <Stack gap={0}>
            {items.map((item, index) => (
              <Fragment key={item.topicId}>
                {index > 0 && <CardDivider />}
                <Stack
                  direction="row"
                  align="center"
                  gap={3}
                  padY={3}
                  data-testid={`home-topic-${item.topicId}`}
                >
                  <Stack gap={1} grow>
                    <Cluster gap={2}>
                      <Text variant="body-m" weight="medium">{item.name}</Text>
                      {item.code ? <Tag variant="outline" size="s">{item.code}</Tag> : null}
                      {item.owned ? null : <Tag variant="outline">Доступ выдан</Tag>}
                    </Cluster>
                    <Text variant="body-xs" tone="muted">
                      {`${formatQuestions(item.questionCount)}`
                        + ` · изменена ${new Date(item.updatedAt).toLocaleDateString("ru-RU")}`}
                    </Text>
                  </Stack>
                  <Cluster gap={1} wrap={false}>
                    <IconButton
                      size="s"
                      aria-label="Открыть тему"
                      title="Открыть тему"
                      icon={<ArrowRight size={15} />}
                      onClick={() => navigate("/author/content")}
                      data-testid={`home-topic-open-${item.topicId}`}
                    />
                    <IconButton
                      size="s"
                      aria-label="Добавить вопрос"
                      title="Добавить вопрос"
                      icon={<Plus size={15} />}
                      // «Темы и вопросы» has no deep link to a topic yet (the page
                      // ignores query params), so both actions land on the section
                      // itself until that entry point exists.
                      onClick={() => navigate("/author/content")}
                      data-testid={`home-topic-add-question-${item.topicId}`}
                    />
                  </Cluster>
                </Stack>
              </Fragment>
            ))}
          </Stack>
        )}
      </CardBody>
      {hasMore && (
        <CardFooter>
          <Text variant="body-s" tone="muted">{`Показаны ${items.length} из ${total}`}</Text>
          <Cluster gap={2}>
            <Button
              variant="secondary"
              size="s"
              onClick={() => navigate("/author/content")}
              data-testid="home-my-topics-all"
            >
              Все темы и вопросы
            </Button>
          </Cluster>
        </CardFooter>
      )}
    </Card>
  );
}
