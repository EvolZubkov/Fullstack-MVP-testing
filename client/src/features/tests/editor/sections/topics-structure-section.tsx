/**
 * @module features/tests/editor/sections/topics-structure-section
 * @description Editor section for the «Состав» tab (PRD-7 wireframe
 * `prd7-editor-drawer.html` state s-default / s-feedback-edit).
 *
 * Renders the list of topics that make up the test as `tb-topic-row`s with:
 *   - header: topic name + «Обязательная» tag + total questions in the topic
 *   - body: draw-count number input (range 1..maxQuestions) and a feedback
 *     preview block; clicking the preview opens FeedbackEditorModal (FR-36/37)
 *   - per-row remove button (small ghost X) that drops the section from the
 *     draft
 *
 * A «+ Добавить тему» button at the bottom opens a topic picker modal listing
 * topics not yet in the test; clicking one appends a new section with a
 * default `drawCount` of `min(maxQuestions, 5)` and `required: false`.
 *
 * The «Обязательная» switch is rendered in the topic-row header (right side,
 * before the remove button). Its previous location — the «Настройки → Правила
 * прохождения» table column — has been retired; this is the single point of
 * control for `sections[].required`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  GripVertical,
  Info,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DrawBlueprint, Folder, FormSet, SectionGroup, Topic } from "@shared/schema";
import { useOptionalAuth } from "@/lib/auth";
import { TopicDrawer, type TopicDrawerTarget } from "@/features/topics/topic-drawer";
import { normalizeTag, tagKey, TAG_MAX_LENGTH } from "@shared/tags";
import { expectedExposure } from "@shared/draw/expected-exposure";
import {
  Banner,
  Button,
  Cluster,
  EmptyState,
  FormSection,
  Grid,
  IconButton,
  Input,
  ModalDialog,
  NumberInput,
  Select,
  SegmentedControl,
  Switch,
  Tag,
  Tooltip,
} from "@skillum/ui-kit";
import { effectiveSectionOrder, type TestQuestionOrder } from "@shared/draw/assemble-delivery";
import { VariantsEditor } from "./variants-editor";
import { ScenarioItemRow, ScenarioPickerModal } from "./router-scenarios-block";
import { ItemUnlockFields, type UnlockItemOption } from "./item-unlock-fields";
import { unlockSummary } from "@shared/flow/unlock-rules";
import {
  packageScenarioWeight,
  packageScenarioWeightText,
  useScenarioBanks,
  type ScenarioBank,
} from "./scenario-bank-fields";
import {
  compositionEntries,
  hasRouterItems,
  unlockKeyOf,
  withUnlockRule,
  withoutItemUnlockRules,
  entryGroup,
  moveEntryOnto,
  moveEntryToGroup,
  scenarioEntryKey,
  type CompositionEntry,
} from "./composition-items";
import { FoldAllButtons, useSectionFold, type SectionFold } from "./section-fold";
import type {
  EditorSection,
  ScenarioItemDraft,
  TestEditorModel,
} from "../test-editor.types";
import { applyFormSetChange } from "../test-editor.mappers";
import { resolveEffectiveScoring } from "@shared/scoring/effective-scoring";
import { EMPTY_FIELD_ERRORS, REVEAL_EVENT, type FieldErrorIndex } from "../field-errors";

// ─── Public API ───────────────────────────────────────────────────────────────

export type CompositionSectionProps = {
  /** Current draft model. */
  model: TestEditorModel;
  /** Editor draft mutator (forwarded from {@link useTestEditor}). */
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
  /** FR-20c: per-field validation errors for inline highlighting. */
  fieldErrors?: FieldErrorIndex;
};

/** Backwards-compatible alias: original skeleton lived under this name. */
export type TopicsStructureSectionProps = CompositionSectionProps;

type TopicWithQuestionCount = Topic & { questionCount: number };

async function fetchTopicsWithCount(): Promise<TopicWithQuestionCount[]> {
  const res = await fetch("/api/topics", { credentials: "include" });
  if (!res.ok) {
    throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  }
  return res.json() as Promise<TopicWithQuestionCount[]>;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * PRD-30 (эскиз approved/prd30-test-level-order.html): подписи значений порядка.
 * Одни и те же во всех режимах прохождения — уточнение «внутри темы» относится к
 * состоянию, а не к значению, поэтому живёт в хвосте строки, а не в списке.
 */
const TEST_ORDER_OPTIONS: { value: TestQuestionOrder; label: string }[] = [
  { value: "fixed", label: "Фиксированный порядок" },
  { value: "random", label: "Перемешивание" },
  { value: "shuffle_all", label: "Полное перемешивание" },
];

/** Хвост строки теста: что именно значение делает в текущем режиме. */
const TEST_ORDER_HINTS: Record<TestQuestionOrder, (flatFlow: boolean) => string> = {
  fixed: () => "темы идут в порядке списка, вопросы — по индексу, заданному в теме",
  random: (flatFlow) =>
    flatFlow
      ? "вопросы перемешиваются внутри темы, темы идут в порядке списка"
      : "вопросы перемешиваются внутри темы",
  shuffle_all: () => "вопросы всех тем идут одним перемешанным потоком",
};

/** Значение «как в тесте» у темы — в модели это `null` (FR-18). */
const INHERIT = "inherit";

/** PRD-50 FR-11/FR-12: значение «Без блока» у раздела — в модели это `null`. */
const NO_GROUP = "none";

/**
 * Адрес зоны «вне групп» для перетаскивания. Не `null` и не пустая строка: идентификатор
 * зоны едет в `@dnd-kit` строкой, и «нет группы» нужно чем-то назвать.
 */
const UNGROUPED = "__ungrouped__";

/**
 * Префиксы адресов перетаскивания: по ним обработчик отличает пункт от группы и от зоны. Адрес
 * темы и пункта-сценария — их ключ пункта (`topic:<id>` / `scenario:<id>`, `shared/test-items`).
 */
const DRAG = { topic: "topic:", scenario: "scenario:", group: "group:", zone: "zone:" } as const;

/** Адрес перетаскивания — пункт состава (тема или сценарий). */
function isEntryDragId(id: string): boolean {
  return id.startsWith(DRAG.topic) || id.startsWith(DRAG.scenario);
}

/** Пункт состава с номером в общем списке. */
type NumberedEntry = CompositionEntry & { number: number };

/**
 * PRD-50 FR-11: the block's `key` is a housekeeping id the author never types —
 * generate it from the ordinal position, skipping any key already in use (an
 * earlier block may have been deleted and its number freed, or the model may
 * already carry a key that collides for some other reason).
 */
function nextGroupKey(existing: SectionGroup[]): string {
  const used = new Set(existing.map((g) => g.key));
  let n = existing.length + 1;
  while (used.has(`group-${n}`)) n += 1;
  return `group-${n}`;
}

/**
 * Ключ группы раздела, очищенный от ссылок на несуществующие группы.
 *
 * PRD-50 FR-12: что значит ключ, которого тест не объявлял, решает ОДНО место — общий
 * построитель итогов читает такой раздел как «вне групп». Редактор обязан показывать то же
 * самое, иначе автор видит тему в группе, а участник — под списком.
 */
function resolvedGroupKey(section: EditorSection, groupKeys: ReadonlySet<string>): string | null {
  return section.groupKey && groupKeys.has(section.groupKey) ? section.groupKey : null;
}

/**
 * Переставить группы местами. `order` переписывается местом в списке: две записи о порядке
 * разошлись бы при первой же правке, а ведущей должна быть одна.
 *
 * @public Экспортируется ради тестов: перетаскивание мышью в jsdom не воспроизводится, а
 * правило перестановки проверять надо.
 */
export function reorderGroups(model: TestEditorModel, fromKey: string, toKey: string): TestEditorModel {
  const list = model.sectionGroups ?? [];
  const i = list.findIndex((g) => g.key === fromKey);
  const j = list.findIndex((g) => g.key === toKey);
  if (i < 0 || j < 0 || i === j) return model;
  return {
    ...model,
    sectionGroups: arrayMove(list, i, j).map((g, index) => ({ ...g, order: index })),
  };
}

/**
 * Перенести тему в группу, не трогая её места в списке.
 *
 * Так работает бросок на ЗОНУ (карточку группы): целиться там не во что — группа может быть
 * пустой, — поэтому меняется только членство. Порядок выдачи при этом сохраняется.
 *
 * @public Экспортируется ради тестов, см. {@link reorderGroups}.
 */
export function moveTopicToGroup(
  model: TestEditorModel,
  topicId: string,
  groupKey: string | null,
): TestEditorModel {
  return {
    ...model,
    sections: model.sections.map((s) => (s.topicId === topicId ? { ...s, groupKey } : s)),
  };
}

/**
 * Поставить тему на место другой темы: она берёт и позицию, и группу цели.
 *
 * Плоский порядок разделов — это порядок ВЫДАЧИ, и бросок на конкретную тему меняет его
 * осознанно: номера тем перенумеровываются на глазах, ничего не происходит молча.
 *
 * @public Экспортируется ради тестов, см. {@link reorderGroups}.
 */
export function moveTopicOnto(
  model: TestEditorModel,
  topicId: string,
  overTopicId: string,
): TestEditorModel {
  const i = model.sections.findIndex((s) => s.topicId === topicId);
  const j = model.sections.findIndex((s) => s.topicId === overTopicId);
  if (i < 0 || j < 0 || i === j) return model;
  const groupKeys = new Set((model.sectionGroups ?? []).map((g) => g.key));
  const nextGroup = resolvedGroupKey(model.sections[j], groupKeys);
  return {
    ...model,
    sections: arrayMove(model.sections, i, j).map((s) =>
      s.topicId === topicId ? { ...s, groupKey: nextGroup } : s,
    ),
  };
}

const TOPIC_ORDER_OPTIONS = [
  { value: INHERIT, label: "Как в тесте" },
  { value: "fixed", label: "Фиксированный порядок" },
  { value: "random", label: "Перемешивание" },
];

/**
 * Хвост строки темы. При наследовании он обязателен: «Как в тесте» само по себе
 * не говорит, ЧТО именно тема унаследовала.
 */
function questionOrderHint(
  effective: "random" | "fixed",
  inherited: boolean,
  variantsOn: boolean,
  testOrder: TestQuestionOrder,
): string {
  if (effective === "fixed") {
    return variantsOn ? "в порядке списка варианта" : "по индексу, заданному в теме";
  }
  // FR-19: в общем потоке вопросы такой темы уходят к остальным поштучно.
  if (inherited && testOrder === "shuffle_all") return "вопросы темы уходят в общий поток";
  return "вопросы темы перемешиваются при каждой попытке";
}

export function CompositionSection({ model, updateModel, fieldErrors = EMPTY_FIELD_ERRORS }: CompositionSectionProps) {
  const { data: allTopics = [], isSuccess: topicsLoaded } = useQuery<TopicWithQuestionCount[]>({
    queryKey: ["/api/topics"],
    queryFn: fetchTopicsWithCount,
  });
  // PRD-11: real sub-topic tags per topic, for the draw-quota Select (FR-07).
  const { data: allQuestions = [] } = useQuery<QuestionTagRow[]>({
    queryKey: ["/api/questions"],
  });
  const tagsByTopic = useMemo(() => buildTagsByTopic(allQuestions), [allQuestions]);
  // PRD-50 FR-42: «сколько вопросов с этим ключом попадает в каждый вариант» считается по
  // составу вариантов, а состав хранится идентификаторами — значит нужна карта id -> теги.
  const tagsByQuestion = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const q of allQuestions) if (q.id) map.set(q.id, Array.isArray(q.tags) ? q.tags : []);
    return map;
  }, [allQuestions]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * Группа, в которую попадёт выбранная в модалке тема. `undefined` = модалку открыли не
   * из карточки, `null` = из карточки «вне групп». Хранится отдельно от `pickerOpen`,
   * потому что кнопок «Добавить тему» теперь несколько, и каждая отвечает за своё место.
   */
  const [pickerGroup, setPickerGroup] = useState<string | null>(null);
  /**
   * «Сценарий в ИС»: окно «Добавить сценарий» — только у теста с роутером. Хранит группу, в
   * которую встанет пункт (`undefined` — окно закрыто), как выбор темы.
   */
  const [scenarioPickerGroup, setScenarioPickerGroup] = useState<string | null | undefined>(undefined);
  const routerScenarios = model.mode === "standard" && model.flowMode === "router_by_topics";
  const { banks: scenarioBanks, isLoading: banksLoading } = useScenarioBanks();
  const [search, setSearch] = useState("");
  /**
   * Решение владельца 2026-10-01: недостающую тему создают из ящика теста. Это тот же
   * ящик темы, что в «Темах и вопросах»; сохранённая тема сразу встаёт в тест — в ту
   * группу, из которой открывали выбор темы.
   */
  const auth = useOptionalAuth();
  const canCreateTopic = auth?.can("topics.manage") ?? false;
  const [topicCreate, setTopicCreate] = useState<TopicDrawerTarget | null>(null);
  const { data: folders = [] } = useQuery<Folder[]>({
    queryKey: ["/api/folders"],
    enabled: topicCreate !== null,
  });

  const overrideByQuestion = useMemo(
    () => new Map(model.scoring.questionOverrides.map((o) => [o.questionId, o])),
    [model.scoring.questionOverrides],
  );
  /** Цена ответа в ЭТОМ тесте: переопределение вопроса → умолчание раздела → теста. */
  const pointsOf = useCallback(
    (questionId: string, sectionDefaultPoints: number | null) => {
      const override = overrideByQuestion.get(questionId);
      return resolveEffectiveScoring({
        override: override
          ? {
              points: override.points,
              scoring: override.scoringJson,
              difficulty: override.difficulty,
              pinnedContentHash: override.pinnedContentHash,
            }
          : null,
        defaults: {
          sectionDefaultPoints,
          testDefaultPoints: model.scoring.defaultQuestionPoints,
        },
      }).points;
    },
    [overrideByQuestion, model.scoring.defaultQuestionPoints],
  );

  // Техдолг №6: вес сценариев в пакете — только у роутера с пунктами-сценариями (в тесте «Сценарий»
  // итог — тег его единственного пункта).
  const packageWeight = useMemo(() => {
    if (!hasRouterItems(model)) return null;
    const weight = packageScenarioWeight(model.scenarioItems ?? [], scenarioBanks);
    return weight && weight.scenarios > 0 ? weight : null;
  }, [model, scenarioBanks]);

  // Темы открываются СВЁРНУТЫМИ (комментарий эскиза): в списке на два десятка тем
  // раскрытые тела превращают экран в простыню.
  // «Сценарий в ИС»: пункты-сценарии роутера стоят в ОДНОМ списке с темами и нумеруются
  // вместе с ними (эскиз, «роутер: сценарий в составе»). Адрес свёртки сценария — его ключ.
  const entries = useMemo(() => compositionEntries(model), [model]);
  const fold = useSectionFold(
    entries.map((e) => (e.kind === "topic" ? e.section.topicId : e.key)),
    true,
  );

  // Поиск сужает СПИСОК, а не модель: индекс темы остаётся прежним, иначе адреса
  // ошибок `sections[i]` начали бы указывать не на ту тему. Номер — место в общем списке.
  const visibleEntries = useMemo<NumberedEntry[]>(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .map((entry, n) => ({ ...entry, number: n + 1 }))
      .filter((entry) => {
        if (!needle) return true;
        const name = entry.kind === "topic" ? entry.section.topicName : entry.item.title?.trim() || entry.item.topicName;
        return name.toLowerCase().includes(needle);
      });
  }, [entries, search]);

  // Техдолг №8: «Открывается» — только у теста с роутером: в линейных потоках пункты идут по
  // порядку. Список «Каких пунктов» и номера в хвосте подзаголовка — по ВСЕМУ составу, а не по
  // отфильтрованному поиском.
  const routerFlow = model.mode !== "scenario" && model.flowMode === "router_by_topics";
  const unlockRules = model.flowSettings.router?.sectionUnlockRules ?? {};
  const unlockItems = useMemo<UnlockItemOption[]>(
    () =>
      entries.map((entry, n) => ({
        key: unlockKeyOf(entry),
        number: n + 1,
        name: entry.kind === "topic" ? entry.section.topicName : entry.item.title?.trim() || entry.item.topicName,
      })),
    [entries],
  );
  const numberOf = useMemo(() => {
    const map = new Map(unlockItems.map((item) => [item.key, item.number]));
    return (key: string) => map.get(key);
  }, [unlockItems]);
  /** Поля и хвост подзаголовка правила открытия пункта; вне роутера — ничего. */
  const unlockFor = (entry: CompositionEntry, field: string) => {
    if (!routerFlow) return { fields: undefined, tail: null };
    const key = unlockKeyOf(entry);
    return {
      fields: (
        <ItemUnlockFields
          itemKey={key}
          kind={entry.kind}
          items={unlockItems}
          rules={unlockRules}
          onChange={(rule) => updateModel((m) => withUnlockRule(m, key, rule))}
          field={field}
          error={fieldErrors.get(field)}
        />
      ),
      tail: unlockSummary(unlockRules[key], numberOf),
    };
  };

  const usedTopicIds = useMemo(
    () => new Set(model.sections.map((s) => s.topicId)),
    [model.sections],
  );
  const availableTopics = useMemo(
    () => allTopics.filter((t) => !usedTopicIds.has(t.id)),
    [allTopics, usedTopicIds],
  );
  // PRD-15 E-11: /api/topics is visibility-scoped, so a section whose topicId is
  // absent here references a topic the author can no longer see.
  const visibleTopicIds = useMemo(() => new Set(allTopics.map((t) => t.id)), [allTopics]);

  const updateSection = (topicId: string, patch: Partial<EditorSection>) => {
    updateModel((m) => ({
      ...m,
      sections: m.sections.map((s) =>
        s.topicId === topicId ? { ...s, ...patch } : s,
      ),
    }));
  };

  const removeSection = (topicId: string) => {
    updateModel((m) => ({
      ...withoutItemUnlockRules(m, topicId),
      sections: m.sections.filter((s) => s.topicId !== topicId),
      passRules: {
        ...m.passRules,
        byTopic: Object.fromEntries(
          Object.entries(m.passRules.byTopic).filter(([id]) => id !== topicId),
        ),
      },
    }));
  };

  const addTopic = (topic: TopicWithQuestionCount) => {
    const drawCount = Math.min(topic.questionCount, 5) || 1;
    updateModel((m) => ({
      ...m,
      sections: [
        ...m.sections,
        {
          topicId: topic.id,
          topicName: topic.name,
          maxQuestions: topic.questionCount,
          drawCount,
          drawAll: false,
          required: false,
          timeLimit: { source: "inherit_test" },
          feedback: { format: "plain", text: "" },
          feedbackLinks: [],
          feedbackAssets: [],
          feedbackEvents: [],
          drawBlueprint: null,
          defaultPoints: null,
          // Тема заводится в ту группу, из карточки которой её позвали: кнопка «Добавить
          // тему» стоит ВНУТРИ группы именно затем, чтобы не спрашивать об этом отдельно.
          groupKey: pickerGroup,
        },
      ],
    }));
    setPickerOpen(false);
  };

  /** Открыть выбор темы, запомнив, куда её положить. */
  const openPickerFor = (groupKey: string | null) => {
    setPickerGroup(groupKey);
    setPickerOpen(true);
  };

  /*
   * ГРУППЫ ТЕМ (`tests.section_groups_json` + `test_sections.group_key`).
   *
   * Управление ими вернулось в интерфейс (решение владельца 2026-09-21, отменяющее решение
   * 2026-09-02 о снятии): настройка, которую можно задать только книгой Excel, — дефект.
   *
   * Группа — сворачиваемая карточка со своим именем и счётчиком тем, как карточка темы.
   * Членство задаётся ПЕРЕТАСКИВАНИЕМ, а не выбором из списка: список не показывает, где
   * тема стоит сейчас и что рядом. Тема вне групп законна (PRD-50 FR-25) и живёт в своей
   * карточке под группами.
   */
  const groups = model.sectionGroups ?? [];
  const groupFold = useSectionFold(groups.map((g) => g.key));
  /** Ключи существующих групп — по ним раздел с чужим ключом считается «вне групп» (FR-12). */
  const groupKeys = useMemo(() => new Set(groups.map((g) => g.key)), [groups]);
  /** Пункты по группам, в общем порядке: номер пункта остаётся его местом в выдаче. */
  const inGroup = useCallback(
    (key: string | null) => visibleEntries.filter((entry) => entryGroup(entry, groupKeys) === key),
    [visibleEntries, groupKeys],
  );

  const addGroup = () =>
    updateModel((m) => {
      const existing = m.sectionGroups ?? [];
      return {
        ...m,
        sectionGroups: [...existing, { key: nextGroupKey(existing), label: "Новая группа" }],
      };
    });

  const renameGroup = (key: string, label: string) =>
    updateModel((m) => ({
      ...m,
      sectionGroups: (m.sectionGroups ?? []).map((g) => (g.key === key ? { ...g, label } : g)),
    }));

  /**
   * Удаление группы. Темы НЕ удаляются — они уезжают «вне групп» (решение владельца
   * 2026-09-21): группа описывает подачу итога, а не состав теста, и снимать вместе с ней
   * четыре темы значило бы стереть работу, о которой автор не просил.
   */
  const removeGroup = (key: string) =>
    updateModel((m) => ({
      ...m,
      sectionGroups: (m.sectionGroups ?? []).filter((g) => g.key !== key),
      sections: m.sections.map((s) => (s.groupKey === key ? { ...s, groupKey: null } : s)),
      scenarioItems: (m.scenarioItems ?? []).map((item) => (item.groupKey === key ? { ...item, groupKey: null } : item)),
    }));

  /** Пункт-сценарий: строка встаёт в конец списка, в группу, из которой его позвали. */
  const addScenario = (bank: ScenarioBank) => {
    const id = crypto.randomUUID();
    const groupKey = scenarioPickerGroup ?? null;
    updateModel((m) => ({
      ...m,
      scenarioItems: [
        ...(m.scenarioItems ?? []),
        // Название в меню обязательно; по умолчанию — название темы (эскиз).
        { id, topicId: bank.topicId, topicName: bank.topicName, questionId: null, title: bank.topicName, required: true, groupKey },
      ],
    }));
    // Свёрнуты только пункты, бывшие при открытии: новый стоит раскрытым — его сейчас настроят.
    setScenarioPickerGroup(undefined);
  };

  const updateScenario = (index: number, next: ScenarioItemDraft | null) =>
    updateModel((m) => {
      const list = [...(m.scenarioItems ?? [])];
      if (next) {
        list[index] = { ...list[index], ...next };
        return { ...m, scenarioItems: list };
      }
      // Убранный пункт уносит своё правило открытия, упоминания в чужих и свой порог.
      const key = scenarioEntryKey(list[index], index);
      list.splice(index, 1);
      const pruned = withoutItemUnlockRules(m, key);
      const { [key]: _dropped, ...byTopic } = pruned.passRules.byTopic;
      return { ...pruned, scenarioItems: list, passRules: { ...pruned.passRules, byTopic } };
    });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * Перетаскивание: тема между группами и внутри списка, группа — между группами.
   *
   * Тема, брошенная НА ТЕМУ, встаёт на её место в плоском списке и берёт её группу; тема,
   * брошенная на пустую зону, только меняет группу. Плоский порядок — это порядок выдачи, и
   * он остаётся виден номерами: ничего не меняется молча.
   */
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = String(active.id);
    const to = String(over.id);

    if (from.startsWith(DRAG.group) && to.startsWith(DRAG.group)) {
      const fromKey = from.slice(DRAG.group.length);
      const toKey = to.slice(DRAG.group.length);
      updateModel((m) => reorderGroups(m, fromKey, toKey));
      return;
    }

    if (!isEntryDragId(from)) return;

    // Пункт, брошенный на КАРТОЧКУ: у настоящей группы приёмник назван `group:<ключ>` (это
    // её сортируемый узел), у карточки «вне групп» — `zone:__ungrouped__`.
    if (to.startsWith(DRAG.zone) || to.startsWith(DRAG.group)) {
      const raw = to.startsWith(DRAG.zone)
        ? to.slice(DRAG.zone.length)
        : to.slice(DRAG.group.length);
      updateModel((m) => moveEntryToGroup(m, from, raw === UNGROUPED ? null : raw));
      return;
    }

    if (!isEntryDragId(to)) return;
    updateModel((m) => moveEntryOnto(m, from, to));
  };

  // PRD-30 FR-16: absent = «перемешивание», today's behaviour of every test.
  const testOrder: TestQuestionOrder = model.questionOrder ?? "random";
  const flatFlow = model.flowMode === "linear_flat";

  /** Одна строка пункта — и в плоском списке, и внутри карточки группы. */
  const renderEntry = (entry: NumberedEntry) => {
    if (entry.kind === "scenario") {
      const unlock = unlockFor(entry, `scenarioItems[${entry.index}].unlock`);
      return (
        <ScenarioItemRow
          key={entry.key}
          itemKey={entry.key}
          index={entry.index}
          number={entry.number}
          item={entry.item}
          banks={scenarioBanks}
          isLoading={banksLoading}
          open={fold.isOpen(entry.key)}
          onToggleOpen={() => fold.toggle(entry.key)}
          onChange={(next) => updateScenario(entry.index, next)}
          titleError={fieldErrors.get(`scenarioItems[${entry.index}].title`)}
          hasIssue={fieldErrors.has(`scenarioItems[${entry.index}]`)}
          unlockFields={unlock.fields}
          unlockTail={unlock.tail}
        />
      );
    }
    const unlock = unlockFor(entry, `sections[${entry.index}].unlock`);
    return renderTopic({ section: entry.section, index: entry.index, number: entry.number, unlock });
  };

  /** Строка темы. */
  const renderTopic = ({
    section,
    index,
    number,
    unlock,
  }: {
    section: EditorSection;
    index: number;
    number: number;
    unlock: { fields: React.ReactNode; tail: string | null };
  }) => (
    <TopicRow
      key={section.topicId}
      index={index}
      number={number}
      section={section}
      open={fold.isOpen(section.topicId)}
      onToggleOpen={() => fold.toggle(section.topicId)}
      unavailable={topicsLoaded && !visibleTopicIds.has(section.topicId)}
      adaptive={model.mode === "adaptive"}
      drawCountError={fieldErrors.get(`sections[${index}].drawCount`)}
      blueprintError={fieldErrors.get(`sections[${index}].drawBlueprintJson`)}
      variantsError={fieldErrors.get(`sections[${index}].formSetJson`)}
      // `has` матчит и потомков: точка загорается от ЛЮБОЙ ошибки внутри темы,
      // а не только от трёх, у которых есть своё сообщение в карточке.
      hasIssue={fieldErrors.has(`sections[${index}]`)}
      topicTags={tagsByTopic.get(section.topicId)?.tags ?? []}
      availByKey={tagsByTopic.get(section.topicId)?.availByKey ?? {}}
      tagsByQuestion={tagsByQuestion}
      onChangeDrawCount={(n) => updateSection(section.topicId, { drawCount: n })}
      onToggleDrawAll={(drawAll) =>
        updateSection(section.topicId, {
          drawAll,
          // Turning "all" on snapshots the current max into drawCount so the
          // (disabled) number field reads sensibly and the persisted value is
          // valid; the real "all" is resolved dynamically at export time.
          ...(drawAll ? { drawCount: Math.max(section.maxQuestions, 1) } : {}),
        })
      }
      onChangeQuestionOrder={(order) => updateSection(section.topicId, { questionOrder: order })}
      testOrder={testOrder}
      onToggleRequired={(required) => updateSection(section.topicId, { required })}
      onChangeBlueprint={(bp) => updateSection(section.topicId, { drawBlueprint: bp })}
      // PRD-24: changing the variant set also re-syncs the topic's per-variant
      // pass rule (seed added / drop removed / normalise when mode goes off).
      onChangeFormSet={(formSet) =>
        updateModel((m) => applyFormSetChange(m, section.topicId, formSet))
      }
      pointsOf={(questionId) => pointsOf(questionId, section.defaultPoints)}
      onRemove={() => removeSection(section.topicId)}
      unlockFields={unlock.fields}
      unlockTail={unlock.tail}
    />
  );

  return (
    <>
      {model.mode === "adaptive" && (
        <Banner
          tone="info"
          title="Тест в адаптивном режиме"
          description="Настройки уровней сложности и связки тем — в подразделе «Адаптивные уровни»."
          data-testid="composition-adaptive-banner"
        />
      )}
      {/* PRD-30 FR-16/FR-17 (эскиз approved/prd30-test-level-order.html): the
          test-wide rule stands ABOVE the topic list — first the common rule,
          then the topics that inherit it. «Полное перемешивание» is offered only
          in the flat flow: the sectional flows carry the section screens on the
          topic boundary, so there is nothing to mix across. */}
      <FormSection
        stacked
        title="Темы теста"
        // Техдолг №6: что пункты-сценарии добавят в пакет — видно, не разворачивая ни одного.
        subtitle={packageWeight ? <span data-testid="composition-package-weight">{packageScenarioWeightText(packageWeight)}</span> : undefined}
      >
        {/* Поиск по уже добавленным темам: у теста их бывает под два десятка, и найти
            нужную прокруткой — это и есть та работа, ради которой поле стоит здесь. */}
        <div className="ou-formfield">
          <Input
            id="composition-search"
            size="m"
            fullWidth
            label="Поиск темы"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            iconRight={<Search size={16} aria-hidden="true" />}
            data-testid="composition-search"
          />
        </div>
        {/* B-4: правило уровня теста — обычное поле формы с подписью НАД ним, как
            соседние. Строкой «подпись слева · поле · хвост» оно выглядело сноской,
            хотя управляет выдачей всего теста. */}
        <div className="ou-formfield">
          <Select
            id="test-question-order"
            size="m"
            fullWidth
            label="Порядок выдачи вопросов в тесте"
            hint={TEST_ORDER_HINTS[testOrder](flatFlow)}
            value={testOrder}
            onChange={(value) => updateModel((m) => ({ ...m, questionOrder: value }))}
            options={flatFlow ? TEST_ORDER_OPTIONS : TEST_ORDER_OPTIONS.slice(0, 2)}
            data-testid="test-question-order"
          />
        </div>
        {/* Кнопки добавления стоят РЯДОМ, но стилями различаются: они заводят разные
            сущности, и одинаковые кнопки в ряд читались бы как одно действие с выбором.
            Когда группы есть, «Добавить тему» уходит внутрь карточек — там видно, КУДА
            тема попадёт, а здесь было бы не видно. */}
        <div className="tb-fold-toolbar">
          <Cluster gap={3} align="center" className="tb-fold-toolbar__lead">
            {groups.length === 0 && (
              <Button
                variant="secondary"
                size="s"
                leadingIcon={<Plus size={16} aria-hidden="true" />}
                onClick={() => setPickerOpen(true)}
                data-testid="composition-add-topic"
                data-field="sections"
              >
                Добавить тему
              </Button>
            )}
            {/* «Сценарий в ИС»: пункт-сценарий живёт рядом с темами только в тесте с роутером —
                в линейном потоке его некуда поставить (согласованный эскиз, «роутер: сценарий в составе»). */}
            {routerScenarios && groups.length === 0 && (
              <Button
                variant="ghost"
                size="s"
                leadingIcon={<Plus size={16} aria-hidden="true" />}
                onClick={() => setScenarioPickerGroup(null)}
                data-testid="composition-add-scenario"
              >
                Добавить сценарий
              </Button>
            )}
            <Button
              variant={groups.length === 0 ? "ghost" : "secondary"}
              size="s"
              leadingIcon={<Plus size={16} aria-hidden="true" />}
              onClick={addGroup}
              data-testid="composition-add-group"
            >
              Добавить группу
            </Button>
          </Cluster>
          <FoldAllButtons fold={fold} testIdPrefix="composition-topics" />
        </div>
        {/* Контракт «Индикация проблем»: ошибка обязана быть видна НА МЕСТЕ, а не
            только числом в сводном баннере. У «нет тем» нет своего поля, которое можно
            пометить невалидным, — текст стоит сразу под кнопкой, которой её чинят.
            Внутри карточки, а не рядом с пустым состоянием: прямой ребёнок
            `.tb-settings-content` становится ЛИПКИМ баннером шапки панели (с
            отрицательной верхней отбивкой) и наезжает на эти же кнопки.
            Якорь `data-field="sections"` остаётся на кнопке: переход ведёт к
            ДЕЙСТВИЮ, а не к сообщению о нём. */}
        {fieldErrors.get("sections") && (
          <Banner
            tone="error"
            description={fieldErrors.get("sections")}
            data-testid="composition-empty-error"
          />
        )}
      </FormSection>

      {model.sections.length === 0 && (
        <>
          <EmptyState
            layout="page"
            well
            art={<Info size={24} aria-hidden="true" />}
            title="В тесте нет тем"
            description="Тема даёт тесту вопросы: из неё идёт выборка, по ней считается вердикт и печатается разбор. Добавьте первую тему."
            data-testid="composition-empty"
          />
          {/* Что именно недоступно, пока тем нет: иначе автор ищет пропавшие настройки
              по другим вкладкам, а их там нет и быть не может. */}
          <Banner
            tone="info"
            description="Пока тем нет, правила оценки тем, квоты по подтемам и адаптивная лестница недоступны."
            data-testid="composition-empty-consequences"
          />
        </>
      )}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {groups.length === 0 ? (
          <TopicList testId="composition-topics" entries={visibleEntries} renderEntry={renderEntry} />
        ) : (
          <SortableContext
            items={groups.map((g) => DRAG.group + g.key)}
            strategy={verticalListSortingStrategy}
          >
            {groups.map((group) => (
              <GroupCard
                key={group.key}
                group={group}
                entries={inGroup(group.key)}
                open={groupFold.isOpen(group.key)}
                onToggleOpen={() => groupFold.toggle(group.key)}
                onRename={(label) => renameGroup(group.key, label)}
                onRemove={() => removeGroup(group.key)}
                onAddTopic={() => openPickerFor(group.key)}
                onAddScenario={routerScenarios ? () => setScenarioPickerGroup(group.key) : undefined}
                renderEntry={renderEntry}
              />
            ))}
            {/* Карточка «вне групп» стоит ВСЕГДА, пока есть хоть одна группа: это
                единственное место, куда можно завести тему без группы, и единственная
                мишень, чтобы вытащить тему из группы перетаскиванием. */}
            <GroupCard
              group={null}
              entries={inGroup(null)}
              open={groupFold.isOpen(UNGROUPED)}
              onToggleOpen={() => groupFold.toggle(UNGROUPED)}
              onAddTopic={() => openPickerFor(null)}
              renderEntry={renderEntry}
            />
          </SortableContext>
        )}
      </DndContext>

      {routerScenarios && (
        <ScenarioPickerModal
          open={scenarioPickerGroup !== undefined}
          banks={scenarioBanks}
          isLoading={banksLoading}
          onPick={addScenario}
          onCancel={() => setScenarioPickerGroup(undefined)}
        />
      )}

      <TopicPickerModal
        open={pickerOpen}
        topics={availableTopics}
        onPick={addTopic}
        onCancel={() => setPickerOpen(false)}
        onCreate={
          canCreateTopic
            ? (name) => {
                setPickerOpen(false);
                setTopicCreate({ mode: "create", name });
              }
            : undefined
        }
      />
      {/* Монтируется только открытым: ящик темы тянет свои запросы и уведомления, и
          держать его в ящике теста всё время — плата за редкий случай. */}
      {topicCreate && (
        <TopicDrawer
          target={topicCreate}
          folders={folders}
          isAdmin={auth?.can("topics.owner.change") ?? false}
          onClose={() => setTopicCreate(null)}
          // Новая тема пуста: вопросы автор добавит в «Вопросах теста».
          onCreated={(topic) => addTopic({ ...topic, questionCount: 0 })}
        />
      )}
    </>
  );
}

/** Backwards-compatible re-export under the old skeleton name. */
export const TopicsStructureSection = CompositionSection;

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Карточка группы тем — и настоящей, и служебной «Темы вне групп» (`group === null`).
 *
 * Собрана как карточка ТЕМЫ (`tb-level-card` + аккордеон внутри): группа и тема — вещи
 * одного порядка в этом списке, и разная механика свёртки у них читалась бы как разное
 * назначение.
 *
 * У служебной карточки нет ни имени под правку, ни ручки, ни удаления: «вне групп» — это
 * не группа, а остаток, его нельзя переименовать, переставить или убрать.
 */
function GroupCard(props: {
  group: SectionGroup | null;
  entries: NumberedEntry[];
  open: boolean;
  onToggleOpen: () => void;
  onRename?: (label: string) => void;
  onRemove?: () => void;
  onAddTopic: () => void;
  /** «Добавить сценарий» в подвале группы — только у теста с роутером и у настоящей группы. */
  onAddScenario?: () => void;
  renderEntry: (entry: NumberedEntry) => React.ReactNode;
}) {
  const key = props.group?.key ?? UNGROUPED;
  /**
   * Зона приёма у настоящей группы — её же сортируемый узел (`group:<ключ>`), а НЕ второй
   * `useDroppable` на том же элементе: два приёмника на одном узле дают одинаковый
   * прямоугольник, столкновение выбирает из них произвольный, и половина бросков уходила в
   * адрес, которого обработчик не ждёт. У карточки «вне групп» сортировки нет — там
   * приёмник свой.
   */
  const sortable = useSortable({ id: DRAG.group + key, disabled: !props.group });
  const droppable = useDroppable({ id: DRAG.zone + key, disabled: !!props.group });
  const isOver = props.group ? sortable.isOver : droppable.isOver;
  const count = props.entries.length;
  const topicCount = props.entries.filter((e) => e.kind === "topic").length;
  const scenarioCount = count - topicCount;
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : undefined,
  };
  return (
    <section
      ref={(node) => {
        sortable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      style={dragStyle}
      className={`ou-card ou-card--outlined ou-card--sm tb-level-card tb-group-card${
        props.open ? "" : " is-collapsed"
      }${isOver ? " is-drop-target" : ""}`}
      data-testid={`composition-group-${key}`}
    >
      <header className="ou-card__header tb-level-card__head">
        {props.group && (
          <span
            className="drag-handle"
            aria-label={`Переместить группу «${props.group.label}»`}
            data-testid={`composition-group-grip-${key}`}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical size={14} aria-hidden="true" />
          </span>
        )}
        <div className="ou-card__heading tb-level-card__heading">
          {props.group ? (
            <Input
              size="s"
              fullWidth
              aria-label="Название группы"
              value={props.group.label}
              onChange={(e) => props.onRename?.(e.target.value)}
              data-testid={`composition-group-name-${key}`}
            />
          ) : (
            <h5 className="ou-card__title tb-level-card__title">Темы вне групп</h5>
          )}
        </div>
        <div className="ou-card__trail tb-level-card__trail">
          <Tag tone="neutral" size="s" data-testid={`composition-group-count-${key}`}>
            {/* «2 темы · 1 сценарий» (эскиз); без сценариев — прежнее «N тем», без тем — только
                сценарии: «0 тем · 1 сценарий» читалось бы как ошибка. */}
            {scenarioCount === 0
              ? `${count} ${topicWord(count)}`
              : [
                  topicCount > 0 ? `${topicCount} ${topicWord(topicCount)}` : null,
                  `${scenarioCount} ${scenarioWord(scenarioCount)}`,
                ].filter(Boolean).join(" · ")}
          </Tag>
          {props.group && (
            <IconButton
              icon={<Trash2 size={14} aria-hidden="true" />}
              aria-label={`Удалить группу «${props.group.label}»`}
              variant="ghost"
              size="s"
              onClick={props.onRemove}
              data-testid={`composition-group-remove-${key}`}
            />
          )}
          <button
            type="button"
            className="tb-level-card__chev"
            aria-label={props.open ? "Свернуть группу" : "Развернуть группу"}
            aria-expanded={props.open}
            onClick={props.onToggleOpen}
            data-testid={`composition-group-toggle-${key}`}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      {props.open && (
        <div className="ou-card__body">
          {count === 0 ? (
            // Не `EmptyState`: у пустой группы нет ошибки и нет действия, кроме кнопки
            // ниже, — есть только объяснение, что с ней делать.
            <p className="tb-card-desc" data-testid={`composition-group-empty-${key}`}>
              {props.group
                ? "Перетащите сюда тему или добавьте новую."
                : "Все темы разложены по группам."}
            </p>
          ) : (
            <TopicList
              testId={`composition-group-topics-${key}`}
              entries={props.entries}
              renderEntry={props.renderEntry}
            />
          )}
          <div className="tb-fold-toolbar tb-group-card__foot">
            <Button
              variant="ghost"
              size="s"
              leadingIcon={<Plus size={14} aria-hidden="true" />}
              onClick={props.onAddTopic}
              data-testid={`composition-group-add-topic-${key}`}
            >
              {props.group ? "Добавить тему в группу" : "Добавить тему"}
            </Button>
            {props.group && props.onAddScenario && (
              <Button
                variant="ghost"
                size="s"
                leadingIcon={<Plus size={14} aria-hidden="true" />}
                onClick={props.onAddScenario}
                data-testid={`composition-group-add-scenario-${key}`}
              >
                Добавить сценарий
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** «1 тема» / «3 темы» / «5 тем» — счётчик в теге группы. */
function topicWord(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  if (tail >= 11 && tail <= 14) return "тем";
  if (last === 1) return "тема";
  if (last >= 2 && last <= 4) return "темы";
  return "тем";
}

/** «1 сценарий» / «2 сценария» / «5 сценариев». */
function scenarioWord(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  if (tail >= 11 && tail <= 14) return "сценариев";
  if (last === 1) return "сценарий";
  if (last >= 2 && last <= 4) return "сценария";
  return "сценариев";
}

/** Список пунктов одной области — плоский список теста либо содержимое группы. */
function TopicList(props: {
  testId: string;
  entries: NumberedEntry[];
  renderEntry: (entry: NumberedEntry) => React.ReactNode;
}) {
  return (
    <SortableContext items={props.entries.map((entry) => entry.key)} strategy={verticalListSortingStrategy}>
      <div className="ou-acc ou-acc--separated" data-testid={props.testId}>
        {props.entries.map(props.renderEntry)}
      </div>
    </SortableContext>
  );
}

function TopicRow(props: {
  /** Position in `model.sections`; feeds the `sections[i]` FR-20c anchor. */
  index: number;
  /** Номер в общем списке пунктов (у роутера со сценариями отличается от `index + 1`). */
  number?: number;
  section: EditorSection;
  /** Test runs in adaptive mode — forces "draw all" on + locks the controls. */
  adaptive: boolean;
  /** FR-20c: validation message for this section's draw count (red state). */
  drawCountError?: string;
  /** FR-20c: validation message for this section's draw blueprint quotas. */
  blueprintError?: string;
  /** Distinct sub-topic tags of this topic's questions (PRD-11 quota Select). */
  topicTags: string[];
  /** How many questions carry each tag key (shortfall indicator). */
  availByKey: Record<string, number>;
  /** PRD-50 FR-42: question id -> its tags, to count key hits per variant. */
  tagsByQuestion: Map<string, string[]>;
  onChangeDrawCount: (n: number) => void;
  /** Toggle the manual "draw the whole topic" flag. */
  onToggleDrawAll: (drawAll: boolean) => void;
  /** PRD-30 FR-18: set the topic's override (`null` = «как в тесте»). */
  onChangeQuestionOrder: (order: "random" | "fixed" | null) => void;
  /** PRD-30 FR-16: the test-wide order this topic inherits when it has none. */
  testOrder: TestQuestionOrder;
  onToggleRequired: (required: boolean) => void;
  /** Replace this section's draw blueprint (`null` = uniform draw). */
  onChangeBlueprint: (bp: DrawBlueprint | null) => void;
  /** PRD-17 (BR-12): replace this section's variant set (`null` = variants off). */
  onChangeFormSet: (formSet: FormSet | null) => void;
  /** FR-20c: validation message for this section's variants. */
  variantsError?: string;
  /**
   * Контракт «Индикация проблем»: в теме есть блокирующая ошибка — по ЛЮБОМУ её
   * адресу, включая те, у которых нет своего сообщения в карточке. Тело карточки
   * живёт только в развёрнутом виде, поэтому свёрнутая обязана сказать о проблеме
   * сама — иначе баннер насчитал ошибку, а показать её негде.
   */
  hasIssue?: boolean;
  /** Цена ответа в этом тесте — для меты строк в наборе вариантов. */
  pointsOf: (questionId: string) => number;
  onRemove: () => void;
  /** Раскрыта ли тема (свёртками управляет список, чтобы работали «развернуть все»). */
  open: boolean;
  onToggleOpen: () => void;
  /** Called with a partial EditorSection patch when feedback is saved. */
  /** PRD-15 E-11: the author can no longer see this section's topic (grant
   * revoked / made private). The test still works and saves; only new draws
   * from this topic are blocked. */
  unavailable?: boolean;
  /** Техдолг №8: поля «Открывается» / «Каких пунктов» (только у роутера). */
  unlockFields?: React.ReactNode;
  /** Хвост подзаголовка — «откроется после …»; нет правила — `null`. */
  unlockTail?: string | null;
}) {
  const { section } = props;
  const maxQ = Math.max(section.maxQuestions, 1);

  // Adaptive mode forces "draw all" on every topic (the per-level questionsCount
  // governs how many are shown); the stored manual `drawAll` is preserved so
  // leaving adaptive restores it. The switch + count field lock while adaptive.
  const effectiveDrawAll = props.adaptive || section.drawAll;
  // PRD-55 (FR-33): одна чистая функция на все три места, где величина показывается.
  const expectedDelivery = expectedExposure({
    drawCount: effectiveDrawAll ? section.maxQuestions : section.drawCount,
    poolSize: section.maxQuestions,
  });

  // PRD-17: variants mode is for standard delivery only; in adaptive the section
  // draws by difficulty levels, so the variant set is ignored and not edited.
  const variantsOn = !props.adaptive && section.formSet != null;

  // Author request (UX): never HIDE the mutually-exclusive controls — show them
  // DISABLED instead, so the card never appears to silently "lose" settings.
  // Variants mode overrides the whole-topic draw; "draw all" overrides the
  // partial-draw quotas. `partialDrawLocked` covers both the count field and the
  // quota editor (a partial draw is the only thing they apply to).
  const drawAllDisabled = props.adaptive || variantsOn;
  const partialDrawLocked = effectiveDrawAll || variantsOn;
  const quotaReason = variantsOn
    ? "Недоступно: активен режим «Варианты теста» — вопросы берутся из выпавшего варианта целиком."
    : effectiveDrawAll
      ? "Недоступно: выдаётся вся тема. Квоты применяются только к частичной выборке."
      : undefined;
  // The draw-count error only applies to an editable partial whole-topic draw.
  const drawCountError = !partialDrawLocked ? props.drawCountError : undefined;
  // PRD-30 FR-18: the topic's value is an OVERRIDE; null = «как в тесте», and
  // the order it then delivers in comes from the test.
  const effectiveOrder = effectiveSectionOrder(props.testOrder, section.questionOrder);

  // Перетаскивание темы: между группами и внутри списка. Ручка — единственная мишень
  // захвата: повесь его на всю строку, и обычный клик по заголовку перестал бы её
  // разворачивать.
  const sortable = useSortable({ id: DRAG.topic + section.topicId });
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : undefined,
  };

  // «Перейти к ошибкам» целится в поле ВНУТРИ карточки. Тело свёрнутой карточки
  // остаётся в разметке (её прячет CSS), поэтому сам переход раскрыть её не может —
  // он лишь просит об этом событием, а знает про свёртку карточка.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const setRowRef = useCallback(
    (el: HTMLDivElement | null) => {
      rowRef.current = el;
      sortable.setNodeRef(el);
    },
    [sortable],
  );
  const { open, onToggleOpen } = props;
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const reveal = () => {
      if (!open) onToggleOpen();
    };
    el.addEventListener(REVEAL_EVENT, reveal);
    return () => el.removeEventListener(REVEAL_EVENT, reveal);
  }, [open, onToggleOpen]);

  return (
    <>
      <div
        ref={setRowRef}
        style={dragStyle}
        className={`ou-acc__item${props.open ? " is-open" : ""}`}
        data-testid={`topic-row-${section.topicId}`}
        // FR-20c: якорь перехода на КАРТОЧКУ темы. Без него самым близким адресом
        // для `sections[i].*` оставался общий `sections` на кнопке «Добавить тему»,
        // и «Перейти к ошибкам» уводило от виноватой темы к добавлению новой.
        data-field={`sections[${props.index}]`}
      >
        {/* Шапка аккордеона отдельной строкой, а не содержимым триггера: кнопку удаления
            нельзя вкладывать в кнопку раскрытия — это и невалидная разметка, и клик по
            удалению заодно сворачивал бы тему. Так же устроена шапка в эскизе. */}
        <div className="tb-acc-head">
          {/* Ручка стоит и когда групп нет: порядок тем меняется и в плоском списке. */}
          <span
            className="drag-handle"
            aria-label={`Переместить тему «${section.topicName}»`}
            data-testid={`topic-grip-${section.topicId}`}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical size={14} aria-hidden="true" />
          </span>
          {/* Точка статуса — тем же знаком и в том же месте шапки, что у карточки
              шкалы: ошибка внутри видна, пока карточка свёрнута. Чисто — точки нет
              (контракт «Индикация проблем»: точка, а не счётчик, и только по делу). */}
          {props.hasIssue && (
            <span
              className="tb-status-dot tb-status-dot--err"
              aria-label={`Есть ошибки: ${section.topicName}`}
              data-testid={`topic-issue-${section.topicId}`}
            />
          )}
          <button
            type="button"
            className="ou-acc__trigger"
            aria-expanded={props.open}
            onClick={props.onToggleOpen}
            data-testid={`topic-toggle-${section.topicId}`}
          >
            <span className="ou-acc__trigger-text">
              <span className="ou-acc__title">{`${props.number ?? props.index + 1}. ${section.topicName}`}</span>
              <span className="ou-acc__subtitle">
                {`${section.maxQuestions} вопрос${plural(section.maxQuestions)} в банке · выдаётся ${
                  effectiveDrawAll ? section.maxQuestions : section.drawCount
                }`}
                {/* PRD-55 (FR-33): ожидаемая экспозиция хвостом существующей сводки — так она
                    видна по всем темам разом, без разворачивания каждой. */}
                {expectedDelivery && (
                  <span
                    className={expectedDelivery.tone === "warning" ? "tb-exposure-hint--warn" : undefined}
                    data-testid={`topic-exposure-${section.topicId}`}
                  >
                    {` · увидят ${expectedDelivery.percent}%`}
                  </span>
                )}
                {props.unlockTail && (
                  <span data-testid={`topic-unlock-tail-${section.topicId}`}>{` · ${props.unlockTail}`}</span>
                )}
              </span>
            </span>
          </button>
          {props.unavailable && (
            <Tag tone="warning" size="s" data-testid={`topic-unavailable-${section.topicId}`}>
              Тема недоступна
            </Tag>
          )}
          <span className="tb-topic-actions">
            <IconButton
              icon={<Trash2 size={14} aria-hidden="true" />}
              aria-label={`Убрать тему «${section.topicName}»`}
              variant="ghost"
              size="s"
              onClick={props.onRemove}
              data-testid={`topic-remove-${section.topicId}`}
            />
          </span>
          {/*
            Шеврон — привычная мишень разворота, и в дизайн-системе он ЧАСТЬ кнопки-триггера
            (`Accordion`: `.ou-acc__chev` лежит внутри `.ou-acc__trigger`). Здесь шапка собрана
            вручную — кнопку удаления нельзя вкладывать в кнопку раскрытия, — и шеврон оказался
            снаружи: выглядел живым, а кликов не принимал.

            Клик повешен на сам `span`, и роли с `tabIndex` у него СОЗНАТЕЛЬНО нет: рядом стоит
            настоящая кнопка-триггер с `aria-expanded`, она и есть клавиатурный путь. Сделать
            шеврон второй кнопкой значило бы завести второй таб-стоп и второе объявление того же
            действия — для скринридера он остаётся декорацией, для мыши становится мишенью.
          */}
          <span
            className="ou-acc__chev"
            aria-hidden="true"
            onClick={props.onToggleOpen}
            data-testid={`topic-chev-${section.topicId}`}
          >
            <ChevronDown size={16} />
          </span>
        </div>
        <div className="ou-acc__body" role="region">
          {/* «Обязательная» — свойство темы, а не строка списка: в эскизе она первым
              полем тела, рядом с «все вопросы темы» и выборкой. */}
          <div className="ou-formfield">
            <Switch
              label="Обязательная"
              checked={section.required}
              onChange={(e) => props.onToggleRequired(e.target.checked)}
              aria-label={`Тема обязательная: ${section.topicName}`}
              data-testid={`topic-required-${section.topicId}`}
            />
          </div>
          {props.unlockFields}
          {/* PRD-17: variants mode overrides the whole-topic draw (the source
              becomes the drawn variant, delivered whole), and "draw all" overrides
              the partial-draw quotas. Per author request these controls are kept
              VISIBLE but DISABLED in those cases instead of being hidden, so the
              card never looks like it silently dropped settings. */}
          <label className="tb-draw-all-row">
            <Switch
              checked={effectiveDrawAll}
              disabled={drawAllDisabled}
              onChange={(e) => props.onToggleDrawAll(e.target.checked)}
              aria-label={`Все вопросы темы: ${section.topicName}`}
              data-testid={`topic-drawall-${section.topicId}`}
            />
            <span className="tb-draw-all-row__lbl">Все вопросы темы</span>
            {props.adaptive ? (
              <span className="tb-draw-all-row__hint">включено адаптивным режимом</span>
            ) : variantsOn ? (
              <span className="tb-draw-all-row__hint">отключено в режиме вариантов</span>
            ) : null}
          </label>
          <div
            className="tb-draw-count-row"
            data-field={`sections[${props.index}].drawCount`}
            data-invalid={drawCountError ? "true" : undefined}
          >
            <span className="tb-draw-count-row__label">Вопросов в тест</span>
            <NumberInput
              size="s"
              value={effectiveDrawAll ? maxQ : section.drawCount}
              min={1}
              max={maxQ}
              disabled={partialDrawLocked}
              invalid={Boolean(drawCountError)}
              aria-label={`Количество вопросов из темы ${section.topicName}`}
              data-testid={`topic-drawcount-${section.topicId}`}
              onChange={(next) => props.onChangeDrawCount(next)}
            />
            <span className="tb-draw-count-row__max">из {section.maxQuestions}</span>
          </div>
          {drawCountError && (
            <p className="tb-field-error" role="alert" data-testid={`topic-drawcount-error-${section.topicId}`}>
              {drawCountError}
            </p>
          )}

          {/* PRD-55 (FR-33): ожидаемая экспозиция — сколько участников увидят каждое задание темы
              при нынешней выдаче. Данных о прохождениях НЕ требует, поэтому работает и на пустом
              тесте, то есть тогда, когда настройку ещё можно исправить. Величина показывается
              всегда, меняется только тон: выше порога выработки банка — предупреждение. */}
          {expectedDelivery && (
            <Banner
              tone={expectedDelivery.tone}
              title={`Каждое задание темы увидят около ${expectedDelivery.percent}% участников`}
              description={
                expectedDelivery.tone === "warning"
                  ? `Выдача ${effectiveDrawAll ? section.maxQuestions : section.drawCount} из ${section.maxQuestions} — банк вырабатывается за один поток. Добавьте вопросов в тему или уменьшите выдачу.`
                  : `Выдача ${effectiveDrawAll ? section.maxQuestions : section.drawCount} из ${section.maxQuestions} — запаса банка хватает, задания не приедаются.`
              }
              data-testid={`topic-exposure-banner-${section.topicId}`}
            />
          )}

          {/* PRD-30 FR-02/FR-18 (эскиз approved/prd30-test-level-order.html): the
              delivery-order control sits right under «Вопросов в тест», so the
              three delivery parameters read as one row — how many, in what
              order, in what slices. Three positions, so a Select, not a switch:
              a topic may also say «как в тесте», which is its default. */}
          <div className="tb-question-order-row">
            <span className="tb-question-order-row__lbl">Порядок вопросов</span>
            <Select
              size="s"
              value={section.questionOrder ?? INHERIT}
              onChange={(value) =>
                props.onChangeQuestionOrder(value === INHERIT ? null : (value as "random" | "fixed"))
              }
              options={TOPIC_ORDER_OPTIONS}
              aria-label={`Порядок вопросов: ${section.topicName}`}
              data-testid={`topic-question-order-${section.topicId}`}
            />
            {/* FR-18: shown ONLY on an override — its presence is also what marks
                the topic as overriding, so the row needs no «изменено» badge.
                Same control as «Оформление» uses to drop a colour override. */}
            {section.questionOrder != null && (
              <IconButton
                icon={<RotateCcw width={14} height={14} aria-hidden="true" />}
                aria-label={`Вернуть порядок как в тесте: ${section.topicName}`}
                title="Как в тесте"
                variant="ghost"
                size="s"
                onClick={() => props.onChangeQuestionOrder(null)}
                data-testid={`topic-question-order-reset-${section.topicId}`}
              />
            )}
            <span className="tb-question-order-row__hint">
              {questionOrderHint(effectiveOrder, section.questionOrder == null, variantsOn, props.testOrder)}
            </span>
          </div>

          {/* FR-20c: свой якорь на каждый блок, у которого есть своя проверка —
              иначе переход к `drawBlueprintJson` / `formSetJson` упирался в общий
              адрес темы и автор искал виноватый блок глазами. */}
          <div data-field={`sections[${props.index}].drawBlueprintJson`}>
            <KeysTable
              topicId={section.topicId}
              topicName={section.topicName}
              drawCount={section.drawCount}
              blueprint={section.drawBlueprint ?? null}
              topicTags={props.topicTags}
              availByKey={props.availByKey}
              onChange={props.onChangeBlueprint}
              disabled={partialDrawLocked}
              disabledReason={quotaReason}
              formSet={variantsOn ? (section.formSet ?? null) : null}
              tagsByQuestion={props.tagsByQuestion}
            />
          </div>

          {/* PRD-17 (BR-12): fixed variants. In adaptive mode the section draws by
              difficulty levels, so the editor is shown DISABLED (not hidden). */}
          <div data-field={`sections[${props.index}].formSetJson`}>
            <VariantsEditor
              topicId={section.topicId}
              topicName={section.topicName}
              formSet={section.formSet ?? null}
              onChange={props.onChangeFormSet}
              error={props.variantsError}
              disabled={props.adaptive}
              pointsOf={props.pointsOf}
            />
          </div>

          {/* Обратная связь темы правится во вкладке «Обратная связь и итоги»,
              подраздел «Обратная связь», карточка «По темам»: там она показана
              РАЗРЕШЁННОЙ — с источником и сбросом, — а здесь стояла среди выборки и
              квот, где автор искал её последней (PRD-29 §7.1a). */}
        </div>
      </div>
    </>
  );
}

/**
 * PRD-11 + PRD-50 FR-42: ONE «раздел × ключ» table inside a topic row, driven by the draw-quota
 * switch (PRD-11).
 *
 * A row is a KEY of the section (a sub-topic tag): a quota stratum, or — in variants mode —
 * a tag of the topic, shown as a reference of how the tags fall across the variants.
 *
 * Quota columns: the tag Select offers the topic's REAL question tags (FR-07); `count` is a
 * NumberInput capped at `drawCount`; the per-tag mode is a SegmentedControl (Ровно=exact /
 * Не менее=min). Σ quota counts must not exceed `drawCount` (FR-05 → error, blocks save); a
 * per-tag shortfall (available < count) is a non-blocking warning (FR-06) — shown as an alarm
 * sign next to the row's «Доступно» value, so the author sees WHICH row is at fault. Absence of
 * a blueprint = uniform draw (FR-02). Mirrors docs/wireframes/prd11-draw-quotas.html and
 * docs/wireframes/prd50-subtopic-gate.html (both approved).
 *
 * PRD-50 §16 (FR-56): individual sub-topic thresholds are gone — a sub-topic is judged by the
 * rule of ITS TOPIC, and one test-wide switch decides whether they count at all. What is left
 * here is DELIVERY only. `В вариантах` counts, per variant, how many of its questions carry the
 * row's key — the author sees the delivery of a key BEFORE publishing.
 */
function KeysTable(props: {
  topicId: string;
  topicName: string;
  drawCount: number;
  blueprint: DrawBlueprint | null;
  topicTags: string[];
  availByKey: Record<string, number>;
  onChange: (bp: DrawBlueprint | null) => void;
  /** Force the QUOTA half disabled (drawing the whole topic / variants mode). */
  disabled?: boolean;
  /** Why the quota half is force-disabled — shown in place of the off-state hint. */
  disabledReason?: string;
  /** PRD-17 variant set when variants mode is ON — feeds the «В вариантах» column. */
  formSet: FormSet | null;
  /** PRD-50 FR-42: question id -> its tags. */
  tagsByQuestion: Map<string, string[]>;
}) {
  const { topicId, topicName, drawCount, blueprint, topicTags, availByKey, onChange } = props;
  const forcedDisabled = props.disabled ?? false;
  const enabled = blueprint != null;
  const noTags = topicTags.length === 0;
  const strata = blueprint?.strata ?? [];
  // Quota editing is live only when quotas are on AND applicable — the same condition that
  // used to collapse the whole table.
  const quotasLive = enabled && !forcedDisabled;
  const variants = props.formSet?.forms ?? null;
  // Строки таблицы — ключи квот; в вариантном режиме добираем остальные теги темы, чтобы
  // справка о раскладке тегов по вариантам была полной.
  const rowKeys: string[] = [];
  for (const s of strata) if (!rowKeys.some((t) => tagKey(t) === tagKey(s.tag))) rowKeys.push(s.tag);
  if (variants) {
    for (const t of topicTags) if (!rowKeys.some((x) => tagKey(x) === tagKey(t))) rowKeys.push(t);
  }
  // Таблица раскрыта, когда есть что показывать: живые квоты ЛИБО вариантный режим, где
  // квоты неприменимы (PRD-17 FR-03), но раскладка тегов по вариантам — единственная
  // справка автору о том, ровно ли легли теги. Поля квот там неактивны, как и сейчас.
  const expanded = quotasLive || variants != null;
  const variantCounts = (key: string): number[] =>
    (variants ?? []).map(
      (f) => f.questionIds.filter((id) => (props.tagsByQuestion.get(id) ?? []).some((t) => tagKey(t) === tagKey(key))).length,
    );

  // Свёртка карточек квот. Состояние хранит РАСКРЫТЫЕ, а не свёрнутые: теги темы
  // приезжают запросом, и набор «свернуть всё», посчитанный на первом рендере, оказался
  // бы пустым — карточки открылись бы все. Свёрнутая карточка говорит то же, что говорила
  // строка таблицы, поэтому исходное состояние — свёрнуто.
  const [openQuotas, setOpenQuotas] = useState<Set<string>>(new Set());

  const usedKeys = new Set(strata.map((s) => tagKey(s.tag)));
  const unusedTags = topicTags.filter((t) => !usedKeys.has(tagKey(t)));
  const availOf = (tag: string) => availByKey[tagKey(tag)] ?? 0;
  const sum = strata.reduce((acc, s) => acc + (s.count || 0), 0);
  const remainder = Math.max(0, drawCount - sum);
  const overflow = sum > drawCount;
  const anyShortfall = strata.some((s) => s.count > availOf(s.tag));
  // Mirror the server drawStratumSchema: a tag must be 1–TAG_MAX_LENGTH chars after
  // normalization. An empty/blank tag (e.g. a stale blueprint whose tag was cleared)
  // would be rejected with an HTTP 400 on save — flag it here so it can't slip through.
  const badTag = (tag: string) => {
    const t = normalizeTag(tag ?? "");
    return t.length < 1 || t.length > TAG_MAX_LENGTH;
  };
  const anyBadTag = strata.some((s) => badTag(s.tag));
  const setStrata = (next: DrawBlueprint["strata"]) => onChange({ strata: next });
  const toggle = (on: boolean) => {
    if (!on) return onChange(null);
    if (noTags) return;
    onChange({ strata: [{ tag: topicTags[0], count: 1, mode: "exact" }] });
  };
  const quotaKeys = strata.map((s) => tagKey(s.tag));
  const quotaFold: SectionFold = {
    isOpen: (id) => openQuotas.has(id),
    toggle: (id) =>
      setOpenQuotas((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    collapseAll: () => setOpenQuotas(new Set()),
    expandAll: () => setOpenQuotas(new Set(quotaKeys)),
    allCollapsed: quotaKeys.every((k) => !openQuotas.has(k)),
    anyCollapsed: quotaKeys.some((k) => !openQuotas.has(k)),
  };

  const addStratum = () => {
    if (unusedTags.length === 0) return;
    const tag = unusedTags[0];
    setStrata([...strata, { tag, count: 1, mode: "exact" }]);
    // Новая квота открывается сама: тег в ней ещё не выбран, и свёрнутая карточка
    // предложила бы автору угадать, что именно он только что добавил.
    setOpenQuotas((prev) => new Set([...prev, tagKey(tag)]));
  };
  const updateStratum = (i: number, patch: Partial<DrawBlueprint["strata"][number]>) =>
    setStrata(strata.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeStratum = (i: number) => setStrata(strata.filter((_, idx) => idx !== i));

  return (
    <>
      <label className="tb-quota-toggle">
        <Switch
          checked={enabled}
          disabled={noTags || forcedDisabled}
          onChange={(e) => toggle(e.target.checked)}
          aria-label={`Квоты по подтемам: ${topicName}`}
          data-testid={`topic-quota-toggle-${topicId}`}
        />
        <span className="tb-section-label">Квоты по подтемам (тегам)</span>
      </label>

      {forcedDisabled ? (
        <div className="tb-card-desc" data-testid={`topic-quota-locked-${topicId}`}>
          {props.disabledReason}
        </div>
      ) : noTags ? (
        <div className="tb-card-desc" data-testid={`topic-quota-notags-${topicId}`}>
          У вопросов темы нет тегов — добавьте теги в разделе «Вопросы», чтобы задавать квоты по подтемам.
        </div>
      ) : !enabled ? (
        <div className="tb-card-desc">
          Выключено — выдача равномерная (случайные вопросы из всей темы). Включите, чтобы гарантировать покрытие подтем.
        </div>
      ) : null}

      {expanded && (
        <div className="tb-quota-block" data-testid={`topic-quota-block-${topicId}`}>
          {quotasLive && anyBadTag && (
            <Banner
              tone="error"
              variant="subtle"
              role="alert"
              description={`Не выбран тег для квоты (тег обязателен, 1–${TAG_MAX_LENGTH} символов). Сохранение заблокировано до исправления.`}
              data-testid={`topic-quota-tag-error-${topicId}`}
            />
          )}
          {quotasLive && overflow && (
            <Banner
              tone="error"
              variant="subtle"
              role="alert"
              description={`Сумма квот (${sum}) превышает «Вопросов в тест» (${drawCount}). Квоты — это срезы внутри выборки. Сохранение заблокировано до исправления.`}
              data-testid={`topic-quota-error-${topicId}`}
            />
          )}
          {quotasLive && !overflow && !anyBadTag && anyShortfall && (
            <Banner
              tone="warning"
              variant="subtle"
              role="status"
              description="Для некоторых подтем вопросов меньше квоты — выдастся сколько есть, это не блокирует сохранение."
              data-testid={`topic-quota-warning-${topicId}`}
            />
          )}

          {/* Карточка на подтему, а не строка таблицы (эскиз 710-792): в строке поля
              сжимались до неразличимости, а подписей у них не было вовсе — колонка
              «Сколько» не говорит, сколько чего. Свёрнутая карточка сообщает ровно то,
              что говорила строка: режим, число, доступно и раскладку по вариантам. */}
          <div className="tb-fold-toolbar">
            <FoldAllButtons fold={quotaFold} testIdPrefix={`quota-${topicId}`} />
          </div>

          {rowKeys.map((rowTag, i) => {
            // Quota half of the row: the stratum with this key, if the author set one.
            // Its index in `strata` (not the row index) keeps the quota test ids and the
            // mutators addressing the very same stratum they addressed before.
            const si = strata.findIndex((s) => tagKey(s.tag) === tagKey(rowTag));
            const stratum = si >= 0 ? strata[si] : null;
            const avail = availOf(rowTag);
            const short = stratum != null && stratum.count > avail;
            const options = topicTags
              .filter((t) => tagKey(t) === tagKey(rowTag) || !usedKeys.has(tagKey(t)))
              .map((t) => ({ value: t, label: t }));
            // Разворачивать нечего у справочной строки вариантного режима: квоты у неё нет,
            // и в теле карточки не оказалось бы ни одного поля.
            const foldable = stratum != null && quotasLive;
            const open = foldable && quotaFold.isOpen(tagKey(rowTag));
            return (
              <section
                key={`${tagKey(rowTag)}-${i}`}
                className={"ou-card ou-card--outlined ou-card--sm tb-level-card" + (open ? "" : " is-collapsed")}
                data-testid={`quota-card-${topicId}-${i}`}
              >
                <header className="ou-card__header tb-level-card__head">
                  <div className="ou-card__heading tb-level-card__heading">
                    <h5 className="ou-card__title tb-level-card__title">{rowTag}</h5>
                    <p className="ou-card__subtitle tb-level-card__summary">
                      {stratum && (
                        <span>
                          {stratum.mode === "min" ? "не менее" : "ровно"} {stratum.count}
                          {" · "}
                        </span>
                      )}
                      <span>доступно {avail}</span>
                      {/* Знак тревоги стоит У ЗНАЧЕНИЯ карточки-нарушителя, а не чипом в
                          подвале блока: чип говорил о блоке целиком и не показывал, какая
                          подтема виновата. Подсказка открывается и по наведению, и по
                          фокусу с клавиатуры (эскиз prd50-subtopic-gate.html, состояние 2). */}
                      {short && stratum && (
                        <Tooltip
                          placement="top"
                          wrap
                          tabIndex={0}
                          content={`Вопросов с этой подтемой меньше, чем запрошено: доступно ${avail} из ${stratum.count}. Выдастся сколько есть.`}
                          data-testid={`quota-shortfall-${topicId}-${si}`}
                        >
                          <span className="tb-quota-block__alarm" aria-hidden="true">
                            <AlertTriangle size={14} />
                          </span>
                          <span className="ou-sr-only">
                            {`Нехватка вопросов по подтеме «${stratum.tag}»`}
                          </span>
                        </Tooltip>
                      )}
                      {variants && (
                        <span data-testid={`key-variants-${topicId}-${i}`}>
                          {" · в вариантах "}
                          {variantCounts(rowTag).map((n, vi) => (
                            <span key={vi}>
                              {variants[vi].label}: {n}
                              {vi < variants.length - 1 ? " · " : ""}
                            </span>
                          ))}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="ou-card__trail tb-level-card__trail">
                    {stratum && quotasLive && (
                      <IconButton
                        icon={<Trash2 size={14} aria-hidden="true" />}
                        variant="ghost"
                        size="s"
                        aria-label={`Удалить квоту «${stratum.tag}»`}
                        onClick={() => removeStratum(si)}
                        data-testid={`quota-remove-${topicId}-${si}`}
                      />
                    )}
                    {foldable && (
                      <button
                        type="button"
                        className="tb-level-card__chev"
                        aria-label={open ? `Свернуть квоту «${rowTag}»` : `Развернуть квоту «${rowTag}»`}
                        aria-expanded={open}
                        onClick={() => quotaFold.toggle(tagKey(rowTag))}
                        data-testid={`quota-fold-${topicId}-${i}`}
                      >
                        <ChevronDown width={16} height={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </header>

                {open && stratum && (
                  <div className="ou-card__body tb-level-card__body">
                    <Grid cols={2} gap={4}>
                      <Select
                        size="m"
                        fullWidth
                        label="Подтема (тег вопроса)"
                        value={stratum.tag}
                        options={options}
                        tone={badTag(stratum.tag) ? "error" : undefined}
                        onChange={(v) => updateStratum(si, { tag: v })}
                        aria-label={`Подтема для квоты ${si + 1}`}
                        data-testid={`quota-tag-${topicId}-${si}`}
                      />
                      <NumberInput
                        size="m"
                        fullWidth
                        label="Сколько вопросов"
                        value={stratum.count}
                        min={1}
                        max={drawCount}
                        invalid={overflow}
                        onChange={(n) => updateStratum(si, { count: n })}
                        aria-label={`Сколько вопросов для подтемы «${stratum.tag}»`}
                        data-testid={`quota-count-${topicId}-${si}`}
                      />
                    </Grid>
                    <Grid cols={2} gap={4}>
                      <div className="ou-formfield">
                        <label className="ou-formfield__lbl">Режим квоты</label>
                        <SegmentedControl<"exact" | "min">
                          size="m"
                          value={stratum.mode ?? "exact"}
                          items={[
                            { value: "exact", label: "Ровно" },
                            { value: "min", label: "Не менее" },
                          ]}
                          onChange={(v) => updateStratum(si, { mode: v })}
                          aria-label={`Режим квоты для подтемы «${stratum.tag}»`}
                        />
                      </div>
                    </Grid>
                  </div>
                )}
              </section>
            );
          })}

          {quotasLive && (
            <div className="tb-quota-actions">
              <Button
                variant="ghost"
                size="s"
                leadingIcon={<Plus size={16} aria-hidden="true" />}
                disabled={unusedTags.length === 0}
                onClick={addStratum}
                data-testid={`quota-add-${topicId}`}
              >
                Добавить квоту
              </Button>
            </div>
          )}

          {/* Итог квот — только счёт. Чипа уровня здесь нет (эскиз prd50-subtopic-gate.html):
              он говорил о карточке целиком и не показывал, какая строка виновата. Об ошибке
              говорит баннер и невалидные поля, о нехватке — знак у значения строки. */}
          {quotasLive && (
            <div className={`tb-quota-sum${overflow ? " is-error" : ""}`}>
              <span>
                {overflow
                  ? `Σ квот: ${sum} из ${drawCount} — превышение на ${sum - drawCount}`
                  : `Σ квот: ${sum} из ${drawCount} · остаток ${remainder}`}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}


function TopicPickerModal(props: {
  open: boolean;
  topics: TopicWithQuestionCount[];
  onPick: (topic: TopicWithQuestionCount) => void;
  onCancel: () => void;
  /**
   * «Создать тему»: открыть ящик новой темы с набранным в поиске названием. Нет —
   * кнопки нет (у автора нет права создавать темы).
   */
  onCreate?: (name: string) => void;
}) {
  const [filter, setFilter] = useState("");
  // `String(t?.name ?? "")`, а не `t.name`: строка без имени — это испорченный ответ API,
  // и падать на ней всем ящиком нельзя. Раньше исключение в этом фильтре сносило редактор
  // целиком, вместе с уже введённым черновиком.
  const needle = filter.trim().toLowerCase();
  const filtered = props.topics.filter((t) =>
    String(t?.name ?? "").toLowerCase().includes(needle),
  );

  return (
    <ModalDialog
      open={props.open}
      onClose={props.onCancel}
      size="m"
      title="Добавить тему"
      description="Темы, доступные вам и ещё не добавленные в тест"
      footer={
        <>
          {props.onCreate && (
            <Button
              variant="secondary"
              size="m"
              className="tb-topic-picker__create"
              leadingIcon={<Plus size={16} aria-hidden="true" />}
              onClick={() => props.onCreate?.(filter.trim())}
              data-testid="topic-picker-create"
            >
              Создать тему
            </Button>
          )}
          <Button
            variant="ghost"
            size="m"
            onClick={props.onCancel}
            data-testid="topic-picker-cancel"
          >
            Отмена
          </Button>
        </>
      }
      data-testid="topic-picker-modal"
    >
      <Input
        size="m"
        fullWidth
        label="Поиск темы"
        placeholder="Название темы"
        iconRight={<Search size={16} aria-hidden="true" />}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
        className="tb-topic-picker__search"
        data-testid="topic-picker-search"
      />
      <ul className="tb-topic-picker__list">
        {filtered.length === 0 && (
          <li className="tb-topic-picker__empty">
            {props.topics.length === 0
              ? "Все темы уже добавлены в тест"
              : "Ничего не найдено"}
          </li>
        )}
        {filtered.map((topic) => (
          <li key={topic.id}>
            <button
              type="button"
              className="tb-topic-picker__item"
              onClick={() => props.onPick(topic)}
              data-testid={`topic-picker-item-${topic.id}`}
            >
              <span>{topic.name}</span>
              <span className="tb-topic-picker__item-count">
                {topic.questionCount === 0
                  ? "нет вопросов"
                  : `${topic.questionCount} вопрос${plural(topic.questionCount)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ModalDialog>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal shape of `/api/questions` rows the key table needs. */
export type QuestionTagRow = { id?: string; topicId: string; tags?: string[] };

/** Per-topic tag index: distinct display tags + how many questions carry each key. */
type TopicTagInfo = { tags: string[]; availByKey: Record<string, number> };

/**
 * Build a `topicId -> {tags, availByKey}` index from the question bank. `tags`
 * holds the distinct display forms (deduped case-insensitively) sorted for a
 * stable Select order; `availByKey` counts how many questions carry each tag key
 * (a question with several tags counts once per distinct key) — the per-tag
 * availability used for the shortfall indicator (FR-06).
 */
export function buildTagsByTopic(questions: QuestionTagRow[]): Map<string, TopicTagInfo> {
  const map = new Map<string, TopicTagInfo>();
  for (const q of questions) {
    if (!q || typeof q.topicId !== "string") continue;
    let info = map.get(q.topicId);
    if (!info) {
      info = { tags: [], availByKey: {} };
      map.set(q.topicId, info);
    }
    const seen = new Set<string>();
    for (const raw of Array.isArray(q.tags) ? q.tags : []) {
      const key = tagKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      info.availByKey[key] = (info.availByKey[key] ?? 0) + 1;
      if (!info.tags.some((x) => tagKey(x) === key)) info.tags.push(raw);
    }
  }
  for (const info of map.values()) info.tags.sort((a, b) => a.localeCompare(b, "ru"));
  return map;
}

function plural(
  n: number,
  one: string = "",
  few: string = "а",
  many: string = "ов",
): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
