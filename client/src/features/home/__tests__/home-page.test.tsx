/**
 * @module features/home/__tests__/home-page
 *
 * PRD-25: the home page renders exactly the sections the payload carries, and
 * nothing else. The learner case is the important one — an author section
 * leaking into a learner's page is the failure this suite exists to catch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HomePayload } from "@shared/home/contract";

const { useHomeMock } = vi.hoisted(() => ({ useHomeMock: vi.fn() }));
vi.mock("../use-home", () => ({ useHome: useHomeMock }));

import { HomePage } from "../home-page";

function withPayload(data: HomePayload) {
  useHomeMock.mockReturnValue({ data, isLoading: false });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HomePage", () => {
  it("renders only learner sections for a learner payload", () => {
    withPayload({ assigned: { items: [], total: 0 }, recentResults: { items: [] } });

    render(<HomePage />);

    expect(screen.getByTestId("home-assigned")).toBeInTheDocument();
    expect(screen.getByTestId("home-results")).toBeInTheDocument();
    expect(screen.queryByTestId("home-my-tests")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-my-topics")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-materials")).not.toBeInTheDocument();
  });

  it("renders a failed section as a retry state without dropping its neighbours", () => {
    withPayload({ myTests: { failed: true }, myTopics: { items: [], total: 0 } });

    render(<HomePage />);

    expect(screen.getByTestId("home-section-error-myTests")).toBeInTheDocument();
    expect(screen.getByTestId("home-my-topics")).toBeInTheDocument();
  });

  it("shows the no-access state when the payload carries no sections at all", () => {
    withPayload({});

    render(<HomePage />);

    expect(screen.getByTestId("home-no-sections")).toBeInTheDocument();
  });

  it("drops the attention panel when there is nothing to act on", () => {
    withPayload({ assigned: { items: [], total: 0 }, attention: [] });

    render(<HomePage />);

    expect(screen.queryByTestId("home-attention")).not.toBeInTheDocument();
  });

  it("renders the aside sections when the profile has them", () => {
    withPayload({
      myTests: { items: [], total: 0 },
      quickActions: [{ id: "test-create", label: "Создать тест", href: "/author/tests" }],
      summary: { attempts30d: 0, passRate: 0, avgPercent: 0, activeUsers: 0 },
    });

    render(<HomePage />);

    expect(screen.getByTestId("home-quick-actions")).toBeInTheDocument();
    expect(screen.getByTestId("home-summary")).toBeInTheDocument();
  });

  it("shows a loading state until the payload arrives", () => {
    useHomeMock.mockReturnValue({ data: undefined, isLoading: true });

    render(<HomePage />);

    expect(screen.queryByTestId("home-no-sections")).not.toBeInTheDocument();
  });
});
