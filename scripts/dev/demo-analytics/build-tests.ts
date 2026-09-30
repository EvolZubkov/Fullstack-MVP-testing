/**
 * @module scripts/dev/demo-analytics/build-tests
 * @description Собирает на РАБОТАЮЩЕМ стенде два демонстрационных теста для показа аналитики
 * и психометрики и выгружает их пакетами переноса `.tbtest`.
 *
 * Пакеты — половина демо-набора; вторая половина — выгрузки отчёта LMS, которые по этим пакетам
 * синтезирует `generate-lms-exports.ts`. Выгрузка привязывается к тесту по идентификаторам
 * вопросов, а импорт пакета их сохраняет, поэтому пара «пакет + выгрузка» заливается на любой
 * стенд и сходится там сама.
 *
 * Тесты:
 *
 * 1. «Демо-аналитика: информационная безопасность» — оцениваемый. Три раздела: закреплённый
 *    (все задания, на нём разложены «испорченные» пункты для вкладки «Качество заданий»),
 *    раздел с двумя вариантами (PRD-17) и раздел со случайной выдачей 3 из 5. Все девять типов
 *    вопросов, подтемы-теги, заявленная трудность, проходные пороги, показатель.
 * 2. «Демо-аналитика: опросник рабочего стиля» — измерительный, без эталонов. Четыре шкалы:
 *    три с полосами толкования: у одной обратный пункт перевёрнут правильно, у другой — нет
 *    (работает против шкалы), плюс «мёртвый» пункт и ипсативная шкала без полос на распределении
 *    баллов.
 *
 * Всё идёт через REST API, как у `seed-guide-demo.ts`: так тест получает и свои экранные
 * страницы, а пакет выгружает тот же код, что и кнопка «Экспорт» в редакторе.
 *
 * Usage:
 *   npx tsx scripts/dev/demo-analytics/build-tests.ts --base http://localhost:5000 \
 *     --email admin@test.com --password admin123 --out docs/demo/analytics
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg("base", "http://localhost:5000").replace(/\/+$/, "");
const EMAIL = arg("email", "admin@test.com");
const PASSWORD = arg("password", "admin123");
const OUT = arg("out", "docs/demo/analytics");

/** Префикс всех сущностей: по нему демо узнаётся и на общем стенде не путается с живым. */
const MARK = "Демо-аналитика";

// ─── HTTP ─────────────────────────────────────────────────────────────────────

let cookie = "";

async function raw(method: string, url: string, body?: unknown): Promise<Response> {
  const res = await fetch(BASE + url, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie?.startsWith("connect.sid=")) cookie = setCookie.split(";")[0];
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${(await res.text()).slice(0, 400)}`);
  return res;
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const text = await (await raw(method, url, body)).text();
  return (text ? JSON.parse(text) : null) as T;
}

// ─── Содержимое ───────────────────────────────────────────────────────────────

interface QuestionSeed {
  type: string;
  prompt: string;
  dataJson: unknown;
  correctJson: unknown;
  difficulty?: number;
  tags?: string[];
}

/** Одиночный выбор: первый вариант верный, кроме случаев, где эталон указан явно. */
function single(prompt: string, options: string[], correctIndex: number, difficulty: number, tag: string): QuestionSeed {
  return { type: "single", prompt, dataJson: { options }, correctJson: { correctIndex }, difficulty, tags: [tag] };
}

/**
 * Закреплённый раздел оцениваемого теста. Порядок важен: генератор выгрузок узнаёт роль
 * задания по его месту в разделе (см. `ROLE_BY_POSITION` в `generate-lms-exports.ts`).
 */
const CORE: QuestionSeed[] = [
  single("Какой пароль надёжнее всего?", ["Kx!7m#Qe2vL9", "qwerty123", "Дата рождения", "Имя питомца"], 0, 40, "Пароли"),
  single("Как часто рекомендуется менять пароль при подозрении на компрометацию?", ["Немедленно", "Раз в год", "Никогда", "При смене должности"], 0, 25, "Пароли"),
  single("Какой алгоритм используется для хранения паролей в современных системах?", ["Argon2id", "MD5", "Base64", "ROT13"], 0, 60, "Пароли"),
  single("Можно ли сообщать свой пароль коллеге?", ["Нет, ни при каких условиях", "Да, если он из моего отдела", "Да, по просьбе руководителя", "Да, в выходные"], 0, 10, "Пароли"),
  // Испорченный ключ: эталоном отмечен НЕВЕРНЫЙ вариант, сильные участники выбирают верный.
  single("Что обязательно проверить в письме со ссылкой на вход в корпоративную систему?", ["Тему письма", "Домен отправителя и адрес ссылки", "Время отправки", "Размер вложений"], 0, 50, "Фишинг"),
  single("Какой признак чаще всего выдаёт целевой фишинг?", ["Срочность и давление", "Подпись с логотипом", "Письмо на русском языке", "Наличие вложения"], 0, 50, "Фишинг"),
  // На уровне угадывания: верный вариант выбирают не чаще случайного.
  single("Какой порт по умолчанию использует протокол RDP?", ["3389", "22", "443", "8080"], 0, 70, "Доступ"),
  // Мёртвый и «перевёрнутый» дистракторы.
  single("Кто согласует выдачу прав администратора?", ["Владелец ресурса", "Сам сотрудник", "Любой коллега", "Служба уборки"], 0, 45, "Доступ"),
  // Отвечают не читая: доля слишком быстрых ответов выше порога.
  single("Какой принцип требует выдавать только необходимые права?", ["Минимальных привилегий", "Открытых дверей", "Единого пароля", "Доверия по умолчанию"], 0, 35, "Доступ"),
  // Медленное задание: медиана времени вдвое выше медианы теста.
  single(
    "Сотрудник получил письмо от «ИТ-поддержки» с просьбой срочно подтвердить учётные данные по ссылке, " +
      "адрес отправителя совпадает с корпоративным, но ссылка ведёт на домен, отличающийся одной буквой. " +
      "Вложение отсутствует, в подписи указан реальный телефон поддержки. Какое действие правильное?",
    ["Не переходить и сообщить в службу ИБ", "Перейти и проверить страницу", "Ответить на письмо", "Переслать коллегам для проверки"],
    0, 65, "Фишинг",
  ),
  // Быстро и неверно: медиана не больше 5 секунд, верных не больше 40 %.
  single("Что означает аббревиатура MFA?", ["Многофакторная аутентификация", "Мастер-файл архива", "Модуль фильтрации адресов", "Метод фиксации аудита"], 0, 30, "Доступ"),
  {
    type: "multiple",
    prompt: "Отметьте признаки фишингового письма.",
    dataJson: { options: ["Требование срочных действий", "Несовпадение домена ссылки", "Корпоративный шаблон письма", "Подпись руководителя"] },
    correctJson: { correctIndices: [0, 1] },
    difficulty: 45,
    tags: ["Фишинг"],
  },
  {
    type: "matching",
    prompt: "Сопоставьте угрозу и меру защиты.",
    dataJson: {
      left: ["Подбор пароля", "Фишинг", "Утечка с ноутбука"],
      right: ["Блокировка после неудачных попыток", "Проверка ссылок и отправителя", "Шифрование диска"],
    },
    correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }] },
    difficulty: 55,
    tags: ["Доступ"],
  },
  {
    type: "ranking",
    prompt: "Расставьте шаги реагирования на инцидент по порядку.",
    dataJson: { items: ["Обнаружение", "Сдерживание", "Устранение", "Восстановление"] },
    correctJson: { correctOrder: [0, 1, 2, 3] },
    difficulty: 60,
    tags: ["Доступ"],
  },
];

/** Раздел с двумя фиксированными вариантами (PRD-17): два варианта по четыре задания. */
const SOCIAL: QuestionSeed[] = [
  single("Звонящий представился сотрудником банка и просит код из SMS. Ваши действия?", ["Прервать разговор", "Назвать код", "Попросить перезвонить позже", "Назвать половину кода"], 0, 30, "Звонки"),
  single("Незнакомец просит придержать дверь в серверную. Что делать?", ["Вежливо отказать и направить на пост охраны", "Пропустить", "Пропустить, если у него бейдж", "Проводить лично"], 0, 40, "Физический доступ"),
  {
    type: "short",
    prompt: "Как называется атака, при которой злоумышленник выдаёт себя за доверенное лицо по телефону?",
    dataJson: { maxLength: 60 },
    correctJson: {
      answerKind: "text",
      join: "any",
      rules: [
        { kind: "text", match: "wildcard", value: "вишинг" },
        { kind: "text", match: "wildcard", value: "vishing" },
      ],
    },
    difficulty: 55,
    tags: ["Звонки"],
  },
  {
    type: "short",
    prompt: "Сколько минут по регламенту отводится на сообщение об инциденте в службу ИБ?",
    dataJson: { maxLength: 10 },
    correctJson: {
      answerKind: "number",
      join: "all",
      unit: "мин",
      rules: [{ kind: "number", op: "eq", value: 15, tolerance: { unit: "abs", value: 5 } }],
    },
    difficulty: 50,
    tags: ["Звонки"],
  },
  single("Найденную на парковке флешку с логотипом компании следует…", ["Сдать в службу ИБ", "Проверить на своём ПК", "Выбросить", "Отдать коллегам"], 0, 35, "Физический доступ"),
  {
    type: "blanks",
    prompt: "О подозрительном письме сообщают на адрес {{mailbox}}, а само письмо пересылают как {{attach}}.",
    dataJson: {},
    correctJson: {
      blanks: [
        { id: "mailbox", answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "soc@*" }] },
        { id: "attach", answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "вложение" }] },
      ],
    },
    difficulty: 65,
    tags: ["Физический доступ"],
  },
  single("Коллега просит временно воспользоваться вашим пропуском. Ваши действия?", ["Отказать", "Дать на час", "Дать, если он из отдела", "Дать под расписку"], 0, 25, "Физический доступ"),
  single("Сообщение в мессенджере от «директора» с просьбой срочно оплатить счёт. Первое действие?", ["Перезвонить директору по известному номеру", "Оплатить", "Переслать в бухгалтерию", "Ответить в мессенджере"], 0, 45, "Звонки"),
];

/** Раздел со случайной выдачей 3 из 5: даёт экспозицию и неравномерную выдачу. */
const INCIDENTS: QuestionSeed[] = [
  single("Куда сообщать о потере корпоративного ноутбука?", ["В службу ИБ и руководителю", "Никуда", "Только в полицию", "В бухгалтерию"], 0, 30, "Инциденты"),
  single("Что делать, если на экране появилось требование выкупа?", ["Отключить ПК от сети и сообщить в ИБ", "Заплатить", "Перезагрузить", "Удалить файлы"], 0, 40, "Инциденты"),
  single("Можно ли самостоятельно устанавливать ПО на рабочий компьютер?", ["Только из каталога разрешённого ПО", "Да, любое", "Да, если бесплатное", "Да, по выходным"], 0, 35, "Инциденты"),
  single("Что делать с конфиденциальным документом, отправленным не тому адресату?", ["Сообщить в ИБ и попросить удалить", "Ничего", "Отправить повторно", "Удалить у себя"], 0, 50, "Инциденты"),
  {
    type: "long",
    prompt: "Опишите своими словами, как вы поступите при подозрении на утечку данных.",
    dataJson: { placeholder: "Своими словами", maxLength: 2000 },
    correctJson: {},
    tags: ["Инциденты"],
  },
];

/** Градации шкалы Ликерта опросника. */
const GRADES = ["Совсем не согласен", "Скорее не согласен", "Затрудняюсь ответить", "Скорее согласен", "Полностью согласен"];

function likert(prompt: string, tag: string): QuestionSeed {
  return { type: "scale", prompt, dataJson: { options: GRADES }, correctJson: {}, tags: [tag] };
}

/**
 * Опросник. Порядок важен для генератора выгрузок: пункты 0-3 — шкала «Проактивность»
 * (пункт 3 обратный и ПЕРЕВЁРНУТ правильно), 4-7 — «Командность» (пункт 7 обратный и НЕ
 * перевёрнут — работает против шкалы), 8 — «мёртвый» пункт шкалы «Проактивность», 9 —
 * распределение баллов (ипсативная шкала), 10 — выбор вне шкал, 11 — развёрнутый ответ.
 */
const SURVEY: QuestionSeed[] = [
  likert("Я берусь за задачи, не дожидаясь поручения", "Проактивность"),
  likert("Я замечаю проблемы в процессе раньше других", "Проактивность"),
  likert("Я предлагаю улучшения, даже если меня об этом не просили", "Проактивность"),
  likert("Я предпочитаю ждать чётких указаний руководителя", "Проактивность"),
  likert("Мне важно, чтобы команда достигла цели вместе", "Командность"),
  likert("Я охотно помогаю коллегам с их задачами", "Командность"),
  likert("Я делюсь знаниями с командой", "Командность"),
  likert("Я предпочитаю работать в одиночку", "Командность"),
  likert("Я соблюдаю сроки, о которых договорился", "Проактивность"),
  {
    type: "allocation",
    prompt: "Распределите 10 баллов между утверждениями по тому, что для вас важнее в работе",
    dataJson: { options: ["Результат", "Отношения в команде", "Порядок и процесс"], budget: 10, minPerOption: 0, maxPerOption: 10 },
    correctJson: {},
    tags: ["Ценности"],
  },
  // Измерительный выбор без шкалы — тип `scale`: одиночный выбор без эталона импорт считает
  // оцениваемым заданием без исхода и отбрасывает.
  { type: "scale", prompt: "Какой формат работы вам ближе?", dataJson: { options: ["Офис", "Удалённо", "Гибрид"] }, correctJson: {}, tags: ["Формат"] },
  {
    type: "long",
    prompt: "Что помогло бы вам работать эффективнее?",
    dataJson: { placeholder: "Своими словами", maxLength: 2000 },
    correctJson: {},
    tags: ["Формат"],
  },
];

// ─── Шаги ─────────────────────────────────────────────────────────────────────

type Named = { id: string; name: string };

async function ensureFolder(url: string, name: string): Promise<Named> {
  const found = (await api<Named[]>("GET", url)).find(f => f.name === name);
  return found ?? api<Named>("POST", url, { name, parentId: null });
}

/** Тема создаётся ЗАНОВО, если её нет: у каждой темы демо ровно один тест, иначе импорт выгрузки откажет. */
async function ensureTopic(name: string, code: string, folderId: string): Promise<Named> {
  const found = (await api<Named[]>("GET", "/api/topics")).find(t => t.name === name);
  return found ?? api<Named>("POST", "/api/topics", { name, code, description: `${MARK}: синтетические данные.`, folderId });
}

async function ensureQuestions(topicId: string, seeds: QuestionSeed[]): Promise<string[]> {
  const existing = await api<Array<{ id: string; topicId: string; prompt: string }>>("GET", `/api/questions?topicId=${topicId}`);
  const byPrompt = new Map(existing.filter(q => q.topicId === topicId).map(q => [q.prompt, q.id]));
  const ids: string[] = [];
  for (const [orderIndex, seed] of seeds.entries()) {
    const known = byPrompt.get(seed.prompt);
    if (known) {
      ids.push(known);
      continue;
    }
    const created = await api<{ id: string }>("POST", "/api/questions", {
      topicId,
      ...seed,
      difficulty: seed.difficulty ?? null,
      shuffleAnswers: seed.type === "single" || seed.type === "multiple",
      orderIndex: orderIndex + 1,
    });
    ids.push(created.id);
  }
  return ids;
}

async function findTest(title: string): Promise<{ id: string } | undefined> {
  return (await api<Array<{ id: string; title: string }>>("GET", "/api/tests")).find(t => t.title === title);
}

async function ensureScale(testId: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const scales = await api<Array<{ id: string; key: string }>>("GET", `/api/tests/${testId}/scales`);
  const found = scales.find(s => s.key === body.key);
  if (found) return api("PUT", `/api/tests/${testId}/scales/${found.id}`, body);
  return api("POST", `/api/tests/${testId}/scales`, body);
}

async function ensureVariable(testId: string, body: Record<string, unknown>): Promise<void> {
  const vars = await api<Array<{ name: string }>>("GET", `/api/tests/${testId}/result-variables`);
  if (!vars.some(v => v.name === body.name)) await api("POST", `/api/tests/${testId}/result-variables`, body);
}

/** Вклад градаций пункта Ликерта: прямой — номер градации, обратный — зеркальный. */
function likertContribution(scaleId: string, reversed: boolean) {
  return GRADES.map((_, index) => ({
    scaleId,
    sourceType: "option",
    sourceKey: String(index),
    valueJson: reversed ? GRADES.length - 1 - index : index,
    weight: 1,
    sortOrder: index,
  }));
}

function bands(labels: Array<[string, string, number, number]>) {
  return { bands: labels.map(([level, label, min, max]) => ({ level, label, min, max })) };
}

async function buildKnowledgeTest(folderId: string, testFolderId: string): Promise<string> {
  const title = `${MARK}: информационная безопасность`;
  const core = await ensureTopic(`${MARK} · Основы ИБ`, "demo_ib_core", folderId);
  const social = await ensureTopic(`${MARK} · Социальная инженерия`, "demo_ib_social", folderId);
  const incidents = await ensureTopic(`${MARK} · Инциденты`, "demo_ib_incidents", folderId);
  const coreIds = await ensureQuestions(core.id, CORE);
  const socialIds = await ensureQuestions(social.id, SOCIAL);
  await ensureQuestions(incidents.id, INCIDENTS);

  const sections = [
    { topicId: core.id, drawCount: coreIds.length, drawAll: true, required: true, topicPassRuleJson: { type: "percent", value: 60 } },
    {
      topicId: social.id,
      drawCount: 4,
      required: true,
      topicPassRuleJson: { type: "percent", value: 60 },
      formSetJson: {
        forms: [
          { id: "demo-form-a", label: "Вариант А", questionIds: [socialIds[0], socialIds[1], socialIds[2], socialIds[3]] },
          { id: "demo-form-b", label: "Вариант Б", questionIds: [socialIds[4], socialIds[5], socialIds[6], socialIds[7]] },
        ],
      },
    },
    { topicId: incidents.id, drawCount: 3, required: false, topicPassRuleJson: { type: "percent", value: 50 } },
  ];

  let test = await findTest(title);
  if (!test) {
    test = await api<{ id: string }>("POST", "/api/tests", {
      title,
      description: "Синтетический тест для демонстрации аналитики и психометрики. Все данные вымышлены.",
      folderId: testFolderId,
      overallPassRuleJson: { type: "percent", value: 70 },
      defaultQuestionPoints: 1,
      maxAttempts: 3,
      status: "draft",
      mode: "standard",
      sections,
    });
  } else {
    await api("PUT", `/api/tests/${test.id}`, { mode: "standard", overallPassRuleJson: { type: "percent", value: 70 }, sections });
  }

  await ensureVariable(test.id, {
    name: "certified",
    label: "Допуск к работе с персональными данными",
    type: "boolean",
    formula: "percent >= 70",
    learnerVisibility: "level_and_value",
    scormTarget: "both",
    controlsStatus: "none",
  });
  return test.id;
}

async function buildSurveyTest(folderId: string, testFolderId: string): Promise<string> {
  const title = `${MARK}: опросник рабочего стиля`;
  const topic = await ensureTopic(`${MARK} · Рабочий стиль`, "demo_style", folderId);
  const ids = await ensureQuestions(topic.id, SURVEY);

  let test = await findTest(title);
  const sections = [{ topicId: topic.id, drawCount: ids.length, drawAll: true, required: true }];
  if (!test) {
    test = await api<{ id: string }>("POST", "/api/tests", {
      title,
      description: "Синтетический опросник для демонстрации шкал и их психометрики. Все данные вымышлены.",
      folderId: testFolderId,
      status: "draft",
      mode: "standard",
      sections,
    });
  }

  const common = { type: "number", aggregation: "sum", normalization: "none", direction: "positive", learnerVisibility: "level_and_value", scormTarget: "both" };
  const proactive = await ensureScale(test.id, {
    ...common,
    key: "proactive",
    label: "Проактивность",
    description: "Готовность действовать без поручения. Пункт «ждать указаний» обратный и перевёрнут.",
    configJson: bands([["low", "Низкая", 0, 7], ["mid", "Средняя", 8, 13], ["high", "Высокая", 14, 20]]),
  });
  const team = await ensureScale(test.id, {
    ...common,
    key: "teamwork",
    label: "Командность",
    description: "Ориентация на совместный результат. Пункт «работать в одиночку» обратный, но НЕ перевёрнут — нарочно.",
    configJson: bands([["low", "Низкая", 0, 5], ["mid", "Средняя", 6, 9], ["high", "Высокая", 10, 16]]),
  });
  const values = await ensureScale(test.id, {
    ...common,
    key: "results_focus",
    label: "Ориентация на результат",
    description: "Ипсативная шкала: баллы распределения, отданные результату.",
    configJson: bands([["low", "Слабая", 0, 3], ["mid", "Умеренная", 4, 6], ["high", "Сильная", 7, 10]]),
  });

  // Ипсативная шкала: сумма распределения у всех одинакова (10). Полос у неё нет нарочно —
  // экран профиля показывает и такое состояние.
  const mix = await ensureScale(test.id, {
    ...common,
    key: "values_mix",
    label: "Баланс ценностей",
    description: "Ипсативная шкала: все три утверждения распределения, сумма всегда равна бюджету.",
    configJson: {},
  });

  const put = (questionId: string, rows: unknown[]) => api("PUT", `/api/tests/${test!.id}/measurements/${questionId}`, rows);
  for (const at of [0, 1, 2]) await put(ids[at], likertContribution(proactive.id, false));
  await put(ids[3], likertContribution(proactive.id, true));
  for (const at of [4, 5, 6, 7]) await put(ids[at], likertContribution(team.id, false));
  // Мёртвый пункт — в той же шкале: почти все отвечают одинаково.
  await put(ids[8], likertContribution(proactive.id, false));
  await put(ids[9], [
    { scaleId: values.id, sourceType: "option_allocation", sourceKey: "0", valueJson: 1, weight: 1, sortOrder: 0 },
    ...[0, 1, 2].map(index => ({
      scaleId: mix.id, sourceType: "option_allocation", sourceKey: String(index), valueJson: 1, weight: 1, sortOrder: index + 1,
    })),
  ]);

  await ensureVariable(test.id, {
    name: "engagement",
    label: "Индекс вовлечённости",
    type: "number",
    formula: 'scaleById("proactive").raw + scaleById("teamwork").raw',
    learnerVisibility: "level_and_value",
    scormTarget: "both",
    controlsStatus: "none",
  });
  return test.id;
}

async function exportPackage(testId: string, file: string): Promise<void> {
  const res = await raw("GET", `/api/tests/${testId}/transfer`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buffer);
  console.log(`  пакет: ${file} (${buffer.length} байт)`);
}

async function main(): Promise<void> {
  await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  console.log(`Стенд: ${BASE}, вход: ${EMAIL}`);

  const folder = await ensureFolder("/api/folders", MARK);
  const testFolder = await ensureFolder("/api/test-folders", MARK);
  const knowledge = await buildKnowledgeTest(folder.id, testFolder.id);
  const survey = await buildSurveyTest(folder.id, testFolder.id);

  mkdirSync(OUT, { recursive: true });
  await exportPackage(knowledge, path.join(OUT, "demo-ib-test.tbtest"));
  await exportPackage(survey, path.join(OUT, "demo-style-survey.tbtest"));
}

main().catch((error: unknown) => {
  console.error("Сбой:", (error as Error).message);
  process.exit(1);
});
