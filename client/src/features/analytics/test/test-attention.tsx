/**
 * @module features/analytics/test/test-attention
 * @description Э3.4: блок «Требует внимания» на «Обзоре» теста — точки внимания уровня теста
 * (решение владельца 2026-10-03: системные дела — на общем уровне, качество вопросов — здесь;
 * эскиз approved/e3-test-and-question.html, состояние test-overview).
 *
 * Новых расчётов нет — сводка уже посчитанного: вопросы под подозрением (то же правило, что вид
 * «Под подозрением» на «Качестве вопросов»), требующие ревизии (вид «Требуют ревизии» таблицы
 * «Вопросы») и исключённые из выдачи. «Показать» ведёт в этот вид — и число в строке обязано
 * совпасть со списком, который откроется.
 */
import { Fragment } from "react";
import { ChevronRight } from "lucide-react";

import { Box, Button, Card, CardBody, CardHeader, Separator, Stack, Tag, Text } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

/** Строка блока: что, сколько, почему и куда вести. */
export interface AttentionLine {
  key: string;
  title: string;
  count: number;
  /** Чем объясняется число — словами признаков. */
  caption: string;
  onShow: () => void;
}

/** Свойства блока. */
export interface TestAttentionProps {
  /** Сколько вопросов у теста — для подзаголовка. */
  questions: number;
  lines: AttentionLine[];
  /** Психометрика ещё считается — строки «под подозрением» пока нет. */
  pending?: boolean;
}

/**
 * «Требует внимания» уровня теста.
 *
 * @param props - число вопросов теста и строки сводки
 * @returns карточка со счётчиками и переходами в нужный вид таблиц
 */
export function TestAttention({ questions, lines, pending = false }: TestAttentionProps) {
  const total = lines.reduce((sum, line) => sum + line.count, 0);
  return (
    <Card>
      <CardHeader
        title="Требует внимания"
        subtitle={`Качество вопросов теста · ${questions} ${pluralize(questions, "вопрос", "вопроса", "вопросов")}${pending ? " · считаем психометрику…" : ""}`}
        trail={total > 0 ? <Tag tone="warning" size="s">{total}</Tag> : undefined}
      />
      <CardBody>
        <Stack gap={0}>
          {lines.map((line, index) => (
            <Fragment key={line.key}>
              {index > 0 && <Separator />}
              <Box padY={4}>
                <Stack direction="row" align="center" gap={4}>
                  <Stack gap={1} grow>
                    <Text variant="body-m" weight="medium">{`${line.title} · ${line.count}`}</Text>
                    <Text variant="body-xs" tone="muted">{line.caption}</Text>
                  </Stack>
                  <Button
                    variant="ghost"
                    size="s"
                    trailingIcon={<ChevronRight size={14} />}
                    // Пустой вид открывать незачем: кнопка выключена, а не спрятана — видно, что
                    // смотреть нечего, а не что действия нет.
                    disabled={line.count === 0}
                    onClick={line.onShow}
                  >
                    Показать
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
