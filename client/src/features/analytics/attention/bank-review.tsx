/**
 * @module features/analytics/attention/bank-review
 * @description PRD-70 FR-60: карточка «Вопросы банка на ревизию» в «Требует внимания» (эскиз
 * approved/e7-question-bank.html, состояние «требует внимания»).
 *
 * Ось банка: вопросы тем, которыми читатель управляет, с признаком «под подозрением» хотя бы в
 * одном его тесте. Карточка «Тесты с вопросами под подозрением» остаётся рядом — это ось теста:
 * один и тот же вопрос виден в обеих, но ведут они к разным действиям — исключить из выдачи теста
 * или исправить вопрос в теме (FR-61). Строка ведёт на статистику вопроса банка.
 */
import { Fragment } from "react";
import { ChevronRight } from "lucide-react";

import { Box, Button, Card, CardBody, CardHeader, Separator, Stack, Tag, Text } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";
import { reviewSub, type BankReview } from "@/features/content/bank-quality";

/** Строка карточки — то, что отдаёт `GET /api/analytics/attention` в `bankReview`. */
export interface BankReviewRow {
  questionId: string;
  prompt: string;
  topicName: string;
  review: BankReview;
}

/** Свойства карточки. */
export interface BankReviewCardProps {
  rows: BankReviewRow[];
  onOpen: (questionId: string) => void;
}

/**
 * «Вопросы банка на ревизию».
 *
 * @param props - строки и переход на статистику вопроса банка
 * @returns карточка; без строк — ничего
 */
export function BankReviewCard({ rows, onOpen }: BankReviewCardProps) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title="Вопросы банка на ревизию"
        subtitle={`${rows.length} ${pluralize(rows.length, "вопрос", "вопроса", "вопросов")} в ваших темах · признак хотя бы в одном тесте`}
        // Счётчик карточки равен длине её списка (FR-62).
        trail={<Tag tone="warning" size="s">{rows.length}</Tag>}
      />
      <CardBody>
        <Stack gap={0}>
          {rows.map((row, index) => (
            <Fragment key={row.questionId}>
              {index > 0 && <Separator />}
              <Box padY={4}>
                <Stack direction="row" align="center" gap={4}>
                  <Stack gap={1} grow>
                    <Text variant="body-m" weight="medium">{`${row.prompt} · ${row.topicName}`}</Text>
                    <Text variant="body-xs" tone="muted">{`${row.review.title} — ${reviewSub(row.review)}`}</Text>
                  </Stack>
                  <Button
                    variant="ghost"
                    size="s"
                    trailingIcon={<ChevronRight size={14} />}
                    onClick={() => onOpen(row.questionId)}
                  >
                    Статистика
                  </Button>
                </Stack>
              </Box>
            </Fragment>
          ))}
        </Stack>
      </CardBody>
    </Card>
  );
}
