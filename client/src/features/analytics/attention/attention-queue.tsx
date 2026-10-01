/**
 * @module features/analytics/attention/attention-queue
 * @description PRD-56 FR-10, FR-11: очередь «требует внимания».
 *
 * Единственный экран аналитики, который говорит «сделай». Дела разложены по корзинам: у каждой
 * свой вопрос («напомнить», «назначить пересдачу», «разобраться») и своё действие. Один общий
 * список заставил бы читателя сортировать глазами — а он пришёл работать, а не разбирать.
 *
 * Позиция подписана тем, по чему принимают решение: «58 % при пороге 70 % · попытка 1 из 3».
 * «Не сдал» без этих чисел выглядит одинаково и для того, кому хватит пересдачи, и для того,
 * кого надо учить заново. Пустая корзина не показывается вовсе: ноль дел — это не тревога.
 */
import { useEffect, useState } from "react";

import {
  Box, Button, Card, CardBody, CardHeader, SegmentedControl, Separator, Stack, Tag, Text,
} from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";
import {
  ATTENTION_PERIOD_LABEL,
  attentionPeriodStart,
  type AttentionPeriod,
} from "@shared/analytics/attention-period";

import { percent } from "../format";

/** Вид дела. Совпадает с `AttentionKind` сервера. */
export type AttentionKind = "overdue" | "failed" | "abandoned" | "exhausted";

export interface AttentionRow {
  kind: AttentionKind;
  participantId: string | null;
  participant: string;
  testId: string | null;
  testTitle: string;
  observationId?: string;
  /** Источник прохождения: по нему открывается его разбор (FR-11). */
  source?: "web" | "telemetry" | "import";
  dueAt?: string;
  startedAt?: string;
  /** Результат прохождения; `null` — оценивать было нечего. */
  percent?: number | null;
  /** Проходной балл теста; `null` — тест его не объявлял. */
  threshold?: number | null;
  attemptNumber?: number;
  attemptLimit?: number | null;
}

export interface AttentionQueueProps {
  /** Открыть прохождение позиции. Там, где прохождения нет, ход не предлагается. */
  onOpenPassage?: (row: AttentionRow) => void;
  /** Уйти в реестр за остальными делами корзины (FR-08). */
  onOpenRegistry?: (conditions: Record<string, unknown>) => void;
  /**
   * Очередь, уже загруженная страницей (ради счётчика на вкладке). Передана — компонент её не
   * запрашивает: второй запрос за теми же данными был бы лишним.
   */
  data?: AttentionData;
  /**
   * Период вкладки (решение владельца 2026-09-25). Задан вместе с `onPeriodChange` — над
   * карточками стоит переключатель «За неделю / За месяц / За квартал», а подписи называют
   * период. Сам период держит страница: по нему же считается бейдж на вкладке.
   */
  period?: AttentionPeriod;
  onPeriodChange?: (period: AttentionPeriod) => void;
}

/** Пункты переключателя периода — в порядке длительности. */
const PERIOD_ITEMS: Array<{ value: AttentionPeriod; label: string }> = [
  { value: "week", label: "За неделю" },
  { value: "month", label: "За месяц" },
  { value: "quarter", label: "За квартал" },
];

/** Ответ `GET /api/analytics/attention`. */
export interface AttentionData {
  items: AttentionRow[];
  counts: Record<AttentionKind, number>;
}

/** Сколько дел корзины видно сразу. Остальные — в реестре: экран не список, а рабочее место. */
const PREVIEW = 3;

/** Корзины в порядке срочности: сначала то, где ещё можно успеть. */
const BUCKETS: Array<{
  kind: AttentionKind;
  title: string;
  note: string;
  /**
   * В чём считается корзина: у каждой своё содержимое — назначения, прохождения, попытки, люди.
   * «82 дела» теряло предметность: по числу не понять, что именно лежит в корзине.
   */
  unit: [string, string, string];
  tone: "warning" | "error" | "neutral";
  /** Условия реестра, которыми виден весь список корзины. Пусто — в реестре его не собрать. */
  conditions?: Record<string, unknown>;
}> = [
  {
    kind: "overdue",
    title: "Не начали к сроку",
    note: "срок истёк, попытка не начиналась",
    unit: ["назначение", "назначения", "назначений"],
    tone: "warning",
  },
  {
    kind: "failed",
    title: "Не сдали",
    note: "попытки ещё остались",
    unit: ["прохождение", "прохождения", "прохождений"],
    tone: "error",
    conditions: { outcomes: ["failed"] },
  },
  {
    kind: "abandoned",
    title: "Брошенные попытки",
    note: "начаты и не завершены больше двух суток назад",
    unit: ["попытка", "попытки", "попыток"],
    tone: "warning",
    conditions: { outcomes: ["incomplete"] },
  },
  {
    kind: "exhausted",
    title: "Исчерпан лимит попыток",
    note: "лимит исчерпан, тест не сдан",
    unit: ["участник", "участника", "участников"],
    tone: "error",
    conditions: { outcomes: ["failed"] },
  },
];

/** Дата для человека. */
function formatDate(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** На сколько дней просрочено — целыми днями, как об этом и говорят. */
function overdueDays(iso?: string): number | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - due.getTime()) / (24 * 60 * 60 * 1000)));
}

/**
 * Подпись позиции: то, по чему принимают решение.
 *
 * У просроченного назначения прохождения НЕТ — там единственный факт это срок и просрочка;
 * выводить для него результат было бы выдумкой.
 */
function details(row: AttentionRow): string {
  if (row.kind === "overdue") {
    const days = overdueDays(row.dueAt);
    return [
      `Срок ${formatDate(row.dueAt)}`,
      days === null ? null : `просрочено на ${days} дн.`,
    ].filter(Boolean).join(" · ");
  }

  const parts: string[] = [];
  if (typeof row.percent === "number") {
    parts.push(row.threshold === null || row.threshold === undefined
      ? `${percent(row.percent)}`
      : `${percent(row.percent)} при пороге ${percent(row.threshold)}`);
  }
  if (row.attemptNumber) {
    parts.push(row.attemptLimit
      ? `попытка ${row.attemptNumber} из ${row.attemptLimit}`
      : `попытка ${row.attemptNumber}`);
  }
  parts.push(formatDate(row.startedAt));
  return parts.join(" · ");
}

export function AttentionQueue({ onOpenPassage, onOpenRegistry, data, period, onPeriodChange }: AttentionQueueProps) {
  const [rows, setRows] = useState<AttentionRow[]>(data?.items ?? []);
  const [counts, setCounts] = useState<Record<AttentionKind, number> | null>(data?.counts ?? null);
  const [loading, setLoading] = useState(!data);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (data) {
      setRows(data.items);
      setCounts(data.counts);
      setLoading(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/analytics/attention", { credentials: "include" });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as {
          items: AttentionRow[];
          counts: Record<AttentionKind, number>;
        };
        if (!alive) return;
        setRows(data.items);
        setCounts(data.counts);
      } catch {
        // Ошибку нельзя показывать как пустую очередь: «дел нет» — это разрешение
        // заниматься чем-то другим, и выдавать его по сбою загрузки нечестно.
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [data]);

  if (failed) {
    return <Text tone="error">Не удалось загрузить дела. Обновите страницу.</Text>;
  }

  if (loading) return <Text tone="muted">Собираем дела…</Text>;

  const filled = BUCKETS.filter(bucket => rows.some(row => row.kind === bucket.kind));
  // Период — в подписи карточки: «14 прохождений за месяц». Без периода подпись прежняя.
  const periodLabel = period ? ` ${ATTENTION_PERIOD_LABEL[period]}` : "";
  /**
   * Условия перехода в реестр — с НАЧАЛОМ периода: иначе в реестре оказалось бы больше строк,
   * чем обещала карточка.
   */
  const withPeriod = (conditions: Record<string, unknown>) => (period
    ? { ...conditions, from: attentionPeriodStart(period, new Date()).toISOString().slice(0, 10) }
    : conditions);
  // Переключатель виден и при пустой вкладке: пусто за неделю — повод посмотреть за квартал.
  const switcher = period && onPeriodChange ? (
    <div>
      <SegmentedControl
        size="s"
        aria-label="Период"
        value={period}
        onChange={value => onPeriodChange(value as AttentionPeriod)}
        items={PERIOD_ITEMS}
      />
    </div>
  ) : null;

  if (filled.length === 0) {
    return (
      <Stack gap={4}>
        {switcher}
        <Card>
          <CardBody>
            <Text tone="muted">Дел нет: никто не просрочил срок, не бросил попытку и не исчерпал лимит.</Text>
          </CardBody>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      {switcher}
      {filled.map(bucket => {
        const items = rows.filter(row => row.kind === bucket.kind);
        const total = counts?.[bucket.kind] ?? items.length;
        const shown = items.slice(0, PREVIEW);

        return (
          <Card key={bucket.kind}>
            <CardHeader
              title={bucket.title}
              subtitle={`${total} ${pluralize(total, ...bucket.unit)}${periodLabel} · ${bucket.note}`}
              trail={<Tag tone={bucket.tone} size="s">{total}</Tag>}
            />
            <CardBody>
              <Stack gap={0}>
                {shown.map((row, index) => (
                  <div key={row.observationId ?? `${row.participantId}:${row.testId}`}>
                    {index > 0 && <Separator />}
                    <Box padY={4}>
                      <Stack direction="row" align="center" gap={4}>
                        <Stack gap={1} grow>
                          <Text variant="body-m" weight="medium">
                            {row.participant} · {row.testTitle}
                          </Text>
                          <Text variant="body-xs" tone="muted">{details(row)}</Text>
                        </Stack>
                        {row.observationId && onOpenPassage && (
                          <Button variant="ghost" size="s" onClick={() => onOpenPassage(row)}>
                            Разбор прохождения
                          </Button>
                        )}
                      </Stack>
                    </Box>
                  </div>
                ))}
              </Stack>

              {bucket.kind === "overdue" && (
                <Text variant="body-xs" tone="muted">
                  Назначения без срока сюда не попадают.
                </Text>
              )}
            </CardBody>

            {bucket.conditions && onOpenRegistry && total > shown.length && (
              <CardBody>
                <Button
                  variant="ghost"
                  size="s"
                  onClick={() => onOpenRegistry(withPeriod(bucket.conditions!))}
                >
                  Показать все {total}
                </Button>
              </CardBody>
            )}
          </Card>
        );
      })}
    </Stack>
  );
}
