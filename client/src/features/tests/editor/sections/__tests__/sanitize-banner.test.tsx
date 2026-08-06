/**
 * @module features/tests/editor/sections/__tests__/sanitize-banner.test
 * @description The post-save diagnostics banner of a content page. Removals and
 * CSS scoping are different outcomes and must read differently: markup the server
 * DELETED as unsafe, versus author CSS it CONFINED to the page block.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SanitizeBanner } from "../sanitize-banner";

const fieldLabel = (key: string) => (key === "body" ? "Текст" : key);

describe("SanitizeBanner", () => {
  it("renders nothing when there is no diagnostic", () => {
    const { container } = render(<SanitizeBanner diagnostics={{}} fieldLabel={fieldLabel} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists removed markup as unsafe", () => {
    render(
      <SanitizeBanner
        diagnostics={{ body: [{ kind: "tag", label: "<script>", count: 2 }] }}
        fieldLabel={fieldLabel}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/удалены как небезопасные/)).toBeInTheDocument();
    expect(screen.getByText("<script>")).toBeInTheDocument();
    expect(screen.getByText(/×2/)).toBeInTheDocument();
    expect(screen.getByText(/Текст/)).toBeInTheDocument();
  });

  it("reports scoped CSS separately, not as a removal", () => {
    render(
      <SanitizeBanner
        diagnostics={{ body: [{ kind: "style", label: "<style>", count: 3 }] }}
        fieldLabel={fieldLabel}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByText(/удалены как небезопасные/)).not.toBeInTheDocument();
    expect(screen.getByText(/ограничен(ы)? блоком страницы/)).toBeInTheDocument();
    expect(screen.getByText(/правил: 3/)).toBeInTheDocument();
  });

  it("shows both sections when a value was cleaned and scoped", () => {
    render(
      <SanitizeBanner
        diagnostics={{
          body: [
            { kind: "tag", label: "<script>", count: 1 },
            { kind: "style", label: "<style>", count: 1 },
          ],
        }}
        fieldLabel={fieldLabel}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/удалены как небезопасные/)).toBeInTheDocument();
    expect(screen.getByText(/ограничен(ы)? блоком страницы/)).toBeInTheDocument();
  });

  it("dismisses on the close button", () => {
    const onDismiss = vi.fn();
    render(
      <SanitizeBanner
        diagnostics={{ body: [{ kind: "style", label: "<style>", count: 1 }] }}
        fieldLabel={fieldLabel}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Скрыть предупреждение/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
