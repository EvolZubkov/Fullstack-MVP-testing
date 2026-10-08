/**
 * @module tests/scorm-router-hub-reload
 * @description Пакет с роутером, перезагруженный В ХАБЕ, сохраняет то, что участник уже сделал:
 * ответы завершённой темы, состав выдачи и заморозку раздела.
 *
 * Ветка `restore_router` в `bootstrap/main.js` возвращала из `suspend_data` только состояние хаба
 * (`rt`/`sr`) и тянула НОВУЮ выдачу (`generateVariant`). Сохранённые ряды попытки — выдача (`dl`),
 * ответы (`an`), статусы (`st`), порядок вариантов (`sh`), заморозка разделов (`sc`) —
 * возвращались только при перезагрузке ВНУТРИ пункта. Перезагрузка в хабе теряла ответы
 * завершённых тем: в LMS уходил заниженный балл, а при случайном отборе менялся и состав тем, в
 * которые участник ещё не входил.
 *
 * Исполняется настоящий пакет: `generateScormPackage` собирает его из данных в памяти, `app.js`
 * идёт целиком в окне jsdom, LMS — объект `cmi` за `API_1484_11`, перезагрузка — новое окно с тем
 * же `cmi`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { generateScormPackage } from "../server/scorm-exporter";

// The manifest builder records a code per test id in this tracked file — leave no trace.
const IDENT = path.resolve(process.cwd(), "uploads", "scorm", "identifiers.json");
let identSnapshot: Buffer | null = null;
beforeAll(() => {
  identSnapshot = fs.existsSync(IDENT) ? fs.readFileSync(IDENT) : null;
});
afterAll(() => {
  if (identSnapshot === null) {
    if (fs.existsSync(IDENT)) fs.rmSync(IDENT);
  } else {
    fs.writeFileSync(IDENT, identSnapshot);
  }
});

const TEST_ID = "router-hub-reload";
const TOPIC_A = "topic-a";
const TOPIC_B = "topic-b";

function question(id: string, topicId: string) {
  return {
    id, topicId, type: "single", prompt: `Вопрос ${id}`,
    dataJson: { options: ["верно", "неверно"] }, correctJson: { correctIndex: 0 },
    points: 1, difficulty: 50, mediaUrl: null, mediaType: null, shuffleAnswers: false,
    feedback: null, feedbackMode: "general", feedbackCorrect: null,
    feedbackIncorrect: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

/**
 * Router test of two topics. Topic B draws 2 of 4 questions: a fresh draw after the reload would
 * almost surely deliver another pair, which is what tells a restored delivery from a new one.
 */
function fixture() {
  const topic = (id: string, name: string) => ({ id, name, description: "", feedback: null, createdAt: new Date(), updatedAt: new Date() });
  return {
    test: {
      id: TEST_ID, title: "Перезагрузка в хабе", description: "", mode: "standard",
      showDifficultyLevel: false, overallPassRuleJson: { type: "percent", value: 50 }, webhookUrl: null,
      feedback: null, timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false,
      startPageContent: null, published: true, status: "published", folderId: null,
      designSettingsJson: { templateId: "default", params: {} },
      flowPolicyJson: { mode: "router_by_topics" },
      createdAt: new Date(), updatedAt: new Date(),
    },
    sections: [
      {
        id: "s-a", testId: TEST_ID, topicId: TOPIC_A, drawCount: 2, sortOrder: 0, required: true,
        topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null, topic: topic(TOPIC_A, "Тема А"),
        questions: [question("qa1", TOPIC_A), question("qa2", TOPIC_A)], courses: [], events: [],
      },
      {
        id: "s-b", testId: TEST_ID, topicId: TOPIC_B, drawCount: 2, sortOrder: 1, required: true,
        topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null, topic: topic(TOPIC_B, "Тема Б"),
        questions: ["qb1", "qb2", "qb3", "qb4"].map((id) => question(id, TOPIC_B)), courses: [], events: [],
      },
    ],
    adaptiveSettings: null,
    contentPages: [
      {
        id: "cp-router", testId: TEST_ID, topicId: null, position: "before", mode: "template", type: "info",
        kind: "router", templateKey: "router.menu", sortOrder: 0,
        valuesJson: { values: { title: "Разделы" }, placeholderStyles: {} },
        autoAdvance: false, autoAdvanceDelayMs: null, createdAt: new Date(), updatedAt: new Date(),
      },
    ],
    designSettings: { templateId: "default", params: {} },
    telemetry: null,
  };
}

/**
 * The shared `TBTemplate` bundle. Under vitest `getSharedRuntimeBundle` returns `""` (esbuild fails
 * in the jsdom environment), so the SAME builder runs in a child process.
 */
function sharedRuntimeBundle(): string {
  const cli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  return execFileSync(
    process.execPath,
    [cli, "-e", "import('./server/scorm/builders/shared-runtime.ts').then(async (m) => process.stdout.write(await m.buildSharedRuntimeBundle()))"],
    { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, VITEST: "", NODE_ENV: "development" } },
  );
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Opens one SCO session over `cmi`; a second call with the same `cmi` is a reload. */
async function openSco(zip: JSZip, bundle: string, cmi: Record<string, string>, errors: string[]) {
  const html = await zip.file("index.html")!.async("string");
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  const dom = new JSDOM(html.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g, ""), {
    runScripts: "dangerously", url: "http://localhost/index.html", pretendToBeVisual: true,
  });
  const w = dom.window as any;
  w.API_1484_11 = {
    Initialize: () => "true", Terminate: () => "true", Commit: () => "true",
    GetValue: (k: string) => cmi[k] ?? "",
    SetValue: (k: string, v: string) => { cmi[k] = String(v); return "true"; },
    GetLastError: () => "0", GetErrorString: () => "", GetDiagnostic: () => "",
  };
  w.fetch = async (u: string) => {
    const f = zip.file(String(u).replace("http://localhost/", "").replace(/^\.\//, ""));
    if (!f) return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
    const t = await f.async("string");
    return { ok: true, status: 200, text: async () => t, json: async () => JSON.parse(t) };
  };
  w.console.log = () => undefined;
  w.addEventListener("error", (e: any) => errors.push(String(e.message)));
  for (const src of scripts) {
    if (src.startsWith("vendor/")) continue; // PDF export libraries
    const el = w.document.createElement("script");
    // In the real package the shared bundle is the FIRST part of app.js.
    // `window.eval` would not do: strict mode keeps `var TBTemplate` inside the eval scope.
    el.textContent = (src === "app.js" ? bundle + "\n;\n" : "") + (await zip.file(src)!.async("string"));
    w.document.body.appendChild(el);
  }
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  w.dispatchEvent(new w.Event("load"));
  await settle(1200);
  return w;
}

async function click(w: any, selector: string): Promise<boolean> {
  const el = [...w.document.querySelectorAll(selector)].find((x: any) => !x.disabled) as HTMLElement | undefined;
  if (!el) return false;
  el.click();
  await settle(150);
  return true;
}

const delivered = (w: any) => (w.state.flatQuestions as Array<{ question: { id: string } }>).map((fq) => fq.question.id);

describe("пакет с роутером: перезагрузка в хабе", () => {
  it("ответы завершённой темы, выдача и заморозка раздела переживают перезагрузку", async () => {
    const zip = await JSZip.loadAsync(await generateScormPackage(fixture() as never));
    const bundle = sharedRuntimeBundle();
    const cmi: Record<string, string> = {};
    const errors: string[] = [];

    const w = await openSco(zip, bundle, cmi, errors);
    expect(await click(w, "[data-action=start-test]")).toBe(true);
    expect(w.document.querySelector(".router-hub")).not.toBeNull();

    // Topic A through to the hub: both questions answered right.
    expect(await click(w, `[data-action="router-select:${TOPIC_A}"]`)).toBe(true);
    for (let k = 0; k < 8 && !w.document.querySelector(".router-hub"); k++) {
      if (String(w.state.phase) === "question") {
        await click(w, "[data-action='select:0']");
        await click(w, "[data-action=answer-submit]");
        await click(w, "[data-action=answer-next]");
      } else if (!(await click(w, "[data-action=section-continue]"))) {
        break;
      }
    }
    expect(w.document.querySelector(".router-hub")).not.toBeNull();
    expect(w.state.routerTopicStates[TOPIC_A]).toBe("completed");

    const before = {
      answers: { ...w.state.answers },
      delivered: delivered(w),
      committed: !!(w.state.sectionCommitted || {})[TOPIC_A],
    };
    expect(before.answers).toEqual({ qa1: 0, qa2: 0 });
    expect(before.committed).toBe(true);
    w.close();

    // The learner reloads the SCO while standing on the hub.
    const w2 = await openSco(zip, bundle, cmi, errors);
    expect(w2.document.querySelector(".router-hub")).not.toBeNull();
    expect(w2.state.routerTopicStates[TOPIC_A]).toBe("completed");
    expect(w2.state.answers).toEqual(before.answers);
    expect(delivered(w2)).toEqual(before.delivered);
    expect(!!(w2.state.sectionCommitted || {})[TOPIC_A]).toBe(true);
    w2.close();

    expect(errors).toEqual([]);
  }, 120000);
});
