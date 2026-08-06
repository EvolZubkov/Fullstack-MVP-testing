/**
 * @module features/questions/__tests__/question-editor-paste
 * @description Pasting from a document into the question editor.
 *
 * Authors write questions in Word and paste them in. The clipboard carries HTML;
 * the field stores plain text with a markdown subset, so the paste is converted
 * on the way in — otherwise the author would either see tags in the field or lose
 * his bold and links.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Topic } from "@shared/schema";

vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: vi.fn(), dialogProps: { open: false } }),
}));

import { QuestionEditorDrawer } from "../question-editor-drawer";

const topics = [{ id: "t1", name: "Тема A" }] as unknown as Topic[];

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuestionEditorDrawer
        open
        question={null}
        topics={topics}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/** Fire a paste carrying a `text/html` flavour, as a document editor does. */
function pasteHtml(field: HTMLElement, html: string) {
  fireEvent.paste(field, {
    clipboardData: { getData: (type: string) => (type === "text/html" ? html : "") },
  });
}

describe("QuestionEditorDrawer — paste", () => {
  it("converts pasted markup in the prompt into the markdown subset", () => {
    renderDrawer();
    const prompt = screen.getByTestId("input-question-prompt");

    pasteHtml(prompt, "<p>Что такое <b>замыкание</b>?</p>");

    expect((prompt as HTMLTextAreaElement).value).toBe("Что такое **замыкание**?");
  });

  it("converts pasted markup in an answer option", () => {
    renderDrawer();
    const option = screen.getByTestId("input-option-0");

    pasteHtml(option, "<b>Верный</b> вариант");

    expect((option as HTMLInputElement).value).toBe("**Верный** вариант");
  });

  it("stays out of the way when the clipboard carries no markup", () => {
    renderDrawer();
    const prompt = screen.getByTestId("input-question-prompt") as HTMLTextAreaElement;

    pasteHtml(prompt, "");

    // The default paste is left to the browser, so the field is untouched here.
    expect(prompt.value).toBe("");
  });

  it("tells the author which markup the field understands", () => {
    renderDrawer();
    expect(screen.getByText(/жирный/)).toBeInTheDocument();
  });
});
