/**
 * @module features/tests/editor/sections/__tests__/scale-appearance-visibility
 *
 * PRD-46: когда в настройках варианта «Итоги теста» показывается блок «Оформление шкал».
 *
 * Правило одно — облик читает только роза, — но случаев вида ЧЕТЫРЕ, и решает не «выбрана ли
 * роза», а «может ли роза быть нарисована». `авто` на ипсативной методике даёт розу, и это
 * ровно тот сценарий, ради которого PRD-46 написан: спрятать там блок значило бы сделать
 * оформление недостижимым для тестов, для которых оно и заведено.
 */
import { describe, expect, it } from "vitest";
import { showsSetting } from "../start-pages-section";

const APPEARANCE = { key: "scaleAppearance", type: "scaleAppearance", label: "Оформление шкал" };
const OTHER = { key: "showCompetencyRadar", type: "boolean", label: "Радар" };

const shows = (kind: unknown) =>
  showsSetting(kind === undefined ? {} : { scalesChartKind: kind })(APPEARANCE as never);

describe("видимость блока «Оформление шкал»", () => {
  it("показан при явной розе", () => {
    expect(shows("rose")).toBe(true);
  });

  it("показан при «авто»: там роза выбирается по устройству методики", () => {
    expect(shows("auto")).toBe(true);
  });

  it("скрыт при радаре: вершины красит уровень, об идентичности радар не знает", () => {
    expect(shows("radar")).toBe(false);
  });

  it("скрыт, когда диаграммы нет вовсе — и когда настройка не задана", () => {
    expect(shows("none")).toBe(false);
    expect(shows(undefined)).toBe(false);
  });

  it("правило касается только этого поля — остальные показываются всегда", () => {
    expect(showsSetting({ scalesChartKind: "radar" })(OTHER as never)).toBe(true);
    expect(showsSetting({})(OTHER as never)).toBe(true);
  });
});
