/**
 * @module features/analytics/test/psychometrics-compare-panel
 * @description PRD-66 FR-04b: сравнение срезов по качеству вопросов.
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
 * Э3.2 (эскиз approved/e3-test-and-question.html, состояние test-compare-quality): сравнение
 * переехало с «Качества вопросов» во вкладку «Срезы» теста — сравнение одно, а «Качество
 * вопросов» — второй вид его метрик рядом с «Результатом и темами». Карточку, режимы и
 * переключатель метрик держит вкладка; здесь — слоты и таблицы. Слоты общие с «Результатом и
 * темами» (управляемые снаружи): переключение метрик не сбрасывает выбор — в том числе
 * временный отбор кнопки «Сравнить со срезом», который ручка считает как срез `adhoc`.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Stack, Text } from "@skillum/ui-kit";

import { conditionsToFilter, describeConditions } from "../registry/filter-state";
import { useRegistryDictionaries } from "../registry/use-dictionaries";
import { SliceSlots } from "../slices/slice-slots";
import { PsychometricsCompare, passagesLabel, type PsychometricsSlice } from "./psychometrics-compare";

export interface PsychometricsCompareBodyProps {
  testId: string;
  /** Начало периода рамки (`ГГГГ-ММ-ДД`); пусто — без ограничения. */
  from?: string;
  /** Конец периода рамки (`ГГГГ-ММ-ДД`), включительно; пусто — без ограничения. */
  to?: string;
  /** Режим попыток: он меняет числа сильнее любого фильтра и едет в запрос как есть. */
  firstAttemptOnly?: boolean;
  /**
   * Отбор, присланный кнопкой «Сравнить со срезом», — временный срез `adhoc`. Без него
   * переключение на эту метрику оставляло первый слот пустым.
   */
  adhoc?: Record<string, unknown> | null;
  /** Имя присланного отбора. */
  adhocName?: string | null;
  /** Выбранные срезы — общие с «Результатом и темами» вкладки «Срезы». */
  slots: Array<string | null>;
  onSlotsChange: (slots: Array<string | null>) => void;
  /** Что стоит между слотами и таблицами — переключатель метрик вкладки. */
  between?: ReactNode;
}

/**
 * Слоты и таблицы сравнения по качеству вопросов.
 *
 * @param props - тест, период рамки, режим попыток, временный отбор, выбранные срезы и то, что
 *   встаёт между слотами и таблицами
 * @returns слоты, переключатель метрик вкладки и таблицы сравнения
 */
export function PsychometricsCompareBody({
  testId, from, to, firstAttemptOnly = true, adhoc = null, adhocName = null, slots, onSlotsChange, between,
}: PsychometricsCompareBodyProps) {
  const [available, setAvailable] = useState<PsychometricsSlice[]>([]);
  const [failed, setFailed] = useState(false);
  /** Счётчик перезагрузок: правка условий меняет числа, и срезы надо пересчитать. */
  const [reloads, setReloads] = useState(0);
  /** Названия тестов и групп — чтобы условие читалось, а не значилось кодом. */
  const dictionaries = useRegistryDictionaries();

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams({ withWhole: "1" });
    if (!firstAttemptOnly) query.set("firstAttemptOnly", "false");
    // Период рамки — тот же, что у «Результата и тем»: иначе две метрики одного сравнения
    // считались бы по разным прохождениям.
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    // Набранный отбор считается сервером тем же разбором, что и у «Результата и тем».
    if (adhoc && Object.keys(adhoc).length > 0) {
      query.set("conditions", JSON.stringify(adhoc));
      if (adhocName?.trim()) query.set("conditionsName", adhocName.trim());
    }

    void (async () => {
      try {
        const response = await fetch(
          `/api/analytics/psychometrics/${testId}/slices?${query.toString()}`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { slices: PsychometricsSlice[] };
        if (alive) setAvailable(data.slices ?? []);
      } catch {
        if (alive) setFailed(true);
      }
    })();

    return () => { alive = false; };
  }, [testId, from, to, firstAttemptOnly, adhoc, adhocName, reloads]);

  const selected = useMemo(
    () => slots
      .map(id => (id === null ? undefined : available.find(slice => slice.id === id)))
      .filter((slice): slice is PsychometricsSlice => !!slice),
    [slots, available],
  );

  const conditionsOf = useMemo(
    () => new Map(available.map(slice => [
      slice.id,
      // Тест в подписи не называется: он задан страницей, у всех срезов сравнения один.
      describeConditions({ ...conditionsToFilter(slice.conditions ?? {}), testIds: [] }, dictionaries),
    ])),
    [available, dictionaries],
  );

  if (failed) return <Text tone="error">Не удалось загрузить срезы. Обновите страницу.</Text>;

  return (
    <Stack gap={4}>
      <SliceSlots
        slots={slots}
        onSlotsChange={onSlotsChange}
        available={available}
        conditionsOf={conditionsOf}
        countLabel={slice => passagesLabel(slice.respondents)}
        onConditionsSaved={() => setReloads(value => value + 1)}
        minSlots={2}
      />
      {between}
      <PsychometricsCompare slices={selected} />
    </Stack>
  );
}
