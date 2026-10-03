/**
 * @module server/routes/analytics/slices
 * @description PRD-56 FR-06, FR-07: срезы прохождений.
 *
 * Срез хранит УСЛОВИЯ и пересчитывается при каждом открытии (FR-07d), поэтому ручка никогда не
 * отдаёт сохранённые числа: она считает их здесь и сейчас по наблюдениям.
 *
 * Над срезами стоит рамка расчёта — тест и период (FR-07i). Тест обязателен: средние законны
 * только внутри одного теста, у разных тестов разные пороги и шкалы (решение 2 спеки). Период
 * необязателен — пустой означает «за всё время» (FR-07j).
 *
 * Э3 (решение владельца 2026-10-03): срезы живут на уровне теста. Списки и сравнение берут
 * только срезы ЭТОГО теста, и каждая ручка среза проверяет область теста — как
 * `requireTestScope`, только тест приходит из запроса или из самого среза, а не из пути.
 */
import { Router, type Request, type Response } from "express";

import { config } from "../../config";
import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { storage } from "../../storage";
import {
  loadObservations,
  type ObservationFilter,
  type ObservationOutcome,
  type ObservationSource,
} from "../../services/analytics/observations";
import {
  NONE,
  registryConditions,
  splitByAxis,
  type AxisContext,
  type SliceAxis,
} from "../../services/analytics/slice-axis";
import { readAssigned } from "../../services/analytics/assigned-count";
import { summariseSlice } from "../../services/analytics/slice-stats";
import { readSliceTopics, weakestTopic } from "../../services/analytics/slice-topics";
import { analyticsScope } from "./helpers";
import { canReadTestAnalytics } from "../../services/test-access";

/**
 * Область теста для ручек срезов (Э3): тот же ответ, что у `requireTestScope("analytics")`.
 *
 * @returns `null`, если читать аналитику теста можно; иначе — код и тело отказа
 */
async function denyOutsideTest(
  req: Request,
  testId: string,
): Promise<{ status: number; error: string } | null> {
  const roles = req.effectiveRoles;
  const user = req.currentUser;
  if (!roles || !user) return { status: 401, error: "Unauthorized" };
  const test = await storage.getTest(testId);
  if (!test) return { status: 404, error: "Test not found" };
  return (await canReadTestAnalytics(roles, user.id, test)) ? null : { status: 403, error: "Forbidden" };
}

const router = Router();

/**
 * Оси разбиения (FR-06a). Оргструктура — организация, подразделение, должность — вошла в их
 * число, когда исключение FR-06b было отменено (2026-09-28).
 */
const AXES: readonly SliceAxis[] = [
  "group", "organization", "unit", "position",
  "period", "attempt", "version", "variant", "source", "external",
];

/** Оси оргструктуры: у них «назначено» считается по профилю назначенных (план, Р-7). */
const ORG_AXES = new Set<SliceAxis>(["organization", "unit", "position"]);

/**
 * Справочники для оси: членство в группах, их названия, номера версий и внешние участники.
 *
 * Читаются один раз на запрос и только когда ось запрошена: списку сохранённых срезов они не
 * нужны, а группы с пользователями — это столько запросов, сколько в инсталляции групп.
 */
async function axisContext(testId: string): Promise<AxisContext> {
  const [groups, snapshots, sections] = await Promise.all([
    storage.getGroups(),
    storage.getSnapshotsForTest(testId),
    storage.getTestSections(testId),
  ]);

  // Названия вариантов задаёт автор в наборе форм раздела (PRD-17); срез подписывается ими,
  // а не идентификатором формы — тот uuid и читателю не говорит ничего.
  const formLabels = new Map<string, string>();
  for (const section of sections) {
    for (const form of section.formSetJson?.forms ?? []) formLabels.set(form.id, form.label);
  }

  const groupsOfParticipant = new Map<string, string[]>();
  const externalParticipants = new Set<string>();
  await Promise.all(groups.map(async group => {
    for (const member of await storage.getGroupUsers(group.id)) {
      groupsOfParticipant.set(member.id, [...(groupsOfParticipant.get(member.id) ?? []), group.id]);
      if ((member as { isExternal?: boolean }).isExternal) externalParticipants.add(member.id);
    }
  }));

  return {
    groupsOfParticipant,
    groupNames: new Map(groups.map(group => [group.id, group.name])),
    externalParticipants,
    snapshotVersions: new Map(snapshots.map(snapshot => [snapshot.id, snapshot.version])),
    formLabels,
  };
}

/** Дата из параметра; конец периода — конец дня, «по 30 сентября» включает этот день. */
function dateOf(value: unknown, edge: "start" | "end"): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Условия среза, приведённые к отбору наблюдений.
 *
 * Все условия, которые умеет реестр: срез по варианту, версии или месяцу, у которого они
 * выпадали, молча считался как тест целиком — и сравнение показывало две одинаковые колонки.
 */
function conditionsOf(raw: unknown): ObservationFilter {
  const source = (raw ?? {}) as Record<string, unknown>;
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const from = dateOf(source.from, "start");
  const to = dateOf(source.to, "end");

  return {
    ...(list(source.groupIds).length ? { groupIds: list(source.groupIds) } : {}),
    ...(list(source.sources).length ? { sources: list(source.sources) as ObservationSource[] } : {}),
    ...(list(source.outcomes).length ? { outcomes: list(source.outcomes) as ObservationOutcome[] } : {}),
    ...(list(source.formIds).length ? { formIds: list(source.formIds) } : {}),
    ...(list(source.snapshotIds).length ? { snapshotIds: list(source.snapshotIds) } : {}),
    ...(list(source.organizations).length ? { organizations: list(source.organizations) } : {}),
    ...(list(source.units).length ? { units: list(source.units) } : {}),
    ...(list(source.positions).length ? { positions: list(source.positions) } : {}),
    ...(list(source.wrongQuestionIds).length ? { wrongQuestionIds: list(source.wrongQuestionIds) } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

/**
 * Отбор среза внутри рамки расчёта.
 *
 * Тест рамки перебивает тест среза (FR-07e). Период же ПЕРЕСЕКАЕТСЯ: срез «июль», открытый в
 * рамке «с 15 июля», — это вторая половина июля, а не весь июль и не всё с 15-го.
 */
function withinFrame(
  conditions: ObservationFilter,
  testId: string,
  from: Date | undefined,
  to: Date | undefined,
): ObservationFilter {
  const later = (a?: Date, b?: Date) => (a && b ? (a > b ? a : b) : a ?? b);
  const earlier = (a?: Date, b?: Date) => (a && b ? (a < b ? a : b) : a ?? b);
  const start = later(conditions.from, from);
  const end = earlier(conditions.to, to);
  const { from: _from, to: _to, ...rest } = conditions;
  return {
    ...rest,
    testIds: [testId],
    ...(start ? { from: start } : {}),
    ...(end ? { to: end } : {}),
  };
}

/**
 * Условия из параметра `conditions` (JSON на языке реестра); испорченные — как отсутствующие.
 *
 * Условия приезжают из адреса и могут быть испорчены при пересылке: экран аналитики не место
 * для разбора чужих ссылок, поэтому плохой JSON читается как «условий нет».
 */
function conditionsParam(value: unknown): Record<string, unknown> | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Группы, которыми описан срез, — основание считать ему «назначено» (FR-06).
 *
 * Пустой список значит «срез без условий», то есть тест целиком: назначено там всем, кому тест
 * назначен. `null` — срез описан условиями другого рода (источник, исход, период), и назначение
 * к нему не относится: звали человека, а не источник его прохождения.
 */
function groupIdsOf(raw: unknown): string[] | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const groupIds = Array.isArray(source.groupIds)
    ? source.groupIds.filter((item): item is string => typeof item === "string")
    : [];
  if (groupIds.length > 0) return groupIds;

  // Оргусловия тоже «другого рода» для этой величины: счёт по группам ничего о них не знает, и
  // срез «Розница + Отдел продаж» получил бы число всей Розницы.
  const hasOther = [
    "sources", "outcomes", "testIds", "formIds", "snapshotIds", "organizations", "units", "positions",
    "wrongQuestionIds",
  ].some(key =>
    Array.isArray(source[key]) && (source[key] as unknown[]).length > 0)
    || typeof source.from === "string"
    || typeof source.to === "string";
  return hasOther ? null : [];
}

/**
 * GET /api/analytics/filters — сохранённые ФИЛЬТРЫ реестра (решение владельца 2026-09-25).
 *
 * Отдельная ручка, а не параметр у `/slices`: та считает величины и требует теста, потому что
 * без него средние не имеют смысла. Фильтру считать нечего — он лишь набор условий, который
 * подставляется в реестр, и тестов в нём может быть сколько угодно.
 */
router.get("/filters", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const saved = await storage.getSlices(req.currentUser?.id ?? "", "filter");
    res.json({
      filters: saved.map(item => ({
        id: item.id,
        name: item.name,
        conditions: item.conditionsJson,
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    logger.error("List filters error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to list filters" });
  }
});

/**
 * GET /api/analytics/slices/saved?testId= — сохранённые срезы теста БЕЗ расчёта (Э3.2).
 *
 * Меню «Сохранённые» фильтра уровня теста подставляет условия среза в фильтр — считать для этого
 * величины каждого среза (как `GET /slices`) незачем: меню открывают, чтобы выбрать, а не сравнить.
 */
router.get("/slices/saved", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const testId = typeof req.query.testId === "string" ? req.query.testId.trim() : "";
    if (!testId) return res.status(400).json({ error: "Нужен тест: срезы живут на уровне теста" });
    const denied = await denyOutsideTest(req, testId);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    const saved = await storage.getSlices(req.currentUser?.id ?? "", "slice", testId);
    res.json({
      slices: saved.map(item => ({ id: item.id, name: item.name, conditions: item.conditionsJson })),
    });
  } catch (error) {
    logger.error("List saved slices error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to list slices" });
  }
});

// GET /api/analytics/slices — сохранённые срезы с посчитанными величинами
router.get("/slices", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const testId = typeof req.query.testId === "string" ? req.query.testId.trim() : "";
    if (!testId) {
      // Не «посчитаем по всем тестам»: среднее поверх разных порогов и шкал — то самое
      // неинтерпретируемое число, ради снятия которого затеян PRD-56.
      return res.status(400).json({ error: "Нужен тест: средние считаются внутри одного теста" });
    }
    const denied = await denyOutsideTest(req, testId);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    const scope = await analyticsScope(req);
    const ownerId = req.currentUser?.id ?? "";
    const from = dateOf(req.query.from, "start");
    const to = dateOf(req.query.to, "end");
    const minObservations = config.analytics.minObservations;

    const axis = typeof req.query.axis === "string" ? req.query.axis.trim() : "";
    if (axis && !AXES.includes(axis as SliceAxis)) {
      // Молча отдать вместо разбиения сохранённые срезы — значит ответить не на тот вопрос.
      // Ось, которой нет (например «должность»), — это отсутствующие данные, а не опечатка.
      return res.status(400).json({ error: `Неизвестная ось разбиения: ${axis}` });
    }

    if (axis) {
      // Э3.2: разбивка стоит на «Обзоре» теста и подчиняется его фильтру — условия уровня теста
      // приходят параметром `conditions` и сужают выборку, которую режет ось.
      const { rows } = await loadObservations(
        withinFrame(conditionsOf(conditionsParam(req.query.conditions) ?? {}), testId, from, to),
        scope,
      );
      const buckets = splitByAxis(rows, axis as SliceAxis, await axisContext(testId));
      // Слабейшая тема названа в FR-06 наравне с объёмами, поэтому считается для ВСЕХ строк
      // сразу. Платы за это столько же, сколько за один разворот: ответы теста собираются
      // единожды, а срез — подмножество тех же фактов.
      const topics = await readSliceTopics(testId, rows);
      // «Назначено» определено у осей, которые описывают ЛЮДЕЙ: группа, признак внешнего
      // участника и оргструктура. По остальным срез описывает попытку, а назначают человека.
      const assigned = await readAssigned(
        testId,
        axis === "group" ? buckets.map(bucket => bucket.key) : [],
      );
      /** Сколько назначено этому срезу; `null` — величина к оси неприменима. */
      const assignedOf = (key: string): number | null => {
        // «Без группы» — не группа: её участники известны только по своим прохождениям, а
        // назначенных без единой попытки в такой строке взять неоткуда.
        if (axis === "group") return key === NONE ? null : assigned.countFor([key]);
        if (axis === "external") return assigned.countByKind(key === "external");
        // Оргструктура — по профилю назначенных (Р-7): отдел известен и у тех, кто не начинал.
        if (ORG_AXES.has(axis as SliceAxis)) {
          return assigned.countByOrg(axis as "organization" | "unit" | "position", key === NONE ? null : key);
        }
        return null;
      };

      return res.json({
        axis,
        slices: buckets.map(bucket => ({
          id: `${axis}:${bucket.key}`,
          name: bucket.label,
          // FR-08: условия на языке реестра, чтобы из строки был переход к прохождениям.
          // Перевод делается здесь, где разбиение известно: иначе оси пришлось бы описывать
          // второй раз на клиенте, и два описания однажды разошлись бы.
          conditions: registryConditions(axis as SliceAxis, bucket.key),
          ...summariseSlice({ observations: bucket.observations, minObservations }),
          assigned: assignedOf(bucket.key),
          weakest: weakestTopic(
            topics.topicsOf(new Set(bucket.observations.map(o => o.id))),
            minObservations,
          ),
        })),
        minObservations,
      });
    }

    // Э3: только срезы этого теста — чужие в сравнении теста считались бы не по своей рамке.
    const saved = await storage.getSlices(ownerId, "slice", testId);

    /**
     * Срез «тест целиком» — обычный срез БЕЗ условий (FR-07a).
     *
     * Отдельной сущности «эталон» в продукте не заводится: сравнение с тестом целиком
     * делается тем же механизмом, что сравнение двух групп. Иначе у эталона завелись бы свои
     * правила, и однажды он стал бы считаться не так, как всё остальное.
     */
    const withWhole = req.query.withWhole === "1" || req.query.withWhole === "true";

    /**
     * Отбор, набранный ПРЯМО СЕЙЧАС, — временный срез наравне с сохранёнными (FR-07b).
     *
     * Сравнение не должно требовать сохранения: «сравни то, что я отобрал, с Розницей» —
     * обычный вопрос, а заставлять ради него придумывать имя и заводить строку в списке
     * значит копить мусор из срезов, нужных на одну минуту.
     */
    const adhoc = conditionsParam(req.query.conditions);

    // Временный срез из строки списка несёт своё имя («Розница»); отбор из реестра имени не
    // имеет и остаётся «Текущим отбором». Длина ограничена: имя приезжает из адреса.
    const adhocName = typeof req.query.conditionsName === "string"
      ? req.query.conditionsName.trim().slice(0, 200)
      : "";

    const sources = [
      ...(adhoc ? [{ id: "adhoc", name: adhocName || "Текущий отбор", conditionsJson: adhoc }] : []),
      ...(withWhole
        ? [{ id: "whole", name: "Тест целиком", conditionsJson: {} as Record<string, unknown> }]
        : []),
      ...saved,
    ];

    // Один сбор ответов на все сохранённые срезы: каждый из них — подмножество прохождений
    // одной и той же рамки, и разбирать ответы заново на каждый значило бы платить за то же
    // самое столько раз, сколько срезов сохранил пользователь.
    const frameRows = (await loadObservations(
      { testIds: [testId], ...(from ? { from } : {}), ...(to ? { to } : {}) },
      scope,
    )).rows;
    const topics = await readSliceTopics(testId, frameRows);
    // Группы, которыми описаны сохранённые срезы: по ним и считается «назначено». Срез с
    // условием другого рода (источник, исход, период) к назначениям отношения не имеет.
    const assigned = await readAssigned(
      testId,
      sources.flatMap(slice => groupIdsOf(slice.conditionsJson) ?? []),
    );

    const slices = await Promise.all(sources.map(async slice => {
      // Тест рамки перебивает тест среза (FR-07e): он общий для всех сравниваемых срезов и в
      // их собственные условия не входит.
      const { rows } = await loadObservations(
        withinFrame(conditionsOf(slice.conditionsJson), testId, from, to),
        scope,
      );

      // Темы среза считаются один раз и служат двум ответам: слабейшему месту в списке
      // (FR-06) и сопоставлению долей верных в режиме сравнения (FR-07).
      const ofSlice = topics.topicsOf(new Set(rows.map(row => row.id)));
      return {
        id: slice.id,
        name: slice.name,
        conditions: slice.conditionsJson,
        ...summariseSlice({ observations: rows, minObservations }),
        assigned: assigned.countFor(groupIdsOf(slice.conditionsJson)),
        weakest: weakestTopic(ofSlice, minObservations),
        topics: ofSlice,
      };
    }));

    res.json({ slices, minObservations });
  } catch (error) {
    logger.error("Slices analytics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to load slices" });
  }
});

/**
 * GET /api/analytics/slices/topics — разворот строки среза по темам (FR-06e).
 *
 * Отвечает на «в какой теме провал У ЭТОГО среза» и ни с чем не сравнивает: за сравнением ведёт
 * отдельный режим вкладки. Поэтому в строке только доля верных и объём выборки — ни разницы, ни
 * базы, ни порога.
 *
 * Срез задаётся ОСЬЮ и ключом либо идентификатором сохранённого среза, а не условиями реестра:
 * условия покрывают не всякую ось (номер попытки, внешний участник), и по ним срез не
 * восстановить. Тест и период приходят из рамки расчёта — те же, что у списка срезов.
 *
 * Считается по требованию, при развороте: платить за темы ВСЕХ срезов при каждом показе списка
 * незачем, а развернут за раз один.
 */
router.get("/slices/topics", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const testId = typeof req.query.testId === "string" ? req.query.testId.trim() : "";
    if (!testId) {
      return res.status(400).json({ error: "Нужен тест: средние считаются внутри одного теста" });
    }

    const axis = typeof req.query.axis === "string" ? req.query.axis.trim() : "";
    const key = typeof req.query.key === "string" ? req.query.key : "";
    const sliceId = typeof req.query.sliceId === "string" ? req.query.sliceId.trim() : "";
    if (!axis && !sliceId) {
      return res.status(400).json({ error: "Нужен срез: ось с ключом либо сохранённый срез" });
    }
    if (axis && !AXES.includes(axis as SliceAxis)) {
      return res.status(400).json({ error: `Неизвестная ось разбиения: ${axis}` });
    }
    const denied = await denyOutsideTest(req, testId);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    const scope = await analyticsScope(req);
    const from = dateOf(req.query.from, "start");
    const to = dateOf(req.query.to, "end");
    // Э3.2: разворот строки разбивки считается в той же выборке, что сама строка, — с условиями
    // уровня теста.
    const frame = withinFrame(conditionsOf(conditionsParam(req.query.conditions) ?? {}), testId, from, to);

    /** Прохождения ЭТОГО среза: разбиением по оси либо условиями сохранённого среза. */
    let observations;
    if (axis) {
      const { rows } = await loadObservations(frame, scope);
      const buckets = splitByAxis(rows, axis as SliceAxis, await axisContext(testId));
      observations = buckets.find(bucket => bucket.key === key)?.observations ?? [];
    } else {
      // «Тест целиком» — срез без условий (FR-07a), отдельной сущности для него не заводится.
      const saved = sliceId === "whole"
        ? { conditionsJson: {} as Record<string, unknown> }
        : (await storage.getSlices(req.currentUser?.id ?? "", "slice", testId)).find(s => s.id === sliceId);
      if (!saved) return res.status(404).json({ error: "Срез не найден" });
      const { rows } = await loadObservations(
        withinFrame(conditionsOf(saved.conditionsJson), testId, from, to),
        scope,
      );
      observations = rows;
    }

    if (observations.length === 0) return res.json({ topics: [] });

    // Ответы теста собираются ОДНИМ общим сбором и режутся прохождениями среза: свой разбор
    // ответов здесь означал бы второй источник правды о том, что такое «верно».
    const reader = await readSliceTopics(testId, observations);

    res.json({
      // Только то, о чём спрашивает FR-06e: доля верных этого среза по темам и объём выборки.
      topics: reader.topicsOf(new Set(observations.map(o => o.id))),
    });
  } catch (error) {
    logger.error("Slice topics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to load slice topics" });
  }
});

// POST /api/analytics/slices — сохранить текущий отбор как срез (FR-07c)
router.post("/slices", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const conditions = (body.conditions ?? {}) as Record<string, unknown>;
    const kind = body.kind === "filter" ? "filter" : "slice";
    const testIds = Array.isArray(conditions.testIds)
      ? (conditions.testIds as unknown[]).filter((id): id is string => typeof id === "string" && !!id.trim())
      : [];

    if (!name) {
      // Безымянная запись неотличима в списке от соседней: выбор между ними становится
      // случайным, а сохранять то, что нельзя потом найти, незачем.
      return res.status(400).json({ error: kind === "filter" ? "Нужно имя фильтра" : "Нужно имя среза" });
    }

    // СРЕЗ — ЭТО ВЫБОРКА ОДНОГО ТЕСТА (решение владельца 2026-09-25).
    //
    // Средние, пороги и сравнение поверх нескольких тестов не значат ничего: у каждого теста
    // свой проходной балл и свои шкалы (FR-07e). Раньше срез с двумя тестами сохранялся, молча
    // забирая ПЕРВЫЙ из них, — выборка, которую автор потом сравнивал, была не той, что он
    // отобрал. Сохранённый ФИЛЬТР этого ограничения не несёт: он отвечает на другой вопрос.
    if (kind === "slice" && testIds.length !== 1) {
      return res.status(400).json({
        error: testIds.length === 0
          ? "Срез считается внутри одного теста: добавьте условие по тесту"
          : "В выборке несколько тестов: срез считается внутри одного. Сохраните её как фильтр",
      });
    }
    const testId = kind === "slice" ? testIds[0] : null;
    if (testId) {
      // Э3: сохранить срез теста может тот, кому видна аналитика этого теста.
      const denied = await denyOutsideTest(req, testId);
      if (denied) return res.status(denied.status).json({ error: denied.error });
    }

    const hasConditions = Object.values(conditions).some(value =>
      Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "");
    if (!hasConditions) {
      // Срез без условий — это весь тест; он и так доступен как «Тест целиком» (FR-07a).
      return res.status(400).json({ error: "Нужно хотя бы одно условие отбора" });
    }

    const slice = await storage.createSlice({
      name,
      kind,
      testId,
      conditionsJson: conditions,
      createdBy: req.currentUser?.id ?? "",
    });

    res.status(201).json({ slice });
  } catch (error) {
    // Уникальность имени стережёт индекс: сюда его нарушение приходит ошибкой базы, и
    // читателю надо сказать по-человечески, а не «23505».
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "Запись с таким именем уже есть" });
    }
    logger.error("Save slice error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to save slice" });
  }
});

/**
 * PUT /api/analytics/slices/:id — поправить имя и условия среза (FR-07b).
 *
 * Без правки срез приходилось пересобирать заново: уйти в реестр, набрать условия, сохранить
 * под новым именем, вернуться в сравнение. Имя при этом плодилось («Розница 2»), а старый
 * срез оставался в списке мусором.
 *
 * Правка меняет и то, что срез ПОКАЗЫВАЕТ: он хранит условия, а не список прохождений
 * (FR-07d), и пересчитывается при каждом открытии — это его свойство, а не следствие правки.
 */
router.put("/slices/:id", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: { name?: string; conditionsJson?: Record<string, unknown> } = {};

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return res.status(400).json({ error: "Нужно имя среза" });
      patch.name = name;
    }

    if (body.conditions !== undefined) {
      const conditions = (body.conditions ?? {}) as Record<string, unknown>;
      const hasConditions = Object.values(conditions).some(value =>
        Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "");
      if (!hasConditions) {
        // Тот же запрет, что при сохранении: срез без условий — это весь тест, и он уже есть
        // отдельной строкой «Тест целиком».
        return res.status(400).json({ error: "Нужно хотя бы одно условие отбора" });
      }
      patch.conditionsJson = conditions;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "Нечего менять" });
    }

    // Э3: срез теста правит тот, кому видна аналитика теста. Чужой и несуществующий отвечают
    // одинаково — ниже, запросом с владельцем.
    const existing = await storage.getSlice(req.params.id, req.currentUser?.id ?? "");
    if (existing?.testId) {
      const denied = await denyOutsideTest(req, existing.testId);
      if (denied) return res.status(denied.status).json({ error: denied.error });
    }

    // Владелец проверяется запросом: чужой срез не найдётся, и это тот же ответ, что у
    // несуществующего, — знать о чужих срезах читателю незачем.
    const slice = await storage.updateSlice(req.params.id, req.currentUser?.id ?? "", patch);
    if (!slice) return res.status(404).json({ error: "Срез не найден" });

    res.json({ slice });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "Срез с таким именем уже есть" });
    }
    logger.error("Update slice error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update slice" });
  }
});

export default router;
