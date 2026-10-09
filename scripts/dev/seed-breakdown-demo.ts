/**
 * @module scripts/dev/seed-breakdown-demo
 * @description Seeds the demonstration test for PRD-50 result breakdowns — subtotals by
 * question TAG — rendered through the «Сертификация (РТК)» design template.
 *
 * What the fixture is built to show, in the model as it stands after the owner's
 * amendment of 2026-09-03 (PRD-50 §14): a subtopic key is an INFORMATIONAL unit. It has
 * no verdict of its own, it cannot fail a topic, and what it carries instead is its own
 * feedback — the text handed to the learner when the key's share of points falls below
 * the test's overall pass threshold, whatever the verdict of the test and the topic.
 *
 * Hence the shape of the demo:
 *
 * - two sections, three tags each, fixed quotas per tag, so every key's denominator is a
 *   constant and the bars of two different learners are comparable;
 * - ONE tag lives in BOTH sections («Корпоративные ценности»), which is what produces
 *   three records for it — one per section scope, plus the test-scope summary — and is
 *   the point of the (scope × axis × key) model;
 * - inside «Охрана труда» the three questions cost 3, 2 and 1 point, and the cheap one is
 *   answered wrong, so the key reads 67 % per question and 83 % per point. The two display
 *   bases then differ ON SCREEN instead of being a line in the settings, and the key
 *   prints no recommendation — the text rule is judged in POINTS (83 % > порог), which is
 *   exactly the distinction FR-50 makes;
 * - a seeded attempt whose answers are chosen so the test PASSES and both topics pass,
 *   while two subtopics land at 50 % and print their recommendations. That is exactly the
 *   case FR-50 was written for and the one no author can stage by accident.
 *
 * Everything goes through the REST API of a RUNNING server, like `seed-guide-demo.ts`:
 * creating a test that way also produces its content pages, and the attempt is graded by
 * the very engine the product uses. Idempotent — entities are looked up by name and
 * reused, so a re-run repairs a half-seeded stand instead of duplicating it. Exactly ONE
 * login per run (the login route rate-limits to 10 attempts per 15 minutes per IP).
 *
 * Usage:
 *   npx tsx scripts/dev/seed-breakdown-demo.ts --base http://localhost:8098 \
 *     --email demo@local.test --password "Demo!2026"
 *
 * Options:
 *   --base      server to seed (default http://localhost:8098)
 *   --email     account to seed as; it also becomes the assignee of the test
 *   --password  its password
 *   --no-attempt  seed and publish, but play no attempt
 */

// ─── Arguments ────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg("base", "http://localhost:8098").replace(/\/+$/, "");
const EMAIL = arg("email", "demo@local.test");
const PASSWORD = arg("password", "Demo!2026");
const PLAY_ATTEMPT = !process.argv.includes("--no-attempt");

/** Every seeded entity carries one of these names, so a cleanup can find them. */
const DEMO = {
  contentFolder: "Демонстрация (подытоги по подтемам)",
  testFolder: "Демонстрация (подытоги по подтемам)",
  topicA: "Демо: управленческие компетенции",
  topicACode: "demo_lead",
  topicB: "Демо: знания о компании",
  topicBCode: "demo_know",
  test: "Сертификация руководителей (демо: подытоги по подтемам)",
} as const;

/** The test's overall pass threshold, in percent. Also the bar the key texts are judged against. */
const PASS_PERCENT = 70;

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
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

// ─── Question bank ────────────────────────────────────────────────────────────

type QuestionSeed = {
  type: "single" | "multiple";
  prompt: string;
  dataJson: { options: string[] };
  correctJson: { correctIndex?: number; correctIndices?: number[] };
  difficulty: number;
  tags: string[];
  orderIndex: number;
};

const TAG = {
  tasks: "Постановка задач",
  feedback: "Обратная связь",
  values: "Корпоративные ценности",
  rules: "Регламенты и процессы",
  safety: "Охрана труда",
} as const;

const TOPIC_A_QUESTIONS: QuestionSeed[] = [
  {
    type: "single",
    prompt: "Что обязательно должно прозвучать, чтобы задача считалась поставленной?",
    dataJson: {
      options: [
        "Результат, срок и критерий приёмки",
        "Только срок исполнения",
        "Только имя ответственного",
        "Перечень возможных трудностей",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 30,
    tags: [TAG.tasks],
    orderIndex: 1,
  },
  {
    type: "single",
    prompt: "Сотрудник через час возвращается с вопросом «а как это сделать?». О чём это чаще всего говорит?",
    dataJson: {
      options: [
        "Задача поставлена без описания готового результата",
        "Сотрудник не заинтересован в работе",
        "Задачу следует передать другому",
        "Срок был выбран слишком коротким",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 45,
    tags: [TAG.tasks],
    orderIndex: 2,
  },
  {
    type: "multiple",
    prompt: "Отметьте признаки корректно поставленной задачи.",
    dataJson: {
      options: [
        "Измеримый результат",
        "Названный срок",
        "Указанный приоритет относительно текущих дел",
        "Пошаговая инструкция на каждое действие",
      ],
    },
    correctJson: { correctIndices: [0, 1, 2] },
    difficulty: 55,
    tags: [TAG.tasks],
    orderIndex: 3,
  },
  {
    type: "single",
    prompt: "Чем развивающая обратная связь отличается от оценочной?",
    dataJson: {
      options: [
        "Она описывает наблюдаемое поведение и его последствия",
        "Она даётся только при коллегах",
        "Она всегда положительная",
        "Она заменяет собой постановку задачи",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 40,
    tags: [TAG.feedback],
    orderIndex: 4,
  },
  {
    type: "single",
    prompt: "Когда обратную связь по конкретному эпизоду давать уже поздно?",
    dataJson: {
      options: [
        "Когда с эпизода прошло несколько недель",
        "В тот же день",
        "На следующее утро",
        "Сразу после совещания",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 35,
    tags: [TAG.feedback],
    orderIndex: 5,
  },
  {
    type: "multiple",
    prompt: "Отметьте то, что делает обратную связь применимой.",
    dataJson: {
      options: [
        "Опора на конкретный наблюдаемый факт",
        "Договорённость о следующем шаге",
        "Обобщение вида «ты всегда так делаешь»",
        "Сравнение с другим сотрудником",
      ],
    },
    correctJson: { correctIndices: [0, 1] },
    difficulty: 60,
    tags: [TAG.feedback],
    orderIndex: 6,
  },
  {
    type: "single",
    prompt: "Решение руководителя расходится с ценностями компании. Как поступить?",
    dataJson: {
      options: [
        "Обсудить расхождение и найти решение в рамках ценностей",
        "Оставить как есть — результат важнее",
        "Скрыть расхождение до конца проекта",
        "Переложить решение на подчинённых",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 50,
    tags: [TAG.values],
    orderIndex: 7,
  },
  {
    type: "single",
    prompt: "Зачем компании сформулированные ценности?",
    dataJson: {
      options: [
        "Они задают правило выбора там, где регламента нет",
        "Они заменяют должностные инструкции",
        "Они нужны только для внешних коммуникаций",
        "Они определяют размер премии",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 40,
    tags: [TAG.values],
    orderIndex: 8,
  },
  {
    type: "single",
    prompt: "Клиентоцентричность в работе руководителя — это прежде всего…",
    dataJson: {
      options: [
        "Решение по задаче принимается исходя из пользы для клиента",
        "Согласие с любым требованием клиента",
        "Отказ от внутренних регламентов ради клиента",
        "Передача сложного клиента в другое подразделение",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 45,
    tags: [TAG.values],
    orderIndex: 9,
  },
];

const TOPIC_B_QUESTIONS: QuestionSeed[] = [
  {
    type: "single",
    prompt: "Кто отвечает за то, чтобы сотрудники подразделения знали действующие регламенты?",
    dataJson: {
      options: [
        "Руководитель подразделения",
        "Служба делопроизводства",
        "Каждый сотрудник самостоятельно",
        "Внутренний аудит",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 35,
    tags: [TAG.rules],
    orderIndex: 1,
  },
  {
    type: "single",
    prompt: "Поручение руководителя противоречит действующему регламенту. Что делать?",
    dataJson: {
      options: [
        "Сообщить о противоречии и получить письменное решение",
        "Выполнить поручение, регламент не учитывать",
        "Выполнить регламент, поручение не выполнять",
        "Отложить и то и другое до планёрки",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 55,
    tags: [TAG.rules],
    orderIndex: 2,
  },
  {
    type: "multiple",
    prompt: "Отметьте признаки того, что перед вами действующая редакция документа.",
    dataJson: {
      options: [
        "Указан срок введения в действие",
        "Есть отметка об утверждении",
        "Документ опубликован во внутреннем хранилище",
        "Документ прислал коллега в мессенджере",
      ],
    },
    correctJson: { correctIndices: [0, 1, 2] },
    difficulty: 50,
    tags: [TAG.rules],
    orderIndex: 3,
  },
  {
    type: "single",
    prompt: "Кто проводит первичный инструктаж на рабочем месте?",
    dataJson: {
      options: [
        "Непосредственный руководитель работника",
        "Специалист по охране труда",
        "Работник кадровой службы",
        "Сам работник",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 40,
    tags: [TAG.safety],
    orderIndex: 4,
  },
  {
    type: "single",
    prompt: "Что руководитель делает ПЕРВЫМ при несчастном случае с подчинённым?",
    dataJson: {
      options: [
        "Устраняет действие поражающего фактора и организует первую помощь",
        "Оформляет акт о несчастном случае",
        "Уведомляет службу персонала",
        "Собирает объяснительные",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 45,
    tags: [TAG.safety],
    orderIndex: 5,
  },
  {
    type: "multiple",
    prompt: "Отметьте обязанности руководителя в области охраны труда.",
    dataJson: {
      options: [
        "Не допускать к работе без инструктажа",
        "Обеспечивать средствами индивидуальной защиты",
        "Участвовать в расследовании несчастных случаев в своей зоне",
        "Согласовывать отпуск специалиста по охране труда",
      ],
    },
    correctJson: { correctIndices: [0, 1, 2] },
    difficulty: 60,
    tags: [TAG.safety],
    orderIndex: 6,
  },
  {
    type: "single",
    prompt: "Сотрудник сообщил о нарушении, допущенном его руководителем. Как это рассматривается?",
    dataJson: {
      options: [
        "Обращение рассматривается, а сообщивший защищён от преследования",
        "Обращение считается нарушением субординации",
        "Обращение принимается только анонимно",
        "Обращение передаётся тому, о ком сообщили",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 50,
    tags: [TAG.values],
    orderIndex: 7,
  },
  {
    type: "single",
    prompt: "Что означает принцип «безопасность важнее скорости»?",
    dataJson: {
      options: [
        "Работа останавливается, если её нельзя выполнить безопасно",
        "Сроки всегда сдвигаются на месяц",
        "За безопасность отвечает только профильная служба",
        "Скорость работы значения не имеет",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 40,
    tags: [TAG.values],
    orderIndex: 8,
  },
  {
    type: "single",
    prompt: "Как ценности компании связаны с оценкой руководителя?",
    dataJson: {
      options: [
        "Соответствие ценностям оценивается наравне с достижением результата",
        "К оценке ценности отношения не имеют",
        "Ценности учитываются только при приёме на работу",
        "Ценности заменяют собой показатели результата",
      ],
    },
    correctJson: { correctIndex: 0 },
    difficulty: 45,
    tags: [TAG.values],
    orderIndex: 9,
  },
];

// ─── Subtopic texts (PRD-50 FR-50) ────────────────────────────────────────────

/**
 * Recommendations attached to a KEY, not to a topic. The learner sees the ones whose key
 * scored below {@link PASS_PERCENT}, no matter how the test itself ended — that is the
 * whole point of the feature, and the seeded attempt below is arranged to trigger two of
 * them inside a PASSED test.
 */
function keyFeedback(text: string, courseTitle: string, url: string) {
  return {
    format: "plain" as const,
    text,
    links: [{ title: courseTitle, url }],
    assets: [],
    events: [],
  };
}

const FEEDBACK_A = {
  axis: "tag" as const,
  keys: {
    [TAG.tasks]: keyFeedback(
      "Задачи ставятся без измеримого результата и критерия приёмки — исполнителю приходится " +
        "додумывать. Проговаривайте результат, срок и признак готовности в момент постановки.",
      "Постановка задач: результат, срок, критерий",
      "https://example.invalid/courses/task-setting",
    ),
    [TAG.feedback]: keyFeedback(
      "Обратная связь опирается на оценки и обобщения вместо наблюдаемых фактов, а следующий шаг " +
        "не проговаривается. Разберите модель «факт — последствие — договорённость».",
      "Развивающая обратная связь руководителя",
      "https://example.invalid/courses/feedback",
    ),
    [TAG.values]: keyFeedback(
      "Ценности компании пока не работают как правило выбора там, где регламента нет. " +
        "Разберите кодекс и типовые дилеммы руководителя.",
      "Ценности компании в решениях руководителя",
      "https://example.invalid/courses/values",
    ),
  },
};

const FEEDBACK_B = {
  axis: "tag" as const,
  keys: {
    [TAG.rules]: keyFeedback(
      "Ориентация в регламентах неустойчива: не различаются действующая редакция и присланная копия, " +
        "не отработан порядок действий при противоречии поручения и регламента.",
      "Внутренние регламенты: как найти и как применять",
      "https://example.invalid/courses/regulations",
    ),
    [TAG.safety]: keyFeedback(
      "Зона ответственности руководителя по охране труда усвоена не полностью. " +
        "Повторите порядок инструктажей и первоочередные действия при несчастном случае.",
      "Охрана труда для руководителя подразделения",
      "https://example.invalid/courses/labour-safety",
    ),
    [TAG.values]: keyFeedback(
      "Ценности компании пока не работают как правило выбора там, где регламента нет. " +
        "Разберите кодекс и типовые дилеммы руководителя.",
      "Ценности компании в решениях руководителя",
      "https://example.invalid/courses/values",
    ),
  },
};

// ─── The seeded run ───────────────────────────────────────────────────────────

/**
 * How many delivered questions of each key the seeded learner answers CORRECTLY, per
 * section, on top of {@link ALWAYS_WRONG}. The arithmetic the numbers produce:
 *
 *   «Управленческие компетенции»: 2 + 1 + 2 = 5 из 6 баллов  = 83 %  -> тема пройдена
 *   «Знания о компании»:          2 + 5 + 1 = 8 из 10 баллов = 80 %  -> тема пройдена
 *   тест:                        13 из 16 = 81 %                     -> тест сдан
 *
 * and the two keys at 50 % — «Обратная связь» в первом разделе и «Корпоративные ценности»
 * во втором — print their recommendations anyway. The cross-section key ends at 3 of 4
 * (75 %) in the test scope while reading 100 % in one card and 50 % in the other, which is
 * the whole reason the record is addressed by (scope × key).
 */
const CORRECT_PER_KEY: Record<string, Record<string, number>> = {
  [DEMO.topicA]: { [TAG.tasks]: 2, [TAG.feedback]: 1, [TAG.values]: 2 },
  [DEMO.topicB]: { [TAG.rules]: 2, [TAG.safety]: 2, [TAG.values]: 1 },
};

/**
 * Questions the seeded learner always gets wrong, named by prompt rather than counted.
 *
 * The point is the price: «Охрана труда» delivers all three of its questions (quota 3),
 * priced 3, 2 and 1, and the run has to miss THE CHEAP ONE for the two display bases to
 * disagree. A count alone would leave that to the draw, and the demo would print a
 * different pair of numbers on every re-seed.
 */
const ALWAYS_WRONG = new Set<string>([
  "Отметьте обязанности руководителя в области охраны труда.",
]);

// ─── Seed steps ───────────────────────────────────────────────────────────────

type Named = { id: string; name: string };
type SeededQuestion = { id: string; prompt: string; tags: string[] };

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

async function ensureTopic(
  name: string,
  code: string,
  description: string,
  folderId: string,
): Promise<Named> {
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

async function ensureQuestions(topicId: string, seeds: QuestionSeed[]): Promise<SeededQuestion[]> {
  const all = await api<Array<{ id: string; topicId: string; prompt: string; tags: string[] | null }>>(
    "GET",
    `/api/questions?topicId=${topicId}`,
  );
  const byPrompt = new Map(all.filter((q) => q.topicId === topicId).map((q) => [q.prompt, q]));
  const out: SeededQuestion[] = [];
  let created = 0;
  for (const seed of seeds) {
    const existing = byPrompt.get(seed.prompt);
    if (existing) {
      out.push({ id: existing.id, prompt: existing.prompt, tags: existing.tags ?? [] });
      continue;
    }
    const made = await api<{ id: string }>("POST", "/api/questions", {
      topicId,
      type: seed.type,
      prompt: seed.prompt,
      dataJson: seed.dataJson,
      correctJson: seed.correctJson,
      difficulty: seed.difficulty,
      shuffleAnswers: true,
      tags: seed.tags,
      orderIndex: seed.orderIndex,
    });
    out.push({ id: made.id, prompt: seed.prompt, tags: seed.tags });
    created += 1;
  }
  console.log(`  * вопросов в теме: ${out.length} (создано ${created})`);
  return out;
}

/** The test body — identical for create and update, so a re-run repairs the settings. */
function testBody(topicAId: string, topicBId: string, folderId: string) {
  return {
    title: DEMO.test,
    description:
      "Демонстрационный тест: подытоги по подтемам (тегам вопросов) в карточках тем и сводным " +
      "блоком по тесту, с рекомендациями на подтему. Оформление — шаблон «Сертификация (РТК)».",
    folderId,
    overallPassRuleJson: { type: "percent", value: PASS_PERCENT },
    questionOrder: "random" as const,
    timeLimitMinutes: 20,
    maxAttempts: 5,
    showCorrectAnswers: true,
    allowReturnToUnanswered: true,
    allowAnswerChange: true,
    showSectionResults: true,
    defaultQuestionPoints: 1,
    status: "draft" as const,
    // MUST be sent: `PUT /api/tests/:id` keeps `sections` only when the body says the test
    // is standard — an absent `mode` reads as «не стандартный», the sections are dropped
    // on the way in, and the update returns a cheerful 200 having changed nothing.
    mode: "standard" as const,
    flowPolicyJson: { mode: "linear_by_topics" },
    // PRD-50 FR-13/FR-44: bars WITH the number, counted per question (so the denominator
    // is the constant «сколько вопросов выдано»), printed BOTH inside the topic cards and
    // as the test-scope summary block.
    breakdownDisplayJson: {
      visibility: "bar_and_value" as const,
      basis: "units" as const,
      placement: "both" as const,
    },
    introJson: {
      results: {
        format: "plain" as const,
        text:
          "Ниже — результат сертификации. Под каждой темой показаны подытоги по подтемам: " +
          "это теги вопросов, по которым собиралась выдача. Подтема не выносит вердикта — " +
          "она показывает, где результат просел, и приносит рекомендации.",
      },
      report: {
        format: "plain" as const,
        text:
          "Отчёт о сертификации руководителя. Помимо общего итога и итогов по темам, документ " +
          "печатает подытоги по подтемам и рекомендации к тем из них, где результат оказался " +
          "ниже проходного порога.",
      },
    },
    sections: [
      {
        topicId: topicAId,
        drawCount: 6,
        required: true,
        topicPassRuleJson: { source: "inherit_overall" },
        // PRD-11: two questions per tag, exactly — the key denominators stay constant.
        drawBlueprintJson: {
          strata: [
            { tag: TAG.tasks, count: 2, mode: "exact" as const },
            { tag: TAG.feedback, count: 2, mode: "exact" as const },
            { tag: TAG.values, count: 2, mode: "exact" as const },
          ],
        },
        breakdownFeedbackJson: FEEDBACK_A,
      },
      {
        topicId: topicBId,
        // Seven, not six: «Охрана труда» delivers all three of its questions, because the
        // demo needs a key whose per-question and per-point shares differ, and that is
        // only deterministic when the whole priced trio is on the screen.
        drawCount: 7,
        required: true,
        topicPassRuleJson: { source: "inherit_overall" },
        drawBlueprintJson: {
          strata: [
            { tag: TAG.rules, count: 2, mode: "exact" as const },
            { tag: TAG.safety, count: 3, mode: "exact" as const },
            { tag: TAG.values, count: 2, mode: "exact" as const },
          ],
        },
        breakdownFeedbackJson: FEEDBACK_B,
      },
    ],
  };
}

/** Answer that scores full marks for this question. */
function correctAnswer(q: { type: string; correctJson: Record<string, unknown> }): unknown {
  if (q.type === "multiple") return (q.correctJson.correctIndices as number[]) ?? [];
  return (q.correctJson.correctIndex as number) ?? 0;
}

/**
 * Answer that scores ZERO. For a single choice, any other index; for a multiple choice,
 * one option that is NOT among the correct ones (an empty array would read as «не отвечал»
 * and would fall out of `answered`, which is not what the demo wants to show).
 */
function wrongAnswer(q: {
  type: string;
  correctJson: Record<string, unknown>;
  dataJson: Record<string, unknown>;
}): unknown {
  const options = ((q.dataJson.options as string[]) ?? []).length;
  if (q.type === "multiple") {
    const correct = new Set((q.correctJson.correctIndices as number[]) ?? []);
    for (let i = 0; i < options; i += 1) if (!correct.has(i)) return [i];
    return [];
  }
  const correct = (q.correctJson.correctIndex as number) ?? 0;
  return correct === 0 ? Math.min(1, options - 1) : 0;
}

async function main(): Promise<void> {
  console.log(`Стенд: ${BASE}`);
  await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  const me = await api<{ user: { id: string } }>("GET", "/api/auth/me");
  console.log(`Вход выполнен: ${EMAIL}`);

  console.log("Содержимое:");
  const contentFolder = await ensureFolder("/api/folders", DEMO.contentFolder);
  const topicA = await ensureTopic(
    DEMO.topicA,
    DEMO.topicACode,
    "Постановка задач, обратная связь и ценности компании в работе руководителя.",
    contentFolder.id,
  );
  const questionsA = await ensureQuestions(topicA.id, TOPIC_A_QUESTIONS);
  const topicB = await ensureTopic(
    DEMO.topicB,
    DEMO.topicBCode,
    "Регламенты и процессы, охрана труда и ценности компании.",
    contentFolder.id,
  );
  const questionsB = await ensureQuestions(topicB.id, TOPIC_B_QUESTIONS);
  console.log(`  * всего вопросов в банке демонстрации: ${questionsA.length + questionsB.length}`);

  console.log("Тест:");
  const testFolder = await ensureFolder("/api/test-folders", DEMO.testFolder);
  const tests = await api<Array<{ id: string; title: string }>>("GET", "/api/tests");
  const body = testBody(topicA.id, topicB.id, testFolder.id);
  let test = tests.find((t) => t.title === DEMO.test);
  if (test) {
    await api("PUT", `/api/tests/${test.id}`, body);
    console.log(`  = тест «${DEMO.test}» обновлён`);
  } else {
    test = await api<{ id: string; title: string }>("POST", "/api/tests", body);
    console.log(`  + тест «${DEMO.test}»`);
  }

  // PRD-15 block D: the «Охрана труда» trio costs 3, 2 and 1 point (the third keeps the
  // test default). Without unequal prices INSIDE one key the two display bases would print
  // the same number everywhere and the setting would look decorative.
  const PRICES: Array<[string, number]> = [
    ["Кто проводит первичный инструктаж на рабочем месте?", 3],
    ["Что руководитель делает ПЕРВЫМ при несчастном случае с подчинённым?", 2],
  ];
  for (const [prompt, points] of PRICES) {
    const question = questionsB.find((q) => q.prompt === prompt);
    if (!question) throw new Error(`Вопрос для переоценки не найден: ${prompt}`);
    await api("PUT", `/api/tests/${test.id}/question-scoring/${question.id}`, { points });
  }
  console.log(`  * цена подтемы «${TAG.safety}»: 3, 2 и 1 балл`);

  // Оформление: the RTK certification template.
  const templates = await api<Array<{ id: string; version: string; templateApiVersion?: string }>>(
    "GET",
    "/api/templates",
  );
  const certification = templates.find((t) => t.id === "certification");
  if (!certification) {
    throw new Error("Шаблон «certification» не найден в реестре — сначала загрузите его");
  }
  await api("PUT", `/api/tests/${test.id}/design`, {
    templateId: certification.id,
    templateVersion: certification.version,
    templateApiVersion: certification.templateApiVersion,
    params: {},
  });
  console.log(`  * оформление: «Сертификация (РТК)» ${certification.version}`);

  // Publish (a fresh snapshot is taken here, so it carries the settings just written).
  await api("PATCH", `/api/tests/${test.id}/status`, { status: "published" });
  console.log("  * тест опубликован");

  // Assign to the seeding account itself, so the run is playable the moment this ends.
  const assignments = await api<Array<{ id: string; userId: string | null }>>(
    "GET",
    `/api/tests/${test.id}/assignments`,
  );
  if (!assignments.some((a) => a.userId === me.user.id)) {
    await api("POST", `/api/tests/${test.id}/assignments`, { userId: me.user.id });
    console.log(`  + тест назначен учётной записи ${EMAIL}`);
  } else {
    console.log(`  = тест уже назначен ${EMAIL}`);
  }

  if (!PLAY_ATTEMPT) {
    console.log(`\nГотово (без прогона). Тест: ${BASE}/author/tests`);
    return;
  }

  console.log("Прогон:");
  const attempts = await api<Array<{ id: string; testId: string; finishedAt: string | null }>>(
    "GET",
    "/api/learner/attempts",
  );
  if (attempts.some((a) => a.testId === test.id && a.finishedAt)) {
    console.log("  = завершённая попытка уже есть, новую не начинаю");
    console.log(`\nГотово. Тест: ${BASE}/author/tests`);
    return;
  }

  const started = await api<{
    id: string;
    variantJson: { sections: Array<{ topicId: string; topicName: string; questionIds: string[] }> };
    questions: Array<{
      id: string;
      type: string;
      prompt: string;
      tags: string[] | null;
      dataJson: Record<string, unknown>;
      correctJson: Record<string, unknown>;
    }>;
  }>("POST", `/api/tests/${test.id}/attempts/start`);

  const byId = new Map(started.questions.map((q) => [q.id, q]));
  const answers: Record<string, unknown> = {};
  for (const section of started.variantJson.sections) {
    const plan = CORRECT_PER_KEY[section.topicName];
    if (!plan) throw new Error(`Нет плана ответов для раздела «${section.topicName}»`);
    const budget: Record<string, number> = { ...plan };
    for (const questionId of section.questionIds) {
      const q = byId.get(questionId);
      if (!q) throw new Error(`Вопрос ${questionId} не пришёл в выдаче`);
      const key = (q.tags ?? [])[0] ?? "";
      const left = budget[key] ?? 0;
      if (ALWAYS_WRONG.has(q.prompt)) {
        answers[questionId] = wrongAnswer(q);
      } else if (left > 0) {
        budget[key] = left - 1;
        answers[questionId] = correctAnswer(q);
      } else {
        answers[questionId] = wrongAnswer(q);
      }
    }
    const unspent = Object.entries(budget).filter(([, n]) => n > 0);
    if (unspent.length) {
      throw new Error(
        `В разделе «${section.topicName}» выдано меньше вопросов, чем ожидал план: ` +
          unspent.map(([k, n]) => `${k}: не хватило ${n}`).join(", "),
      );
    }
  }

  const finished = await api<{
    result: {
      overallPercent: number;
      overallPassed: boolean;
      totalEarnedPoints: number;
      totalPossiblePoints: number;
      topicResults: Array<{
        topicName: string;
        percent: number;
        passed: boolean;
        breakdown?: Array<{ key: string; percentUnits: number; percentPoints: number }>;
      }>;
      breakdowns?: Array<{ key: string; percentUnits: number; percentPoints: number }>;
    };
  }>("POST", `/api/attempts/${started.id}/finish`, { answers });

  const r = finished.result;
  console.log(
    `  * попытка завершена: ${Math.round(r.overallPercent)} % ` +
      `(${r.totalEarnedPoints} из ${r.totalPossiblePoints} баллов) — ` +
      `${r.overallPassed ? "сдан" : "не сдан"}`,
  );
  for (const topic of r.topicResults) {
    console.log(
      `    ${topic.topicName}: ${Math.round(topic.percent)} % (${topic.passed ? "пройдена" : "не пройдена"})`,
    );
    for (const row of topic.breakdown ?? []) {
      console.log(
        `      ${row.key}: ${Math.round(row.percentUnits)} % по вопросам / ` +
          `${Math.round(row.percentPoints)} % по баллам`,
      );
    }
  }
  for (const row of r.breakdowns ?? []) {
    console.log(
      `    [по тесту] ${row.key}: ${Math.round(row.percentUnits)} % по вопросам / ` +
        `${Math.round(row.percentPoints)} % по баллам`,
    );
  }

  console.log(`\nГотово. Тест: ${BASE}/author/tests | Итоги: ${BASE}/learner/history`);
}

main().catch((error: unknown) => {
  console.error("Сбой засева:", (error as Error).message);
  process.exit(1);
});
