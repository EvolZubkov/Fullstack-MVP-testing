/**
 * @module scripts/dev/seed-adaptive-fixture
 * @description Seeds a PLAYABLE adaptive test on the dev stand.
 *
 * Every adaptive test the stand carried was a leftover of some past acceptance, and
 * none of them could be played to the results screen: one had a level whose
 * difficulty range held no questions at all («Вопрос 1 из 0»), another ran into
 * defects since fixed. So every adaptive check meant publishing somebody's leftover
 * temporarily, playing it and putting it back — which is both noisy on a database
 * shared by all sessions and easy to leave half-reverted.
 *
 * This script builds a fixture that exists for exactly one purpose: to be played.
 * Twelve questions spread evenly across three difficulty bands, three levels sized
 * so that EVERY band has more questions than its level asks for — the ladder cannot
 * run dry, whichever way the run goes. The test is published (delivery is checked at
 * publish time, so publication itself proves the ladder is feasible) and assigned to
 * the account running the script, so it is playable the moment the script ends.
 *
 * Everything goes through the REST API of a RUNNING dev server, like
 * `seed-guide-demo.ts` — creating a test that way also produces its content pages.
 * Idempotent: entities are looked up by name and reused, so re-running repairs a
 * partially seeded stand instead of duplicating it.
 *
 * Usage:
 *   npx tsx scripts/dev/seed-adaptive-fixture.ts --base http://localhost:8098 \
 *     --email acceptance@local.test --password "Acceptance!2026"
 */

// ─── Arguments ────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg("base", "http://localhost:8098").replace(/\/+$/, "");
const EMAIL = arg("email", "acceptance@local.test");
const PASSWORD = arg("password", "Acceptance!2026");

/** Every seeded entity carries one of these names, so a cleanup can find them. */
const FIXTURE = {
  contentFolder: "Стенд (фикстуры)",
  testFolder: "Стенд (фикстуры)",
  topic: "Стенд: адаптивная лестница",
  // Код темы: строчная буква в начале, дальше буквы/цифры/подчёркивание (валидатор API).
  topicCode: "stand_adaptive",
  test: "Стенд: адаптивный проходимый",
};

// ─── HTTP plumbing ────────────────────────────────────────────────────────────

let cookie = "";

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const sid = setCookie.split(";")[0];
    if (sid.startsWith("connect.sid=")) cookie = sid;
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

// ─── Questions ────────────────────────────────────────────────────────────────

type QuestionSeed = {
  prompt: string;
  options: string[];
  correctIndex: number;
  difficulty: number;
};

/**
 * Four questions per band, deliberately trivial: the fixture exists to be PLAYED
 * (and played repeatedly, by whoever is checking adaptive behaviour), not to
 * measure anyone. The right answer is always recognisable from the question, so a
 * run can be steered up or down the ladder on purpose.
 */
const QUESTIONS: QuestionSeed[] = [
  // ── Базовый (0 — 33): по 4 на уровень, который просит 2
  { prompt: "Уровень 1, вопрос A. Сколько будет 2 + 2?", options: ["3", "4", "5", "22"], correctIndex: 1, difficulty: 10 },
  { prompt: "Уровень 1, вопрос B. Какой цвет получается при смешении синего и жёлтого?", options: ["Зелёный", "Красный", "Чёрный", "Белый"], correctIndex: 0, difficulty: 15 },
  { prompt: "Уровень 1, вопрос C. Сколько дней в неделе?", options: ["5", "6", "7", "10"], correctIndex: 2, difficulty: 20 },
  { prompt: "Уровень 1, вопрос D. Столица Франции?", options: ["Берлин", "Мадрид", "Рим", "Париж"], correctIndex: 3, difficulty: 30 },
  // ── Средний (34 — 66)
  { prompt: "Уровень 2, вопрос A. Сколько будет 12 × 12?", options: ["124", "144", "154", "112"], correctIndex: 1, difficulty: 40 },
  { prompt: "Уровень 2, вопрос B. Какая планета третья от Солнца?", options: ["Венера", "Марс", "Земля", "Юпитер"], correctIndex: 2, difficulty: 45 },
  { prompt: "Уровень 2, вопрос C. В каком году человек впервые вышел в космос?", options: ["1957", "1961", "1969", "1975"], correctIndex: 1, difficulty: 55 },
  { prompt: "Уровень 2, вопрос D. Сколько сторон у восьмиугольника?", options: ["6", "7", "8", "9"], correctIndex: 2, difficulty: 60 },
  // ── Продвинутый (67 — 100)
  { prompt: "Уровень 3, вопрос A. Чему равен квадратный корень из 169?", options: ["11", "12", "13", "14"], correctIndex: 2, difficulty: 70 },
  { prompt: "Уровень 3, вопрос B. Какой элемент обозначается символом Fe?", options: ["Фтор", "Железо", "Фосфор", "Франций"], correctIndex: 1, difficulty: 80 },
  { prompt: "Уровень 3, вопрос C. Сколько бит в одном байте?", options: ["4", "8", "16", "32"], correctIndex: 1, difficulty: 90 },
  { prompt: "Уровень 3, вопрос D. Какое число является простым?", options: ["21", "27", "29", "33"], correctIndex: 2, difficulty: 100 },
];

/** Три уровня по 2 вопроса при четырёх доступных в каждой полосе — запас двукратный. */
const LEVELS = [
  { levelIndex: 0, levelName: "Базовый", minDifficulty: 0, maxDifficulty: 33, questionsCount: 2, passThreshold: 50, passThresholdType: "percent" as const },
  { levelIndex: 1, levelName: "Средний", minDifficulty: 34, maxDifficulty: 66, questionsCount: 2, passThreshold: 50, passThresholdType: "percent" as const },
  { levelIndex: 2, levelName: "Продвинутый", minDifficulty: 67, maxDifficulty: 100, questionsCount: 2, passThreshold: 50, passThresholdType: "percent" as const },
];

// ─── Idempotent builders ──────────────────────────────────────────────────────

type Named = { id: string; name: string };

async function ensureFolder(path: string, name: string): Promise<Named> {
  const all = await api<Named[]>("GET", path);
  const found = all.find((f) => f.name === name);
  if (found) {
    console.log(`  = папка «${name}» уже есть`);
    return found;
  }
  const created = await api<Named>("POST", path, { name, parentId: null });
  console.log(`  + папка «${name}»`);
  return created;
}

async function ensureTopic(folderId: string): Promise<Named> {
  const all = await api<Named[]>("GET", "/api/topics");
  const found = all.find((t) => t.name === FIXTURE.topic);
  if (found) {
    console.log(`  = тема «${FIXTURE.topic}» уже есть`);
    return found;
  }
  const created = await api<Named>("POST", "/api/topics", {
    name: FIXTURE.topic,
    code: FIXTURE.topicCode,
    description:
      "Фикстура стенда: вопросы трёх полос сложности для проходимого адаптивного теста. Не удалять.",
    folderId,
  });
  console.log(`  + тема «${FIXTURE.topic}»`);
  return created;
}

async function ensureQuestions(topicId: string): Promise<number> {
  const all = await api<Array<{ id: string; topicId: string; prompt: string }>>(
    "GET",
    `/api/questions?topicId=${topicId}`,
  );
  const byPrompt = new Set(all.filter((q) => q.topicId === topicId).map((q) => q.prompt));
  let created = 0;
  for (const [i, seed] of QUESTIONS.entries()) {
    if (byPrompt.has(seed.prompt)) continue;
    await api("POST", "/api/questions", {
      topicId,
      type: "single",
      prompt: seed.prompt,
      // Форма та же, что у `seed-guide-demo.ts`: варианты — простые строки, ответ —
      // индекс. Своя форма здесь означала бы второй формат вопроса на одном стенде.
      dataJson: { options: seed.options },
      correctJson: { correctIndex: seed.correctIndex },
      difficulty: seed.difficulty,
      shuffleAnswers: true,
      tags: [],
      orderIndex: i,
    });
    created += 1;
  }
  console.log(`  * вопросов в теме: ${QUESTIONS.length} (создано сейчас: ${created})`);
  return created;
}

async function ensureTest(topicId: string, folderId: string): Promise<{ id: string; status: string }> {
  const all = await api<Array<{ id: string; title: string; status: string }>>("GET", "/api/tests");
  const found = all.find((t) => t.title === FIXTURE.test);
  if (found) {
    console.log(`  = тест «${FIXTURE.test}» уже есть`);
    return found;
  }
  const created = await api<{ id: string; status: string }>("POST", "/api/tests", {
    title: FIXTURE.test,
    description:
      "Фикстура стенда для проверок адаптивного режима: лестница из трёх уровней, у каждого вдвое больше вопросов, чем он просит. Не удалять.",
    mode: "adaptive",
    // Адаптив в плоском сценарии не поддерживается (flow-policy-validator), а сценарий
    // читается из `flowPolicyJson.mode` — не из отдельного поля.
    flowPolicyJson: { mode: "linear_by_topics" },
    folderId,
    showCorrectAnswers: false,
    showDifficultyLevel: true,
    sections: [{ topicId, drawCount: 0, drawAll: false, orderIndex: 0 }],
    adaptiveSettings: [
      {
        topicId,
        failureFeedback: "Минимально требуемый уровень не подтверждён.",
        levels: LEVELS,
      },
    ],
  });
  console.log(`  + тест «${FIXTURE.test}»`);
  return created;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Стенд: ${BASE}`);
  const { user: me } = await api<{ user: { id: string } }>("POST", "/api/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  console.log(`Вход выполнен: ${EMAIL}`);

  const contentFolder = await ensureFolder("/api/folders", FIXTURE.contentFolder);
  const testFolder = await ensureFolder("/api/test-folders", FIXTURE.testFolder);
  const topic = await ensureTopic(contentFolder.id);
  await ensureQuestions(topic.id);
  const test = await ensureTest(topic.id, testFolder.id);

  // Проверка выполнимости ДО публикации: если лестница не поедет, публикация ответит
  // 409, и лучше сказать об этом прямо, чем оставить фикстуру наполовину заведённой.
  const { findings } = await api<{ findings: Array<{ topicName: string; issues: unknown[] }> }>(
    "GET",
    `/api/tests/${test.id}/feasibility`,
  );
  if (findings.length > 0) {
    console.error("  ! выдача невыполнима:", JSON.stringify(findings, null, 2));
    throw new Error("фикстура собрана неверно — лестница не поедет");
  }
  console.log("  * выполнимость выдачи: помех нет");

  if (test.status !== "published") {
    await api("PATCH", `/api/tests/${test.id}/status`, { status: "published" });
    console.log("  + тест опубликован");
  } else {
    console.log("  = тест уже опубликован");
  }

  // Назначение себе: без него ученический список теста не покажет.
  const assignments = await api<Array<{ id: string; userId: string | null }>>(
    "GET",
    `/api/tests/${test.id}/assignments`,
  );
  if (assignments.some((a) => a.userId === me.id)) {
    console.log("  = тест уже назначен этой учётной записи");
  } else {
    await api("POST", `/api/tests/${test.id}/assignments`, { userId: me.id });
    console.log("  + тест назначен этой учётной записи");
  }

  console.log(`\nГотово. Тест: ${BASE}/learner/test/${test.id}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
