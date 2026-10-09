/**
 * @module server/services/lms-test-resolver
 * @description Определение теста по идентификаторам вопросов из шапки выгрузки (PRD-54 раздел 6.2).
 *
 * Тест берётся из файла: блоки `q_<uuid>` в первой строке шапки называют вопросы, а вопросы — тесты,
 * в которых они стоят. Свободного выбора теста нет: он открыл бы дорогу записи прохождений не в тот
 * тест, и обнаружилось бы это только по кривой аналитике. Когда же вопросы файла стоят в нескольких
 * тестах (тема — банк, и из неё собраны два теста или копия), человек выбирает из ЭТИХ тестов, и
 * сервер принимает только их (2026-10-06).
 *
 * Отдельный модуль, а не часть сервиса импорта, потому что вызывающих ДВА: `/api/workbook/inspect`
 * обязан назвать тест ещё до того, как человек нажал «Импортировать».
 */
import type { IStorage } from "../storage";

/** Тест, в разделах которого стоят вопросы файла. */
export interface TestCandidate {
  testId: string;
  /** Сколько найденных вопросов файла стоят в разделах этого теста. */
  matched: number;
}

export interface ResolvedTest {
  /** Тест, если он определился ОДНОЗНАЧНО, иначе `null`. */
  testId: string | null;
  /**
   * Все тесты, в разделах которых стоят вопросы файла, — больше покрытых вопросов первыми.
   * Пустой список — вопросов файла в базе нет либо они не стоят ни в одном тесте.
   */
  candidates: TestCandidate[];
  /** Идентификаторы вопросов, которых в базе нет. */
  foreign: string[];
}

/**
 * Определить тест, которому принадлежат вопросы выгрузки.
 *
 * Путь один: вопрос -> его тема -> разделы, ссылающиеся на эту тему -> тесты этих разделов. Если
 * тест получился ровно один, он и есть цель; несколько — возвращаются кандидатами на выбор; ноль —
 * отказ.
 *
 * Вопросы, которых в базе нет, не считаются ошибкой сами по себе: пакет мог быть собран под более
 * ранней версией теста, часть вопросов с тех пор удалили, и остальные строки всё ещё осмысленны.
 * Такие идентификаторы возвращаются списком, чтобы импорт сказал о них в протоколе.
 *
 * @param questionIds идентификаторы из блоков `q_<uuid>` шапки
 * @param storage слой доступа к данным
 * @returns тест, кандидаты и список чужих вопросов
 */
export async function resolveTestByQuestionIds(
  questionIds: string[],
  storage: IStorage,
): Promise<ResolvedTest> {
  const found = await storage.getQuestionsByIds(questionIds);
  const known = new Set(found.map((q) => q.id));
  const foreign = questionIds.filter((id) => !known.has(id));
  if (found.length === 0) return { testId: null, candidates: [], foreign };

  const topicIds = [...new Set(found.map((q) => q.topicId).filter(Boolean))] as string[];
  const sections = await storage.getTestSectionsByTopicIds(topicIds);

  // Несколько тем ОДНОГО теста — норма (тест из нескольких разделов); тест считается один раз.
  const topicsByTest = new Map<string, Set<string>>();
  for (const s of sections) {
    if (!s.topicId) continue;
    const set = topicsByTest.get(s.testId) ?? new Set<string>();
    set.add(s.topicId);
    topicsByTest.set(s.testId, set);
  }
  const candidates = [...topicsByTest].map(([testId, topics]) => ({
    testId,
    matched: found.filter((q) => q.topicId && topics.has(q.topicId)).length,
  }));
  candidates.sort((a, b) => b.matched - a.matched);

  return { testId: candidates.length === 1 ? candidates[0].testId : null, candidates, foreign };
}

/** Кандидат вместе со статусом теста — то, по чему кандидаты упорядочиваются. */
export interface RankableCandidate extends TestCandidate {
  status: string;
}

/**
 * Упорядочить кандидатов и назвать рекомендуемого (2026-10-06).
 *
 * Опубликованный тест значимее неопубликованного: прохождения в LMS идут по выданному пакету, а
 * выдают опубликованное, тогда как черновик чаще всего — копия в работе. Поэтому опубликованные
 * стоят первыми, внутри статуса — больше покрытых вопросов файла первыми.
 *
 * Рекомендация — лучший опубликованный кандидат, но только если он лучший ОДНОЗНАЧНО: два
 * опубликованных теста с одинаковым покрытием — та же двусмысленность, и её разрешает человек.
 * Рекомендация лишь подставляется в выбор: сервер по-прежнему принимает любого кандидата.
 *
 * @param candidates кандидаты со статусами тестов
 * @returns кандидаты по порядку и рекомендуемый тест либо `null`
 */
export function rankCandidates<T extends RankableCandidate>(
  candidates: T[],
): { ranked: T[]; recommendedTestId: string | null } {
  const published = (c: T) => (c.status === "published" ? 1 : 0);
  const ranked = [...candidates].sort((a, b) => published(b) - published(a) || b.matched - a.matched);
  const [first, second] = ranked;
  const clear =
    first !== undefined &&
    published(first) === 1 &&
    !(second && published(second) === 1 && second.matched === first.matched);
  return { ranked, recommendedTestId: clear ? first.testId : null };
}

/** Итог сверки выбранного теста с файлом. */
export type TestChoice =
  | { ok: true; testId: string }
  | { ok: false; reason: "none" | "ambiguous" | "not-candidate" };

/**
 * Свести определение по файлу и выбор человека к одному тесту.
 *
 * Выбор учитывается, только если тест — один из кандидатов файла: так даже подделанный запрос не
 * запишет прохождения в тест, к которому вопросы файла отношения не имеют. При однозначном тесте
 * выбор не нужен, но и не мешает, если совпадает.
 *
 * @param resolved определение по файлу
 * @param chosen тест, выбранный человеком, если выбирал
 * @returns тест либо причина отказа
 */
export function chooseTest(resolved: ResolvedTest, chosen: string | null | undefined): TestChoice {
  const pick = chosen?.trim() || null;
  if (resolved.candidates.length === 0) return { ok: false, reason: "none" };
  if (pick) {
    return resolved.candidates.some((c) => c.testId === pick)
      ? { ok: true, testId: pick }
      : { ok: false, reason: "not-candidate" };
  }
  return resolved.testId ? { ok: true, testId: resolved.testId } : { ok: false, reason: "ambiguous" };
}
