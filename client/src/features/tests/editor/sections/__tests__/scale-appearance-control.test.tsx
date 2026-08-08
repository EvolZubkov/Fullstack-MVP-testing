/**
 * @module features/tests/editor/sections/__tests__/scale-appearance-control
 *
 * PRD-46 §7. «Оформление шкал»: строка на шкалу и превью НАБОРА рядом.
 *
 * Проверяется то, что решает эскиз, а не разметка ради разметки: цвет доступен ровно там, где
 * его читает роза, при объявленном направлении поле ВЫКЛЮЧЕНО и объяснено (исчезнувшее поле
 * читается как дефект), а сохранение идёт тройкой HSL — контракт рендерера, а не hex пикера.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScaleAppearanceControl, type AppearanceScale } from "../scale-appearance-control";

afterEach(cleanup);

function scale(key: string, over: Partial<AppearanceScale> = {}): AppearanceScale {
  return { key, label: `Шкала ${key}`, valence: "none", learnerVisibility: "level_and_value", ...over };
}

function renderControl(props: {
  scales: AppearanceScale[];
  value?: unknown;
  onChange?: (v: unknown) => void;
}) {
  return render(
    <ScaleAppearanceControl
      label="Оформление шкал"
      value={props.value}
      onChange={props.onChange ?? (() => {})}
      scales={props.scales}
      testId="appearance"
    />,
  );
}

const FOUR = [scale("s1"), scale("s2"), scale("s3"), scale("s4")];

describe("<ScaleAppearanceControl />", () => {
  it("рисует строку на каждую видимую шкалу", () => {
    renderControl({ scales: FOUR });
    for (const s of FOUR) expect(screen.getByText(s.label)).toBeInTheDocument();
    expect(screen.getByTestId("appearance-color-s1")).toBeEnabled();
  });

  it("скрытую от учащегося шкалу не показывает и говорит, сколько их", () => {
    renderControl({ scales: [...FOUR, scale("s5", { learnerVisibility: "hidden" })] });
    expect(screen.queryByText("Шкала s5")).toBeNull();
    expect(screen.getByTestId("appearance-hidden-note")).toHaveTextContent("Скрытых от учащегося шкал: 1");
  });

  it("при объявленном направлении цвет ВЫКЛЮЧЕН и объяснён, а не спрятан", () => {
    renderControl({ scales: [scale("s1", { valence: "higher_is_better" }), scale("s2"), scale("s3")] });
    expect(screen.getByTestId("appearance-color-s1")).toBeDisabled();
    // Выключено у ВСЕХ, а не только у шкалы с направлением: два языка цвета на одной фигуре
    // не смешиваются, роза целиком уходит на схему уровней.
    expect(screen.getByTestId("appearance-color-s2")).toBeDisabled();
    expect(screen.getByTestId("appearance-color-rule")).toHaveTextContent("цвет на розе показывает уровень");
    expect(screen.getAllByText("По схеме уровней").length).toBe(3);
  });

  it("сохраняет тройкой HSL: пикер работает в hex, контракт рендерера — тройка", () => {
    const onChange = vi.fn();
    renderControl({ scales: FOUR, onChange });
    fireEvent.click(screen.getByTestId("appearance-color-s2"));
    // Палитра открывается поповером ДС; берём образец из базовой палитры и применяем.
    fireEvent.click(screen.getByTitle("#29CCA3"));
    fireEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const written = (onChange.mock.calls[0][0] as Record<string, { color?: string }>).s2;
    expect(written.color).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/);
  });

  it("превью набора строится ядром розы", () => {
    renderControl({ scales: FOUR });
    const preview = screen.getByTestId("appearance-preview");
    expect(preview.querySelectorAll("path.tb-rose__sector")).toHaveLength(4);
  });

  it("меньше трёх шкал — превью не строится, и сказано почему", () => {
    renderControl({ scales: [scale("s1"), scale("s2")] });
    expect(screen.queryByTestId("appearance-preview")).toBeNull();
    expect(screen.getByTestId("appearance-preview-none")).toHaveTextContent("от трёх до шести");
  });

  it("при направлении превью не строится: цвет там зависит от ответов учащегося", () => {
    renderControl({ scales: [scale("s1", { valence: "lower_is_better" }), scale("s2"), scale("s3")] });
    expect(screen.queryByTestId("appearance-preview")).toBeNull();
    expect(screen.getByTestId("appearance-preview-off")).toBeInTheDocument();
  });

  it("без шкал объясняет, что оформлять нечего", () => {
    renderControl({ scales: [] });
    expect(screen.getByTestId("appearance-empty")).toHaveTextContent("В тесте нет шкал");
  });

  it("пиктограмма доступна и при объявленном направлении: она идентичность, а не оценка", () => {
    renderControl({ scales: [scale("s1", { valence: "higher_is_better" }), scale("s2"), scale("s3")] });
    expect(screen.getByTestId("appearance-color-s1")).toBeDisabled();
    expect(screen.getByTestId("appearance-icon-s1")).toBeEnabled();
  });

  it("непустая пиктограмма показана именем, пустая — состоянием, а не пустым квадратом", () => {
    renderControl({ scales: FOUR, value: { s1: { icon: "target" } } });
    expect(screen.getByTestId("appearance-icon-s1")).toHaveTextContent("target");
    expect(screen.getByTestId("appearance-icon-s2")).toHaveTextContent("Не выбрана");
  });

  it("хранит ИМЯ глифа, а не его контуры: геометрию подставляет хост", async () => {
    const onChange = vi.fn();
    renderControl({ scales: FOUR, onChange });
    fireEvent.click(screen.getByTestId("appearance-icon-s3"));
    // Таблица глифов подгружается лениво — ждём, пока сетка появится.
    fireEvent.change(await screen.findByTestId("icon-picker-search"), { target: { value: "target" } });
    fireEvent.click(await screen.findByTestId("icon-picker-cell-target"));
    fireEvent.click(screen.getByTestId("icon-picker-apply"));
    expect(onChange).toHaveBeenCalledWith({ s3: { icon: "target" } });
  });

  it("«Без пиктограммы» убирает запись целиком, если больше в ней ничего нет", async () => {
    const onChange = vi.fn();
    renderControl({ scales: FOUR, value: { s1: { icon: "target" }, s2: { color: "10 20% 30%" } }, onChange });
    fireEvent.click(screen.getByTestId("appearance-icon-s1"));
    fireEvent.click(await screen.findByTestId("icon-picker-clear"));
    expect(onChange).toHaveBeenCalledWith({ s2: { color: "10 20% 30%" } });
  });
});
