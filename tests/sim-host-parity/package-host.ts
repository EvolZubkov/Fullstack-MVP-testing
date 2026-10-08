/**
 * @module tests/sim-host-parity/package-host
 * @description «Сценарий в ИС», техдолг №4: SCORM-пакет как хост паритета — собранный ЦЕЛИКОМ и
 * исполненный в jsdom (записка `docs/handoff/HANDOFF-2026-10-08-sim-host-parity.md`, 9.3).
 *
 * Пакет собирается настоящими `buildScormExportData` и `generateScormPackage` из той же базы, что
 * читает веб. Его `app.js` исполняется в окне jsdom, LMS — объект `cmi` за `API_1484_11`;
 * перезагрузка — новое окно с тем же `cmi`. По модулям пакет не разбирается: навигацию внутри
 * пункта ведут `contentFlow.js` и `mainRender.js`, и заглушка `render` заставила бы тест изображать
 * её сам.
 *
 * Плеер сценария подменён общим двойником ({@link PlayerDouble}) — тем же, что у веба: результат
 * прогона приходит из теста, а что хост с ним делает — проверяется.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { buildScormExportData } from "../../server/scorm/build-export-data";
import { generateScormPackage } from "../../server/scorm-exporter";
import type { PlayerDouble } from "./player-double";

let bundleCache: string | null = null;

/**
 * The shared `TBTemplate` bundle. Under vitest `getSharedRuntimeBundle` returns `""` and esbuild
 * fails in the jsdom environment, so the SAME builder runs in a child process.
 */
export function sharedRuntimeBundle(): string {
  if (bundleCache !== null) return bundleCache;
  const cli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  bundleCache = execFileSync(
    process.execPath,
    [
      cli,
      "-e",
      "import('./server/scorm/builders/shared-runtime.ts')" +
        ".then(async (m) => process.stdout.write(await m.buildSharedRuntimeBundle()))",
    ],
    { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, VITEST: "", NODE_ENV: "development" } },
  );
  return bundleCache;
}

const IDENT = path.resolve(process.cwd(), "uploads", "scorm", "identifiers.json");

/** Builds the package of `testId` from live state — the debug player's source (PRD-18). */
export async function buildPackage(testId: string): Promise<JSZip> {
  // The manifest builder records a code per test in this tracked file; leave no trace.
  const before = fs.existsSync(IDENT) ? fs.readFileSync(IDENT) : null;
  try {
    const data = await buildScormExportData(testId, { source: "debug" } as never);
    return await JSZip.loadAsync(await generateScormPackage(data as never));
  } finally {
    if (before === null) {
      if (fs.existsSync(IDENT)) fs.rmSync(IDENT);
    } else {
      fs.writeFileSync(IDENT, before);
    }
  }
}

const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** One SCO session: a window over the package with the LMS data model in `cmi`. */
export class PackageHost {
  window!: any;
  readonly errors: string[] = [];
  /** Contexts the package handed to the shared renderer, newest last (L4 reads them). */
  readonly rendered: any[] = [];

  constructor(
    private readonly zip: JSZip,
    readonly cmi: Record<string, string>,
    private readonly player: PlayerDouble,
  ) {}

  /** Opens the SCO: a fresh window over the same LMS data (a reload when `cmi` is not empty). */
  async open(): Promise<void> {
    const html = await this.zip.file("index.html")!.async("string");
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    const dom = new JSDOM(html.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g, ""), {
      runScripts: "dangerously",
      url: "http://localhost/index.html",
      pretendToBeVisual: true,
    });
    const w = dom.window as any;
    const cmi = this.cmi;
    w.API_1484_11 = {
      Initialize: () => "true",
      Terminate: () => "true",
      Commit: () => "true",
      GetValue: (k: string) => cmi[k] ?? "",
      SetValue: (k: string, v: string) => {
        cmi[k] = String(v);
        return "true";
      },
      GetLastError: () => "0",
      GetErrorString: () => "",
      GetDiagnostic: () => "",
    };
    const zip = this.zip;
    w.fetch = async (u: string) => {
      const name = String(u).replace("http://localhost/", "").replace(/^\.\//, "");
      const f = zip.file(name);
      if (!f) return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
      const t = await f.async("string");
      return { ok: true, status: 200, text: async () => t, json: async () => JSON.parse(t) };
    };
    w.console.log = () => undefined;
    w.console.info = () => undefined;
    w.console.debug = () => undefined;
    w.addEventListener("error", (e: any) => this.errors.push(String(e.message)));
    // The real player needs a stage the jsdom window cannot lay out; the double stands in.
    w.document.documentElement.requestFullscreen = () => Promise.resolve();
    for (const src of scripts) {
      if (src.startsWith("vendor/")) continue; // PDF export libraries
      const el = w.document.createElement("script");
      // In the real package the shared bundle is the FIRST part of app.js (joinJsParts).
      el.textContent = (src === "app.js" ? sharedRuntimeBundle() + "\n;\n" : "") + (await this.zip.file(src)!.async("string"));
      w.document.body.appendChild(el);
      if (src === "app.js") {
        // Bundle exports are getters; re-pointing the global name is what `simulation.js` reads.
        const orig = w.TBTemplate;
        const rendered = this.rendered;
        w.TBTemplate = Object.create(orig, {
          mountPlayer: { value: this.player.mount },
          renderScreenInto: {
            value: (root: unknown, input: { context?: unknown }) => {
              rendered.push(input?.context ?? null);
              return orig.renderScreenInto(root, input);
            },
          },
        });
      }
    }
    this.window = w;
    w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
    w.dispatchEvent(new w.Event("load"));
    await this.idle(1200);
  }

  /** Reload: the browser drops the window; the LMS keeps `cmi`. */
  async reload(): Promise<void> {
    this.window?.close();
    await this.open();
  }

  close(): void {
    this.window?.close();
  }

  /** Lets timers, template fetches and renders run out. */
  async idle(ms = 150): Promise<void> {
    await settle(ms);
  }

  get doc(): Document {
    return this.window.document;
  }

  get state(): any {
    return this.window.state;
  }

  /** Clicks the first enabled element matching `selector`; returns whether one was found. */
  async click(selector: string): Promise<boolean> {
    const el = [...this.doc.querySelectorAll(selector)].find((x: any) => !x.disabled) as HTMLElement | undefined;
    if (!el) return false;
    el.click();
    await this.idle();
    return true;
  }

  /** Id of the question on screen, `null` outside a question. */
  get questionId(): string | null {
    if (String(this.state.phase) !== "question") return null;
    return this.state.flatQuestions?.[this.state.currentIndex]?.question?.id ?? null;
  }

  /**
   * Answers question `qid` with option `index` the way a participant does: pick, «Отправить ответ»,
   * «Далее». The package restores to the question that was answered LAST (its checkpoint is saved
   * before the move, `advanceAfterCommit`), where the answer is locked and only «Далее» is live; a
   * participant presses it to reach the next question, so does this method — up to a few steps, and
   * only over questions already answered. Returns whether `qid` was reached and answered.
   */
  async answer(qid: string, index: number): Promise<boolean> {
    for (let k = 0; k < 6 && this.questionId !== qid; k++) {
      if (this.questionId === null || !(await this.click("[data-action=answer-next]"))) return false;
    }
    if (this.questionId !== qid) return false;
    await this.click(`[data-action='select:${index}']`);
    if (!(await this.click("[data-action=answer-submit]"))) return false;
    await this.click("[data-action=answer-next]");
    return true;
  }

  /**
   * Finishes the test the way a participant does, in TWO presses: «Завершить» on the hub opens the
   * results screen, and only «Завершить» (`results-finish`) there reports to the LMS
   * (`finishAndClose`). Waits for the score to land in `cmi`. Returns whether it did.
   */
  async finishTest(): Promise<boolean> {
    if (!(await this.clickButton(/Завершить/))) return false;
    if (!(await this.click("[data-action=results-finish]"))) return false;
    const t0 = Date.now();
    while (!this.cmi["cmi.score.raw"] && Date.now() - t0 < 6000) await this.idle(100);
    return !!this.cmi["cmi.score.raw"];
  }

  /** The enabled footer/nav button whose text matches. */
  async clickButton(text: RegExp): Promise<boolean> {
    const el = [...this.doc.querySelectorAll("#app button")].find(
      (x: any) => !x.disabled && !x.closest(".router-hub") && text.test(x.textContent || ""),
    ) as HTMLElement | undefined;
    if (!el) return false;
    el.click();
    await this.idle();
    return true;
  }
}
