/**
 * @module features/tests/editor/sections/composition-items
 * @description Общий список пунктов «Состава» теста с роутером: темы и пункты-сценарии в одном
 * порядке (согласованный эскиз `docs/wireframes/sim-scenario-test-editor.html`, состояние
 * «роутер: сценарий в составе» — сценарий стоит между темами и нумеруется вместе с ними).
 *
 * Порядок хранится там же, где его читает выдача, — `router.itemOrder` настроек роутера
 * (`shared/test-items`). Пока в тесте нет сценариев, порядок не пишется вовсе: порядок тем —
 * это порядок `sections`, как был, и тест без сценариев не меняется ни на байт.
 *
 * Модуль чистый — перетаскивание мышью в jsdom не воспроизводится, а правило перестановки
 * проверять надо.
 */
import { arrayMove } from "@dnd-kit/sortable";
import { orderTestItems, scenarioItemKey, topicItemKey } from "@shared/test-items";
import { pruneUnlockRules } from "@shared/flow/unlock-rules";
import type { EditorSection, FlowRouterSettings, RouterUnlockRule, ScenarioItemDraft, TestEditorModel } from "../test-editor.types";

/** Пункт состава: тема или пункт-сценарий, с адресом в своём массиве модели. */
export type CompositionEntry =
  | { kind: "topic"; key: string; section: EditorSection; index: number }
  | { kind: "scenario"; key: string; item: ScenarioItemDraft; index: number };

/** Ключ пункта-сценария; у пункта без id (не бывает после добавления, но тип допускает) — по месту. */
export function scenarioEntryKey(item: ScenarioItemDraft, index: number): string {
  return scenarioItemKey(item.id ?? `new-${index}`);
}

/** Пункты-сценарии участвуют в составе только у теста с роутером. */
export function hasRouterItems(model: TestEditorModel): boolean {
  return model.mode === "standard" && model.flowMode === "router_by_topics";
}

/** Темы и (у роутера) пункты-сценарии в порядке автора. */
export function compositionEntries(model: TestEditorModel): CompositionEntry[] {
  const topics: CompositionEntry[] = model.sections.map((section, index) => ({
    kind: "topic",
    key: topicItemKey(section.topicId),
    section,
    index,
  }));
  if (!hasRouterItems(model)) return topics;
  const scenarios: CompositionEntry[] = (model.scenarioItems ?? []).map((item, index) => ({
    kind: "scenario",
    key: scenarioEntryKey(item, index),
    item,
    index,
  }));
  return orderTestItems([...topics, ...scenarios], model.flowSettings.router?.itemOrder);
}

/** Группа пункта; ключ, которого тест не объявлял, — «вне групп» (PRD-50 FR-12). */
export function entryGroup(entry: CompositionEntry, groupKeys: ReadonlySet<string>): string | null {
  const key = entry.kind === "topic" ? entry.section.groupKey : entry.item.groupKey;
  return key && groupKeys.has(key) ? key : null;
}

/** Записать порядок пунктов в настройки роутера (только пока сценарии есть). */
function withItemOrder(model: TestEditorModel, keys: string[]): TestEditorModel {
  const router: FlowRouterSettings = model.flowSettings.router ?? {
    completionPolicy: "all_required_completed",
    sectionUnlockRules: {},
  };
  return { ...model, flowSettings: { ...model.flowSettings, router: { ...router, itemOrder: keys } } };
}

/** Сменить группу пункта по ключу. */
function setEntryGroup(model: TestEditorModel, key: string, groupKey: string | null): TestEditorModel {
  return {
    ...model,
    sections: model.sections.map((s) => (topicItemKey(s.topicId) === key ? { ...s, groupKey } : s)),
    scenarioItems: (model.scenarioItems ?? []).map((item, i) =>
      scenarioEntryKey(item, i) === key ? { ...item, groupKey } : item,
    ),
  };
}

/**
 * Поставить пункт на место другого: он берёт и позицию, и группу цели. Темы в `sections`
 * переставляются в том же относительном порядке — номер и место в выдаче не расходятся ни в
 * одном режиме, а сценариев в составе нет — порядок пунктов не пишется.
 */
export function moveEntryOnto(model: TestEditorModel, fromKey: string, toKey: string): TestEditorModel {
  const entries = compositionEntries(model);
  const i = entries.findIndex((e) => e.key === fromKey);
  const j = entries.findIndex((e) => e.key === toKey);
  if (i < 0 || j < 0 || i === j) return model;
  const groupKeys = new Set((model.sectionGroups ?? []).map((g) => g.key));
  const moved = arrayMove(entries, i, j);
  const rank = new Map(moved.map((e, n) => [e.key, n]));
  const sections = [...model.sections].sort(
    (a, b) => (rank.get(topicItemKey(a.topicId)) ?? 0) - (rank.get(topicItemKey(b.topicId)) ?? 0),
  );
  let next: TestEditorModel = setEntryGroup({ ...model, sections }, fromKey, entryGroup(entries[j], groupKeys));
  if (moved.some((e) => e.kind === "scenario")) next = withItemOrder(next, moved.map((e) => e.key));
  return next;
}

/** Перенести пункт в группу, не трогая его места в списке (бросок на карточку группы). */
export function moveEntryToGroup(model: TestEditorModel, key: string, groupKey: string | null): TestEditorModel {
  return setEntryGroup(model, key, groupKey);
}

/**
 * Порядок пунктов для сохранения: только существующие пункты и только когда в составе есть
 * сценарии. Удалённый пункт не оставляет в порядке висячего ключа.
 */
export function itemOrderForSave(model: TestEditorModel): string[] | undefined {
  if (!hasRouterItems(model) || (model.scenarioItems ?? []).length === 0) return undefined;
  if (!model.flowSettings.router?.itemOrder?.length) return undefined;
  return compositionEntries(model).map((e) => e.key);
}

/**
 * Ключ пункта в правилах открытия и в состоянии хаба: голый `topicId` у темы (так ключуются разделы
 * выдачи), `scenario:<id>` у сценария. Ключ СОСТАВА у темы другой — `topic:<id>`.
 */
export function unlockKeyOf(entry: CompositionEntry): string {
  return entry.kind === "topic" ? entry.section.topicId : entry.key;
}

/** Задать правило открытия пункта; `null` — «Сразу», правило снимается. */
export function withUnlockRule(model: TestEditorModel, key: string, rule: RouterUnlockRule | null): TestEditorModel {
  const router: FlowRouterSettings = model.flowSettings.router ?? {
    completionPolicy: "all_required_completed",
    sectionUnlockRules: {},
  };
  const rules = { ...router.sectionUnlockRules };
  if (rule) rules[key] = rule;
  else delete rules[key];
  return { ...model, flowSettings: { ...model.flowSettings, router: { ...router, sectionUnlockRules: rules } } };
}

/**
 * Пункт убран из состава: его правило открытия и упоминания в чужих правилах уходят вместе с ним.
 * Иначе чужое «после завершения 3» ссылалось бы на пункт, которого нет, и пункт не открылся бы.
 */
export function withoutItemUnlockRules(model: TestEditorModel, key: string): TestEditorModel {
  const router = model.flowSettings.router;
  if (!router) return model;
  return {
    ...model,
    flowSettings: {
      ...model.flowSettings,
      router: { ...router, sectionUnlockRules: pruneUnlockRules(router.sectionUnlockRules, key) },
    },
  };
}
