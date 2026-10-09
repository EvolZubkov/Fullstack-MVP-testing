/**
 * @module scripts/dev/demo-analytics/load-demo
 * @description Заливает демо-набор аналитики на стенд ТЕМИ ЖЕ запросами, что делает интерфейс:
 * импорт пакетов (`/api/tests/transfer/inspect` + `apply`), публикация, загрузка выгрузок LMS
 * (`/api/analytics/lms-import`). Ручной путь описан в `docs/demo/analytics/README.md`; скрипт
 * нужен, когда набор разворачивают не для показа, а для проверки.
 *
 * Порядок шагов не случаен:
 *
 * 1. Выгрузка первой волны грузится ДО второй публикации: у её строк версия 1.
 * 2. Перед второй публикацией стартует одна веб-попытка. Удаление старых снимков при
 *    публикации смотрит только на веб-попытки, и без неё снимок версии 1 исчез бы вместе с
 *    разрезом «по версиям» — импортированные строки его не удерживают.
 * 3. Между публикациями меняется формулировка одного вопроса: так у него появляются две
 *    редакции содержания (блок «Версии содержания» в разборе задания).
 *
 * Повторный запуск на том же стенде не нужен и не поддерживается: пакет второй раз ляжет
 * обновлением, а выгрузки — повторной загрузкой тех же строк.
 *
 * Usage:
 *   npx tsx scripts/dev/demo-analytics/load-demo.ts --base http://localhost:5000 \
 *     --email admin@test.com --password admin123 [--dir docs/demo/analytics]
 */
import { readFileSync } from "node:fs";
import path from "node:path";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg("base", "http://localhost:5000").replace(/\/+$/, "");
const EMAIL = arg("email", "admin@test.com");
const PASSWORD = arg("password", "admin123");
const DIR = arg("dir", "docs/demo/analytics");

/** Вопрос, формулировка которого меняется между публикациями. */
const EDITED_PROMPT = "Какой пароль надёжнее всего?";
const EDITED_TO = "Какой из этих паролей надёжнее всего?";

let cookie = "";

async function call<T>(method: string, url: string, body?: unknown, form?: FormData): Promise<T> {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(form ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie?.startsWith("connect.sid=")) cookie = setCookie.split(";")[0];
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : null) as T;
}

function upload(name: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(path.join(DIR, name))]), name);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return form;
}

async function importPackage(name: string): Promise<string> {
  const { token } = await call<{ token: string }>("POST", "/api/tests/transfer/inspect", undefined, upload(name));
  const report = await call<{ testId: string; renamedTopics: string[] }>("POST", "/api/tests/transfer/apply", { token });
  console.log(`  пакет ${name} -> тест ${report.testId}`);
  if (report.renamedTopics.length) console.warn(`  ! темы переименованы: ${report.renamedTopics.join("; ")}`);
  return report.testId;
}

async function publish(testId: string): Promise<void> {
  await call("PATCH", `/api/tests/${testId}/status`, { status: "published" });
}

async function importLms(name: string, group: string): Promise<void> {
  const result = await call<{ rowsCreated: number; rowsUpdated: number; warnings: string[] }>(
    "POST",
    "/api/analytics/lms-import",
    undefined,
    upload(name, { newGroupName: group }),
  );
  console.log(`  выгрузка ${name}: создано ${result.rowsCreated}, обновлено ${result.rowsUpdated}`);
  for (const warning of result.warnings) console.warn(`  ! ${warning}`);
}

async function main(): Promise<void> {
  await call("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  console.log(`Стенд: ${BASE}, вход: ${EMAIL}`);

  const knowledge = await importPackage("demo-ib-test.tbtest");
  const survey = await importPackage("demo-style-survey.tbtest");
  await publish(knowledge);
  await publish(survey);

  await importLms("demo-ib-lms-wave1.xlsx", "Демо · Волна 1");
  await importLms("demo-style-lms.xlsx", "Демо · Опрос");

  await call("POST", `/api/tests/${knowledge}/attempts/start`, {});
  const questions = await call<Array<{ id: string; prompt: string }>>("GET", "/api/questions");
  const edited = questions.find(q => q.prompt === EDITED_PROMPT);
  if (edited) await call("PUT", `/api/questions/${edited.id}`, { prompt: EDITED_TO });
  await publish(knowledge);

  await importLms("demo-ib-lms-wave2.xlsx", "Демо · Волна 2");
  console.log(`Готово: ${BASE}/author/tests/${knowledge}/analytics и ${BASE}/author/tests/${survey}/analytics`);
}

main().catch((error: unknown) => {
  console.error("Сбой:", (error as Error).message);
  process.exit(1);
});
