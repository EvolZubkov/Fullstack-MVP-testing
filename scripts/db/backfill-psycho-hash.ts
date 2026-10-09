/**
 * @module scripts/db/backfill-psycho-hash
 * @description PRD-66 (FR-09a): проставляет `questions.psycho_hash` тем заданиям, у которых
 * отпечатка ещё нет, — строкам, написанным до миграции `0039`.
 *
 * Почему засыпка скриптом, а не SQL внутри миграции. Отпечаток считает
 * `shared/questions/psycho-hash`: ключи объектов канонизируются, варианты сворачиваются в пары
 * «текст -> верность» и сортируются по тексту, чтобы перестановка не рвала серию. Повторить это
 * правило на SQL значит завести ВТОРУЮ реализацию, и первая же правка первой разведёт их молча:
 * половина заданий получит отпечаток по одному правилу, половина по другому, а расхождение
 * увидится не ошибкой, а разрывом серии наблюдений на ровном месте. Скрипт зовёт ту же функцию,
 * что и слой хранения, поэтому засыпанное и записанное в рантайме совпадают по построению.
 *
 * Скрипт идемпотентен и НЕ трогает строки, у которых отпечаток уже стоит: пересчёт существующего
 * отпечатка — это и есть разрыв серии, и делать его молча нельзя.
 *
 * Required environment variables:
 *   - DATABASE_URL   база, которую засыпаем
 *
 * Usage:
 *   npm run psycho:backfill
 */

import pg from "pg";
import { computePsychoHash } from "../../shared/questions/psycho-hash";
import { loadEnv, loadConfiguration } from "../../server/config-loader.mjs";

const { Pool } = pg;

/** Сколько строк читается и пишется за один заход. */
const BATCH_SIZE = 500;

/** Задание в том виде, в каком его читает засыпка. */
interface Row {
  id: string;
  type: string;
  prompt: string;
  data_json: unknown;
  correct_json: unknown;
}

/**
 * Проставляет отпечаток всем заданиям без него, пачками.
 * @param pool - Пул подключений к базе.
 * @returns Сколько строк получило отпечаток.
 */
async function backfill(pool: pg.Pool): Promise<number> {
  let stamped = 0;
  for (;;) {
    const { rows } = await pool.query<Row>(
      `SELECT id, type, prompt, data_json, correct_json
       FROM questions
       WHERE psycho_hash IS NULL
       ORDER BY id
       LIMIT $1`,
      [BATCH_SIZE],
    );
    if (rows.length === 0) break;

    const ids = rows.map((row) => row.id);
    const hashes = rows.map((row) =>
      computePsychoHash({
        type: row.type,
        prompt: row.prompt,
        dataJson: row.data_json,
        correctJson: row.correct_json,
      }),
    );
    // Одним запросом на пачку: строки сопоставляются по позиции в двух массивах.
    await pool.query(
      `UPDATE questions AS q
       SET psycho_hash = v.hash
       FROM unnest($1::text[], $2::text[]) AS v(id, hash)
       WHERE q.id = v.id AND q.psycho_hash IS NULL`,
      [ids, hashes],
    );
    stamped += rows.length;
  }
  return stamped;
}

async function main(): Promise<void> {
  loadEnv();
  const cfg = await loadConfiguration();
  const databaseUrl = (cfg.database as { url?: string } | undefined)?.url ?? "";
  if (!databaseUrl) {
    console.error("[psycho-backfill] DATABASE_URL must be set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  try {
    const stamped = await backfill(pool);
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM questions WHERE psycho_hash IS NULL",
    );
    console.log(`[psycho-backfill] проставлено отпечатков: ${stamped}`);
    console.log(`[psycho-backfill] осталось без отпечатка: ${rows[0].count}`);
  } catch (err) {
    console.error("[psycho-backfill] database error:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(`[psycho-backfill] ${(err as Error).message}`);
    process.exit(1);
  },
);
