/**
 * @module scripts/db/seed-answer-types-demo
 * @description Э4а UX-аудита аналитики: синтетический тест со всеми типами ответов для приёмки
 * распределения ответов (эскиз approved/e4a-answer-distribution.html).
 *
 * На живой дев-базе нет ни одного прохождения с ответами на сопоставление, ранжирование,
 * пропуски, короткий и развёрнутый ответ — новые виды экрана проверить нечем. Скрипт заводит
 * один тест «Э4а демо: все типы ответов» с восемью вопросами и сорока участниками, у которых
 * ответы зависят от способности: сильные чаще правы, слабые путают одно и то же. Один вопрос
 * выдан шести участникам — на нём видно «мало данных».
 *
 * ДАННЫЕ СИНТЕТИЧЕСКИЕ И ПОМЕЧЕНЫ: всё несёт префикс «Э4а демо», участники — почту на
 * `@e4a-demo.local`, и `--drop` убирает это подчистую: дев-база общая.
 *
 * Required environment variables:
 *   - DATABASE_URL   база, в которую кладём демо-данные
 *
 * Usage:
 *   npm run answers:demo           — создать (повторный запуск пересоздаёт)
 *   npm run answers:demo -- --drop — убрать
 */

import { randomUUID } from "node:crypto";

import pg from "pg";

import { computePsychoHash } from "../../shared/questions/psycho-hash";
import { loadEnv, loadConfiguration } from "../../server/config-loader.mjs";

const { Pool } = pg;

/** Метка, по которой демо-данные узнаются и удаляются. */
const MARK = "Э4а демо";
/** Сколько участников. */
const PEOPLE = 40;
/** Сколько участников видели «новый» вопрос — меньше порога в 10 наблюдений. */
const FEW = 6;

/** Исход ответа участника: сам ответ и баллы. */
interface Answered {
  answer: unknown;
  earned: number;
  possible: number;
}

/** Вопрос демо: как он лежит в базе и как на него отвечают. */
interface DemoQuestion {
  id: string;
  type: "single" | "multiple" | "matching" | "ranking" | "short" | "blanks" | "long";
  prompt: string;
  data: Record<string, unknown>;
  correct: Record<string, unknown>;
  declared: number | null;
  /** Ответ участника со способностью `ability` (0–1) и номером `index`. */
  respond: (ability: number, index: number, rnd: () => number) => Answered;
  /** Вопрос выдан только первым `FEW` участникам. */
  rare?: boolean;
  /** Время на вопрос, мс — у развёрнутого ответа дольше. */
  latency: (rnd: () => number) => number;
}

/** Повторяемая псевдослучайность: демо одинаково при каждом запуске. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const pick = <T,>(rnd: () => number, items: readonly T[]): T => items[Math.floor(rnd() * items.length)];

const MATCH_LEFT = ["Приказы по личному составу", "Трудовые договоры", "Журнал инструктажей", "Табели учёта рабочего времени"];
const MATCH_RIGHT = ["75 лет", "50 лет", "10 лет", "5 лет"];
/** С чем путают каждую пару и насколько пара трудна (добавка к порогу верного). */
const MATCH_CONFUSION = [1, 0, 3, 2];
const MATCH_HARDNESS = [0.35, 0.25, 0.05, 0.25];

const RANK_ITEMS = ["Запрос документов у контрагента", "Проверка по открытым реестрам", "Оценка рисков сделки", "Решение о заключении договора"];

const LONG_ANSWERS = [
  "Сначала поговорю с сотрудником и попрошу его письменно уведомить работодателя о возникшем конфликте. Затем сообщу в отдел комплаенса и, до решения комиссии, передам задачи, связанные с контрагентом, другому сотруднику. Проконтролирую, чтобы решение было оформлено приказом.",
  "Сообщу руководителю и в службу безопасности, отстраню сотрудника от работы с этим контрагентом до проверки.",
  "Уведомлю комплаенс и отстраню от сделки.",
  "Попрошу сотрудника заполнить декларацию о конфликте интересов, передам её в комиссию по этике и до её решения ограничу его доступ к документам по сделке. После решения комиссии зафиксирую принятые меры и сообщу о них руководителю подразделения.",
  "Ничего, если сотрудник сам не сообщил.",
];

function questions(): DemoQuestion[] {
  return [
    {
      id: randomUUID(), type: "matching", declared: 40,
      prompt: "Сопоставьте документ и срок его хранения",
      data: { left: MATCH_LEFT, right: MATCH_RIGHT },
      correct: { pairs: MATCH_LEFT.map((_, i) => ({ left: i, right: i })) },
      respond: (ability, _i, rnd) => {
        const answer: Record<string, number> = {};
        let ok = 0;
        MATCH_LEFT.forEach((_, i) => {
          const right = rnd() < ability + 0.45 - MATCH_HARDNESS[i] ? i : MATCH_CONFUSION[i];
          answer[String(i)] = right;
          if (right === i) ok += 1;
        });
        return { answer, earned: ok / 4, possible: 1 };
      },
      latency: rnd => 60_000 + rnd() * 70_000,
    },
    {
      id: randomUUID(), type: "ranking", declared: null,
      prompt: "Расположите этапы проверки контрагента по порядку",
      data: { items: RANK_ITEMS },
      correct: { correctOrder: [0, 1, 2, 3] },
      respond: (ability, _i, rnd) => {
        const order = [0, 1, 2, 3];
        // Слабые меняют местами соседние этапы в середине — там порядок неочевиден.
        if (rnd() > ability + 0.35) [order[1], order[2]] = [order[2], order[1]];
        if (rnd() > ability + 0.55) [order[2], order[3]] = [order[3], order[2]];
        if (rnd() > ability + 0.75) [order[0], order[1]] = [order[1], order[0]];
        const ok = order.filter((item, at) => item === at).length;
        return { answer: order, earned: ok / 4, possible: 1 };
      },
      latency: rnd => 50_000 + rnd() * 60_000,
    },
    {
      id: randomUUID(), type: "blanks", declared: 55,
      prompt: "Конфликт интересов — ситуация, при которой {{kind}} заинтересованность работника влияет на исполнение обязанностей. О возникшем конфликте работник уведомляет работодателя в течение {{days}} рабочих дней.",
      data: {},
      correct: {
        blanks: [
          { id: "kind", answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "личная" }] },
          { id: "days", answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 3 }] },
        ],
      },
      respond: (ability, _i, rnd) => {
        const kind = rnd() < ability + 0.45 ? pick(rnd, ["личная", "Личная"]) : pick(rnd, ["прямая", "материальная"]);
        const days = rnd() < ability + 0.1 ? "3" : pick(rnd, ["5", "10", "1"]);
        const ok = (kind.toLowerCase() === "личная" ? 1 : 0) + (days === "3" ? 1 : 0);
        return { answer: { kind, days }, earned: ok / 2, possible: 1 };
      },
      latency: rnd => 55_000 + rnd() * 70_000,
    },
    {
      id: randomUUID(), type: "short", declared: 30,
      prompt: "Как называется документ, в котором работник сообщает о конфликте интересов?",
      data: {},
      correct: {
        answerKind: "text", join: "any",
        rules: [
          { kind: "text", match: "wildcard", value: "декларация" },
          { kind: "text", match: "wildcard", value: "декларация о конфликте интересов" },
        ],
      },
      respond: (ability, _i, rnd) => {
        const answer = rnd() < ability + 0.4
          ? pick(rnd, ["декларация", "Декларация", "декларация о конфликте интересов"])
          : pick(rnd, ["уведомление", "декларацыя", "справка", "заявление", "служебная записка"]);
        const ok = ["декларация", "декларация о конфликте интересов"].includes(answer.toLowerCase());
        return { answer, earned: ok ? 1 : 0, possible: 1 };
      },
      latency: rnd => 20_000 + rnd() * 40_000,
    },
    {
      id: randomUUID(), type: "short", declared: 50,
      prompt: "Сколько рабочих дней даётся на уведомление о конфликте интересов?",
      data: {},
      correct: { answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 3 }] },
      respond: (ability, _i, rnd) => {
        const answer = rnd() < ability + 0.15 ? "3" : pick(rnd, ["1", "2", "5", "5", "10", "14"]);
        return { answer, earned: answer === "3" ? 1 : 0, possible: 1 };
      },
      latency: rnd => 15_000 + rnd() * 30_000,
    },
    {
      id: randomUUID(), type: "long", declared: 45,
      prompt: "Опишите свои действия при выявлении конфликта интересов у подчинённого",
      data: {},
      correct: {},
      respond: (_ability, index) => ({ answer: LONG_ANSWERS[index % LONG_ANSWERS.length], earned: 0, possible: 0 }),
      latency: rnd => 240_000 + rnd() * 360_000,
    },
    {
      id: randomUUID(), type: "multiple", declared: 50,
      prompt: "Какие сведения относятся к персональным данным?",
      data: { options: ["ФИО", "Номер паспорта", "Адрес регистрации", "Должность", "Стаж работы"] },
      correct: { correctIndices: [0, 1, 2] },
      respond: (ability, _i, rnd) => {
        const chosen = [0, 1, 2].filter(i => rnd() < ability + [0.6, 0.45, 0.2][i]);
        if (rnd() > ability + 0.3) chosen.push(3);
        if (rnd() > ability + 0.7) chosen.push(4);
        const c = chosen.filter(i => i < 3).length;
        const x = chosen.length - c;
        return { answer: chosen, earned: Math.max(0, (c - x) / 3), possible: 1 };
      },
      latency: rnd => 40_000 + rnd() * 50_000,
    },
    {
      id: randomUUID(), type: "single", declared: null, rare: true,
      prompt: "Кто утверждает график отпусков?",
      data: { options: ["Работодатель с учётом мнения профсоюза", "Сам работник", "Отдел кадров", "Бухгалтерия"] },
      correct: { correctIndex: 0 },
      respond: (ability, _i, rnd) => {
        const answer = rnd() < ability + 0.3 ? 0 : pick(rnd, [1, 2, 3]);
        return { answer, earned: answer === 0 ? 1 : 0, possible: 1 };
      },
      latency: rnd => 30_000 + rnd() * 30_000,
    },
  ];
}

async function main(): Promise<void> {
  loadEnv();
  const cfg = await loadConfiguration();
  const databaseUrl = (cfg.database as { url?: string } | undefined)?.url ?? "";
  if (!databaseUrl) {
    console.error("[answers-demo] DATABASE_URL must be set");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  try {
    await drop(pool);
    if (!process.argv.includes("--drop")) await seed(pool);
  } finally {
    await pool.end();
  }
}

/** Убрать демо-данные подчистую: дев-база общая. */
async function drop(pool: pg.Pool): Promise<void> {
  const { rows: tests } = await pool.query<{ id: string }>("SELECT id FROM tests WHERE title LIKE $1", [`${MARK}%`]);
  for (const test of tests) {
    await pool.query("DELETE FROM attempts WHERE test_id = $1", [test.id]);
    await pool.query("DELETE FROM test_sections WHERE test_id = $1", [test.id]);
    await pool.query("DELETE FROM tests WHERE id = $1", [test.id]);
  }
  await pool.query("DELETE FROM questions WHERE topic_id IN (SELECT id FROM topics WHERE name LIKE $1)", [`${MARK}%`]);
  await pool.query("DELETE FROM topics WHERE name LIKE $1", [`${MARK}%`]);
  const { rowCount } = await pool.query("DELETE FROM users WHERE email LIKE '%@e4a-demo.local'");
  if (tests.length > 0 || rowCount) console.log(`[answers-demo] убрано тестов: ${tests.length}, участников: ${rowCount}`);
}

async function seed(pool: pg.Pool): Promise<void> {
  const rnd = seeded(20261004);
  const bank = questions();

  const topicId = randomUUID();
  const topicName = `${MARK}: банк всех типов ответов`;
  await pool.query("INSERT INTO topics (id, name, description) VALUES ($1, $2, $3)",
    [topicId, topicName, "Синтетическая тема приёмки распределения ответов"]);
  const hashes: Record<string, string> = {};
  for (const q of bank) {
    hashes[q.id] = computePsychoHash({ type: q.type, prompt: q.prompt, dataJson: q.data, correctJson: q.correct });
    await pool.query(
      `INSERT INTO questions (id, topic_id, type, prompt, data_json, correct_json, psycho_hash, difficulty)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [q.id, topicId, q.type, q.prompt, JSON.stringify(q.data), JSON.stringify(q.correct), hashes[q.id], q.declared],
    );
  }

  const testId = randomUUID();
  await pool.query(
    `INSERT INTO tests (id, title, description, overall_pass_rule_json, default_question_points)
     VALUES ($1, $2, $3, $4, 1)`,
    [testId, `${MARK}: все типы ответов`, "Синтетический тест приёмки распределения ответов",
      JSON.stringify({ type: "percent", value: 70 })],
  );
  await pool.query(
    `INSERT INTO test_sections (id, test_id, topic_id, draw_count, draw_all, sort_order)
     VALUES ($1, $2, $3, $4, true, 0)`,
    [randomUUID(), testId, topicId, bank.length],
  );

  for (let index = 0; index < PEOPLE; index += 1) {
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, email_hash, password_hash, name, status, gdpr_consent)
       VALUES ($1, $2, $3, 'demo', $4, 'active', true)`,
      [userId, `p${index}@e4a-demo.local`, `e4a-demo-${userId}`, `${MARK}: участник ${index + 1}`],
    );
    const ability = index / (PEOPLE - 1);
    const delivered = bank.filter(q => !q.rare || index < FEW);
    const answers: Record<string, unknown> = {};
    const latencies: Record<string, number> = {};
    const outcomes: Array<{ questionId: string; result: string; earned: number; possible: number }> = [];
    for (const q of delivered) {
      const r = q.respond(ability, index, rnd);
      answers[q.id] = r.answer;
      latencies[q.id] = Math.round(q.latency(rnd));
      outcomes.push({
        questionId: q.id,
        result: r.possible === 0 ? "pending" : r.earned === r.possible ? "correct" : r.earned > 0 ? "partial" : "incorrect",
        earned: r.earned,
        possible: r.possible,
      });
    }
    const earned = outcomes.reduce((s, o) => s + o.earned, 0);
    const possible = outcomes.reduce((s, o) => s + o.possible, 0);
    const startedAt = new Date(Date.UTC(2026, 8, 20 + (index % 10), 9, index % 60, 0));
    await pool.query(
      `INSERT INTO attempts (id, user_id, test_id, test_version, variant_json, answers_json, result_json, started_at, finished_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)`,
      [
        randomUUID(), userId, testId,
        JSON.stringify({ sections: [{ topicId, topicName, questionIds: delivered.map(q => q.id) }], psychoHashes: hashes, latencyMs: latencies }),
        JSON.stringify(answers),
        JSON.stringify({
          overallPercent: possible > 0 ? Math.round((earned / possible) * 100) : 0,
          overallPassed: possible > 0 && earned / possible >= 0.7,
          totalEarnedPoints: earned,
          totalPossiblePoints: possible,
          questionOutcomes: outcomes,
          gradingComplete: true,
        }),
        startedAt,
        new Date(startedAt.getTime() + 18 * 60 * 1000),
      ],
    );
  }
  console.log(`[answers-demo] тест: ${testId}; участников: ${PEOPLE}; убрать: npm run answers:demo -- --drop`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`[answers-demo] ${(error as Error).message}`);
    process.exit(1);
  },
);
