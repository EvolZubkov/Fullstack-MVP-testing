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
 * последнего): психометрика остальных та же. Тесты считаются ПО ОДНОМУ — параллельный расчёт
 * десятков тестов выбирал бы пул соединений базы, которым живут запросы людей.
 *
 * Состояние — в памяти процесса: после перезапуска первый проход идёт с задержкой, и до него
 * число неизвестно (\`null\`), что экран и говорит.
 */
import { logger } from "../../logger";
import { loadObservations } from "../../services/analytics/observations";
import { countSuspiciousItems } from "./psychometrics";

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

const entries = new Map<string, SuspiciousEntry>();
let running = false;

/** Готовое число теста; \`undefined\` — ещё не посчитано. */
export function suspiciousEntry(testId: string): SuspiciousEntry | undefined {
  return entries.get(testId);
}

/** Сбросить состояние — для тестов. */
export function resetSuspiciousEntries(): void {
  entries.clear();
}

/**
 * Один проход пересчёта: тесты с новыми прохождениями — заново, остальные — как были.
 *
 * Повторный вызов во время прохода ничего не делает: два прохода считали бы одно и то же дважды.
 *
 * @param compute расчёт одного теста — подменяется в тестах
 */
export async function refreshSuspicious(
  compute: (testId: string) => Promise<{ suspicious: number; items: number } | null> = countSuspiciousItems,
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
    // Тест без прохождений из сводки уходит: говорить о нём нечего.
    for (const testId of [...entries.keys()]) {
      if (!lastByTest.has(testId)) entries.delete(testId);
    }
    for (const [testId, lastAttemptAt] of lastByTest) {
      if (entries.get(testId)?.lastAttemptAt === lastAttemptAt) continue;
      try {
        const result = await compute(testId);
        if (result === null) continue;
        entries.set(testId, {
          count: result.suspicious,
          items: result.items,
          passages: passagesByTest.get(testId) ?? 0,
          computedAt: new Date().toISOString(),
          lastAttemptAt,
        });
      } catch (error) {
        // Сбой одного теста не роняет проход: остальные числа нужны не меньше.
        logger.warn(`Э3.4: вопросы под подозрением теста ${testId} не посчитаны — ${(error as Error).message}`, "analytics");
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
