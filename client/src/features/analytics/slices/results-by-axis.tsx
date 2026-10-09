/**
 * @module features/analytics/slices/results-by-axis
 * @description Э3.2: карточка «Результаты по группам» на «Обзоре» теста — разбивка теста по полю
 * участника (решение владельца 2026-10-03, эскиз approved/e3-test-and-question.html, состояние
 * test-overview).
 *
 * Это бывший «Список срезов» по оси (PRD-56 FR-06a): расчёт прежний, но это НЕ срез, и со
 * срезами он больше не смешивается. Срез — сохранённый набор условий, разбивка — ответ на «как
 * прошли разные группы». Строку разбивки можно сохранить срезом, сравнить или открыть её
 * прохождения.
 *
 * Разбивка подчиняется фильтру уровня теста: его условия — та выборка, которую режет ось.
 * Заголовок карточки и первая колонка следуют оси: «Результаты по подразделениям» и т. д.
 */
import { useState } from "react";

import { Card, CardBody, CardHeader, Select, Stack } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";
import { SliceList } from "./slice-list";

/**
 * Оси разбиения (PRD-56 FR-06a): значение для ручки, подпись выбора, заголовок карточки и
 * колонки. Оргструктура — сразу за группой, по убыванию практической ценности.
 */
export const RESULT_AXES: ReadonlyArray<{ value: string; label: string; heading: string; column: string }> = [
  { value: "group", label: "Группа", heading: "Результаты по группам", column: "Группа" },
  { value: "unit", label: "Подразделение", heading: "Результаты по подразделениям", column: "Подразделение" },
  { value: "position", label: "Должность", heading: "Результаты по должностям", column: "Должность" },
  { value: "organization", label: "Организация", heading: "Результаты по организациям", column: "Организация" },
  { value: "period", label: "Поток (период)", heading: "Результаты по потокам", column: "Поток" },
  { value: "attempt", label: "Номер попытки", heading: "Результаты по номеру попытки", column: "Попытка" },
  { value: "version", label: "Версия теста", heading: "Результаты по версиям публикации", column: "Версия" },
  { value: "variant", label: "Вариант выдачи", heading: "Результаты по вариантам выдачи", column: "Вариант" },
  { value: "source", label: "Источник", heading: "Результаты по источникам", column: "Источник" },
  { value: "external", label: "Внутренние и внешние", heading: "Результаты внутренних и внешних участников", column: "Участники" },
];

/** Свойства карточки. */
export interface ResultsByAxisProps {
  testId: string;
  /** Условия фильтра уровня теста на языке реестра (без теста — он задан страницей). */
  conditions: Record<string, unknown>;
  /** Сколько завершённых прохождений в выборке — для подзаголовка. */
  completed: number;
  /** Открыть «Прохождения» этого теста с условиями строки. */
  onOpenPassages: (conditions: Record<string, unknown>) => void;
  /** Сравнить строку с другим срезом — во вкладке «Срезы». */
  onCompare: (conditions: Record<string, unknown>, name: string) => void;
}

/**
 * «Результаты по группам».
 *
 * @param props - тест, условия уровня теста, объём выборки и переходы строки
 * @returns карточка с выбором оси и таблицей разбивки
 */
export function ResultsByAxis({ testId, conditions, completed, onOpenPassages, onCompare }: ResultsByAxisProps) {
  const [axis, setAxis] = useState("group");
  const current = RESULT_AXES.find(item => item.value === axis) ?? RESULT_AXES[0];
  const from = typeof conditions.from === "string" ? conditions.from : undefined;
  const to = typeof conditions.to === "string" ? conditions.to : undefined;

  return (
    <Card>
      <CardHeader
        title={current.heading}
        subtitle={`${completed} ${pluralize(completed, "завершённое прохождение", "завершённых прохождения", "завершённых прохождений")} теста · строку можно сохранить срезом`}
      />
      <CardBody>
        <Stack gap={4}>
          {/* Своя строка: иначе выбор растягивается на ширину карточки и читается как заголовок
              таблицы, а не как её единственная настройка. */}
          <Stack direction="row" gap={4} wrap align="end">
            <Select
              label="Разбить по"
              size="s"
              value={axis}
              onChange={value => setAxis(String(value))}
              options={RESULT_AXES.map(item => ({ value: item.value, label: item.label }))}
            />
          </Stack>
          <SliceList
            testId={testId}
            axis={axis}
            from={from}
            to={to}
            conditions={conditions}
            nameHeader={current.column}
            onOpenRegistry={rowConditions => onOpenPassages({ ...conditions, ...rowConditions })}
            onCompare={(rowConditions, name) => onCompare({ ...conditions, ...rowConditions }, name)}
          />
        </Stack>
      </CardBody>
    </Card>
  );
}
