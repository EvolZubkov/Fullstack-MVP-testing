/**
 * @module tests/sim-host-parity/web-smoke
 * @description Self-check of the web host of the parity harness: `TakeTestPage` over the real
 * attempts router on pglite starts the fixture's attempt and reaches the router hub.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHarness, type Harness } from "../it/db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null, testId: "" }));
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
  useLocation: () => [`/learner/test/${h.testId}`, () => undefined],
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
const player = vi.hoisted(() => ({ double: null as any }));
vi.mock("@shared/sim/player", () => ({
  mountPlayer: (host: unknown, options: unknown) => player.double.mount(host, options),
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { seedBank, createRouterTest, T_A, LEARNER_ID } from "./fixture";
// eslint-disable-next-line import/first
import { WebHost, makeServer } from "./web-host";
// eslint-disable-next-line import/first
import { PlayerDouble } from "./player-double";
// eslint-disable-next-line import/first
import { playRun } from "../helpers/sim-runs";
// eslint-disable-next-line import/first
import attemptsRouter from "../../server/routes/attempts";
// eslint-disable-next-line import/first
import TakeTestPage from "@/pages/learner/take-test";

beforeAll(async () => {
  h.current = await createHarness();
  await seedBank(h.current);
}, 60000);
afterAll(async () => {
  await h.current?.close();
});

describe("обвязка веба", () => {
  it("страница прохождения на настоящих маршрутах доходит до хаба", async () => {
    const { testId, keySc1 } = await createRouterTest(h.current!);
    h.testId = testId;
    player.double = new PlayerDouble();
    const web = new WebHost(makeServer(attemptsRouter as never, LEARNER_ID), TakeTestPage as never);
    const hubCard = (key: string) =>
      new RegExp(`data-topic-id="${key}"[^>]*>`).exec(String(web.screen?.props.bodyHtml ?? ""))?.[0] ?? "";
    await web.open();
    expect(web.screen?.kind).toBe("start");

    await web.act(() => web.screen!.props.onAction("start-test"));
    // The hub: the scenario waits for topic A to be passed, «Завершить» waits for the required items.
    expect(web.screen?.kind).toBe("content");
    expect(hubCard(keySc1)).toContain('data-router-locked="true"');
    expect(web.screen!.props.nextDisabled).toBe(true);

    await web.act(() => web.screen!.props.onBodyAction(`router-select:${T_A}`));
    expect(await web.answer("qa1", 0)).toBe(true);
    expect(await web.answer("qa2", 0)).toBe(true);
    // The section outcome comes from the REAL `/section-result`, not from the test.
    expect(web.screen?.kind).toBe("section-results");
    expect(web.screen!.props.context.sectionResult).toMatchObject({ correct: 2, total: 2, scorePercent: 100 });
    await web.act(() => web.screen!.props.onAction("section-continue"));
    expect(hubCard(T_A)).toContain('data-router-status="completed"');
    expect(hubCard(keySc1)).not.toContain("data-router-locked");

    await web.act(() => web.screen!.props.onBodyAction(`router-select:${keySc1}`));
    expect(player.double.active).toBe(true);
    const r = playRun("success");
    await web.act(() => player.double.finish(r));
    await web.act(() => player.double.close(r));
    expect(player.double.active).toBe(false);
    expect(hubCard(keySc1)).toContain('data-router-status="completed"');
    expect(web.requests.some((q) => q.includes("/section-result"))).toBe(true);
    web.close();
    await web.idle();
  }, 120000);
});
