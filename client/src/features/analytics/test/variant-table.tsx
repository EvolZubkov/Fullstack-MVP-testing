/**
 * @module features/analytics/test/variant-table
 * @description PRD-56 FR-18: проходимость по вариантам выдачи (PRD-17/24).
 *
 * Таблица отвечает на один вопрос: одинаково ли оценивают разные формы набора. Поэтому
 * расхождение считается К ДОЛЕ СДАВШИХ ПО ТЕСТУ, а не к соседнему варианту, и подпись столбца
 * об этом говорит: «−17 п.п. к тесту» читается, «−17 п.п.» — нет.
 *
 * Группировка по РАЗДЕЛАМ не оформительская: вариант — свойство раздела, и у теста с двумя
 * наборами форм плоский список смешал бы формы разных тем.
 *
 * Ниже порога наблюдений строка сообщает только счёт: восьми прохождениям доверительный
 * интервал доли около ±35 п.п., и вердикт по ним был бы выдумкой (FR-27).
 */
import { Card, CardBody, CardHeader, DataGrid, Stack, Tag, Text } from "@skillum/ui-kit";

import { percent } from "../format";

export interface VariantRowView {
  formId: string;
  label: string;
  attempts: number;
  passRate: number | null;
  avgPercent: number | null;
  deltaPoints: number | null;
  deviates: boolean;
  lowSample: boolean;
}

export interface VariantSectionView {
  topicId: string;
  topicName: string;
  rows: VariantRowView[];
}

export interface VariantTableProps {
  sections: VariantSectionView[];
}

/** Процент для чтения человеком; «мало данных» — не прочерк: это разные причины молчать. */
function share(value: number | null, lowSample: boolean): string {
  if (lowSample) return "мало данных";
  return percent(value);
}

/** Расхождение словами: знак, величина и то, с чем сравнивали. */
function deltaText(row: VariantRowView): string {
  if (row.deltaPoints === null) return "—";
  const rounded = Math.round(row.deltaPoints);
  if (!row.deviates) return "в пределах";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} п.п. к тесту`;
}

function columnsOf() {
  return [
    {
      key: "label",
      header: "Вариант",
      frozen: true,
      render: (row: VariantRowView) => <span className="ou-grid__cell-strong">{row.label}</span>,
    },
    {
      key: "attempts",
      header: "Прохождений",
      align: "center" as const,
      numeric: true,
      render: (row: VariantRowView) => row.attempts,
    },
    {
      key: "passRate",
      header: "Сдали",
      align: "center" as const,
      numeric: true,
      render: (row: VariantRowView) => share(row.passRate, row.lowSample),
    },
    {
      key: "avgPercent",
      header: "Средний результат",
      align: "center" as const,
      numeric: true,
      render: (row: VariantRowView) => share(row.avgPercent, row.lowSample),
    },
    {
      key: "delta",
      align: "center" as const,
      header: "Расхождение",
      render: (row: VariantRowView) => (row.deviates
        ? <Tag tone="error" size="s">{deltaText(row)}</Tag>
        : <Text variant="body-s" tone="muted">{deltaText(row)}</Text>),
    },
  ];
}

export function VariantTable({ sections }: VariantTableProps) {
  const totalForms = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const totalAttempts = sections.reduce(
    (sum, section) => sum + section.rows.reduce((n, row) => n + row.attempts, 0),
    0,
  );

  return (
    <Card>
      <CardHeader
        title="Варианты выдачи"
        subtitle={sections.length === 0
          ? "Фиксированных вариантов в этом тесте нет: вопросы выдаются случайным набором"
          : `${totalForms} форм набора · ${totalAttempts} прохождений · расхождение считается к доле сдавших по тесту`}
      />
      <CardBody>
        {sections.length === 0 ? (
          <Text variant="body-s" tone="muted">
            Сравнивать нечего — ни один раздел не переведён на фиксированные варианты.
          </Text>
        ) : (
          <Stack gap={4}>
            {sections.map(section => (
              <Stack key={section.topicId} gap={2}>
                {/* Название раздела печатается всегда: даже у одного набора форм читателю надо
                    знать, о какой теме идёт речь. */}
                <Text variant="body-s" weight="medium">{section.topicName}</Text>
                <DataGrid
                  columns={columnsOf()}
                  rows={section.rows}
                  rowKey={row => row.formId}
                  emptyMessage="Вариантов в этом разделе нет"
                />
              </Stack>
            ))}
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}
