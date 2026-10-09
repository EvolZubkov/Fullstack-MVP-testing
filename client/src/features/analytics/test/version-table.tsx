/**
 * @module features/analytics/test/version-table
 * @description PRD-56 FR-19, FR-19a: разрез по версиям публикации (PRD-15).
 *
 * Прохождения до и после правки теста не смешиваются в одном среднем: у каждой версии свой
 * период действия и свои числа.
 *
 * Строка «Версия не указана» — не техническая заглушка, а честный ответ: пакеты, собранные до
 * FR-19a, версии не знают, и приписать их текущей значило бы сделать разрез слепым ровно там,
 * где он и нужен. Версия, по которой ещё никто не проходил, из таблицы не убирается: пустая
 * строка отвечает на «кто-нибудь проходил после правки».
 */
import { Card, CardBody, CardHeader, DataGrid, Stack, Tag, Text } from "@skillum/ui-kit";

import { percent } from "../format";

export interface VersionRowView {
  snapshotId: string | null;
  version: number | null;
  publishedAt: string | null;
  effectiveTo: string | null;
  current: boolean;
  attempts: number;
  passRate: number | null;
  avgPercent: number | null;
  lowSample: boolean;
}

export interface VersionTableProps {
  versions: VersionRowView[];
}

const date = (value: string | null): string =>
  value === null ? "—" : new Date(value).toLocaleDateString("ru-RU");

function share(value: number | null, lowSample: boolean): string {
  if (lowSample) return "мало данных";
  return percent(value);
}

/** Период действия версии: от публикации до публикации следующей. */
function period(row: VersionRowView): string {
  if (row.publishedAt === null) return "—";
  return row.effectiveTo === null
    ? `с ${date(row.publishedAt)}`
    : `${date(row.publishedAt)} — ${date(row.effectiveTo)}`;
}

export function VersionTable({ versions }: VersionTableProps) {
  const published = versions.filter(row => row.snapshotId !== null).length;
  const attempts = versions.reduce((sum, row) => sum + row.attempts, 0);

  const columns = [
    {
      key: "version",
      header: "Версия",
      frozen: true,
      render: (row: VersionRowView) => (
        <Stack gap={1}>
          <Stack direction="row" gap={2} align="center">
            <span className="ou-grid__cell-strong">
              {row.version === null ? "Версия не указана" : `v${row.version}`}
            </span>
            {row.current && <Tag tone="success" size="s">текущая</Tag>}
          </Stack>
          <Text variant="body-xs" tone="muted">
            {row.publishedAt === null
              // Причина названа прямо в строке: иначе «не указана» читается как поломка.
              ? "пакет собран до того, как версия стала уезжать в LMS"
              : `опубликована ${date(row.publishedAt)}`}
          </Text>
        </Stack>
      ),
    },
    { key: "period", header: "Действовала", render: (row: VersionRowView) => period(row) },
    {
      key: "attempts",
      header: "Прохождений",
      align: "center" as const,
      numeric: true,
      render: (row: VersionRowView) => row.attempts,
    },
    {
      key: "passRate",
      header: "Сдали",
      align: "center" as const,
      numeric: true,
      render: (row: VersionRowView) => share(row.passRate, row.lowSample),
    },
    {
      key: "avgPercent",
      header: "Средний результат",
      align: "center" as const,
      numeric: true,
      render: (row: VersionRowView) => share(row.avgPercent, row.lowSample),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Версии публикации"
        subtitle={`${published} опубликованных версий · ${attempts} прохождений`}
      />
      <CardBody>
        <DataGrid
          columns={columns}
          rows={versions}
          rowKey={row => row.snapshotId ?? "none"}
          emptyMessage="Тест ещё не публиковался: версий у него нет"
        />
      </CardBody>
    </Card>
  );
}
