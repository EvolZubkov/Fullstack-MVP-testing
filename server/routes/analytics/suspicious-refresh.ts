/**
 * @module server/routes/analytics/suspicious-refresh
 * @description Э3.4: фоновый пересчёт числа вопросов под подозрением по каждому тесту (решение
 * владельца 2026-10-04: «Фоновый пересчёт»).
 *
 * Корзина «Тесты с вопросами под подозрением» общего «Требует внимания» и колонка вкладки
 * «Тесты» нужны сразу, а психометрика одного теста считается секунды — на десятках тестов это
 * минуты. Поэтому число считается в фоне и хранится готовым; ручки отдают его мгновенно вместе
 * со временем расчёта, и экран говорит, когда оно посчитано.
 *
 * Пересчитываются только тесты, у которых с прошлого раза появились прохождения (меняется время
 * последнего) или которые правили (версия, время изменения): у остальных всё то же. Тесты
 * считаются ПО ОДНОМУ — параллельный расчёт десятков тестов выбирал бы пул соединений базы,
 * которым живут запросы людей.
 *
 * PRD-70 FR-03, FR-04: проход считает не только число, а качество вопросов теста целиком —
 * признак с эвристиками ревизии, наблюдаемую сложность, выдачи и переэкспонированность — и пулы
 * выдачи всех тестов. Ось банка вопросов читает это готовым и сама ничего не пересчитывает.
 *
 * Состояние — в памяти процесса: после перезапуска первый проход идёт с задержкой, и до него
 * число неизвестно (`null`), что экран и говорит.
 */
import { logger } from "../../logger";
import { storage } from "../../storage";
import { loadDeliveryPool } from "../../services/delivery-pool";
import { loadObservations } from "../../services/analytics/observations";
import { evaluateTestQuality, type TestQuality } from "../../services/analytics/question-quality";

/** Готовое число по тесту. */
export interface SuspiciousEntry {
  count: number;
  /** Сколько вопросов в расчёте — «8 из 42». */
  items: number;
  /** Сколько завершённых прохождений теста учтено. */
  passages: number;
  /** Когда посчитано (ISO). */
  computedAt: string;
  /** По какому последнему прохождению: новое — повод пересчитать. */
  lastAttemptAt: string | null;
}

/** Запись теста с прохождениями: число для карточек и качество вопросов для оси банка. */
interface QualityEntry extends SuspiciousEntry {
  /** Отпечаток правки теста: версия и время изменения — правка меняет пул и оценку. */
  fingerprint: string;
  quality: TestQuality;
}

const entries = new Map<string, QualityEntry>();
/** PRD-70 §3.3: пулы выдачи ВСЕХ тестов, в том числе без прохождений, — по ним судится «не выдавался». */
const pools = new Map<string, { fingerprint: string; questionIds: string[] }>();
let running = false;

/** Готовое число теста; `undefined` — ещё не посчитано. */
export function suspiciousEntry(testId: string): SuspiciousEntry | undefined {
  return entries.get(testId);
}

/** PRD-70 FR-04: качество вопросов тестов с прохождениями — готовое, из последнего прохода. */
export function testQualities(): TestQuality[] {
  return [...entries.values()].map(entry => entry.quality);
}

/** PRD-70 §3.3: пул выдачи каждого известного теста. */
export function testPools(): ReadonlyMap<string, readonly string[]> {
  return new Map([...pools].map(([testId, pool]) => [testId, pool.questionIds]));
}

/** Сбросить состояние — для тестов. */
export function resetSuspiciousEntries(): void {
  entries.clear();
  pools.clear();
}

/** Отпечаток правки теста: версия и время изменения. */
function fingerprintOf(test: { version?: number | null; updatedAt?: Date | string | null }): string {
  const at = test.updatedAt instanceof Date ? test.updatedAt.toISOString() : String(test.updatedAt ?? "");
  return `${test.version ?? 1}|${at}`;
}

/**
 * Один проход пересчёта: тесты с новыми прохождениями или правкой — заново, остальные — как были.
 *
 * Повторный вызов во время прохода ничего не делает: два прохода считали бы одно и то же дважды.
 *
 * @param compute расчёт одного теста — подменяется в тестах
 * @param poolOf пул выдачи теста без прохождений — подменяется в тестах
 */
export async function refreshSuspicious(
  compute: (testId: string) => Promise<TestQuality | null> = evaluateTestQuality,
  poolOf: (testId: string) => Promise<string[]> = async testId => (await loadDeliveryPool(testId)).questionIds,
): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { rows } = await loadObservations({}, { all: true, ids: new Set<string>() });
    const lastByTest = new Map<string, string>();
    const passagesByTest = new Map<string, number>();
    for (const row of rows) {
      if (!row.testId || row.outcome === "incomplete") continue;
      passagesByTest.set(row.testId, (passagesByTest.get(row.testId) ?? 0) + 1);
      const at = (row.finishedAt ?? row.startedAt).toISOString();
      const known = lastByTest.get(row.testId);
      if (!known || at > known) lastByTest.set(row.testId, at);
    }
    const tests = (await storage.getTests()) ?? [];
    const fingerprints = new Map(tests.map(test => [test.id, fingerprintOf(test)]));

    // Тест без прохождений из сводки уходит: говорить о нём нечего.
    for (const testId of [...entries.keys()]) {
      if (!lastByTest.has(testId)) entries.delete(testId);
    }
    for (const [testId, lastAttemptAt] of lastByTest) {
      const fingerprint = fingerprints.get(testId) ?? "";
      const known = entries.get(testId);
      if (known?.lastAttemptAt === lastAttemptAt && known.fingerprint === fingerprint) continue;
      try {
        const quality = await compute(testId);
        if (quality === null) continue;
        entries.set(testId, {
          count: quality.suspicious,
          items: quality.itemCount,
          passages: passagesByTest.get(testId) ?? 0,
          computedAt: new Date().toISOString(),
          lastAttemptAt,
          fingerprint,
          quality,
        });
        pools.set(testId, { fingerprint, questionIds: quality.pool });
      } catch (error) {
        // Сбой одного теста не роняет проход: остальные числа нужны не меньше.
        logger.warn(`Э3.4: вопросы под подозрением теста ${testId} не посчитаны — ${(error as Error).message}`, "analytics");
      }
    }

    // PRD-70 §3.3: пулы тестов без прохождений — вопрос из такого пула нигде не выдавался.
    for (const testId of [...pools.keys()]) {
      if (!fingerprints.has(testId) && !lastByTest.has(testId)) pools.delete(testId);
    }
    for (const [testId, fingerprint] of fingerprints) {
      if (lastByTest.has(testId) || pools.get(testId)?.fingerprint === fingerprint) continue;
      try {
        pools.set(testId, { fingerprint, questionIds: await poolOf(testId) });
      } catch (error) {
        logger.warn(`PRD-70: пул выдачи теста ${testId} не прочитан — ${(error as Error).message}`, "analytics");
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Запустить пересчёт по таймеру: первый проход — с задержкой после старта (сервер сначала
 * отвечает людям), дальше — с интервалом.
 *
 * @param delayMs задержка первого прохода
 * @param intervalMs интервал между проходами
 */
export function startSuspiciousRefresh(delayMs = 60_000, intervalMs = 10 * 60_000): void {
  const run = () => {
    void refreshSuspicious().catch(error => {
      logger.warn("Э3.4: проход пересчёта вопросов под подозрением сорвался — " + (error as Error).message, "analytics");
    });
  };
  setTimeout(run, delayMs).unref();
  setInterval(run, intervalMs).unref();
}
