/**
 * @module features/analytics/test/psychometrics-compare-panel
 * @description PRD-66 FR-04b: режим сравнения срезов на вкладке «Качество вопросов».
 *
 * Слоты, выбор сохранённого среза, условия, их правка и предел в четыре взяты у раздела
 * «Аналитика» (PRD-56 FR-07, FR-07g) БЕЗ изменений — тем же компонентом
 * {@link SliceSlots}: один механизм обязан выглядеть одинаково на обоих экранах, иначе автор
 * учит его дважды. Меняется только содержимое таблиц — их рисует {@link PsychometricsCompare}.
 *
 * «Тест целиком» — законный участник сравнения и обычный срез БЕЗ условий (PRD-56 FR-07a):
 * отдельной сущности «эталон» в продукте нет, и вопрос «а как у всех?» решается тем же
 * механизмом, что сравнение двух групп.
 *
 * Эскиз: docs/wireframes/prd66-item-quality.html, состояние `compare`. Весь режим — одна
 * карточка «Сравнение срезов»: в подзаголовке названо, что сравнивается и сколько в каждом
 * прохождений, в шапке — переключатель «Одна выборка / Сравнение», которым из режима выходят.
 */
import { useEffect, useMemo, useState } from "react";

import {
  Card, CardBody, CardHeader, SegmentedControl, Stack, Text,
} from "@skillum/ui-kit";

import { conditionsToFilter, describeConditions } from "../registry/filter-state";
import { useRegistryDictionaries } from "../registry/use-dictionaries";
import { SliceSlots } from "../slices/slice-slots";
import { PsychometricsCompare, passagesLabel, type PsychometricsSlice } from "./psychometrics-compare";

export interface PsychometricsComparePanelProps {
  testId: string;
  /** Режим попыток: он меняет числа сильнее любого фильтра и едет в запрос как есть. */
  firstAttemptOnly?: boolean;
  /** Выйти из сравнения к одной выборке — переключателем в шапке карточки. */
  onExit: () => void;
}

/** Сколько срезов словами — для подзаголовка «Два набора условий на одном тесте». */
const COUNT_WORD: Record<number, string> = { 2: "Два", 3: "Три", 4: "Четыре" };

/**
 * Подзаголовок карточки: что сравнивается и сколько в каждом прохождений.
 *
 * Единица названа один раз, у первого среза, как в эскизе: «— 214 прохождений, «Офис» — 272».
 */
function subtitleOf(selected: readonly PsychometricsSlice[]): string {
  if (selected.length < 2) return "Выберите хотя бы два среза — тогда появятся таблицы сравнения";
  const parts = selected.map((slice, index) => (index === 0
    ? `«${slice.name}» — ${passagesLabel(slice.respondents)}`
    : `«${slice.name}» — ${slice.respondents}`));
  return `${COUNT_WORD[selected.length] ?? selected.length} набора условий на одном тесте: ${parts.join(", ")}`;
}

export function PsychometricsComparePanel({ testId, firstAttemptOnly = true, onExit }: PsychometricsComparePanelProps) {
  const [available, setAvailable] = useState<PsychometricsSlice[]>([]);
  const [slots, setSlots] = useState<Array<string | null>>(["whole", null]);
  const [failed, setFailed] = useState(false);
  /** Счётчик перезагрузок: правка условий меняет числа, и срезы надо пересчитать. */
  const [reloads, setReloads] = useState(0);
  /** Названия тестов и групп — чтобы условие читалось, а не значилось кодом. */
  const dictionaries = useRegistryDictionaries();

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams({ withWhole: "1" });
    if (!firstAttemptOnly) query.set("firstAttemptOnly", "false");

    void (async () => {
      try {
        const response = await fetch(
          `/api/analytics/psychometrics/${testId}/slices?${query.toString()}`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { slices: PsychometricsSlice[] };
        if (alive) setAvailable(data.slices);
      } catch {
        if (alive) setFailed(true);
      }
    })();

    return () => { alive = false; };
  }, [testId, firstAttemptOnly, reloads]);

  const selected = useMemo(
    () => slots
      .map(id => (id === null ? undefined : available.find(slice => slice.id === id)))
      .filter((slice): slice is PsychometricsSlice => !!slice),
    [slots, available],
  );

  const conditionsOf = useMemo(
    () => new Map(available.map(slice => [
      slice.id,
      describeConditions(conditionsToFilter(slice.conditions ?? {}), dictionaries),
    ])),
    [available, dictionaries],
  );

  return (
    <Card variant="outlined">
      <CardHeader
        title="Сравнение срезов"
        subtitle={subtitleOf(selected)}
        trail={(
          <SegmentedControl
            size="s"
            aria-label="Режим вкладки"
            value="compare"
            onChange={value => { if (value === "sample") onExit(); }}
            items={[
              { value: "sample", label: "Одна выборка" },
              { value: "compare", label: "Сравнение" },
            ]}
          />
        )}
      />
      <CardBody>
        {failed ? (
          <Text tone="error">Не удалось загрузить срезы. Обновите страницу.</Text>
        ) : (
          <Stack gap={4}>
            <SliceSlots
              slots={slots}
              onSlotsChange={setSlots}
              available={available}
              conditionsOf={conditionsOf}
              countLabel={slice => passagesLabel(slice.respondents)}
              onConditionsSaved={() => setReloads(value => value + 1)}
              minSlots={2}
            />
            <PsychometricsCompare slices={selected} />
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}
