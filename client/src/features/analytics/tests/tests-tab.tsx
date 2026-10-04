/**
 * @module features/analytics/tests/tests-tab
 * @description Э3.0: вкладка «Тесты» общего уровня аналитики — единая точка входа в аналитику
 * теста (решение владельца 2026-10-03, эскиз approved/e3-test-and-question.html, состояние
 * general-tests).
 *
 * Строка — тест, по которому есть завершённые прохождения в области читателя, с ключевыми
 * числами: сколько прохождений, доля сдавших, средний результат, когда было последнее. Клик по
 * строке открывает уровень теста. Это не сводка ПО ВСЕМ тестам — каждая строка своя выборка со
 * своим порогом, поэтому итоговой строки у таблицы нет.
 *
 * Колонка «Вопросов под подозрением» (Э3.4) — из фонового пересчёта, той же сводкой, что корзина
 * «Тесты с вопросами под подозрением»; до первого прохода пересчёта — прочерк.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card, CardBody, CardHeader, DataGrid, EmptyState, SearchField, Stack, Text,
} from "@skillum/ui-kit";
import type { SortDir } from "@skillum/ui-kit";
import { LoadingState } from "@/components/loading-state";
import { percent } from "../format";
import { pluralize } from "@/lib/i18n";

/** Строка ответа `GET /api/analytics/tests` (см. `server/routes/analytics/summary.ts`). */
export interface TestSummaryRow {
  testId: string;
  title: string;
  completedAttempts: number;
  passRate: number | null;
  avgPercent: number | null;
  lastAttemptAt: string | null;
  /** Э3.4: вопросов под подозрением — из фонового пересчёта; `null` — ещё не посчитано. */
  suspicious?: { count: number; computedAt: string } | null;
}

/** Свойства вкладки. */
export interface TestsTabProps {
  /** Открыть уровень теста — тот же переход, что у значка в строке реестра. */
  onOpenTest: (testId: string) => void;
}

/** Ключ запроса: «Обновить» общего уровня сбрасывает все запросы аналитики по префиксу. */
export const TESTS_SUMMARY_KEY = ["/api/analytics/tests"] as const;

type SortKey = "title" | "completed" | "passRate" | "avgPercent" | "suspicious" | "last";

/** Значение строки для сортировки; пустое число уходит в конец при любом направлении. */
function sortValue(row: TestSummaryRow, key: SortKey): string | number | null {
  switch (key) {
    case "title": return row.title.toLocaleLowerCase("ru-RU");
    case "completed": return row.completedAttempts;
    case "passRate": return row.passRate;
    case "avgPercent": return row.avgPercent;
    case "suspicious": return row.suspicious?.count ?? null;
    case "last": return row.lastAttemptAt;
  }
}

/** Дата последнего прохождения — днём, как в эскизе. */
function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("ru-RU") : "—";
}

/**
 * Вкладка «Тесты».
 *
 * @param props - переход на уровень теста
 * @returns поиск по названию и таблица тестов с ключевыми числами
 */
export function TestsTab({ onOpenTest }: TestsTabProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("last");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, isLoading, isError } = useQuery<{ tests: TestSummaryRow[] }>({
    queryKey: TESTS_SUMMARY_KEY,
    queryFn: async () => {
      const response = await fetch("/api/analytics/tests", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json();
    },
  });

  const tests = data?.tests ?? [];
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    const found = needle
      ? tests.filter(test => test.title.toLocaleLowerCase("ru-RU").includes(needle))
      : tests;
    return [...found].sort((a, b) => {
      const left = sortValue(a, sortKey);
      const right = sortValue(b, sortKey);
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      const diff = left < right ? -1 : left > right ? 1 : 0;
      return sortDir === "asc" ? diff : -diff;
    });
  }, [tests, query, sortKey, sortDir]);

  if (isError) {
    return <Text tone="error">Не удалось загрузить тесты. Обновите страницу.</Text>;
  }
  if (isLoading) {
    return <LoadingState message="Загружаем тесты..." />;
  }
  if (tests.length === 0) {
    return (
      <EmptyState
        title="Прохождений пока нет"
        description="Здесь появятся тесты, как только по ним пройдёт первый участник."
      />
    );
  }

  // Числа и даты — по центру вместе с заголовками (правило 2026-10-03, Э3.5).
  const columns = [
    {
      key: "title",
      header: "Тест",
      sortable: true,
      render: (row: TestSummaryRow) => <span className="ou-grid__cell-strong tb-cell-wrap">{row.title}</span>,
    },
    {
      key: "completed",
      header: "Прохождений",
      sortable: true,
      align: "center" as const,
      numeric: true,
      render: (row: TestSummaryRow) => row.completedAttempts,
    },
    {
      key: "passRate",
      header: "Сдали",
      sortable: true,
      align: "center" as const,
      numeric: true,
      // Прочерк — вердикт не выносился: у измерительного теста его нет (PRD-29 §6.7).
      render: (row: TestSummaryRow) => percent(row.passRate),
    },
    {
      key: "avgPercent",
      header: "Средний результат",
      sortable: true,
      align: "center" as const,
      numeric: true,
      render: (row: TestSummaryRow) => percent(row.avgPercent),
    },
    {
      key: "suspicious",
      header: "Вопросов под подозрением",
      sortable: true,
      align: "center" as const,
      numeric: true,
      // Э3.4: число из фонового пересчёта; до первого прохода — прочерк, а не ноль.
      render: (row: TestSummaryRow) => (row.suspicious
        ? row.suspicious.count
        : <Text variant="body-s" tone="muted">—</Text>),
    },
    {
      key: "last",
      header: "Последнее прохождение",
      sortable: true,
      align: "center" as const,
      numeric: true,
      render: (row: TestSummaryRow) => day(row.lastAttemptAt),
    },
  ];

  return (
    <Stack gap={4}>
      {/* Поиск — у левого края, по ширине поля, как поиск в панели фильтра (эскиз). */}
      <Stack direction="row">
        <SearchField
          value={query}
          onChange={event => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder="Название теста"
          aria-label="Поиск по названию теста"
          className="tb-tests-search"
          fullWidth
        />
      </Stack>
      <Card>
        <CardHeader
          title="Тесты с прохождениями"
          subtitle={`${tests.length} ${pluralize(tests.length, "тест", "теста", "тестов")} · завершённые прохождения: веб, телеметрия LMS и импортированные выгрузки`}
        />
        <CardBody>
          <DataGrid
            columns={columns}
            rows={rows}
            rowKey={row => row.testId}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={(key, dir) => { setSortKey(key as SortKey); setSortDir(dir); }}
            onRowClick={row => onOpenTest(row.testId)}
            emptyMessage="Тестов с таким названием нет"
          />
        </CardBody>
      </Card>
    </Stack>
  );
}
