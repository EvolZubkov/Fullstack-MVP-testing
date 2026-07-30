# План: ревизия шаблона «Сертификация» под модель стандартного шаблона

> **Для исполнителя-агента:** ОБЯЗАТЕЛЬНЫЙ ПОД-SKILL: использовать
> `superpowers:subagent-driven-development` (рекомендуется) либо
> `superpowers:executing-plans` для выполнения плана задача за задачей.
> Шаги оформлены чекбоксами (`- [ ]`) для отслеживания.

**Цель:** привести внешний шаблон `templates/certification` к действующему контракту
шаблонов — модель «сцена» на дизайн-системе, — сохранив RTK-палитру и брендовую
дизайн-специфику, и закрыть шаблон страховкой от повторного отставания.

**Архитектура:** раскладки «Сертификации» становятся побайтовыми копиями раскладок
стандартного шаблона (`server/scorm/templates/default/layouts/`), единственная
намеренная дельта разметки — брендовый надзаголовок на стартовом экране. Вся
дизайн-специфика уезжает в `styles/theme.css`: RTK-токены плюс декоративный слой
поверх сцены. Легаси-слой `styles/base.css` (48 КБ, фиксированная сцена 16:9 на
`cqh/cqw`) удаляется целиком. Расхождение раскладок с эталоном ловит юнит-тест.

**Технологии:** HTML-раскладки в DSL `shared/template/dsl.ts` (подмножество mustache),
CSS на токенах DS (`--ou-*`) и токенах шаблона (`--primary`, `--background`, …),
vitest для тестов, `npm run scorm:template` + `npm run scorm:player` для приёмки
пакета, живой браузер для приёмки веб-хоста.

---

## Контекст: что и почему сломалось

Шаблон написан 2026-07-05…07 под тогдашний контракт. После этого стандартный шаблон
прошёл ревизию на DS плюс модель «сцена» (коммиты `b23ea72`…`2fd4481`, 28-29 июля),
контракт сменился, «Сертификация» за ним не пошла. Проверенные последствия:

1. **Экран вопроса не проходится.** `renderStandardQuestion` привязывает кнопки
   навигации через `wireQuestionNav(app.querySelector('.tb-scene__foot'))`
   (`server/scorm/template/app/render/mainRender.js:621`). В
   `templates/certification/layouts/question.html` элемента `.tb-scene__foot` нет —
   строку навигации теперь строит РАСКЛАДКА из `state.nav`, а не рантайм. Кнопок
   «Назад»/«Пропустить»/«Ответить» на экране нет вообще.
2. **Карта вопросов мертва.** Рантайм слушает `.ou-quiz__dot[data-action]`
   (`mainRender.js:594`), раскладка «Сертификации» эмитит `.tb-pill`.
3. **Таймеры мертвы.** `revealSceneTimers(app)` ждёт DS-таймеры
   `#timer-display` + `#section-timer-display`; в раскладке один `div.q-timer`.
4. **Подгонка текста мертва.** `TB.fitQuestionScene` ищет `.tb-scene__body`,
   `.tb-scene__col`, `.tb-scene__q` — ни одного из них в раскладке нет.
5. **CSS-провал не закрывается фолбэком.** `styles-default.css` подкладывается только
   для НЕ объявленных шаблоном layout-ключей (`server/scorm/index.ts:432`).
   «Сертификация» объявляет все → `ou-*`-разметка получает только вендорный DS без
   темы и без сцены, а 48 КБ RTK-стилей висят на несуществующих классах: `.tb-pill` —
   24 правила, `.results-*` — 32, `.option` — 11, `.btn` — 11, `.question-card` — 5,
   `.matching-board`/`.ranking-board`. В стандартном `theme.css` этих селекторов 0.
6. **Две несовместимые системы размерности.** Стандартный: DS-токены, 0 вхождений
   `cqh/cqw` и `container-type`. «Сертификация»: 220 вхождений `cqh/cqw` внутри
   `container-type` сцены 16:9.
7. **`base.css` — помеченный техдолг.** `server/scorm/builders/ds-styles.ts:75,82`:
   «template's `theme.css` (+ `base.css` **until the layouts move to the scene
   model**)». У стандартного `base.css` уже удалён, всё сложено в `theme.css`.
8. **Манифест обещает несуществующее.** Описание: «Набор вариантов страниц совпадает
   со стандартным шаблоном — тест переключается между ними без переназначения
   страниц». Фактически у стандартного есть `start.image-right` и параметр
   `startImageUrl`, у «Сертификации» их нет.
9. **Прогресс-бар мёртв.** `scripts/template.js` обновляет `#tb-progress-fill`,
   которого в `shell.html` «Сертификации» нет.
10. **Мусор в манифесте.** 7 самоссылок в `layouts`
    (`"layouts/content.text.html": "layouts/content.text.html"`) — остаток от времён
    до резолвинга по `layoutFile` (`aaddeb1`).
11. **Дистрибутивный ZIP лежит внутри каталога шаблона.** `copyDirToFiles`
    (`server/scorm/builders/template-copy.ts:15`) копирует каталог рекурсивно БЕЗ
    фильтра, а `manifestHrefs` (`server/scorm/index.ts:401`) объявляет каждый файл
    ресурсом. То есть `certification-1.3.0.zip` (109 КБ) и `preview.html` (396 КБ)
    попадают внутрь каждого экспорта и объявляются в `imsmanifest.xml`.

**Решение пользователя (2026-07-30):** фиксированную сцену 16:9 НЕ сохраняем,
переходим на модель стандартного полностью. Сохраняется цветовая схема и
дизайн-специфика.

## Что считается «дизайн-спецификой» и сохраняется

| Специфика | Где сейчас | Куда переезжает |
| --- | --- | --- |
| RTK-палитра light + dark, `--primary: 15 100% 45%` (#E33A00), `--frame`, `--lock` | `styles/theme.css` | остаётся в `styles/theme.css` |
| Шрифт `Rostelecom Basis`, `--radius: 12px`, тёплая тень | `styles/theme.css` | остаётся |
| Надзаголовок «Сертификация» на обложке | `layouts/start.html:5` `.cover-eyebrow` | дельта разметки в `layouts/start.html` |
| Брендовая панель обложки с кольцом | `base.css:144-156` `.cover-brand`, `.cover-brand__ring` | CSS-слой в `theme.css`, без разметки |
| Оранжевые счётчики списков (кружок с номером, точка) | `base.css:432-435`, `599-602` | CSS-слой в `theme.css` |
| Тема-адаптивный scrim под авторским фоном | `base.css:560-566` `.has-slide-bg::before` | CSS-слой в `theme.css` |
| Оранжевый надзаголовок «Раздел завершён» | `base.css:352` | CSS-слой в `theme.css` |

Всё остальное в `base.css` — легаси-вёрстка снятой модели, удаляется.

---

## Структура файлов

**Изменяются:**

- `templates/certification/shell.html` — заменяется на оболочку стандартного
- `templates/certification/manifest.json` — `mountShell` убрать, `layouts` вычистить,
  добавить `startImageUrl` и `start.image-right`, `summary.result` без `layoutFile`
- `templates/certification/styles/theme.css` — RTK-токены + сцена + RTK-декор
- `templates/certification/layouts/*.html` — 17 файлов, копии стандартных
- `templates/certification/demo/course.json` — привести к набору маршрутов
- `templates/certification/preview.html` — перегенерировать (`npm run scorm:previews`)

**Создаются:**

- `templates/certification/layouts/start.image-right.html` — копия стандартного
- `server/scorm/__tests__/template-layout-parity.test.ts` — страховка от дрейфа

**Удаляются:**

- `templates/certification/styles/base.css` — легаси-слой снятой модели
- `templates/certification/layouts/summary.html` — у стандартного нет
- `templates/certification/styles.css.ejs` — устаревшая копия токенов
- `templates/certification/certification-1.3.0.zip` — дистрибутив внутри исходников

**Не трогаем:** `index.html.ejs` (побайтово совпадает со стандартным),
`scripts/template.js`, `preview.svg`.

---

## Фаза 0. Приёмочная база

### Задача 1: Зафиксировать дефект до правок

**Файлы:**

- Создать: `.playwright-mcp/cert-before/` (артефакты приёмки, вне git)

- [ ] **Шаг 1: Собрать пакет «Сертификации» на текущем коде**

```bash
npm run scorm:template -- ./templates/certification
```

Ожидается: в `out/` появляется zip пакета «Сертификации».

- [ ] **Шаг 2: Поднять плеер и открыть экран вопроса**

```bash
npm run scorm:player
```

Открыть `http://localhost:5050`, выбрать пакет «Сертификации», дойти до первого
вопроса.

Ожидается (это и есть дефект): под вопросом НЕТ кнопок навигации, карта вопросов не
реагирует на клик, таймер не показан. Снять скриншот в `.playwright-mcp/cert-before/`.

- [ ] **Шаг 3: Записать базовый вес пакета**

```bash
ls -l out/*.zip
unzip -l out/*.zip | grep -E "certification-1.3.0.zip|preview.html|\.ejs" | head
```

Ожидается: внутри пакета видны `template/certification-1.3.0.zip`,
`template/preview.html`, `template/styles.css.ejs`. Записать общий вес zip — после
правок он должен упасть примерно на 550 КБ.

- [ ] **Шаг 4: Зафиксировать зелёную базу тестов**

```bash
npm run check && npm test
```

Ожидается: `tsc` без ошибок, весь юнит-сьют зелёный, покрытие выше порога 80.
Если база уже красная — СТОП и доклад, не начинать правки.

### Задача 2: Зафиксировать структурную валидность до правок

**Файлы:**

- Изменить: нет (только чтение)

- [ ] **Шаг 1: Прогнать PRD-3 валидатор на текущем шаблоне**

Через админку шаблонов (`/author/templates`) загрузить
`templates/certification/certification-1.3.0.zip` как проверку, либо вызвать
`validateTemplatePackage` из `server/services/template-validation.ts` разовым
скриптом в каталоге для временных файлов.

Ожидается: 0 блокирующих. Это подтверждает, что дефект НЕ структурный, а
контрактный — валидатор его не видит, поэтому в Фазе 1 нужна отдельная страховка.

- [ ] **Шаг 2: Коммит базовых заметок не делаем**

Артефакты приёмки лежат в `.playwright-mcp/`, в git не идут. Переход к Фазе 1.

---

## Фаза 1. Страховка от дрейфа

Это ключевая задача плана: без неё «Сертификация» отстанет от стандартного при
следующей же ревизии. Тест пишется ДО правок и сначала падает.

### Задача 3: Тест паритета раскладок

**Файлы:**

- Создать: `server/scorm/__tests__/template-layout-parity.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

```typescript
/**
 * @module server/scorm/__tests__/template-layout-parity
 *
 * @description Guards external design templates against falling behind the
 * standard template's screen contract. The runtime binds behaviour to markup the
 * LAYOUT owns now (`.tb-scene__foot` nav row, `.ou-quiz__dot` map, DS timers,
 * `.tb-scene__col` fit targets), so a template whose layouts predate a revision
 * renders a dead screen while every structural validator stays green — exactly how
 * `certification` broke. Rule: an external template's layout is a BYTE-IDENTICAL
 * copy of the standard one, except for the deltas enumerated in INTENDED_DELTAS.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_LAYOUTS = path.join(REPO_ROOT, "server", "scorm", "templates", "default", "layouts");
const CERT_LAYOUTS = path.join(REPO_ROOT, "templates", "certification", "layouts");

/**
 * Layouts the certification template intentionally diverges on, with the exact
 * substitution applied to the standard source. Anything not listed here must match
 * byte for byte. Adding an entry is a DESIGN decision — it must be justified in
 * docs/plans/PLAN_CERTIFICATION_TEMPLATE_REVISION.md.
 */
const INTENDED_DELTAS: Record<string, { find: string; replace: string }[]> = {
  "start.html": [
    {
      find: '{{#if course.subtitle}}<span data-path="course.subtitle"></span>{{/if}}',
      replace:
        '<span class="tb-cover__brandline">Сертификация</span>\n              ' +
        '{{#if course.subtitle}}<span data-path="course.subtitle"></span>{{/if}}',
    },
  ],
};

/** Applies the intended deltas to the standard layout to get the expected cert layout. */
function expectedCertLayout(file: string, standard: string): string {
  const deltas = INTENDED_DELTAS[file] ?? [];
  return deltas.reduce((acc, d) => {
    expect(acc, `delta anchor missing in default/${file}`).toContain(d.find);
    return acc.replace(d.find, d.replace);
  }, standard);
}

describe("certification layouts track the standard template", () => {
  const standardFiles = fs.readdirSync(DEFAULT_LAYOUTS).filter((f) => f.endsWith(".html")).sort();

  it("declares every layout the standard template ships", () => {
    const certFiles = fs.readdirSync(CERT_LAYOUTS).filter((f) => f.endsWith(".html")).sort();
    expect(certFiles).toEqual(standardFiles);
  });

  for (const file of standardFiles) {
    it(`${file} matches the standard layout (modulo intended deltas)`, () => {
      const standard = fs.readFileSync(path.join(DEFAULT_LAYOUTS, file), "utf8");
      const cert = fs.readFileSync(path.join(CERT_LAYOUTS, file), "utf8");
      expect(cert).toBe(expectedCertLayout(file, standard));
    });
  }
});

describe("certification ships no layer of the retired fixed-stage model", () => {
  it("has no base.css", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "templates", "certification", "styles", "base.css"))).toBe(false);
  });

  it("uses no container-query units in theme.css", () => {
    const css = fs.readFileSync(
      path.join(REPO_ROOT, "templates", "certification", "styles", "theme.css"),
      "utf8",
    );
    expect(css).not.toMatch(/\d(cqh|cqw)\b/);
  });

  it("mounts the standard shell (no mountShell wrapper)", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "templates", "certification", "manifest.json"), "utf8"),
    );
    expect(manifest.mountShell).toBeUndefined();
  });
});
```

- [ ] **Шаг 2: Прогнать тест — он ДОЛЖЕН упасть**

```bash
npx vitest run server/scorm/__tests__/template-layout-parity.test.ts
```

Ожидается: падение. Как минимум: `declares every layout` (нет
`start.image-right.html`, лишний `summary.html`), каждый файл по содержимому,
`has no base.css`, `uses no container-query units`, `mounts the standard shell`.
Это фиксирует объём работ Фаз 2-4.

- [ ] **Шаг 3: Коммит красного теста**

```bash
git add server/scorm/__tests__/template-layout-parity.test.ts
git commit -m "test(templates): паритет раскладок «Сертификации» со стандартным шаблоном"
```

Красный тест коммитим намеренно: он и есть спецификация Фаз 2-4. Если в проекте
запрещено коммитить красное — объединить с Задачей 8 в один коммит.

---

## Фаза 2. Оболочка и стили

### Задача 4: Оболочка и прогресс-бар

**Файлы:**

- Изменить: `templates/certification/shell.html`
- Изменить: `templates/certification/manifest.json` (поле `mountShell`)

- [ ] **Шаг 1: Заменить оболочку на стандартную**

Записать в `templates/certification/shell.html` (отличие от стандартного — только
`data-template`):

```html
<div class="tb-player" data-template="certification">
  <div class="tb-progress-wrap">
    <div class="tb-progress-bar" id="tb-progress-fill"></div>
  </div>
  <main id="app" class="tb-content" data-slot="page" tabindex="-1"></main>
</div>
```

Это закрывает дефект 9: `scripts/template.js` ищет `#tb-progress-fill`, теперь он
есть, и параметр `showProgressBar` снова живой.

- [ ] **Шаг 2: Убрать `mountShell` из манифеста**

В `templates/certification/manifest.json` удалить строку:

```json
  "mountShell": true,
```

Флаг был нужен только фиксированной сцене 16:9: `applyTemplateShell()` в
`server/scorm/template/app/templateLoader.js` оборачивал `#app` структурой
`shell.html`. Со стандартной оболочкой пакет остаётся на базовом `.container > #app`,
как стандартный шаблон, — правила `.container > #app` в `theme.css` стандартного
(строки 87-95) рассчитаны именно на это.

- [ ] **Шаг 3: Проверить, что тест оболочки позеленел**

```bash
npx vitest run server/scorm/__tests__/template-layout-parity.test.ts -t "mounts the standard shell"
```

Ожидается: PASS.

- [ ] **Шаг 4: Коммит**

```bash
git add templates/certification/shell.html templates/certification/manifest.json
git commit -m "fix(templates): «Сертификация» на стандартной оболочке, живой прогресс-бар"
```

### Задача 5: Собрать `theme.css` — токены плюс сцена

**Файлы:**

- Изменить: `templates/certification/styles/theme.css`

- [ ] **Шаг 1: Дописать в `theme.css` слой сцены из стандартного**

Существующий блок RTK-токенов (строки 1-81, три палитры: `:root`, media-query dark,
`:root[data-theme="dark"]`) сохранить БЕЗ ИЗМЕНЕНИЙ — это и есть цветовая схема.
Ниже него вставить полное содержимое
`server/scorm/templates/default/styles/theme.css`, начиная со строки, следующей за
его собственным блоком токенов.

```bash
# Посмотреть, где у стандартного заканчиваются токены и начинается сцена
grep -n "^\.container\|^:root" server/scorm/templates/default/styles/theme.css | head
```

Порядок в файле критичен: сначала RTK-токены, затем слой сцены, который эти токены
потребляет. Токены стандартного НЕ переносить — их перебивает RTK-палитра.

- [ ] **Шаг 2: Убедиться, что в перенесённом слое нет своих токенов**

```bash
grep -n "^\s*--\(background\|foreground\|primary\|card\|border\|muted\|accent\|destructive\|success\|font-sans\|radius\|shadow\):" templates/certification/styles/theme.css
```

Ожидается: совпадения только внутри трёх RTK-блоков палитры (строки до 81).
Если токен объявлен ниже — удалить его из перенесённого слоя.

- [ ] **Шаг 3: Проверить отсутствие container-query единиц**

```bash
grep -c "cqh\|cqw" templates/certification/styles/theme.css
```

Ожидается: `0`.

- [ ] **Шаг 4: Коммит**

```bash
git add templates/certification/styles/theme.css
git commit -m "feat(templates): «Сертификация» — слой сцены поверх RTK-токенов"
```

### Задача 6: Перенести RTK-декор и удалить `base.css`

**Файлы:**

- Изменить: `templates/certification/styles/theme.css`
- Удалить: `templates/certification/styles/base.css`
- Изменить: `templates/certification/manifest.json` (`assets.styles`)
- Удалить: `templates/certification/styles.css.ejs`

- [ ] **Шаг 1: Дописать RTK-декор в конец `theme.css`**

Ровно четыре блока — только то, что в таблице «дизайн-специфики». Всё на DS-токенах,
без `cqh/cqw`:

```css
/* ── RTK decorative layer over the standard scene ──────────────────────────── */

/* Brand line above the cover title: the RTK «Сертификация» framing. */
.tb-cover__brandline {
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: hsl(var(--primary));
}

/* Cover brand panel: when the author supplied no start image, the right column is a
   brand plate with the RTK ring instead of an empty gap. Pure CSS — the layout stays
   byte-identical to the standard one. */
.tb-cover:not(.tb-cover--media)::after {
  content: "";
  align-self: stretch;
  min-width: 30%;
  border-radius: var(--radius);
  background: linear-gradient(140deg, hsl(var(--primary)) 0%, hsl(var(--primary) / .82) 100%);
  box-shadow: inset -6rem -7rem 0 -5.6rem hsl(0 0% 100% / .16);
}

/* Ordered/unordered lists inside author rich text: RTK orange numbered circles and
   dots instead of the browser markers. */
.tb-content__body ol,
.tb-scene__note ol { counter-reset: tb-step; list-style: none; padding-left: 2.25rem; }
.tb-content__body ol > li,
.tb-scene__note ol > li { counter-increment: tb-step; position: relative; }
.tb-content__body ol > li::before,
.tb-scene__note ol > li::before {
  content: counter(tb-step);
  position: absolute;
  left: -2.25rem;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: .8125rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tb-content__body ul,
.tb-scene__note ul { list-style: none; padding-left: 2.25rem; }
.tb-content__body ul > li,
.tb-scene__note ul > li { position: relative; }
.tb-content__body ul > li::before,
.tb-scene__note ul > li::before {
  content: "";
  position: absolute;
  left: -1.5rem;
  top: .6em;
  width: .4375rem;
  height: .4375rem;
  border-radius: 50%;
  background: hsl(var(--primary));
}

/* Theme-adaptive scrim over an author background image. The heading/footer text
   follows the THEME, so a light author image under light text (dark theme) would be
   invisible. The scrim (theme background at 82%) guarantees contrast in BOTH themes
   while the image still shows through. */
.tb-scene.has-slide-bg { position: relative; background-size: cover; background-position: center; }
.tb-scene.has-slide-bg::before {
  content: "";
  position: absolute;
  inset: 0;
  background: hsl(var(--background) / .82);
  z-index: 0;
}
.tb-scene.has-slide-bg > * { position: relative; z-index: 1; }
```

- [ ] **Шаг 2: Удалить `base.css` и убрать его из манифеста**

```bash
git rm templates/certification/styles/base.css
```

В `templates/certification/manifest.json` заменить:

```json
    "styles": [
      "styles/theme.css",
      "styles/base.css"
    ],
```

на:

```json
    "styles": [
      "styles/theme.css"
    ],
```

Гоча приёмки (уже ловилась на стандартном шаблоне): если манифест продолжает
объявлять удалённый `styles/base.css`, `template-validation` падает на проверке
существования ссылок — блокирующая ошибка `MISSING_FILE`.

- [ ] **Шаг 3: Удалить устаревший `styles.css.ejs`**

```bash
git rm templates/certification/styles.css.ejs
```

Файл объявляет свой набор токенов (`--muted-foreground: 220 6% 42%`, `--success: 120
44% 37%`), который противоречит `theme.css` и не содержит новых токенов (`--frame`,
`--lock`). Пакет его не использует: стилевая сборка идёт через
`assemblePackageStyles(readVendorDsCss(), readStyle("theme.css"), readStyle("base.css"))`
(`server/scorm/index.ts:418`), палитра параметров — через
`shared/template/params-css.ts`.

- [ ] **Шаг 4: Проверить тесты стилей**

```bash
npx vitest run server/scorm/__tests__/template-layout-parity.test.ts -t "retired fixed-stage"
```

Ожидается: три теста блока PASS (`has no base.css`, `uses no container-query units`,
`mounts the standard shell`).

- [ ] **Шаг 5: Коммит**

```bash
git add -A templates/certification
git commit -m "refactor(templates): «Сертификация» — RTK-декор в theme.css, base.css удалён"
```

---

## Фаза 3. Раскладки

### Задача 7: Заменить раскладки копиями стандартных

**Файлы:**

- Изменить: 16 файлов `templates/certification/layouts/*.html`
- Создать: `templates/certification/layouts/start.image-right.html`
- Удалить: `templates/certification/layouts/summary.html`

- [ ] **Шаг 1: Скопировать все стандартные раскладки поверх**

```bash
cp server/scorm/templates/default/layouts/*.html templates/certification/layouts/
git rm templates/certification/layouts/summary.html
```

После этого в каталоге ровно 17 файлов: `content.html`, `content.image-left.html`,
`content.image-right.html`, `content.text.html`, `gallery.image-left.html`,
`gallery.image-right.html`, `gallery.text.html`, `question.html`,
`results.adaptive.html`, `results.html`, `review.html`, `section-intro.html`,
`section-results.html`, `start.html`, `start.image-right.html`,
`system.blocked.html`, `system.transition.html`.

- [ ] **Шаг 2: Проверить состав каталога**

```bash
diff <(ls server/scorm/templates/default/layouts/) <(ls templates/certification/layouts/)
```

Ожидается: пустой вывод.

- [ ] **Шаг 3: Прогнать тест паритета**

```bash
npx vitest run server/scorm/__tests__/template-layout-parity.test.ts
```

Ожидается: PASS по составу каталога и по всем файлам, КРОМЕ `start.html` — он ждёт
дельту брендового надзаголовка (Задача 8).

- [ ] **Шаг 4: Коммит**

```bash
git add -A templates/certification/layouts
git commit -m "refactor(templates): раскладки «Сертификации» = раскладки стандартного шаблона"
```

### Задача 8: Дельта обложки — брендовый надзаголовок

**Файлы:**

- Изменить: `templates/certification/layouts/start.html:9-12`

- [ ] **Шаг 1: Добавить брендовую строку в надзаголовок обложки**

В `templates/certification/layouts/start.html` найти:

```html
            <div class="tb-cover__eyebrow">
              {{#if course.subtitle}}<span data-path="course.subtitle"></span>{{/if}}
              {{#if state.exhausted}}<span class="ou-tag ou-tag--neutral">Попытки исчерпаны</span>{{/if}}
            </div>
```

заменить на:

```html
            <div class="tb-cover__eyebrow">
              <span class="tb-cover__brandline">Сертификация</span>
              {{#if course.subtitle}}<span data-path="course.subtitle"></span>{{/if}}
              {{#if state.exhausted}}<span class="ou-tag ou-tag--neutral">Попытки исчерпаны</span>{{/if}}
            </div>
```

Почему это единственная дельта разметки: `course.subtitle` уже занят — рантайм
подставляет туда «Попытка N из M» (`scormCourseSubtitle`, `mainRender.js:517`),
поэтому статичное брендовое слово нельзя выразить данными. Остальная
дизайн-специфика («брендовая панель», «оранжевые списки», «scrim») выражена в
`theme.css` без правки разметки — Задача 6.

- [ ] **Шаг 2: Прогнать полный тест паритета — должен позеленеть весь**

```bash
npx vitest run server/scorm/__tests__/template-layout-parity.test.ts
```

Ожидается: все тесты PASS. Если `start.html` всё ещё красный — расхождение в отступах:
подставляемый в `INTENDED_DELTAS` фрагмент содержит `\n` плюс 14 пробелов, проверить
фактический отступ в стандартном файле.

- [ ] **Шаг 3: Коммит**

```bash
git add templates/certification/layouts/start.html
git commit -m "feat(templates): брендовый надзаголовок «Сертификация» на обложке"
```

---

## Фаза 4. Манифест

### Задача 9: Синхронизировать манифест со стандартным

**Файлы:**

- Изменить: `templates/certification/manifest.json`

- [ ] **Шаг 1: Добавить параметр `startImageUrl`**

В массив `params`, после `logoUrl`, вставить (значения взять из стандартного
манифеста `server/scorm/templates/default/manifest.json`, чтобы подписи в редакторе
совпадали):

```bash
node -e "
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('server/scorm/templates/default/manifest.json','utf8'));
console.log(JSON.stringify(d.params.find(p=>p.key==='startImageUrl'),null,2));
"
```

Вставить выведенный объект в `params` «Сертификации» на позицию после `logoUrl`.

- [ ] **Шаг 2: Добавить вариант старта `start.image-right`**

Аналогично взять описание из стандартного и вставить в `contentTemplates` сразу
после `start.standard`:

```bash
node -e "
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('server/scorm/templates/default/manifest.json','utf8'));
console.log(JSON.stringify(d.contentTemplates.find(t=>t.key==='start.image-right'),null,2));
"
```

Это закрывает дефект 8: описание шаблона обещает совпадение набора вариантов
страниц со стандартным, чтобы тест переключался между шаблонами без переназначения.

- [ ] **Шаг 3: Убрать `layoutFile` у `summary.result`**

В `contentTemplates` у записи `summary.result` удалить строку:

```json
      "layoutFile": "layouts/summary.html",
```

У стандартного `summary.result` объявлен без `layoutFile` — страница собирается
скелетом контентной страницы по placeholder'ам. Раскладка `layouts/summary.html`
удалена в Задаче 7.

- [ ] **Шаг 4: Вычистить самоссылки из `layouts`**

Удалить из объекта `layouts` семь записей вида «ключ равен значению»:

```json
    "layouts/content.text.html": "layouts/content.text.html",
    "layouts/content.image-left.html": "layouts/content.image-left.html",
    "layouts/content.image-right.html": "layouts/content.image-right.html",
    "layouts/gallery.text.html": "layouts/gallery.text.html",
    "layouts/gallery.image-left.html": "layouts/gallery.image-left.html",
    "layouts/gallery.image-right.html": "layouts/gallery.image-right.html",
    "layouts/summary.html": "layouts/summary.html"
```

Остаётся ровно тот же набор ключей, что у стандартного: `shell`, `start`, `content`,
`question`, `results`, `results.adaptive`, `review`, `section-results`,
`section-intro`, `system.blocked`, `system.transition`. Контентные раскладки
резолвятся по `layoutFile` варианта (коммит `aaddeb1`).

- [ ] **Шаг 5: Сверить наборы ключей с эталоном**

```bash
node -e "
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('server/scorm/templates/default/manifest.json','utf8'));
const c=JSON.parse(fs.readFileSync('templates/certification/manifest.json','utf8'));
const cmp=(n,a,b)=>{const oa=a.filter(x=>!b.includes(x)),ob=b.filter(x=>!a.includes(x));
  console.log(n, oa.length||ob.length ? {'только в стандартном':oa,'только в cert':ob} : 'совпадают');};
cmp('params:', d.params.map(p=>p.key), c.params.map(p=>p.key));
cmp('contentTemplates:', d.contentTemplates.map(t=>t.key), c.contentTemplates.map(t=>t.key));
cmp('layouts:', Object.keys(d.layouts), Object.keys(c.layouts));
console.log('mountShell:', c.mountShell === undefined ? 'убран' : 'ОСТАЛСЯ');
console.log('assets.styles:', JSON.stringify(c.assets.styles));
"
```

Ожидается: `params: совпадают`, `contentTemplates: совпадают`,
`layouts: совпадают`, `mountShell: убран`, `assets.styles: ["styles/theme.css"]`.

- [ ] **Шаг 6: Поднять версию и обновить описание**

В `templates/certification/manifest.json`:

```json
  "version": "1.4.0",
```

Описание переписать так, чтобы оно не обещало снятую фиксированную сцену:

```json
  "description": "Сертификационный тест РТК: брендовая палитра Ростелекома (светлая и тёмная) с переопределяемыми цветами, оранжевый акцент, страница-роутер, кнопки навигации, пропуск и возврат к неотвеченным, экран обзора. Набор вариантов страниц совпадает со стандартным шаблоном — тест переключается между ними без переназначения страниц.",
```

- [ ] **Шаг 7: Прогнать типы и весь сьют**

```bash
npm run check && npm test
```

Ожидается: `tsc` чист, сьют зелёный, покрытие выше 80. Порог покраснел — СТОП и
доклад, покрытие вне кода задачи не поднимать.

- [ ] **Шаг 8: Коммит**

```bash
git add templates/certification/manifest.json
git commit -m "feat(templates): манифест «Сертификации» 1.4.0 в паритете со стандартным"
```

---

## Фаза 5. Демо и превью

### Задача 10: Демо-данные и офлайн-превью

**Файлы:**

- Изменить: `templates/certification/demo/course.json`
- Изменить: `templates/certification/preview.html` (генерируется)
- Изменить: `templates/certification/manifest.json` (`preview.routes`)

- [ ] **Шаг 1: Привести маршруты превью к новому набору вариантов**

В `preview.routes` манифеста «Сертификации»: удалить маршрут `content.summary`
(вариант остался, но страница у стандартного собирается скелетом; у стандартного
этого маршрута нет — коммит `cf7cf96` вывел `content.summary` из smoke-набора) и
добавить маршрут варианта старта, как это сделано у стандартного:

```bash
node -e "
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('server/scorm/templates/default/manifest.json','utf8'));
console.log(JSON.stringify(d.preview.routes.filter(r=>r.route.startsWith('start')),null,2));
"
```

Вставить выведенные записи вместо текущей одиночной записи `start`. Остальные
маршруты «Сертификации» (галерея, info-варианты, роутер, `results.adaptive`,
`system.transition`) сохранить — они покрывают варианты, которых у стандартного в
превью нет, и это полезнее.

- [ ] **Шаг 2: Дополнить демо-данные полями, которых требуют новые раскладки**

В `templates/certification/demo/course.json` убедиться, что заданы поля, которые
читает обложка стандартного: `questionCount`, `passPercent`, `timeLimitMinutes`,
`maxAttempts`, `startPageContent`, `description`. Без них блок фактов на обложке
пуст. Удалить страницу `demo-summary`, если она осталась после удаления маршрута.

```bash
node -e "
const c=JSON.parse(require('fs').readFileSync('templates/certification/demo/course.json','utf8'));
const need=['questionCount','passPercent','timeLimitMinutes','maxAttempts','startPageContent','description'];
console.log('есть :', need.filter(k=>c[k]!==undefined && c[k]!==null));
console.log('НЕТ  :', need.filter(k=>c[k]===undefined || c[k]===null));
"
```

Ожидается на выходе: список «НЕТ» пуст. Значения брать осмысленные для РТК-теста
(«Сертификационный тест для руководителей», 6 разделов) — демо-контент не выдумывать
за пределами уже описанного в `demo/course.json`.

- [ ] **Шаг 3: Перегенерировать превью**

```bash
npm run scorm:previews
```

Ожидается: перезаписаны `templates/certification/preview.html` и
`server/scorm/templates/default/preview.html`. Генератор сканирует и корневой
`templates/`, обхода через `server/scorm/templates/` не требуется.

- [ ] **Шаг 4: Открыть превью и пройти по маршрутам**

Открыть `templates/certification/preview.html` в браузере. Пройти по всем маршрутам
из рельса.

Ожидается: на каждом экране сцена (шапка, тело, подвал), RTK-оранжевый акцент,
брендовый надзаголовок «Сертификация» на обложке, оранжевые кружки нумерованных
списков. Ни одного экрана без стилей.

- [ ] **Шаг 5: Коммит**

```bash
git add templates/certification/manifest.json templates/certification/demo/course.json templates/certification/preview.html
git commit -m "chore(templates): демо и превью «Сертификации» под модель сцены"
```

---

## Фаза 6. Приёмка

### Задача 11: Приёмка SCORM-пакета

**Файлы:**

- Изменить: нет

- [ ] **Шаг 1: Собрать пакет в светлой и тёмной палитре**

```bash
npm run scorm:template -- ./templates/certification
npm run scorm:template -- ./templates/certification --theme dark
```

Ожидается: обе сборки без ошибок.

- [ ] **Шаг 2: Проверить, что пакет похудел**

```bash
ls -l out/*.zip
unzip -l out/*.zip | grep -E "certification-1\.[34]\.0\.zip|styles\.css\.ejs|base\.css"
```

Ожидается: вложенного `certification-*.zip`, `styles.css.ejs` и `base.css` в пакете
НЕТ (Задача 13 убирает вложенный zip из каталога шаблона; если она ещё не сделана —
zip будет виден, это ожидаемо на этом шаге). Вес пакета ниже базового из Задачи 1.

- [ ] **Шаг 3: Пройти пакет в плеере целиком**

```bash
npm run scorm:player
```

Открыть `http://localhost:5050`, пройти тест «Сертификации» от старта до результатов.

Ожидается по каждому пункту (это дефекты 1-5 из контекста):

- на экране вопроса ЕСТЬ подвал с кнопками «Назад»/«Пропустить»/«Ответить»,
  кнопки работают;
- карта вопросов кликается, переход по точке работает;
- таймеры теста и раздела показаны, когда лимиты заданы;
- длинный вопрос подгоняется по высоте, а не обрезается;
- баннер вердикта ответа показан в RTK-цветах;
- экраны обзора, итогов раздела, итогов теста — сцена, не «голая» разметка.

Скриншоты в `.playwright-mcp/cert-after/`, попарно сверить с `cert-before/`.

- [ ] **Шаг 4: Сверить со стандартным шаблоном**

```bash
npm run scorm:template
```

Пройти пакет стандартного шаблона в плеере. Ожидается: композиция экранов идентична
«Сертификации», отличается ТОЛЬКО палитра, шрифт, брендовый надзаголовок обложки,
брендовая панель обложки и оранжевые маркеры списков. Любое иное расхождение —
дефект: значит в `theme.css` «Сертификации» просочился слой вёрстки.

### Задача 12: Приёмка веб-хоста и админки

**Файлы:**

- Изменить: нет

- [ ] **Шаг 1: Запустить приложение**

```bash
npm run dev
```

Порт брать из `.env` (в dev это 8081, не 5000). БД — Docker `localhost:55432`.

- [ ] **Шаг 2: Проверить предпросмотр в админке шаблонов**

Открыть `/author/templates`, найти «Сертификация (РТК)», открыть модальное окно
предпросмотра и health-check.

Ожидается: все экраны рендерятся в сцене внутри Shadow DOM, health-check зелёный.
Раньше fixed-stage шаблону требовался проп `shell` у `TemplateScreen`, чтобы `cqh`
резолвились к сцене, а не к вьюпорту; после ревизии `mountShell` у «Сертификации`
нет и обходной путь не нужен — если экран выглядит сломанным, проверить, что
`manifest.mountShell` действительно убран.

- [ ] **Шаг 3: Проверить редакторский предпросмотр**

Открыть редактор теста, вкладка «Оформление», выбрать шаблон «Сертификация»,
посмотреть предпросмотр шаблона и страницы.

Ожидается: сцена, RTK-палитра, переключение светлая/тёмная работает.

- [ ] **Шаг 4: Пройти тест учеником в живом браузере**

Приёмка фронтенда обязана идти в реальном браузере — jsdom и `tsc` недостаточны.
Завести ОДНОРАЗОВОГО ученика и аддитивное назначение на тест с шаблоном
«Сертификация», пройти тест, затем удалить созданное (пользователь, роль,
назначение, попытки). Дефолтная dev-БД — рабочая копия прод-данных, не портить.

Ожидается: старт, вопрос (все четыре типа), фидбэк, обзор, итоги раздела,
результаты — сцена и RTK-палитра, поведение идентично стандартному шаблону.

- [ ] **Шаг 5: Полная проверка**

```bash
npm run check && npm test
```

Ожидается: `tsc` чист, весь сьют зелёный, включая
`server/scorm/__tests__/template-layout-parity.test.ts`.

---

## Фаза 7. Артефакт и закрытие

### Задача 13: Дистрибутивный ZIP убрать из исходников

**Файлы:**

- Удалить: `templates/certification/certification-1.3.0.zip`
- Создать: `out/certification-1.4.0.zip` (артефакт сборки, вне git)

- [ ] **Шаг 1: Убрать zip из каталога шаблона**

```bash
git rm templates/certification/certification-1.3.0.zip
```

Причина (дефект 11): `copyDirToFiles` (`server/scorm/builders/template-copy.ts:15`)
копирует каталог шаблона в пакет рекурсивно и БЕЗ фильтра, а `manifestHrefs`
(`server/scorm/index.ts:401`) объявляет каждый скопированный файл ресурсом в
`imsmanifest.xml`. Дистрибутивный zip шаблона (109 КБ) попадал внутрь каждого
экспорта и объявлялся ресурсом — строгий валидатор LMS видит вложенный архив как
ресурс пакета.

- [ ] **Шаг 2: Собрать новый дистрибутив шаблона в `out/`**

```bash
cd templates/certification && zip -r ../../out/certification-1.4.0.zip . -x "preview.html" && cd ../..
unzip -l out/certification-1.4.0.zip
```

Ожидается: в архиве `manifest.json`, `shell.html`, `index.html.ejs`, `layouts/`
(17 файлов), `styles/theme.css`, `scripts/template.js`, `preview.svg`, `demo/`.
Ни `base.css`, ни `styles.css.ejs`, ни вложенного zip.

- [ ] **Шаг 3: Проверить дистрибутив через PRD-3 админку**

Загрузить `out/certification-1.4.0.zip` в `/author/templates` как новый шаблон
(или проверкой без активации).

Ожидается: 0 блокирующих замечаний, предпросмотр рендерится.

- [ ] **Шаг 4: Коммит**

```bash
git add -A templates/certification
git commit -m "chore(templates): дистрибутив «Сертификации» не хранится внутри исходников шаблона"
```

- [ ] **Шаг 5: Доклад по остатку, который НЕ входит в этот план**

`preview.html` (396 КБ), `demo/course.json` и `index.html.ejs` по-прежнему попадают
в каждый SCORM-экспорт ОБОИХ шаблонов, потому что `copyDirToFiles` не фильтрует
каталог. Это отдельный дефект сборщика пакета, он касается и стандартного шаблона —
в объём этого плана не входит, доложить пользователю отдельно и решать отдельной
задачей.

### Задача 14: Закрытие

- [ ] **Шаг 1: Сверить ветку с origin перед пушем**

```bash
git cherry -v origin/feat/prd25-home-page | head -20
```

Ожидается: только коммиты этого плана.

- [ ] **Шаг 2: Финальная проверка перед докладом**

```bash
npm run check && npm test
```

Ожидается: `tsc` чист, сьют зелёный. Без прогона и вывода этих команд НЕ заявлять,
что работа завершена.

- [ ] **Шаг 3: Доложить пользователю результат**

Доложить: попарные скриншоты `cert-before` против `cert-after`, вес пакета до и
после, вывод `npm test`, и что именно осталось за рамками (фильтр
`copyDirToFiles`).

---

## Самопроверка плана

**Покрытие дефектов.** Дефект 1 (нет навигации на вопросе) — Задача 7. Дефект 2
(карта вопросов) — Задача 7. Дефект 3 (таймеры) — Задача 7. Дефект 4 (подгонка
текста) — Задача 7. Дефект 5 (CSS-провал) — Задачи 5, 6. Дефект 6 (две системы
размерности) — Задачи 5, 6 плюс тест `uses no container-query units`. Дефект 7
(`base.css` техдолг) — Задача 6. Дефект 8 (манифест обещает несуществующее) —
Задача 9. Дефект 9 (прогресс-бар) — Задача 4. Дефект 10 (самоссылки) — Задача 9.
Дефект 11 (вложенный zip) — Задача 13. Отставание по возможностям обложки
(`subtitle`, блок фактов, `startPageContent`, `state.exhausted`,
`design.startImageUrl`) — Задачи 7 и 9.

**Сохранение дизайн-специфики.** Каждая строка таблицы «дизайн-специфики» имеет
адресата: палитра и шрифт — Задача 5 (шаг 1, блок токенов сохраняется без
изменений); надзаголовок — Задача 8; панель обложки, счётчики списков, scrim,
надзаголовок итогов раздела — Задача 6 (шаг 1).

**Страховка от повторения.** Задача 3 создаёт тест, который падает при любом
расхождении раскладок с эталоном, при возврате `base.css`, при появлении `cqh/cqw`
и при возврате `mountShell`. Тест пишется первым и намеренно красный до Фазы 4.

**Согласованность имён.** Класс `.tb-cover__brandline` объявлен в Задаче 6 (CSS),
использован в Задаче 8 (разметка) и в `INTENDED_DELTAS` теста из Задачи 3 —
во всех трёх местах написание совпадает. Версия `1.4.0` фигурирует в Задаче 9
(манифест) и Задаче 13 (имя дистрибутива).

**Открытый вопрос вне объёма.** Фильтр `copyDirToFiles` — дефект сборщика,
касающийся обоих шаблонов; вынесен в доклад (Задача 13, шаг 5), не в работы.
