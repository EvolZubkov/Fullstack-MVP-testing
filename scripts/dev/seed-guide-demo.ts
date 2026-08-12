/**
 * @module scripts/dev/seed-guide-demo
 * @description Seeds the demonstration content used for the screenshots in
 * `docs/guides/test-authoring-guide.md`.
 *
 * The dev database is a copy of production, so screenshots taken on it would put
 * real people and real course titles into a document meant for distribution. This
 * script builds a small, self-contained and obviously fictional dataset instead:
 * a content folder with two topics and their questions (all four question types,
 * sub-topic tags, difficulty), a test folder, and one test wired up the way the
 * guide describes it — two sections with a draw, tag quotas, pass rules, limits,
 * a per-question price override, one measurement scale and one result indicator.
 *
 * Everything goes through the REST API of a RUNNING dev server, not through direct
 * table writes: creating a test that way also produces its content pages, so the
 * «Структура» tab shows a realistic screen list. Exactly ONE login happens per run
 * — the login route rate-limits to 10 attempts per 15 minutes per IP.
 *
 * The script is idempotent: entities are looked up by name and reused, so it can be
 * re-run to repair a partially seeded stand.
 *
 * Usage:
 *   npx tsx scripts/dev/seed-guide-demo.ts --base http://localhost:8097 \
 *     --email acceptance@local.test --password "Acceptance!2026"
 */

// ─── Arguments ────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg("base", "http://localhost:8097").replace(/\/+$/, "");
const EMAIL = arg("email", "acceptance@local.test");
const PASSWORD = arg("password", "Acceptance!2026");

/** Every seeded entity carries this name, so a later cleanup can find them. */
const DEMO = {
  contentFolder: "Демонстрация (руководство)",
  testFolder: "Демонстрация (руководство)",
  topicA: "Охрана труда. Базовый курс",
  topicB: "Пожарная безопасность",
  test: "Демонстрационный тест по охране труда",
  group: "Демонстрационная группа",
} as const;

/** Fictional learners for the «Назначить» dialog. Names are deliberately generic. */
const DEMO_LEARNERS: ReadonlyArray<{ name: string; email: string }> = [
  { name: "Демо Ученик Первый", email: "demo.learner1@example.invalid" },
  { name: "Демо Ученик Второй", email: "demo.learner2@example.invalid" },
  { name: "Демо Ученик Третий", email: "demo.learner3@example.invalid" },
];

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

// ─── Demo content ─────────────────────────────────────────────────────────────

type QuestionSeed = {
  type: "single" | "multiple" | "matching" | "ranking";
  prompt: string;
  dataJson: unknown;
  correctJson: unknown;
  difficulty: number;
  tags: string[];
  orderIndex: number;
};

const TOPIC_A_QUESTIONS: QuestionSeed[] = [
  {
    type: "single",
    prompt: "Кто отвечает за организацию охраны труда в организации?",
    dataJson: {
      options: [
        "Работодатель",
        "Каждый работник лично",
        "Профсоюзный комитет",
        "Государственный инспектор труда",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 30,
    tags: ["Общие требования"],
    orderIndex: 1,
  },
  {
    type: "single",
    prompt: "Как часто проводится повторный инструктаж по охране труда?",
    dataJson: { options: ["Раз в месяц", "Раз в шесть месяцев", "Раз в год", "Раз в три года"] },
    correctJson: { correctIndex: 1 },
    difficulty: 40,
    tags: ["Общие требования"],
    orderIndex: 2,
  },
  {
    type: "single",
    prompt: "Каким документом подтверждается прохождение вводного инструктажа?",
    dataJson: {
      options: [
        "Записью в журнале регистрации вводного инструктажа",
        "Устным сообщением руководителя",
        "Копией трудового договора",
        "Служебной запиской работника",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 35,
    tags: ["Общие требования"],
    orderIndex: 3,
  },
  {
    type: "single",
    prompt: "Что нужно сделать в первую очередь при обнаружении пострадавшего?",
    dataJson: {
      options: [
        "Устранить действие поражающего фактора",
        "Составить акт о несчастном случае",
        "Сообщить в отдел кадров",
        "Сфотографировать место происшествия",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 55,
    tags: ["Общие требования"],
    orderIndex: 4,
  },
  {
    type: "multiple",
    prompt: "Отметьте средства индивидуальной защиты органов дыхания.",
    dataJson: { options: ["Респиратор", "Противогаз", "Защитные очки", "Диэлектрические перчатки"] },
    correctJson: { correctIndices: [0, 1] },
    difficulty: 45,
    tags: ["Средства защиты"],
    orderIndex: 5,
  },
  {
    type: "multiple",
    prompt: "Какие средства защиты относятся к коллективным?",
    dataJson: {
      options: [
        "Ограждение опасной зоны",
        "Приточно-вытяжная вентиляция",
        "Каска строительная",
        "Сигнальный жилет",
      ],
    },
    correctJson: { correctIndices: [0, 1] },
    difficulty: 60,
    tags: ["Средства защиты"],
    orderIndex: 6,
  },
  {
    type: "matching",
    prompt: "Сопоставьте вид инструктажа и повод для его проведения.",
    dataJson: {
      left: ["Вводный", "Первичный на рабочем месте", "Внеплановый"],
      right: [
        "Приём нового работника",
        "Начало работы на конкретном оборудовании",
        "Изменение технологического процесса",
      ],
    },
    correctJson: {
      pairs: [
        { left: 0, right: 0 },
        { left: 1, right: 1 },
        { left: 2, right: 2 },
      ],
    },
    difficulty: 65,
    tags: ["Общие требования"],
    orderIndex: 7,
  },
  {
    type: "ranking",
    prompt: "Расставьте действия при несчастном случае в правильном порядке.",
    dataJson: {
      items: [
        "Устранить действие поражающего фактора",
        "Оказать первую помощь пострадавшему",
        "Вызвать скорую медицинскую помощь",
        "Сообщить руководителю о происшествии",
      ],
    },
    correctJson: { correctOrder: [0, 1, 2, 3] },
    difficulty: 70,
    tags: ["Средства защиты"],
    orderIndex: 8,
  },
];

const TOPIC_B_QUESTIONS: QuestionSeed[] = [
  {
    type: "single",
    prompt: "Какой огнетушитель применяют для тушения электроустановок под напряжением?",
    dataJson: { options: ["Углекислотный", "Воздушно-пенный", "Водный", "Химический пенный"] },
    correctJson: { correctIndex: 0 },
    difficulty: 50,
    tags: ["Первичные средства"],
    orderIndex: 1,
  },
  {
    type: "single",
    prompt: "Что нужно сделать первым при обнаружении возгорания?",
    dataJson: {
      options: [
        "Сообщить о пожаре по телефону 101",
        "Начать выносить документы",
        "Открыть окна для проветривания",
        "Дождаться указаний руководителя",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 30,
    tags: ["Эвакуация"],
    orderIndex: 2,
  },
  {
    type: "single",
    prompt: "Как двигаться при сильном задымлении помещения?",
    dataJson: {
      options: [
        "Пригнувшись, ближе к полу",
        "В полный рост вдоль стены",
        "Бегом по центру коридора",
        "Ползком спиной вперёд",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 40,
    tags: ["Эвакуация"],
    orderIndex: 3,
  },
  {
    type: "multiple",
    prompt: "Отметьте первичные средства пожаротушения.",
    dataJson: { options: ["Огнетушитель", "Пожарный кран", "Ящик с песком", "Пожарная автолестница"] },
    correctJson: { correctIndices: [0, 1, 2] },
    difficulty: 45,
    tags: ["Первичные средства"],
    orderIndex: 4,
  },
  {
    type: "multiple",
    prompt: "Что запрещается делать при эвакуации?",
    dataJson: {
      options: [
        "Пользоваться лифтом",
        "Возвращаться в горящее помещение за вещами",
        "Двигаться к ближайшему эвакуационному выходу",
        "Помогать людям с ограниченной подвижностью",
      ],
    },
    correctJson: { correctIndices: [0, 1] },
    difficulty: 55,
    tags: ["Эвакуация"],
    orderIndex: 5,
  },
  {
    type: "single",
    prompt: "Как часто проверяют работоспособность огнетушителей?",
    dataJson: { options: ["Ежеквартально", "Ежемесячно", "Раз в пять лет", "Только после применения"] },
    correctJson: { correctIndex: 0 },
    difficulty: 60,
    tags: ["Первичные средства"],
    orderIndex: 6,
  },
];

// ─── Seed steps ───────────────────────────────────────────────────────────────

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

async function ensureTopic(name: string, code: string, description: string, folderId: string): Promise<Named> {
  const all = await api<Named[]>("GET", "/api/topics");
  const found = all.find((t) => t.name === name);
  if (found) {
    console.log(`  = тема «${name}» уже есть`);
    return found;
  }
  const created = await api<Named>("POST", "/api/topics", { name, code, description, folderId });
  console.log(`  + тема «${name}»`);
  return created;
}

async function ensureQuestions(topicId: string, seeds: QuestionSeed[]): Promise<string[]> {
  const all = await api<Array<{ id: string; topicId: string; prompt: string }>>(
    "GET",
    `/api/questions?topicId=${topicId}`,
  );
  const byPrompt = new Map(all.filter((q) => q.topicId === topicId).map((q) => [q.prompt, q.id]));
  const ids: string[] = [];
  for (const seed of seeds) {
    const existing = byPrompt.get(seed.prompt);
    if (existing) {
      ids.push(existing);
      continue;
    }
    const created = await api<{ id: string }>("POST", "/api/questions", {
      topicId,
      type: seed.type,
      prompt: seed.prompt,
      dataJson: seed.dataJson,
      correctJson: seed.correctJson,
      difficulty: seed.difficulty,
      shuffleAnswers: seed.type !== "ranking",
      tags: seed.tags,
      orderIndex: seed.orderIndex,
    });
    ids.push(created.id);
  }
  console.log(`  * вопросов в теме: ${ids.length}`);
  return ids;
}

async function main(): Promise<void> {
  console.log(`Стенд: ${BASE}`);
  await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  console.log(`Вход выполнен: ${EMAIL}`);

  console.log("Содержимое:");
  const contentFolder = await ensureFolder("/api/folders", DEMO.contentFolder);
  const topicA = await ensureTopic(
    DEMO.topicA,
    "ot_base",
    "Базовые требования охраны труда: инструктажи, средства защиты, действия при несчастном случае.",
    contentFolder.id,
  );
  const questionsA = await ensureQuestions(topicA.id, TOPIC_A_QUESTIONS);
  const topicB = await ensureTopic(
    DEMO.topicB,
    "fire_safety",
    "Первичные средства пожаротушения и правила эвакуации.",
    contentFolder.id,
  );
  const questionsB = await ensureQuestions(topicB.id, TOPIC_B_QUESTIONS);

  console.log("Тест:");
  const testFolder = await ensureFolder("/api/test-folders", DEMO.testFolder);
  const tests = await api<Array<{ id: string; title: string }>>("GET", "/api/tests");
  let test = tests.find((t) => t.title === DEMO.test);
  if (test) {
    console.log(`  = тест «${DEMO.test}» уже есть`);
  } else {
    test = await api<{ id: string; title: string }>("POST", "/api/tests", {
      title: DEMO.test,
      description:
        "Проверка базовых знаний по охране труда и пожарной безопасности. " +
        "Демонстрационный тест для руководства автора.",
      folderId: testFolder.id,
      overallPassRuleJson: { type: "percent", value: 70 },
      questionOrder: "random",
      timeLimitMinutes: 20,
      maxAttempts: 3,
      showCorrectAnswers: true,
      allowReturnToUnanswered: true,
      allowAnswerChange: true,
      showSectionResults: true,
      defaultQuestionPoints: 1,
      status: "draft",
      flowPolicyJson: { mode: "linear_by_topics" },
      sections: [
        {
          topicId: topicA.id,
          drawCount: 5,
          required: true,
          topicPassRuleJson: { type: "percent", value: 60 },
          drawBlueprintJson: { strata: [{ tag: "Средства защиты", count: 2, mode: "min" }] },
        },
        {
          topicId: topicB.id,
          drawCount: 3,
          required: false,
          topicPassRuleJson: { type: "percent", value: 50 },
        },
      ],
    });
    console.log(`  + тест «${DEMO.test}»`);
  }

  // A per-question override, so the «Оценка» tab shows the «настроено в тесте» mark.
  await api("PUT", `/api/tests/${test.id}/question-scoring/${questionsA[4]}`, {
    points: 3,
    scoringJson: {
      kind: "tiered",
      tiers: [
        { when: { all: [{ lhs: "c", op: "==", rhs: "T" }, { lhs: "x", op: "==", rhs: 0 }] }, score: 3 },
        { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }, { lhs: "x", op: "<=", rhs: 1 }] }, score: 1 },
      ],
    },
  });
  console.log("  * настроена цена одного вопроса (ступенчато)");

  // A measurement scale plus contributions, so the «Шкалы» tab is not empty.
  const scales = await api<Array<{ id: string; key: string }>>("GET", `/api/tests/${test.id}/scales`);
  let scale = scales.find((s) => s.key === "safety_awareness");
  if (!scale) {
    scale = await api<{ id: string; key: string }>("POST", `/api/tests/${test.id}/scales`, {
      key: "safety_awareness",
      label: "Внимательность к безопасности",
      description: "Сводный показатель по вопросам о средствах защиты и порядке действий.",
      type: "number",
      aggregation: "sum",
      normalization: "percent",
      direction: "positive",
      learnerVisibility: "level",
      scormTarget: "suspend_data",
      configJson: {
        bands: [
          { level: "low", label: "Требует внимания", min: 0, max: 39 },
          { level: "mid", label: "Достаточный уровень", min: 40, max: 74 },
          { level: "high", label: "Высокий уровень", min: 75, max: 100 },
        ],
      },
    });
    console.log("  + шкала «Внимательность к безопасности»");
  }
  for (const questionId of [questionsA[4], questionsA[5], questionsA[7]]) {
    await api("PUT", `/api/tests/${test.id}/measurements/${questionId}`, [
      { scaleId: scale.id, sourceType: "question", sourceKey: null, valueJson: 1, weight: 1, sortOrder: 0 },
    ]);
  }
  console.log("  * заданы вклады трёх вопросов в шкалу");

  // One result indicator, so the «Показатели» tab is not empty either.
  const vars = await api<Array<{ id: string; name: string }>>("GET", `/api/tests/${test.id}/result-variables`);
  if (!vars.some((v) => v.name === "safety_verdict")) {
    await api("POST", `/api/tests/${test.id}/result-variables`, {
      name: "safety_verdict",
      label: "Допуск к самостоятельной работе",
      type: "boolean",
      formula: "percent >= 70",
      learnerVisibility: "level_and_value",
      scormTarget: "both",
      controlsStatus: "none",
    });
    console.log("  + показатель «Допуск к самостоятельной работе»");
  }

  // Learners + a group, so the «Назначить» dialog can be shown without putting
  // real accounts on the page. `sendInvite: false` — the dev SMTP is live and
  // would actually try to deliver mail to these fictional addresses.
  console.log("Учебная группа:");
  const groups = await api<Named[]>("GET", "/api/groups");
  let group = groups.find((g) => g.name === DEMO.group);
  if (!group) {
    group = await api<Named>("POST", "/api/groups", {
      name: DEMO.group,
      description: "Демонстрационная группа для руководства автора.",
    });
    console.log(`  + группа «${DEMO.group}»`);
  }
  const users = await api<Array<{ id: string; name: string | null }>>("GET", "/api/users");
  for (const learner of DEMO_LEARNERS) {
    if (users.some((u) => u.name === learner.name)) continue;
    await api("POST", "/api/users", {
      email: learner.email,
      password: "Demo!2026learner",
      name: learner.name,
      roles: ["learner"],
      groupIds: [group.id],
      sendInvite: false,
    });
    console.log(`  + ученик «${learner.name}»`);
  }

  console.log(`\nГотово. Тест: ${BASE}/author/tests (папка «${DEMO.testFolder}»)`);
  console.log(`Вопросов создано: ${questionsA.length + questionsB.length}`);
}

main().catch((error: unknown) => {
  console.error("Сбой засева:", (error as Error).message);
  process.exit(1);
});
