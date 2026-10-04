/**
 * @module features/analytics/test/answer-distribution
 * @description Э4а UX-аудита аналитики: распределение ответов — одна разметка у всех типов вопросов
 * (эскиз approved/e4a-answer-distribution.html).
 *
 * Сжатый вид — ячейка таблицы «Вопросы»: полоса из отрезков и подпись не длиннее двух строк, по
 * наведению — легенда «цвет — ответ — доля». Полный вид живёт на странице вопроса и берёт отсюда
 * те же цвета, чтобы ответ узнавался по цвету на обоих экранах.
 *
 * Решения владельца 2026-10-04:
 *   - у каждого ответа свой цвет из палитры категорий дизайн-системы, и цвет закреплён за
 *     ВАРИАНТОМ (его местом в вопросе), а не за долей — иначе один ответ менял бы цвет от строки
 *     к строке и от среза к срезу;
 *   - верные варианты и засчитанные ответы — зелёным; у оцениваемого вопроса бирюзовый из палитры
 *     не берётся: рядом с зелёным он читается как «почти верно»;
 *   - «ещё N написаний» — серым: это сумма разных ответов, а не один ответ.
 *
 * У сопоставления, ранжирования и пропусков вариантов нет: полоса из двух отрезков — «верно» и
 * «неверно», — а под легендой по строке на пару, элемент или пропуск.
 *
 * Решение владельца 2026-10-04 (после приёмки): у вопросов с вариантами и написаниями ячейка —
 * горизонтальные полосы, по полосе на ответ, не больше пяти, по убыванию доли; цвета — те же, что
 * в легенде. Полоса из отрезков показывала части целого, но не давала сравнить ответы: отрезки
 * начинаются в разных местах, и 34 % на глаз не отличались от 41 %. У горизонтальных полос общее
 * начало, и лидер виден сразу. Легенда подсказки — тоже по убыванию доли.
 */
import type { ReactNode } from "react";

import { ChartLegendList, ProgressStacked, Stack, Text } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

import { percent, percentOfShare } from "../format";
import { FloatingHint } from "./floating-hint";
import { num } from "./psychometrics-format";

/** Доля одного варианта в разбросе — то, что отдаёт сервер в `spread.options`. */
export interface SpreadOptionView {
  label: string;
  /** Процент, 0-100 (у множественного выбора сумма больше ста). */
  share: number;
  /** Верен по эталону либо засчитан правилами; нет поля — оценки у ответа нет. */
  correct?: boolean;
}

/** Разброс ответов вопроса (`spread`). */
export interface SpreadView {
  options: SpreadOptionView[];
  answered: number;
}

/** Одна единица разбора — пара, элемент или пропуск (`units.units[]`). */
export interface UnitView {
  index: number;
  label: string;
  reference: string | null;
  context?: string;
  /** Доля 0-1. */
  share: number;
  bottomShare: number | null;
  topShare: number | null;
  mistake: { label: string; share: number } | null;
  place?: number;
  meanPlace?: number | null;
  meanShift?: number | null;
}

/** Разбор по единицам (`units`). */
export interface UnitsView {
  type: "matching" | "ranking" | "blanks";
  units: UnitView[];
  observations: number;
  /** Доля верных единиц, 0-1. */
  share: number;
  meanShift?: number | null;
}

/** Сводка свободного текста (`volume`). */
export interface VolumeView {
  answered: number;
  medianLength: number;
  minLength: number;
  maxLength: number;
}

/** Ответ в полосе и легенде: доля, цвет, подпись. */
export interface ColoredOption {
  label: string;
  /** Процент, 0-100. */
  share: number;
  color: string;
  correct?: boolean;
  /** Сумма нескольких ответов («ещё N написаний», «неверно») — серым. */
  rest?: boolean;
}

/** Палитра категорий дизайн-системы в порядке выдачи. Бирюзовый — последним. */
const PALETTE = [
  "var(--ou-cat-business)",
  "var(--ou-cat-bti)",
  "var(--ou-cat-digital)",
  "var(--ou-cat-b2c)",
  "var(--ou-cat-leadership)",
  "var(--ou-cat-b2b)",
  "var(--ou-cat-b2o)",
] as const;
const CORRECT = "var(--ou-success-default)";
const REST = "var(--ou-border-strong)";

/** Сколько написаний короткого ответа показывать поимённо, остальное — «ещё N». */
const WRITTEN_VISIBLE = 5;
/** Сколько полос в ячейке — остальные ответы в легенде подсказки. */
const BARS_MAX = 5;
/** Длина подписи варианта в сводке, дальше — многоточие. */
const SUMMARY_LABEL_MAX = 44;

/**
 * Раскрасить ответы: верные — зелёным, сумма — серым, остальные — по палитре в порядке
 * вариантов.
 *
 * @param options ответы в порядке вариантов вопроса
 * @returns ответы с цветами
 */
export function colorize(options: ReadonlyArray<Omit<ColoredOption, "color">>): ColoredOption[] {
  const graded = options.some(option => option.correct !== undefined);
  const palette = graded ? PALETTE.slice(0, PALETTE.length - 1) : PALETTE;
  let next = 0;
  return options.map(option => ({
    ...option,
    color: option.correct ? CORRECT : option.rest ? REST : palette[next++ % palette.length],
  }));
}

/** Что рисует ячейка: полоса с легендой, сводка текста или ничего. */
export type CompactModel =
  | {
    kind: "bar";
    options: ColoredOption[];
    /** Подпись под полосой — до двух строк. */
    summary: string;
    /** Строка над легендой: что за доли. */
    head?: string;
    /** Строки под легендой — по паре, элементу или пропуску. */
    extra?: string[];
    /**
     * Горизонтальные полосы ячейки — ответы по убыванию доли, не больше пяти. Нет — ячейка
     * рисует одну полосу «верно / неверно» с подписью (сопоставление, ранжирование, пропуски).
     */
    rows?: ColoredOption[];
    /** Сколько ответов не попало в полосы. */
    more?: number;
  }
  | { kind: "volume"; summary: string };

/** Входные данные строки таблицы для сжатого вида. */
export interface CompactSource {
  questionType: string;
  spread?: SpreadView | null;
  units?: UnitsView | null;
  volume?: VolumeView | null;
}

function cut(label: string): string {
  return label.length > SUMMARY_LABEL_MAX ? `${label.slice(0, SUMMARY_LABEL_MAX).trimEnd()}…` : label;
}

/** «✓ Ответ — 41 %» — так ответ называется в сводке и в строках подсказки. */
function said(option: { label: string; share: number; correct?: boolean }, short: boolean): string {
  return `${option.correct ? "✓ " : ""}${short ? cut(option.label) : option.label} — ${percent(option.share)}`;
}

/** Строка над легендой — что значат доли этого вопроса. */
function headOf(type: string, measurement: boolean, graded: boolean): string | undefined {
  if (type === "multiple") return "Доли отметивших: человек отмечает несколько вариантов, в сумме больше 100 %";
  if (type === "allocation") return "Доля розданных баллов, отданная каждому утверждению";
  if (type === "scale" && measurement) return "Доля выбравших каждую градацию; верного ответа у опросника нет";
  if (type === "short" && graded) return "Зелёным — засчитанные правилами ответы";
  return undefined;
}

function spreadModel(source: CompactSource, spread: SpreadView, measurement: boolean): CompactModel {
  let options: Array<Omit<ColoredOption, "color">> = spread.options.map(o => ({ ...o }));
  let hiddenWritten = 0;
  // У короткого ответа написаний бывают десятки: пять частых поимённо, остальное — одной суммой.
  if (source.questionType === "short" && options.length > WRITTEN_VISIBLE + 1) {
    const ranked = [...options].sort((a, b) => b.share - a.share);
    const shown = new Set(ranked.slice(0, WRITTEN_VISIBLE));
    const hidden = options.filter(o => !shown.has(o));
    hiddenWritten = hidden.length;
    options = [
      ...options.filter(o => shown.has(o)),
      {
        label: `ещё ${hidden.length} ${pluralize(hidden.length, "написание", "написания", "написаний")}`,
        share: hidden.reduce((sum, o) => sum + o.share, 0),
        rest: true,
      },
    ];
  }
  const colored = colorize(options);
  const named = colored.filter(o => !o.rest).sort((a, b) => b.share - a.share);
  const rows = named.slice(0, BARS_MAX);
  const more = named.length - rows.length + hiddenWritten;
  return {
    kind: "bar",
    options: colored,
    // Подпись для экранного диктора — те же ответы, что в полосах.
    summary: rows.map(o => said(o, false)).join(" · ") + (more > 0 ? ` · ещё ${more}` : ""),
    head: headOf(source.questionType, measurement, colored.some(o => o.correct !== undefined)),
    rows,
    more,
  };
}

function unitsModel(units: UnitsView): CompactModel {
  const okShare = units.share * 100;
  const labels = units.type === "matching"
    ? ["пары верно", "пары неверно"]
    : units.type === "ranking" ? ["на своём месте", "не на своём"] : ["пропуски верно", "пропуски неверно"];
  const options = colorize([
    { label: labels[0], share: okShare, correct: true },
    { label: labels[1], share: 100 - okShare, rest: true },
  ]);
  const worst = [...units.units].sort((a, b) => a.share - b.share)[0];
  let summary: string;
  let extra: string[];
  if (units.type === "matching") {
    summary = `пары верно — ${percent(okShare)}${worst && units.units.length > 1 ? ` · хуже всех: ${cut(worst.label)} — ${percentOfShare(worst.share)}` : ""}`;
    extra = units.units.map(u => `${u.label} → ${u.reference ?? "—"}: верно ${percentOfShare(u.share)}`);
  } else if (units.type === "ranking") {
    summary = `на своём месте — ${percent(okShare)}${units.meanShift !== null && units.meanShift !== undefined ? ` · средний сдвиг ${num(units.meanShift, 1)} позиции` : ""}`;
    extra = units.units.map(u => `${u.place}. ${u.label}: на своём месте ${percentOfShare(u.share)}${u.meanPlace !== null && u.meanPlace !== undefined ? `, среднее место ${num(u.meanPlace, 1)}` : ""}`);
  } else {
    summary = units.units.map(u => `${u.label} — ${percentOfShare(u.share)}`).join(" · ");
    extra = units.units.map(u => `${u.label}${u.reference ? ` («${u.reference}»)` : ""}: верно ${percentOfShare(u.share)}`);
  }
  return { kind: "bar", options, summary, extra };
}

/**
 * Модель сжатого вида для строки таблицы.
 *
 * @param source тип вопроса и то, что о его ответах посчитал сервер
 * @param measurement тест измерительный (у опросника нет верного ответа)
 * @returns что рисовать; `null` — рисовать нечего (сервер ничего не посчитал)
 */
export function compactModel(source: CompactSource, measurement = false): CompactModel | null {
  if (source.volume) {
    const v = source.volume;
    return {
      kind: "volume",
      summary: `${v.answered} ${pluralize(v.answered, "ответ", "ответа", "ответов")} · медиана ${v.medianLength} ${pluralize(v.medianLength, "знак", "знака", "знаков")} (от ${v.minLength} до ${v.maxLength}) · читать — на странице вопроса`,
    };
  }
  if (source.units) return unitsModel(source.units);
  if (source.spread && source.spread.options.length > 0) return spreadModel(source, source.spread, measurement);
  return null;
}

/** Легенда подсказки: строка над ней, сама легенда, строки под ней. */
function Legend({ model }: { model: Extract<CompactModel, { kind: "bar" }> }): ReactNode {
  return (
    <Stack gap={2}>
      {model.head ? <span>{model.head}</span> : null}
      <ChartLegendList
        // По убыванию доли (решение владельца 2026-10-04): лидер — первой строкой.
        items={[...model.options].sort((a, b) => b.share - a.share).map((option, index) => ({
          id: String(index),
          color: option.color,
          label: `${option.correct ? "✓ " : ""}${option.label}`,
          value: percent(option.share),
        }))}
      />
      {model.extra?.map(line => <span key={line}>{line}</span>)}
    </Stack>
  );
}

/** Свойства сжатого вида. */
export interface CompactDistributionProps {
  model: CompactModel;
}

/**
 * Сжатый вид распределения — ячейка таблицы.
 *
 * @param props - модель из {@link compactModel}
 * @returns полоса с подписью и легендой по наведению либо сводка текста
 */
export function CompactDistribution({ model }: CompactDistributionProps) {
  if (model.kind === "volume") {
    return <Text variant="body-xs" tone="muted" className="ou-grid__cell-wrap">{model.summary}</Text>;
  }
  if (model.rows) {
    return (
      <FloatingHint content={<Legend model={model} />} className="tb-dist" bubbleClassName="tb-float-hint--legend">
        <Stack gap={1} role="img" aria-label={model.summary}>
          {model.rows.map((row, index) => (
            <Stack key={`${row.label}-${index}`} gap={1}>
              <Stack direction="row" justify="between" gap={2} className="tb-hbar__head">
                <Text variant="body-xs" tone="muted" className="tb-hbar__label">
                  {`${row.correct ? "✓ " : ""}${row.label}`}
                </Text>
                <Text variant="body-xs" tone="muted" className="tb-hbar__value">{percent(row.share)}</Text>
              </Stack>
              {/* Одна полоса на ответ: доля от ста, цвет ответа. У множественного выбора доля —
                  отметивших этот вариант, и полосы честно складываются больше чем в сто. */}
              <ProgressStacked size="s" max={100} segments={[{ value: Math.min(100, row.share), color: row.color }]} />
            </Stack>
          ))}
          {model.more ? <Text variant="body-xs" tone="muted">{`ещё ${model.more}`}</Text> : null}
        </Stack>
      </FloatingHint>
    );
  }
  const total = model.options.reduce((sum, option) => sum + option.share, 0);
  return (
    <FloatingHint content={<Legend model={model} />} className="tb-dist" bubbleClassName="tb-float-hint--legend">
      <Stack gap={1}>
        <ProgressStacked
          size="s"
          role="img"
          aria-label={model.options.map(o => said(o, false)).join(" · ")}
          max={Math.max(100, total)}
          segments={model.options.map(option => ({ value: option.share, color: option.color }))}
        />
        <Text variant="body-xs" tone="muted" className="tb-clamp-2">{model.summary}</Text>
      </Stack>
    </FloatingHint>
  );
}
