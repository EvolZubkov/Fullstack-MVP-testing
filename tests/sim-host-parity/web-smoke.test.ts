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
    const log: string[] = [];
    const desc = () => {
      const s = web.screen;
      if (!s) return "none";
      if (s.kind === "content") return `content next=${s.props.nextLabel ?? ""}/${!!s.props.nextDisabled} back=${!!s.props.onBack} body=${String(s.props.bodyHtml ?? "").length}`;
      if (s.kind === "question") return `question ${s.props.question?.id} nav=${JSON.stringify(s.props.nav)?.slice(0, 200)}`;
      return s.kind;
    };
    await web.open();
    log.push("0 " + desc());
    await web.act(() => web.screen!.props.onAction("start-test"));
    log.push("1 " + desc());
    await web.act(() => web.screen!.props.onBodyAction(`router-select:${T_A}`));
    for (let k = 0; k < 10; k++) {
      log.push("q " + desc());
      const s = web.screen!;
      if (s.kind === "question") {
        await web.act(() => s.props.onAnswer(0));
        await web.act(() => web.screen!.props.onNavAction("answer-submit"));
        log.push("q+ " + desc());
        await web.act(() => web.screen!.props.onNavAction("answer-next"));
      } else if (s.kind === "section-results") {
        await web.act(() => s.props.onAction("section-continue"));
      } else if (s.kind === "content" && s.props.bodyHtml) break;
      else if (s.kind === "content") await web.act(() => s.props.onNext());
      else break;
    }
    log.push("hub " + desc());
    log.push("hubhtml " + web.screen?.props.bodyHtml);
    await web.act(() => web.screen!.props.onBodyAction(`router-select:${keySc1}`));
    log.push("sim active=" + player.double.active + " " + JSON.stringify(player.double.mounts));
    if (player.double.active) {
      const r = playRun("success");
      await web.act(() => player.double.finish(r));
      await web.act(() => player.double.close(r));
    }
    log.push("hub3 " + desc());
    log.push("requests " + web.requests.join("\n"));
    require("node:fs").writeFileSync("tests/sim-host-parity/web-smoke.log", log.join("\n"));
    expect(web.screen?.kind).toBe("content");
    web.close();
  }, 120000);
});
