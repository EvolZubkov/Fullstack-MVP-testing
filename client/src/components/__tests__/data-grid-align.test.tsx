/**
 * @module client/src/components/__tests__/data-grid-align
 * @description Э3.5 (owner's rule 2026-10-03): a `DataGrid` / `Table` column header and its values
 * share one alignment.
 *
 * The header cell is a flex row (`.ou-grid__th`), so the column's `text-align` never moved it:
 * a right- or centre-aligned column kept its header at the left edge, a whole column away from
 * its numbers. And `td.is-numeric` pushed values right over an explicit `align`. The header now
 * carries an alignment modifier, and an explicit `align` marks the cell so it beats `is-numeric`.
 *
 * Lives in `client/src`, not `tests/`: vitest picks only `.ts` from `tests`, and this is JSX.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataGrid, type DataGridColumn } from "../../../../vendor/ui-kit/src/components/DataGrid";
import { Table, type TableColumn } from "../../../../vendor/ui-kit/src/components/Table";

interface Row { id: string; name: string; score: number; state: string }

const ROWS: Row[] = [{ id: "1", name: "Морозова Анна", score: 84, state: "Сдал" }];

/** Header block (`.ou-grid__th`) of the column titled `title`. */
function headerOf(title: string): HTMLElement {
  return screen.getByText(title).closest(".ou-grid__th") as HTMLElement;
}

/** Body cell holding `text`. */
function cellOf(text: string): HTMLElement {
  return screen.getByText(text).closest("td") as HTMLElement;
}

describe("DataGrid — column alignment", () => {
  it("a numeric column without align puts its header right, over the numbers", () => {
    const columns: DataGridColumn<Row>[] = [
      { key: "name", header: "Участник", render: r => r.name },
      { key: "score", header: "Результат", numeric: true, render: r => `${r.score} %` },
    ];
    render(<DataGrid columns={columns} rows={ROWS} rowKey={r => r.id} />);

    expect(headerOf("Результат").classList.contains("ou-grid__th--right")).toBe(true);
    expect(cellOf("84 %").classList.contains("is-numeric")).toBe(true);
    // A text column stays at the left edge: no modifier at all.
    expect(headerOf("Участник").className).not.toMatch(/ou-grid__th--/);
  });

  it("an explicit centre wins over is-numeric for both the header and the values", () => {
    const columns: DataGridColumn<Row>[] = [
      { key: "score", header: "Результат", numeric: true, align: "center", render: r => `${r.score} %` },
      { key: "state", header: "Исход", align: "center", render: r => r.state },
    ];
    render(<DataGrid columns={columns} rows={ROWS} rowKey={r => r.id} />);

    expect(headerOf("Результат").classList.contains("ou-grid__th--center")).toBe(true);
    expect(cellOf("84 %").classList.contains("is-align-center")).toBe(true);
    expect(headerOf("Исход").classList.contains("ou-grid__th--center")).toBe(true);
    expect(cellOf("Сдал").classList.contains("is-align-center")).toBe(true);
  });
});

describe("Table — column alignment", () => {
  it("the header follows the column: numeric goes right, explicit centre wins over is-numeric", () => {
    const columns: TableColumn<Row>[] = [
      { key: "name", header: "Участник", render: r => r.name },
      { key: "score", header: "Результат", numeric: true, render: r => `${r.score} %` },
      { key: "state", header: "Исход", numeric: true, align: "center", render: r => r.state },
    ];
    render(<Table columns={columns} rows={ROWS} rowKey={r => r.id} />);

    const th = (title: string) => screen.getByText(title).closest("th") as HTMLElement;
    expect(th("Участник").classList.contains("is-align-left")).toBe(true);
    expect(th("Результат").classList.contains("is-align-right")).toBe(true);
    expect(th("Исход").classList.contains("is-align-center")).toBe(true);
    expect(cellOf("Сдал").classList.contains("is-align-center")).toBe(true);
  });
});
