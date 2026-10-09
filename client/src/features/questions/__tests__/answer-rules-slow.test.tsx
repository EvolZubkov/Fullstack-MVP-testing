// @vitest-environment jsdom
/**
 * @module features/questions/__tests__/answer-rules-slow.test
 *
 * PRD-57 FR-28o — FR-28p1: долгое выражение. Замер подменяется, потому что настоящий
 * занял бы секунды — те самые, о которых он и сообщает.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const measureMock = vi.hoisted(() => vi.fn());
vi.mock("../answer-rules/measure-expression", () => ({
  measureExpression: measureMock,
}));

import { AnswerRulesBlock } from "../answer-rules/answer-rules-block";
import { createDraft, toCorrectJson, type AnswerRulesDraft } from "../answer-rules/answer-rules-model";
import type { AnswerRuleSet } from "@shared/answer-check";

function Harness({ initial, onSave }: { initial: AnswerRuleSet; onSave?: (s: AnswerRuleSet) => void }) {
  const [draft, setDraft] = useState<AnswerRulesDraft>(() => createDraft(initial));
  return (
    <AnswerRulesBlock
      draft={draft}
      onChange={(next) => {
        setDraft(next);
        onSave?.(toCorrectJson(next));
      }}
      onMaxLength={() => {}}
    />
  );
}

const slowSet = (value: string): AnswerRuleSet => ({
  answerKind: "text",
  join: "any",
  rules: [{ kind: "text", match: "regex", value }],
});

beforeEach(() => {
  vi.clearAllMocks();
  measureMock.mockResolvedValue({ worstMs: 27000, killed: false });
});

describe("долгое выражение в ящике", () => {
  it("замер печатается под полем и поднимает предупреждение", async () => {
    render(<Harness initial={slowSet(String.raw`^(\S+\s?)+ надзору$`)} />);
    await waitFor(() => expect(screen.getByTestId("answer-rules-measure-0")).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId("answer-rules-measure-0").textContent).toContain("27 с");
    expect(screen.getByTestId("answer-rules-slow-0")).toBeTruthy();
    cleanup();
  });

  it("замену не предлагает там, где точной замены нет", async () => {
    render(<Harness initial={slowSet(String.raw`^([А-Яа-я]+|\S+)+ надзору$`)} />);
    await waitFor(() => expect(screen.getByTestId("answer-rules-slow-0")).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId("answer-rules-slow-0").textContent).toContain("Замену подобрать не удалось");
    cleanup();
  });

  it("предлагает замену, когда перевод точен, и правило сохраняется в любом случае", async () => {
    const saved: AnswerRuleSet[] = [];
    render(<Harness initial={slowSet(String.raw`^Федеральная служба по .* надзору$`)} onSave={(s) => saved.push(s)} />);
    await waitFor(() => expect(screen.getByTestId("answer-rules-slow-0")).toBeTruthy(), { timeout: 3000 });
    const banner = screen.getByTestId("answer-rules-slow-0");
    expect(banner.textContent).toContain("Федеральная служба по * надзору");
    // FR-28p1: правило при этом уже несёт признак «долгое» — он и защищает пакет.
    await waitFor(() => expect((saved.at(-1)?.rules[0] as { slow?: boolean })?.slow).toBe(true));
    cleanup();
  });
});
