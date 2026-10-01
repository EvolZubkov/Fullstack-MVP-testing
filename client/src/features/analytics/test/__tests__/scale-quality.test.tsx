/**
 * @module features/analytics/test/__tests__/scale-quality
 * @description PRD-66 FR-29 — FR-32: качество измерительных шкал.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScaleQualityPanel, type ScaleItemRow, type ScaleQualityRow } from "../scale-quality";
import { termOrText } from "./term-text";

function item(over: Partial<ScaleItemRow> & Pick<ScaleItemRow, "questionId" | "prompt">): ScaleItemRow {
  return {
    questionType: "scale",
    observations: 120,
    itemRest: 0.52,
    distribution: [0.1, 0.2, 0.4, 0.2, 0.1],
    gradeLabels: ["Никогда", "Редко", "Иногда", "Часто", "Всегда"],
    dead: false,
    againstScale: false,
    alphaIfMirrored: null,
    ...over,
  };
}

function scale(over: Partial<ScaleQualityRow> = {}): ScaleQualityRow {
  return {
    scaleKey: "burnout",
    label: "Эмоциональное истощение",
    reliability: { alpha: 0.81, items: 9, respondents: 120, totalSd: 6.4, dichotomous: false },
    respondents: 120,
    ipsative: false,
    items: [item({ questionId: "s1", prompt: "Я чувствую себя опустошённым" })],
    ...over,
  };
}

describe("ScaleQualityPanel", () => {
  it("сводка «Шкалы методики» печатает согласованность шкалы с составом расчёта", () => {
    render(<ScaleQualityPanel scales={[scale()]} />);

    expect(screen.getByText(termOrText("Шкалы методики"))).toBeTruthy();
    expect(screen.getByText(termOrText("Эмоциональное истощение"))).toBeTruthy();
    expect(screen.getByText(termOrText("0,81"))).toBeTruthy();
    expect(screen.getByText(termOrText("9"))).toBeTruthy();
    expect(screen.getByText(termOrText("Хорошо"))).toBeTruthy();
    expect(screen.getByText(termOrText("Пункты шкалы «Эмоциональное истощение»"))).toBeTruthy();
  });

  it("альфа ниже порога — вывод называет порог и пункты против шкалы", () => {
    render(<ScaleQualityPanel scales={[scale({
      reliability: { alpha: 0.64, items: 5, respondents: 120, totalSd: 4, dichotomous: false },
      items: [item({ questionId: "s3", prompt: "Обратный пункт", itemRest: -0.44, againstScale: true })],
    })]} />);

    expect(screen.getByText(termOrText("Ниже приемлемого"))).toBeTruthy();
    expect(screen.getByText(termOrText("порог 0,70; 1 пункт против шкалы"))).toBeTruthy();
  });

  it("заголовки называют термины по эскизу и несут подсказки (FR-14b)", () => {
    const { container } = render(<ScaleQualityPanel scales={[scale()]} />);

    for (const term of [
      "Пунктов", "Альфа Кронбаха", "n", "Вывод по шкале",
      "Вклад", "Корреляция с остатком шкалы", "Распределение ответов", "Качество пункта",
    ]) {
      const label = screen.getByText(termOrText(term));
      const tip = label.closest("[aria-describedby]");
      expect(tip, term).not.toBeNull();
      expect(tip!.querySelector(".ou-sr-only")?.textContent, term).toBeTruthy();
      // Значок — lucide `Info` в одном неразрывном блоке с последним словом (см. term-hint.tsx).
      expect(label.classList.contains("tb-term-hint__term"), term).toBe(true);
    }
    expect(screen.queryByText(termOrText("Признак"))).toBeNull();
    expect(screen.queryByText(termOrText("Связь с остатком шкалы"))).toBeNull();
    // Подсказка распределения — один текст на все случаи: он описывает единственную форму
    // гистограммы (FR-30), а не градации конкретного вопроса.
    const hint = screen.getByText(termOrText("Распределение ответов")).closest("[aria-describedby]")!.querySelector(".ou-sr-only");
    expect(hint?.textContent).toBe(
      "Доли участников по градациям ответа. Под столбиками — номера градаций, словами подписаны крайние; расшифровка номеров — в подсказке ячейки.",
    );
    expect(container.textContent).not.toContain("Доли участников по градациям ответа этого вопроса");
  });

  it("причину отсутствия согласованности называет словами", () => {
    render(<ScaleQualityPanel scales={[scale({ reliability: "no-variance" })]} />);
    expect(screen.getByText(termOrText(/все ответили одинаково/))).toBeTruthy();
  });

  it("признак пункта называет ПОВЕДЕНИЕ, а следствие даёт числом (FR-31a, FR-31b)", () => {
    // «Вклад не перевёрнут» — догадка о причине, которую расчёт проверить не может. Признак
    // говорит, что видно: пункт ведёт себя противоположно шкале.
    render(<ScaleQualityPanel scales={[scale({
      items: [item({
        questionId: "s3",
        prompt: "Обратный пункт",
        itemRest: -0.31,
        againstScale: true,
        alphaIfMirrored: 0.9,
      })],
    })]} />);

    expect(screen.getByText(termOrText("Работает против шкалы"))).toBeTruthy();
    expect(screen.getByText(termOrText(/с вкладом −1 альфа 0,81 → 0,90/))).toBeTruthy();
  });

  it("мёртвый пункт назван и несёт число, которое его вызвало (FR-50)", () => {
    render(<ScaleQualityPanel scales={[scale({
      items: [item({ questionId: "s2", prompt: "Все отвечают одинаково", dead: true, distribution: [0.01, 0.02, 0.94, 0.02, 0.01] })],
    })]} />);

    expect(screen.getByText(termOrText("Мёртвый пункт"))).toBeTruthy();
    // Подпись — дословно из эскиза wf-scales: «94 % в одной градации».
    expect(screen.getByText(termOrText("94 % в одной градации"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Работает"))).toBeNull();
  });

  it("здоровый пункт помечен «Работает», как в эскизе, а не прочерком", () => {
    render(<ScaleQualityPanel scales={[scale()]} />);
    expect(screen.getByText(termOrText("Работает"))).toBeTruthy();
  });

  it("без связи с остатком шкалы «Работает» не утверждается", () => {
    render(<ScaleQualityPanel scales={[scale({ items: [item({ questionId: "s1", prompt: "Пункт", itemRest: null })] })]} />);
    expect(screen.queryByText(termOrText("Работает"))).toBeNull();
  });

  describe("колонка «Вклад»", () => {
    it("печатает знак и шаг: «+1» и «−1» с типографским минусом", () => {
      render(<ScaleQualityPanel scales={[scale({
        items: [
          item({ questionId: "s1", prompt: "Прямой пункт", contribution: { value: 1, exact: true } }),
          item({ questionId: "s2", prompt: "Обратный пункт", contribution: { value: -1, exact: true } }),
        ],
      })]} />);

      expect(screen.getByText(termOrText("+1"))).toBeTruthy();
      // U+2212, а не дефис: в колонке чисел дефис читается как прочерк.
      expect(screen.getByText(termOrText("−1"))).toBeTruthy();
      expect(screen.queryByText(termOrText("-1"))).toBeNull();
    });

    it("дробный и неравномерный вклад — с запятой и знаком приближения", () => {
      render(<ScaleQualityPanel scales={[scale({
        items: [
          item({ questionId: "s1", prompt: "Половинный", contribution: { value: 0.5, exact: true } }),
          item({ questionId: "s2", prompt: "Неравномерный", contribution: { value: -0.8, exact: false } }),
        ],
      })]} />);

      expect(screen.getByText(termOrText("+0,5"))).toBeTruthy();
      expect(screen.getByText(termOrText("≈−0,8"))).toBeTruthy();
    });

    it("вклад, не выражаемый одним числом, — прочерк, а не выдуманное число", () => {
      render(<ScaleQualityPanel scales={[scale({
        items: [item({ questionId: "s1", prompt: "Выбор без порядка", contribution: null })],
      })]} />);

      const cells = screen.getByText(termOrText("Выбор без порядка")).closest("tr")!.querySelectorAll("td");
      // Прочерк, а причина — в подсказке ячейки.
      expect(cells[1].textContent?.startsWith("—")).toBe(true);
      expect(cells[1].textContent).toContain("одним числом не выражается");
    });

    it("колонки пунктов идут в порядке эскиза", () => {
      render(<ScaleQualityPanel scales={[scale()]} />);
      // Первые пять заголовков — сводка «Шкалы методики», следующие — карточка пунктов шкалы.
      const headers = screen.getAllByRole("columnheader").slice(5).map(h => h.textContent ?? "");
      const expected = ["Пункт", "Вклад", "Корреляция с остатком шкалы", "Распределение ответов", "Качество пункта"];
      expect(headers).toHaveLength(expected.length);
      expected.forEach((term, i) => expect(headers[i].startsWith(term), term).toBe(true));
    });
  });

  it("обе таблицы — в фиксированной раскладке, без горизонтальной прокрутки", () => {
    render(<ScaleQualityPanel scales={[scale()]} />);
    expect(document.querySelectorAll(".ou-grid.tb-psy-grid")).toHaveLength(2);
  });

  it("ипсативная методика помечается — альфа там занижена по построению", () => {
    render(<ScaleQualityPanel scales={[scale({ ipsative: true })]} />);
    expect(screen.getByText(termOrText("Ипсативная методика"))).toBeTruthy();
  });

  describe("подзаголовок карточки пунктов: градации и прохождения", () => {
    const grades = (count: number) => ({
      distribution: new Array<number>(count).fill(1 / count),
      gradeLabels: Array.from({ length: count }, (_, i) => `Градация ${i + 1}`),
    });

    it.each([
      [5, "Пять градаций ответа · 312 прохождений"],
      [7, "Семь градаций ответа · 312 прохождений"],
      [3, "Три градации ответа · 312 прохождений"],
      [11, "11 градаций ответа · 312 прохождений"],
    ])("%i градаций — «%s»", (count, expected) => {
      render(<ScaleQualityPanel scales={[scale({
        respondents: 312,
        items: [item({ questionId: "s1", prompt: "Пункт", ...grades(count) })],
      })]} />);
      expect(screen.getByText(termOrText(expected))).toBeTruthy();
    });

    it("пункты с разным числом градаций — диапазон", () => {
      render(<ScaleQualityPanel scales={[scale({
        respondents: 312,
        items: [
          item({ questionId: "s1", prompt: "Пятибалльный", ...grades(5) }),
          item({ questionId: "s2", prompt: "Семибалльный", ...grades(7) }),
        ],
      })]} />);
      expect(screen.getByText(termOrText("от 5 до 7 градаций ответа · 312 прохождений"))).toBeTruthy();
    });

    it("без пунктов Ликерта — только число прохождений", () => {
      // Распределение баллов и одиночный выбор «градаций ответа» не имеют: одиночный выбор
      // рисует гистограмму по вариантам, но подзаголовок их градациями не называет.
      render(<ScaleQualityPanel scales={[scale({
        respondents: 312,
        items: [
          item({ questionId: "s1", prompt: "Распределение", questionType: "allocation", distribution: [], gradeLabels: [] }),
          item({ questionId: "s2", prompt: "Выбор", questionType: "single", ...grades(4) }),
        ],
      })]} />);
      expect(screen.getByText(termOrText("312 прохождений"))).toBeTruthy();
      expect(screen.queryByText(termOrText(/градаци\S* ответа ·/))).toBeNull();
    });
  });

  describe("распределение ответов — одна форма (FR-30)", () => {
    function histogramOf(prompt: string): HTMLElement {
      return screen.getByText(termOrText(prompt)).closest("tr")!.querySelector(".tb-psy-hist") as HTMLElement;
    }

    it("под столбиками номера, словами — только два края", () => {
      render(<ScaleQualityPanel scales={[scale()]} />);
      const hist = histogramOf("Я чувствую себя опустошённым");

      const numbers = [...hist.querySelectorAll(".tb-psy-hist__label")].map(el => el.textContent);
      expect(numbers).toEqual(["1", "2", "3", "4", "5"]);
      const edges = [...hist.querySelectorAll(".tb-psy-hist__edges > *")].map(el => el.textContent);
      expect(edges).toEqual(["Никогда", "Всегда"]);
      // Середина шкалы словами под столбиками не подписывается.
      expect(hist.textContent).not.toContain("Редко");
      expect(hist.textContent).not.toContain("Иногда");
    });

    it("длинные градации — та же форма: номера и края, без подписи под каждым столбиком", () => {
      const long = "Я помогаю команде сфокусироваться на главном и направляю наши усилия на то, чтобы цели были достигнуты в срок";
      const middle = "Я призываю коллег к открытому обсуждению проблем";
      render(<ScaleQualityPanel scales={[scale({
        items: [item({
          questionId: "s8",
          prompt: "Пункт с длинными вариантами",
          distribution: [0.5, 0.3, 0.2],
          gradeLabels: [long, middle, "Я предлагаю вернуться к плану"],
        })],
      })]} />);
      const hist = histogramOf("Пункт с длинными вариантами");

      expect([...hist.querySelectorAll(".tb-psy-hist__label")].map(el => el.textContent)).toEqual(["1", "2", "3"]);
      expect([...hist.querySelectorAll(".tb-psy-hist__edges > *")].map(el => el.textContent))
        .toEqual([long, "Я предлагаю вернуться к плану"]);
      // Края — одной строкой с многоточием, а не переносом.
      hist.querySelectorAll(".tb-psy-hist__edges > *")
        .forEach(el => expect(el.classList.contains("ou-text--truncate")).toBe(true));
    });

    it("подсказка ячейки расшифровывает номера нумерованным списком в порядке градаций", () => {
      render(<ScaleQualityPanel scales={[scale()]} />);
      const tip = histogramOf("Я чувствую себя опустошённым").closest("[aria-describedby]")!;
      // Текст подсказки лежит в триггере скрытым для глаз: пузырь выводится поверх страницы
      // только по наведению (floating-hint.tsx), а пояснение читает экранный диктор.
      const bubble = tip.querySelector(".ou-sr-only")!;

      expect(bubble.textContent).toMatch(/^Градации ответа: /);
      // Пробел перед знаком неразрывный (единый формат процентов, Э1) — здесь важны слова и числа.
      const items = [...bubble.querySelectorAll("ol > li")].map(li => li.textContent?.replace(/ /g, " "));
      expect(items).toEqual([
        "Никогда — 10 %",
        "Редко — 20 %",
        "Иногда — 40 %",
        "Часто — 20 %",
        "Всегда — 10 %",
      ]);
    });
  });

  it("без шкал ничего не выдумывает", () => {
    render(<ScaleQualityPanel scales={[]} />);
    expect(screen.getByText(termOrText(/Шкал, по которым набраны наблюдения, в этом тесте нет/))).toBeTruthy();
  });
});
