/**
 * @module features/analytics/slices/slice-list
 * @description PRD-56 FR-06, FR-06c, FR-06d, FR-08: список срезов.
 *
 * Показывает ФАКТЫ: сколько начали, сколько дошли до конца, сколько сдали и с каким средним.
 * Отклонений от невидимой на экране величины здесь нет (FR-06c) — за сравнением ведёт отдельный
 * режим с явно названными срезами.
 *
 * Ниже порога наблюдений процент не печатается: вместо него «мало данных» и сам объём выборки
 * (FR-06d). Объём показывается всегда — «81 % из 12» и «81 % из 340» читаются по-разному.
 *
 * Разворот строки (FR-06e) отвечает на «в какой теме провал У ЭТОГО среза»: доля верных по темам
 * и объём выборки каждой темы — и ничего больше. Ни с чем не сравнивает: за сравнением ведёт
 * отдельный режим. Темы грузятся ПРИ РАЗВОРОТЕ: платить за них у всех срезов сразу незачем,
 * а развёрнут за раз один.
 *
 * Колонки фактов сортируются (эскиз PRD-56, задача 2.3 плана сверки): срезов по оси бывает
 * десяток и больше, и «где сдали хуже всех» ищут глазами по столбцу. «Слабейшая тема» не
 * сортируется — у каждой строки она своя, и порядок по её доле сравнивал бы разные темы.
 *
 * Действия строки живут под троеточием «⋯» (эскиз, состояние `slice-gap`, дельта 6.3): два
 * перехода кнопками с именем среза в подписи вылезали за правый край таблицы, а действий у среза
 * больше двух. Порядок пунктов — как в эскизе: сначала куда перейти, потом что сделать со срезом.
 *
 * Э3.2 (эскиз approved/e3-test-and-question.html): один компонент — два вида. Без оси это
 * «Сохранённые срезы» теста: под названием — условия среза, колонок «Назначено» и «Начато» нет.
 * С осью — разбивка «Результаты по …» на «Обзоре» теста, в выборке с условиями уровня теста.
 */
import { useEffect, useRef, useState } from "react";

import { MoreHorizontal } from "lucide-react";

import {
  Button,
  DataGrid,
  IconButton,
  Input,
  MenuDivider,
  MenuItem,
  MenuTrigger,
  ModalDialog,
  Stack,
  Text,
  type SortDir,
} from "@skillum/ui-kit";

import { percent } from "../format";
import { ExportDialog } from "../registry/export-dialog";
import { RegistryFilterPanel } from "../registry/filter-panel";
import {
  conditionsToFilter, describeConditions, EMPTY_FILTER, type RegistryFilter,
} from "../registry/filter-state";
import { useRegistryDictionaries, useTestDictionary } from "../registry/use-dictionaries";

/** Срез с посчитанными величинами — то, что отдаёт `GET /api/analytics/slices`. */
export interface SliceRow {
  id: string;
  name: string;
  conditions: Record<string, unknown>;
  started: number;
  completed: number;
  passed: number;
  participants: number;
  passRate: number | null;
  avgPercent: number | null;
  enoughData: boolean;
  /**
   * Сколько людей среза получили назначение теста (FR-06). `null` — величина к этому срезу
   * неприменима: назначают человека, а срез по номеру попытки или варианту описывает попытку.
   */
  assigned?: number | null;
  /**
   * Слабейшая тема среза (FR-06): та, где доля верных ниже всех. `null` — говорить не о чем:
   * ответов нет либо ни одна тема не набрала порога наблюдений.
   */
  weakest?: SliceTopic | null;
  /** Темы среза целиком — ими сравнение сопоставляет доли верных (FR-07). */
  topics?: SliceTopic[];
}

export interface SliceListProps {
  /** Тест — рамка расчёта. Без него средние не считаются (решение 2 спеки). */
  testId: string;
  /**
   * Таблица — главное на экране (вкладка «Срезы»): во всю высоту окна, прокрутка внутри.
   * На «Обзоре», среди других блоков, — нет.
   */
  fill?: boolean;
  /** Период как рамка; пустой означает «за всё время» (FR-07j). */
  from?: string;
  to?: string;
  /** Ось разбиения. Без неё показываются сохранённые срезы. */
  axis?: string;
  /**
   * Э3.2: условия уровня теста — выборка, которую режет ось (разбивка на «Обзоре» подчиняется
   * фильтру теста). Сохранённым срезам не передаются: у каждого свои условия.
   */
  conditions?: Record<string, unknown>;
  /** Сколько строк пришло — для подзаголовка карточки, которую рисует вкладка. */
  onLoaded?: (count: number) => void;
  /** Заголовок первой колонки: у разбивки — имя оси («Группа»), у сохранённых — «Срез». */
  nameHeader?: string;
  /** Перейти в реестр с условиями среза (FR-08). */
  onOpenRegistry?: (conditions: Record<string, unknown>) => void;
  /**
   * Уйти в аналитику ТЕСТА с условиями этого среза (FR-24, переход «группа → тест»).
   *
   * Реестр отвечает на «кто эти люди», аналитика теста — на «что у них не получилось»: где
   * провалились темы, какие вопросы подвели. Без перехода второй вопрос требовал бы заново
   * искать тест в списке и там набирать условие, которое уже набрано здесь.
   */
  onOpenTestAnalytics?: (conditions: Record<string, unknown>) => void;
  /**
   * Сравнить этот срез с другим: вкладка переходит в режим сравнения, и срез занимает первый
   * слот. Условия едут набранным отбором (FR-07b) — сравнение знает сохранённые срезы и отбор,
   * а срез по оси сохранённым не является.
   */
  onCompare?: (conditions: Record<string, unknown>, name: string) => void;
}

/** Есть ли у среза хоть одно условие на языке реестра. */
function hasConditions(conditions: Record<string, unknown>): boolean {
  return Object.values(conditions).some(value =>
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "");
}

/**
 * Пересечение двух границ периода: поздняя из начал и ранняя из концов.
 *
 * Срез по потоку несёт свой период, а рамка вкладки — свой; выгрузка обязана отдать прохождения,
 * попавшие в ОБА, иначе книга разошлась бы с числами строки.
 */
function laterOf(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function earlierOf(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

interface SliceRowMenuProps {
  name: string;
  onOpenRegistry?: () => void;
  onOpenTestAnalytics?: () => void;
  onCompare?: () => void;
  /** Правка условий; `anchor` — ячейка меню строки, под которой встаёт панель. */
  onEdit?: (anchor: HTMLElement | null) => void;
  onSave?: () => void;
  onExport: () => void;
}

/**
 * Меню «⋯» строки среза — пункты в порядке эскиза (`slice-gap`, дельта 6.3).
 *
 * Пункта без обработчика нет вовсе: выключенный пункт спрашивал бы «почему», а ответ «этот
 * срез по оси» читателю ничего не даёт — у среза по оси просто другие действия.
 */
function SliceRowMenu({
  name, onOpenRegistry, onOpenTestAnalytics, onCompare, onEdit, onSave, onExport,
}: SliceRowMenuProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    // `tb-rowmenu` — метка ячейки меню для раскладки узкой колонки (`tb-components.css`).
    // Она же — якорь панели «Изменить условия»: пункт меню исчезает вместе с меню.
    <span className="tb-rowmenu" ref={anchor}>
      <MenuTrigger
        size="sm"
        placement="bottom-end"
        trigger={
          <IconButton
            variant="ghost"
            size="s"
            aria-label={`Действия со срезом: ${name}`}
            icon={<MoreHorizontal size={16} aria-hidden="true" />}
          />
        }
      >
        {onOpenRegistry && <MenuItem onClick={onOpenRegistry}>Открыть прохождения</MenuItem>}
        {onOpenTestAnalytics && <MenuItem onClick={onOpenTestAnalytics}>Аналитика теста</MenuItem>}
        {onCompare && <MenuItem onClick={onCompare}>Сравнить с другим срезом</MenuItem>}
        {onEdit && <MenuItem onClick={() => onEdit(anchor.current)}>Изменить условия</MenuItem>}
        <MenuDivider />
        {onSave && <MenuItem onClick={onSave}>Сохранить как срез</MenuItem>}
        <MenuItem onClick={onExport}>Выгрузить прохождения</MenuItem>
      </MenuTrigger>
    </span>
  );
}


/** Колонки, по которым сортируется список срезов. */
type SliceSort = "name" | "assigned" | "started" | "completed" | "passRate" | "avgPercent";

/**
 * Число колонки для сортировки; `null` — показывать нечего: величина к срезу неприменима или
 * выборка мала («мало данных»). Такие строки идут последними в обоих направлениях — пустое не
 * меньше и не больше числа.
 */
function sortNumber(row: SliceRow, column: Exclude<SliceSort, "name">): number | null {
  if (column === "assigned") return row.assigned ?? null;
  if (column === "passRate") return row.enoughData ? row.passRate : null;
  if (column === "avgPercent") return row.enoughData ? row.avgPercent : null;
  return row[column];
}

/** Сравнение двух срезов для выбранной колонки и направления. */
export function compareSlices(a: SliceRow, b: SliceRow, column: SliceSort, dir: SortDir): number {
  const sign = dir === "asc" ? 1 : -1;
  if (column === "name") return sign * a.name.localeCompare(b.name, "ru");
  const valueA = sortNumber(a, column);
  const valueB = sortNumber(b, column);
  if (valueA === null || valueB === null) {
    if (valueA === valueB) return 0;
    return valueA === null ? 1 : -1;
  }
  return sign * (valueA - valueB);
}

/** Тема развёрнутой строки — то, что отдаёт `GET /api/analytics/slices/topics`. */
export interface SliceTopic {
  topicId: string;
  topicName: string;
  correctShare: number | null;
  inSample: number;
}

/** Состояние разворота одной строки: пока грузится — `null`, потом список тем. */
type TopicsState = Record<string, SliceTopic[] | null>;

export function SliceList({
  testId, from, to, axis, conditions, onOpenRegistry, onOpenTestAnalytics, onCompare, onLoaded,
  nameHeader = "Срез", fill = false,
}: SliceListProps) {
  /** Ключ условий: новый объект с теми же условиями не должен пересчитывать список. */
  const conditionsKey = axis && conditions && Object.keys(conditions).length > 0 ? JSON.stringify(conditions) : "";
  /** Подписи условий сохранённого среза — по названиям, а не кодам (как в сравнении). */
  const dictionaries = useRegistryDictionaries(!axis);
  const testDictionary = useTestDictionary(axis ? null : testId, !axis);
  const [slices, setSlices] = useState<SliceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [topics, setTopics] = useState<TopicsState>({});
  // Без выбранной колонки — порядок сервера: ось сама задаёт естественный (попытка 1, 2, 3…).
  const [sortColumn, setSortColumn] = useState<SliceSort | undefined>(undefined);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  /** Счётчик перезагрузок: правка условий меняет числа, и список надо пересчитать. */
  const [reloads, setReloads] = useState(0);
  /** Сохранённый срез, у которого открыта правка условий. */
  const [editing, setEditing] = useState<SliceRow | null>(null);
  /** Меню строки, чьи условия правятся: панель встаёт под ним. */
  const editAnchorRef = useRef<HTMLElement | null>(null);
  /** Срез по оси, который сохраняют как срез. */
  const [saving, setSaving] = useState<SliceRow | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * Выборка выгружаемого среза. Хранится готовым отбором, а не строкой: окно выгрузки
   * перезапрашивает объём при каждой смене отбора, и новый объект на каждой отрисовке
   * гонял бы запрос по кругу.
   */
  const [exporting, setExporting] = useState<RegistryFilter | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    const query = new URLSearchParams({ testId });
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (axis) query.set("axis", axis);
    if (conditionsKey) query.set("conditions", conditionsKey);

    void (async () => {
      try {
        const response = await fetch(`/api/analytics/slices?${query.toString()}`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { slices: SliceRow[] };
        if (!alive) return;
        setSlices(data.slices ?? []);
        onLoaded?.((data.slices ?? []).length);
      } catch {
        // Пустой список на месте ошибки читается как «данных нет» — это разные вещи, и
        // молчать о второй нельзя: по «нет данных» принимают решение, по ошибке — обновляют.
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    // Рамка сменилась — прежние темы к новой выборке отношения не имеют.
    setTopics({});
    return () => { alive = false; };
  }, [testId, from, to, axis, conditionsKey, reloads]);

  /**
   * Темы одного среза — по требованию, при развороте.
   *
   * Срез адресуется ОСЬЮ с ключом либо идентификатором сохранённого: условия реестра покрывают
   * не всякую ось, и по ним срез не восстановить. Ключ оси лежит в идентификаторе строки
   * (`<ось>:<ключ>`) — так его собрала ручка списка.
   */
  const loadTopics = async (row: SliceRow) => {
    if (topics[row.id] !== undefined) return;
    setTopics(prev => ({ ...prev, [row.id]: null }));

    const query = new URLSearchParams({ testId });
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (axis) {
      query.set("axis", axis);
      query.set("key", row.id.slice(row.id.indexOf(":") + 1));
      if (conditionsKey) query.set("conditions", conditionsKey);
    } else {
      query.set("sliceId", row.id);
    }

    try {
      const response = await fetch(`/api/analytics/slices/topics?${query.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as { topics: SliceTopic[] };
      setTopics(prev => ({ ...prev, [row.id]: data.topics }));
    } catch {
      // Пустой список честнее ложных нулей: строка скажет «не удалось посчитать».
      setTopics(prev => ({ ...prev, [row.id]: [] }));
    }
  };

  /**
   * Выборка среза для выгрузки: его условия плюс рамка расчёта.
   *
   * Тест рамки обязателен — без него книга собрала бы прохождения всех тестов под именем среза
   * (FR-07e). Период — пересечение периода среза (у потока он свой) и периода рамки.
   */
  const exportFilterOf = (row: SliceRow): RegistryFilter => {
    // Э3.2: строка разбивки — часть выборки с условиями уровня теста; без них книга собрала бы
    // группу по всему тесту, а строка показывает её внутри отбора.
    const own = conditionsToFilter({ ...(axis ? conditions ?? {} : {}), ...row.conditions });
    const periodFrom = laterOf(own.from, from);
    const periodTo = earlierOf(own.to, to);
    return {
      testIds: [testId],
      groupIds: own.groupIds,
      sources: own.sources,
      outcomes: own.outcomes,
      formIds: own.formIds,
      snapshotIds: own.snapshotIds,
      // Оргусловия среза (FR-06b): без них книга по «Отделу продаж» собрала бы весь тест.
      organizations: own.organizations,
      units: own.units,
      positions: own.positions,
      ...(periodFrom ? { from: periodFrom } : {}),
      ...(periodTo ? { to: periodTo } : {}),
    };
  };

  /**
   * Сохранить срез по оси как именованный срез — тем же запросом, что «Сохранить как срез» в
   * реестре. Тест в условиях ровно один: срез — выборка одного теста. Период рамки в условия не
   * кладётся: он рамка, а не свойство среза (FR-07e).
   */
  const saveAsSlice = async () => {
    if (!saving) return;
    setSaveError(null);
    try {
      const response = await fetch("/api/analytics/slices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          kind: "slice",
          // Э3.2: срез из строки разбивки несёт и условия уровня теста — иначе он считал бы
          // группу по всему тесту, а не ту, что была в строке.
          conditions: { ...(axis ? conditions ?? {} : {}), ...saving.conditions, testIds: [testId] },
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Не удалось сохранить");
      }
      setSaving(null);
      setSaveName("");
    } catch (error) {
      setSaveError((error as Error).message);
    }
  };

  /**
   * Правка условий сохранённого среза — той же формой отбора, что в сравнении (FR-07b).
   *
   * Тест среза сохраняется как был: окно правит условия ВНУТРИ теста и сам тест не показывает,
   * а срез без теста перестал бы быть выборкой одного теста.
   */
  const applyEdit = async (next: RegistryFilter) => {
    const target = editing;
    setEditing(null);
    if (!target) return;
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
    }).catch(() => undefined);
    // Срез хранит УСЛОВИЯ и пересчитывается при открытии (FR-07d): после правки числа другие,
    // и список надо перечитать, а не поправить на месте.
    setReloads(value => value + 1);
  };

  if (failed) {
    return <Text tone="error">Не удалось загрузить срезы. Обновите страницу.</Text>;
  }

  const columns = [
    {
      key: "name",
      header: nameHeader,
      frozen: true,
      sortable: true,
      render: (row: SliceRow) => (axis
        ? <span className="ou-grid__cell-strong">{row.name}</span>
        // Сохранённый срез: имя даёт автор, и оно может обещать не то, что срез считает, —
        // поэтому под ним условия (как в шапке столбца сравнения, FR-07f).
        : (
          <Stack gap={1}>
            <span className="ou-grid__cell-strong tb-cell-wrap">{row.name}</span>
            <Text variant="body-xs" tone="muted">
              {/* Тест в подписи не называется: он задан страницей, у всех срезов списка один. */}
              {describeConditions({ ...conditionsToFilter(row.conditions), testIds: [] }, { ...dictionaries, ...testDictionary })
                .map(condition => condition.label)
                .join(" · ") || "без условий — тест целиком"}
            </Text>
          </Stack>
        )),
    },
    // Э3.2: у сохранённого среза «назначено» и «начато» — величины разбивки по людям; в списке
    // срезов теста их нет (эскиз), там отвечают «как прошли».
    ...(axis ? [{
      key: "assigned",
      header: "Назначено",
      align: "center" as const,
      numeric: true,
      sortable: true,
      // Прочерк здесь значит «величина к этому срезу неприменима», а не «ноль назначений»:
      // по оси вроде номера попытки назначать нечего — назначают человека (FR-27).
      render: (row: SliceRow) => (row.assigned === null || row.assigned === undefined
        ? "—"
        : row.assigned),
    },
    { key: "started", header: "Начато", align: "center" as const, numeric: true, sortable: true, render: (row: SliceRow) => row.started }] : []),
    {
      key: "completed",
      header: "Завершено",
      align: "center" as const,
      numeric: true,
      sortable: true,
      render: (row: SliceRow) => row.completed,
    },
    {
      key: "passRate",
      header: "Сдали",
      align: "center" as const,
      numeric: true,
      sortable: true,
      // «Мало данных» вместо процента — и это не то же самое, что прочерк: прочерк говорит
      // «нечего оценивать», а здесь оценивать есть что, просто выборка мала.
      render: (row: SliceRow) => (row.enoughData
        ? percent(row.passRate)
        : <Text variant="body-s" tone="muted">мало данных</Text>),
    },
    {
      key: "avgPercent",
      header: "Средний результат",
      align: "center" as const,
      numeric: true,
      sortable: true,
      render: (row: SliceRow) => (row.enoughData
        ? percent(row.avgPercent)
        : <Text variant="body-s" tone="muted">мало данных</Text>),
    },
    {
      key: "weakest",
      header: "Слабейшая тема",
      // Тема названа вместе со своей долей: «Корпоративные финансы» без числа не говорит,
      // провал это или ровный результат, у которого просто кто-то обязан быть последним.
      // Прочерк здесь честен — он значит «называть слабейшую не из чего» (FR-06d).
      render: (row: SliceRow) => (row.weakest
        ? `${row.weakest.topicName}${row.weakest.correctShare === null
          ? ""
          : ` · ${percent(row.weakest.correctShare)}`}`
        : "—"),
    },
    {
      key: "actions",
      // Узкая колонка управления, как у меню строки в таблицах вопросов: кнопок с именем среза
      // в подписи здесь больше нет, и таблица не вылезает за правый край карточки.
      width: "4%",
      header: "",
      // Реестр отвечает «кто эти люди», аналитика теста — «что у них не получилось» (FR-08,
      // FR-24). Все пункты несут условия ЭТОГО среза, чтобы на той стороне ничего не пришлось
      // набирать заново.
      render: (row: SliceRow) => {
        // Срез по оси — строка разбиения, сохранённый — запись владельца. Править можно только
        // запись; сохранять — только строку разбиения, у записи имя уже есть.
        const saved = !axis && row.id !== "whole" && row.id !== "adhoc";
        // «Без группы», номер попытки, внешний участник на языке реестра не описываются: условий
        // у такой строки нет, и сравнение или сохранение по ним дали бы тест целиком.
        const describable = hasConditions(row.conditions);
        return (
          <SliceRowMenu
            name={row.name}
            onOpenRegistry={onOpenRegistry && (() => onOpenRegistry(row.conditions))}
            onOpenTestAnalytics={onOpenTestAnalytics && (() => onOpenTestAnalytics(row.conditions))}
            onCompare={onCompare && describable ? () => onCompare(row.conditions, row.name) : undefined}
            onEdit={saved ? (anchor: HTMLElement | null) => { editAnchorRef.current = anchor; setEditing(row); } : undefined}
            onSave={!saved && describable
              ? () => { setSaveError(null); setSaveName(row.name); setSaving(row); }
              : undefined}
            onExport={() => setExporting(exportFilterOf(row))}
          />
        );
      },
    },
  ];

  const rows = sortColumn
    ? slices.slice().sort((a, b) => compareSlices(a, b, sortColumn, sortDir))
    : slices;

  return (
    <>
      <DataGrid
        fill={fill}
        columns={columns}
        rows={rows}
        sortKey={sortColumn}
        sortDir={sortDir}
        onSort={(key, dir) => { setSortColumn(key as SliceSort); setSortDir(dir); }}
        rowKey={row => row.id}
        emptyMessage={loading
          ? "Считаем срезы…"
          : axis
            ? "Прохождений пока нет"
            // Э3.2: пустой список сохранённых обязан сказать, где срезы берут.
            : "Сохранённых срезов пока нет: отберите условия в фильтре теста и нажмите «Сохранить как срез»"}
        expandable
        // Разворачивать нечего там, где прохождений не было: раскрытие в пустоту читается как
        // поломка, а не как «данных нет».
        canExpand={row => row.completed > 0}
        onRowExpand={row => { void loadTopics(row); }}
        renderExpanded={row => {
          const rows = topics[row.id];
          if (rows === undefined || rows === null) {
            return <Text variant="body-s" tone="muted">Считаем темы…</Text>;
          }
          if (rows.length === 0) {
            return <Text variant="body-s" tone="muted">По темам считать нечего: ответов нет</Text>;
          }
          return (
            <DataGrid
              columns={[
                {
                  key: "topic",
                  header: "Тема",
                  render: (topic: SliceTopic) => topic.topicName,
                },
                {
                  key: "correct",
                  header: "Доля верных, % ответов",
                  align: "center" as const,
                  numeric: true,
                  render: (topic: SliceTopic) => (topic.correctShare === null
                    ? "—"
                    : `${percent(topic.correctShare)}`),
                },
                {
                  key: "sample",
                  header: "В выборке, прохождений",
                  align: "center" as const,
                  numeric: true,
                  render: (topic: SliceTopic) => topic.inSample,
                },
              ]}
              rows={rows}
              rowKey={topic => topic.topicId}
              emptyMessage="Тем нет"
            />
          );
        }}
      />

      {/* Правка условий — той же формой отбора, что в реестре и в сравнении (FR-07b): двух
          языков условий в продукте нет. */}
      <RegistryFilterPanel
        open={editing !== null}
        anchorRef={editAnchorRef}
        filter={conditionsToFilter(editing?.conditions ?? {})}
        hideTest
        scopeTestId={testId}
        onClose={() => setEditing(null)}
        onApply={next => { void applyEdit(next); }}
      />

      <ModalDialog
        open={saving !== null}
        onClose={() => setSaving(null)}
        size="s"
        title="Сохранить как срез"
        description="Срез хранит УСЛОВИЯ отбора одного теста и пересчитывается при каждом открытии: это не снимок состава участников"
        footer={
          <>
            <Button variant="ghost" size="m" onClick={() => setSaving(null)}>Отмена</Button>
            <Button
              variant="primary"
              size="m"
              disabled={!saveName.trim()}
              onClick={() => void saveAsSlice()}
            >
              Сохранить
            </Button>
          </>
        }
      >
        <Stack gap={3}>
          <label htmlFor="slice-row-name">
            <Text variant="body-s">Название среза</Text>
          </label>
          <Input
            id="slice-row-name"
            value={saveName}
            onChange={event => setSaveName(event.target.value)}
          />
          {saveError && <Text tone="error">{saveError}</Text>}
        </Stack>
      </ModalDialog>

      {/* Выгрузка отдаёт ТО, ЧТО В СТРОКЕ (FR-04): условия среза плюс рамка расчёта. */}
      <ExportDialog
        open={exporting !== null}
        onClose={() => setExporting(null)}
        filter={exporting ?? EMPTY_FILTER}
      />
    </>
  );
}
