/**
 * @module features/analytics/attention/suspicious-tests
 * @description Э3.4: корзина «Тесты с вопросами под подозрением» общего «Требует внимания»
 * (эскиз approved/e3-test-and-question.html, состояние attention).
 *
 * Общий уровень показывает, ГДЕ на уровне теста есть дела по качеству вопросов, но не разбирает
 * их сам: строка — тест, «Открыть» ведёт на его уровень сразу в вид «Под подозрением».
 *
 * Число — из фонового пересчёта (решение владельца 2026-10-04), поэтому рядом сказано, когда оно
 * посчитано: после новых прохождений оно догоняет за несколько минут.
 */
import { Fragment } from "react";
import { ChevronRight } from "lucide-react";

import { Box, Button, Card, CardBody, CardHeader, Separator, Stack, Tag, Text } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

/** Строка корзины — то, что отдаёт `GET /api/analytics/attention` в `suspiciousTests`. */
export interface SuspiciousTestRow {
  testId: string;
  title: string;
  count: number;
  items: number;
  passages: number;
  computedAt: string;
}

/** Свойства корзины. */
export interface SuspiciousTestsProps {
  rows: SuspiciousTestRow[];
  onOpen: (testId: string) => void;
}

/** Время расчёта — часы и минуты, если сегодня; иначе дата. */
function computedLabel(iso: string): string {
  const at = new Date(iso);
  const today = new Date().toDateString() === at.toDateString();
  return today
    ? at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : at.toLocaleDateString("ru-RU");
}

/**
 * «Тесты с вопросами под подозрением».
 *
 * @param props - строки корзины и переход на уровень теста
 * @returns карточка корзины; без строк — ничего
 */
export function SuspiciousTests({ rows, onOpen }: SuspiciousTestsProps) {
  if (rows.length === 0) return null;
  // Самый старый расчёт среди строк — честная граница «посчитано не позже».
  const oldest = rows.reduce((min, row) => (row.computedAt < min ? row.computedAt : min), rows[0].computedAt);
  return (
    <Card>
      <CardHeader
        title="Тесты с вопросами под подозрением"
        subtitle={`${rows.length} ${pluralize(rows.length, "тест", "теста", "тестов")} · разбирать — на уровне теста · посчитано в ${computedLabel(oldest)}`}
        trail={<Tag tone="warning" size="s">{rows.length}</Tag>}
      />
      <CardBody>
        <Stack gap={0}>
          {rows.map((row, index) => (
            <Fragment key={row.testId}>
              {index > 0 && <Separator />}
              <Box padY={4}>
                <Stack direction="row" align="center" gap={4}>
                  <Stack gap={1} grow>
                    <Text variant="body-m" weight="medium">{row.title}</Text>
                    <Text variant="body-xs" tone="muted">
                      {`${row.count} ${pluralize(row.count, "вопрос", "вопроса", "вопросов")} из ${row.items} под подозрением · ${row.passages} ${pluralize(row.passages, "прохождение", "прохождения", "прохождений")}`}
                    </Text>
                  </Stack>
                  <Button
                    variant="ghost"
                    size="s"
                    trailingIcon={<ChevronRight size={14} />}
                    onClick={() => onOpen(row.testId)}
                  >
                    Открыть
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
