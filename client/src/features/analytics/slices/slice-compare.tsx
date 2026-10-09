/**
 * @module features/analytics/slices/slice-compare
 * @description PRD-56 FR-07, FR-07a, FR-07f, FR-07g: режим сравнения срезов.
 *
 * Сравниваемые срезы названы явно — имя стоит в заголовке столбца, а под ним условия, по
 * которым срез отобран. Это и есть причина, по которой «база» из продукта убрана: невидимая
 * величина, с которой всё молча сравнивалось, порождала числа, необъяснимые на месте.
 *
 * Эскиз: docs/wireframes/prd56-analytics-section.html, состояния `compare` и `compare-many`.
 * Оттуда же порядок: сначала слоты срезов, затем «Прохождения и результат», затем «Доля
 * верных ответов» — объёмы отвечают на «кого сравниваем», доли по темам на «где расходятся».
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button, EmptyState, Stack, Text } from "@skillum/ui-kit";

import { conditionsToFilter, describeConditions } from "../registry/filter-state";
import { useRegistryDictionaries } from "../registry/use-dictionaries";

import { percent } from "../format";

import type { SliceRow, SliceTopic } from "./slice-list";
import { SliceSlots } from "./slice-slots";

export interface SliceCompareProps {
  /** Тест — общее условие сравнения (FR-07e): он один для всех сравниваемых срезов. */
  testId: string;
  from?: string;
  to?: string;
  /**
   * Отбор, набранный в реестре, — сравнивается НАРАВНЕ с сохранёнными срезами и сохранения
   * не требует (FR-07b). Без этого «сравни то, что я отобрал, с Розницей» стоило бы похода в
   * реестр, придумывания имени и лишней строки в списке срезов, нужной на одну минуту.
   */
  adhoc?: Record<string, unknown> | null;
  /**
   * Имя временного среза. Срез, отправленный в сравнение из строки списка («Розница»), —
   * не «Текущий отбор»: безымянная колонка заставила бы гадать, какую строку сюда принесли.
   */
  adhocName?: string | null;
  /**
   * Э3.2: выбранные срезы — снаружи, общие с «Качеством вопросов» вкладки «Срезы»: смена метрик
   * не должна сбрасывать выбор. Без них компонент держит выбор сам.
   */
  slots?: Array<string | null>;
  onSlotsChange?: (slots: Array<string | null>) => void;
  /** Что стоит между слотами и таблицами — переключатель метрик вкладки (эскиз). */
  between?: ReactNode;
}

/** Сколько условий видно в подписи столбца до свёртки в «ещё N» (FR-07f). */
const VISIBLE_CONDITIONS = 2;

/** Показатели сравнения: что именно сопоставляется построчно. */
const ROWS: Array<{
  key: keyof SliceRow;
  label: string;
  /** Доля — у неё разницу считать можно; объём — нельзя. */
  share: boolean;
}> = [
  { key: "assigned", label: "Назначено", share: false },
  { key: "started", label: "Начато", share: false },
  { key: "completed", label: "Завершено", share: false },
  { key: "participants", label: "Участников", share: false },
  { key: "passRate", label: "Сдали", share: true },
  { key: "avgPercent", label: "Средний результат", share: true },
];

/** Значение показателя в ячейке. */
function cell(slice: SliceRow, key: keyof SliceRow, share: boolean): string {
  if (share && !slice.enoughData) return "мало данных";
  const value = slice[key];
  if (value === null || value === undefined) return "—";
  return share ? percent(Number(value)) : String(value);
}

/** Разница в процентных пунктах словами, со знаком. */
function deltaLabel(delta: number): string {
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta)} п.п.`;
}

/**
 * Тон разницы: тревога у падения, внимание у заметного, обычный у остального.
 *
 * Цветом отмечается ТОЛЬКО разница, и только у долей: она сравнивает сопоставимые величины.
 * Само значение доли тона не получает — «68 % сдали» не хорошо и не плохо без того, с чем
 * сравнивают (FR-29).
 */
function deltaTone(delta: number): "error" | "warning" | "muted" {
  if (delta <= -20) return "error";
  if (delta <= -5) return "warning";
  return "muted";
}

/**
 * Разница между двумя срезами — только у долей и только когда обе доли есть.
 *
 * Разница ОБЪЁМОВ говорит о размере группы, а не о качестве обучения: «в рознице на двоих
 * больше» — не вывод, а состав штата, и ставить это число рядом с разницей долей значит
 * приглашать читателя сложить их в одну мысль.
 */
function difference(a: SliceRow, b: SliceRow, key: keyof SliceRow): number | null {
  if (!a.enoughData || !b.enoughData) return null;
  const first = a[key];
  const second = b[key];
  if (typeof first !== "number" || typeof second !== "number") return null;
  return Math.round(first - second);
}

/**
 * Темы, которые есть хотя бы у одного сравниваемого среза (FR-07).
 *
 * Объединение, а не пересечение: тема, не попавшая в выдачу одной из групп, — это факт о
 * сравнении, и прятать её значило бы молча укоротить разговор. У такого среза в ячейке
 * прочерк, и он честно говорит «этих вопросов здесь не было».
 */
function topicsOfAll(slices: readonly SliceRow[]): Array<{ id: string; name: string }> {
  const names = new Map<string, string>();
  for (const slice of slices) {
    for (const topic of slice.topics ?? []) names.set(topic.topicId, topic.topicName);
  }
  return [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Доля верных ответов среза по одной теме. */
function topicOf(slice: SliceRow, topicId: string): SliceTopic | undefined {
  return (slice.topics ?? []).find(topic => topic.topicId === topicId);
}

/**
 * Шапка столбца: имя среза и условия, по которым он отобран (FR-07f).
 *
 * Условия стоят под именем, потому что имя даёт срезу автор и оно может обещать не то, что
 * срез считает. Видны первые, остальные свёрнуты в «ещё N», а полный перечень — подсказкой:
 * у среза их бывает пять, и пять строк в шапке съели бы таблицу.
 */
function ColumnHead(props: { name: string; conditions: Array<{ id: string; label: string }> }) {
  const visible = props.conditions.slice(0, VISIBLE_CONDITIONS);
  const hidden = props.conditions.slice(VISIBLE_CONDITIONS);
  const summary = visible.map(condition => condition.label).join(" · ");

  return (
    <Stack gap={1}>
      <span>{props.name}</span>
      <Text variant="body-xs" tone="muted" weight="regular">
        {props.conditions.length === 0 ? "без условий — тест целиком" : summary}
        {hidden.length > 0 && (
          <span title={hidden.map(condition => condition.label).join("; ")}>
            {` · ещё ${hidden.length}`}
          </span>
        )}
      </Text>
    </Stack>
  );
}

export function SliceCompare({
  testId, from, to, adhoc, adhocName, slots: outerSlots, onSlotsChange, between,
}: SliceCompareProps) {
  const [available, setAvailable] = useState<SliceRow[]>([]);
  /** Слоты сравнения: по одному на срез, пустой слот — «не выбран» (эскиз, состояние compare). */
  const [ownSlots, setOwnSlots] = useState<Array<string | null>>([null]);
  const slots = outerSlots ?? ownSlots;
  const setSlots = onSlotsChange ?? setOwnSlots;
  const [failed, setFailed] = useState(false);
  /** Счётчик перезагрузок: правка условий меняет числа, и список надо пересчитать. */
  const [reloads, setReloads] = useState(0);
  /** Названия тестов и групп — чтобы условие читалось, а не значилось кодом. */
  const dictionaries = useRegistryDictionaries();

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams({ testId, withWhole: "1" });
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    // Набранный отбор считается сервером тем же кодом, что сохранённый срез: двух расчётов
    // одной величины в продукте быть не должно (FR-25).
    if (adhoc && Object.keys(adhoc).length > 0) {
      query.set("conditions", JSON.stringify(adhoc));
      if (adhocName?.trim()) query.set("conditionsName", adhocName.trim());
    }

    void (async () => {
      try {
        const response = await fetch(`/api/analytics/slices?${query.toString()}`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { slices: SliceRow[] };
        if (alive) setAvailable(data.slices ?? []);
      } catch {
        if (alive) setFailed(true);
      }
    })();

    return () => { alive = false; };
  }, [testId, from, to, adhoc, adhocName, reloads]);

  /**
   * Пришли из реестра с набранным отбором — он и занимает первый слот.
   *
   * Иначе переход «сравнить это» приводил бы на экран с пустым слотом, где отбор надо
   * выбирать заново из списка, в котором его ещё и нет.
   */
  useEffect(() => {
    if (!adhoc) return;
    if (slots.length === 1 && slots[0] === null) setSlots(["adhoc"]);
    // Только при приходе отбора: дальше выбор — дело читателя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adhoc]);

  const selected = useMemo(
    () => slots
      .map(id => (id === null ? undefined : available.find(slice => slice.id === id)))
      .filter((slice): slice is SliceRow => !!slice),
    [slots, available],
  );

  const conditionsOf = useMemo(
    () => new Map(available.map(slice => [
      slice.id,
      // Тест в подписи не называется: он задан страницей, у всех срезов сравнения один.
      describeConditions({ ...conditionsToFilter(slice.conditions), testIds: [] }, dictionaries),
    ])),
    [available, dictionaries],
  );

  if (failed) {
    return <Text tone="error">Не удалось загрузить срезы. Обновите страницу.</Text>;
  }

  const showDifference = selected.length === 2;
  const topicRows = topicsOfAll(selected);

  /** Столбцы таблиц: заголовок «Показатель» плюс по столбцу на срез плюс «Разница». */
  const head = (first: string) => (
    <thead>
      <tr>
        <th><div className="ou-grid__th">{first}</div></th>
        {selected.map(slice => (
          <th key={slice.id}>
            {/* Заголовок числового столбца — по центру, как и его значения (правило 2026-10-03). */}
            <div className="ou-grid__th ou-grid__th--center">
              <ColumnHead name={slice.name} conditions={conditionsOf.get(slice.id) ?? []} />
            </div>
          </th>
        ))}
        {showDifference && <th><div className="ou-grid__th ou-grid__th--center">Разница</div></th>}
      </tr>
    </thead>
  );

  return (
    <Stack gap={4}>
      {/* Слоты сравниваемых срезов: выбор, условия и снятие (FR-07f, FR-07g). */}
      <SliceSlots
        slots={slots}
        onSlotsChange={setSlots}
        available={available}
        conditionsOf={conditionsOf}
        countLabel={slice => `${slice.completed} завершённых`}
        onConditionsSaved={() => setReloads(value => value + 1)}
      />
      {between}

      {selected.length === 0 ? (
        // Срезов может не быть вовсе: тогда сравнивать нечего, и экран обязан сказать, где их
        // берут, — иначе он выглядит сломанным.
        <EmptyState
          layout="inline"
          title={available.length === 0
            ? "Сохранённых срезов пока нет"
            : "Выберите срезы, которые нужно сравнить"}
          description={available.length === 0
            ? "Срез сохраняют из фильтра теста: отберите нужные условия и нажмите «Сохранить как срез»."
            : "Выберите два среза — тогда появится столбец «Разница»."}
        />
      ) : (
        <>
          {/* Подпись и её таблица — родственные элементы: 1x сетки (4 px), а от соседних
              блоков их отделяет 4x родительского стека (решение владельца 2026-09-26). */}
          <Stack gap={1}>
            <Text variant="body-s" weight="medium">Прохождения и результат</Text>
            <div className="ou-grid">
              <div className="ou-grid__scroll">
                <table className="ou-grid__table" role="table">
                  {head("Показатель")}
                  <tbody>
                    {ROWS.map(row => {
                      const delta = showDifference && row.share
                        ? difference(selected[0], selected[1], row.key)
                        : null;
                      return (
                        <tr key={String(row.key)}>
                          <td className="ou-grid__cell-strong">{row.label}</td>
                          {selected.map(slice => (
                            <td key={slice.id} className="is-numeric is-align-center">
                              {cell(slice, row.key, row.share)}
                            </td>
                          ))}
                          {showDifference && (
                            <td className="is-numeric is-align-center">
                              {/* Разница только у долей: вычитать объёмы — значит называть
                                  разницу в составе штата результатом обучения. */}
                              {delta === null
                                ? <Text variant="body-s" tone="muted">—</Text>
                                : <Text variant="body-s" tone={deltaTone(delta)}>{deltaLabel(delta)}</Text>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Stack>

          {/* FR-07: доли верных ПО ТЕМАМ — ради них сравнение и затевают. Отдельной таблицей,
              как в эскизе: единица счёта здесь другая (доля ОТВЕТОВ, а не прохождений), и
              мешать её с объёмами в одном столбце значило бы звать читателя их сложить. */}
          <Stack gap={1}>
            <Text variant="body-s" weight="medium">Доля верных ответов</Text>
            {topicRows.length === 0 ? (
              <Text variant="body-s" tone="muted">
                По темам сравнивать нечего: у выбранных срезов нет оценённых ответов.
              </Text>
            ) : (
              <div className="ou-grid">
                <div className="ou-grid__scroll">
                  <table className="ou-grid__table" role="table">
                    {head("Тема")}
                    <tbody>
                      {topicRows.map(topic => {
                        // Порог наблюдений распространяется и сюда: доля по теме — такой же
                        // процент, как доля сдавших, и у среза из четырёх прохождений шумит
                        // одинаково (FR-06d).
                        const shares = selected.map(slice => (slice.enoughData
                          ? topicOf(slice, topic.id)
                          : undefined));
                        const comparable = showDifference
                          && shares[0] !== undefined && shares[0].correctShare !== null
                          && shares[1] !== undefined && shares[1].correctShare !== null;
                        const delta = comparable
                          ? Math.round((shares[0]!.correctShare as number) - (shares[1]!.correctShare as number))
                          : null;

                        return (
                          <tr key={topic.id}>
                            <td className="ou-grid__cell-strong">{topic.name}</td>
                            {shares.map((share, index) => (
                              <td key={selected[index].id} className="is-numeric is-align-center">
                                {!selected[index].enoughData
                                  ? <Text variant="body-s" tone="muted">мало данных</Text>
                                  : share === undefined || share.correctShare === null
                                    ? "—"
                                    : `${percent(share.correctShare)}`}
                              </td>
                            ))}
                            {showDifference && (
                              <td className="is-numeric is-align-center">
                                {delta === null
                                  ? <Text variant="body-s" tone="muted">—</Text>
                                  : <Text variant="body-s" tone={deltaTone(delta)}>{deltaLabel(delta)}</Text>}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Stack>

          <Stack direction="row" gap={1}>
            <Button variant="ghost" size="s" onClick={() => setSlots([null])}>
              Очистить сравнение
            </Button>
          </Stack>
        </>
      )}
    </Stack>
  );
}
