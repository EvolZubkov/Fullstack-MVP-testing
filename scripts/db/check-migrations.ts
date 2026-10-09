/**
 * @module scripts/db/check-migrations
 *
 * Стартовая проверка dev-БД: не отстала ли схема от кода.
 *
 * ЗАЧЕМ. На стендах миграции применяет сам деплой (`deploy.sh` -> `drizzle-kit migrate`
 * в одноразовом контейнере перед стартом приложения). Локальная dev-БД была исключением:
 * `npm run dev` схему не трогает, поэтому сгенерированная миграция могла неделями не
 * доезжать до базы, пока код её колонку уже читает. Проявляется это не понятной ошибкой,
 * а падением запроса в середине работы — «column does not exist».
 *
 * ЧТО ДЕЛАЕТ. Сверяет `drizzle/meta/_journal.json` с журналом применения в базе ПО ХЕШУ
 * файла (так же, как `reconcile-migration-ledger`: `migrate` сравнивает время, а хеш —
 * единственный надёжный признак того, какая именно миграция лежит в строке) ИЛИ по
 * времени: строка журнала с `created_at`, равным `when` миграции, — та же миграция,
 * применённая из текста до финальной правки. Без второго признака проверка требовала
 * повторить уже сделанное, к ней привыкали отключать её, и тогда пропускалась и настоящая
 * миграция (2026-10-01: ложные 0037/0038 прятали действительно неприменённую 0045).
 * Непримененные аддитивные миграции применяет сам, о разрушительных — сообщает и НЕ применяет.
 *
 * ПОЧЕМУ РАЗРУШИТЕЛЬНЫЕ НЕ АВТОМАТОМ. Dev-БД одна на все параллельные сессии и рабочие
 * копии. `ADD COLUMN` со значением по умолчанию совместим со старым кодом — соседняя сессия
 * его просто не заметит. А `DROP COLUMN` или переименование ломает чужую сессию мгновенно и
 * без предупреждения, поэтому такое решение принимает человек, запуская `npm run db:migrate`.
 *
 * НЕ РАБОТАЕТ В ПРОДЕ. При `NODE_ENV=production` выходит немедленно: там схему ведёт деплой.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Одна запись журнала в том виде, в каком её пишет drizzle-kit. */
interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export interface PendingMigration {
  tag: string;
  /** Меняет ли миграция схему необратимо для уже работающего кода. */
  destructive: boolean;
  /** Операции, из-за которых миграция признана разрушительной. */
  reasons: string[];
}

/** Журнал применения — путь обязан совпадать с `migrations` в `drizzle.config.ts`. */
const LEDGER = '"drizzle"."__drizzle_migrations"';

/**
 * Операции, после которых старый код перестаёт работать: колонка исчезает или меняет имя,
 * таблица пропадает, тип сужается. Список намеренно грубый — ошибиться следует в сторону
 * «спросить человека», а не «сделать молча».
 */
const DESTRUCTIVE = [
  { re: /\bDROP\s+TABLE\b/i, what: "DROP TABLE" },
  { re: /\bDROP\s+COLUMN\b/i, what: "DROP COLUMN" },
  { re: /\bRENAME\s+(COLUMN|TO)\b/i, what: "RENAME" },
  { re: /\bALTER\s+COLUMN\b[\s\S]{0,80}?\bTYPE\b/i, what: "ALTER COLUMN TYPE" },
  { re: /\bDROP\s+(CONSTRAINT|INDEX)\b/i, what: "DROP CONSTRAINT/INDEX" },
  { re: /\bTRUNCATE\b/i, what: "TRUNCATE" },
];

/** Разбор одной миграции: что в ней такого, из-за чего её нельзя применить молча. */
export function classifyMigration(sqlText: string): { destructive: boolean; reasons: string[] } {
  const reasons = DESTRUCTIVE.filter((rule) => rule.re.test(sqlText)).map((rule) => rule.what);
  return { destructive: reasons.length > 0, reasons };
}

/**
 * Что из журнала ещё не применено к базе.
 *
 * @param appliedHashes Хеши, уже лежащие в журнале применения базы.
 * @param root Корень репозитория (там лежит каталог `drizzle`).
 * @param appliedWhens `created_at` строк журнала применения: совпадение с `when` миграции
 *   значит, что она применена, даже если её текст потом поправили.
 */
export function pendingFromJournal(
  appliedHashes: Set<string>,
  root = process.cwd(),
  appliedWhens: ReadonlySet<number> = new Set(),
): PendingMigration[] {
  const journalPath = path.join(root, "drizzle", "meta", "_journal.json");
  if (!existsSync(journalPath)) return [];
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: JournalEntry[] };
  const out: PendingMigration[] = [];
  for (const entry of journal.entries) {
    if (appliedWhens.has(entry.when)) continue;
    const file = path.join(root, "drizzle", `${entry.tag}.sql`);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    if (appliedHashes.has(hash)) continue;
    const { destructive, reasons } = classifyMigration(text);
    out.push({ tag: entry.tag, destructive, reasons });
  }
  return out;
}

/** Код ошибки PostgreSQL — из-под всех обёрток, в которые его укутал drizzle. */
function errorCode(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e != null && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * Означает ли ошибка, что журнала применения в базе просто нет (42P01).
 *
 * Отличать это от недоступной базы обязательно. Пока оба случая читались одинаково —
 * «применено ничего», — потушенный контейнер выглядел как схема, отставшая на все
 * миграции разом, и проверка советовала применить их руками. Совет, выполненный на
 * живой базе, снёс бы колонки; настоящей же причиной был остановленный docker.
 */
export function isMissingLedgerError(error: unknown): boolean {
  return errorCode(error) === "42P01";
}

/**
 * Сообщение об ошибке вместе со всеми вложенными причинами.
 *
 * Само по себе `error.message` у drizzle — это «Failed query: SELECT … params:», а
 * жалоба драйвера (ECONNREFUSED, «password authentication failed») лежит в `cause`.
 * Печатать надо всю цепочку, иначе оператор видит запрос и не видит причины.
 *
 * У недоступной базы причина приходит `AggregateError`, и текста в ней НЕТ — весь
 * смысл несёт поле `code`. Поэтому уровень без сообщения представляет свой код: без
 * этого строка обрывалась на «Failed query», то есть ровно там, где начинается ответ
 * на вопрос «почему».
 */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error, depth = 0; e != null && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const message = (e as { message?: unknown }).message;
    const code = (e as { code?: unknown }).code;
    const part = typeof message === "string" && message
      ? message
      : typeof code === "string" ? code : "";
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts.join(" | ") || String(error);
}

/** Что журнал применения знает о миграциях: их хеши и время применения. */
interface AppliedLedger {
  hashes: Set<string>;
  whens: Set<number>;
}

/** Журнал применённых миграций; пустой, если журнала в базе ещё нет. */
async function readAppliedLedger(): Promise<AppliedLedger> {
  // Окружение и конфиг поднимаются так же, как в `reconcile-migration-ledger`: без них
  // подключение к базе не собирается, а молча возвращённое «ничего не применено» было бы
  // худшим из исходов — проверка объявила бы отставшей полностью актуальную схему.
  const { loadEnv } = await import("../../server/config-loader.mjs");
  const { initConfig } = await import("../../server/config");
  loadEnv();
  await initConfig();
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  try {
    const result = await db.execute(sql.raw(`SELECT hash, created_at FROM ${LEDGER}`));
    const rows = (result as unknown as {
      rows: Array<{ hash: string; created_at: string | number | null }>;
    }).rows;
    return {
      hashes: new Set(rows.map((r) => r.hash)),
      // `created_at` — bigint, драйвер отдаёт его строкой.
      whens: new Set(rows.map((r) => Number(r.created_at)).filter((n) => Number.isFinite(n))),
    };
  } catch (e) {
    // Журнала нет — база либо пустая, либо старше эпохи migrate. Решать это должен
    // человек, а не стартовая проверка: она сообщает и не мешает поднять сервер.
    if (isMissingLedgerError(e)) {
      console.warn(`[db] журнал миграций отсутствует: ${describeError(e)}`);
      return { hashes: new Set(), whens: new Set() };
    }
    // Любая другая ошибка — не ответ «применено ничего», а отсутствие ответа вовсе.
    // Пусть её увидит внешний обработчик и скажет о недоступной базе.
    throw e;
  }
}

/**
 * Проверка перед стартом dev-сервера. Возвращает код выхода процесса.
 */
export async function checkMigrations(): Promise<number> {
  if (process.env.NODE_ENV === "production") return 0;
  if (process.env.SKIP_MIGRATION_CHECK === "1") return 0;

  let applied: AppliedLedger;
  try {
    applied = await readAppliedLedger();
  } catch (e) {
    // База недоступна — это отдельная беда, и сообщит о ней сам сервер. Проверка схемы
    // не должна быть тем, что мешает его запустить.
    console.warn(`[db] проверка миграций пропущена: база недоступна (${describeError(e)})`);
    return 0;
  }

  const pending = pendingFromJournal(applied.hashes, process.cwd(), applied.whens);
  if (pending.length === 0) return 0;

  const destructive = pending.filter((p) => p.destructive);
  if (destructive.length > 0) {
    console.error("");
    console.error("[db] Схема dev-БД отстала от кода, и среди неприменённых миграций есть");
    console.error("     необратимые для уже работающего кода — применяйте их сами:");
    for (const p of pending) {
      const mark = p.destructive ? `  ← ${p.reasons.join(", ")}` : "";
      console.error(`       ${p.tag}${mark}`);
    }
    console.error("");
    console.error("     Dev-БД одна на все рабочие копии: снятая колонка сломает соседнюю");
    console.error("     сессию мгновенно. Убедитесь, что это уместно, и выполните:");
    console.error("       npm run db:migrate");
    console.error("");
    return 1;
  }

  console.log(`[db] Применяю неприменённые миграции (${pending.map((p) => p.tag).join(", ")})…`);
  execFileSync("npx", ["--no-install", "drizzle-kit", "migrate"], { stdio: "inherit", shell: true });
  console.log("[db] Схема dev-БД в актуальном состоянии.");
  return 0;
}

// CLI: используется как `predev`-шаг.
const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/db/check-migrations.ts");
if (invokedDirectly) {
  checkMigrations()
    .then(async (code) => {
      const { closeDatabaseConnection } = await import("../../server/db");
      await closeDatabaseConnection();
      process.exit(code);
    })
    .catch(async (e) => {
      console.error(`[db] проверка миграций сорвалась: ${(e as Error).message}`);
      process.exit(1);
    });
}
