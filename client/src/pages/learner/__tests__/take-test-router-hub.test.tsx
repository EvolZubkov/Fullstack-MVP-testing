/**
 * @module pages/learner/__tests__/take-test-router-hub.test
 * @description PRD-4 v1.1 §4.7 — the WEB router hub is built from the same facts as
 * the package's.
 *
 * The hub's rules live in `shared/flow/router-hub` precisely so that a section open in
 * the LMS is open here; what broke that parity was not the rules but their INPUT — the
 * web host used to hand the shared builder an empty `unlockRules`, a `null`
 * `completionPolicy` and sections with no obligation, because the attempt payload
 * carried none of it. These tests stand on that seam: they assert the markup the
 * shared builder produced, which is only ever as good as what the host fed it.
 *
 * `TemplateContentScreen` is replaced by a double that exposes `bodyHtml` and
 * `nextDisabled` — the real one mounts a Shadow DOM renderer, and the hub's facts are
 * fully visible in those two props.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { navigateSpy, toastSpy, authState } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  toastSpy: vi.fn(),
  authState: { user: { id: "u1", magicScope: null } as Record<string, unknown> | null },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ testId: "test-1" }),
  useLocation: () => ["/learner/test/test-1", navigateSpy],
}));
vi.mock("@skillum/ui-kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@skillum/ui-kit")>()),
  useToast: () => ({ push: toastSpy, dismiss: vi.fn(), clear: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => authState }));
vi.mock("@/features/learner/attempt-report", () => ({
  downloadAttemptReport: vi.fn(async () => "report.pdf"),
}));

vi.mock("@/components/template-screen", () => ({
  TemplateScreen: (props: any) => (
    <div data-testid="template-screen">
      <button data-testid="ts-start-test" onClick={() => props.onAction && props.onAction("start-test")}>
        start
      </button>
      <button data-testid="ts-resume" onClick={() => props.onAction && props.onAction("resume")}>
        resume
      </button>
    </div>
  ),
}));

vi.mock("../template-content-screen", () => ({
  TemplateContentScreen: (props: any) => (
    <div data-testid="content-screen">
      <div data-testid="cs-body" dangerouslySetInnerHTML={{ __html: props.bodyHtml ?? "" }} />
      <div data-testid="cs-next-disabled">{String(!!props.nextDisabled)}</div>
      <div data-testid="cs-next-label">{props.nextLabel ?? ""}</div>
    </div>
  ),
}));

import TakeTestPage from "../take-test";

const TPL = () => ({
  layout: '<div data-slot="page-content"></div>',
  css: "",
  theme: { background: "#fff", foreground: "#111" },
  cssVars: {},
  design: {},
});

const jsonRes = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const routerPage = {
  id: "page-hub",
  kind: "router",
  type: "router",
  topicId: null,
  position: "before",
  sortOrder: 0,
  mode: null,
  templateKey: "router.standard",
  valuesJson: {},
  settingsJson: null,
  autoAdvance: false,
  autoAdvanceDelayMs: null,
};

const question = (id: string, topicId: string, topicName: string) => ({
  id,
  type: "single",
  prompt: id,
  topicId,
  topicName,
  dataJson: { options: ["A", "B"] },
  correctJson: { correctIndex: 0 },
  shuffleAnswers: false,
  feedback: null,
  mediaUrl: null,
  mediaType: null,
});

const learnerTest = {
  id: "test-1",
  title: "Сертификация",
  description: "",
  mode: "standard",
  sections: [{ drawCount: 1 }, { drawCount: 1 }],
  overallPassRuleJson: { type: "percent", value: 60 },
  inProgressAttemptId: null,
  completedAttempts: 0,
  maxAttempts: 3,
  timeLimitMinutes: null,
  startPageContent: "",
  resumeIndex: null,
  resumeTotal: null,
  lastCompletedAttemptId: null,
  retakeGate: null,
  priorResult: null,
};

/**
 * A router attempt as the server now delivers it. `over` patches exactly the two
 * things under test — the gating and the sections' obligation.
 */
const routerAttempt = (over: Record<string, unknown> = {}) => ({
  id: "attempt-1",
  testTitle: "Сертификация",
  showCorrectAnswers: false,
  allowReturnToUnanswered: false,
  allowAnswerChange: false,
  showSectionResults: true,
  answerCommitScope: "section",
  timeLimitMinutes: null,
  flowMode: "router_by_topics",
  contentPages: [routerPage],
  routerPolicy: { completionPolicy: "all_required_completed", sectionUnlockRules: {} },
  variantJson: {
    sections: [
      { topicId: "t1", topicName: "О компании", timeLimitMinutes: null, questionIds: ["q1"], required: true },
      { topicId: "t2", topicName: "Финансы", timeLimitMinutes: null, questionIds: ["q2"], required: true },
    ],
  },
  questions: [question("q1", "t1", "О компании"), question("q2", "t2", "Финансы")],
  ...over,
});

function installFetch(attempt: Record<string, unknown>) {
  const fn = vi.fn(async (url: string) => {
    const u = String(url);
    if (u === "/api/learner/tests") return jsonRes([learnerTest]);
    if (u.includes("/screen-template/")) return jsonRes(TPL());
    if (u.includes("/attempts/start")) return jsonRes(attempt);
    if (u.includes("/resume")) return jsonRes({ hasInProgress: false });
    return jsonRes({});
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Renders the page, starts the attempt and waits for the hub to appear. */
async function openHub(attempt: Record<string, unknown>) {
  installFetch(attempt);
  render(<TakeTestPage />);
  const start = await screen.findByTestId("ts-start-test");
  fireEvent.click(start);
  await waitFor(() => expect(screen.getByTestId("content-screen")).toBeTruthy());
  return screen.getByTestId("cs-body");
}

beforeEach(() => {
  navigateSpy.mockClear();
  toastSpy.mockClear();
  localStorage.clear();
  authState.user = { id: "u1", magicScope: null };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web router hub — unlock rules", () => {
  it("locks a section behind its prerequisite, exactly as the package does", async () => {
    const body = await openHub(
      routerAttempt({
        routerPolicy: {
          completionPolicy: "all_required_completed",
          sectionUnlockRules: { t2: { mode: "after_sections_completed", sectionIds: ["t1"] } },
        },
      }),
    );

    const cards = body.querySelectorAll("[data-topic-id]");
    expect(cards.length).toBe(2);
    const t2 = body.querySelector('[data-topic-id="t2"]')!;
    expect(t2.className).toContain("router-topic-card--locked");
    expect(t2.getAttribute("data-router-locked")).toBe("true");
    // A locked card carries no action: the learner cannot open it here either.
    expect(t2.getAttribute("data-action")).toBeNull();
    expect(t2.textContent).toContain("Недоступна");
    // The section with no rule stays open.
    expect(body.querySelector('[data-topic-id="t1"]')!.getAttribute("data-action")).toBe(
      "router-select:t1",
    );
  });

  it("leaves every section open when the author set no rules", async () => {
    const body = await openHub(routerAttempt());
    expect(body.querySelector(".router-topic-card--locked")).toBeNull();
    expect(body.querySelector('[data-topic-id="t2"]')!.getAttribute("data-action")).toBe(
      "router-select:t2",
    );
  });
});

describe("web router hub — section obligation", () => {
  it("counts only required sections in the progress bar", async () => {
    const attempt = routerAttempt();
    (attempt.variantJson as any).sections[1].required = false;
    const body = await openHub(attempt);

    expect(body.textContent).toContain("0 / 1");
    expect(body.textContent).toContain("(необязательная)");
  });

  it("offers «Завершить» at once when no section is obligatory", async () => {
    const attempt = routerAttempt();
    (attempt.variantJson as any).sections.forEach((s: any) => (s.required = false));
    await openHub(attempt);

    expect(screen.getByTestId("cs-next-label").textContent).toBe("Завершить");
    expect(screen.getByTestId("cs-next-disabled").textContent).toBe("false");
  });

  it("withholds «Завершить» while an obligatory section is unfinished", async () => {
    await openHub(routerAttempt());
    expect(screen.getByTestId("cs-next-disabled").textContent).toBe("true");
  });
});

describe("web router hub — возобновление прогона", () => {
  /** Прерванная попытка: тема t1 завершена, участник стоял в хабе либо внутри t2. */
  async function resume(routerState: Record<string, unknown>, currentIndex: number) {
    const fn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u === "/api/learner/tests") return jsonRes([{ ...learnerTest, inProgressAttemptId: "attempt-1" }]);
      if (u.includes("/screen-template/")) return jsonRes(TPL());
      if (u.includes("/resume")) {
        return jsonRes({
          hasInProgress: true,
          attempt: routerAttempt(),
          savedAnswers: { q1: 0 },
          currentIndex,
          questionStatus: { q1: "answered" },
          sectionPositions: {},
          routerState,
        });
      }
      return jsonRes({});
    });
    vi.stubGlobal("fetch", fn);
    render(<TakeTestPage />);
    fireEvent.click(await screen.findByTestId("ts-resume"));
  }

  it("прогон, прерванный в хабе, возобновляется в хабе, а не на вопросе завершённой темы", async () => {
    await resume({ topicStates: { t1: "completed" }, committed: { t1: true }, current: null }, 0);
    await waitFor(() => expect(screen.getByTestId("content-screen")).toBeTruthy());
    const body = screen.getByTestId("cs-body");
    expect(body.querySelector('[data-topic-id="t1"]')!.getAttribute("data-router-status")).toBe("completed");
    expect(body.textContent).toContain("1 / 2");
  });

  it("прогон, прерванный внутри пункта, возобновляется на его вопросе", async () => {
    await resume({ topicStates: { t1: "completed", t2: "inProgress" }, committed: { t1: true }, current: "t2" }, 1);
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: "Продолжаем с вопроса 2" })),
    );
    expect(screen.queryByTestId("content-screen")).toBeNull();
  });

  it("прогон сценария, оборванный перезагрузкой, не продолжается: участник в хабе, пункт не начат", async () => {
    // Решение владельца 2026-10-08 (паритет хостов, N1): прогон нельзя продолжить, только начать
    // заново — и запускает его участник сам, карточкой, на весь экран.
    await resume({ topicStates: { t1: "completed", "scenario:s1": "inProgress" }, committed: { t1: true }, current: "scenario:s1" }, 1);
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: "Продолжаем с выбора раздела" })),
    );
    expect(screen.getByTestId("content-screen")).toBeTruthy();
    expect(screen.getByTestId("cs-body").textContent).toContain("1 / 2");
  });
});
