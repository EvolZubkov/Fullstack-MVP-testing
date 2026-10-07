/**
 * @module features/analytics/test/answers-compare
 * @description PRD-56 FR-07k - FR-07n, FR-21g: таблицы сравнения срезов «Ответы, шкалы и
 * показатели» (эскизы approved/slice-compare-answers.html, approved/analytics-indicators.html).
 *
 * Таблицы говорят одним языком — доля числом и полосой в колонке среза, «Разница» в
 * процентных пунктах только при двух срезах:
 *   - показатели: средние числовых показателей, затем доли уровней или исходов каждого
 *     показателя, у которого они есть (FR-21g);
 *   - средние шкал по срезам;
 *   - уровни каждой шкалы: строка — уровень, колонка — срез. Составной полосы нет: границы
 *     сегментов на разных строках на глаз не сравнить (решение владельца 2026-10-06);
 *   - вопросы: строка — вопрос с вариантом наибольшей разницы и «Расхождением», сортировка
 *     щелчком по заголовку, строка раскрывается в полную таблицу вариантов.
 *
 * Тона нет нигде (FR-21b): у опросника нет «хорошо» и «плохо». Заметная разница выделяется
 * начертанием, заметное расхождение — тегом.
 */
import { useMemo, useState } from "react";

import { DataGrid, Stack, Tag, Text } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import type { QuestionType } from "@shared/questions/question-type";
import {
  NOTABLE_SPREAD,
  compareAnswerSpreads,
  type CompareQuestionRow,
  type SliceQuestionSpread,
} from "@shared/analytics/answer-compare";

import { percent } from "../format";
import { colorize } from "./answer-distribution";
import type { IndicatorProfileView, IndicatorShareView } from "./indicator-profile";
import type { ScaleProfileView } from "./scale-profile";

/** Срез в ответе `GET /api/analytics/tests/:testId/answer-slices`. */
export interface AnswersSlice {
  id: string;
  name: string;
  conditions: Record<string, unknown>;
  respondents: number;
  questions: SliceQuestionSpread[];
  scales: ScaleProfileView[];
  /** PRD-56 FR-21g; absent in an answer of a server older than the indicators. */
  indicators?: IndicatorProfileView[];
}

/** Вопрос теста в порядке теста — подпись строки. */
export interface AnswersQuestionMeta {
  questionId: string;
  prompt: string;
  type: string;
  topicName: string;
}

export interface AnswersCompareProps {
  slices: AnswersSlice[];
  questions: AnswersQuestionMeta[];
  minObservations: number;
}

/** Разница со знаком в процентных пунктах. */
function points(delta: number): string {
  const rounded = Math.round(delta);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded)} п.п.`;
}

/** Разница, выделенная начертанием, когда она заметна (FR-07n). */
function Delta({ value }: { value: number | null }) {
  if (value === null) return <Text variant="body-s" tone="muted">—</Text>;
  return (
    <Text variant="body-s" weight={Math.abs(value) >= NOTABLE_SPREAD ? "semibold" : undefined}>
      {points(value)}
    </Text>
  );
}

/** Доля с полосой в цвете варианта — как в разборе вопроса (`tb-psy-scale`). */
function Share({ share, color, muted }: { share: number | null; color?: string; muted?: boolean }) {
  if (share === null) return <Text variant="body-s" tone="muted">—</Text>;
  return (
    <span className="tb-psy-scale">
      <span className={`tb-psy-scale__value ou-text ou-text--body-s${muted ? " ou-text--tone-muted" : ""}`}>
        {percent(share)}
      </span>
      <span className="tb-psy-scale__track">
        <span className="tb-psy-scale__fill" style={{ width: `${Math.round(share)}%`, ...(color ? { background: color } : {}) }} />
      </span>
    </span>
  );
}

/** Подпись строки с цветной меткой — той же, что в полосе вкладки «Вопросы». */
function Labelled({ label, color }: { label: string; color?: string }) {
  return (
    <span className="tb-psy-prompt">
      {color ? <span className="tb-dist-dot" style={{ background: color }} /> : null}
      {label}
    </span>
  );
}

/** Цвета вариантов — та же раскраска, что в полосе вкладки «Вопросы»: по порядку вариантов. */
function colorsOf(row: CompareQuestionRow): string[] {
  return colorize(row.options.map(option => ({ label: option.label, share: 0 }))).map(option => option.color);
}

/** «26 и 22 ответа», «26, 22, 41 и 6 ответов». */
function answersLabel(counts: number[]): string {
  const last = counts[counts.length - 1] ?? 0;
  const head = counts.slice(0, -1).join(", ");
  return `${head ? `${head} и ` : ""}${last} ${pluralize(last, "ответ", "ответа", "ответов")}`;
}

/** Среднее «27,4 из 35»; без домена — само значение. Шкала и числовой показатель — одинаково. */
function averageText(scale: Pick<ScaleProfileView, "average" | "domainMax"> | undefined): string {
  if (!scale || scale.average === null) return "—";
  const value = (Math.round(scale.average * 10) / 10).toString().replace(".", ",");
  return scale.domainMax === null ? value : `${value} из ${scale.domainMax}`;
}

/** Разница средних двух срезов по видимым значениям (одна цифра после запятой). */
function AverageDelta({ a, b }: { a: number | null; b: number | null }) {
  if (a === null || b === null) return <Text variant="body-s" tone="muted">—</Text>;
  // По видимым значениям: иначе разница не сходится с ними.
  const delta = Math.round((Math.round(a * 10) - Math.round(b * 10))) / 10;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return <Text variant="body-s">{`${sign}${Math.abs(delta).toString().replace(".", ",")}`}</Text>;
}

type SortKey = "spread" | "question" | `slice-${number}`;

/**
 * Сравнение срезов «Ответы, шкалы и показатели».
 *
 * @param props - выбранные срезы в порядке слотов, вопросы теста и минимум наблюдений
 * @returns блоки «Показатели», «Шкалы» и «Ответы на вопросы»
 */
export function AnswersCompare({ slices, questions, minObservations }: AnswersCompareProps) {
  const [sortKey, setSortKey] = useState<SortKey>("spread");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const pairwise = slices.length === 2;
  const order = useMemo(() => new Map(questions.map((q, index) => [q.questionId, index])), [questions]);
  const metaOf = useMemo(() => new Map(questions.map(q => [q.questionId, q])), [questions]);

  const rows = useMemo(
    () => compareAnswerSpreads(
      slices.map(slice => new Map(slice.questions.map(q => [q.questionId, q]))),
      questions.map(q => q.questionId),
      minObservations,
    ),
    [slices, questions, minObservations],
  );

  const sorted = useMemo(() => {
    const valueOf = (row: CompareQuestionRow): number => {
      if (sortKey === "spread") return row.spread ?? -1;
      if (sortKey === "question") return order.get(row.questionId) ?? 0;
      const slot = Number(sortKey.slice("slice-".length));
      return row.topIndex === null ? -1 : row.options[row.topIndex].shares[slot] ?? -1;
    };
    return [...rows].sort((a, b) => (sortDir === "asc" ? 1 : -1) * (valueOf(a) - valueOf(b)));
  }, [rows, sortKey, sortDir, order]);

  if (slices.length < 2) {
    return <Text variant="body-s" tone="muted">Для сравнения нужны хотя бы два среза.</Text>;
  }

  // ── Шкалы ──
  const scaleKeys = slices[0].scales.map(scale => scale.key);
  const scaleOf = (slice: AnswersSlice, key: string) => slice.scales.find(scale => scale.key === key);
  const scaleRows = scaleKeys.map(key => ({ key, label: scaleOf(slices[0], key)?.label ?? key }));
  const scaleColumns = [
    { key: "scale", header: "Шкала", width: "36%", render: (row: { key: string; label: string }) => <span>{row.label}</span> },
    ...slices.map((slice, slot) => ({
      key: `slice-${slot}`,
      header: slice.name,
      align: "center" as const,
      numeric: true,
      render: (row: { key: string }) => <Text variant="body-s">{averageText(scaleOf(slice, row.key))}</Text>,
    })),
    ...(pairwise
      ? [{
        key: "delta",
        header: "Разница",
        align: "center" as const,
        numeric: true,
        width: "12%",
        render: (row: { key: string }) => (
          <AverageDelta
            a={scaleOf(slices[0], row.key)?.average ?? null}
            b={scaleOf(slices[1], row.key)?.average ?? null}
          />
        ),
      }]
      : []),
  ];

  /** Уровни шкалы — по полосам первого среза: полосы задаёт шкала, у всех срезов они одни. */
  const levelTable = (key: string) => {
    const bands = scaleOf(slices[0], key)?.bands ?? [];
    if (bands.length === 0) return null;
    const shareOf = (slice: AnswersSlice, level: string) =>
      scaleOf(slice, key)?.bands.find(band => band.level === level)?.share ?? null;
    const columns = [
      {
        key: "level", header: "Уровень", width: "36%",
        render: (band: (typeof bands)[number]) => <Labelled label={band.label} color={band.color} />,
      },
      ...slices.map((slice, slot) => ({
        key: `slice-${slot}`,
        header: slice.name,
        align: "center" as const,
        render: (band: (typeof bands)[number]) => <Share share={shareOf(slice, band.level)} color={band.color} />,
      })),
      ...(pairwise
        ? [{
          key: "delta", header: "Разница", align: "center" as const, numeric: true, width: "12%",
          render: (band: (typeof bands)[number]) => {
            const a = shareOf(slices[0], band.level);
            const b = shareOf(slices[1], band.level);
            // По видимым целым процентам — как у вариантов ответа (shared/analytics/answer-compare).
            return <Delta value={a === null || b === null ? null : Math.round(a) - Math.round(b)} />;
          },
        }]
        : []),
    ];
    return (
      <Stack key={key} gap={1}>
        <Text variant="body-s" weight="medium">{scaleOf(slices[0], key)?.label ?? key} · уровни</Text>
        <DataGrid columns={columns} rows={bands} rowKey={band => band.level} />
      </Stack>
    );
  };

  // ── Показатели (FR-21g) ──
  const indicatorOf = (slice: AnswersSlice, name: string) =>
    slice.indicators?.find(indicator => indicator.name === name);
  const indicatorNames = (slices[0].indicators ?? []).map(indicator => indicator.name);
  const numericRows = indicatorNames
    .filter(name => indicatorOf(slices[0], name)?.type === "number")
    .map(name => ({ key: name, label: indicatorOf(slices[0], name)?.label ?? name }));
  const indicatorColumns = [
    { key: "indicator", header: "Показатель", width: "36%", render: (row: { key: string; label: string }) => <span>{row.label}</span> },
    ...slices.map((slice, slot) => ({
      key: `slice-${slot}`,
      header: slice.name,
      align: "center" as const,
      numeric: true,
      render: (row: { key: string }) => <Text variant="body-s">{averageText(indicatorOf(slice, row.key))}</Text>,
    })),
    ...(pairwise
      ? [{
        key: "delta", header: "Разница", align: "center" as const, numeric: true, width: "12%",
        render: (row: { key: string }) => (
          <AverageDelta
            a={indicatorOf(slices[0], row.key)?.average ?? null}
            b={indicatorOf(slices[1], row.key)?.average ?? null}
          />
        ),
      }]
      : []),
  ];

  /**
   * Доли уровней или исходов показателя по срезам. Строки — объединение по всем срезам: исход,
   * которого у среза нет, у него НОЛЬ (сервер не присылает пустые исходы), а прочерк — только у
   * среза, где значений показателя нет вовсе. «Прочее» — последней строкой.
   */
  const indicatorShareTable = (name: string) => {
    const head = indicatorOf(slices[0], name);
    if (!head || head.kind === "average") return null;
    const byKey = new Map<string, IndicatorShareView>();
    for (const slice of slices) {
      for (const share of indicatorOf(slice, name)?.shares ?? []) {
        if (!byKey.has(share.key)) byKey.set(share.key, share);
      }
    }
    const shareRows = [...byKey.values()].sort((a, b) => Number(!!a.rest) - Number(!!b.rest));
    if (shareRows.length === 0) return null;
    const shareOf = (slice: AnswersSlice, key: string): number | null => {
      const indicator = indicatorOf(slice, name);
      if (!indicator || indicator.sampleSize === 0) return null;
      return indicator.shares.find(share => share.key === key)?.share ?? 0;
    };
    const columns = [
      {
        key: "share", header: head.kind === "bands" ? "Уровень" : "Исход", width: "36%",
        render: (share: IndicatorShareView) => <Labelled label={share.label} color={share.color} />,
      },
      ...slices.map((slice, slot) => ({
        key: `slice-${slot}`,
        header: slice.name,
        align: "center" as const,
        render: (share: IndicatorShareView) => <Share share={shareOf(slice, share.key)} color={share.color} />,
      })),
      ...(pairwise
        ? [{
          key: "delta", header: "Разница", align: "center" as const, numeric: true, width: "12%",
          render: (share: IndicatorShareView) => {
            const a = shareOf(slices[0], share.key);
            const b = shareOf(slices[1], share.key);
            return <Delta value={a === null || b === null ? null : Math.round(a) - Math.round(b)} />;
          },
        }]
        : []),
    ];
    return (
      <Stack key={name} gap={1}>
        <Text variant="body-s" weight="medium">
          {`${head.label} · ${head.kind === "bands" ? "уровни" : "исходы"}`}
        </Text>
        <DataGrid columns={columns} rows={shareRows} rowKey={share => share.key} />
      </Stack>
    );
  };

  // ── Вопросы ──
  const thinNames = slices.filter((_, slot) => rows.some(row => row.thin[slot] && row.answered[slot] > 0));
  const questionColumns = [
    {
      key: "question",
      header: "Вопрос",
      sortable: true,
      width: "30%",
      render: (row: CompareQuestionRow) => {
        const meta = metaOf.get(row.questionId);
        return (
          // Разметка ячейки вопроса — как в таблице вкладки «Вопросы»: значок типа в строке текста,
          // текст переносится.
          <Stack gap={1} className="ou-grid__cell-wrap">
            <span className="ou-grid__cell-strong">
              {meta && <QuestionTypeIcon type={meta.type as QuestionType} />}
              {meta?.prompt ?? row.questionId}
            </span>
            <Text variant="body-xs" tone="muted">{`${meta?.topicName ?? ""} · ${answersLabel(row.answered)}`}</Text>
          </Stack>
        );
      },
    },
    {
      key: "top",
      header: "Вариант с наибольшей разницей",
      width: "24%",
      render: (row: CompareQuestionRow) => {
        if (row.topIndex === null) return <Text variant="body-s" tone="muted">—</Text>;
        return <Labelled label={row.options[row.topIndex].label} color={colorsOf(row)[row.topIndex]} />;
      },
    },
    // Доли — числами, без полос: при четырёх срезах колонка узкая, и полоса вырождается в точку.
    ...slices.map((slice, slot) => ({
      key: `slice-${slot}`,
      header: slice.name,
      align: "center" as const,
      numeric: true,
      sortable: true,
      render: (row: CompareQuestionRow) => {
        const share = row.topIndex === null ? null : row.options[row.topIndex].shares[slot];
        if (share === null) return <Text variant="body-s" tone="muted">—</Text>;
        return <Text variant="body-s" tone={row.thin[slot] ? "muted" : undefined}>{percent(share)}</Text>;
      },
    })),
    {
      key: "spread",
      header: "Расхождение",
      align: "center" as const,
      numeric: true,
      sortable: true,
      width: "12%",
      render: (row: CompareQuestionRow) => {
        if (row.spread === null) return <Text variant="body-s" tone="muted">—</Text>;
        const label = `${Math.round(row.spread)} п.п.`;
        return row.spread >= NOTABLE_SPREAD
          ? <Tag tone="info" size="s">{label}</Tag>
          : <Text variant="body-s" tone="muted">{label}</Text>;
      },
    },
  ];

  /** Полная таблица вариантов вопроса по срезам — раскрытая строка. */
  const optionsTable = (row: CompareQuestionRow) => {
    const colors = colorsOf(row);
    const options = row.options.map((option, index) => ({ ...option, index, color: colors[index] }));
    const columns = [
      {
        key: "option", header: "Вариант ответа", width: "36%",
        render: (option: (typeof options)[number]) => <Labelled label={option.label} color={option.color} />,
      },
      ...slices.map((slice, slot) => ({
        key: `slice-${slot}`,
        header: slice.name,
        align: "center" as const,
        render: (option: (typeof options)[number]) => (
          <Share share={option.shares[slot]} color={option.color} muted={row.thin[slot]} />
        ),
      })),
      ...(pairwise
        ? [{
          key: "delta", header: "Разница", align: "center" as const, numeric: true, width: "12%",
          render: (option: (typeof options)[number]) => {
            const [a, b] = option.shares;
            return <Delta value={a === null || b === null ? null : a - b} />;
          },
        }]
        : []),
    ];
    return <DataGrid columns={columns} rows={options} rowKey={option => String(option.index)} />;
  };

  return (
    <Stack gap={6}>
      {indicatorNames.length > 0 && (
        <Stack gap={3}>
          <Text variant="body-s" weight="medium">Показатели</Text>
          {numericRows.length > 0 && (
            <DataGrid columns={indicatorColumns} rows={numericRows} rowKey={row => row.key} />
          )}
          {indicatorNames.map(indicatorShareTable)}
        </Stack>
      )}
      {scaleRows.length > 0 && (
        <Stack gap={3}>
          <Text variant="body-s" weight="medium">Шкалы</Text>
          <DataGrid columns={scaleColumns} rows={scaleRows} rowKey={row => row.key} />
          {scaleKeys.map(levelTable)}
        </Stack>
      )}
      <Stack gap={3}>
        <Text variant="body-s" weight="medium">
          {`Ответы на вопросы · ${rows.length} ${pluralize(rows.length, "вопрос", "вопроса", "вопросов")}`}
        </Text>
        <DataGrid
          columns={questionColumns}
          rows={sorted}
          rowKey={row => row.questionId}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(key, dir) => { setSortKey(key as SortKey); setSortDir(dir); }}
          expandable
          renderExpanded={optionsTable}
          emptyMessage="Ни один срез не отвечал на вопросы теста"
        />
        {thinNames.map(slice => (
          <Text key={slice.id} variant="body-xs" tone="muted">
            {`«${slice.name}»: ответов меньше минимума наблюдений (${minObservations}) — в расхождение не входит.`}
          </Text>
        ))}
      </Stack>
    </Stack>
  );
}
