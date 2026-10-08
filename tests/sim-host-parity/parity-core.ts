/**
 * @module tests/sim-host-parity/parity-core
 * @description «Сценарий в ИС», техдолг №4: ядро теста паритета — драйверы двух хостов, сравнение
 * снимков и проигрывание прохождения (записка `docs/handoff/HANDOFF-2026-10-08-sim-host-parity.md`,
 * разделы 9.6 – 9.8, раскладка по файлам — 9.11).
 *
 * Оба хоста настоящие: веб — страница прохождения на настоящих маршрутах попытки, пакет — собранный
 * пакет целиком в jsdom; входы обоих собраны настоящими сборщиками из одной pglite. Подменён только
 * плеер сценария, и одинаково на обоих (`player-double.ts`).
 *
 * Расхождения копятся по всему прохождению и печатаются разом: первое расхождение часто тянет за
 * собой следующие, и полная картина отличает причину от следствия.
 *
 * Модуль не мокает ничего сам: `vi.mock` поднимается выше импортов и обязан стоять в файле теста
 * (`parity-1.test.ts`, `parity-2.test.ts`), который затем зовёт {@link registerParity}.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Harness } from "../it/db-harness";
import { createHarness } from "../it/db-harness";
import { seedBank, createRouterTest, LEARNER_ID, SIM_Q1 } from "./fixture";
import { WebHost, makeServer } from "./web-host";
import { buildPackage, PackageHost, sharedRuntimeBundle } from "./package-host";
import { PlayerDouble } from "./player-double";
import { playRun } from "../helpers/sim-runs";
import {
  packageStep, webStep, packageDelivery, webDelivery, compactRun, packageFinal, webFinal, hubCards,
  type StepSnapshot,
} from "./snapshot";
import { passages, keyOf, type Passage, type Step } from "./passages";
import attemptsRouter from "../../server/routes/attempts";
import { storage } from "../../server/storage";
import TakeTestPage from "@/pages/learner/take-test";


/** State shared with the `vi.mock` factories of the test file. */
export interface ParityShared {
  h: { current: Harness | null; testId: string; web: { navigations: string[] } | null };
  player: { double: any };
}

let h!: ParityShared["h"];
let player!: ParityShared["player"];

/** One host driven through a passage. */
interface Driver {
  name: "web" | "package";
  player: PlayerDouble;
  do(step: Exclude<Step, { do: "check" | "checkFinal" }>): Promise<void>;
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
        case "finishReview":
          await host.click("[data-action=finish-review]");
          return;
        case "sectionContinue":
          await host.click("[data-action=section-continue]");
          return;
        case "sim": {
          if (!player.active) return; // the host did not launch the player: reported as L5 by `play`
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
          player.reset(); // the window with the mounted player is gone
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
        case "finishReview":
          await web.act(() => props().onAction?.("finish-review"));
          return;
        case "sectionContinue":
          await web.act(() => props().onAction?.("section-continue"));
          return;
        case "sim": {
          if (!player.active) return; // the host did not launch the player: reported as L5 by `play`
          const r = playRun(step.run);
          await web.act(() => player.finish(r));
          await web.act(() => player.close(r));
          return;
        }
        case "finish":
          await web.act(() => props().onNext?.());
          return;
        case "reload":
          player.reset();
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
      if (step.do === "checkFinal") {
        if (!step.test(packageFinal(pkgHost.cmi))) anchors.push(`${at}: не выполнено «${step.what}»`);
        continue;
      }
      const mountsBefore = [pkgPlayer.mounts.length, webPlayer.mounts.length];
      const prevActive = [pkgPlayer.active, webPlayer.active];
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
      if (step.do === "sim" && prevActive[0] !== prevActive[1]) {
        diffs.push(`${at}: L5 плеер запущен только на ${prevActive[1] ? "вебе" : "пакете"}`);
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

/**
 * Registers the passages chosen by `select` as tests of the calling file.
 *
 * @param shared - state the file's `vi.mock` factories read
 * @param select - which passages (by index in {@link passages}) this file plays
 */
export function registerParity(shared: ParityShared, select: (index: number) => boolean): void {
  h = shared.h;
  player = shared.player;
  beforeAll(async () => {
    h.current = await createHarness();
    await seedBank(h.current);
    sharedRuntimeBundle(); // once per file, in a child process
  }, 120000);
  afterAll(async () => {
    await h.current?.close();
  });

  describe("«Сценарий в ИС»: паритет веба и пакета на одном наборе прохождений", () => {
    passages().forEach((p, i) => {
      if (!select(i)) return;
      it(p.name, async () => {
        const { diffs, anchors } = await play(p, i);
        expect({ anchors, diffs }).toEqual({ anchors: [], diffs: [] });
      }, 180000);
    });
  });
}
