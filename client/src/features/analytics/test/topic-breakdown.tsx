/**
 * @module features/analytics/test/topic-breakdown
 * @description PRD-56 FR-14, FR-14a: темы и подтемы теста.
 *
 * Каждая колонка называет свою ЕДИНИЦУ СЧЁТА, и это не украшение заголовка: «Прошли тему» —
 * доля прохождений, «Доля верных» — доля ответов, и без подписи два процента читаются как одно
 * число, посчитанное дважды с разной точностью.
 *
 * Колонки «вердикт» у темы нет и не будет: порог судит ОДНУ попытку, у среднего исхода нет, а
 * третьего состояния («на грани») в модели не существует (решение владельца 2026-09-13). Цвета
 * в колонке «Прошли тему» тоже нет: порога «сколько процентов участников должны взять тему» в
 * продукте не задано.
 */
import { Box, Card, CardBody, CardHeader, DataGrid, Text } from "@skillum/ui-kit";

import { percent } from "../format";

/** Разрез темы или подтемы. */
export interface TopicSliceView {
  passedShare: number | null;
  correctShare: number | null;
  thresholdPercent: number | null;
  inSample: number;
}

export interface TopicView extends TopicSliceView {
  topicId: string;
  topicName: string;
  subtopics: Array<TopicSliceView & { name: string }>;
}

export interface TopicBreakdownProps {
  topics: TopicView[];
}

/** Строка таблицы: тема или вложенная в неё подтема. */
interface Row extends TopicSliceView {
  key: string;
  name: string;
  isSubtopic: boolean;
}

/** Развернуть темы в плоский список строк: подтема идёт сразу под своей темой. */
function rowsOf(topics: TopicView[]): Row[] {
  return topics.flatMap(topic => [
    {
      key: topic.topicId,
      name: topic.topicName,
      isSubtopic: false,
      passedShare: topic.passedShare,
      correctShare: topic.correctShare,
      thresholdPercent: topic.thresholdPercent,
      inSample: topic.inSample,
    },
    ...topic.subtopics.map(subtopic => ({
      key: `${topic.topicId}:${subtopic.name}`,
      name: subtopic.name,
      isSubtopic: true,
      passedShare: subtopic.passedShare,
      correctShare: subtopic.correctShare,
      thresholdPercent: subtopic.thresholdPercent,
      inSample: subtopic.inSample,
    })),
  ]);
}

export function TopicBreakdown({ topics }: TopicBreakdownProps) {
  const rows = rowsOf(topics);

  const columns = [
    {
      key: "name",
      header: "Тема · подтема",
      frozen: true,
      render: (row: Row) => (row.isSubtopic
        // Вложенность — отступом, а не значком: подтема читается как часть темы, под которой
        // стоит, и отдельного объяснения это не требует.
        ? <Box padStart={6}><Text variant="body-s" tone="muted">{row.name}</Text></Box>
        : <span className="ou-grid__cell-strong">{row.name}</span>),
    },
    {
      key: "passed",
      header: "Прошли тему, % прохождений",
      numeric: true,
      render: (row: Row) => percent(row.passedShare),
    },
    {
      key: "correct",
      header: "Доля верных, % ответов",
      numeric: true,
      render: (row: Row) => percent(row.correctShare),
    },
    {
      key: "threshold",
      header: "Порог темы",
      numeric: true,
      render: (row: Row) => percent(row.thresholdPercent),
    },
    {
      key: "sample",
      header: "В выборке, прохождений",
      numeric: true,
      render: (row: Row) => row.inSample,
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Темы и подтемы"
        subtitle="Доля прошедших тему и доля верных ответов — разные величины: первая о людях, вторая о материале"
      />
      <CardBody>
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={row => row.key}
          emptyMessage="Разрезов по темам пока нет: прохождений с ответами не было"
        />
      </CardBody>
    </Card>
  );
}
