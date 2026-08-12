/**
 * @module shared/template/__tests__/lucide-contours
 *
 * PRD-46 §8. Every lucide node collapses to path data, because that is the only shape a SCORM
 * package can draw: no React, no icon font, no library to look a name up in.
 *
 * The circle is the case worth pinning. One arc cannot close it — an arc whose endpoints
 * coincide is degenerate and renderers drop it — so a full circle is TWO half-turns, and the
 * result is compared against the glyphs the approved wireframe was drawn from.
 */
import { describe, expect, it } from "vitest";
import { iconToPaths, nodeToPath } from "../lucide-contours";
import GLYPHS from "../lucide-icons.generated.json";

describe("nodeToPath", () => {
  it("окружность — двумя полудугами, как в согласованном эскизе", () => {
    expect(nodeToPath(["circle", { cx: "12", cy: "12", r: "10" }])).toBe(
      "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0",
    );
  });

  it("эллипс — те же две полудуги с разными радиусами", () => {
    expect(nodeToPath(["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3" }])).toBe(
      "M3 5a9 3 0 1 0 18 0a9 3 0 1 0 -18 0",
    );
  });

  it("путь проходит как есть: переписывать чужую геометрию нечем и незачем", () => {
    expect(nodeToPath(["path", { d: "M20 3v4" }])).toBe("M20 3v4");
  });

  it("отрезок становится парой команд", () => {
    expect(nodeToPath(["line", { x1: "4", y1: "22", x2: "4", y2: "15" }])).toBe("M4 22L4 15");
  });

  it("ломаная и многоугольник различаются только замыканием", () => {
    expect(nodeToPath(["polyline", { points: "1,2 3,4" }])).toBe("M1 2L3 4");
    expect(nodeToPath(["polygon", { points: "1,2 3,4" }])).toBe("M1 2L3 4Z");
  });

  it("прямоугольник без скруглений — четыре стороны", () => {
    expect(nodeToPath(["rect", { x: "3", y: "3", width: "18", height: "18" }])).toBe(
      "M3 3h18v18h-18Z",
    );
  });

  it("скругление прямоугольника не превышает половины стороны", () => {
    // Незажатый радиус выворачивает угол наизнанку: в наборе есть глифы, где rx больше бокса.
    const d = nodeToPath(["rect", { x: "0", y: "0", width: "4", height: "4", rx: "10" }])!;
    expect(d.startsWith("M2 0")).toBe(true);
  });

  it("незнакомый узел выбрасывается, а не угадывается", () => {
    expect(nodeToPath(["foreignObject", { x: "0" }])).toBeNull();
    expect(iconToPaths([["foreignObject", {}], ["path", { d: "M0 0" }]])).toEqual(["M0 0"]);
  });

  it("пустой путь не попадает в набор: он ничего не рисует", () => {
    expect(iconToPaths([["path", { d: "   " }]])).toEqual([]);
  });
});

describe("таблица глифов", () => {
  const table = GLYPHS as Record<string, string[]>;

  it("собрана и покрывает набор, из которого рисовался эскиз", () => {
    for (const name of ["target", "sparkles", "settings", "users-round", "shield", "zap", "flag"]) {
      expect(table[name]?.length, name).toBeGreaterThan(0);
    }
  });

  it("совпадает с контурами эскиза до символа", () => {
    expect(table["target"]).toEqual([
      "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0",
      "M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0",
      "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    ]);
    expect(table["users-round"]).toEqual([
      "M18 21a8 8 0 0 0-16 0",
      "M5 8a5 5 0 1 0 10 0a5 5 0 1 0 -10 0",
      "M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3",
    ]);
  });

  it("в наборе нет пустых записей — имя без контуров рисовало бы пустоту", () => {
    expect(Object.values(table).every((paths) => paths.length > 0)).toBe(true);
  });
});
