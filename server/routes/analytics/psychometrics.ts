/**
 * @module server/routes/analytics/psychometrics
 * @description PRD-66 FR-56 - FR-58: психометрика теста одной ручкой.
 *
 * Расширение `/api/analytics`, а не свой раздел API: психометрика — взгляд на те же
 * прохождения, что и остальная аналитика, и отдельный домен развёл бы их права и выборки.
 *
 * Права — ТЕ ЖЕ, что на аналитику теста (FR-58): `analytics.read` плюс область видимости.
 * Отдельного права не заводится — психометрика не раскрывает ничего сверх того, что уже
 * показывает страница теста, а второе право означало бы, что один и тот же читатель видит
 * трудность задания на одной вкладке и не видит на другой.
 *
 * Расчёт по требованию с кэшированием (FR-57): материализованной таблицы метрик нет, потому
 * что любое её состояние немедленно устаревает — выборка задаётся фильтром, а фильтр у каждого
 * читателя свой.
 */
import { Router, type Request, type Response } from "express";
import ExcelJS from "exceljs";

import { config } from "../../config";
import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { storage } from "../../storage";
import { outcomeFor } from "../../services/analytics/answer-outcome";
import { loadResponseMatrix } from "../../services/analytics/response-matrix";
import {
  computeItemBreakdown,
  computePsychometrics,
  defaultVersionOf,
  firstAttemptOnly,
  type PsychometricsContext,
  type QuestionInfo,
} from "../../services/analytics/psychometrics";
import {
  itemsSheet,
  matrixSheet,
  testSheet,
  type ExportContext,
} from "../../services/analytics/psychometrics-export";
import { computeScalePsychometrics } from "../../services/analytics/scale-psychometrics";
import { toMeasurementSpecs } from "../../services/scale-domain";
import { loadTestScoringContext } from "../../services/effective-scoring";
import { loadDeliveryPool } from "../../services/delivery-pool";
import { addAoaSheet, workbookToBuffer } from "../../utils/excel";
import { hasOwnExternalIdFormat } from "../../utils/crypto";
import type { ObservationFilter, ObservationSource } from "../../services/analytics/observations";
import { analyticsScope } from "./helpers";

const router = Router();

const SOURCES: ObservationSource[] = ["web", "telemetry", "import"];

/** Значения параметра, повторённого несколько раз или перечисленного через запятую. */
function listOf(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw.flatMap(item => String(item).split(",")).map(item => item.trim()).filter(Boolean);
}

/** Дата из параметра; конец периода — конец ДНЯ, как и в реестре. */
function dateOf(value: unknown, edge: "start" | "end"): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Кэш расчёта (FR-57).
 *
 * Ключ включает ВСЁ, что меняет числа: тест, версию его содержания, состав учитываемых партий
 * импорта, условия отбора и режим попыток. Партии в ключе не для полноты: снятие партии с
 * учёта меняет выборку, не трогая ни теста, ни его содержания, — без них экран показывал бы
 * прежние числа после переключения и выглядел сломанным.
 *
 * Время жизни короткое намеренно: расчёт идёт по требованию, а кэш здесь спасает от повторного
 * счёта при перелистывании вкладок, а не хранит историю.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

/**
 * Сбросить кэш — целиком либо по одному тесту.
 *
 * Нужен не тестам, а продукту: снятие партии импорта с учёта меняет выборку СЕЙЧАС, и минута
 * жизни кэша означала бы минуту, в которую экран показывает прежние числа после переключения
 * и выглядит сломанным. Ключ хранит тест первым полем, поэтому сброс по тесту — это отбор по
 * префиксу, а не обход всей карты.
 *
 * @param testId тест, расчёты которого устарели; без него сбрасывается всё
 */
export function resetPsychometricsCache(testId?: string): void {
  if (!testId) {
    cache.clear();
    return;
  }
  const prefix = `{"testId":${JSON.stringify(testId)}`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value as T);
  return compute().then(value => {
    cache.set(key, { at: Date.now(), value });
    // Кэш живёт в памяти процесса и обязан оставаться маленьким: ключей столько, сколько
    // сочетаний фильтра, и без уборки устаревшие копятся до перезапуска.
    if (cache.size > 200) {
      for (const [existing, entry] of cache) {
        if (Date.now() - entry.at >= CACHE_TTL_MS) cache.delete(existing);
      }
    }
    return value;
  });
}

/** Оценка ответа веб-попытки — та же цепочка, что у вкладки «Вопросы». */
async function buildGrader(testId: string): Promise<{
  grade: Parameters<typeof loadResponseMatrix>[2];
  questionById: Map<string, QuestionInfo>;
}> {
  const sections = await storage.getTestSections(testId);
  const topicIds = [...new Set(sections.map(s => s.topicId))];
  const questionLists = await Promise.all(topicIds.map(id => storage.getQuestionsByTopic(id)));
  const questions = questionLists.flat();
  const scoring = await loadTestScoringContext(testId, storage);

  const byId = new Map(questions.map(q => [q.id, q]));
  const infoById = new Map<string, QuestionInfo>(
    questions.map(q => [q.id, {
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      dataJson: q.dataJson,
      difficulty: q.difficulty ?? null,
    }]),
  );

  return {
    questionById: infoById,
    grade: (questionId, answer, attemptResult) => {
      const question = byId.get(questionId);
      // Задания в тесте больше нет — оценивать нечем, и выдумывать исход не из чего.
      if (!question) return null;
      const outcome = outcomeFor(attemptResult, questionId, question, answer, scoring.resolve(question));
      if (outcome === null) return null;
      return {
        result: outcome.result,
        earnedPoints: outcome.result === "neutral" ? null : outcome.earned,
        possiblePoints: outcome.result === "neutral" ? null : outcome.possible,
      };
    },
  };
}

/**
 * Условия выборки из адреса — ОДИН разбор на все ручки психометрики.
 *
 * Экран, отчёт и матрица обязаны отбирать одинаково (FR-54b): выгрузка, собранная по другим
 * условиям, чем показанные на экране, невоспроизводима и неоспорима.
 */
function readQuery(req: Request, testId: string): { filter: ObservationFilter; onlyFirst: boolean } {
  const sources = listOf(req.query.source).filter((s): s is ObservationSource =>
    (SOURCES as string[]).includes(s));
  const groupIds = listOf(req.query.groupId);
  const formIds = listOf(req.query.formId);
  const snapshotIds = listOf(req.query.snapshotId);
  const from = dateOf(req.query.from, "start");
  const to = dateOf(req.query.to, "end");
  // Умолчание — «только первая попытка» (FR-51): повторные попытки одного человека не
  // независимы, и выключает это читатель осознанно, с предупреждением на экране.
  const onlyFirst = String(req.query.firstAttemptOnly ?? "true").toLowerCase() !== "false";
  // Оргструктура (FR-06b) — тот же разбор, что у реестра: только повтор параметра, без запятых,
  // потому что запятая бывает в названии организации.
  const repeated = (value: unknown): string[] =>
    (Array.isArray(value) ? value : value === undefined ? [] : [value])
      .map(item => String(item).trim())
      .filter(Boolean);
  const organizations = repeated(req.query.organization);
  const units = repeated(req.query.unit);
  const positions = repeated(req.query.position);

  return {
    onlyFirst,
    filter: {
      testIds: [testId],
      ...(groupIds.length ? { groupIds } : {}),
      ...(formIds.length ? { formIds } : {}),
      ...(snapshotIds.length ? { snapshotIds } : {}),
      ...(organizations.length ? { organizations } : {}),
      ...(units.length ? { units } : {}),
      ...(positions.length ? { positions } : {}),
      ...(sources.length ? { sources } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    },
  };
}

/**
 * Неоднородна ли выдача теста (FR-39).
 *
 * Метрики дискриминации стоят на допущении, что люди отвечали на один и тот же набор. Случайный
 * отбор, квоты по тегам (PRD-11) и адаптив это допущение ломают: каждый видит свой набор, и
 * корреляции считаются по пересекающимся, но разным выборкам. Фиксированные варианты (PRD-17) и
 * полная выдача банка его НЕ ломают — там набор один и тот же, и баннер был бы ложной тревогой.
 *
 * @param mode режим теста
 * @param sections разделы теста с их правилами выдачи
 */
function deliveryIsUneven(
  mode: string | null | undefined,
  sections: ReadonlyArray<{ drawAll?: boolean | null; drawCount?: number | null; formSetJson?: unknown; drawBlueprintJson?: unknown }>,
): boolean {
  if (mode === "adaptive") return true;
  return sections.some(section => {
    // Раздел с набором форм выдаёт вариант целиком — набор у всех, кто получил эту форму, один.
    if (section.formSetJson) return false;
    if (section.drawAll) return false;
    // Квоты по тегам: набор собирается по долям, и у двух участников он разный.
    if (section.drawBlueprintJson) return true;
    return (section.drawCount ?? 0) > 0;
  });
}

/**
 * Смешаны ли в выборке `external_id`, построенные РАЗНЫМИ алгоритмами (PRD-66 FR-43).
 *
 * Один человек попадает в выборку дважды, только если его ключи в двух файлах построены
 * по-разному. Смешение файлов с колонкой `external_id` и без неё само по себе этого НЕ значит:
 * скрипт обезличивания и импорт считают ключ одним алгоритмом (PRD-54 BR-54-22). Поэтому признак —
 * соседство ключей нашего вида и ключей заведомо чужого вида среди импортированных наблюдений.
 * Смотрится сама выборка, а не флажки партий: снятые с учёта партии в неё уже не попали, а фильтр
 * по группе или периоду может убрать одну из сторон смешения.
 *
 * @param observations наблюдения выборки
 */
function mixesKeyAlgorithms(
  observations: ReadonlyArray<{ source: string; participantKey: string | null }>,
): boolean {
  let own = false;
  let foreign = false;
  for (const observation of observations) {
    if (observation.source !== "import" || !observation.participantKey) continue;
    if (hasOwnExternalIdFormat(observation.participantKey)) own = true;
    else foreign = true;
    if (own && foreign) return true;
  }
  return false;
}

/**
 * Сколько взаимодействий импорта не нашли своего задания в тесте (PRD-66 FR-11).
 *
 * Число хранится на партии, поэтому отбор повторяет выборку там, где это возможно: только
 * учтённые партии (FR-12), только если импорт вообще входит в источники, только отобранные
 * группы. Период к партии не приложить — даты у прохождений свои, у партии лишь дата загрузки, —
 * поэтому по периоду число не режется: это верхняя граница потерь, а не точная доля.
 *
 * @param batches партии импорта теста
 * @param filter условия выборки
 */
function unmatchedOf(
  batches: ReadonlyArray<{ counted: boolean; groupId?: string | null; rowsUnmatched?: number | null }>,
  filter: ObservationFilter,
): number {
  if (filter.sources?.length && !filter.sources.includes("import")) return 0;
  return batches
    .filter(batch => batch.counted)
    .filter(batch => !filter.groupIds?.length || (!!batch.groupId && filter.groupIds.includes(batch.groupId)))
    .reduce((sum, batch) => sum + (batch.rowsUnmatched ?? 0), 0);
}

/** Проходной балл теста в долях; `null` — тест ничего не объявляет. */
function cutRatioOf(rule: unknown): number | null {
  const parsed = rule as { type?: string; value?: number } | null;
  if (!parsed || parsed.type !== "percent" || typeof parsed.value !== "number") return null;
  return parsed.value / 100;
}

// GET /api/analytics/psychometrics/:testId — качество заданий и надёжность теста
router.get(
  "/psychometrics/:testId",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.testId;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Тест не найден" });

      const { filter, onlyFirst } = readQuery(req, testId);

      // Состав учитываемых партий — часть ключа: снятие партии с учёта меняет выборку, не
      // трогая ни теста, ни его содержания.
      const batches = await storage.getLmsImportBatches(testId);
      const countedBatches = batches.filter(b => b.counted).map(b => b.id).sort().join(",");
      const key = JSON.stringify({
        testId,
        version: test.version ?? 1,
        countedBatches,
        filter: { ...filter, from: filter.from?.toISOString(), to: filter.to?.toISOString() },
        onlyFirst,
      });

      const result = await cached(key, async () => {
        const scope = await analyticsScope(req);
        const { grade, questionById } = await buildGrader(testId);
        const matrix = await loadResponseMatrix(filter, scope, grade);
        const responses = onlyFirst ? firstAttemptOnly(matrix.responses) : matrix.responses;

        const sections = await storage.getTestSections(testId);
        const ctx: PsychometricsContext = {
          questionById,
          minObservations: config.analytics.minObservations,
          cutRatio: cutRatioOf(test.overallPassRuleJson),
          // FR-20: при неоднородной выдаче надёжность — оценка по связям заданий.
          unevenDelivery: deliveryIsUneven(test.mode, sections),
          // Решение владельца 2026-09-26: вопросы теста — пул выдачи, а не «на что отвечали».
          // Определение пула — то же, что у профиля экспозиции и проверки публикации.
          poolQuestionIds: (await loadDeliveryPool(testId)).questionIds,
        };
        const psychometrics = computePsychometrics(responses, ctx);
        const importShare = psychometrics.sample.responses === 0
          ? 0
          : (psychometrics.sample.bySource.import ?? 0) / psychometrics.sample.responses;

        // Подписи заданий: без них в колонке стоял бы uuid — вскрыто приёмкой.
        const topics = new Map((await storage.getTopics()).map(topic => [topic.id, topic.name]));
        const questionRows = await storage.getQuestionsByIds(psychometrics.items.map(i => i.questionId));
        const labels = new Map(questionRows.map(q => [q.id, {
          prompt: q.prompt,
          topicName: topics.get(q.topicId) ?? "",
          questionType: q.type,
        }]));

        return {
          ...psychometrics,
          items: psychometrics.items.map(item => ({ ...item, ...labels.get(item.questionId) })),
          observations: matrix.observations.length,
          // FR-11: видимая потеря выборки — рядом с n, а не только в протоколе загрузки.
          unmatched: unmatchedOf(batches, filter),
          // FR-46: с какого числа наблюдений показывается трудность — порог инстанса (FR-38a).
          // Экран «данных мало» называет его словами, а придумывать его на клиенте нельзя.
          minObservations: config.analytics.minObservations,
          firstAttemptOnly: onlyFirst,
          // FR-52: тест, где ВСЕ задания измерительные. Трудности и дискриминации там нет по
          // построению, и таблица с восемью строками «мало данных · 0 из 30» читается как
          // поломка — вскрыто приёмкой на синтетических данных.
          // Невыданные вопросы пула здесь не в счёт: ноль наблюдений у них — от того, что их не
          // выдавали, а не от того, что они измерительные.
          measurementOnly: psychometrics.items.some(item => !item.neverDelivered)
            && psychometrics.items.every(item => item.neverDelivered || item.observations === 0),
          // FR-39, FR-40: два повода к одному баннеру — неоднородная выдача и заметная доля
          // импорта, где исход бинарный, а редакция неизвестна.
          bias: {
            unevenDelivery: deliveryIsUneven(test.mode, sections),
            importShare,
            // FR-43: в выборке соседствуют `external_id` нашего вида и заведомо чужого — один
            // человек мог получить два ключа и завысить число респондентов. Имя поля осталось
            // прежним, чтобы не трогать контракт ответа ради одного названия.
            mixedAnonymity: mixesKeyAlgorithms(matrix.observations),
          },
        };
      });

      res.json(result);
    } catch (error) {
      logger.error("Psychometrics error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось посчитать психометрику" });
    }
  },
);

/** Условия среза, приведённые к отбору наблюдений — ТОТ ЖЕ разбор, что у среза PRD-56. */
function conditionsOf(raw: unknown): ObservationFilter {
  const source = (raw ?? {}) as Record<string, unknown>;
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  return {
    ...(list(source.groupIds).length ? { groupIds: list(source.groupIds) } : {}),
    ...(list(source.sources).length ? { sources: list(source.sources) as ObservationSource[] } : {}),
    ...(list(source.formIds).length ? { formIds: list(source.formIds) } : {}),
    ...(list(source.snapshotIds).length ? { snapshotIds: list(source.snapshotIds) } : {}),
    ...(list(source.organizations).length ? { organizations: list(source.organizations) } : {}),
    ...(list(source.units).length ? { units: list(source.units) } : {}),
    ...(list(source.positions).length ? { positions: list(source.positions) } : {}),
    ...(list(source.wrongQuestionIds).length ? { wrongQuestionIds: list(source.wrongQuestionIds) } : {}),
  };
}

// GET /api/analytics/psychometrics/:testId/slices — психометрика по сравниваемым срезам (FR-04b)
//
// Свой механизм сравнения трек НЕ заводит: режим, слоты и правила берутся у раздела
// «Аналитика» (PRD-56 FR-07), меняется только СОДЕРЖИМОЕ таблиц. Один механизм обязан
// выглядеть и считаться одинаково на обоих экранах, иначе автор учит его дважды.
router.get(
  "/psychometrics/:testId/slices",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.testId;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Тест не найден" });

      const requested = listOf(req.query.sliceId);
      // Срезы принадлежат читателю: их видит тот, кто сохранил (PRD-56 FR-07b).
      const saved = await storage.getSlices(req.currentUser?.id ?? "");
      const sources = [
        // «Тест целиком» — законный участник сравнения: без него срез не с чем сопоставить,
        // кроме другого среза, а вопрос «а как у всех?» возникает первым.
        ...(String(req.query.withWhole ?? "") === "1"
          ? [{ id: "whole", name: "Тест целиком", conditionsJson: {} as Record<string, unknown> }]
          : []),
        ...saved.filter(slice => requested.length === 0 || requested.includes(slice.id)),
      ];

      const { onlyFirst } = readQuery(req, testId);
      const scope = await analyticsScope(req);
      const { grade, questionById } = await buildGrader(testId);
      const ctx: PsychometricsContext = {
        questionById,
        minObservations: config.analytics.minObservations,
        cutRatio: cutRatioOf(test.overallPassRuleJson),
        // FR-20: срезы считаются тем же способом, что и выборка целиком.
        unevenDelivery: deliveryIsUneven(test.mode, await storage.getTestSections(testId)),
      };

      const slices = [];
      for (const slice of sources) {
        // Тест рамки перебивает тест среза (PRD-56 FR-07e): он общий для всех сравниваемых.
        const matrix = await loadResponseMatrix(
          { ...conditionsOf(slice.conditionsJson), testIds: [testId] },
          scope,
          grade,
        );
        const responses = onlyFirst ? firstAttemptOnly(matrix.responses) : matrix.responses;
        const psychometrics = computePsychometrics(responses, ctx);

        slices.push({
          id: slice.id,
          name: slice.name,
          conditions: slice.conditionsJson,
          alpha: typeof psychometrics.reliability === "string" ? null : psychometrics.reliability.alpha,
          reliabilityGap: typeof psychometrics.reliability === "string" ? psychometrics.reliability : null,
          // Ошибка измерения — в процентных пунктах результата, как на плитке одной выборки:
          // сумма долей по вопросам зависит от длины варианта, и срезы с разной длиной по ней
          // несравнимы (план сверки 5.3).
          sem: psychometrics.semPercent,
          respondents: psychometrics.sample.respondents,
          observations: psychometrics.sample.responses,
          itemsCount: psychometrics.items.length,
          // Счётная величина: разницу между срезами по ней НЕ считают (FR-04b2) — она
          // говорит о размере группы, а не о качестве теста.
          suspiciousCount: psychometrics.items.filter(item =>
            item.flags.negativeDiscrimination || item.flags.atChanceLevel
            || item.flags.weakDiscrimination
            || item.flags.tooHard || item.flags.tooEasy).length,
          items: psychometrics.items.map(item => ({
            questionId: item.questionId,
            prompt: questionById.get(item.questionId)?.prompt ?? "",
            difficulty: item.difficulty,
            itemRest: item.itemRest,
            observations: item.observations,
          })),
        });
      }

      res.json({ slices, firstAttemptOnly: onlyFirst });
    } catch (error) {
      logger.error("Psychometrics slices error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось посчитать психометрику по срезам" });
    }
  },
);

/** Подписи градаций задания-шкалы — их задаёт автор (PRD-26), придумывать нельзя. */
function gradeLabelsOf(dataJson: unknown): string[] {
  const data = dataJson as { options?: unknown[]; labels?: unknown[]; min?: number; max?: number } | null;
  if (Array.isArray(data?.options)) {
    return data.options.map(option =>
      typeof option === "string" ? option : String((option as { text?: unknown })?.text ?? ""));
  }
  if (Array.isArray(data?.labels)) return data.labels.map(String);
  // Шкала, заданная диапазоном: подписи — сами числа градаций.
  if (typeof data?.min === "number" && typeof data?.max === "number" && data.max >= data.min) {
    return Array.from({ length: data.max - data.min + 1 }, (_, i) => String(data.min! + i));
  }
  return [];
}

// GET /api/analytics/psychometrics/:testId/scales — психометрика измерительных шкал (FR-29)
router.get(
  "/psychometrics/:testId/scales",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.testId;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Тест не найден" });

      const { filter, onlyFirst } = readQuery(req, testId);
      const scope = await analyticsScope(req);
      const { grade } = await buildGrader(testId);
      const matrix = await loadResponseMatrix(filter, scope, grade);
      const responses = onlyFirst ? firstAttemptOnly(matrix.responses) : matrix.responses;

      const [scales, measurements] = await Promise.all([
        storage.getScales(testId),
        storage.getQuestionMeasurements(testId),
      ]);
      const questionIds = [...new Set(measurements.map(m => m.questionId))];
      const questions = await storage.getQuestionsByIds(questionIds);

      const result = computeScalePsychometrics(responses, {
        // Единицы измерения переводятся ТЕМ ЖЕ построителем, что и в расчёте результата:
        // вторая трансляция была бы вторым мнением о том, какая строка к какой шкале.
        measurements: toMeasurementSpecs(measurements, scales),
        scaleLabels: new Map(scales.map(scale => [scale.key, scale.label ?? scale.key])),
        itemById: new Map(questions.map(question => [question.id, {
          questionId: question.id,
          prompt: question.prompt,
          type: question.type,
          gradeLabels: gradeLabelsOf(question.dataJson),
        }])),
      });

      res.json({ scales: result, firstAttemptOnly: onlyFirst });
    } catch (error) {
      logger.error("Psychometrics scales error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось посчитать психометрику шкал" });
    }
  },
);

/** Индексы верных вариантов задания по его эталону. */
function correctIndexesOf(correctJson: unknown): number[] {
  const key = correctJson as { correctIndex?: unknown; correctIndices?: unknown } | null;
  if (typeof key?.correctIndex === "number") return [key.correctIndex];
  if (Array.isArray(key?.correctIndices)) {
    return key.correctIndices.filter((i): i is number => typeof i === "number");
  }
  return [];
}

// GET /api/analytics/psychometrics/:testId/items/:questionId — разбор одного задания
router.get(
  "/psychometrics/:testId/items/:questionId",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId, questionId } = req.params;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Тест не найден" });

      const { filter, onlyFirst } = readQuery(req, testId);
      const scope = await analyticsScope(req);
      const { grade, questionById } = await buildGrader(testId);
      const matrix = await loadResponseMatrix(filter, scope, grade);
      const responses = onlyFirst ? firstAttemptOnly(matrix.responses) : matrix.responses;

      const [question] = await storage.getQuestionsByIds([questionId]);
      const currentVersion = question?.psychoHash ?? null;
      // FR-49a: выбранная редакция — это СМЕНА ВЫБОРКИ, и приходит она параметром. Пустая
      // строка означает серию «версия неизвестна» (FR-49b): её тоже можно посмотреть. Без
      // параметра карточка считается по текущей редакции (эскиз: «По умолчанию — текущая»):
      // наблюдения разных редакций не складываются.
      const requested = typeof req.query.version === "string" ? req.query.version : undefined;
      const version = requested === undefined
        ? defaultVersionOf(responses, questionId, currentVersion)
        : (requested === "" ? null : requested);
      const breakdown = computeItemBreakdown(
        responses,
        {
          questionById,
          minObservations: config.analytics.minObservations,
          cutRatio: cutRatioOf(test.overallPassRuleJson),
        },
        questionId,
        correctIndexesOf(question?.correctJson),
        version,
      );
      // Наблюдений за заданием нет вовсе — это не ошибка запроса, а пустая выборка: задание
      // могли добавить вчера, и разбирать в нём пока нечего.
      if (!breakdown) return res.json({ breakdown: null, questionId });

      // Подзаголовок карточки — «Тема · подтема · N наблюдений» (эскиз); подтемы в продукте —
      // теги вопроса (PRD-11).
      const topicName = question
        ? (await storage.getTopics()).find(topic => topic.id === question.topicId)?.name ?? ""
        : "";

      res.json({
        ...breakdown,
        questionId,
        prompt: question?.prompt ?? questionById.get(questionId)?.prompt ?? "",
        questionType: question?.type ?? questionById.get(questionId)?.type ?? "",
        topicName,
        tags: Array.isArray(question?.tags) ? question.tags : [],
        // Какая редакция текущая и по какой посчитана карточка (FR-49a). `selectedVersion`
        // отсутствует, когда редакция одна и карточка считается по всей выборке.
        currentVersion,
        ...(version !== undefined ? { selectedVersion: version } : {}),
      });
    } catch (error) {
      logger.error("Psychometrics item error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось посчитать разбор вопроса" });
    }
  },
);

/**
 * Собрать всё, что нужно выгрузке: наблюдения, расчёт и справочник текстов.
 *
 * Выгрузка берёт выборку ТЕМИ ЖЕ условиями, что экран (FR-54b): иначе файл невозможно ни
 * повторить, ни сверить с тем, что человек видел, когда его заказывал.
 */
async function collectForExport(req: Request, testId: string) {
  const { filter, onlyFirst } = readQuery(req, testId);
  const scope = await analyticsScope(req);
  const { grade, questionById } = await buildGrader(testId);
  const matrix = await loadResponseMatrix(filter, scope, grade);
  const responses = onlyFirst ? firstAttemptOnly(matrix.responses) : matrix.responses;
  const test = await storage.getTest(testId);

  const ctx: ExportContext = {
    testTitle: test?.title ?? testId,
    conditions: describeFilter(filter),
    firstAttemptOnly: onlyFirst,
    generatedAt: new Date(),
  };
  const psychometrics = computePsychometrics(responses, {
    questionById,
    minObservations: config.analytics.minObservations,
    cutRatio: cutRatioOf(test?.overallPassRuleJson),
    // FR-20: выгрузка считает надёжность тем же способом, что экран.
    unevenDelivery: deliveryIsUneven(test?.mode, await storage.getTestSections(testId)),
    // FR-46a, решение владельца 2026-09-26: в отчёте — тот же список вопросов, что на экране,
    // вместе с ещё не выданными. Матрицу это не трогает: её колонки строятся по ответам, а
    // колонка из одних «не выдавался» внешнему пакету ничего не даёт.
    poolQuestionIds: (await loadDeliveryPool(testId)).questionIds,
  });

  return { ctx, psychometrics, responses, questionById };
}

/** Условия отбора словами — то же, что подписано на экране. */
function describeFilter(filter: ObservationFilter): string {
  const parts: string[] = [];
  if (filter.groupIds?.length) parts.push(`группы: ${filter.groupIds.length}`);
  if (filter.sources?.length) parts.push(`источники: ${filter.sources.join(", ")}`);
  if (filter.formIds?.length) parts.push(`варианты: ${filter.formIds.length}`);
  if (filter.snapshotIds?.length) parts.push(`версии публикации: ${filter.snapshotIds.length}`);
  // Оргзначения читаются словами, а не числом: это имена, и отчёт без них не воспроизвести.
  if (filter.organizations?.length) parts.push(`организация: ${filter.organizations.join(", ")}`);
  if (filter.units?.length) parts.push(`подразделение: ${filter.units.join(", ")}`);
  if (filter.positions?.length) parts.push(`должность: ${filter.positions.join(", ")}`);
  if (filter.from) parts.push(`с ${filter.from.toISOString().slice(0, 10)}`);
  if (filter.to) parts.push(`по ${filter.to.toISOString().slice(0, 10)}`);
  return parts.join("; ");
}

/** Отдать книгу файлом. */
async function sendWorkbook(res: Response, workbook: ExcelJS.Workbook, name: string): Promise<void> {
  const buffer = await workbookToBuffer(workbook);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
  res.send(buffer);
}

/** Имя файла: тест и дата, без символов, которые ломают выгрузку на чужой машине. */
function fileName(prefix: string, title: string): string {
  const safe = title.replace(/[^a-zA-Zа-яА-Я0-9]/g, "_");
  return `${prefix}_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`;
}

// GET /api/analytics/psychometrics/:testId/export — психометрический отчёт (FR-53)
router.get(
  "/psychometrics/:testId/export",
  // Отдельное право на выгрузку — как и у всякого файла, который уносят из системы.
  requirePermission("analytics.export"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.testId;
      const { ctx, psychometrics, questionById } = await collectForExport(req, testId);

      const prompts = new Map([...questionById].map(([id, info]) => [id, info.prompt]));
      const workbook = new ExcelJS.Workbook();
      addAoaSheet(workbook, "Вопросы", itemsSheet(ctx, psychometrics, prompts), [38, 60, 12, 12, 16, 16, 16, 14, 14, 16, 18, 40]);
      addAoaSheet(workbook, "Тест", testSheet(ctx, psychometrics), [34, 22, 60]);

      await sendWorkbook(res, workbook, fileName("psychometrics", ctx.testTitle));
    } catch (error) {
      logger.error("Psychometrics export error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось выгрузить психометрический отчёт" });
    }
  },
);

// GET /api/analytics/psychometrics/:testId/matrix — матрица ответов «участники × задания» (FR-54)
router.get(
  "/psychometrics/:testId/matrix",
  requirePermission("analytics.export"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.testId;
      const { ctx, psychometrics, responses } = await collectForExport(req, testId);

      const workbook = new ExcelJS.Workbook();
      addAoaSheet(workbook, "Матрица ответов", matrixSheet(ctx, responses, psychometrics.sample));

      await sendWorkbook(res, workbook, fileName("response_matrix", ctx.testTitle));
    } catch (error) {
      logger.error("Psychometrics matrix error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось выгрузить матрицу ответов" });
    }
  },
);

export default router;
