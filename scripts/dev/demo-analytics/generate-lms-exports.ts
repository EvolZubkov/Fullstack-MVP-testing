/**
 * @module scripts/dev/demo-analytics/generate-lms-exports
 * @description Синтезирует выгрузки отчёта LMS (формат PRD-54) для демо-пакетов из
 * `build-tests.ts`. Работает БЕЗ базы и сервера: всё нужное — идентификаторы вопросов, эталоны,
 * варианты разделов — берётся из `test.json` внутри пакета `.tbtest`.
 *
 * Данные синтетические и детерминированные (генератор случайных чисел с фиксированным зерном):
 * повторный запуск даёт те же файлы, а значит и те же числа на экране демонстрации.
 *
 * Модель ответов — логистическая: у участника способность θ (с поправкой на подразделение,
 * должность и номер попытки), у задания трудность и дискриминация. Поверх неё нарочно разложены
 * случаи, которые должна поймать вкладка «Качество заданий»: слишком лёгкое, слишком трудное,
 * испорченный ключ, слабая дискриминация, уровень угадывания, мёртвый и «перевёрнутый»
 * дистракторы, «отвечают не читая», медленное, «быстро и неверно».
 *
 * Выходные файлы:
 * - `demo-ib-lms-wave1.xlsx` — первая волна оцениваемого теста (версия публикации 1);
 * - `demo-ib-lms-wave2.xlsx` — вторая волна: пересдачи первой волны и новые участники (версия 2);
 * - `demo-style-lms.xlsx` — прохождения опросника.
 *
 * Usage:
 *   npx tsx scripts/dev/demo-analytics/generate-lms-exports.ts --dir docs/demo/analytics \
 *     [--today 2026-09-30]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { encodeLearnerResponse, RESPONSE_FORMAT_INTERACTION_ID, RESPONSE_FORMAT_VERSION } from "../../../shared/lms-export/response-codec";
import { TEST_VERSION_INTERACTION_ID, VARIANT_INTERACTION_ID, encodeVariantForms } from "../../../shared/lms-export/meta";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DIR = arg("dir", "docs/demo/analytics");

/**
 * День, к которому привязан календарь выгрузок. Даты в коде записаны относительно 2026-09-30,
 * а `--today` сдвигает их все разом: задержки и экспозиция считаются в окне последних 12
 * месяцев, и выгрузки, собранные давно, иначе тихо выпадали бы из этих экранов.
 */
const ANCHOR = Date.parse("2026-09-30T00:00:00Z");
const SHIFT = Date.parse(`${arg("today", "2026-09-30")}T00:00:00Z`) - ANCHOR;

/** Дата календаря выгрузок со сдвигом к `--today`. */
function day(iso: string): Date {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + SHIFT);
}

// ─── Случайность ──────────────────────────────────────────────────────────────

/** mulberry32: маленький детерминированный генератор. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = rng(20260930);
const uniform = (lo: number, hi: number) => lo + (hi - lo) * rand();
const chance = (p: number) => rand() < p;
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
function normal(): number {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Выбор индекса по весам. */
function weighted(weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function shuffled<T>(list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── Участники ────────────────────────────────────────────────────────────────

const SURNAMES = ["Иванов", "Петров", "Смирнов", "Кузнецов", "Попов", "Соколов", "Лебедев", "Козлов", "Новиков", "Морозов", "Волков", "Зайцев", "Павлов", "Семёнов", "Голубев", "Виноградов", "Богданов", "Воробьёв", "Фёдоров", "Михайлов", "Беляев", "Тарасов", "Белов", "Комаров", "Орлов", "Киселёв", "Макаров", "Андреев", "Ковалёв", "Ильин"];
const MALE = ["Александр", "Дмитрий", "Максим", "Сергей", "Андрей", "Алексей", "Артём", "Илья", "Кирилл", "Михаил", "Никита", "Роман", "Егор", "Павел", "Олег"];
const FEMALE = ["Анна", "Мария", "Елена", "Ольга", "Наталья", "Татьяна", "Ирина", "Екатерина", "Светлана", "Юлия", "Дарья", "Полина", "Ксения", "Алина", "Вера"];
const PATRONYMIC_ROOTS = ["Александров", "Дмитриев", "Сергеев", "Андреев", "Алексеев", "Михайлов", "Николаев", "Петров", "Иванов", "Владимиров"];

/** Подразделение и его сдвиг способности: срезы должны различаться заметно. */
const UNITS: Array<[string, number]> = [
  ["ИТ-департамент", 0.8],
  ["Отдел продаж", -0.1],
  ["Бухгалтерия", -0.7],
  ["Служба поддержки", -0.3],
  ["Юридический отдел", 0.3],
];
const POSITIONS: Array<[string, number, number]> = [
  // название, сдвиг способности, вес в выборке
  ["Специалист", 0, 5],
  ["Ведущий специалист", 0.3, 3],
  ["Руководитель группы", 0.4, 1.5],
  ["Стажёр", -0.6, 1.5],
];
const ORG = "ООО «Демо-Холдинг»";

interface Person {
  name: string;
  code: string;
  unit: string;
  position: string;
  theta: number;
}

const usedNames = new Set<string>();
function makePerson(index: number): Person {
  let name = "";
  do {
    const female = chance(0.5);
    const surname = pick(SURNAMES) + (female ? "а" : "");
    const first = pick(female ? FEMALE : MALE);
    const patronymic = pick(PATRONYMIC_ROOTS) + (female ? "на" : "ич");
    name = `${surname} ${first} ${patronymic}`;
  } while (usedNames.has(name));
  usedNames.add(name);
  const [unit, unitShift] = UNITS[weighted([3, 5, 2, 4, 2])];
  const [position, positionShift] = POSITIONS[weighted(POSITIONS.map(p => p[2]))];
  return { name, code: `DEMO-${String(index + 1).padStart(4, "0")}`, unit, position, theta: normal() + unitShift + positionShift };
}

// ─── Пакет ────────────────────────────────────────────────────────────────────

interface PkgQuestion {
  id: string;
  type: string;
  prompt: string;
  topicId: string;
  dataJson: Record<string, unknown>;
  correctJson: Record<string, unknown>;
}

interface PkgSection {
  topicId: string;
  drawCount: number;
  formSetJson: { forms: Array<{ id: string; label: string; questionIds: string[] }> } | null;
  sortOrder: number;
}

interface Pkg {
  sections: PkgSection[];
  questions: Map<string, PkgQuestion[]>;
  scales: Array<{ key: string; label: string; configJson: { bands?: Array<{ label: string; min: number; max: number }> } }>;
  variables: Array<{ name: string }>;
}

async function readPackage(file: string): Promise<Pkg> {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const manifest = JSON.parse(await zip.file("test.json")!.async("string"));
  const c = manifest.content;
  const questions = new Map<string, PkgQuestion[]>();
  for (const [topicId, list] of Object.entries(c.questionsByTopic as Record<string, PkgQuestion[]>)) {
    questions.set(topicId, [...list].sort((a, b) => ((a as unknown as { orderIndex: number }).orderIndex ?? 0) - ((b as unknown as { orderIndex: number }).orderIndex ?? 0)));
  }
  return {
    sections: [...c.sections].sort((a: PkgSection, b: PkgSection) => a.sortOrder - b.sortOrder),
    questions,
    scales: c.scales ?? [],
    variables: c.resultVariables ?? [],
  };
}

// ─── Лист выгрузки ────────────────────────────────────────────────────────────

const SERVICE_HEADERS = ["Пользователь", "Код", "Организация", "Подразделение", "Должность", "Дата активации курса", "Дата активации модуля", "Статус", "Баллы"];
const SUBHEADERS = ["Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ"];

/** Одно взаимодействие строки: тип, секунды, исход, ответ. */
interface Cell4 {
  type: string;
  seconds: number | null;
  result: string;
  answer: string;
}

interface ExportRow {
  person: Person;
  at: Date;
  passed: boolean | null;
  points: number | null;
  cells: Map<string, Cell4>;
}

const INTERACTION_TYPE: Record<string, string> = {
  single: "choice",
  multiple: "choice",
  matching: "matching",
  ranking: "sequencing",
  short: "fill-in",
  blanks: "fill-in",
  long: "long-fill-in",
  scale: "likert",
  allocation: "other",
};

async function writeExport(file: string, blockIds: string[], rows: ExportRow[]): Promise<void> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Отчёт");
  const head: string[] = [...SERVICE_HEADERS];
  const sub: string[] = SERVICE_HEADERS.map(() => "");
  for (const id of blockIds) {
    head.push(id, "", "", "");
    sub.push(...SUBHEADERS);
  }
  sheet.addRow(head);
  sheet.addRow(sub);
  for (const row of rows) {
    const values: Array<string | number | Date | null> = [
      row.person.name,
      row.person.code,
      ORG,
      row.person.unit,
      row.person.position,
      new Date(row.at.getTime() - 3 * 86400000),
      row.at,
      row.passed === null ? "" : row.passed ? "Пройден" : "Не пройден",
      row.points,
    ];
    for (const id of blockIds) {
      const cell = row.cells.get(id);
      // Невыданное задание — ВСЕ четыре подколонки пусты (PRD-66 FR-10a).
      if (!cell) values.push(null, null, null, null);
      else values.push(cell.type, cell.seconds, cell.result, cell.answer);
    }
    sheet.addRow(values);
  }
  sheet.getColumn(6).numFmt = "dd.mm.yyyy";
  sheet.getColumn(7).numFmt = "dd.mm.yyyy hh:mm";
  sheet.getColumn(1).width = 34;
  await book.xlsx.writeFile(file);
  console.log(`  выгрузка: ${file} (${rows.length} строк)`);
}

/** Время ответа: логнормальный разброс вокруг медианы. */
function seconds(median: number): number {
  return Math.max(1, Math.round(median * Math.exp(0.35 * normal())));
}

/** Дата в окне [from, to] в рабочее время. */
function dateBetween(from: Date, to: Date): Date {
  const d = new Date(from.getTime() + rand() * (to.getTime() - from.getTime()));
  d.setUTCHours(6 + Math.floor(rand() * 9), Math.floor(rand() * 60), 0, 0);
  return d;
}

// ─── Оцениваемый тест ─────────────────────────────────────────────────────────

/**
 * Роль задания закреплённого раздела по его месту (см. `CORE` в `build-tests.ts`).
 * `b` — трудность, `a` — дискриминация, `t` — медиана времени в секундах.
 */
type Role =
  | { kind: "irt"; b: number; a: number; t: number }
  | { kind: "flipped"; t: number }
  | { kind: "chance"; t: number }
  | { kind: "distractors"; t: number }
  | { kind: "rushed"; b: number; t: number }
  | { kind: "fastWrong"; t: number };

const ROLE_BY_POSITION: Role[] = [
  { kind: "irt", b: 0, a: 1.6, t: 18 },
  { kind: "irt", b: -1.2, a: 1.4, t: 14 },
  { kind: "irt", b: 3.2, a: 1.3, t: 25 }, // слишком трудное: верных меньше 20 %
  { kind: "irt", b: -3.5, a: 1.2, t: 10 }, // слишком лёгкое: верных больше 90 %
  { kind: "flipped", t: 20 }, // испорченный ключ
  { kind: "irt", b: 0, a: 0.15, t: 20 }, // слабая дискриминация
  { kind: "chance", t: 22 }, // уровень угадывания
  { kind: "distractors", t: 18 }, // мёртвый и перевёрнутый дистракторы
  { kind: "rushed", b: -0.6, t: 12 }, // отвечают не читая
  { kind: "irt", b: 0.3, a: 1.3, t: 75 }, // медленное
  { kind: "fastWrong", t: 3 }, // быстро и неверно
  { kind: "irt", b: 0.4, a: 1.5, t: 30 }, // множественный выбор
  { kind: "irt", b: 0.7, a: 1.2, t: 40 }, // сопоставление
  { kind: "irt", b: 1.0, a: 1.1, t: 45 }, // ранжирование
];

/** Решает, верен ли ответ по модели; вариант подбирается под исход. */
function irtCorrect(theta: number, b: number, a: number): boolean {
  return chance(0.12 + 0.88 * logistic(a * (theta - b)));
}

/** Неверный индекс одиночного выбора: дистракторы не одинаково привлекательны. */
function wrongOption(count: number, correct: number): number {
  const weights = Array.from({ length: count }, (_, i) => (i === correct ? 0 : 1 + i * 0.5));
  return weighted(weights);
}

function singleCell(q: PkgQuestion, choice: number, key: number, secs: number | null): Cell4 {
  return { type: "choice", seconds: secs, result: choice === key ? "correct" : "incorrect", answer: encodeLearnerResponse("single", choice) };
}

/** Ответ на задание закреплённого раздела. */
function answerCore(q: PkgQuestion, role: Role, theta: number): Cell4 {
  const options = (q.dataJson.options as string[] | undefined)?.length ?? 4;
  const key = Number(q.correctJson.correctIndex ?? 0);
  switch (role.kind) {
    case "flipped": {
      // Ключ указывает на вариант 0, по существу верен вариант 1: сильные выбирают 1.
      const truly = chance(0.1 + 0.85 * logistic(1.6 * theta));
      const choice = truly ? 1 : weighted([4, 0, 1, 1]);
      return singleCell(q, choice, key, seconds(role.t));
    }
    case "chance": {
      const choice = weighted([0.21, 0.31, 0.26, 0.22]);
      return singleCell(q, choice, key, seconds(role.t));
    }
    case "distractors": {
      const pc = 0.75 * logistic(1.2 * (theta + 0.5));
      const p1 = 0.22 * logistic(2.5 * theta); // перевёрнутый: его выбирают сильные
      const p3 = 0.01; // мёртвый
      const choice = weighted([pc, p1, 1 - pc - p1 - p3, p3]);
      return singleCell(q, choice, key, seconds(role.t));
    }
    case "rushed": {
      const rushed = chance(0.3);
      const ok = rushed ? chance(0.45) : irtCorrect(theta, role.b, 1.4);
      const choice = ok ? key : wrongOption(options, key);
      return singleCell(q, choice, key, rushed ? 0 : seconds(role.t));
    }
    case "fastWrong": {
      // Доля верных держится ниже 40 % при любой способности: иначе эффект обучения по
      // календарю вывел бы задание из-под флага «быстро и неверно».
      const ok = chance(0.15 + 0.2 * logistic(theta - 1));
      const choice = ok ? key : wrongOption(options, key);
      return singleCell(q, choice, key, seconds(role.t));
    }
    case "irt": {
      const ok = irtCorrect(theta, role.b, role.a);
      const secs = seconds(role.t);
      if (q.type === "single") return singleCell(q, ok ? key : wrongOption(options, key), key, secs);
      if (q.type === "multiple") {
        const right = (q.correctJson.correctIndices as number[]) ?? [];
        const answer = ok ? right : pick([[right[0]], [right[0], 2], [1, 3], [0, 1, 2]]);
        return { type: "choice", seconds: secs, result: ok ? "correct" : "incorrect", answer: encodeLearnerResponse("multiple", answer) };
      }
      if (q.type === "matching") {
        const answer: Record<number, number> = ok ? { 0: 0, 1: 1, 2: 2 } : pick([{ 0: 1, 1: 0, 2: 2 }, { 0: 0, 1: 2, 2: 1 }, { 0: 2, 1: 1, 2: 0 }]);
        return { type: "matching", seconds: secs, result: ok ? "correct" : "incorrect", answer: encodeLearnerResponse("matching", answer) };
      }
      const answer = ok ? [0, 1, 2, 3] : pick([[1, 0, 2, 3], [0, 2, 1, 3], [0, 1, 3, 2], [2, 0, 1, 3]]);
      return { type: "sequencing", seconds: secs, result: ok ? "correct" : "incorrect", answer: encodeLearnerResponse("ranking", answer) };
    }
  }
}

const SHORT_TEXT_RIGHT = ["вишинг", "Вишинг", "vishing", "ВИШИНГ"];
const SHORT_TEXT_WRONG = ["фишинг", "Фишинг", "социальная инженерия", "смишинг", "претекстинг", "не знаю", "телефонное мошенничество", "спуфинг"];
const NUMERIC_WRONG = ["30", "60", "5", "1", "120", "45", "3"];
const LONG_ANSWERS = [
  "Сообщу в службу ИБ.",
  "Немедленно сообщу в службу информационной безопасности, не буду ничего удалять и зафиксирую, что именно видел.",
  "Отключу компьютер от сети, сообщу руководителю и в службу ИБ, запишу время и обстоятельства, сохраню подозрительные письма и не буду пересылать их коллегам.",
  "Позвоню на горячую линию.",
  "Не знаю, наверное, спрошу коллег.",
  "Действую по регламенту реагирования на инциденты: оповещение ИБ в течение 15 минут, сохранение следов, отказ от самостоятельных попыток устранения, дальнейшие действия — по указанию дежурного специалиста.",
  "Сообщу руководителю.",
];

/** Ответ на задание раздела с вариантами или раздела со случайной выдачей. */
function answerOther(q: PkgQuestion, theta: number, shift: number): Cell4 {
  const b = shift + (Number((q as unknown as { difficulty?: number }).difficulty ?? 50) - 50) / 25;
  const ok = irtCorrect(theta, b, 1.3);
  if (q.type === "single") {
    const key = Number(q.correctJson.correctIndex ?? 0);
    return singleCell(q, ok ? key : wrongOption(4, key), key, seconds(20));
  }
  if (q.type === "short") {
    const numeric = q.correctJson.answerKind === "number";
    const answer = numeric
      ? ok ? String(pick([15, 15, 15, 10, 20, 12, 18])) : pick(NUMERIC_WRONG)
      : ok ? pick(SHORT_TEXT_RIGHT) : pick(SHORT_TEXT_WRONG);
    return { type: "fill-in", seconds: seconds(numeric ? 15 : 25), result: ok ? "correct" : "incorrect", answer };
  }
  if (q.type === "blanks") {
    const ids = ((q.correctJson.blanks as Array<{ id: string }>) ?? []).map(blank => blank.id);
    const written = ok
      ? { mailbox: pick(["soc@demo.ru", "soc@company.ru"]), attach: "вложение" }
      : { mailbox: pick(["support@demo.ru", "it@demo.ru", "soc@demo.ru"]), attach: pick(["ссылку", "скриншот", "текст"]) };
    return { type: "fill-in", seconds: seconds(35), result: ok ? "correct" : "incorrect", answer: encodeLearnerResponse("blanks", written, RESPONSE_FORMAT_VERSION, ids) };
  }
  // Развёрнутый ответ: не оценивается, исход нейтральный.
  return { type: "long-fill-in", seconds: seconds(90), result: "neutral", answer: pick(LONG_ANSWERS) };
}

interface Attempt {
  person: Person;
  attemptNo: number;
  at: Date;
  version: number | null;
}

function knowledgeRow(pkg: Pkg, attempt: Attempt): { row: ExportRow; ids: string[] } {
  const cells = new Map<string, Cell4>();
  // Пересдача: участник подготовился. Плюс эффект обучения по календарю: к концу года
  // курс доработали, и динамика сдаваемости идёт вверх, а не стоит на месте.
  const progress = clamp((attempt.at.getTime() - day("2025-10-01").getTime()) / (365 * 86400000), 0, 1);
  const theta = attempt.person.theta + 0.45 * (attempt.attemptNo - 1) + 0.2 + 1.5 * progress;
  let earned = 0;
  let possible = 0;
  const count = (id: string, cell: Cell4) => {
    cells.set(id, cell);
    if (cell.result === "correct" || cell.result === "incorrect") possible += 1;
    if (cell.result === "correct") earned += 1;
  };

  const [coreSection, formSection, drawSection] = pkg.sections;
  const core = pkg.questions.get(coreSection.topicId)!;
  core.forEach((q, i) => count(`q_${q.id}`, answerCore(q, ROLE_BY_POSITION[i], theta)));

  const forms = formSection.formSetJson!.forms;
  // Вариант Б чуть труднее — таблица вариантов покажет разницу.
  const formIndex = chance(0.5) ? 0 : 1;
  const form = forms[formIndex];
  const byId = new Map(pkg.questions.get(formSection.topicId)!.map(q => [q.id, q]));
  for (const qid of form.questionIds) count(`q_${qid}`, answerOther(byId.get(qid)!, theta, formIndex === 1 ? 0.6 : 0));

  const pool = pkg.questions.get(drawSection.topicId)!;
  for (const q of shuffled(pool).slice(0, drawSection.drawCount)) count(`q_${q.id}`, answerOther(q, theta, 0));

  const percent = possible > 0 ? (earned / possible) * 100 : 0;
  const passed = percent >= 70;
  cells.set("var_certified", { type: "other", seconds: null, result: "neutral", answer: String(passed) });
  cells.set(RESPONSE_FORMAT_INTERACTION_ID, { type: "other", seconds: null, result: "neutral", answer: String(RESPONSE_FORMAT_VERSION) });
  if (attempt.version !== null) {
    cells.set(TEST_VERSION_INTERACTION_ID, { type: "other", seconds: null, result: "neutral", answer: String(attempt.version) });
  }
  cells.set(VARIANT_INTERACTION_ID, { type: "other", seconds: null, result: "neutral", answer: encodeVariantForms([form.id]) });

  // «Баллы» — корневой `cmi.score.raw`, который пакет шлёт процентом при `max = 100`.
  return { row: { person: attempt.person, at: attempt.at, passed, points: Math.round(percent), cells }, ids: [...cells.keys()] };
}

/** Порядок блоков: вопросы разделов подряд, затем показатели и служебные блоки. */
function knowledgeBlocks(pkg: Pkg): string[] {
  const ids: string[] = [];
  for (const section of pkg.sections) for (const q of pkg.questions.get(section.topicId)!) ids.push(`q_${q.id}`);
  for (const v of pkg.variables) ids.push(`var_${v.name}`);
  ids.push(RESPONSE_FORMAT_INTERACTION_ID, TEST_VERSION_INTERACTION_ID, VARIANT_INTERACTION_ID);
  return ids;
}

async function knowledgeExports(pkg: Pkg): Promise<void> {
  rand = rng(1);
  const people = Array.from({ length: 260 }, (_, i) => makePerson(i));
  const wave1People = people.slice(0, 190);
  const newcomers = people.slice(190);

  // Волна 1: октябрь 2025 — март 2026, версия 1 (у части строк версия не сообщена).
  const wave1: ExportRow[] = [];
  const failed: Array<{ person: Person; at: Date }> = [];
  for (const person of wave1People) {
    const at = dateBetween(day("2025-10-06"), day("2026-03-27"));
    const { row } = knowledgeRow(pkg, { person, attemptNo: 1, at, version: chance(0.12) ? null : 1 });
    wave1.push(row);
    if (!row.passed) failed.push({ person, at });
  }

  // Волна 2: апрель — сентябрь 2026, версия 2. Пересдачи не сдавших + новые участники.
  const wave2: ExportRow[] = [];
  for (const [i, { person, at }] of failed.entries()) {
    const second = new Date(Math.max(at.getTime() + 20 * 86400000, day("2026-04-02").getTime() + i * 3600000));
    const retake = knowledgeRow(pkg, { person, attemptNo: 2, at: dateBetween(second, new Date(second.getTime() + 60 * 86400000)), version: 2 });
    wave2.push(retake.row);
    // Третья попытка — у тех, кто не сдал и вторую (и не у всех).
    if (!retake.row.passed && chance(0.6)) {
      const third = new Date(retake.row.at.getTime() + 14 * 86400000);
      wave2.push(knowledgeRow(pkg, { person, attemptNo: 3, at: dateBetween(third, new Date(third.getTime() + 30 * 86400000)), version: 2 }).row);
    }
  }
  for (const person of newcomers) {
    const at = dateBetween(day("2026-04-01"), day("2026-09-28"));
    wave2.push(knowledgeRow(pkg, { person, attemptNo: 1, at, version: 2 }).row);
  }

  const blocks = knowledgeBlocks(pkg);
  await writeExport(path.join(DIR, "demo-ib-lms-wave1.xlsx"), blocks, wave1.sort((a, b) => a.at.getTime() - b.at.getTime()));
  await writeExport(path.join(DIR, "demo-ib-lms-wave2.xlsx"), blocks, wave2.sort((a, b) => a.at.getTime() - b.at.getTime()));
}

// ─── Опросник ─────────────────────────────────────────────────────────────────

const MOTIVATION_TEXTS = [
  "Меньше совещаний.",
  "Понятные приоритеты от руководителя и меньше параллельных задач.",
  "Нормальный ноутбук.",
  "Больше обратной связи по результатам работы и прозрачные критерии оценки.",
  "Гибкий график и возможность работать из дома два дня в неделю.",
  "Обучение новым инструментам.",
  "Не знаю.",
  "Единая база знаний, где можно быстро найти ответы на типовые вопросы, вместо переписки в чатах.",
];

function hasBands(pkg: Pkg, key: string): boolean {
  return (pkg.scales.find(s => s.key === key)?.configJson?.bands?.length ?? 0) > 0;
}

function bandLabel(pkg: Pkg, key: string, value: number): string {
  const scale = pkg.scales.find(s => s.key === key);
  return scale?.configJson?.bands?.find(b => value >= b.min && value <= b.max)?.label ?? "";
}

async function surveyExport(pkg: Pkg): Promise<void> {
  rand = rng(2);
  const questions = pkg.questions.get(pkg.sections[0].topicId)!;
  const rows: ExportRow[] = [];
  for (let i = 0; i < 160; i += 1) {
    const person = makePerson(1000 + i);
    // Две черты, слабо связанные между собой; подразделение сдвигает проактивность.
    const proactive = normal() + (person.unit === "ИТ-департамент" ? 0.5 : 0) + (person.position === "Стажёр" ? -0.5 : 0);
    const team = 0.3 * proactive + 0.95 * normal() + (person.unit === "Служба поддержки" ? 0.5 : 0);
    const grade = (trait: number) => clamp(Math.round(2 + 1.1 * trait + 0.6 * normal()), 0, 4);

    const likert: number[] = [
      grade(proactive),
      grade(proactive),
      grade(proactive),
      grade(-proactive), // обратный, в шкале перевёрнут
      grade(team),
      grade(team),
      grade(team),
      clamp(Math.round(2 - 0.6 * team + 0.8 * normal()), 0, 4), // обратный, в шкале НЕ перевёрнут
      chance(0.93) ? 4 : 3, // мёртвый пункт
    ];
    const cells = new Map<string, Cell4>();
    likert.forEach((value, at) => {
      cells.set(`q_${questions[at].id}`, { type: "likert", seconds: seconds(8), result: "neutral", answer: encodeLearnerResponse("scale", value) });
    });

    const toResult = clamp(Math.round(4 + 1.6 * proactive + normal()), 0, 10);
    const toTeam = clamp(Math.round((10 - toResult) * logistic(team)), 0, 10 - toResult);
    const allocation = { 0: toResult, 1: toTeam, 2: 10 - toResult - toTeam };
    cells.set(`q_${questions[9].id}`, { type: "other", seconds: seconds(40), result: "neutral", answer: encodeLearnerResponse("allocation", allocation) });
    cells.set(`q_${questions[10].id}`, { type: "likert", seconds: seconds(6), result: "neutral", answer: encodeLearnerResponse("scale", weighted([2, 3, 5])) });
    // Пропусков (выдано, но не отвечено) в демо нет: импорт такую строку пока не принимает.
    cells.set(`q_${questions[11].id}`, { type: "long-fill-in", seconds: seconds(70), result: "neutral", answer: pick(MOTIVATION_TEXTS) });

    const proactiveRaw = likert[0] + likert[1] + likert[2] + (4 - likert[3]) + likert[8];
    const teamRaw = likert[4] + likert[5] + likert[6] + likert[7];
    const scaleValues: Record<string, number> = { proactive: proactiveRaw, teamwork: teamRaw, results_focus: toResult, values_mix: 10 };
    for (const [key, value] of Object.entries(scaleValues)) {
      cells.set(`scale_${key}`, { type: "other", seconds: null, result: "neutral", answer: String(value) });
      // Уровень пакет пишет только у шкалы с полосами (`buildScaleInteractions`).
      if (hasBands(pkg, key)) {
        cells.set(`scale_${key}_level`, { type: "other", seconds: null, result: "neutral", answer: bandLabel(pkg, key, value) });
      }
    }
    cells.set("var_engagement", { type: "other", seconds: null, result: "neutral", answer: String(proactiveRaw + teamRaw) });
    cells.set(RESPONSE_FORMAT_INTERACTION_ID, { type: "other", seconds: null, result: "neutral", answer: String(RESPONSE_FORMAT_VERSION) });
    cells.set(TEST_VERSION_INTERACTION_ID, { type: "other", seconds: null, result: "neutral", answer: "1" });

    rows.push({ person, at: dateBetween(day("2025-11-03"), day("2026-09-26")), passed: null, points: null, cells });
  }

  const blocks: string[] = questions.map(q => `q_${q.id}`);
  for (const s of pkg.scales) {
    blocks.push(`scale_${s.key}`);
    if (hasBands(pkg, s.key)) blocks.push(`scale_${s.key}_level`);
  }
  for (const v of pkg.variables) blocks.push(`var_${v.name}`);
  blocks.push(RESPONSE_FORMAT_INTERACTION_ID, TEST_VERSION_INTERACTION_ID);
  await writeExport(path.join(DIR, "demo-style-lms.xlsx"), blocks, rows.sort((a, b) => a.at.getTime() - b.at.getTime()));
}

async function main(): Promise<void> {
  const knowledge = await readPackage(path.join(DIR, "demo-ib-test.tbtest"));
  const survey = await readPackage(path.join(DIR, "demo-style-survey.tbtest"));
  await knowledgeExports(knowledge);
  await surveyExport(survey);
  // Отпечаток набора: по нему видно, что файлы пересобраны из тех же пакетов.
  const digest = createHash("sha256").update(readFileSync(path.join(DIR, "demo-ib-test.tbtest"))).digest("hex").slice(0, 12);
  console.log(`Готово. Пакет теста: ${digest}`);
}

main().catch((error: unknown) => {
  console.error("Сбой:", (error as Error).stack);
  process.exit(1);
});
