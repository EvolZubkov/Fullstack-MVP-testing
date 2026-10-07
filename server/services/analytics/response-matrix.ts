/**
 * @module server/services/analytics/response-matrix
 * @description PRD-66 FR-06, FR-07: слой наблюдений PRD-56, разложенный до уровня ОТВЕТА.
 *
 * Слой прохождений (`observations.ts`) отвечает на вопрос «какие прохождения есть», этот — на
 * вопрос «что в каждом из них отвечали, на какой редакции задания и во сколько времени».
 * Психометрике нужен именно второй: трудность, дискриминативность и надёжность считаются по
 * матрице «респондент × задание», а не по итогам прохождений.
 *
 * Правила ОТБОРА здесь не переписываются. Что считать прохождением, как опознан участник, какая
 * попытка первая, как трактуется источник — всё это уже решено слоем PRD-56, и второй набор таких
 * правил неизбежно разошёлся бы с первым: ровно так два экрана аналитики до PRD-56 отвечали на
 * один вопрос разными числами.
 *
 * ТРИ АДАПТЕРА РАЗЛИЧАЮТСЯ РОВНО ТЕМ, ЧТО ИСТОЧНИК ЗНАЕТ (FR-07). Веб знает выданный состав, балл
 * за каждое задание, редакцию и время. Телеметрия знает то же, кроме редакции, которую приходится
 * восстанавливать по версии публикации. Импорт не знает балла — у выгрузки отчёта есть только
 * бинарный исход, — и это ограничение источника, а не выбор аппарата.
 *
 * Своей оси разбиения психометрика НЕ заводит (FR-08): группы респондента приходят снаружи, из
 * того же слоя, где живут срезы.
 */

import { resolvePsychoHash } from "@shared/questions/psycho-hash";
import { isMeasurementOnly } from "@shared/questions/question-type";

import { storage } from "../../storage";
import {
  loadObservations,
  type Observation,
  type ObservationFilter,
  type ObservationScope,
  type ObservationSource,
} from "./observations";

/**
 * Исход ответа в канонической записи — ЧЕТЫРЕ состояния против трёх в базе (BRD 3.3.4).
 *
 * `neutral` — оценивать было нечего: у задания нет эталона, и ни верным, ни неверным ответ на
 * него не бывает. В метрики CTT такие наблюдения не входят НИКОГДА: приписать им ноль значит
 * утянуть трудность вниз ответами, которые ничего не измеряли.
 *
 * `missing` — задания участник не видел. Оно вне ЗНАМЕНАТЕЛЯ трудности: доля верных среди тех,
 * кому задание не показывали, — величина без смысла. Отличается от пропуска: пропуск (выдано,
 * ответа нет) есть ошибка и стоит ноль баллов.
 */
export type ResponseOutcome = "correct" | "incorrect" | "neutral" | "missing";

/** Одно наблюдение за ОДНИМ ответом, приведённое к общему виду независимо от источника. */
export interface ResponseFact {
  /** Прохождение, которому принадлежит ответ. */
  observationId: string;
  source: ObservationSource;
  /**
   * Кем опознан респондент: пользователь, псевдоним импорта или идентификатор из LMS.
   * `null` — опознать нечем; такое наблюдение не участвует в расчётах по респондентам.
   */
  respondentId: string | null;
  questionId: string;
  /**
   * Редакция содержания, которую видел участник (FR-09a). `null` — «версия неизвестна»:
   * наблюдение собрано до появления штампа либо источник редакции не сообщает.
   */
  psychoHash: string | null;
  outcome: ResponseOutcome;
  /** Баллы ответа; `null` — источник их не знает либо оценивать было нечего. */
  score: number | null;
  maxScore: number | null;
  /**
   * Доля балла `score / maxScore` — то, чем оперируют ВСЕ метрики (PA-17).
   *
   * Не бинарное «верно/неверно»: порог `=== 1` теряет частичный кредит, и задание с
   * градуированной оценкой выглядело бы труднее, чем оно есть. `null` — оценивать нечего.
   */
  scoreRatio: number | null;
  /** Время на задании; `null` — не измерялось. */
  latencyMs: number | null;
  /** Сам ответ участника — сырьё для анализа дистракторов и разброса по градациям. */
  answer: unknown;
  /** Вариант выдачи (PRD-17), в котором задание пришло; `null` — вариантов не было. */
  formKey: string | null;
  /** Группы респондента — ось разбиения выборки; пустой список = группа неизвестна. */
  groupKeys: readonly string[];
  /** Когда наблюдение состоялось: по нему отбирается «первая попытка». */
  occurredAt: Date;
  /**
   * Номер попытки, сообщённый пакетом в выгрузке LMS (PRD-54, решение 13); только у импорта.
   * Больше 1 — наблюдение заведомо не первая попытка участника, как бы рано оно ни было.
   */
  reportedAttempt?: number | null;
}

/** Оценка ответа веб-попытки — та же, что у PRD-56: правило «что такое верно» живёт в одном месте. */
export interface WebGradeResult {
  result: "correct" | "incorrect" | "neutral";
  earnedPoints: number | null;
  possiblePoints: number | null;
}

/** Что известно о веб-прохождении помимо его собственной строки. */
export interface WebResponseContext {
  respondentId: string | null;
  occurredAt: Date;
  groupKeys: readonly string[];
  /**
   * Оценка ответа. Приходит снаружи, потому что эффективная цена и правило проверки задания
   * внутри теста уже разрешены вызывающим (`loadTestScoringContext`): считать их здесь во
   * второй раз значило бы завести второй источник правды о том, что такое «верно».
   *
   * Вызывается и для задания БЕЗ ответа: исход пропуска записан в итоге попытки, и читать его
   * надо там же, где и всё остальное.
   */
  grade: (questionId: string, answer: unknown, attemptResult: unknown) => WebGradeResult | null;
}

/** Веб-попытка в том виде, в каком её читает разложение до ответов. */
export interface WebAttemptSource {
  id: string;
  variantJson?: unknown;
  answersJson?: unknown;
  resultJson?: unknown;
}

/** Строка ответа из LMS (`scorm_answers`), как её отдаёт выборка. */
export interface LmsAnswerSource {
  questionId: string;
  result: "correct" | "incorrect" | "neutral";
  latencyMs: number | null;
  points: number | null;
  maxPoints: number | null;
  userAnswer: unknown;
  topicId?: string | null;
}

/** Что известно о прохождении из LMS помимо его строк ответов. */
export interface LmsResponseContext {
  observationId: string;
  source: ObservationSource;
  respondentId: string | null;
  occurredAt: Date;
  groupKeys: readonly string[];
  /** Выданные варианты картой «тема -> вариант» — та же, что у наблюдения PRD-56. */
  forms: Record<string, string>;
  /** Номер попытки, сообщённый пакетом (только импорт, PRD-54 решение 13); нет — не сообщён. */
  reportedAttempt?: number | null;
  /**
   * Редакция задания у ЭТОГО прохождения.
   *
   * Отдельной функцией, потому что источник редакции у LMS один — снимок публикации, который
   * прохождение сообщило версией (PRD-56 FR-19a). Снимок заморожен (PRD-15), поэтому редакция
   * там известна ТОЧНО; прохождение, версии не сообщившее, даёт `null` — «версия неизвестна».
   */
  psychoHashOf: (questionId: string) => string | null;
  /**
   * PA-12f: выданные ОЦЕНИВАЕМЫЕ задания прохождения, по которым строки ответа может не быть.
   *
   * Строки ответов телеметрии знают только отвеченное, а решение OQ-07 требует считать пропуск
   * нулём: в вебе и в импорте он им и считается. Задание из этого списка без строки ответа
   * становится наблюдением `incorrect` с долей ноль. Список передаёт только тот, кто уверен,
   * что отсутствие строки значит пропуск, а не потерянный ответ (см. {@link loadResponseMatrix});
   * его отсутствие — прежнее поведение: наблюдения только по строкам.
   */
  skippable?: {
    questionIds: readonly string[];
    /** Тема задания — по ней вариант выдачи, как у строки ответа. */
    topicOf: (questionId: string) => string | null;
  };
}

/** Выданный состав веб-попытки и раздел, в котором каждое задание пришло. */
function deliveredOf(variantJson: unknown): Array<{ questionId: string; topicId: string | null; formKey: string | null }> {
  const sections = (variantJson as {
    sections?: Array<{ topicId?: string; questionIds?: string[]; formId?: string }>;
  } | null)?.sections ?? [];

  const out: Array<{ questionId: string; topicId: string | null; formKey: string | null }> = [];
  for (const section of sections) {
    for (const questionId of section?.questionIds ?? []) {
      out.push({ questionId, topicId: section.topicId ?? null, formKey: section.formId ?? null });
    }
  }
  return out;
}

/** Доля балла, когда баллы известны. `null` — оценивать нечего или делить не на что. */
function ratioOf(score: number | null, maxScore: number | null): number | null {
  if (score === null || maxScore === null) return null;
  // Деление на ноль даёт не «ноль баллов», а отсутствие оценивания: задание ценой в ноль
  // ничего не измеряет, и `NaN`, выданный за трудность, — ровно тот случай, который FR-44
  // запрещает.
  if (maxScore <= 0) return null;
  return score / maxScore;
}

export const toResponses = {
  /**
   * Веб-попытка (`attempts`) — источник, знающий ВСЁ: состав выдачи, балл, редакцию и время.
   *
   * Перебирается именно ВЫДАННЫЙ состав, а не карта ответов: задание, выданное и не отвеченное,
   * обязано попасть в наблюдения пропуском ценой в ноль (решение OQ-07) — выкинуть его значило
   * бы завысить трудность, ведь задание, которое все пропускают, выглядело бы лёгким. Обратное
   * тоже важно: ответ на задание вне состава (его убрали из теста) приписывать выдаче, которой
   * не было, нельзя.
   */
  web(attempt: WebAttemptSource, ctx: WebResponseContext): ResponseFact[] {
    const answers = (attempt.answersJson ?? {}) as Record<string, unknown>;
    const variant = attempt.variantJson as {
      psychoHashes?: Record<string, string | null>;
      latencyMs?: Record<string, number>;
    } | null;
    const stamps = variant?.psychoHashes ?? {};
    const latency = variant?.latencyMs ?? {};

    const facts: ResponseFact[] = [];
    for (const delivered of deliveredOf(attempt.variantJson)) {
      const { questionId } = delivered;
      const answer = answers[questionId];
      const graded = ctx.grade(questionId, answer, attempt.resultJson);
      // Задания в тесте больше нет — оценивать нечем, и выдумывать исход не из чего.
      if (!graded) continue;

      const neutral = graded.result === "neutral";
      const score = neutral ? null : graded.earnedPoints ?? 0;
      const maxScore = neutral ? null : graded.possiblePoints;

      facts.push({
        observationId: attempt.id,
        source: "web",
        respondentId: ctx.respondentId,
        questionId,
        psychoHash: stamps[questionId] ?? null,
        outcome: graded.result,
        score,
        maxScore,
        scoreRatio: ratioOf(score, maxScore),
        latencyMs: typeof latency[questionId] === "number" ? latency[questionId] : null,
        answer,
        formKey: delivered.formKey,
        groupKeys: ctx.groupKeys,
        occurredAt: ctx.occurredAt,
      });
    }
    return facts;
  },

  /**
   * Прохождение из LMS: живая телеметрия или импортированная выгрузка (`scorm_answers`).
   *
   * Одни и те же таблицы, одно и то же разложение — различие ровно одно и оно в данных: у
   * импорта балла за задание НЕТ, потому что выгрузка отчёта его не содержит, и доля балла там
   * выводится из бинарного исхода. Это ограничение источника, и аппарат обязан его показывать
   * (FR-40), а не прятать за похожими числами.
   *
   * Выданным составом служит набор строк ответов: после правки разбора (FR-10a) блок невыданного
   * задания в выгрузку наблюдений не попадает вовсе, а пропуск нынешний пакет пишет в отчёт LMS
   * исходом `incorrect`. Телеметрия строки по пропуску до PA-12f не слала — такие пропуски
   * достраиваются из выданного состава прохождения (`skippable`).
   */
  lms(rows: readonly LmsAnswerSource[], ctx: LmsResponseContext): ResponseFact[] {
    const facts: ResponseFact[] = rows.map(row => {
      const neutral = row.result === "neutral";
      const knownPoints = !neutral && row.points !== null && row.maxPoints !== null;
      // Балл источник сообщил — доля считается из него; не сообщил — остаётся бинарный исход,
      // и это честнее, чем выдать «ноль баллов из неизвестно скольких» за частичный кредит.
      const scoreRatio = neutral
        ? null
        : knownPoints
          ? ratioOf(row.points, row.maxPoints)
          : row.result === "correct" ? 1 : 0;

      return {
        observationId: ctx.observationId,
        source: ctx.source,
        respondentId: ctx.respondentId,
        questionId: row.questionId,
        psychoHash: ctx.psychoHashOf(row.questionId),
        outcome: row.result,
        score: knownPoints ? row.points : null,
        maxScore: knownPoints ? row.maxPoints : null,
        scoreRatio,
        latencyMs: row.latencyMs,
        answer: row.userAnswer,
        formKey: row.topicId ? ctx.forms[row.topicId] ?? null : null,
        groupKeys: ctx.groupKeys,
        occurredAt: ctx.occurredAt,
        reportedAttempt: ctx.reportedAttempt ?? null,
      };
    });

    if (ctx.skippable) {
      const answered = new Set(rows.map(row => row.questionId));
      for (const questionId of ctx.skippable.questionIds) {
        if (answered.has(questionId)) continue;
        answered.add(questionId);
        const topicId = ctx.skippable.topicOf(questionId);
        // Пропуск ценой в ноль (OQ-07). Баллов источник не сообщил, поэтому доля задана прямо,
        // как у бинарного исхода импорта: ноль из любого максимума — ноль.
        facts.push({
          observationId: ctx.observationId,
          source: ctx.source,
          respondentId: ctx.respondentId,
          questionId,
          psychoHash: ctx.psychoHashOf(questionId),
          outcome: "incorrect",
          score: null,
          maxScore: null,
          scoreRatio: 0,
          latencyMs: null,
          answer: undefined,
          formKey: topicId ? ctx.forms[topicId] ?? null : null,
          groupKeys: ctx.groupKeys,
          occurredAt: ctx.occurredAt,
          reportedAttempt: ctx.reportedAttempt ?? null,
        });
      }
    }
    return facts;
  },
};

/**
 * Матрица наблюдений выборки: прохождения и их ответы.
 *
 * Отдаётся вместе, а не по отдельности, потому что психометрике нужны обе стороны: по ответам
 * считаются метрики задания, по прохождениям — знаменатели и доля потерь. Разъединив их, легко
 * посчитать долю от не того числа.
 */
export interface ResponseMatrix {
  observations: Observation[];
  responses: ResponseFact[];
}

/**
 * Загрузить матрицу по тем же условиям, по которым экран отбирает прохождения.
 *
 * Отбор целиком делегирован слою PRD-56 (FR-06): здесь только разложение отобранного до уровня
 * ответа. Порции нет намеренно — метрику нельзя посчитать по половине выборки, и «страница»
 * наблюдений тут была бы не оптимизацией, а неверным числом.
 *
 * @param filter условия отбора — те же, что у реестра и срезов
 * @param scope область видимости читателя
 * @param grade оценка ответа веб-попытки, разрешённая вызывающим
 * @returns прохождения выборки и их ответы
 */
export async function loadResponseMatrix(
  filter: ObservationFilter,
  scope: ObservationScope,
  grade: WebResponseContext["grade"],
): Promise<ResponseMatrix> {
  const { rows: observations } = await loadObservations({ ...filter, limit: undefined, offset: undefined }, scope);
  if (observations.length === 0) return { observations, responses: [] };

  const webIds = observations.filter(o => o.source === "web").map(o => o.id);
  const lmsIds = observations.filter(o => o.source !== "web").map(o => o.id);

  const telemetryIds = observations.filter(o => o.source === "telemetry" && !o.adaptive).map(o => o.id);

  const [webRows, lmsAnswers, groupsByUser, deliveredByAttempt] = await Promise.all([
    webIds.length ? storage.getAttemptsByIds(webIds) : Promise.resolve([]),
    storage.selectAnswersForAttempts(lmsIds),
    storage.selectGroupsOfUsers(
      [...new Set(observations.map(o => o.userId).filter((id): id is string => !!id))],
    ),
    storage.selectDeliveredQuestionIds(telemetryIds),
  ]);

  const webById = new Map(webRows.map(row => [row.id, row]));
  const lmsByAttempt = new Map<string, LmsAnswerSource[]>();
  for (const row of lmsAnswers) {
    const list = lmsByAttempt.get(row.attemptId);
    if (list) list.push(row);
    else lmsByAttempt.set(row.attemptId, [row]);
  }

  const snapshots = await snapshotFacts(observations);

  const responses: ResponseFact[] = [];
  for (const observation of observations) {
    const groupKeys = groupKeysOf(observation, groupsByUser);
    if (observation.source === "web") {
      const attempt = webById.get(observation.id);
      if (!attempt) continue;
      responses.push(...toResponses.web(attempt, {
        respondentId: observation.participantId,
        occurredAt: observation.startedAt,
        groupKeys,
        grade,
      }));
      continue;
    }

    const snapshot = snapshots.get(observation.snapshotId ?? "");
    responses.push(...toResponses.lms(lmsByAttempt.get(observation.id) ?? [], {
      observationId: observation.id,
      source: observation.source,
      respondentId: observation.participantId,
      occurredAt: observation.startedAt,
      groupKeys,
      forms: observation.forms,
      reportedAttempt: observation.reportedAttempt ?? null,
      psychoHashOf: questionId => snapshot?.stamps.get(questionId) ?? null,
      skippable: skippableOf(observation, snapshot, deliveredByAttempt.get(observation.id)),
    }));
  }

  return { observations, responses };
}

/**
 * Группы респондента — ось разбиения, взятая у существующего слоя (FR-08).
 *
 * У веб-прохождения и телеметрии это членство участника (`user_groups`), у импорта — метка
 * группы партии: участник там может быть не заведён в системе вовсе. Пустой список означает
 * «группа неизвестна», а не «участник ни в одной группе»: различить эти два случая по данным
 * нельзя, и аппарат обязан обходиться с ними одинаково осторожно.
 */
function groupKeysOf(observation: Observation, groupsByUser: ReadonlyMap<string, string[]>): string[] {
  const membership = observation.userId ? groupsByUser.get(observation.userId) ?? [] : [];
  if (membership.length > 0) return membership;
  return observation.groupId ? [observation.groupId] : [];
}

/** Что снимок публикации говорит о прохождениях, которые его сообщили. */
export interface SnapshotFacts {
  /** Редакция каждого задания снимка. */
  stamps: Map<string, string>;
  /**
   * Тема каждого ОЦЕНИВАЕМОГО задания снимка. Измерительного здесь нет: его пропуск ничего не
   * стоит, и ноль за него был бы выдумкой.
   */
  gradedTopics: Map<string, string>;
  /** Быстрый переход (PRD-43) у теста этой публикации. */
  quickAdvance: boolean;
}

/**
 * Какие выданные задания телеметрии можно считать пропуском, если строки ответа по ним нет (PA-12f).
 *
 * Отсутствие строки значит «пропуск» не всегда. Пакеты, собранные до исправления PA-12f, слали
 * ответ только из «Отправить ответ». При быстром переходе (PRD-43) ответ фиксирует «Далее», и
 * такой пакет не присылал строк вовсе, даже по отвеченному, — ноль за каждое задание оказался бы
 * ложью. Поэтому достройка идёт только там, где правило известно точно: прохождение сообщило
 * версию публикации, и у теста этой публикации быстрого перехода нет. Адаптивные прохождения
 * отсечены раньше: невыданное уровнем там неотличимо от пропущенного.
 *
 * Исправленные пакеты шлют строку и по пропуску, поэтому для них достройка ничего не добавляет.
 * Осознанная неточность старых пакетов: черновик строгого режима, засчитанный в балл при
 * истечении времени, здесь станет нулём — строки по нему нет, и ответа мы не знаем.
 */
export function skippableOf(
  observation: Observation,
  snapshot: SnapshotFacts | undefined,
  delivered: readonly string[] | undefined,
): LmsResponseContext["skippable"] {
  if (observation.source !== "telemetry" || observation.adaptive) return undefined;
  if (!snapshot || snapshot.quickAdvance || !delivered) return undefined;
  return {
    questionIds: delivered.filter(id => snapshot.gradedTopics.has(id)),
    topicOf: questionId => snapshot.gradedTopics.get(questionId) ?? null,
  };
}

/**
 * Редакции заданий и правила выдачи по версиям публикации, встреченным в выборке.
 *
 * Снимок заморожен (PRD-15), поэтому содержание задания в нём — это ровно то, что видел
 * участник прохождения, сообщившего эту версию. Отпечаток считается ТОЙ ЖЕ функцией, что и при
 * записи вопроса: второй способ вычисления развёл бы серии наблюдений на ровном месте.
 *
 * Прохождение, версии не сообщившее, в карту не попадает — его наблюдения идут в серию «версия
 * неизвестна» (FR-09c), а пропуски по нему не достраиваются (PA-12f).
 */
async function snapshotFacts(
  observations: readonly Observation[],
): Promise<Map<string, SnapshotFacts>> {
  const ids = [...new Set(
    observations
      .filter(o => o.source !== "web")
      .map(o => o.snapshotId)
      .filter((id): id is string => !!id),
  )];

  const out = new Map<string, SnapshotFacts>();
  for (const id of ids) {
    const snapshot = await storage.getSnapshot(id);
    if (!snapshot) continue;
    const content = snapshot.contentJson as {
      test?: { quickAdvance?: boolean | null };
      questionsByTopic?: Record<string, Array<{ id: string; type: string; prompt: string; dataJson: unknown; correctJson: unknown; psychoHash?: string | null }>>;
    } | null;
    const stamps = new Map<string, string>();
    const gradedTopics = new Map<string, string>();
    for (const [topicId, questions] of Object.entries(content?.questionsByTopic ?? {})) {
      for (const question of questions) {
        stamps.set(question.id, resolvePsychoHash(question));
        if (!isMeasurementOnly({ type: question.type, correctJson: question.correctJson })) {
          gradedTopics.set(question.id, topicId);
        }
      }
    }
    out.set(id, { stamps, gradedTopics, quickAdvance: content?.test?.quickAdvance === true });
  }
  return out;
}
