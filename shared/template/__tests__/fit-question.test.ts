/**
 * @module shared/template/__tests__/fit-question
 * @description Профиль подгонки шрифта по ширине поля. Проверяется не сама подгонка
 * (она измеряет DOM, которого в jsdom нет в натуральную величину), а ВЫБОР диапазона:
 * на телефоне поиск обязан идти в тех же границах, которые ниже наложит `clamp()` в
 * `theme.css` — иначе цикл гоняет reflow по диапазону, который CSS всё равно отбросит.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { fitQuestionScene, NARROW_FIELD_PX } from "../fit-question";

/**
 * Строит тройку узлов сцены с управляемой геометрией. jsdom не считает раскладку,
 * поэтому размеры задаются напрямую — этого хватает: модуль читает `clientWidth`,
 * `clientHeight`, `scrollHeight` и `getBoundingClientRect`.
 *
 * @param fieldW    ширина поля (то, по чему выбирается профиль)
 * @param overflow  переполняется ли поле по высоте
 * @param headerH   высота шапки вопроса; поле в моке — 600px, так что значение выше
 *                  200 (треть) запускает фазу 1, а выше 150 (четверть) — фазу 3
 */
function makeScene(fieldW: number, overflow: boolean, headerH = 10) {
  const field = document.createElement("div");
  const col = document.createElement("div");
  const headerEnd = document.createElement("div");
  field.appendChild(col);
  col.appendChild(headerEnd);
  document.body.appendChild(field);

  Object.defineProperty(field, "clientWidth", { value: fieldW, configurable: true });
  Object.defineProperty(field, "clientHeight", { value: 600, configurable: true });
  Object.defineProperty(field, "scrollHeight", { value: overflow ? 2000 : 100, configurable: true });
  col.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: fieldW, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  headerEnd.getBoundingClientRect = () => ({ top: 0, bottom: headerH, left: 0, right: 0, width: 0, height: headerH, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

  return { field, col, headerEnd };
}

/** Числовое значение шрифтовой переменной, записанной модулем на колонку. */
const readVar = (col: HTMLElement, name: string) => Number.parseFloat(col.style.getPropertyValue(name));

describe("fitQuestionScene: профиль по ширине поля", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("на широком поле держит прежние максимумы 32 / 22", () => {
    const { field, col, headerEnd } = makeScene(1200, false);
    fitQuestionScene(field, col, headerEnd);
    expect(readVar(col, "--tb-question-fs")).toBe(32);
    expect(readVar(col, "--tb-answer-fs")).toBe(22);
  });

  it("на узком поле держит мобильные максимумы 22 / 17", () => {
    const { field, col, headerEnd } = makeScene(NARROW_FIELD_PX, false);
    fitQuestionScene(field, col, headerEnd);
    expect(readVar(col, "--tb-question-fs")).toBe(22);
    expect(readVar(col, "--tb-answer-fs")).toBe(17);
  });

  it("на узком поле не опускается ниже пола 18 / 15 даже при переполнении", () => {
    // Раньше поле телефона гнало кегль до 16 / 14: на маленьком экране переполнение
    // неизбежно, и правильный размен — прокрутка, а не нечитаемый текст.
    const { field, col, headerEnd } = makeScene(360, true);
    fitQuestionScene(field, col, headerEnd);
    expect(readVar(col, "--tb-question-fs")).toBeGreaterThanOrEqual(18);
    expect(readVar(col, "--tb-answer-fs")).toBeGreaterThanOrEqual(15);
  });

  it("на широком поле при переполнении доходит до прежних полов 16 / 14", () => {
    // Шапка 400px при поле 600px — выше и трети, и четверти, поэтому работают все три
    // фазы и заголовок доходит до своего пола. При маленькой шапке фаза 3 не нужна:
    // уступать нечего, и заголовок остаётся крупным — это и есть смысл балансировки.
    const { field, col, headerEnd } = makeScene(1200, true, 400);
    fitQuestionScene(field, col, headerEnd);
    expect(readVar(col, "--tb-question-fs")).toBe(16);
    expect(readVar(col, "--tb-answer-fs")).toBe(14);
  });

  it("узкий профиль при той же геометрии не пускает заголовок ниже 18", () => {
    const { field, col, headerEnd } = makeScene(360, true, 400);
    fitQuestionScene(field, col, headerEnd);
    expect(readVar(col, "--tb-question-fs")).toBe(18);
    expect(readVar(col, "--tb-answer-fs")).toBe(15);
  });

  it("явные опции перекрывают профиль", () => {
    const { field, col, headerEnd } = makeScene(360, false);
    fitQuestionScene(field, col, headerEnd, { questionMax: 40, answerMax: 30 });
    expect(readVar(col, "--tb-question-fs")).toBe(40);
    expect(readVar(col, "--tb-answer-fs")).toBe(30);
  });
});
