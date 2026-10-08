/**
 * @module tests/sim-host-parity/parity
 * @description «Сценарий в ИС», техдолг №4: один набор прохождений проигрывается на вебе и в
 * SCORM-пакете, и после КАЖДОГО шага их снимки обязаны совпасть (план
 * `docs/specs/sim-scenario/plan-tests.md`, раздел 4, пункт 5; проект обвязки — записка
 * `docs/handoff/HANDOFF-2026-10-08-sim-host-parity.md`, раздел 9).
 *
 * Оба хоста настоящие: веб — страница прохождения на настоящих маршрутах попытки, пакет — собранный
 * пакет целиком в jsdom; входы обоих собраны настоящими сборщиками из одной pglite. Подменён только
 * плеер сценария, и одинаково на обоих (`player-double.ts`).
 *
 * Расхождения копятся по всему прохождению и печатаются разом: первое расхождение часто тянет за
 * собой следующие, и полная картина отличает причину от следствия.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHarness, type Harness } from "../it/db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null, testId: "", web: null as { navigations: string[] } | null }));
const player = vi.hoisted(() => ({ double: null as any }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));
vi.mock("../../server/middleware/auth", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("wouter", () => ({
  useParams: () => ({ testId: h.testId }),
  useLocation: () => [`/learner/test/${h.testId}`, (to: string) => h.web?.navigations.push(String(to))],
}));
vi.mock("@skillum/ui-kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@skillum/ui-kit")>()),
  useToast: () => ({ push: () => undefined, dismiss: () => undefined, clear: () => undefined }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "learner-parity", magicScope: null } }) }));
vi.mock("@/features/learner/attempt-report", () => ({ downloadAttemptReport: async () => "report.pdf" }));
vi.mock("@/components/template-screen", async () => ({
  TemplateScreen: (await import("./web-host")).ScreenDoubles.TemplateScreen,
}));
vi.mock("@/pages/learner/template-content-screen", async () => ({
  TemplateContentScreen: (await import("./web-host")).ScreenDoubles.TemplateContentScreen,
}));
vi.mock("@/pages/learner/template-question-screen", async () => ({
  TemplateQuestionScreen: (await import("./web-host")).ScreenDoubles.TemplateQuestionScreen,
}));
vi.mock("@shared/sim/player", () => ({
  mountPlayer: (host: unknown, options: unknown) => player.double.mount(host, options),
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { seedBank, createRouterTest, LEARNER_ID, SIM_Q1 } from "./fixture";
// eslint-disable-next-line import/first
import { WebHost, makeServer } from "./web-host";
// eslint-disable-next-line import/first
import { buildPackage, PackageHost, sharedRuntimeBundle } from "./package-host";
// eslint-disable-next-line import/first
import { PlayerDouble } from "./player-double";
// eslint-disable-next-line import/first
import { playRun } from "../helpers/sim-runs";
// eslint-disable-next-line import/first
import {
  packageStep, webStep, packageDelivery, webDelivery, compactRun, packageFinal, webFinal, hubCards,
  type StepSnapshot,
} from "./snapshot";
// eslint-disable-next-line import/first
import { passages, keyOf, type Passage, type Step } from "./passages";
// eslint-disable-next-line import/first
import attemptsRouter from "../../server/routes/attempts";
// eslint-disable-next-line import/first
import { storage } from "../../server/storage";
// eslint-disable-next-line import/first
import TakeTestPage from "@/pages/learner/take-test";

beforeAll(async () => {
  h.current = await createHarness();
  await seedBank(h.current);
  sharedRuntimeBundle(); // once per file, in a child process
}, 120000);
afterAll(async () => {
  await h.current?.close();
});

/** One host driven through a passage. */
interface Driver {
  name: "web" | "package";
  player: PlayerDouble;
  do(step: Exclude<Step, { do: "check" }>): Promise<void>;
  snapshot(): StepSnapshot;
}

function packageDriver(host: PackageHost, player: PlayerDouble, key: (i: any) => string): Driver {
  return {
    name: "package",
    player,
    snapshot: () => packageStep(host, player),
    async do(step) {
      switch (step.do) {
        case "start":
          await host.click("[data-action=start-test]");
          return;
        case "pick":
          await host.click(`[data-action="router-select:${key(step.item)}"]`);
          return;
        case "next":
          await host.clickButton(/Далее/);
          return;
        case "answer":
          await host.answer(step.qid, step.correct ? 0 : 1);
          return;
        case "sectionContinue":
          await host.click("[data-action=section-continue]");
          return;
        case "sim": {
          const r = playRun(step.run);
          player.finish(r);
          await host.idle();
          player.close(r);
          await host.idle(300);
          return;
        }
        case "finish":
          await host.finishTest();
          return;
        case "reload":
          await host.reload();
          return;
        case "resume":
          await host.click("[data-action=resume]");
          return;
      }
    },
  };
}

function webDriver(web: WebHost, player: PlayerDouble, key: (i: any) => string): Driver {
  const props = () => web.screen?.props ?? {};
  return {
    name: "web",
    player,
    snapshot: () => webStep(web, player),
    async do(step) {
      switch (step.do) {
        case "start":
          await web.act(() => props().onAction?.("start-test"));
          return;
        case "pick":
          await web.act(() => props().onBodyAction?.(`router-select:${key(step.item)}`));
          return;
        case "next":
          await web.act(() => props().onNext?.());
          return;
        case "answer":
          await web.answer(step.qid, step.correct ? 0 : 1);
          return;
        case "sectionContinue":
          await web.act(() => props().onAction?.("section-continue"));
          return;
        case "sim": {
          const r = playRun(step.run);
          await web.act(() => player.finish(r));
          await web.act(() => player.close(r));
          return;
        }
        case "finish":
          await web.act(() => props().onNext?.());
          return;
        case "reload":
          await web.reload();
          return;
        case "resume":
          if (web.screen?.kind === "start") await web.act(() => props().onAction?.("resume"));
          return;
      }
    },
  };
}

const label = (step: Step) =>
  step.do === "pick" ? `pick ${step.item}` : step.do === "answer" ? `answer ${step.qid} ${step.correct ? "верно" : "неверно"}` : step.do === "sim" ? `sim ${step.run}` : step.do;

/** Differences of two step snapshots, level by level, in a readable form. */
function diffStep(web: StepSnapshot, pkg: StepSnapshot): string[] {
  const out: string[] = [];
  if (web.screen !== pkg.screen || web.question !== pkg.question) {
    out.push(`L1 экран: веб ${web.screen}${web.question ? ` ${web.question}` : ""}, пакет ${pkg.screen}${pkg.question ? ` ${pkg.question}` : ""}`);
  }
  if (web.hub !== pkg.hub && (web.hub === null || pkg.hub === null)) {
    out.push(`L2 хаб есть только у ${web.hub === null ? "пакета" : "веба"}`);
  } else if (web.hub !== pkg.hub) {
    const w = hubCards(web.hub);
    const p = hubCards(pkg.hub);
    const cards = w.map((c, i) => (c === p[i] ? null : `    веб   ${c}\n    пакет ${p[i] ?? "-"}`)).filter(Boolean);
    out.push(`L2 хаб различается${cards.length ? ":\n" + cards.join("\n") : " (карточки совпали, разница в разметке)"}`);
  }
  if (JSON.stringify(web.footer) !== JSON.stringify(pkg.footer)) {
    out.push(`L3 подвал хаба: веб ${JSON.stringify(web.footer)}, пакет ${JSON.stringify(pkg.footer)}`);
  }
  if (JSON.stringify(web.sectionResult) !== JSON.stringify(pkg.sectionResult)) {
    out.push(`L4 итоги раздела: веб ${JSON.stringify(web.sectionResult)}, пакет ${JSON.stringify(pkg.sectionResult)}`);
  }
  return out;
}

async function play(p: Passage, index: number): Promise<{ diffs: string[]; anchors: string[] }> {
  const { testId, keySc1, keySc2 } = await createRouterTest(h.current!, p.options, `-${index}`);
  h.testId = testId;
  const key = (item: "A" | "B" | "SC1" | "SC2") => keyOf(item, keySc1, keySc2);

  const pkgPlayer = new PlayerDouble();
  const pkgHost = new PackageHost(await buildPackage(testId), {}, pkgPlayer);
  await pkgHost.open();
  const pkg = packageDriver(pkgHost, pkgPlayer, key);

  const webPlayer = new PlayerDouble();
  player.double = webPlayer;
  const webHost = new WebHost(makeServer(attemptsRouter as never, LEARNER_ID), TakeTestPage as never);
  h.web = webHost;
  await webHost.open();
  const web = webDriver(webHost, webPlayer, key);

  const diffs: string[] = [];
  const anchors: string[] = [];
  const attemptId = () => {
    const m = webHost.requests.map((r) => /\/api\/attempts\/([\w-]+)\//.exec(r)?.[1]).find(Boolean);
    return m ?? null;
  };

  try {
    let n = 0;
    for (const step of p.steps) {
      n += 1;
      const at = `шаг ${n} (${label(step)})`;
      if (step.do === "check") {
        if (!step.test(pkg.snapshot())) anchors.push(`${at}: не выполнено «${step.what}»`);
        continue;
      }
      const mountsBefore = [pkgPlayer.mounts.length, webPlayer.mounts.length];
      await pkg.do(step);
      await web.do(step);
      for (const d of diffStep(web.snapshot(), pkg.snapshot())) diffs.push(`${at}: ${d}`);

      if (step.do === "start") {
        const variant = (await storage.getAttempt(attemptId()!))?.variantJson as never;
        const wd = JSON.stringify(variant ? webDelivery(variant) : null);
        const pd = JSON.stringify(packageDelivery(pkgHost));
        if (wd !== pd) diffs.push(`${at}: L0 выдача: веб ${wd}, пакет ${pd}`);
      }
      if (step.do === "pick" && (step.item === "SC1" || step.item === "SC2")) {
        const wm = JSON.stringify(webPlayer.mounts.slice(mountsBefore[1]));
        const pm = JSON.stringify(pkgPlayer.mounts.slice(mountsBefore[0]));
        if (wm !== pm) diffs.push(`${at}: L5 запуск плеера: веб ${wm}, пакет ${pm}`);
      }
      if (step.do === "sim") {
        const stored = (await storage.getAttempt(attemptId()!))?.answersJson as Record<string, unknown> | null;
        const wa = JSON.stringify(compactRun(pkgHost, stored?.[SIM_Q1] ?? null));
        const pa = JSON.stringify(compactRun(pkgHost, pkgHost.state.answers?.[SIM_Q1] ?? null));
        if (wa !== pa) diffs.push(`${at}: L6 ответ на сценарий: веб ${wa}, пакет ${pa}`);
      }
      if (step.do === "finish") {
        const result = (await storage.getAttempt(attemptId()!))?.resultJson;
        const wf = JSON.stringify(result ? webFinal(result) : null);
        const pf = JSON.stringify(packageFinal(pkgHost.cmi));
        if (wf !== pf) diffs.push(`${at}: L7 итог: веб ${wf}, пакет ${pf}`);
      }
    }
    if (pkgHost.errors.length) diffs.push(`ошибки пакета: ${pkgHost.errors.join(" | ")}`);
  } finally {
    webHost.close();
    pkgHost.close();
    await webHost.idle();
  }
  return { diffs, anchors };
}

describe("«Сценарий в ИС»: паритет веба и пакета на одном наборе прохождений", () => {
  passages().forEach((p, i) => {
    it(p.name, async () => {
      const { diffs, anchors } = await play(p, i);
      expect({ anchors, diffs }).toEqual({ anchors: [], diffs: [] });
    }, 180000);
  });
});
