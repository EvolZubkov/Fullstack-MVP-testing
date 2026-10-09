/**
 * @module tests/helpers/observations-double
 * @description Тестовый двойник DAL-выборки прохождений (PRD-56 FR-33).
 *
 * Маршрутные тесты задают данные через `getAllAttempts` / `getAllScormAttempts`, а страница
 * теста читает их теперь через `selectObservations`. Двойник берёт ТЕ ЖЕ данные и повторяет
 * контракт выборки: отбор по тесту и источнику, устойчивый порядок, общее число. Настоящая
 * выборка проверяется на реальной базе (`tests/it/analytics-observations.it.test.ts`) — здесь
 * нужен лишь источник строк, иначе каждый маршрутный тест пришлось бы переписывать на pglite.
 */
import type { ObservationQuery, ObservationRows } from "../../server/storage/analytics-repository";

interface Sources {
  getAllAttempts: () => Promise<unknown[]> | unknown[];
  getAllScormAttempts?: () => Promise<unknown[]> | unknown[];
  getScormPackages?: () => Promise<unknown[]> | unknown[];
}

/** Прочитать замоканную таблицу: `vi.fn()` без реализации отдаёт `undefined`, а не список. */
async function rowsOf(
  read: (() => Promise<unknown[]> | unknown[]) | undefined,
): Promise<Array<Record<string, unknown>>> {
  if (!read) return [];
  return ((await read()) as Array<Record<string, unknown>>) ?? [];
}

/**
 * Исход строки — грубее, чем в нормализации, но по тому же правилу: незавершённое отличается
 * от несдавшего, а прохождение без вердикта — от них обоих. Тонкости (записанный ноль баллов,
 * адаптив) проверяются на настоящей выборке в интеграционных тестах.
 */
function outcomeOf(row: Record<string, unknown>, source: string): string {
  if (!row.finishedAt) return "incomplete";
  const passed = source === "web"
    ? (row.resultJson as { overallPassed?: boolean } | null)?.overallPassed
    : row.resultPassed;
  if (passed === true) return "passed";
  if (passed === false) return "failed";
  return "completed";
}

/** Собрать `selectObservations` поверх уже замоканных таблиц. */
export function observationsDouble(storage: Sources) {
  return async (query: ObservationQuery = {}): Promise<ObservationRows> => {
    if (query.impossible) return { web: [], lms: [], order: [], total: 0 };

    const wantsWeb = !query.sources?.length || query.sources.includes("web");
    const wantsLms = !query.sources?.length
      || query.sources.some(s => s === "telemetry" || s === "import");

    const matchesOutcome = (row: Record<string, unknown>, source: string) =>
      !query.outcomes?.length || query.outcomes.includes(outcomeOf(row, source) as never);
    // Версия публикации — колонка строки; вариант выдачи двойник не разбирает (он живёт в
    // `variant_json` посекционно и проверяется на настоящей выборке).
    const matchesSnapshot = (row: Record<string, unknown>) =>
      !query.snapshotIds?.length || query.snapshotIds.includes(row.snapshotId as string);
    // Поимённый отбор: присутствие поля — уже условие, пустой список — ни одной строки.
    const matchesIds = (row: Record<string, unknown>) =>
      !query.attemptIds || query.attemptIds.includes(row.id as string);

    const web = wantsWeb
      ? (await rowsOf(storage.getAllAttempts)).filter(
          row => (!query.testIds || query.testIds.includes(row.testId as string))
            && matchesOutcome(row, "web")
            && matchesSnapshot(row)
            && matchesIds(row),
        )
      : [];
    // PRD-54: у части старых строк телеметрии своего `test_id` нет — тест известен через
    // пакет. Настоящая выборка это учитывает, значит и двойник обязан.
    const packages = await rowsOf(storage.getScormPackages);
    const testOfPackage = new Map(packages.map(p => [p.id as string, p.testId as string]));
    const lms = wantsLms
      ? (await rowsOf(storage.getAllScormAttempts)).filter(row => {
          const testId = (row.testId as string) ?? testOfPackage.get(row.packageId as string);
          return (!query.testIds || query.testIds.includes(testId))
            && matchesOutcome(row, "lms")
            && matchesSnapshot(row)
            && matchesIds(row);
        })
      : [];

    const order = [
      ...web.map(row => ({ id: row.id as string, source: "web" as const, startedAt: row.startedAt })),
      ...lms.map(row => ({
        id: row.id as string,
        source: (row.origin as "telemetry" | "import") ?? "telemetry",
        startedAt: row.startedAt,
      })),
    ].sort((a, b) => new Date(b.startedAt as string).getTime() - new Date(a.startedAt as string).getTime());

    // Порция и общее число — как в настоящей выборке: `total` не зависит от лимита.
    const offset = query.offset ?? 0;
    const page = query.limit === undefined
      ? order.slice(offset)
      : order.slice(offset, offset + query.limit);
    const ids = new Set(page.map(k => k.id));

    return {
      web: web.filter(row => ids.has(row.id as string)) as never,
      lms: lms.filter(row => ids.has(row.id as string)) as never,
      order: page.map(({ id, source }) => ({ id, source })),
      total: order.length,
    };
  };
}
