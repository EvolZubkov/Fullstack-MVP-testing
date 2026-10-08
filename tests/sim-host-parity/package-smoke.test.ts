/**
 * @module tests/sim-host-parity/package-smoke
 * @description Self-check of the package host of the parity harness: the fixture saved to pglite
 * builds into a real package that boots in jsdom, reaches the router hub, delivers in the authored
 * order, locks what it must, survives a reload inside a topic and finishes with an LMS result.
 *
 * It never compares the package with the web — that is `parity.test.ts`. It pins the harness
 * itself, so a red parity run can be read as «the hosts differ», not «the harness slipped».
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHarness, type Harness } from "../it/db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { seedBank, createRouterTest, T_A, T_B, SIM_Q1 } from "./fixture";
// eslint-disable-next-line import/first
import { buildPackage, PackageHost } from "./package-host";
// eslint-disable-next-line import/first
import { PlayerDouble } from "./player-double";
// eslint-disable-next-line import/first
import { playRun } from "../helpers/sim-runs";
// eslint-disable-next-line import/first
import { packageStep, packageDelivery, packageFinal, compactRun, hubCards, normalizeHtml } from "./snapshot";

beforeAll(async () => {
  h.current = await createHarness();
  await seedBank(h.current);
}, 60000);
afterAll(async () => {
  await h.current?.close();
});

/** A package host started on a fresh fixture test, past the start screen. */
async function started(suffix: string) {
  const { testId, keySc1, keySc2 } = await createRouterTest(h.current!, {}, suffix);
  const player = new PlayerDouble();
  const host = new PackageHost(await buildPackage(testId), {}, player);
  await host.open();
  await host.click("[data-action=start-test]");
  return { host, player, keySc1, keySc2 };
}

const card = (host: PackageHost, key: string) =>
  hubCards(packageStep(host, new PlayerDouble()).hub).find((c) => c.startsWith(`${key} `)) ?? "";

describe("обвязка пакета", () => {
  it("доходит до хаба; закрытая кнопка видна снимку как disabled, открытая нет", async () => {
    const { host, keySc1 } = await started("-hub");
    const step = packageStep(host, new PlayerDouble());
    expect(step.screen).toBe("hub");
    // The scenario waits for topic A: its button carries `disabled=""` in the DOM.
    expect(card(host, keySc1)).toMatch(/locked=true .*disabled=true/);
    expect(card(host, T_A)).toMatch(/disabled=false/);
    // The same markup written as the web writes it (bare `disabled`) is the same string.
    expect(normalizeHtml('<button disabled data-x="1">a</button>')).toBe(normalizeHtml('<button disabled="" data-x="1">a</button>'));
    expect(step.footer).toMatchObject({ finishLabel: "Завершить", finishEnabled: false });
    host.close();
  }, 120000);

  it("выдаёт вопросы темы в авторском порядке при questionOrder fixed", async () => {
    const { host } = await started("-order");
    expect(packageDelivery(host).map(([, q]) => q)).toEqual(["qa1", "qa2", expect.any(String), "qb1", "qb2", expect.any(String)]);
    host.close();
  }, 120000);

  it("перезагрузка внутри темы Б: ответ сохранён, прохождение доходит до итога L7", async () => {
    const { host, player, keySc1 } = await started("-reload");
    const pick = (key: string) => host.click(`[data-action="router-select:${key}"]`);

    // Topic A, all correct, then the scenario it unlocks.
    await pick(T_A);
    expect(await host.answer("qa1", 0)).toBe(true);
    expect(await host.answer("qa2", 0)).toBe(true);
    await host.click("[data-action=section-continue]");
    await pick(keySc1);
    const run = playRun("success");
    player.finish(run);
    await host.idle();
    player.close(run);
    await host.idle(300);
    const stored = host.state.answers?.[SIM_Q1];
    expect(compactRun(host, stored)).not.toBeNull();
    expect(card(host, keySc1)).toMatch(/status=completed/);

    // Topic B: one answer, then the SCO is reloaded.
    await pick(T_B);
    expect(await host.answer("qb1", 0)).toBe(true);
    await host.reload();
    expect(host.errors).toEqual([]);
    expect(Object.keys(host.state.answers)).toContain("qb1");
    // The package comes back on the question answered last (checkpoint is saved before the move);
    // `answer` steps over it to the open one.
    expect(await host.answer("qb2", 0)).toBe(true);
    expect(packageStep(host, player).screen).toBe("section-results");
    expect(packageStep(host, player).sectionResult).toMatchObject({ topicName: "Тема Б", correct: 2, total: 2 });
    await host.click("[data-action=section-continue]");
    const hub = packageStep(host, player);
    expect(hub.screen).toBe("hub");
    expect(hub.footer?.finishEnabled).toBe(true);

    expect(await host.finishTest()).toBe(true);
    // A 2 + scenario 1 + B 2 of 6; the optional scenario is not played.
    expect(packageFinal(host.cmi)).toEqual({
      percent: 83, // 5 of 6 points
      passed: true,
      items: [
        { key: T_A, earned: 2, possible: 2, passed: true },
        { key: keySc1, earned: 1, possible: 1, passed: true },
        { key: T_B, earned: 2, possible: 2, passed: true },
        { key: expect.stringMatching(/^scenario:/), earned: 0, possible: 1, passed: null },
      ],
    });
    expect(host.errors).toEqual([]);
    host.close();
  }, 180000);

  // PRODUCT DEFECT, not a harness slip: after a reload at the hub `restoreRouterSession` brings back
  // the section outcomes (`rt`, `sr`, `sp`) but `main.js` restores the ANSWERS only when a topic was
  // open (`crt`), so the finished topic's answers are gone and the final result recounts it from
  // nothing (topic A: 0 of 2, «failed», while the hub still says «Завершена»). `it.fails` keeps the
  // suite green and turns red the day the defect is fixed — then drop `.fails`.
  it.fails("перезагрузка в хабе после темы А не стирает её ответы в итоге попытки", async () => {
    const { host, player, keySc1 } = await started("-hubreload");
    const pick = (key: string) => host.click(`[data-action="router-select:${key}"]`);
    await pick(T_A);
    await host.answer("qa1", 0);
    await host.answer("qa2", 0);
    await host.click("[data-action=section-continue]");
    await host.reload();
    await pick(keySc1);
    const run = playRun("success");
    player.finish(run);
    await host.idle();
    player.close(run);
    await host.idle(300);
    await pick(T_B);
    await host.answer("qb1", 0);
    await host.answer("qb2", 0);
    await host.click("[data-action=section-continue]");
    expect(await host.finishTest()).toBe(true);
    expect(packageFinal(host.cmi).items[0]).toEqual({ key: T_A, earned: 2, possible: 2, passed: true });
    host.close();
  }, 180000);
});
