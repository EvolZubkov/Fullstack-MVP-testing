/**
 * @module features/analytics/slices/slice-slots
 * @description PRD-56 FR-07b, FR-07f, FR-07g: слоты сравниваемых срезов — общий механизм.
 *
 * Один и тот же набор слотов стоит на двух экранах: в сравнении срезов раздела «Аналитика»
 * (PRD-56) и в сравнении психометрики на «Качестве вопросов» (PRD-66 FR-04b требует брать
 * механизм PRD-56 БЕЗ изменений). Поэтому он вынесен сюда целиком: выбор сохранённого среза,
 * свёрнутые «Условия отбора · N», «Изменить условия» той же формой, что в реестре, «Убрать» и
 * пунктирная плитка «+ Добавить срез», которая на четвёртом срезе выключается, а не исчезает.
 * Две копии разошлись бы при первой же правке, и автор учил бы один механизм дважды.
 *
 * Экраны различаются только содержимым таблиц и тем, в чём считается объём среза, — его
 * подпись приходит снаружи (`countLabel`).
 */
import { useRef, useState } from "react";

import {
  Accordion, AccordionItem, Box, Button, Select, Stack, Text,
} from "@skillum/ui-kit";

import { RegistryFilterPanel } from "../registry/filter-panel";
import { conditionsToFilter } from "../registry/filter-state";

/** Срез в слоте: то, что про него знает любой из экранов сравнения. */
export interface SlotSlice {
  id: string;
  name: string;
  conditions: Record<string, unknown>;
}

export interface SliceSlotsProps<T extends SlotSlice> {
  /** Идентификаторы срезов по слотам; `null` — слот «не выбран». */
  slots: Array<string | null>;
  onSlotsChange: (next: Array<string | null>) => void;
  /** Срезы, из которых выбирают. */
  available: readonly T[];
  /** Условия среза словами — по идентификатору среза. */
  conditionsOf: ReadonlyMap<string, Array<{ id: string; label: string }>>;
  /** Объём среза рядом с его номером: «214 прохождений», «18 завершённых». */
  countLabel: (slice: T) => string;
  /** Условия сохранённого среза изменены — числа другие, список надо перечитать. */
  onConditionsSaved: () => void;
  /**
   * Пустой последний слот убирается кнопкой «Убрать» только у выбранного среза. Где слотов по
   * умолчанию больше одного, снятие последнего оставляет пустой слот, а не ноль слотов.
   */
  minSlots?: number;
}

/**
 * Сколько срезов можно сравнивать.
 *
 * Предел содержательный, а не вёрсточный: пятая колонка перестаёт читаться, а «сравнить все
 * группы разом» — это разбиение по оси (список срезов), а не сравнение (FR-07g).
 */
export const MAX_SLICES = 4;

/** Слоты сравниваемых срезов с правкой условий. */
export function SliceSlots<T extends SlotSlice>({
  slots, onSlotsChange, available, conditionsOf, countLabel, onConditionsSaved, minSlots = 1,
}: SliceSlotsProps<T>) {
  /** Срез, у которого открыта правка условий (FR-07b). */
  const [editing, setEditing] = useState<T | null>(null);
  /** Кнопка «Изменить условия» того слота, чьи условия правятся: панель встаёт под ней. */
  const editAnchorRef = useRef<HTMLElement | null>(null);

  return (
    <>
      <Stack direction="row" gap={4} wrap align="start">
        {slots.map((id, index) => {
          const slice = id === null ? undefined : available.find(item => item.id === id);
          const conditions = id === null ? [] : conditionsOf.get(id) ?? [];
          const taken = new Set(slots.filter((value): value is string => value !== null && value !== id));

          return (
            /*
              Модульная сетка 4 px (эскиз prd56-analytics-section, дельта 6.2): слот — рамка с
              полями 6x от краёв; блоки внутри (шапка, выбор, условия, действия) — разные
              элементы, 4x; номер среза и его объём, кнопки одной группы — родственные, 1x.
            */
            <Box key={index} pad={6} border radius="l">
              <Stack gap={4}>
                <Stack direction="row" gap={1} align="center">
                  <Text variant="body-s" weight="medium">{`Срез ${index + 1}`}</Text>
                  {slice && <Text variant="body-xs" tone="muted">{countLabel(slice)}</Text>}
                </Stack>

                <Select
                  size="s"
                  label="Сохранённый срез"
                  value={id ?? ""}
                  onChange={value => onSlotsChange(slots.map((item, at) =>
                    (at === index ? (String(value) === "" ? null : String(value)) : item)))}
                  options={[
                    { value: "", label: "— не выбран —" },
                    ...available
                      .filter(item => !taken.has(item.id))
                      .map(item => ({ value: item.id, label: item.name })),
                  ]}
                />

                {slice && (
                  <Accordion>
                    <AccordionItem
                      value={`conditions-${index}`}
                      title={`Условия отбора · ${conditions.length}`}
                    >
                      <Stack gap={1}>
                        {conditions.length === 0 ? (
                          // Срез без условий — это «тест целиком» (FR-07a), и сказать об этом
                          // надо словом: пустой список читается как незагрузившийся.
                          <Text variant="body-xs" tone="muted">без условий — тест целиком</Text>
                        ) : conditions.map(condition => (
                          <Text key={condition.id} variant="body-xs">{condition.label}</Text>
                        ))}
                      </Stack>
                    </AccordionItem>
                  </Accordion>
                )}

                {slice && (
                  <Stack direction="row" gap={1}>
                    {/* Править можно СОХРАНЁННЫЙ срез: «тест целиком» условий не имеет вовсе, а
                        набранный отбор правится там, где набран, — в фильтре реестра. */}
                    {slice.id !== "whole" && slice.id !== "adhoc" && (
                      <Button
                        variant="secondary"
                        size="s"
                        onClick={event => { editAnchorRef.current = event.currentTarget; setEditing(slice); }}
                      >
                        Изменить условия
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="s"
                      onClick={() => onSlotsChange(slots.length <= minSlots
                        ? slots.map((item, at) => (at === index ? null : item))
                        : slots.filter((_, at) => at !== index))}
                    >
                      Убрать
                    </Button>
                  </Stack>
                )}
              </Stack>
            </Box>
          );
        })}

        {/* FR-07g: на четвёртом срезе плитка ВЫКЛЮЧАЕТСЯ, а не исчезает. Исчезнувшая читается
            как «больше срезов нет», выключенная с подписью объясняет, почему пятого не будет. */}
        <Box pad={6} border="dashed" radius="l">
          <Stack gap={1}>
            <Button
              variant="secondary"
              size="s"
              disabled={slots.length >= MAX_SLICES}
              onClick={() => onSlotsChange([...slots, null])}
            >
              + Добавить срез
            </Button>
            <Text variant="body-xs" tone="muted">
              {slots.length >= MAX_SLICES
                ? "Сравнивают не больше четырёх срезов: пятая колонка перестаёт читаться, а «сравнить все группы разом» — это разбиение по оси, а не сравнение."
                : "до четырёх срезов"}
            </Text>
          </Stack>
        </Box>
      </Stack>

      {/* Правка условий среза — той же формой отбора, что в реестре (FR-07b): двух языков
          условий в продукте нет, и заводить второй ради правки было бы худшим из решений. */}
      <RegistryFilterPanel
        open={editing !== null}
        anchorRef={editAnchorRef}
        filter={conditionsToFilter(editing?.conditions ?? {})}
        hideTest
        onClose={() => setEditing(null)}
        onApply={async next => {
          const target = editing;
          setEditing(null);
          if (!target) return;
          // Тест среза сохраняется как был: окно правит условия ВНУТРИ теста и сам тест не
          // показывает, а срез без теста перестал бы быть выборкой одного теста.
          const testIds = conditionsToFilter(target.conditions).testIds;
          await fetch(`/api/analytics/slices/${target.id}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conditions: {
                ...(testIds.length > 0 ? { testIds } : {}),
                groupIds: next.groupIds,
                sources: next.sources,
                outcomes: next.outcomes,
                formIds: next.formIds,
                snapshotIds: next.snapshotIds,
                organizations: next.organizations,
                units: next.units,
                positions: next.positions,
                ...(next.from ? { from: next.from } : {}),
                ...(next.to ? { to: next.to } : {}),
              },
            }),
          });
          // Срез хранит УСЛОВИЯ и пересчитывается при открытии (FR-07d): после правки числа
          // другие, и список надо перечитать, а не поправить на месте.
          onConditionsSaved();
        }}
      />
    </>
  );
}
