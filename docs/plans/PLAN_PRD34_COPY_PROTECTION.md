# PRD-34 Copy Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять цену бытового копирования текста заданий и сделать утечку через снимок экрана
атрибутируемой — одинаково в вебе и в SCORM-пакете, не задев автора в отладке и участника в
законно уносимых экранах.

**Architecture:** Периметр вычисляет ОДИН чистый построитель `shared/template/protection/spec.ts`
(без DOM), применение живёт рядом в `apply.ts` / `watermark.ts` / `blur-guard.ts`. Оба хоста
передают готовое описание новым полем `protection` структуры `ScreenRenderInput`, и
`renderScreenInto` применяет его после заполнения слотов. Запрет выделения ставится
ИНЛАЙН-свойствами (инлайн не перебивается ничем), слушатели `copy`/`cut`/`contextmenu`/`dragstart`
вешаются на корень сцены один раз, а единственное CSS-правило (печать) впрыскивается ядром в
корень сцены — поэтому загруженный извне шаблон (PRD-3) получает защиту, ничего о ней не зная.

**Tech Stack:** TypeScript (Node/Express, Drizzle, Zod), React 19 + `@universityrt/ui-kit`,
Vitest + jsdom (`npm test -- <путь>`), plain-JS SCORM runtime (`server/scorm/**`), без внешних
библиотек. Спецификация:
[docs/specs/prd-34/copy-protection.md](../specs/prd-34/copy-protection.md).

---

## Правила прогона и коммитов

- **Полный прогон тестов запрещён без явного разрешения владельца:** в одной рабочей копии
  одновременно работают несколько сессий. Во время работы — только точечно:
  `npm test -- <путь к файлу>`.
- **`npx vitest run` не работает** (падает на `initConfig()`), только `npm test -- <путь>`.
- **Индекс git общий на все сессии.** Коммитить ТОЛЬКО перечисленные в задаче пути и перед
  коммитом сверять состав: `git diff --cached --name-only`.
- Трейлер `Co-Authored-By` не добавлять.
- JSDoc — на английском, с `@module`; текст интерфейса и документы — на русском, без эмодзи.
- Работа ведётся в worktree `C:/Repositories/test-builder-prd34`, ветка
  `feat/prd34-copy-protection`. `npm install` в нём не выполнялся — сделать перед первым прогоном
  тестов.
- Разметка — только DS-классы (`ou-*`) и `tb-*` слоя проекта; проверенные в этом плане классы
  `ou-toast`, `ou-toast--info`, `ou-toast-stack`, `ou-toast__ico`, `ou-toast__body`,
  `ou-toast__title`, `ou-toast__desc`, `ou-empty`, `ou-empty--inline`, `ou-empty--horizontal`,
  `ou-empty__art`, `ou-empty__content`, `ou-empty__title` есть в `client/src/styles/vendor/university-rt.css`. Баннер ДС
  объявлен inline-уведомлением и тостом НЕ является — брать его для сообщений нельзя.

## Roadmap (требования спецификации → задачи плана)

| Этап | Требования PRD-34 | Задачи |
| --- | --- | --- |
| Э0 — эскизы | FR-20, FR-24 | Task 1 |
| Э1 — чистое ядро периметра | FR-06 — FR-09, FR-16 — FR-18, FR-30 | Task 2 |
| Э2 — применение к DOM | FR-10 — FR-13, FR-31 — FR-34 | Task 3 |
| Э3 — контракт рендерера | FR-30, FR-31 | Task 4 |
| Э4 — схема, сервисы, роуты | FR-01 — FR-05 | Task 5 |
| Э5 — редактор | FR-01, FR-02 | Task 6 |
| Э6 — веб-хост | FR-06 — FR-09, FR-16 | Task 7 |
| Э7 — SCORM-паритет и отладка | FR-18, FR-19, FR-25, FR-26 | Task 8 |
| Э8 — водяной знак на экранах | FR-16 — FR-19 | Task 9 |
| Э9 — скрытие при потере фокуса | FR-21 — FR-23 | Task 10 |
| Э10 — приёмка | AC-01 — AC-10 | Task 11 |

## Naming contract

Имена фиксируются здесь один раз; задачи ниже используют ИХ и никакие другие.

| Имя | Где объявлено | Что это |
| --- | --- | --- |
| `ProtectedScreen` | `shared/template/protection/spec.ts` | `"question" \| "review" \| "section-results" \| "results"` |
| `ProtectionSettings` | там же | `{ copyProtection, watermark, hideOnBlur }` — три поля теста |
| `WatermarkStamp` | там же | `{ id: string; at: Date }` |
| `RegionTarget` | там же | `{ selectors: string[]; wholeScene: boolean }` |
| `ProtectionSpec` | там же | `{ copy: RegionTarget \| null; hide: RegionTarget \| null; watermarkText: string \| null }` |
| `MARK_SLOT` | `shared/template/protection/watermark.ts` | `'[data-slot="protection-mark"]'` — якорь, объявляемый макетом (FR-16) |
| `QUESTION_REGIONS` | там же | перечень селекторов экрана вопроса (FR-06) |
| `buildProtectionSpec` | там же | построитель, принимает один объект-вход |
| `formatWatermarkText` | там же | `WatermarkStamp` → строка знака |
| `applyProtection` | `shared/template/protection/apply.ts` | применение `spec.copy` к DOM |
| `applyWatermark` | `shared/template/protection/watermark.ts` | слой знака |
| `attachBlurGuard` | `shared/template/protection/blur-guard.ts` | скрытие при потере фокуса |
| `PROTECTED_ATTR` | `apply.ts` | `"data-tb-protected"` |
| `copyProtection` / `protectionWatermark` / `protectionHideOnBlur` | `shared/schema.ts` | колонки `tests` |

---

## Task 1: Эскизы водяного знака и заглушки

Экранные элементы FR-20 и FR-24 без утверждённого эскиза не реализуются — это жёсткое правило
проекта. Задача блокирует Task 9 и Task 10, но НЕ блокирует Task 2 — Task 8.

**Files:**

- Create: `docs/wireframes/prd-34-protection.html`

- [ ] **Step 1: Взять существующий эскиз как основу разметки**

Открыть любой утверждённый эскиз ученического экрана в `docs/wireframes/` и скопировать его
скелет (эскизный фрейм + `wf-notes` + `wf-mapping`). В холсте — только реальный UI на DS-классах;
пояснения — в `wf-notes`, соответствие требованиям — в `wf-mapping`. Локальные `render-*` классы
запрещены.

- [ ] **Step 2: Нарисовать два состояния экрана вопроса**

Состояние 1 — водяной знак (FR-16, FR-17). Эскиз обязан показать ОБА размещения, иначе согласовано
будет только одно:

- экран вопроса — строка вида `ID 7f3ac2 · 02.08.2026 14:35` в просвете МЕЖДУ текстом задания и
  вариантами ответа: там макет объявляет якорь `[data-slot="protection-mark"]`. Диагональной
  плитки поверх содержимого нет, знак ничего не перекрывает;
- экран итогов теста — та же строка в начале сцены: якорь там не объявлен, работает запасное
  размещение.

Кегль знака на эскизе — фиксированный минимальный (в плане заложено 10 px при непрозрачности
0.35), одинаковый на обоих экранах. Он НЕ подчиняется автоподбору, которому подчиняются задание и варианты, и отдельного
места под себя не требует — встраивается в имеющийся просвет. На эскизе подтверждаются ровно два
параметра: этот кегль и контраст.

Состояние 2 — заглушка при потере фокуса (FR-21): регионы задания и вариантов закрыты, на их месте
сообщение «Задание скрыто, пока окно неактивно», БЕЗ кнопки: возврат автоматический. Шапка, счётчик
вопроса, прогресс и футер остаются видимыми — таймер идёт, попытка не прервана (FR-23).

- [ ] **Step 3: Снять скриншот эскиза**

Согласно принятому в проекте способу: `chrome-headless-shell.exe` + `http.server`, запускаемый из
КОРНЯ репозитория, копия снимка в `.playwright-mcp/`. Временные файлы в корень не класть.

- [ ] **Step 4: Отправить эскиз на согласование**

Показать владельцу продукта оба состояния. Без явного «принято» переходить к Task 9 и Task 10
нельзя. Task 2 — Task 8 можно выполнять параллельно.

- [ ] **Step 5: Commit**

```bash
git add docs/wireframes/prd-34-protection.html
git status --porcelain
git diff --cached --name-only
git commit -m "docs(prd-34): эскиз водяного знака и заглушки при потере фокуса"
```

---

## Task 2: Чистое ядро — построитель периметра

Единственное место, где перечислен периметр (FR-30). Без DOM, поэтому проверяется обычным юнит-тестом.

**Files:**

- Create: `shared/template/protection/spec.ts`
- Test: `shared/template/__tests__/protection-spec.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `shared/template/__tests__/protection-spec.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildProtectionSpec,
  formatWatermarkText,
  QUESTION_REGIONS,
} from "../protection/spec";

const ON = { copyProtection: true, watermark: false, hideOnBlur: false };
const STAMP = { id: "7f3ac2", at: new Date(2026, 7, 2, 14, 35) };

describe("buildProtectionSpec", () => {
  it("экран вопроса защищает поимённо перечисленные регионы", () => {
    const spec = buildProtectionSpec({ screen: "question", settings: ON, stamp: null });
    expect(spec.copy).toEqual({ selectors: [...QUESTION_REGIONS], wholeScene: false });
  });

  it("экран обзора защищает сцену целиком", () => {
    const spec = buildProtectionSpec({ screen: "review", settings: ON, stamp: null });
    expect(spec.copy).toEqual({ selectors: [], wholeScene: true });
  });

  it("экран итогов и итоги раздела от копирования не защищаются", () => {
    for (const screen of ["results", "section-results"] as const) {
      expect(buildProtectionSpec({ screen, settings: ON, stamp: null }).copy).toBeNull();
    }
  });

  it("незнакомый экран не защищается ничем", () => {
    const spec = buildProtectionSpec({ screen: "start", settings: ON, stamp: null });
    expect(spec.copy).toBeNull();
    expect(spec.hide).toBeNull();
    expect(spec.watermarkText).toBeNull();
  });

  it("выключенная настройка снимает защиту", () => {
    const settings = { ...ON, copyProtection: false };
    expect(buildProtectionSpec({ screen: "question", settings, stamp: null }).copy).toBeNull();
  });

  it("отладочный прогон снимает защиту и скрытие, но не знак", () => {
    const settings = { copyProtection: true, watermark: true, hideOnBlur: true };
    const spec = buildProtectionSpec({ screen: "question", settings, stamp: STAMP, active: false });
    expect(spec.copy).toBeNull();
    expect(spec.hide).toBeNull();
    expect(spec.watermarkText).toBe("ID 7f3ac2 · 02.08.2026 14:35");
  });

  it("скрытие при потере фокуса не зависит от защиты от копирования", () => {
    const settings = { copyProtection: false, watermark: false, hideOnBlur: true };
    const spec = buildProtectionSpec({ screen: "question", settings, stamp: null });
    expect(spec.copy).toBeNull();
    expect(spec.hide).toEqual({ selectors: [...QUESTION_REGIONS], wholeScene: false });
  });

  it("знак показывается на четырёх экранах, включая итоги теста", () => {
    const settings = { copyProtection: false, watermark: true, hideOnBlur: false };
    for (const screen of ["question", "review", "section-results", "results"] as const) {
      expect(buildProtectionSpec({ screen, settings, stamp: STAMP }).watermarkText).not.toBeNull();
    }
  });

  it("знак без идентификатора печатает только дату и время", () => {
    expect(formatWatermarkText({ id: "  ", at: new Date(2026, 7, 2, 9, 5) })).toBe("02.08.2026 09:05");
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npm test -- shared/template/__tests__/protection-spec.test.ts`
Expected: FAIL — `Cannot find module '../protection/spec'`.

- [ ] **Step 3: Написать минимальную реализацию**

Создать `shared/template/protection/spec.ts`:

```ts
/**
 * @module shared/template/protection/spec
 *
 * PRD-34 (FR-06, FR-08, FR-09, FR-16, FR-30): the ONE place that decides what a
 * learner screen protects, hides and stamps. Pure — no DOM and no host globals —
 * so the web host and the SCORM package derive the SAME decision from the same
 * inputs and the perimeter cannot drift between them.
 *
 * Two lists live here and are deliberately NOT derived from one another: the copy
 * perimeter (FR-06/FR-08) and the watermark screens (FR-16). The results screen
 * carries the mark but is not copy-protected.
 */

/** Learner screens the builder knows about; anything else is protected by nothing (FR-09). */
export type ProtectedScreen = "question" | "review" | "section-results" | "results";

/** The three per-test settings (FR-01) as the host delivers them. */
export interface ProtectionSettings {
  copyProtection: boolean;
  watermark: boolean;
  hideOnBlur: boolean;
}

/** Who a screenshot belongs to (FR-17, FR-18). Anonymised on purpose: no name, no email. */
export interface WatermarkStamp {
  /** Attempt id on the web host, `cmi.learner_id` in the package; may be empty. */
  id: string;
  /** The moment printed on the mark. */
  at: Date;
}

/** Where a measure applies: either named regions, or the whole scene (FR-08). */
export interface RegionTarget {
  selectors: string[];
  wholeScene: boolean;
}

/**
 * The render-time decision for one screen. `null` means "this measure does not apply here".
 * WHERE the mark goes is not decided here: the layout declares the anchor and the DOM pass
 * resolves it (FR-16), so no screen-to-position table exists to drift.
 */
export interface ProtectionSpec {
  copy: RegionTarget | null;
  hide: RegionTarget | null;
  watermarkText: string | null;
}

export interface BuildProtectionInput {
  /** Screen key; unknown values are legal and protect nothing. */
  screen: string;
  settings: ProtectionSettings;
  /** Absent ⇒ no mark can be drawn even when the setting is on. */
  stamp: WatermarkStamp | null;
  /** False in the PRD-18 debug run and the admin preview (FR-25). Default true. */
  active?: boolean;
}

/**
 * Core-owned region selectors of the question screen (FR-06). They address slots the
 * CORE fills and a context path the CORE binds — never template classes, so an
 * externally loaded template (PRD-3) is covered without declaring anything (FR-34).
 */
export const QUESTION_REGIONS: readonly string[] = [
  '[data-slot="question-text"]',
  '[data-slot="question-interaction"]',
  '[data-slot="question-feedback"]',
  '[data-slot="question-media"]',
  '[data-path="state.questionHint"]',
];

/**
 * Screens carrying the watermark (FR-16) — deliberately NOT derived from the copy
 * perimeter: the results screen wears the mark and is not copy-protected.
 */
const WATERMARK_SCREENS: readonly string[] = ["question", "review", "section-results", "results"];

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/**
 * Format the mark as «ID <id> · ДД.ММ.ГГГГ ЧЧ:ММ». An empty identifier (some LMS
 * return no `cmi.learner_id`) degrades to date and time — never to a blank gap (FR-18).
 */
export function formatWatermarkText(stamp: WatermarkStamp): string {
  const d = stamp.at;
  const when =
    pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  const id = stamp.id.trim();
  return id ? "ID " + id + " · " + when : when;
}

/** The bank-bearing screens: what a measure covers there. */
function targetFor(screen: string): RegionTarget | null {
  if (screen === "question") return { selectors: [...QUESTION_REGIONS], wholeScene: false };
  // FR-08: on the review screen the LAYOUT prints the prompt via `{{prompt}}`, so no
  // core-owned region exists to hook — and nothing but prompts and navigation lives there.
  if (screen === "review") return { selectors: [], wholeScene: true };
  return null;
}

export function buildProtectionSpec(input: BuildProtectionInput): ProtectionSpec {
  const active = input.active !== false;
  const target = targetFor(input.screen);
  // FR-19: the mark is NOT gated by `active` — the debug run shows it on purpose, so the
  // author sees what the learner will see.
  const showMark =
    input.settings.watermark &&
    input.stamp !== null &&
    WATERMARK_SCREENS.indexOf(input.screen) >= 0;
  return {
    copy: active && input.settings.copyProtection ? target : null,
    hide: active && input.settings.hideOnBlur ? target : null,
    watermarkText: showMark ? formatWatermarkText(input.stamp as WatermarkStamp) : null,
  };
}
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npm test -- shared/template/__tests__/protection-spec.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Проверить типы**

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
git add shared/template/protection/spec.ts shared/template/__tests__/protection-spec.test.ts
git diff --cached --name-only
git commit -m "feat(prd-34): построитель периметра защиты — единственный источник"
```

---

## Task 3: Применение защиты к DOM

Инлайн-свойства, слушатели и впрыснутое печатное правило (FR-10 — FR-13, FR-31 — FR-33).

**Files:**

- Create: `shared/template/protection/apply.ts`
- Test: `shared/template/__tests__/protection-apply.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `shared/template/__tests__/protection-apply.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { applyProtection, PROTECTED_ATTR } from "../protection/apply";
import { QUESTION_REGIONS } from "../protection/spec";

function scene(): HTMLElement {
  document.head.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML =
    '<h2 data-slot="question-text">Текст задания</h2>' +
    '<div data-slot="question-interaction"><label>Вариант</label></div>' +
    '<footer><button type="button">Далее</button></footer>';
  document.body.innerHTML = "";
  document.body.appendChild(root);
  return root;
}

const QUESTION_TARGET = { selectors: [...QUESTION_REGIONS], wholeScene: false };

describe("applyProtection", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = scene();
  });

  it("помечает регионы периметра и ставит инлайн-запрет выделения", () => {
    applyProtection(root, QUESTION_TARGET);
    const title = root.querySelector<HTMLElement>('[data-slot="question-text"]')!;
    expect(title.hasAttribute(PROTECTED_ATTR)).toBe(true);
    expect(title.style.userSelect).toBe("none");
  });

  it("не трогает то, что вне периметра", () => {
    applyProtection(root, QUESTION_TARGET);
    expect(root.querySelector("footer")!.hasAttribute(PROTECTED_ATTR)).toBe(false);
  });

  it("wholeScene помечает корень сцены", () => {
    applyProtection(root, { selectors: [], wholeScene: true });
    expect(root.hasAttribute(PROTECTED_ATTR)).toBe(true);
  });

  it("гасит copy внутри периметра и показывает предупреждение", () => {
    applyProtection(root, QUESTION_TARGET);
    const title = root.querySelector('[data-slot="question-text"]')!;
    const ev = new Event("copy", { bubbles: true, cancelable: true });
    title.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(root.querySelector(".ou-toast-stack")).not.toBeNull();
  });

  it("copy вне периметра не гасится и предупреждения не даёт", () => {
    applyProtection(root, QUESTION_TARGET);
    const ev = new Event("copy", { bubbles: true, cancelable: true });
    root.querySelector("footer")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(root.querySelector(".ou-toast-stack")).toBeNull();
  });

  it("гасит контекстное меню и перетаскивание, но молча", () => {
    applyProtection(root, QUESTION_TARGET);
    const title = root.querySelector('[data-slot="question-text"]')!;
    for (const type of ["contextmenu", "dragstart"]) {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      title.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
    expect(root.querySelector(".ou-toast-stack")).toBeNull();
  });

  it("впрыскивает печатное правило один раз", () => {
    applyProtection(root, QUESTION_TARGET);
    applyProtection(root, QUESTION_TARGET);
    const styles = document.head.querySelectorAll("style[data-tb-protection]");
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toContain("@media print");
  });

  it("снимает пометку и инлайн, когда защиты нет", () => {
    applyProtection(root, QUESTION_TARGET);
    applyProtection(root, null);
    const title = root.querySelector<HTMLElement>('[data-slot="question-text"]')!;
    expect(title.hasAttribute(PROTECTED_ATTR)).toBe(false);
    expect(title.style.userSelect).toBe("");
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npm test -- shared/template/__tests__/protection-apply.test.ts`
Expected: FAIL — `Cannot find module '../protection/apply'`.

- [ ] **Step 3: Написать минимальную реализацию**

Создать `shared/template/protection/apply.ts`:

```ts
/**
 * @module shared/template/protection/apply
 *
 * PRD-34 (FR-10 — FR-13, FR-31 — FR-33): applies the decision of
 * {@link module:shared/template/protection/spec} to a rendered scene.
 *
 * Selection is disabled with INLINE properties on purpose (FR-31): the runtime
 * itself prints inline styles elsewhere (font fitting, matching layout), so a rule
 * living in a stylesheet could be outranked — an inline property cannot be.
 *
 * The one CSS rule that inline cannot express — printing — is INJECTED into the
 * scene's root node (FR-33). A rule shipped inside a template file would be absent
 * from an externally loaded template (PRD-3); an injected one never is (FR-34).
 */

import type { RegionTarget } from "./spec";

/** Marks every element the measures cover. Print rule and listeners key off it. */
export const PROTECTED_ATTR = "data-tb-protected";

const STYLE_ATTR = "data-tb-protection";
const WIRED_ATTR = "data-tb-protection-wired";
/** DS toast stack — the design system owns both the look AND the position (fixed, bottom right). */
const TOAST_CLASS = "ou-toast-stack";
const TOAST_TITLE = "Копирование отключено";
const TOAST_DESC = "В этом тесте текст задания защищён от копирования.";
const TOAST_MS = 2500;

/** Info glyph for the toast; matches the stroke style used across the learner screens. */
const INFO_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/></svg>';

/**
 * The PRD-34 stylesheet: the print rule (FR-10.5, FR-12) plus the presentation of the
 * core-built elements (toast, watermark, veil). Scoped to core-owned class names, so it
 * cannot leak into a template's own markup — and it never touches the PDF report, whose
 * subtree carries no {@link PROTECTED_ATTR}.
 */
const PROTECTION_CSS = `
@media print { [${PROTECTED_ATTR}] { display: none !important; } }
/* The DS toast stack already positions itself; the only deviation is that our notice has no
   close button and fades on its own, so it must not intercept clicks. */
.${TOAST_CLASS} { pointer-events: none; }
/* FR-16: fixed minimal type — NOT the fitted --tb-question-fs/--tb-answer-fs tokens, so the
   mark never competes with the content for space and never changes size between screens. No
   margin and no padding: it shares the hint row the layout already has, so it costs the fixed
   stage no height of its own. Pushed to the right edge in both a flex row and a flex column. */
.tb-protection-mark { flex: 0 0 auto; margin: 0; margin-inline-start: auto;
  align-self: flex-end; padding: 0; white-space: nowrap;
  font-size: 10px; line-height: 1.2; letter-spacing: .02em;
  color: var(--ou-fg-muted); opacity: .35;
  pointer-events: none; user-select: none; -webkit-user-select: none; }
.tb-protection-veil { position: absolute; inset: 0; z-index: 35;
  /* Раскладку содержимого задаёт сам компонент ДС; вуаль только центрирует его,
     гасит фон и приглушает цвет, чтобы штатная разметка не спорила яркостью с тем,
     что она закрывает. */
  display: grid; place-items: center; padding: var(--ou-space-4);
  color: var(--ou-fg-muted); backdrop-filter: blur(8px);
  background: color-mix(in srgb, var(--ou-bg-surface-2) 80%, transparent); }
/* The glyph aligns with the text on the middle line and shrinks to line size: the stock 56 px
   art is meant for an empty PAGE area and next to a single heading line reads as a separate
   element rather than its icon. */
.tb-protection-veil .ou-empty { align-items: center; --_art-size: 22px; }
.tb-protection-veil .ou-empty__art { align-self: center; }
`;

/** Inject the stylesheet once per root node (document head or shadow root). */
function ensureStyle(root: HTMLElement): void {
  const rootNode = root.getRootNode() as Document | ShadowRoot;
  const host: ParentNode =
    (rootNode as Document).head ?? (rootNode as ShadowRoot) ?? root.ownerDocument.head;
  if ((host as ParentNode & { querySelector: ParentNode["querySelector"] })
      .querySelector(`style[${STYLE_ATTR}]`)) return;
  const style = root.ownerDocument.createElement("style");
  style.setAttribute(STYLE_ATTR, "");
  style.textContent = PROTECTION_CSS;
  host.appendChild(style);
}

/** Show the FR-13 notice. Only `copy`/`cut` produce it — a right click must stay quiet. */
function notify(root: HTMLElement): void {
  if (root.querySelector("." + TOAST_CLASS)) return;
  // `ou-toast`, not `ou-banner`: the DS calls the banner an INLINE notification and states it
  // is not a toast. The stack also supplies the position, so no placement of our own is invented.
  const el = root.ownerDocument.createElement("div");
  el.className = TOAST_CLASS;
  el.innerHTML =
    '<div class="ou-toast ou-toast--info" role="status">' +
    '<span class="ou-toast__ico" aria-hidden="true">' + INFO_ICON + "</span>" +
    '<div class="ou-toast__body"><div class="ou-toast__title"></div>' +
    '<div class="ou-toast__desc"></div></div></div>';
  (el.querySelector(".ou-toast__title") as HTMLElement).textContent = TOAST_TITLE;
  (el.querySelector(".ou-toast__desc") as HTMLElement).textContent = TOAST_DESC;
  root.appendChild(el);
  root.ownerDocument.defaultView?.setTimeout(() => el.remove(), TOAST_MS);
}

/** Is the event inside a region the core marked? Self-describing — no spec needed here. */
function inPerimeter(root: HTMLElement, target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  if (root.hasAttribute(PROTECTED_ATTR)) return root.contains(el);
  return el.closest("[" + PROTECTED_ATTR + "]") !== null;
}

/** Attach the four listeners once per scene root (idempotent across re-renders). */
function ensureListeners(root: HTMLElement): void {
  if (root.hasAttribute(WIRED_ATTR)) return;
  root.setAttribute(WIRED_ATTR, "");
  for (const type of ["copy", "cut", "contextmenu", "dragstart"]) {
    root.addEventListener(type, (ev: Event) => {
      if (!inPerimeter(root, ev.target)) return;
      ev.preventDefault();
      if (type === "copy" || type === "cut") notify(root);
    });
  }
}

function elementsOf(root: HTMLElement, target: RegionTarget): HTMLElement[] {
  if (target.wholeScene) return [root];
  const out: HTMLElement[] = [];
  for (const selector of target.selectors) {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => out.push(el));
  }
  return out;
}

function mark(el: HTMLElement): void {
  el.setAttribute(PROTECTED_ATTR, "");
  el.style.userSelect = "none";
  el.style.setProperty("-webkit-user-select", "none");
  // FR-27: the long-press callout on touch screens is a separate switch from selection.
  el.style.setProperty("-webkit-touch-callout", "none");
}

function unmark(el: HTMLElement): void {
  el.removeAttribute(PROTECTED_ATTR);
  el.style.removeProperty("user-select");
  el.style.removeProperty("-webkit-user-select");
  el.style.removeProperty("-webkit-touch-callout");
}

/**
 * Apply (or lift) copy protection on a freshly rendered scene.
 *
 * @param root   Scene container the host rendered into.
 * @param target What to protect; `null` lifts every mark this module placed.
 */
export function applyProtection(root: HTMLElement, target: RegionTarget | null): void {
  root.querySelectorAll<HTMLElement>("[" + PROTECTED_ATTR + "]").forEach(unmark);
  if (root.hasAttribute(PROTECTED_ATTR)) unmark(root);
  if (!target) return;
  ensureStyle(root);
  for (const el of elementsOf(root, target)) mark(el);
  ensureListeners(root);
}
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npm test -- shared/template/__tests__/protection-apply.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Проверить типы**

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
git add shared/template/protection/apply.ts shared/template/__tests__/protection-apply.test.ts
git diff --cached --name-only
git commit -m "feat(prd-34): применение защиты — инлайн, слушатели, впрыснутое правило печати"
```

---

## Task 4: Контракт рендерера

Ядро применяет защиту само, сразу после заполнения слотов (FR-31). Хосты передают одно поле.

**Files:**

- Modify: `shared/template/render-screen.ts:38-50` (интерфейс), `:152-157` (функция)
- Modify: `shared/template/runtime-entry.ts:25` (экспорт в глобал `TBTemplate`)
- Test: `shared/template/__tests__/protection-render.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `shared/template/__tests__/protection-render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderScreenInto } from "../render-screen";
import { buildProtectionSpec } from "../protection/spec";
import { PROTECTED_ATTR } from "../protection/apply";

const LAYOUT = '<div class="tb-scene"><h2 data-slot="question-text"></h2></div>';
const ON = { copyProtection: true, watermark: false, hideOnBlur: false };

describe("renderScreenInto + protection", () => {
  it("применяет защиту к слоту после его заполнения", () => {
    const root = document.createElement("div");
    renderScreenInto(root, {
      layout: LAYOUT,
      context: {},
      slots: { "question-text": "<b>Текст</b>" },
      protection: buildProtectionSpec({ screen: "question", settings: ON, stamp: null }),
    });
    const slot = root.querySelector<HTMLElement>('[data-slot="question-text"]')!;
    expect(slot.innerHTML).toBe("<b>Текст</b>");
    expect(slot.hasAttribute(PROTECTED_ATTR)).toBe(true);
  });

  it("без поля protection ничего не помечает", () => {
    const root = document.createElement("div");
    renderScreenInto(root, { layout: LAYOUT, context: {}, slots: { "question-text": "т" } });
    expect(root.querySelector("[" + PROTECTED_ATTR + "]")).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npm test -- shared/template/__tests__/protection-render.test.ts`
Expected: FAIL — у `ScreenRenderInput` нет поля `protection`.

- [ ] **Step 3: Расширить контракт рендерера**

В `shared/template/render-screen.ts` добавить импорты после строки 21:

```ts
import { applyProtection } from "./protection/apply";
import type { ProtectionSpec } from "./protection/spec";
```

В интерфейс `ScreenRenderInput` (после поля `content`) добавить:

```ts
  /**
   * PRD-34 (FR-30, FR-31): what this screen protects, hides and stamps. Built by the
   * SHARED builder in `protection/spec`; absent ⇒ nothing is protected, which is the
   * correct answer for every screen outside the perimeter (FR-09).
   */
  protection?: ProtectionSpec;
```

В функции `renderScreenInto` добавить последней строкой, ПОСЛЕ заполнения слотов и
плейсхолдеров (иначе разметка слота затрёт пометку):

```ts
  applyProtection(root, input.protection?.copy ?? null);
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npm test -- shared/template/__tests__/protection-render.test.ts`
Expected: PASS, 2 теста.

- [ ] **Step 5: Экспортировать ядро в бандл пакета**

В `shared/template/runtime-entry.ts` рядом со строкой `export { renderScreenInto } from "./render-screen";` добавить:

```ts
export { buildProtectionSpec, formatWatermarkText, QUESTION_REGIONS } from "./protection/spec";
export { applyProtection, PROTECTED_ATTR } from "./protection/apply";
```

- [ ] **Step 6: Прогнать существующий тест экспортов бандла**

Run: `npm test -- shared/template/__tests__/runtime-entry-exports.test.ts`
Expected: PASS. Если тест перечисляет ожидаемые экспорты явно — дописать в него четыре новых имени.

- [ ] **Step 7: Проверить типы**

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 8: Commit**

```bash
git add shared/template/render-screen.ts shared/template/runtime-entry.ts \
  shared/template/__tests__/protection-render.test.ts \
  shared/template/__tests__/runtime-entry-exports.test.ts
git diff --cached --name-only
git commit -m "feat(prd-34): поле protection в контракте рендерера, экспорт в TBTemplate"
```

---

## Task 5: Схема, миграция, сервисы и роуты

Три колонки и весь их серверный хвост (FR-01 — FR-05). Книга Excel в хвост НЕ входит — обоснование
в FR-04. Снимок публикации работы не требует: он хранит строку теста целиком.

**Files:**

- Modify: `shared/schema.ts` (после `showSectionResults`, строка ~438)
- Create: `migrations/038_prd34_copy_protection.sql`
- Modify: `server/routes/tests.ts:90-92`, `:593-595`, `:646-648`, `:903-905`, `:959-961`
- Modify: `server/services/test-settings.ts:182-183`, `:260-261`
- Modify: `server/routes/attempts.ts:54-59`

- [ ] **Step 1: Добавить колонки в схему**

В `shared/schema.ts`, сразу после `showSectionResults: boolean("show_section_results").notNull().default(true),`:

```ts
  // PRD-34 (FR-01): protection of the question text from casual copying. Default TRUE —
  // existing tests DO change behaviour, which is the accepted decision (FR-03), not a
  // side effect. A training test whose text is meant to be taken away turns it off.
  copyProtection: boolean("copy_protection").notNull().default(true),
  // PRD-34 (FR-16): anonymised watermark over the scene. Independent of copyProtection
  // (FR-02) — attribution is useful on its own. Default false.
  protectionWatermark: boolean("protection_watermark").notNull().default(false),
  // PRD-34 (FR-21): hide the task while the window is not active. Independent too.
  protectionHideOnBlur: boolean("protection_hide_on_blur").notNull().default(false),
```

- [ ] **Step 2: Написать миграцию**

Создать `migrations/038_prd34_copy_protection.sql` (если 038 уже занят соседним треком — взять
следующий свободный номер):

```sql
-- PRD-34 (2026-08-02): protection of the question text from copying (FR-01, FR-03).
-- Adds three independent boolean columns to `tests`:
--   * copy_protection      — the five measures over the perimeter. Default TRUE, and
--     EXISTING tests get it too: that is the accepted decision (FR-03), so there is no
--     backfill to false here. An author who needs the text copyable turns it off.
--   * protection_watermark — anonymised mark over the scene (FR-16). Default false.
--   * protection_hide_on_blur — hide the task on focus loss (FR-21). Default false.
--
-- The schema structure is the source of truth (applied via `drizzle-kit`). This file
-- documents the change and is safe to run directly: ADD COLUMN IF NOT EXISTS is idempotent.

BEGIN;

ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "copy_protection" boolean NOT NULL DEFAULT true;

ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "protection_watermark" boolean NOT NULL DEFAULT false;

ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "protection_hide_on_blur" boolean NOT NULL DEFAULT false;

COMMIT;
```

- [ ] **Step 3: Провести поля через роуты тестов**

В `server/routes/tests.ts` в `testBodyBaseSchema`, сразу после `showSectionResults: z.boolean().optional(),`:

```ts
  // PRD-34 (FR-01): настройки защиты от копирования.
  copyProtection: z.boolean().optional(),
  protectionWatermark: z.boolean().optional(),
  protectionHideOnBlur: z.boolean().optional(),
```

В ЧЕТЫРЁХ местах — деструктуризация создания (`~:593`), объект создания (`~:646`),
деструктуризация обновления (`~:903`) и объект `testSettingsService.save` (`~:959`) — добавить те же
три имени сразу после `showSectionResults`, повторяя ровно тот же стиль, что у соседей.

- [ ] **Step 4: Провести поля через сервис настроек**

В `server/services/test-settings.ts` в интерфейс payload, после `showSectionResults?: boolean;`:

```ts
  // PRD-34 (FR-01): настройки защиты от копирования.
  copyProtection?: boolean;
  protectionWatermark?: boolean;
  protectionHideOnBlur?: boolean;
```

В объект вставки, после `showSectionResults: payload.test.showSectionResults ?? true,`:

```ts
        // PRD-34 (FR-03): новый тест — защита ВКЛ по умолчанию.
        copyProtection: payload.test.copyProtection ?? true,
        protectionWatermark: payload.test.protectionWatermark ?? false,
        protectionHideOnBlur: payload.test.protectionHideOnBlur ?? false,
```

- [ ] **Step 5: Отдать настройки веб-клиенту**

В `server/routes/attempts.ts` в функцию `prd19RuntimeSettings` (строка 54) добавить после
`showSectionResults`:

```ts
    // PRD-34 (FR-01, FR-05): настройки защиты. Отсутствие поля в СТАРОМ снимке публикации
    // читается как умолчание — тест, опубликованный до PRD-34, получает защиту.
    copyProtection: test.copyProtection ?? true,
    protectionWatermark: test.protectionWatermark ?? false,
    protectionHideOnBlur: test.protectionHideOnBlur ?? false,
```

- [ ] **Step 6: Применить схему к dev-БД и проверить типы**

Перед работой с БД посмотреть `.env` — dev-база это Docker на `localhost:55432`, не системный
PostgreSQL на 5432.

Run: `npm run db:push`
Expected: три колонки добавлены.

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 7: Прогнать затронутые серверные тесты**

Run: `npm test -- server/__tests__`
Expected: PASS. Если какой-то тест сравнивает объект настроек целиком — дописать в ожидание три
новых поля.

- [ ] **Step 8: Commit**

```bash
git add shared/schema.ts migrations/038_prd34_copy_protection.sql \
  server/routes/tests.ts server/services/test-settings.ts server/routes/attempts.ts
git diff --cached --name-only
git commit -m "feat(prd-34): три настройки защиты в схеме, сервисе и роутах"
```

---

## Task 6: Редактор — блок «Защита»

Три переключателя без подчинённости между собой (FR-02).

**Files:**

- Modify: `client/src/features/tests/editor/test-editor.types.ts:422-430`
- Modify: `client/src/features/tests/editor/test-editor.mappers.ts:~89`, `:~914`, `:~1002`, `:~1075`
- Modify: `client/src/features/tests/editor/sections/basic-settings-section.tsx` (после блока PRD-19)

- [ ] **Step 1: Расширить модель редактора**

В `test-editor.types.ts`, в блок `runtime`, после `showSectionResults: boolean;`:

```ts
    // PRD-34: защита текста задания. Три независимых переключателя (FR-02).
    copyProtection: boolean; // FR-01, умолчание ВКЛ
    protectionWatermark: boolean; // FR-16, умолчание ВЫКЛ
    protectionHideOnBlur: boolean; // FR-21, умолчание ВЫКЛ
```

- [ ] **Step 2: Провести поля через мапперы**

В `test-editor.mappers.ts` три места, все рядом с уже существующими соседями:

Тип источника (около строки 89, рядом с `allowReturnToUnanswered?: boolean | null;`):

```ts
  copyProtection?: boolean | null;
  protectionWatermark?: boolean | null;
  protectionHideOnBlur?: boolean | null;
```

Пустая модель нового теста (около строки 919, после `showSectionResults: true,`):

```ts
      // PRD-34 (FR-03): новый тест — защита ВКЛ.
      copyProtection: true,
      protectionWatermark: false,
      protectionHideOnBlur: false,
```

Загрузка существующего теста (около строки 1015, после `showSectionResults`):

```ts
      // PRD-34 (FR-05): поля нет (тест до PRD-34) → умолчание, то есть защита ВКЛ.
      copyProtection:
        typeof src.copyProtection === "boolean" ? src.copyProtection : true,
      protectionWatermark:
        typeof src.protectionWatermark === "boolean" ? src.protectionWatermark : false,
      protectionHideOnBlur:
        typeof src.protectionHideOnBlur === "boolean" ? src.protectionHideOnBlur : false,
```

Сохранение (около строки 1077, после `showSectionResults: model.runtime.showSectionResults,`):

```ts
    copyProtection: model.runtime.copyProtection,
    protectionWatermark: model.runtime.protectionWatermark,
    protectionHideOnBlur: model.runtime.protectionHideOnBlur,
```

- [ ] **Step 3: Добавить блок «Защита» в настройки**

В `basic-settings-section.tsx`, в `PassRulesPane`, сразу ПОСЛЕ блока `showSectionResultsApplicable`
и ПЕРЕД `<hr className="wf-sep" />`, вставить:

```tsx
      <hr className="wf-sep" />

      <div className="ou-formfield">
        <Switch
          label="Защищать текст задания от копирования"
          description="На экране вопроса и на экране обзора текст не выделяется, не копируется, не перетаскивается и не печатается. В тестовом прогоне автора защита не действует."
          checked={model.runtime.copyProtection}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              runtime: { ...m.runtime, copyProtection: checked },
            }));
          }}
          data-testid="settings-copy-protection-checkbox"
        />
      </div>
      <div className="ou-formfield">
        <Switch
          label="Показывать водяной знак"
          description="Поверх экранов вопроса, обзора, итогов раздела и итогов теста печатается обезличенный идентификатор и время. Снимок экрана остаётся возможным, но становится атрибутируемым."
          checked={model.runtime.protectionWatermark}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              runtime: { ...m.runtime, protectionWatermark: checked },
            }));
          }}
          data-testid="settings-protection-watermark-checkbox"
        />
      </div>
      <div className="ou-formfield">
        <Switch
          label="Скрывать задание при уходе из окна"
          description="Если ученик переключился на другую вкладку, задание закрывается заглушкой до явного возврата. Таймер и ответы не затрагиваются."
          checked={model.runtime.protectionHideOnBlur}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              runtime: { ...m.runtime, protectionHideOnBlur: checked },
            }));
          }}
          data-testid="settings-protection-hide-on-blur-checkbox"
        />
      </div>
```

- [ ] **Step 4: Проверить типы**

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 5: Прогнать тесты редактора**

Run: `npm test -- client/src/features/tests/editor/__tests__`
Expected: PASS. Тест, сравнивающий пустую модель целиком, дополнить тремя полями.

- [ ] **Step 6: Проверить в браузере**

Поднять второй экземпляр, чтобы не мешать чужой сессии: `PORT=8099 npm run dev`. Открыть редактор
теста, вкладку настроек. Убедиться: три переключателя видны, умолчания у нового теста — ВКЛ, ВЫКЛ,
ВЫКЛ; сохранение и перезагрузка страницы значения сохраняют.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/tests/editor/test-editor.types.ts \
  client/src/features/tests/editor/test-editor.mappers.ts \
  client/src/features/tests/editor/sections/basic-settings-section.tsx
git diff --cached --name-only
git commit -m "feat(prd-34): блок «Защита» в настройках теста"
```

---

## Task 7: Веб-хост — проброс защиты на экраны попытки

**Files:**

- Modify: `client/src/components/template-screen.tsx:32-79` (props), `:274`, `:292` (вызовы)
- Modify: `client/src/pages/learner/take-test.tsx` (экран вопроса и экран обзора)

- [ ] **Step 1: Добавить проп в TemplateScreen**

В `client/src/components/template-screen.tsx` в `TemplateScreenProps` добавить:

```tsx
  /**
   * PRD-34 (FR-30): protection decision for this screen, built by the SHARED builder.
   * Absent ⇒ nothing is protected — the correct answer for previews and for screens
   * outside the perimeter (FR-09, FR-25).
   */
  protection?: ProtectionSpec;
```

и импорт:

```tsx
import type { ProtectionSpec } from "@shared/template/protection/spec";
```

Оба вызова `renderScreenInto` (строки 274 и 292) дополнить полем:

```tsx
      renderScreenInto(app ?? screen, { layout, context, slots, content, protection });
```

```tsx
      renderScreenInto(screen, { layout, context, slots, content, protection });
```

`protection` добавить в список зависимостей эффекта, если он там перечислен явно.

- [ ] **Step 2: Построить spec на экране вопроса и обзора**

В `client/src/pages/learner/take-test.tsx` найти места, где рисуются экран вопроса и экран обзора
через `TemplateScreen`. Рядом добавить построение:

```tsx
const protectionSettings = {
  copyProtection: runtime.copyProtection ?? true,
  watermark: runtime.protectionWatermark ?? false,
  hideOnBlur: runtime.protectionHideOnBlur ?? false,
};
const questionProtection = buildProtectionSpec({
  screen: "question",
  settings: protectionSettings,
  stamp: { id: attemptId.slice(0, 6), at: new Date() },
});
const reviewProtection = buildProtectionSpec({
  screen: "review",
  settings: protectionSettings,
  stamp: { id: attemptId.slice(0, 6), at: new Date() },
});
```

с импортом `import { buildProtectionSpec } from "@shared/template/protection/spec";` и передать
`protection={questionProtection}` / `protection={reviewProtection}` в соответствующие
`TemplateScreen`. `runtime` — объект настроек, который старт попытки уже отдаёт клиенту (Task 5,
шаг 5); идентификатор попытки укорачивается до шести знаков, чтобы знак читался на снимке.

- [ ] **Step 3: Проверить типы**

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 4: Проверить в браузере**

`PORT=8099 npm run dev`, войти учеником, начать тест с включённой защитой. Проверить руками:
текст задания и варианты не выделяются мышью; Ctrl+C даёт сообщение; правый клик меню не
открывает; вариант не перетаскивается в адресную строку; на экране обзора то же самое; на экране
итогов выделение РАБОТАЕТ. Выключить настройку — всё выделяется снова.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/template-screen.tsx client/src/pages/learner/take-test.tsx
git diff --cached --name-only
git commit -m "feat(prd-34): защита на экранах вопроса и обзора веб-хоста"
```

---

## Task 8: SCORM-паритет и отладочный прогон

**Files:**

- Modify: `server/scorm/builders/test-json.ts:~176` (запекание настроек)
- Modify: `server/scorm/build-export-data.ts` (признак `source: "debug"` → защита не активна)
- Modify: `server/scorm/template/app/render/mainRender.js:589` (вопрос), `:311` (обзор)
- Modify: `server/scorm/template/app/render/adaptiveRender.js:117` (адаптивный вопрос)

- [ ] **Step 1: Запечь настройки в TEST_DATA**

В `server/scorm/builders/test-json.ts`, после блока `showSectionResults`:

```ts
    // PRD-34 (FR-01, FR-26): настройки защиты для рантайма пакета. `protectionActive`
    // отдельным полем: в отладочном прогоне (source: "debug") защита и скрытие
    // выключены, а водяной знак остаётся (FR-19, FR-25).
    copyProtection: data.test.copyProtection ?? true,
    protectionWatermark: data.test.protectionWatermark ?? false,
    protectionHideOnBlur: data.test.protectionHideOnBlur ?? false,
    protectionActive: data.source !== "debug",
```

Если у `data` нет поля `source`, пробросить его из `buildScormExportData` в `ExportData` рядом с
остальными признаками сборки — это тот же признак, что уже управляет телеметрией отладки.

- [ ] **Step 2: Построить spec в рантайме пакета**

В `server/scorm/template/app/render/mainRender.js` рядом с рендером вопроса (строка ~589) заменить
вызов на:

```js
        TB.renderScreenInto(app, {
            layout: layout,
            context: context,
            slots: slots,
            protection: buildScormProtection('question')
        });
```

и добавить в тот же файл вспомогательную функцию (одну на весь рантайм — экспортировать её через
`window`, если файлы склеиваются плоско):

```js
/**
 * PRD-34 (FR-30): build the protection decision for a screen from the baked settings.
 * The identifier is the LMS learner id — anonymised on purpose (FR-17); an LMS that
 * returns none degrades to date and time inside the shared formatter (FR-18).
 */
function buildScormProtection(screen) {
    var TB = window.TBTemplate;
    if (!TB || !TB.buildProtectionSpec) return undefined;
    var id = '';
    try { id = (typeof SCORM !== 'undefined' ? SCORM.getValue('cmi.learner_id') : '') || ''; } catch (e) { id = ''; }
    return TB.buildProtectionSpec({
        screen: screen,
        settings: {
            copyProtection: TEST_DATA.copyProtection !== false,
            watermark: TEST_DATA.protectionWatermark === true,
            hideOnBlur: TEST_DATA.protectionHideOnBlur === true
        },
        stamp: { id: String(id), at: new Date() },
        active: TEST_DATA.protectionActive !== false
    });
}
```

- [ ] **Step 3: Подключить экран обзора и адаптивный вопрос**

`mainRender.js` строка ~311 (обзор):

```js
    TB.renderScreenInto(app, { layout: layout, context: context, protection: buildScormProtection('review') });
```

`adaptiveRender.js` строка ~117 (адаптивный вопрос) — добавить в объект вызова:

```js
    protection: buildScormProtection('question'),
```

- [ ] **Step 4: Пересобрать пакет и проверить**

«Пересобрать» здесь означает сборку рантайм-бандла `shared-runtime.js` — правки в `shared/` без неё
в пакет не попадают.

Run: `npm run scorm:sample`
Expected: пакет собран в `out/`.

Run: `npm run scorm:player`
Открыть плеер на `:5050`, пройти к экрану вопроса. Проверить: выделение не работает, Ctrl+C даёт
сообщение, экран обзора защищён, экран итогов — нет.

- [ ] **Step 5: Проверить отладочный прогон**

Открыть «Тестовый прогон» из меню действий теста (PRD-18). Убедиться: автор ВЫДЕЛЯЕТ и КОПИРУЕТ
текст своего вопроса — защита не действует (FR-25).

- [ ] **Step 6: Прогнать тесты сборки пакета**

Run: `npm test -- server/scorm/__tests__`
Expected: PASS. Тест, сверяющий форму `TEST_DATA`, дополнить четырьмя новыми полями.

- [ ] **Step 7: Commit**

```bash
git add server/scorm/builders/test-json.ts server/scorm/build-export-data.ts \
  server/scorm/template/app/render/mainRender.js \
  server/scorm/template/app/render/adaptiveRender.js \
  server/scorm/__tests__
git diff --cached --name-only
git commit -m "feat(prd-34): защита в пакете и её отключение в отладочном прогоне"
```

---

## Task 9: Водяной знак

Требует принятого эскиза из Task 1.

**Files:**

- Create: `shared/template/protection/watermark.ts`
- Test: `shared/template/__tests__/protection-watermark.test.ts`
- Modify: `shared/template/render-screen.ts` (вызов), `shared/template/runtime-entry.ts` (экспорт)
- Modify: `server/scorm/template/app/render/viewResults.js:274`, `:344`,
  `server/scorm/template/app/render/adaptiveRender.js:424`,
  `server/scorm/template/app/render/mainRender.js:439`
- Modify: `client/src/pages/learner/result.tsx`

- [ ] **Step 1: Написать падающий тест**

Создать `shared/template/__tests__/protection-watermark.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyWatermark } from "../protection/watermark";

const TEXT = "ID 7f3ac2 · 02.08.2026 14:35";

/** Макет, ОБЪЯВИВШИЙ якорь в просвете между заданием и вариантами. */
function sceneWithAnchor(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="scene"><header>шапка</header><div class="col">' +
    '<div class="q"><h2 data-slot="question-text">Задание</h2></div>' +
    '<div data-slot="protection-mark"></div>' +
    '<div class="body"><div data-slot="question-interaction">варианты</div></div>' +
    "</div></div>";
  return root;
}

/** Произвольный макет, якорь не объявивший: двухколоночная раскладка. */
function sceneWithoutAnchor(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="scene"><header>шапка</header><div class="row" style="display:flex">' +
    '<div class="left"><h2 data-slot="question-text">Задание</h2></div>' +
    '<div class="right"><div data-slot="question-interaction">варианты</div></div>' +
    "</div></div>";
  return root;
}

describe("applyWatermark", () => {
  it("встаёт в объявленный макетом якорь", () => {
    const root = sceneWithAnchor();
    applyWatermark(root, TEXT);
    const anchor = root.querySelector('[data-slot="protection-mark"]')!;
    const mark = anchor.querySelector<HTMLElement>(".tb-protection-mark")!;
    expect(mark.textContent).toBe(TEXT);
    expect(mark.getAttribute("aria-hidden")).toBe("true");
  });

  it("без якоря встаёт строкой в начало сцены и раскладку не трогает", () => {
    const root = sceneWithoutAnchor();
    applyWatermark(root, TEXT);
    const scene = root.firstElementChild!;
    expect(scene.firstElementChild!.className).toContain("tb-protection-mark");
    // Двухколоночная строка не получила третьей колонки.
    expect(root.querySelector(".row")!.children.length).toBe(2);
  });

  it("повторный вызов не задваивает знак", () => {
    const root = sceneWithAnchor();
    applyWatermark(root, "A");
    applyWatermark(root, "B");
    expect(root.querySelectorAll(".tb-protection-mark").length).toBe(1);
    expect(root.querySelector(".tb-protection-mark")!.textContent).toBe("B");
  });

  it("null снимает знак", () => {
    const root = sceneWithAnchor();
    applyWatermark(root, "A");
    applyWatermark(root, null);
    expect(root.querySelector(".tb-protection-mark")).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npm test -- shared/template/__tests__/protection-watermark.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Написать реализацию**

Создать `shared/template/protection/watermark.ts`:

```ts
/**
 * @module shared/template/protection/watermark
 *
 * PRD-34 (FR-16 — FR-19): the anonymised mark BUILT INTO the scene. A screenshot stays
 * possible — the browser gives no way to forbid it (spec §2.2) — but it becomes
 * attributable, and attribution is the working deterrent.
 *
 * The mark is a readable horizontal line, not a diagonal tile over the content: reading
 * the prompt is the learner's actual work and must not be obstructed.
 *
 * WHERE it goes is DECLARED by the layout — an empty `[data-slot="protection-mark"]`
 * anchor — and never guessed from the markup's shape. Guessing (walk up from the options
 * slot until an ancestor also holds the prompt) is correct only for a vertical layout; on
 * a two-column one the line becomes a third column and breaks it. Templates are arbitrary
 * (PRD-3), so a layout that declares nothing gets the fallback: a line at the start of the
 * scene. The mark never disappears — a missing mark is a silent loss of attribution.
 *
 * What the layout does NOT get is the mark's appearance: markup, type size and contrast
 * come from the core and its injected stylesheet (`protection/apply`). Otherwise a
 * template could render the attribution at 4 px or in the background colour and the
 * measure would exist only on paper.
 */

const MARK_CLASS = "tb-protection-mark";

/** The anchor a layout declares to place the mark itself (FR-16). */
export const MARK_SLOT = '[data-slot="protection-mark"]';

/**
 * Build (or lift) the watermark on a rendered scene.
 *
 * @param root Scene container the host rendered into.
 * @param text Prepared mark text; `null` removes the mark.
 */
export function applyWatermark(root: HTMLElement, text: string | null): void {
  root.querySelectorAll("." + MARK_CLASS).forEach((el) => el.remove());
  if (!text) return;
  const mark = root.ownerDocument.createElement("div");
  mark.className = MARK_CLASS;
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = text;
  const anchor = root.querySelector(MARK_SLOT);
  if (anchor) {
    anchor.appendChild(mark);
    return;
  }
  const scene = root.firstElementChild ?? root;
  scene.insertBefore(mark, scene.firstElementChild);
}
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npm test -- shared/template/__tests__/protection-watermark.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Подключить в рендерер и объявить якорь в поставляемом шаблоне**

В `shared/template/render-screen.ts` добавить импорт `import { applyWatermark } from "./protection/watermark";`
и строку после `applyProtection`:

```ts
  applyWatermark(root, input.protection?.watermarkText ?? null);
```

В `shared/template/runtime-entry.ts` добавить `export { applyWatermark, MARK_SLOT } from "./protection/watermark";`.

Объявить якорь во ВСЕХ четырёх макетах знака поставляемого шаблона (каталог
`server/scorm/templates/default/layouts/`) — одной и той же строкой:

```html
      <div data-slot="protection-mark"></div>
```

Места: `question.html` — между блоком задания `.tb-scene__q` и блоком ответов `.tb-qbody`;
`review.html`, `section-results.html`, `results.html` — первым элементом внутри `.tb-scene__col`,
под шапкой.

Запасное размещение (строка перед шапкой) поставляемому шаблону не достаётся ни на одном экране, и
это намеренно: на эскизе Task 1 видно, что перед шапкой строка читается как случайная надпись у
края кадра. Запасное размещение существует только для чужого шаблона, который якоря не объявил.

Знак встраивается в поток и позиционирования не требует, поэтому `position: relative` на корне ему
не нужен. Кегль в `PROTECTION_CSS` фиксированный (10 px) и подбору НЕ подлежит: соревноваться с
содержимым за место знак не должен. Единственное, что он занимает, — высота собственной строки,
около 13 px с учётом межстрочного; отступов у него нет. После включения проверить экран вопроса с
длинным заданием и большим числом вариантов: автоподбор (`fitQuestionScene`) обязан по-прежнему
укладывать сцену без обрезки. Если не укладывает — это дефект укладки сцены, а не повод менять
кегль знака, и тем более не повод править `theme.css` шаблона (FR-34).

- [ ] **Step 6: Передать spec на экраны итогов**

Экран итогов от копирования не защищается, но знак несёт (FR-16). Поэтому во ВСЕ перечисленные
места добавляется `protection: buildScormProtection('results')` (в пакете) и
`protection={buildProtectionSpec({ screen: "results", ... })}` (в вебе, `result.tsx`), а для
`mainRender.js:439` — `'section-results'`.

- [ ] **Step 6a: Показать наличие якоря в проверке шаблона (PRD-3)**

В проверке работоспособности шаблона (`smoke-bundle` / `smoke-test` админского реестра,
`server/routes/admin-templates.ts` + `client/src/features/templates/`) добавить информационную
строку: объявляет ли макет вопроса `[data-slot="protection-mark"]`. Отсутствие — НЕ ошибка и
загрузку не блокирует: знак просто встанет в начало сцены. Смысл строки в том, чтобы это
открывалось администратору при загрузке шаблона, а не участнику на приёмке.

- [ ] **Step 7: Проверить визуально на обоих хостах**

`PORT=8099 npm run dev` — веб; `npm run scorm:sample` + `npm run scorm:player` — пакет. Сверить
каждую деталь с принятым эскизом из Task 1, по обоим размещениям: на экране вопроса знак стоит в
объявленном якоре, между заданием и вариантами, и НИЧЕГО не перекрывает; на экране итогов, где
якоря нет, — строкой в начале сцены. Отдельно проверить произвольный шаблон без якоря (тот же, что
в Task 11, шаг 4): знак есть, раскладка цела.
Отдельно проверить, что кегль знака ОДИНАКОВ на коротком и на длинном задании — то есть автоподбор
его не трогает, — и что сцена с длинным заданием и большим числом вариантов не обрезана. Проверить,
что скачанный PDF-отчёт знака НЕ содержит.

- [ ] **Step 8: Commit**

```bash
git add shared/template/protection/watermark.ts \
  shared/template/__tests__/protection-watermark.test.ts \
  shared/template/render-screen.ts shared/template/runtime-entry.ts \
  client/src/pages/learner/result.tsx \
  server/scorm/template/app/render/viewResults.js \
  server/scorm/template/app/render/adaptiveRender.js \
  server/scorm/template/app/render/mainRender.js
git diff --cached --name-only
git commit -m "feat(prd-34): водяной знак на экранах попытки и итогов"
```

---

## Task 10: Скрытие при потере фокуса

Требует принятого эскиза из Task 1.

**Files:**

- Create: `shared/template/protection/blur-guard.ts`
- Test: `shared/template/__tests__/protection-blur-guard.test.ts`
- Modify: `shared/template/render-screen.ts`, `shared/template/runtime-entry.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `shared/template/__tests__/protection-blur-guard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachBlurGuard } from "../protection/blur-guard";
import { QUESTION_REGIONS } from "../protection/spec";

const TARGET = { selectors: [...QUESTION_REGIONS], wholeScene: false };

function scene(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = '<h2 data-slot="question-text">Текст</h2>';
  document.body.innerHTML = "";
  document.body.appendChild(root);
  return root;
}

function setHidden(value: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (value ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("attachBlurGuard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it("скрывает задание при уходе со вкладки немедленно", () => {
    const root = scene();
    attachBlurGuard(root, TARGET);
    setHidden(true);
    expect(root.querySelector(".tb-protection-veil")).not.toBeNull();
  });

  it("возврат видимости снимает заглушку сам, без действий участника", () => {
    const root = scene();
    attachBlurGuard(root, TARGET);
    setHidden(true);
    setHidden(false);
    expect(root.querySelector(".tb-protection-veil")).toBeNull();
  });

  it("возврат фокуса окну тоже снимает заглушку немедленно", () => {
    const root = scene();
    attachBlurGuard(root, TARGET);
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(400);
    expect(root.querySelector(".tb-protection-veil")).not.toBeNull();
    window.dispatchEvent(new Event("focus"));
    expect(root.querySelector(".tb-protection-veil")).toBeNull();
  });

  it("мгновенный возврат фокуса не скрывает ничего", () => {
    const root = scene();
    attachBlurGuard(root, TARGET);
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(1000);
    expect(root.querySelector(".tb-protection-veil")).toBeNull();
  });

  it("потеря фокуса дольше задержки скрывает задание", () => {
    const root = scene();
    attachBlurGuard(root, TARGET);
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(400);
    expect(root.querySelector(".tb-protection-veil")).not.toBeNull();
  });

  it("отсоединение снимает слушатели", () => {
    const root = scene();
    const detach = attachBlurGuard(root, TARGET);
    detach();
    setHidden(true);
    expect(root.querySelector(".tb-protection-veil")).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npm test -- shared/template/__tests__/protection-blur-guard.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Написать реализацию**

Создать `shared/template/protection/blur-guard.ts`:

```ts
/**
 * @module shared/template/protection/blur-guard
 *
 * PRD-34 (FR-21 — FR-23): hide the task while the window is not active. This does NOT
 * defend against a phone photographing the screen — that takes no focus away (spec §2.2).
 * It defends against the scenario the whole track starts from: carrying the prompt into a
 * search box in the next tab.
 *
 * `visibilitychange` is the primary signal. Window `blur` is secondary and DELAYED,
 * because inside an LMS frame it fires on every click on the surrounding page; an
 * immediate return cancels it, so an accidental click costs the learner nothing at all.
 *
 * The veil lifts BY ITSELF when the window is active again (FR-21): it explains, it does
 * not charge for the interruption.
 */

import type { RegionTarget } from "./spec";

const VEIL_CLASS = "tb-protection-veil";
const BLUR_DELAY_MS = 300;

/* FR-21: explanation only, no action. A button would charge the learner a click for every
   window switch — including the LMS's own popups — and the track introduces no penalties.
   The DS component for "this region is intentionally showing nothing, here is why" is
   `ou-empty` (with tones and an `--inline` size), not the banner, which the DS defines as an
   inline notification. */
   The compact form is deliberate: `--inline` + `--horizontal`, icon beside the text and no
   `__desc`. The veil covers a REGION two lines tall, not an empty page area — stacked
   vertically the illustration sits ABOVE the text and the block is clipped at the region's
   edge (verified on the wireframe). */
const VEIL_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M10.6 6.2A9 9 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.5 3"/>' +
  '<path d="M6.3 8.3A17 17 0 0 0 3 12s4 6 9 6a9 9 0 0 0 3.7-.8"/><path d="M3 3l18 18"/></svg>';

const VEIL_HTML =
  '<div class="ou-empty ou-empty--inline ou-empty--horizontal">' +
  '<span class="ou-empty__art" aria-hidden="true">' + VEIL_ICON + "</span>" +
  '<div class="ou-empty__content">' +
  '<p class="ou-empty__title">Задание скрыто, пока окно неактивно</p></div></div>';

function hosts(root: HTMLElement, target: RegionTarget): HTMLElement[] {
  if (target.wholeScene) return [root];
  const out: HTMLElement[] = [];
  for (const selector of target.selectors) {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => out.push(el));
  }
  return out;
}

/**
 * Wire the guard to a rendered scene.
 *
 * @param root   Scene container.
 * @param target What to cover; `null` wires nothing.
 * @returns Detach function — call it before re-rendering the scene.
 */
export function attachBlurGuard(root: HTMLElement, target: RegionTarget | null): () => void {
  if (!target) return () => undefined;
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  let timer: number | undefined;

  const reveal = (): void => {
    root.querySelectorAll("." + VEIL_CLASS).forEach((el) => el.remove());
  };

  const hide = (): void => {
    if (root.querySelector("." + VEIL_CLASS)) return;
    for (const host of hosts(root, target)) {
      if (view && view.getComputedStyle(host).position === "static") host.style.position = "relative";
      const veil = doc.createElement("div");
      veil.className = VEIL_CLASS;
      veil.setAttribute("role", "status");
      veil.innerHTML = VEIL_HTML;
      host.appendChild(veil);
    }
  };

  // Hiding is delayed (FR-22); revealing is not — a delay on the way back would read as
  // the page hanging.
  const onVisibility = (): void => {
    if (doc.visibilityState === "hidden") hide();
    else reveal();
  };
  const onBlur = (): void => {
    timer = view?.setTimeout(hide, BLUR_DELAY_MS);
  };
  const onFocus = (): void => {
    if (timer !== undefined) view?.clearTimeout(timer);
    timer = undefined;
    reveal();
  };

  doc.addEventListener("visibilitychange", onVisibility);
  view?.addEventListener("blur", onBlur);
  view?.addEventListener("focus", onFocus);

  return () => {
    if (timer !== undefined) view?.clearTimeout(timer);
    doc.removeEventListener("visibilitychange", onVisibility);
    view?.removeEventListener("blur", onBlur);
    view?.removeEventListener("focus", onFocus);
    reveal();
  };
}
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npm test -- shared/template/__tests__/protection-blur-guard.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Подключить в рендерер с отсоединением**

В `shared/template/render-screen.ts` хранить предыдущую функцию отсоединения на самом корне, чтобы
повторный рендер не наращивал слушателей:

```ts
  const holder = root as HTMLElement & { __tbBlurGuard?: () => void };
  holder.__tbBlurGuard?.();
  holder.__tbBlurGuard = attachBlurGuard(root, input.protection?.hide ?? null);
```

с импортом `import { attachBlurGuard } from "./protection/blur-guard";` и экспортом из
`runtime-entry.ts`.

- [ ] **Step 6: Проверить в браузере на обоих хостах**

`PORT=8099 npm run dev`: включить настройку, начать тест, переключиться на другую вкладку и
вернуться — задание закрыто заглушкой, таймер идёт, ответ не потерян, а по возврату во вкладку
заглушка снимается САМА, без действий участника. Кликнуть по
элементу вне рамки и сразу вернуться — заглушка НЕ появляется. Затем то же в пакете через
`npm run scorm:player`. Сверить вид заглушки с эскизом Task 1.

- [ ] **Step 7: Commit**

```bash
git add shared/template/protection/blur-guard.ts \
  shared/template/__tests__/protection-blur-guard.test.ts \
  shared/template/render-screen.ts shared/template/runtime-entry.ts
git diff --cached --name-only
git commit -m "feat(prd-34): скрытие задания при потере окном фокуса"
```

---

## Task 11: Приёмка

Проверяются ВСЕ критерии AC-01 — AC-10 спецификации. Юнит-тестов недостаточно: фронтенд
принимается в реальном браузере.

**Files:**

- Create: `docs/reports/ACCEPTANCE_PRD34.md`

- [ ] **Step 1: Запросить разрешение на полный прогон**

В рабочей копии одновременно работают несколько сессий. Спросить владельца и дождаться явного «да».
Только после этого: `npm test`, затем отдельно `npm run test:cov` (покрытие требует, чтобы прогон
шёл в одиночку). В отчёте прямо написать, выполнялся ли `test:cov`.

- [ ] **Step 2: Пройти AC-01 — AC-03 в браузере, оба хоста**

Веб: `PORT=8099 npm run dev`. Пакет: `npm run scorm:sample` + `npm run scorm:player`. По каждому
критерию — отдельная строка в отчёте с фактом, а не с намерением. Отдельно проверить AC-02: PDF-отчёт
при включённой защите формируется без искажений.

Там же — мобильное поведение (FR-27): в браузере включить эмуляцию сенсорного экрана и убедиться,
что долгое нажатие на тексте задания и на карточке варианта не даёт ни выделения, ни системной
всплывающей подсказки, а перетаскивание в сопоставлении и ранжировании продолжает работать.

- [ ] **Step 3: Пройти AC-04 — AC-06**

Отладочный прогон (защита снята, знак с заглушкой), водяной знак с пустым идентификатором (в плеере
подменить `cmi.learner_id` на пустую строку), скрытие при потере фокуса с проверкой ложного
срабатывания от клика по родительской странице.

- [ ] **Step 4: Пройти AC-07 — внешний шаблон**

Загрузить через админский реестр шаблонов (PRD-3) шаблон, не содержащий никаких правил PRD-34, и
убедиться, что защита действует в полном объёме. Это ключевая проверка конструкции: если она не
проходит, значит правило или пометка где-то зависят от шаблона.

- [ ] **Step 5: Пройти AC-08 — круг настроек**

Редактор → сохранение → публикация со снимком → сборка пакета → воспроизведение. Отдельно: снимок,
созданный ДО PRD-34 (взять существующий), читается по FR-05 и даёт защиту ВКЛ.

- [ ] **Step 6: Записать отчёт и границы**

В отчёте отдельным разделом зафиксировать AC-10: формулировка «текст скопировать нельзя» критерием
приёмки не является; против владельца ZIP мера не работает; WebTutor недоступен, поэтому проверка
пакета выполнена локальным плеером.

- [ ] **Step 7: Commit**

```bash
git add docs/reports/ACCEPTANCE_PRD34.md
git diff --cached --name-only
git commit -m "docs(prd-34): отчёт о приёмке защиты от копирования"
```

---

## Открытые места, которые всплывут при реализации

Перечислены здесь, чтобы исполнитель не принимал их молча.

- **Позиционирование заглушки.** Заглушка позиционируется абсолютно и требует
  `position: relative` на своём контейнере; решать это правкой `theme.css` НЕЛЬЗЯ (FR-34) — только
  инлайном из ядра, как сделано в `blur-guard`. Знака это не касается: он встроен в поток.
- **Высота фиксированного кадра.** Знак занимает высоту одной строки минимального кегля и ничего
  сверх того, но кадр всё же фиксированный. Проверять надо худший случай (длинное задание, много
  вариантов, узкое окно), а не типичный. Кегль знака при этом остаётся константой: если сцена не
  укладывается, чинится укладка, а не знак.
- **Экран обзора в вебе.** Если он рисуется не через `TemplateScreen`, а иначе, защиту всё равно
  ставит ядро — но проброс потребует отдельного места; найти его до Task 7, шага 2.
- **Плоская склейка рантайма пакета.** Файлы `server/scorm/template/app/**` склеиваются плоско, и
  `assets/app.js` идёт последним — дубль имени `buildScormProtection` перекроет реализацию. Имя
  объявлять ОДИН раз.
- **Печать в Shadow DOM.** Правило впрыскивается в корневой узел сцены; на веб-хосте это Shadow
  DOM. Проверить печать веб-экрана вопроса вживую (Ctrl+P) — если правило не применилось, впрыскивать
  дополнительно в `document.head`.
