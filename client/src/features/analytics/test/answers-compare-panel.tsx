/**
 * @module features/analytics/test/answers-compare-panel
 * @description PRD-56 FR-07k: сравнение срезов «Ответы и шкалы» — слоты и таблицы.
 *
 * Слоты, выбор сохранённого среза, правка условий и предел в четыре — тем же компонентом
 * {@link SliceSlots}, что у двух других видов сравнения: механизм один, и выглядеть он обязан
 * одинаково. Слоты общие с ними (управляемые снаружи) — переключение вида не сбрасывает выбор, в
 * том числе временный отбор кнопки «Сравнить со срезом» (срез `adhoc`).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Stack, Text } from "@skillum/ui-kit";

import { conditionsToFilter, describeConditions } from "../registry/filter-state";
import { useRegistryDictionaries } from "../registry/use-dictionaries";
import { SliceSlots } from "../slices/slice-slots";
import { AnswersCompare, type AnswersQuestionMeta, type AnswersSlice } from "./answers-compare";
import { passagesLabel } from "./psychometrics-compare";

export interface AnswersCompareBodyProps {
  testId: string;
  /** Начало периода рамки (`ГГГГ-ММ-ДД`); пусто — без ограничения. */
  from?: string;
  /** Конец периода рамки (`ГГГГ-ММ-ДД`), включительно; пусто — без ограничения. */
  to?: string;
  /** Отбор, присланный кнопкой «Сравнить со срезом», — временный срез `adhoc`. */
  adhoc?: Record<string, unknown> | null;
  /** Имя присланного отбора. */
  adhocName?: string | null;
  /** Выбранные срезы — общие с двумя другими видами сравнения. */
  slots: Array<string | null>;
  onSlotsChange: (slots: Array<string | null>) => void;
  /** Что стоит между слотами и таблицами — переключатель видов вкладки. */
  between?: ReactNode;
}

/** Ответ `GET /api/analytics/tests/:testId/answer-slices`. */
interface AnswerSlicesResponse {
  minObservations: number;
  questions: AnswersQuestionMeta[];
  slices: AnswersSlice[];
}

/**
 * Слоты и таблицы сравнения «Ответы и шкалы».
 *
 * @param props - тест, период рамки, временный отбор, выбранные срезы и переключатель видов
 * @returns слоты, переключатель и таблицы сравнения
 */
export function AnswersCompareBody({
  testId, from, to, adhoc = null, adhocName = null, slots, onSlotsChange, between,
}: AnswersCompareBodyProps) {
  const [data, setData] = useState<AnswerSlicesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  /** Правка условий меняет числа — срезы перечитываются. */
  const [reloads, setReloads] = useState(0);
  const dictionaries = useRegistryDictionaries();

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams({ withWhole: "1" });
    // Период рамки — тот же, что у двух других видов: одно сравнение считается по одним прохождениям.
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (adhoc && Object.keys(adhoc).length > 0) {
      query.set("conditions", JSON.stringify(adhoc));
      if (adhocName?.trim()) query.set("conditionsName", adhocName.trim());
    }
    void (async () => {
      try {
        const response = await fetch(`/api/analytics/tests/${testId}/answer-slices?${query.toString()}`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as Partial<AnswerSlicesResponse>;
        // Отсутствующий список — пустой, а не падение экрана: срез без вопросов и шкал законен.
        if (alive) {
          setData({
            minObservations: body.minObservations ?? 0,
            questions: body.questions ?? [],
            slices: (body.slices ?? []).map(slice => ({
              ...slice,
              questions: slice.questions ?? [],
              scales: slice.scales ?? [],
            })),
          });
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [testId, from, to, adhoc, adhocName, reloads]);

  const available = data?.slices ?? [];
  const selected = useMemo(
    () => slots
      .map(id => (id === null ? undefined : available.find(slice => slice.id === id)))
      .filter((slice): slice is AnswersSlice => !!slice),
    [slots, available],
  );
  const conditionsOf = useMemo(
    () => new Map(available.map(slice => [
      slice.id,
      // Тест в подписи не называется: он задан страницей и общий для всех срезов.
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
      {data && (
        <AnswersCompare slices={selected} questions={data.questions} minObservations={data.minObservations} />
      )}
    </Stack>
  );
}
