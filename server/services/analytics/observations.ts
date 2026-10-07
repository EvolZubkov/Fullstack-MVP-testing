/**
 * @module server/services/analytics/observations
 * @description PRD-56 FR-33: один слой наблюдений для обеих страниц аналитики.
 *
 * До этого каждая ручка сама читала таблицу и сама решала, что считать прохождением: раздел
 * «Аналитика» складывал веб-попытки с телеметрией и импортом, а страница теста видела только
 * веб — из-за чего два экрана отвечали на один вопрос разными числами (раздел 1.1 спеки).
 * Здесь строка любого источника приводится к ОДНОЙ форме, и дальше её происхождение перестаёт
 * влиять на расчёт: источник остаётся признаком для фильтра, а не развилкой в коде.
 *
 * Отбор и порция считаются запросом в DAL (`storage.selectObservations`); здесь живут правила
 * оценивания — что считать результатом, вердиктом и исходом.
 */

import { hasPronouncedVerdict, nothingToGrade } from "@shared/scoring/pass-rule";
import { ORG_FIELDS, normalizeOrgValue, orgValueKey, type OrgField } from "@shared/org-fields";

import { storage } from "../../storage";
import type { ObservationSort } from "../../storage/analytics-repository";
import { attemptParticipant, attemptTestId } from "./attempt-row";
import { loadTestAnswerFacts } from "./test-answer-facts";

/** Откуда приехало прохождение. Фильтр экрана говорит ровно в этих терминах. */
export type ObservationSource = "web" | "telemetry" | "import";

/**
 * Исход прохождения.
 *
 * `completed` — не «сдал наполовину», а прохождение БЕЗ вердикта: опросник ничего не оценивает,
 * и «не сдал» было бы про него ложью (PRD-29 §6.7). `incomplete` — попытка, которую не довели
 * до конца: у неё нет ни результата, ни исхода.
 */
export type ObservationOutcome = "passed" | "failed" | "completed" | "incomplete";

/** Одно прохождение, как его видит аналитика, независимо от источника. */
export interface Observation {
  id: string;
  source: ObservationSource;
  testId: string | null;
  userId: string | null;
  /** Подпись участника: имя, имя из LMS или псевдоним (PRD-54 раздел 12). */
  participant: string;
  participantKey: string | null;
  /**
   * Чем опознаётся участник: пользователь, псевдоним импорта или идентификатор из LMS.
   * По нему считаются уникальные участники — иначе телеметрия без связи и без псевдонима
   * выглядела бы как ноль людей.
   */
  participantId: string | null;
  /** Группа, проставленная импортом. Членство пользователя в группах разрешается отдельно. */
  groupId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  /** Длительность прохождения; `null`, пока попытка не завершена. */
  durationMs: number | null;
  /** Результат в процентах; `null`, когда оценивать было нечего. */
  percent: number | null;
  /** Вердикт; `null`, когда его никто не выносил. */
  passed: boolean | null;
  /** Набранные и достижимые баллы; `null`, когда оценивать было нечего. */
  earnedPoints: number | null;
  possiblePoints: number | null;
  outcome: ObservationOutcome;
  /**
   * Адаптивное прохождение (PRD-16): его результат — достигнутый уровень, а не доля верных.
   * Усреднять такой процент вместе с обычными значит складывать разные величины.
   */
  adaptive: boolean;
  /** Версия публикации (PRD-15) — разрез вкладки «Выдача». */
  snapshotId: string | null;
  /**
   * Выданные варианты (PRD-17) картой «тема -> вариант».
   *
   * Карта, а не одна строка: вариант — свойство РАЗДЕЛА (`variant_json.sections[].formId`), и
   * у теста с двумя наборами форм прохождению принадлежат два варианта. Раньше здесь читалось
   * поле `variant_json.formId` верхнего уровня, которого в схеме варианта нет вовсе, — оттого
   * ось «вариант» среза отвечала «Без варианта» на всё.
   */
  forms: Record<string, string>;
  /**
   * Номер попытки, который СООБЩИЛ пакет в выгрузке (`meta_attempt`, PRD-54 решение 13); только у
   * импорта. Из регистрации SCO в LMS уходит одна попытка, и самая ранняя строка участника может
   * оказаться его третьей попыткой — порядок по времени тут лжёт. `null`/нет — не сообщён.
   */
  reportedAttempt?: number | null;
  /**
   * Оргструктура участника (PRD-56 FR-06b, OQ-04): значение самого прохождения, иначе профиль
   * связанного пользователя. Веб своих значений не пишет — у него всегда профиль, и значит
   * ТЕКУЩИЙ: переведённый человек переезжает в новый отдел вместе со всеми попытками. У импорта
   * значение — на момент прохождения. `null` — нет ни того, ни другого.
   */
  organization: string | null;
  unit: string | null;
  position: string | null;
}

/** Что аналитика берёт из профиля участника. */
export interface ObservationUser {
  name: string | null;
  organization?: string | null;
  unit?: string | null;
  position?: string | null;
}

/** Справочники, общие для всех строк одного запроса. */
export interface ObservationContext {
  users: ReadonlyMap<string, ObservationUser>;
  /** Тест объявляет проходной балл (`declaresPassThreshold`). */
  gradedTest: boolean | undefined;
}

export interface LmsObservationContext extends ObservationContext {
  /** Пакеты — запасной путь к тесту у старых строк телеметрии. */
  packages: ReadonlyMap<string, { testId: string | null }>;
}

interface WebAttemptRow {
  id: string;
  userId: string;
  testId: string;
  snapshotId?: string | null;
  variantJson?: unknown;
  resultJson?: unknown;
  startedAt: Date;
  finishedAt: Date | null;
}

interface LmsAttemptRow {
  totalPoints?: number | null;
  lmsUserId?: string | null;
  id: string;
  packageId: string | null;
  testId: string | null;
  origin: "telemetry" | "import";
  userId: string | null;
  participantKey: string | null;
  groupId: string | null;
  lmsUserName: string | null;
  resultPercent: number | null;
  resultPassed: boolean | null;
  maxPoints: number | null;
  startedAt: Date;
  finishedAt: Date | null;
  /** Номер попытки: у импорта — из `meta_attempt` (1, если не сообщён), у телеметрии — свой. */
  attemptNumber?: number | null;
  /** PRD-56 FR-19a: версия публикации и выданные варианты, сообщённые пакетом. */
  snapshotId?: string | null;
  formsJson?: Record<string, string> | null;
  /** Оргструктура из LMS: организация — у телеметрии и необезличенного импорта, остальное — у импорта. */
  lmsUserOrg?: string | null;
  lmsUserUnit?: string | null;
  lmsUserPosition?: string | null;
}

/**
 * Оргполя прохождения: своё значение, иначе профиль (OQ-04), по каждому полю отдельно.
 *
 * Поле за полем, а не «всё или ничего»: обезличенный импорт несёт подразделение и должность,
 * но не организацию (PRD-54), и организация тогда честно приходит из профиля.
 */
function orgOf(
  own: { organization?: string | null; unit?: string | null; position?: string | null },
  profile: ObservationUser | undefined,
): Pick<Observation, "organization" | "unit" | "position"> {
  return {
    organization: normalizeOrgValue(own.organization) ?? normalizeOrgValue(profile?.organization),
    unit: normalizeOrgValue(own.unit) ?? normalizeOrgValue(profile?.unit),
    position: normalizeOrgValue(own.position) ?? normalizeOrgValue(profile?.position),
  };
}

/**
 * Достижимые баллы прохождения, если они записаны.
 *
 * `undefined` — «поля нет», и это не то же самое, что записанный ноль: ноль означает, что
 * оценивать было нечего (PRD-29 §6.7), а отсутствие поля — что запись старая либо источник
 * баллов не сообщает.
 */
function possiblePointsOf(result: unknown): number | undefined {
  const value = (result as { totalPossiblePoints?: unknown } | null)?.totalPossiblePoints;
  return typeof value === "number" ? value : undefined;
}

/**
 * Единицы оценивания прохождения: достижимые баллы, а где их не записали — сам факт
 * посчитанного процента. У теста без проходного балла не считается ни то, ни другое.
 *
 * @param possiblePoints достижимые баллы из строки
 * @param percent посчитанный процент, если он есть
 * @param gradedTest объявляет ли тест проходной балл
 */
function gradedUnits(
  possiblePoints: number | null | undefined,
  percent: number | null | undefined,
  gradedTest: boolean | undefined,
): number {
  // Записанные баллы — прямой ответ, включая ноль: он и означает «оценивать было нечего».
  if (possiblePoints !== null && possiblePoints !== undefined) return possiblePoints;
  if (gradedTest === false) return 0;
  return percent !== null && percent !== undefined ? 1 : 0;
}

/**
 * Выданные варианты веб-попытки картой «тема -> вариант».
 *
 * Пин лежит ПОСЕКЦИОННО (`variant_json.sections[].formId`, PRD-17 BR-12) — именно так его
 * пишет старт попытки. Раздел без вариантов ключа не добавляет: пустая карта означает, что
 * вариантов не было, а не что их не нашли.
 */
function formsOfVariant(variantJson: unknown): Record<string, string> {
  const sections = (variantJson as { sections?: Array<{ topicId?: string; formId?: string }> } | null)
    ?.sections ?? [];

  const out: Record<string, string> = {};
  for (const section of sections) {
    if (section?.topicId && section.formId) out[section.topicId] = section.formId;
  }
  return out;
}

/** Исход по завершённости и вердикту — единственное место, где он выводится. */
function outcomeOf(finished: boolean, passed: boolean | null): ObservationOutcome {
  if (!finished) return "incomplete";
  if (passed === null) return "completed";
  return passed ? "passed" : "failed";
}

function durationOf(startedAt: Date, finishedAt: Date | null): number | null {
  return finishedAt ? finishedAt.getTime() - startedAt.getTime() : null;
}

export const toObservation = {
  /** Веб-попытка (`attempts`). */
  web(row: WebAttemptRow, ctx: ObservationContext): Observation {
    const result = row.resultJson as {
      overallPercent?: number;
      overallPassed?: boolean;
      totalEarnedPoints?: number;
      mode?: string;
    } | null;
    // Прохождение состоялось, если посчитан результат, даже когда отметка завершения не
    // проставлена: такие строки в базе есть, и терять их в «не завершено» — занижать выборку.
    const finished = row.finishedAt !== null || result !== null && result !== undefined;
    const possiblePoints = possiblePointsOf(result);
    // Процент — такой же признак оценивания, как баллы: часть записей не несёт
    // `totalPossiblePoints`, и требовать их значило бы выкинуть их результат из средних.
    // Но у теста без проходного балла ноль процентов не результат, а отсутствие оценивания
    // (PRD-29 §6.7), поэтому признак теста перевешивает содержимое строки.
    // Адаптивное прохождение судят подтверждённые уровни, а не доля баллов: вердикт у него
    // есть всегда, хотя процента может не быть вовсе (то же правило, что в `gradingOf`).
    const adaptive = result?.mode === "adaptive";
    const gradedPoints = gradedUnits(possiblePoints, result?.overallPercent, ctx.gradedTest);
    const scored = finished && (adaptive || !nothingToGrade(gradedPoints));
    const pronounced = finished && (adaptive || hasPronouncedVerdict(ctx.gradedTest, gradedPoints));
    const passed = pronounced ? result?.overallPassed ?? null : null;

    return {
      id: row.id,
      source: "web",
      testId: row.testId,
      userId: row.userId,
      participant: attemptParticipant(
        { userId: row.userId, participantKey: null, lmsUserName: null },
        ctx.users,
      ),
      participantKey: null,
      participantId: row.userId,
      groupId: null,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: durationOf(row.startedAt, row.finishedAt),
      percent: scored ? result?.overallPercent ?? null : null,
      passed,
      earnedPoints: scored ? result?.totalEarnedPoints ?? null : null,
      possiblePoints: scored ? possiblePointsOf(result) ?? null : null,
      outcome: outcomeOf(finished, passed),
      adaptive,
      snapshotId: row.snapshotId ?? null,
      forms: formsOfVariant(row.variantJson),
      ...orgOf({}, ctx.users.get(row.userId)),
    };
  },

  /** Прохождение из LMS: живая телеметрия или импортированная выгрузка (`scorm_attempts`). */
  lms(row: LmsAttemptRow, ctx: LmsObservationContext): Observation {
    // Телеметрия заводит строку при СТАРТЕ и обновляет по ходу, поэтому нули результата у
    // неё ничего не значат: признак завершения у этого источника один — отметка времени.
    const finished = row.finishedAt !== null && row.finishedAt !== undefined;
    // То же правило, что у веба: телеметрия не всегда сообщает `max_points`, и процент
    // остаётся признаком того, что оценивание было.
    const possiblePoints = gradedUnits(row.maxPoints, row.resultPercent, ctx.gradedTest);
    const scored = finished && !nothingToGrade(possiblePoints);
    const pronounced = finished && hasPronouncedVerdict(ctx.gradedTest, possiblePoints);
    const passed = pronounced ? row.resultPassed ?? null : null;

    return {
      id: row.id,
      source: row.origin,
      testId: attemptTestId(row, ctx.packages),
      userId: row.userId,
      participant: attemptParticipant(row, ctx.users),
      participantKey: row.participantKey,
      participantId: row.userId ?? row.participantKey ?? row.lmsUserId ?? null,
      groupId: row.groupId,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: durationOf(row.startedAt, row.finishedAt),
      percent: scored ? row.resultPercent ?? null : null,
      passed,
      earnedPoints: scored ? row.totalPoints ?? null : null,
      possiblePoints: scored ? possiblePoints : null,
      outcome: outcomeOf(finished, passed),
      // Режим прохождения телеметрия не сообщает: адаптивные разрезы считаются по вебу.
      adaptive: false,
      // PRD-56 FR-19a: версия и варианты приезжают из пакета — телеметрией со стартом попытки
      // и служебными блоками выгрузки. Пусто у пакетов, собранных до этой работы: такое
      // прохождение идёт в разрез «версия не указана», а не приписывается текущей версии.
      snapshotId: row.snapshotId ?? null,
      forms: row.formsJson ?? {},
      // Номер телеметрии нумерует попытки внутри сессии пакета, и все её попытки приходят
      // строками — порядок по времени у неё верен. Верить номеру стоит только у импорта.
      reportedAttempt: row.origin === "import" ? row.attemptNumber ?? null : null,
      ...orgOf(
        { organization: row.lmsUserOrg, unit: row.lmsUserUnit, position: row.lmsUserPosition },
        row.userId ? ctx.users.get(row.userId) : undefined,
      ),
    };
  },
};

/** Условия отбора прохождений. Пустой объект — всё, что доступно читателю. */
export interface ObservationFilter {
  testIds?: string[];
  groupIds?: string[];
  sources?: ObservationSource[];
  outcomes?: ObservationOutcome[];
  /** Варианты выдачи (PRD-17 `formId`): условие осмысленно внутри одного теста. */
  formIds?: string[];
  /** Версии публикации (`snapshot_id`): тоже условие внутри одного теста. */
  snapshotIds?: string[];
  /**
   * Оргструктура (FR-06b): значения в любом написании — «отдел продаж» отбирает и «Отдел
   * продаж» профиля, и «ОТДЕЛ ПРОДАЖ» выгрузки (правило `shared/org-fields`).
   */
  organizations?: string[];
  units?: string[];
  positions?: string[];
  /**
   * PRD-56 FR-17: прохождения, где ОШИБЛИСЬ на одном из этих вопросов.
   *
   * Условие внутри теста: верность ответа задают правила оценивания теста, и без теста в
   * условиях ни одно прохождение не подходит. Измерительный ответ (`neutral`) ошибкой не
   * считается — у него нет верного варианта.
   */
  wrongQuestionIds?: string[];
  /** Период по дате НАЧАЛА прохождения. */
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  /** Чем упорядочить выборку (FR-01a): столбец реестра и направление. */
  sort?: ObservationSort;
  dir?: "asc" | "desc";
}

/**
 * Область видимости читателя — прямой ответ `readableTestScope`.
 *
 * Именно множество, а не предикат: область обязана попасть В УСЛОВИЕ запроса, иначе лимит
 * отсчитается до отсечения недоступных тестов и порция вернёт меньше строк, чем обещала.
 */
export interface ObservationScope {
  all: boolean;
  ids: ReadonlySet<string>;
}

export interface ObservationPage {
  rows: Observation[];
  /** Сколько прохождений подошло под условия — независимо от лимита. */
  total: number;
}

/**
 * Прохождения по условиям — из обоих источников, одним списком.
 *
 * Отбор, сортировка и порция считаются ЗАПРОСОМ: реестр подгружается при прокрутке (FR-01c),
 * и порядок обязан быть устойчивым, поэтому сортировка идёт по дате начала и по идентификатору
 * — у прохождений одной секунды иначе нет определённого порядка.
 *
 * Область видимости (FR-35) попадает в условие, а не отсекает строки после лимита.
 */
export async function loadObservations(
  filter: ObservationFilter,
  scope: ObservationScope,
): Promise<ObservationPage> {
  const testIds = filter.testIds?.length ? filter.testIds : undefined;

  // Пересечение «что просили» и «что доступно» (FR-35). Пустой список означает, что доступного
  // нет вовсе, и выборка обязана вернуть ноль строк, а не всё подряд.
  const allowed = scope.all
    ? testIds
    : (testIds ?? [...scope.ids]).filter(id => scope.ids.has(id));

  const orgValues = await orgSpellingsOf(filter);
  const attemptIds = filter.wrongQuestionIds?.length
    ? await attemptsWrongOn(allowed ?? [], filter.wrongQuestionIds)
    : undefined;

  const { web, lms, order, total } = await storage.selectObservations({
    testIds: allowed,
    groupIds: filter.groupIds,
    sources: filter.sources,
    outcomes: filter.outcomes,
    formIds: filter.formIds,
    snapshotIds: filter.snapshotIds,
    ...(orgValues ? { orgValues } : {}),
    ...(attemptIds ? { attemptIds } : {}),
    from: filter.from,
    to: filter.to,
    limit: filter.limit,
    offset: filter.offset,
    sort: filter.sort,
    dir: filter.dir,
    impossible: !scope.all && (allowed?.length ?? 0) === 0,
  });

  const rows = await normalise(web, lms);
  const byId = new Map(rows.map(o => [o.id, o]));
  return {
    rows: order.map(k => byId.get(k.id)).filter((o): o is Observation => !!o),
    total,
  };
}

/**
 * Прохождения тестов отбора, где ошиблись хотя бы на одном из вопросов, — по идентификаторам.
 *
 * Считается сбором ответов теста (`loadTestAnswerFacts`), а не запросом: верность веб-ответа в
 * базе не хранится, её определяют правила оценивания, и второй их экземпляр в SQL разошёлся бы
 * с долей верных в таблице вопросов. Веб-попытки берутся завершёнными — так же их читает
 * таблица вопросов, и число строк реестра совпадает с числом ошибок в ней.
 *
 * @param testIds тесты, внутри которых действует условие; пусто — ни одно прохождение не подходит
 * @param questionIds вопросы условия
 * @returns идентификаторы веб-попыток и строк LMS вперемешку
 */
async function attemptsWrongOn(testIds: string[], questionIds: string[]): Promise<string[]> {
  const wanted = new Set(questionIds);
  const out = new Set<string>();
  for (const testId of testIds) {
    const { web } = await storage.selectObservations({ testIds: [testId], sources: ["web"] });
    const completed = web.filter(attempt => attempt.resultJson !== null);
    const { facts } = await loadTestAnswerFacts(testId, completed);
    for (const fact of facts) {
      if (fact.result === "incorrect" && wanted.has(fact.questionId) && fact.attemptId) {
        out.add(fact.attemptId);
      }
    }
  }
  return [...out];
}

/** Условие отбора фильтра для каждого оргполя. */
const ORG_FILTER_KEYS: Record<OrgField, "organizations" | "units" | "positions"> = {
  organization: "organizations",
  unit: "units",
  position: "positions",
};

/**
 * Оргусловия отбора, переведённые в ТОЧНЫЕ хранящиеся написания.
 *
 * Сравнение по правилу `shared/org-fields` делается здесь, а запрос сравнивает строки как
 * есть. Так отбор совпадает с тем, что показывают фильтры и оси, и не зависит от локали базы.
 * Выбранное значение, которого нет ни у кого, даёт пустой список — «ноль строк», а не снятое
 * условие.
 *
 * @returns `undefined`, когда оргусловий в фильтре нет вовсе.
 */
async function orgSpellingsOf(
  filter: ObservationFilter,
): Promise<Partial<Record<OrgField, string[]>> | undefined> {
  const wanted = ORG_FIELDS.filter(field => filter[ORG_FILTER_KEYS[field]]?.length);
  if (wanted.length === 0) return undefined;

  const stored = await storage.selectOrgSpellings();
  const out: Partial<Record<OrgField, string[]>> = {};
  for (const field of wanted) {
    const keys = new Set(filter[ORG_FILTER_KEYS[field]]!.map(orgValueKey).filter((k): k is string => !!k));
    out[field] = stored[field].filter(spelling => {
      const key = orgValueKey(spelling);
      return key !== null && keys.has(key);
    });
  }
  return out;
}

/** Привести выбранные строки к наблюдениям, дочитав справочники теста и участников. */
async function normalise(
  web: Array<Parameters<typeof toObservation.web>[0] & { testId: string }>,
  lms: Array<Parameters<typeof toObservation.lms>[0]>,
): Promise<Observation[]> {
  if (web.length === 0 && lms.length === 0) return [];

  const testIds = new Set<string>([
    ...web.map(r => r.testId),
    ...lms.map(r => r.testId).filter((id): id is string => !!id),
  ]);
  // Тесты спрашиваются поимённо: выборка редко шире нескольких тестов, а чтение всего
  // справочника ради двух строк — то самое «загрузить таблицу целиком», от которого уходим.
  const testRows = await Promise.all([...testIds].map(id => storage.getTest(id)));
  const graded = new Map(
    testRows
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map(t => [t.id, declaresThreshold(t.overallPassRuleJson)]),
  );

  const userIds = new Set<string>([
    ...web.map(r => r.userId),
    ...lms.map(r => r.userId).filter((id): id is string => !!id),
  ]);
  const userRows = await Promise.all([...userIds].map(id => storage.getUser(id)));
  // Профиль несёт и оргполя: у веба они единственный источник, у LMS — запасной (OQ-04).
  const users = new Map<string, ObservationUser>(
    userRows.filter((u): u is NonNullable<typeof u> => !!u).map(u => [u.id, {
      name: u.name, organization: u.organization, unit: u.unit, position: u.position,
    }]),
  );

  // Пакет — запасной путь к тесту у строк телеметрии, которым backfill ничего не нашёл.
  const needsPackage = lms.some(r => !r.testId && r.packageId);
  const packages = needsPackage
    ? new Map((await storage.getScormPackages()).map(p => [p.id, { testId: p.testId }]))
    : new Map<string, { testId: string | null }>();

  return [
    ...web.map(row => toObservation.web(row, { users, gradedTest: graded.get(row.testId) })),
    ...lms.map(row => toObservation.lms(row, {
      users,
      packages,
      gradedTest: row.testId ? graded.get(row.testId) : undefined,
    })),
  ];
}

/** Объявляет ли тест проходной балл. Половина правила PRD-29 §6.7, относящаяся к тесту. */
function declaresThreshold(rule: unknown): boolean | undefined {
  if (rule === null || rule === undefined) return undefined;
  const type = (rule as { type?: string }).type;
  return type !== undefined && type !== "none";
}
