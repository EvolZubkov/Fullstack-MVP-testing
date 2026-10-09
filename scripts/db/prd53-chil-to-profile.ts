/**
 * @module scripts/db/prd53-chil-to-profile
 *
 * Перевод опросника ЧИЛ с ВРЕМЕННОГО решения (битовая маска в числовых диапазонах) на штатную
 * механику PRD-53 «Профиль по группе шкал».
 *
 * ЧТО БЫЛО. До этой правки набор ведущих стилей кодировался числом 1..15 (Ц=1, В=2, К=4, П=8),
 * показатель объявлялся ЧИСЛОВЫМ, а пятнадцать текстов лежали ДИАПАЗОНАМИ вида `9..9`. Работало
 * это потому, что карточка итогов ветвится по типу ЗНАЧЕНИЯ, а не по объявленному типу показателя.
 * Обе опоры — детали реализации, а не обещания продукта.
 *
 * ЧТО СТАНЕТ. Показатель `profile_summary` считает `topGroup([...], 5).code` и возвращает КОД
 * НАБОРА (`cel+pro`); тексты переезжают в ИСХОДЫ с этими кодами. `lead_style` и `other_styles`
 * читают тот же код через `var()`, поэтому правило верхней зоны остаётся в базе в единственном
 * экземпляре.
 *
 * ЧТО ОСТАЁТСЯ НЕТРОНУТЫМ и почему:
 *
 *  - **Диапазоны маски.** Экран итогов берёт из попытки ЗНАЧЕНИЯ, а толкование — из ТЕКУЩЕЙ
 *    конфигурации. У попыток, завершённых до перевода, значение показателя — ЧИСЛО, и читается оно
 *    диапазонами. Сотри их — и человек, открывший свой прошлый результат, увидит пустую карточку.
 *  - **Старые исходы** (`cel`/`vdo`/`kom`/`pro` от версии до пилота) — по той же причине: у самых
 *    ранних попыток значение это СТРОКА-ключ ведущей шкалы.
 *  - **`other_styles`** гасится, но не удаляется: его значения лежат в прошлых попытках.
 *
 * Порядок работ ВАЖЕН: скрипт применяется ТОЛЬКО после того, как код с источником `topGroup`
 * доехал до установки. Применение раньше оставит тест без результата — формулу будет некому
 * разобрать.
 *
 * Чистый SQL в ОДНОЙ транзакции, без слоя `storage`: живые установки отстают по миграциям, и
 * поимённое перечисление колонок текущим кодом падает на их схеме первым же SELECT.
 *
 * Запуск: DATABASE_URL=... TEST_ID=... npx tsx scripts/db/prd53-chil-to-profile.ts [--dry]
 */
import { createRequire } from "node:module";
import { loadEnv } from "../../server/config-loader.mjs";

loadEnv();

const require = createRequire(import.meta.url);
const pg = require("pg");

/** Вес стиля в битовой маске временного решения. Порядок — авторский порядок шкал теста. */
const BITS: ReadonlyArray<{ key: string; bit: number }> = [
  { key: "cel", bit: 1 },
  { key: "vdo", bit: 2 },
  { key: "kom", bit: 4 },
  { key: "pro", bit: 8 },
];

const GROUP_KEYS = BITS.map((b) => b.key);
const DELTA = 5;
const PROFILE_FORMULA = `topGroup([${GROUP_KEYS.map((k) => `"${k}"`).join(",")}], ${DELTA}).code`;
const REST_LABEL = "Ознакомьтесь с другими стилями";

const TEST_ID = process.env.TEST_ID ?? "";
if (!TEST_ID) throw new Error("нужен TEST_ID");
const DRY = process.argv.includes("--dry");

interface Band {
  min: number;
  max: number;
  label?: string;
  text?: string;
  tone?: string;
  feedback?: unknown;
}

interface VarRow {
  id: string;
  name: string;
  formula: string;
  config_json: Record<string, unknown> | null;
}

/** Код маски → код набора: `9` → `cel+pro`. Порядок ключей — авторский, как требует PRD-53 §4.1. */
function setCodeOf(mask: number): string {
  return BITS.filter((b) => (mask & b.bit) !== 0)
    .map((b) => b.key)
    .join("+");
}

/** Диапазоны маски → исходы с кодами наборов. Диапазон не «n..n» пропускается: он не про маску. */
function bandsToOutcomes(config: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const bands = (config?.bands ?? []) as Band[];
  const out: Array<Record<string, unknown>> = [];
  for (const band of bands) {
    if (band.min !== band.max) continue;
    const code = setCodeOf(band.min);
    if (!code) continue;
    const outcome: Record<string, unknown> = { code, label: band.label ?? code };
    if (band.text) outcome.text = band.text;
    if (band.tone) outcome.tone = band.tone;
    if (band.feedback) outcome.feedback = band.feedback;
    out.push(outcome);
  }
  return out;
}

/**
 * Исходы, порождённые переводом, ЗАМЕЩАЮТ одноимённые, а прочие остаются.
 *
 * Замещение, а не пропуск, — из-за коллизии, которую видно только на данных: коды одиночных
 * профилей (`cel`, `vdo`, `kom`, `pro`) СОВПАДАЮТ со старыми исходами версии до пилота, где та же
 * строка означала «ведущий стиль такой-то». Пропусти новые — и профиль из одного стиля напечатал
 * бы допилотный текст. Различить их нечем: у прошлых попыток значение показателя — та же строка.
 *
 * Побочное следствие названо прямо: у самых ранних попыток описание одиночного стиля станет
 * редакцией V5. Это тот же стиль с обновлённым текстом, а не чужой результат.
 *
 * Повторный прогон от этого не страдает: скрипт целиком отказывается работать на уже переведённом
 * тесте (см. проверку `topGroup` в {@link main}), поэтому затереть авторские правки он не может.
 */
function mergeOutcomes(
  existing: unknown,
  added: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const replaced = new Set(added.map((o) => String(o.code)));
  const kept = (Array.isArray(existing) ? (existing as Array<Record<string, unknown>>) : []).filter(
    (o) => !replaced.has(String(o.code ?? "")),
  );
  return [...kept, ...added];
}

/** Краткая характеристика стиля: текст до заголовка «Сильные стороны» — как в прототипе книги. */
function shortCharacteristic(text: string): string {
  const at = text.indexOf("Сильные стороны");
  return (at > 0 ? text.slice(0, at) : text).trim();
}

async function main(): Promise<void> {
  const dsn = process.env.DATABASE_URL;
  if (!dsn) throw new Error("нет DATABASE_URL");
  console.log("база:", dsn.replace(/:\/\/[^@]*@/, "://***@"));

  const client = new pg.Client({ connectionString: dsn, connectionTimeoutMillis: 10000 });
  await client.connect();

  try {
    await client.query("BEGIN");

    const vars: VarRow[] = (
      await client.query(
        `select id, name, formula, config_json from result_variables where test_id = $1 order by sort_order`,
        [TEST_ID],
      )
    ).rows;
    const byName = new Map(vars.map((v) => [v.name, v]));

    const summary = byName.get("profile_summary");
    const lead = byName.get("lead_style");
    const others = byName.get("other_styles");
    if (!summary) throw new Error("нет показателя profile_summary — тест не на временном решении");
    if (!lead) throw new Error("нет показателя lead_style");

    // Повторный прогон — отказ, а не перезапись: исходы, порождённые переводом, ЗАМЕЩАЮТ
    // одноимённые (см. {@link mergeOutcomes}), и второй прогон отменил бы правки, сделанные
    // автором после первого.
    if (summary.formula.includes("topGroup")) {
      await client.query("ROLLBACK");
      console.log("тест уже переведён на topGroup — изменений не требуется");
      return;
    }

    // ── 1. Считает код набора теперь profile_summary ───────────────────────────
    const summaryOutcomes = mergeOutcomes(
      (summary.config_json as { outcomes?: unknown })?.outcomes,
      bandsToOutcomes(summary.config_json),
    );
    await client.query(
      `update result_variables
          set type = 'string', formula = $2, config_json = config_json || $3::jsonb, updated_at = now()
        where id = $1`,
      [summary.id, PROFILE_FORMULA, JSON.stringify({ outcomes: summaryOutcomes })],
    );

    // ── 2. lead_style: те же тексты исходами, формула читает уже посчитанный код ─
    const leadOutcomes = mergeOutcomes(
      (lead.config_json as { outcomes?: unknown })?.outcomes,
      bandsToOutcomes(lead.config_json),
    );
    // Карточка «вне профиля» заменяет собой показатель other_styles: перечень собирается из
    // ОПИСАНИЙ шкал, а не из пятнадцати рукописных копий, и печатается по убыванию балла —
    // как того и требует методика.
    const restScales = { show: true, label: REST_LABEL, keys: GROUP_KEYS };
    await client.query(
      `update result_variables
          set type = 'string', formula = 'var("profile_summary")',
              config_json = config_json || $2::jsonb, updated_at = now()
        where id = $1`,
      [lead.id, JSON.stringify({ outcomes: leadOutcomes, restScales })],
    );

    // ── 3. other_styles гасится ────────────────────────────────────────────────
    if (others) {
      await client.query(
        `update result_variables set learner_visibility = 'hidden', updated_at = now() where id = $1`,
        [others.id],
      );
    }

    // ── 4. Описания стилей переезжают в сами шкалы ─────────────────────────────
    //
    // Источник — характеристики ОДИНОЧНЫХ профилей самого показателя: у кода 1 это описание
    // целеустремлённого стиля, у 2 — вдохновляющего и так далее. Брать их из книги нельзя:
    // скрипт лежит в репозитории, а книга-источник — нет.
    const singles = new Map(
      bandsToOutcomes(lead.config_json)
        .filter((o) => !String(o.code).includes("+"))
        .map((o) => [String(o.code), String(o.text ?? "")]),
    );
    let described = 0;
    const missing: string[] = [];
    for (const key of GROUP_KEYS) {
      const text = shortCharacteristic(singles.get(key) ?? "");
      if (!text) {
        missing.push(key);
        continue;
      }
      await client.query(
        `update scales set description = $3, updated_at = now() where test_id = $1 and key = $2`,
        [TEST_ID, key, text],
      );
      described++;
    }
    // Отказ, а не тихий пропуск: блок «вне профиля» без описаний напечатает голые названия, и
    // заметит это только ученик.
    if (missing.length) {
      throw new Error(`нет характеристики одиночного стиля для: ${missing.join(", ")}`);
    }

    await client.query(DRY ? "ROLLBACK" : "COMMIT");

    console.log("формула профиля:", PROFILE_FORMULA);
    console.log("исходов у profile_summary:", summaryOutcomes.length, ", у lead_style:", leadOutcomes.length);
    console.log("описаний шкал заполнено:", described, "из", GROUP_KEYS.length);
    console.log("other_styles:", others ? "погашен" : "нет — пропущено");
    console.log(DRY ? "СУХОЙ ПРОГОН — транзакция откачена" : "ЗАПИСАНО");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("ОШИБКА:", e?.stack ?? e?.message ?? e);
    process.exit(1);
  },
);
