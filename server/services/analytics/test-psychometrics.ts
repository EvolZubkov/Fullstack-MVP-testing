/**
 * @module server/services/analytics/test-psychometrics
 * @description PRD-70 FR-02: психометрика ОДНОГО теста — один кэшируемый расчёт для всех
 * потребителей: экрана «Качество вопросов» (`routes/analytics/psychometrics`), фонового пересчёта
 * признаков и оси банка вопросов (`question-quality`). Вынесено из маршрута, чтобы сервисы не
 * зависели от модуля маршрута; там остались разбор адреса и ответы ручек.
 */
import { config } from "../../config";
import { storage } from "../../storage";
import { loadTestScoringContext } from "../effective-scoring";
import { loadDeliveryPool } from "../delivery-pool";
import { outcomeFor } from "./answer-outcome";
import type { ObservationFilter } from "./observations";
import { computePsychometrics, firstAttemptOnly, type QuestionInfo } from "./psychometrics";
import { loadResponseMatrix } from "./response-matrix";

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

export function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
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
export async function buildGrader(testId: string): Promise<{
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
      correctJson: q.correctJson,
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
export function deliveryIsUneven(
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

/** Проходной балл теста в долях; `null` — тест ничего не объявляет. */
export function cutRatioOf(rule: unknown): number | null {
  const parsed = rule as { type?: string; value?: number } | null;
  if (!parsed || parsed.type !== "percent" || typeof parsed.value !== "number") return null;
  return parsed.value / 100;
}

/** Тест, как его читает расчёт, — запись хранилища. */
export type TestRow = NonNullable<Awaited<ReturnType<typeof storage.getTest>>>;

/** Результат ядра расчёта: метрики, наблюдения выборки, разделы и партии импорта теста. */
export interface TestPsychometrics {
  psychometrics: ReturnType<typeof computePsychometrics>;
  observations: Awaited<ReturnType<typeof loadResponseMatrix>>["observations"];
  sections: Awaited<ReturnType<typeof storage.getTestSections>>;
  batches: Awaited<ReturnType<typeof storage.getLmsImportBatches>>;
}

/**
 * Ключ кэша расчёта по тесту — тест первым полем, чтобы сброс по тесту шёл по префиксу.
 *
 * @param test тест
 * @param batches партии импорта теста: загрузка и откат меняют выборку, не трогая ни теста, ни
 *   его содержания
 * @param filter отбор наблюдений
 * @param onlyFirst только первая попытка участника
 */
export function coreKey(
  test: TestRow,
  batches: TestPsychometrics["batches"],
  filter: ObservationFilter,
  onlyFirst: boolean,
): string {
  return JSON.stringify({
    testId: test.id,
    version: test.version ?? 1,
    batchIds: batches.map(b => b.id).sort().join(","),
    filter: { ...filter, from: filter.from?.toISOString(), to: filter.to?.toISOString() },
    onlyFirst,
  });
}

/**
 * PRD-70 FR-02: психометрика теста при данном отборе — ОДИН кэшируемый расчёт для всех
 * потребителей: экрана «Качество вопросов», фонового пересчёта «под подозрением» и статистики
 * вопроса банка. Раньше фоновый пересчёт считал тест заново мимо кэша экрана.
 *
 * Область видимости открыта: отбор всегда сужен до одного теста (`filter.testIds`), а пускать ли
 * читателя к этому тесту, решает гейт маршрута (`requireTestScope`) до вызова. Поэтому один ключ
 * годится всем читателям теста.
 *
 * @param test тест
 * @param filter отбор наблюдений; `testIds` — ровно `[test.id]`
 * @param onlyFirst только первая попытка участника (FR-51)
 */
export async function testPsychometrics(
  test: TestRow,
  filter: ObservationFilter,
  onlyFirst: boolean,
): Promise<TestPsychometrics> {
  const batches = await storage.getLmsImportBatches(test.id);
  return cached(coreKey(test, batches, filter, onlyFirst), async () => {
    const { grade, questionById } = await buildGrader(test.id);
    const matrix = await loadResponseMatrix(filter, { all: true, ids: new Set<string>() }, grade);
    const sections = await storage.getTestSections(test.id);
    const psychometrics = computePsychometrics(onlyFirst ? firstAttemptOnly(matrix.responses) : matrix.responses, {
      questionById,
      minObservations: config.analytics.minObservations,
      cutRatio: cutRatioOf(test.overallPassRuleJson),
      // FR-20: при неоднородной выдаче надёжность — оценка по связям заданий.
      unevenDelivery: deliveryIsUneven(test.mode, sections),
      // Решение владельца 2026-09-26: вопросы теста — пул выдачи, а не «на что отвечали».
      // Определение пула — то же, что у профиля экспозиции и проверки публикации.
      poolQuestionIds: (await loadDeliveryPool(test.id)).questionIds,
    });
    return { psychometrics, observations: matrix.observations, sections, batches };
  });
}
