/**
 * @module pages/__tests__/not-found.test
 * @description Smoke test for the 404 page: renders the DS card with the
 * not-found heading and helper copy.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound from "../not-found";

describe("<NotFound />", () => {
  it("renders the 404 heading and hint", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: /404 Page Not Found/ })).toBeInTheDocument();
    expect(screen.getByText(/Did you forget to add the page to the router\?/)).toBeInTheDocument();
  });
});
