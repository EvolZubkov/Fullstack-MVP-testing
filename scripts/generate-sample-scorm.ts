/**
 * @module scripts/generate-sample-scorm
 * @description Standalone fixture generator for a SCORM 2004 package built on
 * the built-in `default` template. Produces `out/<name>.zip` by feeding an
 * in-memory {@link ExportData} fixture to {@link generateScormPackage} — no DB.
 *
 * The fixture lays out the full content-page flow requested for acceptance:
 *   1. intro      (kind intro,   test-scope «До теста»)
 *   2. info       (kind info,    test-scope «До теста»)
 *   3. one topic with a before-topic info page → 10 questions → an after-topic
 *      info page (questions cover all four mechanics)
 *   4. info       (kind info,    test-scope «После теста», before the summary)
 *   5. summary    (kind summary, test-scope «После теста», results)
 *   6. info       (kind info,    test-scope «После теста», after the summary)
 *
 * Note: the exported runtime's `contentFlow.js` currently sequences only
 * `before_topic`/`after_topic` pages around the question stream plus the
 * built-in results page; test-scope intro/info/summary are bundled so the
 * SCORM player can reveal what the runtime actually renders today.
 *
 * Run: `npm run scorm:sample` (tsx). Output: `out/`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateScormPackage } from "../server/scorm-exporter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "out");
const OUT_NAME = "sample-default-template";
const IDENT_PATH = path.resolve(__dirname, "..", "uploads", "scorm", "identifiers.json");

/** Snapshot/restore the tracked SCORM identifiers file so this tool leaves no trace. */
function snapshotIdentifiers(): Buffer | null {
  try { return fs.existsSync(IDENT_PATH) ? fs.readFileSync(IDENT_PATH) : null; } catch { return null; }
}
function restoreIdentifiers(snap: Buffer | null): void {
  try {
    if (snap === null) { if (fs.existsSync(IDENT_PATH)) fs.rmSync(IDENT_PATH); }
    else { fs.writeFileSync(IDENT_PATH, snap); }
  } catch { /* best-effort */ }
}

const TEST_ID = "sample-test";
const TOPIC_ID = "topic-crypto";

// ─── Questions (all four mechanics) ─────────────────────────────────────────────

let qSeq = 0;
function q(
  type: "single" | "multiple" | "matching" | "ranking",
  prompt: string,
  dataJson: unknown,
  correctJson: unknown,
  difficulty = 50,
) {
  qSeq += 1;
  return {
    id: `q-${qSeq}`,
    topicId: TOPIC_ID,
    type,
    prompt,
    dataJson,
    correctJson,
    points: 1,
    difficulty,
    mediaUrl: null,
    mediaType: null,
    feedback: null,
    feedbackMode: "general",
    feedbackCorrect: null,
    feedbackIncorrect: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const questions = [
  // single choice ×3
  q("single", "Что описывает симметричное шифрование?",
    { options: ["Один общий ключ для шифрования и расшифровки", "Пара открытый/закрытый ключ", "Необратимое преобразование", "Подпись без ключа"] },
    { correctIndex: 0 }, 30),
  q("single", "Какой алгоритм относится к асимметричным?",
    { options: ["AES", "RSA", "DES", "RC4"] },
    { correctIndex: 1 }, 40),
  q("single", "Какова длина ключа AES-256?",
    { options: ["128 бит", "192 бита", "256 бит", "512 бит"] },
    { correctIndex: 2 }, 35),
  // multiple choice ×3
  q("multiple", "Какие из перечисленных — криптографические хеш-функции?",
    { options: ["SHA-256", "AES", "MD5", "RSA"] },
    { correctIndices: [0, 2] }, 55),
  q("multiple", "Какие свойства ожидаются от криптостойкой хеш-функции?",
    { options: ["Стойкость к коллизиям", "Обратимость", "Лавинный эффект", "Детерминированность"] },
    { correctIndices: [0, 2, 3] }, 60),
  q("multiple", "Что относится к асимметричной криптографии?",
    { options: ["Обмен ключами Диффи — Хеллмана", "Шифрование одним общим ключом", "ЭЦП на основе пары ключей", "Поточный шифр"] },
    { correctIndices: [0, 2] }, 65),
  // matching ×2
  q("matching", "Сопоставьте алгоритм и его класс.",
    { left: ["AES", "RSA", "SHA-256"], right: ["Симметричный", "Асимметричный", "Хеш-функция"] },
    { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }] }, 50),
  q("matching", "Сопоставьте термин и определение.",
    { left: ["Конфиденциальность", "Целостность", "Доступность"], right: ["Данные не изменены", "Данные доступны по запросу", "Данные скрыты от посторонних"] },
    { pairs: [{ left: 0, right: 2 }, { left: 1, right: 0 }, { left: 2, right: 1 }] }, 55),
  // ranking ×2
  q("ranking", "Расположите этапы установления TLS-соединения по порядку.",
    { items: ["ClientHello", "ServerHello", "Обмен ключами", "Передача зашифрованных данных"] },
    { correctOrder: [0, 1, 2, 3] }, 70),
  q("ranking", "Упорядочьте длины ключей по возрастанию.",
    { items: ["DES (56 бит)", "3DES (112 бит)", "AES-128", "AES-256"] },
    { correctOrder: [0, 1, 2, 3] }, 60),
];

// ─── Content pages ──────────────────────────────────────────────────────────────

let cpSeq = 0;
function cp(args: {
  topicId: string | null;
  position: "before" | "after" | "before_topic" | "after_topic";
  kind: "intro" | "info" | "summary" | "questions";
  type: "intro" | "info" | "summary" | "html";
  templateKey: string | null;
  sortOrder: number;
  values?: Record<string, unknown>;
  mode?: "template" | "standard" | "html";
}) {
  cpSeq += 1;
  return {
    id: `cp-${cpSeq}`,
    testId: TEST_ID,
    topicId: args.topicId,
    position: args.position,
    mode: args.mode ?? "template",
    type: args.type,
    kind: args.kind,
    templateKey: args.templateKey,
    sortOrder: args.sortOrder,
    valuesJson: { values: args.values ?? {}, placeholderStyles: {} },
    autoAdvance: false,
    autoAdvanceDelayMs: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const contentPages = [
  // (1) intro — test-scope «До теста»
  cp({ topicId: null, position: "before", kind: "intro", type: "intro", templateKey: "intro.hero", sortOrder: 0,
    values: { title: "Основы криптографии", subtitle: "Вводный экран курса", body: "<p>Добро пожаловать! Этот курс знакомит с базовыми понятиями криптографии.</p>" } }),
  // (2) info — test-scope «До теста»
  cp({ topicId: null, position: "before", kind: "info", type: "info", templateKey: "info.text", sortOrder: 1,
    values: { title: "Как проходить курс", body: "<p>Сначала изучите материал, затем ответьте на вопросы. Доступны все типы заданий.</p>" } }),
  // (3a) before-topic info
  cp({ topicId: TOPIC_ID, position: "before_topic", kind: "info", type: "info", templateKey: "info.text", sortOrder: 0,
    values: { title: "Перед темой «Криптография»", body: "<p>Ключевые термины: ключ, шифр, хеш, ЭЦП. Поехали!</p>" } }),
  // NB: a `kind: questions` marker page is intentionally NOT added — the runtime
  // derives the question stream from `sections`, and such a marker (legacy
  // type="info") would render as a spurious extra content page.
  // (3c) after-topic info
  cp({ topicId: TOPIC_ID, position: "after_topic", kind: "info", type: "info", templateKey: "info.text", sortOrder: 0,
    values: { title: "После темы", body: "<p>Отлично! Вы прошли вопросы темы. Дальше — итоги.</p>" } }),
  // (4) info — test-scope «После теста», before summary
  cp({ topicId: null, position: "after", kind: "info", type: "info", templateKey: "info.text", sortOrder: 0,
    values: { title: "Перед подведением итогов", body: "<p>Сейчас вы увидите свой результат.</p>" } }),
  // (5) summary — results
  cp({ topicId: null, position: "after", kind: "summary", type: "summary", templateKey: "summary.result", sortOrder: 1,
    values: { title: "Ваш результат" } }),
  // (6) info — test-scope «После теста», after summary
  cp({ topicId: null, position: "after", kind: "info", type: "info", templateKey: "info.text", sortOrder: 2,
    values: { title: "Что дальше", body: "<p>Спасибо за прохождение! Рекомендуем повторить материал по слабым темам.</p>" } }),
];

// ─── Assemble ExportData ─────────────────────────────────────────────────────────

const test = {
  id: TEST_ID,
  title: "Демо: контентные страницы и механики",
  description: "Демонстрационный тест на дефолтном шаблоне: вводная/инфо/итоги + 10 вопросов всех механик.",
  mode: "standard",
  showDifficultyLevel: true,
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  timeLimitMinutes: null,
  maxAttempts: null,
  showCorrectAnswers: true,
  startPageContent: "Добро пожаловать на демонстрационный курс по основам криптографии.",
  published: true,
  status: "published",
  folderId: null,
  designSettingsJson: { templateId: "default", params: {} },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const topic = {
  id: TOPIC_ID,
  name: "Криптография",
  description: "Базовые понятия криптографии",
  feedback: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sections = [
  {
    id: "section-1",
    testId: TEST_ID,
    topicId: TOPIC_ID,
    drawCount: 10,
    sortOrder: 0,
    required: true,
    topicPassRuleJson: null,
    timeLimitMinutes: null,
    feedbackJson: null,
    topic,
    questions,
    courses: [],
    events: [],
  },
];

// ─── Scales + measurements + result variables (PRD-5 / PRD-2) ────────────────────
// A compact scoring fixture so the SCORM player's inspector has live scale.* /
// result.* to show: `sym` is fed by the three single-choice questions, `asym` by
// the three multiple-choice ones; the option's index is its explicit contribution.

const SCALE_SYM = "scale-sym";
const SCALE_ASYM = "scale-asym";

const scales = [
  {
    id: SCALE_SYM, testId: TEST_ID, key: "sym", label: "Симметричная криптография",
    type: "number", aggregation: "sum", normalization: "percent", direction: "positive",
    configJson: { bands: [
      { min: 0, max: 1, level: "low", label: "Низкий" },
      { min: 2, max: 3, level: "mid", label: "Средний" },
      { min: 4, max: 9, level: "high", label: "Высокий" },
    ] },
    showToLearner: true, scormTarget: "both", sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: SCALE_ASYM, testId: TEST_ID, key: "asym", label: "Асимметричная криптография",
    type: "number", aggregation: "sum", normalization: "none", direction: "positive",
    configJson: { bands: [
      { min: 0, max: 2, level: "low", label: "Низкий" },
      { min: 3, max: 5, level: "mid", label: "Средний" },
      { min: 6, max: 99, level: "high", label: "Высокий" },
    ] },
    showToLearner: true, scormTarget: "both", sortOrder: 1, createdAt: new Date(), updatedAt: new Date(),
  },
];

let mSeq = 0;
function m(questionId: string, scaleId: string, optionIndex: number, value: number) {
  mSeq += 1;
  return {
    id: `meas-${mSeq}`, testId: TEST_ID, questionId, scaleId,
    sourceType: "option", sourceKey: String(optionIndex), valueJson: value, weight: 1,
    conditionJson: null, sortOrder: optionIndex, createdAt: new Date(), updatedAt: new Date(),
  };
}

// q-1..q-3 → sym; q-4..q-6 → asym. Option index = its contribution (correct answer
// carries the most), so the live scale climbs as the learner picks stronger answers.
const measurements = [
  m("q-1", SCALE_SYM, 0, 2), m("q-1", SCALE_SYM, 1, 1), m("q-1", SCALE_SYM, 2, 0), m("q-1", SCALE_SYM, 3, 0),
  m("q-2", SCALE_SYM, 0, 0), m("q-2", SCALE_SYM, 1, 2), m("q-2", SCALE_SYM, 2, 1), m("q-2", SCALE_SYM, 3, 0),
  m("q-3", SCALE_SYM, 0, 0), m("q-3", SCALE_SYM, 1, 1), m("q-3", SCALE_SYM, 2, 2), m("q-3", SCALE_SYM, 3, 0),
  m("q-4", SCALE_ASYM, 0, 2), m("q-4", SCALE_ASYM, 1, 0), m("q-4", SCALE_ASYM, 2, 1), m("q-4", SCALE_ASYM, 3, 0),
  m("q-5", SCALE_ASYM, 0, 2), m("q-5", SCALE_ASYM, 1, 0), m("q-5", SCALE_ASYM, 2, 1), m("q-5", SCALE_ASYM, 3, 1),
  m("q-6", SCALE_ASYM, 0, 2), m("q-6", SCALE_ASYM, 1, 0), m("q-6", SCALE_ASYM, 2, 1), m("q-6", SCALE_ASYM, 3, 0),
];

function rv(name: string, label: string, type: string, formula: string, sortOrder: number) {
  return {
    id: `rv-${name}`, testId: TEST_ID, name, label, type, formula,
    showToLearner: true, scormTarget: "both", controlsStatus: "none", sortOrder,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

const resultVariables = [
  rv("sym_pct", "Симметрия, %", "number", 'scaleById("sym").percent', 10),
  rv("both_high", "Обе шкалы высокие", "boolean", 'countScales(["sym","asym"], "high") = 2', 20),
  rv(
    "profile", "Профиль", "string",
    'IF(scaleById("sym").level = "high", "Эксперт по симметрии", IF(countScales(["sym","asym"], "high") >= 1, "Уверенный", "Базовый"))',
    100,
  ),
];

const data = {
  test,
  sections,
  adaptiveSettings: null,
  contentPages,
  scales,
  measurements,
  resultVariables,
  designSettings: { templateId: "default", params: {} },
  telemetry: null,
};

// ─── Run ─────────────────────────────────────────────────────────────────────────

async function main() {
  const identSnapshot = snapshotIdentifiers();
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await generateScormPackage(data as any);
    const zipPath = path.join(OUT_DIR, `${OUT_NAME}.zip`);
    fs.writeFileSync(zipPath, buffer);
    // eslint-disable-next-line no-console
    console.log(`SCORM package written: ${zipPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
    // eslint-disable-next-line no-console
    console.log(`Play it: npm run scorm:player  →  open http://localhost:5050`);
  } finally {
    restoreIdentifiers(identSnapshot);
  }
}

main()
  // Imported server modules keep a heartbeat interval alive, so exit explicitly.
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to generate SCORM package:", err);
    process.exit(1);
  });
