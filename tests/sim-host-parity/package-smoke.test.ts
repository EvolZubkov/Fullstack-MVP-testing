/**
 * @module tests/sim-host-parity/package-smoke
 * @description Self-check of the package host of the parity harness: the fixture saved to pglite
 * builds into a real package that boots in jsdom and reaches the router hub.
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
import { seedBank, createRouterTest, T_A } from "./fixture";
// eslint-disable-next-line import/first
import { buildPackage, PackageHost } from "./package-host";
// eslint-disable-next-line import/first
import { PlayerDouble } from "./player-double";
// eslint-disable-next-line import/first
import { playRun } from "../helpers/sim-runs";

beforeAll(async () => {
  h.current = await createHarness();
  await seedBank(h.current);
}, 60000);
afterAll(async () => {
  await h.current?.close();
});

describe("обвязка пакета", () => {
  it("пакет фикстуры поднимается и доходит до хаба", async () => {
    const { testId, keySc1 } = await createRouterTest(h.current!);
    const zip = await buildPackage(testId);
    const player = new PlayerDouble();
    const host = new PackageHost(zip, {}, player);
    await host.open();
    const log: string[] = [];
    const btns = () =>
      [...host.doc.querySelectorAll("#app button")]
        .map((b: any) => (b.disabled ? "[x]" : "") + (b.getAttribute("data-action") || "") + "|" + (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30))
        .join(" ; ");
    log.push("0 " + host.state.phase + " " + btns());
    await host.click("[data-action=start-test]");
    for (let k = 0; k < 4 && !host.doc.querySelector(".router-hub"); k++) {
      log.push("s " + host.state.phase + " " + btns());
      if (!(await host.clickButton(/Далее/))) break;
    }
    log.push("hub " + btns());
    await host.click(`[data-action="router-select:${T_A}"]`);
    for (let k = 0; k < 10 && !host.doc.querySelector(".router-hub"); k++) {
      log.push("q " + host.state.phase + " " + host.state.currentIndex + " " + btns());
      await host.click("[data-action='select:0']");
      if (!(await host.click("[data-action=answer-submit]")) && !(await host.click("[data-action=answer-next]")) && !(await host.click("[data-action=section-continue]")) && !(await host.clickButton(/Далее|Продолжить/))) break;
    }
    log.push("hub2 " + btns());
    await host.click(`[data-action="router-select:${keySc1}"]`);
    log.push("sim " + host.state.phase + " active=" + player.active + " " + JSON.stringify(player.mounts));
    if (player.active) {
      const r = playRun("success");
      player.finish(r);
      player.close(r);
      await host.idle(300);
    }
    log.push("hub3 " + btns());
    log.push("errors " + host.errors.join(" | "));
    log.push("answers " + JSON.stringify(host.state.answers));
    // eslint-disable-next-line no-console
    require("node:fs").writeFileSync("tests/sim-host-parity/smoke.log", log.join("\n"));
    expect(host.errors).toEqual([]);
    host.close();
  }, 120000);
});
