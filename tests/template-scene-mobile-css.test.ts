/**
 * @module tests/template-scene-mobile-css
 * @description Гарды мобильного слоя шаблонов. Проверяют не внешний вид (это приёмка
 * в браузере), а те инварианты, потеря которых ломает адаптив молча: размерные условия
 * объявлены КОНТЕЙНЕРНЫМИ, а не вьюпортными; ступени именно те, что согласованы; сетки
 * не возвращаются к неужимаемому floor; тач-плотность объявлена на узле внутри теневого
 * дерева; пороги CSS и `fit-question.ts` не разъезжаются.
 *
 * Оба шаблона несут ОДИН мобильный слой, поэтому гарды параметризованы: разметка у них
 * и так обязана совпадать (`template-layout-parity`), и если ступени разъедутся, при
 * одинаковом HTML телефонное поведение шаблонов разойдётся.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TEMPLATE_IDS, templateFile } from "./helpers/template-roots";

// Стили ВСЕХ шаблонов — встроенного и двух вынесенных в свои репозитории.
const THEMES = TEMPLATE_IDS.map((id) => templateFile(id, "styles/theme.css"));

const fitSrc = fs.readFileSync(path.resolve(__dirname, "../shared/template/fit-question.ts"), "utf8");

describe.each(THEMES)("мобильный слой: %s", (themePath) => {
  const css = fs.readFileSync(themePath, "utf8");
  /** Файл без комментариев: правила ищем в объявлениях, а не в пояснениях к ним. */
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");

  /**
   * Тело ступени: ВСЕ её блоки, а не «от первого заголовка до конца файла».
   *
   * Одну ступень файл объявляет НЕСКОЛЬКО раз — правила лежат рядом со своим блоком, а не
   * собраны в одном месте. Пока 520 встречалась однажды и последней, чтение «до конца файла»
   * работало; со вторым таким блоком та же выборка стала захватывать ступень 700 и читать её
   * значения как свои — тест падал на ВЕРНОМ CSS.
   */
  function stepBody(px: number): string {
    const headers = [...declarations.matchAll(
      /@container\s+tbscene\s*\(max-width:\s*(\d+)px\)\s*\{/g,
    )];
    const parts = headers
      .filter(header => Number(header[1]) === px)
      .map(header => {
        const start = header.index! + header[0].length;
        const next = headers.find(other => other.index! > header.index!);
        return declarations.slice(start, next ? next.index! : declarations.length);
      });
    expect(parts.length, `нет ступени ${px}`).toBeGreaterThan(0);
    return parts.join("\n");
  }

  describe("контейнер сцены", () => {
    it("сцена объявлена размерным контейнером tbscene", () => {
      expect(declarations).toMatch(/\.tb-scene\s*\{[^}]*container:\s*tbscene\s*\/\s*inline-size/);
    });

    it("размерные условия — только @container, ни одного вьюпортного @media по ширине", () => {
      // `prefers-color-scheme` и `pointer` — не размерные, они разрешены.
      const widthMedia = declarations.match(/@media[^{]*\((?:max|min)-width[^)]*\)/g) || [];
      expect(widthMedia).toEqual([]);
    });

    it("ступени ровно те, что согласованы: 900 / 700 / 520", () => {
      const steps = [...declarations.matchAll(/@container\s+tbscene\s*\(max-width:\s*(\d+)px\)/g)].map(
        (m) => Number(m[1]),
      );
      expect(steps.length).toBeGreaterThan(0);
      expect([...new Set(steps)].sort((a, b) => b - a)).toEqual([900, 700, 520]);
    });

    it("контейнер шапки tbhead сохранён — деградация карты вопросов на планшете от него", () => {
      expect(declarations).toMatch(/container:\s*tbhead\s*\/\s*inline-size/);
      expect(declarations).toMatch(/@container\s+tbhead\s*\(max-width:/);
    });
  });

  describe("раскладка", () => {
    it("сетки карточек ужимаются ниже своего floor — minmax(min(...))", () => {
      // Голый `minmax(340px, 1fr)` не может стать уже 340px: на 360px экране это давало
      // горизонтальную прокрутку тела сцены.
      const grids = declarations.match(/repeat\(auto-fit,\s*minmax\([^)]*\)[^)]*\)/g) || [];
      expect(grids.length).toBeGreaterThan(0);
      for (const g of grids) expect(g).toContain("minmax(min(");
    });

    it("подвал на телефоне переносится, основная кнопка идёт последней", () => {
      expect(declarations).toMatch(/\.tb-scene__foot\s*\{[^}]*flex-wrap:\s*wrap/);
      // Основная кнопка уходит последней независимо от порядка в разметке: на старте и
      // итогах вторичные кнопки идут в DOM ПОСЛЕ неё.
      expect(declarations).toMatch(/\.tb-scene__foot\s+\.ou-btn--primary\s*\{[^}]*order:\s*99/);
    });

    it("тач-цели в подвале не мельче 44px", () => {
      expect(declarations).toMatch(/\.tb-scene__foot\s+\.ou-btn--ghost[\s\S]{0,240}min-height:\s*44px/);
      expect(declarations).toMatch(/\.tb-scene__foot\s+\.ou-btn--primary\s*\{[^}]*min-height:\s*48px/);
    });

    it("карта вопросов на телефоне скрывается точками и легендой, счётчики остаются", () => {
      expect(declarations).toMatch(/\.tb-scene__map\s+\.ou-quiz__dots[\s\S]{0,80}display:\s*none/);
      // Счётчики живут ВНУТРИ .tb-scene__map — скрывать сам блок нельзя.
      expect(declarations).not.toMatch(/\.tb-scene__map\s*\{[^}]*display:\s*none/);
      expect(declarations).toContain(".tb-scene__mapcounts");
    });

    it("шапка перестраивается в строки: оба внутренних контейнера растворяются", () => {
      // Заголовок, таймеры и счётчики лежат в РАЗНЫХ обёртках; пока обёртки живы, они
      // не могут делить строки и шапка растёт этажеркой.
      expect(declarations).toMatch(/\.tb-scene__brandrow,\s*\n?\s*\.tb-scene__map\s*\{[^}]*display:\s*contents/);
      expect(declarations).toMatch(/\.tb-scene__header\s*\{[^}]*flex-wrap:\s*wrap/);
    });

    it("таймер на телефоне лежит в строку, а не подписью над числом", () => {
      expect(declarations).toMatch(
        /\.tb-scene__timers\s+\.ou-timer--digital\s*\{[^}]*flex-direction:\s*row/,
      );
    });

    it("подвал не навязывает вторую строку — перенос решает по месту", () => {
      expect(declarations).toMatch(/\.tb-scene__foot-spacer\s*\{[^}]*display:\s*none/);
      expect(declarations).toMatch(/\.tb-scene__foot\s+\.ou-btn--primary\s*\{[^}]*flex:\s*1\s+1\s+auto/);
    });

    it("потолок длинного вопроса читает РОВНО те переменные, что пишет fit-question", () => {
      // Контракт имён: переименуют с одной стороны — потолок молча перестанет работать,
      // и длинный вопрос снова закроет варианты.
      const written = [...fitSrc.matchAll(/setProperty\(\s*"(--tb-prompt-[a-z-]+)"/g)].map((m) => m[1]);
      expect(written.sort()).toEqual(["--tb-prompt-mask", "--tb-prompt-max-h"]);
      for (const name of written) {
        expect(declarations, `CSS не читает ${name}`).toContain(`var(${name},`);
      }
      expect(declarations).toMatch(/\.tb-scene__q\s*\{[^}]*overflow-y:\s*auto/);
    });

    it("гарантируется видимость трёх вариантов", () => {
      const m = fitSrc.match(/const KEEP_OPTIONS_VISIBLE\s*=\s*(\d+)/);
      expect(m).toBeTruthy();
      expect(Number(m![1])).toBe(3);
    });

    it("читаемый слой набран body-m, а метки остаются body-s", () => {
      // 12px (`body-s`, 12/16) — размер подписи. Текст, который учащийся ЧИТАЕТ —
      // подсказка к вопросу, обратная связь по теме, «требуется N%», подписи
      // рекомендаций — набран `body-m` (14/20): плюс два пикселя и плюс четверть
      // межстрочного, что на абзаце важнее размера. Правила БАЗОВЫЕ, то есть
      // действуют на всех ширинах, а не только на телефоне.
      const readable = [
        "\\.tb-scene__qhint",
        "\\.tb-scene__subtitle",
        "\\.tb-topic-card__req",
        "\\.tb-topic-card__fb-text",
      ];
      for (const sel of readable) {
        expect(declarations, `${sel} выпал из читаемого слоя`).toMatch(
          new RegExp(`${sel}\\s*\\{[^}]*--ou-text-body-m`),
        );
      }
      // Чип рекомендации объявлен многострочным правилом.
      expect(declarations).toMatch(/\.tb-rec\s*\{[^}]*--ou-text-body-m/);

      // То, что сканируют, а не читают, намеренно остаётся на 12px.
      for (const sel of ["\\.tb-facts__lbl", "\\.tb-eyebrow"]) {
        expect(declarations, `${sel} не должен подниматься до body-m`).toMatch(
          new RegExp(`${sel}\\s*\\{[^}]*--ou-text-body-s`),
        );
      }
      expect(stepBody(520)).toMatch(/\.tb-scene__mapcount\s*\{[^}]*--ou-text-body-s/);
    });

    it("центрированная колонка не обрезает контент выше поля", () => {
      expect(declarations).toMatch(/\.tb-scene__col--center\s*\{[^}]*min-height:\s*100%/);
      expect(declarations).toMatch(/\.tb-scene__col--center\s*\{[^}]*justify-content:\s*safe center/);
    });
  });

  describe("тач", () => {
    it("плотность включается по pointer: coarse, а не по any-pointer", () => {
      expect(declarations).toMatch(/@media\s*\(pointer:\s*coarse\)/);
      // `any-pointer: coarse` срабатывает на любом тач-способном ноутбуке — это сломало
      // бы десктоп.
      expect(declarations).not.toContain("any-pointer");
    });

    it("токены плотности объявлены на .tb-scene, а не на .ou / :root / :host", () => {
      const block = declarations.match(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*)\}/);
      expect(block).toBeTruthy();
      const body = block![1];
      expect(body).toMatch(/\.tb-scene[^{]*\{[^}]*--ou-size-control-m:/);
      // Правило документа `.ou{}` побеждает `:host{}` из теневой таблицы по правилу
      // encapsulation context — переопределение на .ou/:host просто не применилось бы.
      expect(body).not.toMatch(/(^|[},])\s*(\.ou|:host|:root)\s*[,{]/);
    });

    it("грип ранжирования возвращается вместе с четвёртой колонкой сетки", () => {
      // DS ниже 480px прячет грип И схлопывает строку до трёх колонок; вернуть надо оба,
      // иначе блок стрелок переносится на вторую строку.
      expect(declarations).toMatch(/\.tb-scene\s+\.ou-rank__grip\s*\{[^}]*touch-action:\s*none/);
      expect(declarations).toMatch(
        /\.tb-scene\s+\.ou-rank__item\s*\{[^}]*grid-template-columns:\s*auto auto 1fr auto/,
      );
    });
  });

  describe("пороги CSS и подгонки шрифта не разъезжаются", () => {
    /** Границы clamp() для заданного селектора внутри ступени S3. */
    function clampBounds(selector: string): [number, number] {
      // Средний аргумент — `var(--tb-*-fs, 30px)`, внутри него СВОЯ запятая, поэтому
      // разделять по запятым нельзя: берём var(...) целиком.
      const rule = new RegExp(
        `${selector}[^{]*\\{[^}]*clamp\\(\\s*(\\d+)px\\s*,\\s*var\\([^)]*\\)\\s*,\\s*(\\d+)px\\s*\\)`,
      );
      const m = stepBody(520).match(rule);
      expect(m, `нет clamp() для ${selector} в S3`).toBeTruthy();
      return [Number(m![1]), Number(m![2])];
    }

    it("порог узкого профиля равен ступени S3", () => {
      const m = fitSrc.match(/export const NARROW_FIELD_PX\s*=\s*(\d+)/);
      expect(m).toBeTruthy();
      expect(Number(m![1])).toBe(520);
    });

    it("границы узкого профиля совпадают с clamp() вопроса и варианта", () => {
      const narrow = fitSrc.match(
        /narrow:\s*\{\s*qMax:\s*(\d+),\s*qMin:\s*(\d+),\s*aMax:\s*(\d+),\s*aMin:\s*(\d+)/,
      );
      expect(narrow, "не найден узкий профиль в fit-question.ts").toBeTruthy();
      const [, qMax, qMin, aMax, aMin] = narrow!.map(Number);

      expect(clampBounds("\\.tb-scene__qtitle")).toEqual([qMin, qMax]);
      expect(clampBounds("\\.ou-radio-card__title")).toEqual([aMin, aMax]);
    });

    it("на планшетной ступени CSS не обрезает подгонку снизу", () => {
      // S2 действует там, где активен ШИРОКИЙ профиль, поэтому пол clamp() обязан
      // совпадать с его полом. Пол выше профильного делает нижнюю часть диапазона
      // недостижимой: подгонка считает 16px, а CSS печатает 20 — и цикл ужимания
      // работает вхолостую ровно тогда, когда он нужнее всего.
      const wide = fitSrc.match(/wide:\s*\{\s*qMax:\s*(\d+),\s*qMin:\s*(\d+),\s*aMax:\s*(\d+),\s*aMin:\s*(\d+)/);
      expect(wide, "не найден широкий профиль в fit-question.ts").toBeTruthy();
      const [, , qMin, , aMin] = wide!.map(Number);

      const s2 = stepBody(700);
      const floor = (selector: string) => {
        const m = s2.match(new RegExp(`${selector}[^{]*\\{[^}]*clamp\\(\\s*(\\d+)px`));
        expect(m, `нет clamp() для ${selector} в S2`).toBeTruthy();
        return Number(m![1]);
      };
      expect(floor("\\.tb-scene__qtitle")).toBe(qMin);
      expect(floor("\\.ou-radio-card__title")).toBe(aMin);
    });
  });
});
