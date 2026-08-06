// @vitest-environment jsdom
/**
 * @module client/pages/learner/__tests__/result.coverage.test
 *
 * Behavioural coverage for the learner result page ({@link module:client/pages/learner/result}).
 * The page is a thin react-query view that renders the results screen ONLY from the
 * shared design template (PRD-12): a render payload → the templated surface, whose
 * own footer carries the navigation (`result.showBack` is the host's only addition to
 * the server context — the page renders NO chrome of its own); anything without a
 * payload (loading / error / missing result / missing render) → a degraded minimal
 * message. The suite mocks `useQuery` with a controlled result, mocks `wouter` to
 * observe navigation, and replaces the heavy `TemplateScreen` host with a light double
 * that exposes the context + the footer actions, so every render branch is driven
 * deterministically without the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { navigateSpy, queryState, authState } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  queryState: { value: {} as { isLoading?: boolean; error?: unknown; data?: unknown } },
  // Plain (non-restricted) session by default; individual tests opt into a
  // magic-link session by setting `magicScope`.
  authState: { user: { id: "u1", magicScope: null } as Record<string, unknown> | null },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ attemptId: "att-1" }),
  useLocation: () => ["/learner/result/att-1", navigateSpy],
  Link: ({ href, children, className }: any) => (
    <a href={href} className={className} data-testid="link">
      {children}
    </a>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryState.value,
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => authState }));

vi.mock("@/components/template-screen", () => ({
  TemplateScreen: (props: any) => (
    <div data-testid="template-screen">
      <pre data-testid="ts-context">{JSON.stringify(props.context)}</pre>
      <pre data-testid="ts-css">{props.css}</pre>
      <button data-testid="ts-restart" onClick={() => props.onAction && props.onAction("restart")}>
        restart
      </button>
      <button data-testid="ts-noop" onClick={() => props.onAction && props.onAction("noop")}>
        noop
      </button>
      <button data-testid="ts-back" onClick={() => props.onAction && props.onAction("results-back")}>
        back
      </button>
      <button data-testid="ts-finish" onClick={() => props.onAction && props.onAction("results-finish")}>
        finish
      </button>
    </div>
  ),
}));

import ResultPage from "../result";

const renderPayload = (over: Record<string, unknown> = {}) => ({
  layout: '<div data-slot="x"></div>',
  css: ":root{--background: 0 0% 8%;--foreground: 0 0% 96%;}",
  context: { course: { title: "Тест" }, result: { scorePercent: 80, nav: { primaryAction: "results-finish" } } },
  theme: { background: "#101010", foreground: "#f0f0f0" },
  cssVars: {},
  ...over,
});

const fullAttempt = (over: Record<string, unknown> = {}) => ({
  id: "att-1",
  testId: "test-1",
  testTitle: "Тест",
  result: { scorePercent: 80, passed: true },
  canRetake: true,
  attemptsInfo: { completed: 1, max: 3 },
  render: renderPayload(),
  ...over,
});

beforeEach(() => {
  navigateSpy.mockClear();
  queryState.value = {};
  authState.user = { id: "u1", magicScope: null };
});
afterEach(() => vi.clearAllMocks());

// ─── degraded / loading states ────────────────────────────────────────────────

describe("<ResultPage /> degraded states", () => {
  it("shows the loading state while the query is pending", () => {
    queryState.value = { isLoading: true };
    render(<ResultPage />);
    expect(screen.getByText("Загрузка результатов...")).toBeInTheDocument();
  });

  it("shows «результаты не найдены» + returns to the list on a fetch error", () => {
    queryState.value = { isLoading: false, error: new Error("boom"), data: undefined };
    render(<ResultPage />);
    expect(screen.getByText("Результаты не найдены")).toBeInTheDocument();
    expect(screen.getByText("Не удалось найти результаты для этой попытки.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("К списку тестов"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner");
  });

  it("shows the «потеряны» description when the attempt has no render payload", () => {
    queryState.value = { isLoading: false, error: null, data: fullAttempt({ render: null }) };
    render(<ResultPage />);
    expect(
      screen.getByText("Результаты этой попытки ещё не сформированы или были потеряны."),
    ).toBeInTheDocument();
  });
});

// ─── magic-link (restricted) session — degraded states ────────────────────────

describe("<ResultPage /> degraded states under a magic-link session", () => {
  // A magic-link session has no test list — "/learner" would just bounce it to
  // /login (ProtectedRoute's scope guard) — so the fallback button must point at
  // the learner's own test when the id is known (the attempt loaded, just its
  // render/result payload is missing).
  it("points the fallback button at the learner's own test when the id is known", () => {
    authState.user = { id: "u1", magicScope: { testId: "test-1" } };
    queryState.value = { isLoading: false, error: null, data: fullAttempt({ render: null }) };
    render(<ResultPage />);
    fireEvent.click(screen.getByText("К списку тестов"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner/test/test-1");
  });

  // When even the attempt itself failed to load, the test id is unknown — there
  // is nowhere valid to send the learner, so the button is omitted rather than
  // pointed at the out-of-scope list.
  it("omits the fallback button when the test id is unknown (fetch error)", () => {
    authState.user = { id: "u1", magicScope: { testId: "test-1" } };
    queryState.value = { isLoading: false, error: new Error("boom"), data: undefined };
    render(<ResultPage />);
    expect(screen.queryByText("К списку тестов")).toBeNull();
  });
});

// ─── templated result surface ─────────────────────────────────────────────────

describe("<ResultPage /> templated surface", () => {
  it("passes the server context through, without a back button on the standard layout", () => {
    queryState.value = { isLoading: false, error: null, data: fullAttempt() };
    render(<ResultPage />);
    expect(screen.getByTestId("template-screen")).toBeInTheDocument();
    const ctx = JSON.parse(screen.getByTestId("ts-context").textContent || "{}");
    expect(ctx.course.title).toBe("Тест");
    // The standard footer already ends with the closing action («К списку тестов»),
    // so the extra ghost button stays off.
    expect(ctx.result.showBack).toBe(false);
    // Server-built result fields survive the merge.
    expect(ctx.result.scorePercent).toBe(80);
  });

  it("turns the back button on for the adaptive layout, whose footer has no exit", () => {
    queryState.value = {
      isLoading: false,
      error: null,
      data: fullAttempt({
        render: renderPayload({ context: { course: { title: "Тест" }, result: { adaptive: true } } }),
      }),
    };
    render(<ResultPage />);
    const ctx = JSON.parse(screen.getByTestId("ts-context").textContent || "{}");
    // The layout's own footer draws «← К списку тестов» from this flag; the package
    // never sets it, so a SCORM run shows no back action.
    expect(ctx.result.showBack).toBe(true);
  });

  it("renders NO host chrome around the scene (one footer, the template's)", () => {
    queryState.value = { isLoading: false, error: null, data: fullAttempt() };
    const { container } = render(<ResultPage />);
    expect(container.querySelector(".tbh-result-foot")).toBeNull();
    expect(container.querySelector(".tbh-link")).toBeNull();
    // The wrapper fills what the app shell left over, instead of growing with content.
    expect(container.querySelector(".tbh-inset-screen")).not.toBeNull();
  });

  it("returns to the list on «К списку тестов» and on the closing action", () => {
    queryState.value = { isLoading: false, error: null, data: fullAttempt() };
    render(<ResultPage />);
    fireEvent.click(screen.getByTestId("ts-back"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner");
    navigateSpy.mockClear();
    fireEvent.click(screen.getByTestId("ts-finish"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner");
  });

  // A magic-link session has no test list — "back"/"finish" must resolve to the
  // learner's own test instead of "/learner" (which would bounce it to /login).
  it("sends «back»/«finish» to the learner's own test in a restricted session", () => {
    authState.user = { id: "u1", magicScope: { testId: "test-1" } };
    queryState.value = { isLoading: false, error: null, data: fullAttempt() };
    render(<ResultPage />);
    fireEvent.click(screen.getByTestId("ts-back"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner/test/test-1");
    navigateSpy.mockClear();
    fireEvent.click(screen.getByTestId("ts-finish"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner/test/test-1");
  });

  it("restarts the test on the «restart» action when a retake is allowed", () => {
    queryState.value = { isLoading: false, error: null, data: fullAttempt({ canRetake: true }) };
    render(<ResultPage />);
    fireEvent.click(screen.getByTestId("ts-restart"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner/test/test-1");
  });

  it("ignores «restart» when no retake is allowed", () => {
    queryState.value = {
      isLoading: false,
      error: null,
      data: fullAttempt({ canRetake: false, attemptsInfo: { completed: 3, max: 3 } }),
    };
    render(<ResultPage />);
    fireEvent.click(screen.getByTestId("ts-restart"));
    fireEvent.click(screen.getByTestId("ts-noop")); // unrelated action → no-op
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("paints no surface colour of its own — the scene owns its background", () => {
    queryState.value = {
      isLoading: false,
      error: null,
      data: fullAttempt({
        render: renderPayload({ theme: undefined, css: ":root{--background:#123456;--foreground:#abcdef;}" }),
        attemptsInfo: null,
      }),
    };
    const { container } = render(<ResultPage />);
    // The host wrapper used to guess a colour out of the stylesheet (always the base
    // palette), which showed as a light band under a dark scene.
    const wrap = container.querySelector(".tbh-inset-screen") as HTMLElement;
    expect(wrap.style.background).toBe("");
  });
});
