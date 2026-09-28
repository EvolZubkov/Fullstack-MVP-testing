/**
 * @module features/analytics/slices/slices-tab
 * @description PRD-56 FR-06a, FR-07e, FR-07i, FR-07j: вкладка срезов с рамкой расчёта.
 *
 * Рамка — тест и период — стоит НАД карточкой и общая для обоих режимов: список срезов и их
 * сравнение отвечают на разные вопросы об одной и той же выборке. Тест обязателен (FR-07e):
 * у разных тестов разные пороги и шкалы, и среднее поверх нескольких тестов — то самое
 * неинтерпретируемое число, ради снятия которого затеян PRD-56.
 *
 * Пустой период означает «за всё время» и сказан словами (FR-07j): молчание читатель принимает
 * за «за последний месяц» и делает из среза вывод о периоде, которого никто не задавал.
 */
import { useState } from "react";

import {
  Box,
  Card,
  CardBody,
  CardHeader,
  Combobox,
  DatePicker,
  EmptyState,
  SegmentedControl,
  Select,
  Stack,
  type DatePickerValue,
} from "@skillum/ui-kit";

import { SliceCompare } from "./slice-compare";
import { SliceList } from "./slice-list";

export interface SlicesTabProps {
  /** Тесты, доступные читателю: из них выбирается рамка расчёта. */
  tests: Array<{ id: string; title: string }>;
  /** Открыть реестр по условиям среза (FR-08). */
  onOpenRegistry?: (conditions: Record<string, unknown>) => void;
  /** Открыть аналитику теста по условиям среза — переход «группа → тест» (FR-24). */
  onOpenTestAnalytics?: (testId: string, conditions: Record<string, unknown>) => void;
  /**
   * Отбор, с которым пришли из реестра: сравнивается наравне с сохранёнными срезами и
   * сохранения не требует (FR-07b). Заодно открывает вкладку сразу в режиме сравнения — за
   * этим сюда и пришли.
   */
  adhoc?: Record<string, unknown> | null;
  /** Тест, отобранный в реестре: он становится рамкой расчёта. */
  adhocTestId?: string | null;
}

/**
 * Оси разбиения (FR-06a). Оргструктура — сразу за группой, по убыванию практической ценности:
 * исключение FR-06b отменено 2026-09-28.
 */
const AXES: Array<{ value: string; label: string; heading: string }> = [
  { value: "group", label: "Группа", heading: "Срез по группам" },
  { value: "unit", label: "Подразделение", heading: "Срез по подразделениям" },
  { value: "position", label: "Должность", heading: "Срез по должностям" },
  { value: "organization", label: "Организация", heading: "Срез по организациям" },
  { value: "period", label: "Поток (период)", heading: "Срез по потокам" },
  { value: "attempt", label: "Номер попытки", heading: "Срез по номеру попытки" },
  { value: "version", label: "Версия теста", heading: "Срез по версиям публикации" },
  { value: "variant", label: "Вариант выдачи", heading: "Срез по вариантам выдачи" },
  { value: "source", label: "Источник", heading: "Срез по источникам" },
  { value: "external", label: "Внутренние и внешние", heading: "Срез: внутренние и внешние" },
];

/** Дата календаря в виде `ГГГГ-ММ-ДД` — так её понимают и ручка, и адрес страницы. */
function isoOf(value: DatePickerValue): string | undefined {
  if (!value || Array.isArray(value)) return undefined;
  const month = String(value.m + 1).padStart(2, "0");
  const day = String(value.d).padStart(2, "0");
  return `${value.y}-${month}-${day}`;
}

/** Период словами: пустой — «за всё время», и это сказано, а не подразумевается (FR-07j). */
function periodLabel(from?: string, to?: string): string {
  if (!from && !to) return "за всё время";
  if (from && to) return `с ${from} по ${to}`;
  return from ? `с ${from}` : `по ${to}`;
}

export function SlicesTab({
  tests, onOpenRegistry, onOpenTestAnalytics, adhoc, adhocTestId,
}: SlicesTabProps) {
  const [testId, setTestId] = useState<string | null>(adhocTestId ?? null);
  const [from, setFrom] = useState<DatePickerValue>(null);
  const [to, setTo] = useState<DatePickerValue>(null);
  const [axis, setAxis] = useState("group");
  const [mode, setMode] = useState<"list" | "compare">(adhoc ? "compare" : "list");
  /** Срез из строки списка, отправленный в сравнение пунктом «Сравнить с другим срезом». */
  const [compareSlice, setCompareSlice] = useState<{
    conditions: Record<string, unknown>;
    name: string;
  } | null>(null);

  const fromIso = isoOf(from);
  const toIso = isoOf(to);
  const heading = AXES.find(item => item.value === axis)?.heading ?? "Срезы";

  return (
    <Stack gap={4}>
      {/* Рамка расчёта: одна на оба режима (FR-07i). Тест и период — разные поля: 4x сетки. */}
      <Stack gap={4} direction="row" wrap align="end">
        <Box grow>
          <Combobox
            label="Тест"
            size="s"
            placeholder="Выберите тест"
            options={tests.map(test => ({ value: test.id, label: test.title }))}
            value={testId}
            onChange={setTestId}
          />
        </Box>
        <DatePicker label="Период с" value={from} onChange={setFrom} placeholder="не ограничен" />
        <DatePicker label="по" value={to} onChange={setTo} placeholder="не ограничен" />
      </Stack>

      {testId === null ? (
        // Пустое состояние, а не карточка с серой строкой: карточка во всю ширину с одной
        // фразой внутри читается как поле ввода, которое почему-то не работает. Экран здесь
        // не «показывает ничего», а ЖДЁТ выбора, и сказать об этом должен сам.
        <EmptyState
          title="Выберите тест"
          description="Срезы считаются внутри одного теста: у разных тестов разные пороги и шкалы, и среднее поверх них ничего не значит."
        />
      ) : (
        <Card>
          <CardHeader
            title={mode === "compare" ? "Сравнение срезов" : heading}
            subtitle={`Завершённые прохождения теста ${periodLabel(fromIso, toIso)} · веб, телеметрия LMS и импортированные выгрузки`}
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
            <Stack gap={4}>
              {mode === "list" && (
                // Своя строка: иначе контрол растягивается на ширину карточки и читается как
                // заголовок таблицы, а не как её единственная настройка.
                <Stack direction="row" gap={4} wrap align="end">
                  <Select
                    label="Разбить по"
                    size="s"
                    value={axis}
                    onChange={value => setAxis(String(value))}
                    options={AXES.map(item => ({ value: item.value, label: item.label }))}
                  />
                </Stack>
              )}

              {mode === "compare" ? (
                <SliceCompare
                  testId={testId}
                  from={fromIso}
                  to={toIso}
                  adhoc={compareSlice?.conditions ?? adhoc}
                  adhocName={compareSlice?.name}
                />
              ) : (
                <SliceList
                  testId={testId}
                  axis={axis}
                  from={fromIso}
                  to={toIso}
                  onCompare={(conditions, name) => { setCompareSlice({ conditions, name }); setMode("compare"); }}
                  onOpenRegistry={onOpenRegistry && (conditions => onOpenRegistry({
                    // Рамка расчёта — часть выборки, но не часть условий среза (FR-07e):
                    // добавляется здесь, иначе реестр показал бы прохождения всех тестов.
                    ...conditions,
                    testIds: [testId],
                    ...(fromIso ? { from: fromIso } : {}),
                    ...(toIso ? { to: toIso } : {}),
                  }))}
                  // Тест переход несёт отдельно: на той стороне он задан страницей, а не
                  // условием отбора (FR-13), поэтому в условия его класть нельзя.
                  onOpenTestAnalytics={onOpenTestAnalytics && (conditions => onOpenTestAnalytics(
                    testId,
                    {
                      ...conditions,
                      ...(fromIso ? { from: fromIso } : {}),
                      ...(toIso ? { to: toIso } : {}),
                    },
                  ))}
                />
              )}
            </Stack>
          </CardBody>
        </Card>
      )}
    </Stack>
  );
}
