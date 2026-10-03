/**
 * @module features/analytics/test/psychometrics-compare
 * @description PRD-66 FR-04b — FR-04c: сравнение психометрики по срезам.
 *
 * Свой механизм сравнения трек НЕ заводит. Режим, слоты, подписи условий и правила берутся у
 * раздела «Аналитика» (PRD-56 FR-07) — меняется только СОДЕРЖИМОЕ таблиц: вместо «назначено,
 * начато, сдали» здесь надёжность, ошибка измерения, число заданий под подозрением и трудность
 * по заданиям. Один механизм обязан выглядеть одинаково на обоих экранах, иначе автор учит его
 * дважды.
 *
 * КОЛОНКА «РАЗНИЦА» ПОЯВЛЯЕТСЯ ТОЛЬКО ПРИ ДВУХ СРЕЗАХ (FR-04b2). При трёх и четырёх разница
 * между какими двумя из них — вопрос без ответа, а выбирать «эталонный» срез продукт не умеет
 * и такой сущности не заводит. У СЧЁТНЫХ строк её нет и при двух: разность счётчиков говорит о
 * размере группы, а не о качестве теста.
 *
 * РАЗНИЦА НЕ ТОЛКУЕТСЯ КАК ПРОВЕРКА ЗАДАНИЯ НА СПРАВЕДЛИВОСТЬ К ГРУППЕ (FR-04c): она смешивает
 * разную подготовку срезов и разное поведение задания, и таблица их не разделяет. Поэтому
 * колонка даёт число и НЕ называет его причину, а слова DIF на экране нет.
 *
 * Эскиз: docs/wireframes/prd66-item-quality.html, состояние `compare`. Таблицы стоят внутри
 * карточки «Сравнение срезов» под слотами, заголовками — строки текста, а не свои карточки;
 * под именем среза в заголовке колонки — число прохождений в расчёте: имя даёт автор, а
 * объём решает, насколько числу в колонке можно верить.
 */
import { DataGrid, Stack, Text } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

/** Психометрика одного среза — то, что отдаёт `GET .../psychometrics/:testId/slices`. */
export interface PsychometricsSlice {
  id: string;
  name: string;
  /** Условия отбора среза — их показывают слоты (PRD-56 FR-07f). */
  conditions: Record<string, unknown>;
  alpha: number | null;
  reliabilityGap: string | null;
  sem: number | null;
  /** Прохождений в расчёте: после режима попыток, а не до него. */
  respondents: number;
  observations: number;
  itemsCount: number;
  suspiciousCount: number;
  items: Array<{
    questionId: string;
    prompt: string;
    difficulty: number | null;
    itemRest: number | null;
    observations: number;
  }>;
}

export interface PsychometricsCompareProps {
  slices: PsychometricsSlice[];
}

/** Число с запятой; прочерк там, где величины нет. */
function num(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits).replace(".", ",");
}

/** «214 прохождений» — объём среза в том виде, в каком он стоит в слоте и в заголовке. */
export function passagesLabel(count: number): string {
  return `${count} ${pluralize(count, "прохождение", "прохождения", "прохождений")}`;
}

/** Заголовок колонки среза: имя и под ним объём, как в эскизе. */
function SliceHead({ slice }: { slice: PsychometricsSlice }) {
  return (
    <Stack gap={1}>
      <span>{slice.name}</span>
      <Text variant="body-xs" tone="muted" weight="regular">{passagesLabel(slice.respondents)}</Text>
    </Stack>
  );
}

/** Разница со знаком — читается как направление, а не как модуль. */
function delta(value: number | null, digits = 2, unit = ""): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits).replace(".", ",")}${unit}`;
}

/** Строка сводной таблицы: показатель, значения по срезам и признак сопоставимости. */
interface SummaryRow {
  key: string;
  label: string;
  /**
   * Сопоставимая величина: у неё разницу считать МОЖНО.
   *
   * Счётные строки (число заданий под подозрением) сопоставимыми не считаются: их разность — про размер группы, а не про качество теста.
   */
  comparable: boolean;
  valueOf: (slice: PsychometricsSlice) => number | null;
  format: (value: number | null, slice: PsychometricsSlice) => string;
  /** Разница строки со своей единицей: у ошибки измерения — процентные пункты. */
  formatDelta?: (value: number) => string;
}

const SUMMARY_ROWS: SummaryRow[] = [
  {
    key: "alpha",
    label: "Надёжность (альфа)",
    comparable: true,
    valueOf: slice => slice.alpha,
    format: (value, slice) => value === null
      // Причина отказа важнее прочерка: «посчитать не на чем» и «низкая надёжность» — разное.
      ? (slice.reliabilityGap ? "не посчитана" : "—")
      : num(value),
  },
  {
    key: "sem",
    label: "Ошибка измерения",
    comparable: true,
    // Процентные пункты результата, как на плитке одной выборки (эскиз: «4,8 п.п.»).
    valueOf: slice => slice.sem,
    format: value => (value === null ? "—" : `${num(value, 1)} п.п.`),
    formatDelta: value => delta(value, 1, " п.п."),
  },
  {
    key: "suspicious",
    label: "Вопросов под подозрением",
    comparable: false,
    valueOf: slice => slice.suspiciousCount,
    // Числом, без «из N»: число заданий у срезов одного теста одно, и «из 42» в каждой ячейке
    // повторяло бы одно и то же. Объём среза стоит в заголовке колонки.
    format: value => String(value ?? 0),
  },
];

/** Сравнение психометрики по срезам. */
export function PsychometricsCompare({ slices }: PsychometricsCompareProps) {
  if (slices.length < 2) {
    return (
      <Text variant="body-s" tone="muted">
        Для сравнения нужны хотя бы два среза.
      </Text>
    );
  }

  // Разница считается ТОЛЬКО при двух срезах: при трёх и четырёх «разница между какими двумя»
  // — вопрос без ответа, и колонки нет вовсе.
  const pairwise = slices.length === 2;

  const summaryColumns = [
    {
      key: "metric",
      header: "Показатель",
      frozen: true,
      render: (row: SummaryRow) => <span>{row.label}</span>,
    },
    ...slices.map(slice => ({
      key: `slice-${slice.id}`,
      header: <SliceHead slice={slice} />,
      align: "center" as const,
      numeric: true,
      render: (row: SummaryRow) => (
        <Text variant="body-s">{row.format(row.valueOf(slice), slice)}</Text>
      ),
    })),
    ...(pairwise
      ? [{
        key: "delta",
        header: "Разница",
        align: "center" as const,
        numeric: true,
        render: (row: SummaryRow) => {
          // У счётной строки — прочерк даже при двух срезах.
          if (!row.comparable) return <Text variant="body-s" tone="muted">—</Text>;
          const first = row.valueOf(slices[0]);
          const second = row.valueOf(slices[1]);
          if (first === null || second === null) return <Text variant="body-s" tone="muted">—</Text>;
          return <Text variant="body-s">{row.formatDelta ? row.formatDelta(first - second) : delta(first - second)}</Text>;
        },
      }]
      : []),
  ];

  /** Задания, встреченные хотя бы в одном срезе: объединение, а не пересечение. */
  const questions = new Map<string, string>();
  for (const slice of slices) {
    for (const item of slice.items) questions.set(item.questionId, item.prompt || item.questionId);
  }
  const itemRows = [...questions].map(([questionId, prompt]) => ({ questionId, prompt }));

  const difficultyOf = (slice: PsychometricsSlice, questionId: string) =>
    slice.items.find(item => item.questionId === questionId)?.difficulty ?? null;

  const itemColumns = [
    {
      key: "question",
      header: "Вопрос",
      frozen: true,
      width: "40%",
      render: (row: { questionId: string; prompt: string }) => (
        <span className="tb-psy-prompt">{row.prompt}</span>
      ),
    },
    ...slices.map(slice => ({
      key: `slice-${slice.id}`,
      header: <SliceHead slice={slice} />,
      align: "center" as const,
      numeric: true,
      render: (row: { questionId: string }) => (
        <Text variant="body-s">{num(difficultyOf(slice, row.questionId))}</Text>
      ),
    })),
    ...(pairwise
      ? [{
        key: "delta",
        header: "Разница",
        align: "center" as const,
        numeric: true,
        render: (row: { questionId: string }) => {
          const first = difficultyOf(slices[0], row.questionId);
          const second = difficultyOf(slices[1], row.questionId);
          // Задание, не попавшее в выдачу одного из срезов, — это факт о сравнении, и
          // прочерк честно говорит «здесь его не было».
          if (first === null || second === null) return <Text variant="body-s" tone="muted">—</Text>;
          return <Text variant="body-s">{delta(first - second)}</Text>;
        },
      }]
      : []),
  ];

  // Подпись и её таблица — связанные элементы: 4 px (решение владельца 2026-09-26); между
  // двумя таблицами — разные блоки, их разводит стек панели.
  return (
    <>
      <Stack gap={1}>
        <Text variant="body-s" weight="medium">Надёжность и ошибка измерения</Text>
        {!pairwise && (
          <Text variant="body-xs" tone="muted">Разница считается только при двух срезах</Text>
        )}
        <DataGrid
          columns={summaryColumns}
          rows={SUMMARY_ROWS}
          rowKey={row => row.key}
          emptyMessage="Сравнивать нечего"
        />
      </Stack>

      <Stack gap={1}>
        <Text variant="body-s" weight="medium">Трудность вопросов</Text>
        <DataGrid
          columns={itemColumns}
          rows={itemRows}
          rowKey={row => row.questionId}
          emptyMessage="Вопросов с наблюдениями нет"
        />
      </Stack>
    </>
  );
}
