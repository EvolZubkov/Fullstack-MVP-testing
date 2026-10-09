/**
 * @module tests/sim-host-parity/parity-1
 * @description «Сценарий в ИС», техдолг №4: первая половина набора прохождений, проигрываемого на вебе и в
 * SCORM-пакете; после КАЖДОГО шага их снимки обязаны совпасть (план
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
import { vi } from "vitest";
import type { Harness } from "../it/db-harness";

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
import { registerParity } from "./parity-core";

registerParity({ h, player }, (i) => i < 7);
