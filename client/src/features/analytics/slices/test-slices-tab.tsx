/**
 * @module features/analytics/slices/test-slices-tab
 * @description Э3.2: вкладка «Срезы» уровня теста — сохранённые срезы этого теста и их сравнение
 * (решения владельца 2026-10-03, эскиз approved/e3-test-and-question.html, состояния test-slices,
 * test-compare-result, test-compare-quality).
 *
 * Тест задан страницей, поэтому рамка расчёта — только период: пустой означает «за всё время» и
 * сказан словами (PRD-56 FR-07j). Срезы создаются из фильтра уровня теста («Сохранить как срез»),
 * здесь их смотрят и сравнивают.
 *
 * Сравнение одно на два вопроса: «Результат и темы» (расчёт PRD-56) и «Качество вопросов»
 * (расчёт PRD-66). Переключатель метрик стоит между выбором срезов и таблицами, выбор общий —
 * смена метрик его не сбрасывает. Отбор, присланный кнопкой «Сравнить со срезом», занимает первый
 * слот, и обе метрики считают его одинаково — переключение метрик его не теряет.
 *
 * PRD-56 FR-07k, FR-21g (эскизы approved/slice-compare-answers.html, analytics-indicators.html):
 * третий вид — «Ответы, шкалы и показатели»
 * ({@link module:features/analytics/test/answers-compare-panel}). Переключатель видов стоит у
 * правого края карточки; у теста без эталона сравнение открывается на этом виде — два других у
 * него пусты.
 *
 * Разбивка по полю участника («Разбить по») сюда не входит: это не срез, и она живёт на «Обзоре»
 * («Результаты по группам», {@link module:features/analytics/slices/results-by-axis}).
 */
import { DEFAULT_ATTEMPT_PICK, type AttemptPick } from "@shared/analytics/attempt-pick";
import { useEffect, useState } from "react";

import {
  Card,
  CardBody,
  CardHeader,
  DatePicker,
  SegmentedControl,
  Stack,
  type DatePickerValue,
} from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";
import { PsychometricsCompareBody } from "../test/psychometrics-compare-panel";
import { AnswersCompareBody } from "../test/answers-compare-panel";
import { SliceCompare } from "./slice-compare";
import { SliceList } from "./slice-list";

/** Свойства вкладки. */
export interface TestSlicesTabProps {
  testId: string;
  /**
   * Отбор, присланный кнопкой «Сравнить со срезом» фильтра теста: открывает вкладку в сравнении
   * и занимает первый слот. Сохранения не требует (PRD-56 FR-07b).
   */
  adhoc?: Record<string, unknown> | null;
  /** Имя присланного отбора — у строки разбивки оно есть («Розница»), у фильтра нет. */
  adhocName?: string | null;
  /** Режим попыток психометрики — тот же, что у «Качества вопросов». */
  attempts?: AttemptPick;
  /**
   * Тест без эталона (измерительный): сравнение открывается на «Ответах и шкалах» — сдавших и
   * доли верных у него нет, и два других вида пусты (FR-07k).
   */
  measurement?: boolean;
  /** Открыть вкладку «Прохождения» этого теста с условиями среза. */
  onOpenPassages: (conditions: Record<string, unknown>) => void;
}

/** Вид метрик сравнения (FR-07k). */
type Metric = "result" | "quality" | "answers";

/** Дата календаря в виде `ГГГГ-ММ-ДД` — так её понимают и ручка, и адрес страницы. */
function isoOf(value: DatePickerValue): string | undefined {
  if (!value || Array.isArray(value)) return undefined;
  const month = String(value.m + 1).padStart(2, "0");
  const day = String(value.d).padStart(2, "0");
  return `${value.y}-${month}-${day}`;
}

/**
 * Вкладка «Срезы» теста.
 *
 * @param props - тест, присланный отбор, режим попыток и переход к прохождениям среза
 * @returns рамка «период» и карточка «Сохранённые срезы» / «Сравнение срезов»
 */
export function TestSlicesTab({
  testId, adhoc = null, adhocName = null, attempts = DEFAULT_ATTEMPT_PICK, measurement = false, onOpenPassages,
}: TestSlicesTabProps) {
  /** Вид, с которого открывается сравнение. */
  const firstMetric: Metric = measurement ? "answers" : "result";
  /** Сколько сохранённых срезов у теста — приходит из списка. */
  const [savedCount, setSavedCount] = useState<number | undefined>(undefined);
  const [from, setFrom] = useState<DatePickerValue>(null);
  const [to, setTo] = useState<DatePickerValue>(null);
  const [mode, setMode] = useState<"list" | "compare">(adhoc ? "compare" : "list");
  const [metric, setMetric] = useState<Metric>(firstMetric);
  /** Выбор срезов — общий для обеих метрик. */
  const [slots, setSlots] = useState<Array<string | null>>(["whole", null]);
  /** Срез из строки списка, отправленный в сравнение пунктом «Сравнить с другим срезом». */
  const [compareSlice, setCompareSlice] = useState<{ conditions: Record<string, unknown>; name: string } | null>(null);

  // Присланный отбор открывает сравнение: за этим сюда и пришли.
  useEffect(() => {
    if (adhoc) {
      setMode("compare");
      setMetric(firstMetric);
      setSlots(["adhoc", null]);
    }
  }, [adhoc, firstMetric]);

  const fromIso = isoOf(from);
  const toIso = isoOf(to);

  // У правого края карточки, под слотами (решение владельца 2026-10-06).
  const metricSwitch = (
    <Stack direction="row" justify="end">
      <SegmentedControl
        size="s"
        aria-label="Что сравнивать"
        value={metric}
        onChange={value => setMetric(value as Metric)}
        items={[
          { value: "result", label: "Результат и темы" },
          { value: "quality", label: "Качество вопросов" },
          { value: "answers", label: "Ответы, шкалы и показатели" },
        ]}
      />
    </Stack>
  );

  return (
    <Stack gap={4}>
      {/* Рамка расчёта: тест задан страницей, остаётся период. */}
      <Stack gap={4} direction="row" wrap align="end">
        <DatePicker label="Период с" value={from} onChange={setFrom} placeholder="не ограничен" />
        <DatePicker label="по" value={to} onChange={setTo} placeholder="не ограничен" />
      </Stack>

      <Card>
        <CardHeader
          title={mode === "compare" ? "Сравнение срезов" : "Сохранённые срезы"}
          subtitle={mode === "compare"
            ? "Срезы этого теста в одной рамке: сравниваются доли, а не объёмы"
            : savedCount === undefined
              ? "Срезы этого теста · считаются заново при каждом открытии"
              : `${savedCount} ${pluralize(savedCount, "срез", "среза", "срезов")} этого теста · считаются заново при каждом открытии`}
          trail={
            <SegmentedControl
              size="s"
              value={mode}
              onChange={value => setMode(value as "list" | "compare")}
              items={[
                { value: "list", label: "Список срезов" },
                { value: "compare", label: "Сравнение" },
              ]}
            />
          }
        />
        <CardBody>
          {mode === "list" ? (
            <SliceList
              fill
              testId={testId}
              from={fromIso}
              to={toIso}
              onLoaded={setSavedCount}
              // Строка среза — в «Прохождения» этого теста с условиями среза и периодом рамки.
              onOpenRegistry={conditions => onOpenPassages({
                ...conditions,
                ...(fromIso ? { from: fromIso } : {}),
                ...(toIso ? { to: toIso } : {}),
              })}
              onCompare={(conditions, name) => {
                setCompareSlice({ conditions, name });
                setSlots(["adhoc", null]);
                setMetric(firstMetric);
                setMode("compare");
              }}
            />
          ) : metric === "result" ? (
            <SliceCompare
              testId={testId}
              from={fromIso}
              to={toIso}
              adhoc={compareSlice?.conditions ?? adhoc}
              adhocName={compareSlice?.name ?? adhocName}
              slots={slots}
              onSlotsChange={setSlots}
              between={metricSwitch}
            />
          ) : metric === "answers" ? (
            <AnswersCompareBody
              testId={testId}
              from={fromIso}
              to={toIso}
              adhoc={compareSlice?.conditions ?? adhoc}
              adhocName={compareSlice?.name ?? adhocName}
              slots={slots}
              onSlotsChange={setSlots}
              between={metricSwitch}
            />
          ) : (
            <PsychometricsCompareBody
              testId={testId}
              from={fromIso}
              to={toIso}
              attempts={attempts}
              adhoc={compareSlice?.conditions ?? adhoc}
              adhocName={compareSlice?.name ?? adhocName}
              slots={slots}
              onSlotsChange={setSlots}
              between={metricSwitch}
            />
          )}
        </CardBody>
      </Card>
    </Stack>
  );
}
