// @vitest-environment jsdom
/**
 * @module client/pages/learner/__tests__/result.coverage.test
 *
 * Behavioural coverage for the learner result page ({@link module:client/pages/learner/result}).
 * The page is a thin react-query view that renders the results screen ONLY from the
 * shared design template (PRD-12): a render payload → the templated surface + a
 * back-nav footer; anything without a payload (loading / error / missing result /
 * missing render) → a degraded minimal message. The suite mocks `useQuery` with a
 * controlled result, mocks `wouter` to observe navigation, and replaces the heavy
 * `TemplateScreen` host with a light double that exposes the context + the `restart`
 * action, so every render branch is driven deterministically without the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { navigateSpy, queryState } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  queryState: { value: {} as { isLoading?: boolean; error?: unknown; data?: unknown } },
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
    </div>
  ),
}));

import ResultPage from "../result";

const renderPayload = (over: Record<string, unknown> = {}) => ({
  layout: '<div data-slot="x"></div>',
  css: ":root{--background: 0 0% 8%;--foreground: 0 0% 96%;}",
  context: { course: { title: "Тест" } },
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

// ─── templated result surface ─────────────────────────────────────────────────

describe("<ResultPage /> templated surface", () => {
  it("renders the results template with the server context and attempts footer", () => {
    queryState.value = { isLoading: false, error: null, data: fullAttempt() };
    render(<ResultPage />);
    expect(screen.getByTestId("template-screen")).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("ts-context").textContent || "{}").course.title).toBe("Тест");
    expect(screen.getByText(/Использовано попыток: 1 \/ 3/)).toBeInTheDocument();
  });

  it("restarts the test on the «restart» action when a retake is allowed", () => {
    queryState.value = { isLoading: false, error: null, data: fullAttempt({ canRetake: true }) };
    render(<ResultPage />);
    fireEvent.click(screen.getByTestId("ts-restart"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner/test/test-1");
  });

  it("ignores «restart» when no retake is allowed and shows the exhausted note", () => {
    queryState.value = {
      isLoading: false,
      error: null,
      data: fullAttempt({ canRetake: false, attemptsInfo: { completed: 3, max: 3 } }),
    };
    render(<ResultPage />);
    fireEvent.click(screen.getByTestId("ts-restart"));
    fireEvent.click(screen.getByTestId("ts-noop")); // unrelated action → no-op
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/попытки закончились/)).toBeInTheDocument();
  });

  it("falls back to CSS-var colors when the render payload has no explicit theme", () => {
    queryState.value = {
      isLoading: false,
      error: null,
      data: fullAttempt({
        render: renderPayload({ theme: undefined, css: ":root{--background:#123456;--foreground:#abcdef;}" }),
        attemptsInfo: null,
      }),
    };
    render(<ResultPage />);
    // The surface color is parsed from the stylesheet's --background var (no theme).
    const surface = document.querySelector(".tbh-minh-full") as HTMLElement;
    expect(surface.style.background).toBe("rgb(18, 52, 86)");
    // No attemptsInfo → the attempts note is omitted.
    expect(screen.queryByText(/Использовано попыток/)).toBeNull();
  });
});
