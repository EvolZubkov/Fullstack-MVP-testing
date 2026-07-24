# План: привести цвета системы к палитре DS

> Для исполнителя: задачи идут по TDD (сначала падающий тест/замер, потом правка, потом
> проверка и коммит). Шаги помечены чекбоксами для отслеживания.

**Цель:** убрать из приложения цвета, заданные литералами, чтобы каждый цвет приходил либо из
токенов DS (`--ou-*`), либо из палитры шаблона оформления, и закрепить это тестом, который не даст
регрессии.

**Подход:** сначала ставим гард-тест со списком известных нарушений (он зелёный и фиксирует
статус-кво), затем каждая задача чинит одну группу и вычёркивает её из списка. Красным становится
любое новое нарушение, а не вся кодовая база сразу.

**Технологии:** vitest (гард-тест сканирует исходники), CSS-переменные DS `--ou-*`,
переменные шаблона (`--primary`, `--primary-foreground`) через `cssVars` от
`/api/tests/:id/screen-template/*`, приёмка — реальный браузер (playwright MCP).

---

## Границы

В плане участвует **авторское приложение и обвязка ученических экранов** (`client/src`).

НЕ участвуют:

- `client/src/styles/vendor/university-rt.css` и `vendor/ui-kit/**` — это сам DS, источник токенов;
- `server/scorm/templates/**` — шаблоны оформления, у них своя палитра по контракту PRD-7/PRD-12;
- `docs/wireframes/**` — копии для эскизов, правятся вместе с исходником в своей задаче;
- тесты (`**/__tests__/**`) — там литералы это фикстуры.

## Решения, зафиксированные до начала

**Решение 1. Чей цвет у кнопок ученика.** Кнопка «Далее»/«Продолжить» ученического хоста берёт цвет
**шаблона оформления**, а не DS: она стоит вплотную к отрисованному шаблоном экрану, и у теста с
брендом РТК синяя кнопка под оранжевым экраном читается как чужая. Палитра уже приходит на клиент —
`cssVars` в ответе `screen-template` (например `--primary: "15 100% 45%"`), их достаточно применить
на внешнюю обёртку. Фолбэк, когда шаблон цвет не объявил, — токен DS.

Если решение поменяется на «обвязка принадлежит приложению», в задаче 3 меняется одна строка CSS
(`hsl(var(--primary, …))` → `var(--ou-accent-default)`), остальное остаётся.

**Решение 2. Палитра графиков.** В DS нет категориальных токенов для серий (проверено: ни одного
`--ou-chart*`). Заводим локальный набор `--tb-chart-1..8` в `tb-components.css`, значения берём из
существующих семантических шкал DS (`--ou-accent-*`, `--ou-info-*`, `--ou-success-*`,
`--ou-warning-*`, `--ou-error-*`). Предлагать набор в ui-kit — отдельный разговор с владельцем DS,
здесь не делаем.

## Инвентарь нарушений (замер на 2026-07-24)

13 мест вне тестов и вендора:

| Файл | Строки | Что | Группа |
| --- | --- | --- | --- |
| `client/src/pages/learner/take-test.tsx` | 2395, 2402, 2413, 2704 | `background: "#2563eb"` инлайном | 3 |
| `client/src/pages/learner/template-question-screen.tsx` | 453 | `background: "#2563eb"` инлайном | 3 |
| `client/src/pages/learner/take-test.tsx` | 197, 198, 210 | `#16a34a`, `#dc2626`, `#dcfce7`, `#fee2e2`, `#333` в HTML обратной связи | 3 |
| `client/src/styles/tb-learner-host.css` | 86 | `color: #fff` у `.tbh-primarybtn` | 3 |
| `client/src/features/tests/debug-player/debug-player.css` | 94, 114 | `background: #fff` | 2 |
| `client/src/pages/author/analytics.tsx` | 1667 | `hsl(${i * 60}, 70%, 50%)` — серии графика | 4 |

Законные литералы, которые остаются и попадают в постоянный allowlist:

- `tb-components.css:1459,1648` — фолбэки внутри `var(--ou-…, …)`;
- `features/tests/editor/sections/color-format.ts` — утилита конвертации цвета;
- `features/tests/editor/sections/design-section.tsx:683,778` — `#000000` как значение по умолчанию
  для пипетки.

Отдельно: `client/src/index.css` объявляет ~90 строк палитры дошадсиэновской эпохи
(`--primary`, `--sidebar-*`, `--chart-*`, `--shadow-*`). Приложение читает оттуда **только
`--border`** — в `preflight.css:30` и `tb-components.css:2133`. Остальное мёртвое (задача 5).

## Файловая структура

Создаём:

- `tests/ds-color-compliance.test.ts` — гард: сканирует `client/src`, падает на литерале вне
  allowlist.

Меняем:

- `client/src/features/tests/debug-player/debug-player.css` — задача 2;
- `client/src/styles/tb-learner-host.css` — задачи 2, 3;
- `client/src/pages/learner/take-test.tsx` — задача 3;
- `client/src/pages/learner/template-question-screen.tsx` — задача 3;
- `client/src/styles/tb-components.css` — задачи 4, 5;
- `client/src/pages/author/analytics.tsx` — задача 4;
- `client/src/index.css`, `client/src/styles/preflight.css` — задача 5;
- `docs/guides/ds-usage.md` (создаётся, если нет) — задача 6.

---

## Задача 1: гард-тест на цветовые литералы

**Файлы:**

- Создать: `tests/ds-color-compliance.test.ts`

- [ ] **Шаг 1. Написать тест**

```ts
/**
 * @module tests/ds-color-compliance
 * @description Цвет в приложении приходит из токенов DS (--ou-*) или из палитры
 * шаблона оформления. Литерал (#hex / rgb() / hsl() с числами) — исключение,
 * которое живёт в ALLOWED и объясняется там же. Новый литерал роняет тест.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("client/src");
const SKIP_DIRS = new Set(["vendor", "__tests__"]);
const EXT = new Set([".css", ".ts", ".tsx"]);

/** Literal colour: #rgb/#rrggbb(aa), rgb()/rgba(), hsl()/hsla() with a numeric first arg. */
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]|hsla?\(\s*[\d.$]/;

/** Known, justified literals: file → why. Everything else must use tokens. */
const ALLOWED: Record<string, string> = {
  "index.css": "легаси-палитра, вычищается задачей 5",
  "styles/preflight.css": "сброс на legacy --border, переводится задачей 5",
  "styles/tb-components.css": "фолбэки внутри var(--ou-…, …)",
  "features/tests/editor/sections/color-format.ts": "утилита конвертации цвета",
  "features/tests/editor/sections/design-section.tsx": "#000000 — значение по умолчанию пипетки",
  // ↓ вычёркиваются по мере выполнения плана
  "features/tests/debug-player/debug-player.css": "задача 2",
  "styles/tb-learner-host.css": "задача 3",
  "pages/learner/take-test.tsx": "задача 3",
  "pages/learner/template-question-screen.tsx": "задача 3",
  "pages/author/analytics.tsx": "задача 4",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
      continue;
    }
    if (EXT.has(path.extname(entry.name))) out.push(path.join(dir, entry.name));
  }
  return out;
}

describe("цвета приложения приходят из токенов", () => {
  it("литералы встречаются только в объяснённых местах", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (ALLOWED[rel]) continue;
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (LITERAL.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("список исключений не разрастается молча", () => {
    expect(Object.keys(ALLOWED).length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Шаг 2. Прогнать — тест должен быть ЗЕЛЁНЫМ**

Команда: `node_modules/.bin/vitest run tests/ds-color-compliance.test.ts --coverage.enabled=false`
Ожидание: `2 passed`. Тест фиксирует статус-кво: все нарушения перечислены в `ALLOWED`.

- [ ] **Шаг 3. Проверить, что гард ловит новое нарушение**

Временно добавить в `client/src/styles/tb-content-tree.css` строку `.tmp { color: #ff0000; }`,
прогнать тест: ожидание — FAIL со строкой `styles/tb-content-tree.css:<N>`. Убрать строку, прогнать
снова: PASS.

- [ ] **Шаг 4. Коммит**

```bash
git add tests/ds-color-compliance.test.ts
git commit -m "test(ds): гард на цветовые литералы вне токенов"
```

---

## Задача 2: отладчик и обвязка — на токены DS

**Файлы:**

- Изменить: `client/src/features/tests/debug-player/debug-player.css:94,114`
- Изменить: `tests/ds-color-compliance.test.ts` (убрать запись из `ALLOWED`)

- [ ] **Шаг 1. Вычеркнуть файл из allowlist и увидеть падение**

Удалить строку `"features/tests/debug-player/debug-player.css": "задача 2",` из `ALLOWED`.
Команда: `node_modules/.bin/vitest run tests/ds-color-compliance.test.ts --coverage.enabled=false`
Ожидание: FAIL, в списке две строки `debug-player.css:94` и `:114`.

- [ ] **Шаг 2. Заменить литералы на токены**

В `debug-player.css` строка 94 (`.dbg__stage`) и строка 114 (`.dbg__iframe`):

```css
/* Белая подложка сцены была слепа к теме: тему переключает класс .ou--dark на
   body, литерал его не слышит. Поверхность берём у DS. */
background: var(--ou-bg-surface-1);
```

- [ ] **Шаг 3. Прогнать гард**

Команда: `node_modules/.bin/vitest run tests/ds-color-compliance.test.ts --coverage.enabled=false`
Ожидание: PASS.

- [ ] **Шаг 4. Приёмка в браузере (обязательна для фронтенда)**

Поднять учётку и открыть отладчик:

```bash
npm run create-admin -- --email claude-audit@local.test --password "Tmp-Audit-8f3k!" --name "Claude audit (temp)"
```

В браузере: логин через `fetch('/api/auth/login')`, затем `/author/tests` → меню теста →
«Тестовый прогон». Снять замер в светлой и тёмной теме:

```js
getComputedStyle(document.querySelector('.dbg__stage')).backgroundColor
```

Ожидание: значения РАЗНЫЕ в темах (раньше в обеих было `rgb(255, 255, 255)`).
После проверки удалить учётку:

```bash
docker exec test-builder-db psql -U test_builder -d test_builder -At -c "
DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE name='Claude audit (temp)');
DELETE FROM users WHERE name='Claude audit (temp)';"
```

- [ ] **Шаг 5. Коммит**

```bash
git add client/src/features/tests/debug-player/debug-player.css tests/ds-color-compliance.test.ts
git commit -m "fix(debug-player): поверхности сцены из токенов DS, а не белым литералом"
```

---

## Задача 3: ученический хост — палитра шаблона

**Файлы:**

- Изменить: `client/src/styles/tb-learner-host.css:80-90`
- Изменить: `client/src/pages/learner/take-test.tsx:197-210, 2395, 2402, 2413, 2704`
- Изменить: `client/src/pages/learner/template-question-screen.tsx:453`
- Изменить: `tests/ds-color-compliance.test.ts`

- [ ] **Шаг 1. Вычеркнуть три файла из allowlist, увидеть падение**

Удалить записи `styles/tb-learner-host.css`, `pages/learner/take-test.tsx`,
`pages/learner/template-question-screen.tsx`.
Ожидание: FAIL с 10 строками.

- [ ] **Шаг 2. Кнопка берёт цвет шаблона**

`tb-learner-host.css`, правило `.tbh-primarybtn`:

```css
.tbh-primarybtn {
  /* The chrome sits next to the template-rendered screen, so it wears the
     TEMPLATE palette (cssVars applied on the host wrapper). DS tokens are the
     fallback for a template that declares no colours. */
  background: hsl(var(--primary, var(--ou-accent-default)));
  color: hsl(var(--primary-foreground, var(--ou-fg-on-accent)));
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 0.5625rem;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  border: 0;
  cursor: pointer;
}
```

- [ ] **Шаг 3. Отдать палитру обвязке**

В `take-test.tsx` внешняя обёртка экрана вопроса (и таких же экранов) получает те же `cssVars`,
что уходят в `TemplateScreen`. Рядом с местом, где верстается обвязка:

```tsx
// The chrome outside the template's shadow root needs the same palette the
// screen inside got — otherwise its buttons ignore the test's branding.
<div className="tbh-minh-screen tbh-col" style={questionTpl?.cssVars as React.CSSProperties}>
```

Убрать `style={{ background: "#2563eb" }}` со всех пяти кнопок (`take-test.tsx:2395, 2402, 2413,
2704`, `template-question-screen.tsx:453`) — цвет теперь даёт класс `.tbh-primarybtn`.

- [ ] **Шаг 4. Обратная связь — на токены шаблона**

`take-test.tsx:197-210`, функция сборки HTML обратной связи:

```ts
// Verdict colours belong to the template palette (the block is injected INTO the
// template screen); DS tokens are the fallback.
const color = ok ? "hsl(var(--success, var(--ou-success-default)))" : "hsl(var(--destructive, var(--ou-error-default)))";
const bg = ok ? "hsl(var(--success, var(--ou-success-default)) / 0.12)" : "hsl(var(--destructive, var(--ou-error-default)) / 0.12)";
```

и в строке 210 вместо `color:#333`:

```ts
html += `<div style="color:hsl(var(--muted-foreground, var(--ou-fg-muted)));font-size:14px;">${escSlot(result.feedback)}</div>`;
```

- [ ] **Шаг 5. Прогнать гард и юнит-тесты**

```bash
node_modules/.bin/vitest run tests/ds-color-compliance.test.ts client/src/pages/learner --coverage.enabled=false
npm run check
```

Ожидание: гард PASS, 125 тестов ученических экранов PASS, `tsc` без вывода.

- [ ] **Шаг 6. Приёмка в браузере на брендированном тесте**

Поднять учётку, назначить роутер-тест «Сертификационный тест для руководителей»
(`b9539e97-02da-4f0e-a329-626c86547e31`) и пройти до экрана вопроса:

```bash
docker exec test-builder-db psql -U test_builder -d test_builder -At -c "
INSERT INTO test_assignments (id, test_id, user_id, assigned_by)
SELECT 'tmp-audit-assign', 'b9539e97-02da-4f0e-a329-626c86547e31', u.id, u.id
FROM users u WHERE u.name='Claude audit (temp)';"
```

Замер в браузере:

```js
getComputedStyle(document.querySelector('.tbh-primarybtn')).backgroundColor
```

Ожидание: цвет совпадает с `--primary` шаблона (для РТК — оранжевый), а не `rgb(37, 99, 235)`.
Убрать назначение, попытки и учётку после проверки.

- [ ] **Шаг 7. Коммит**

```bash
git add client/src/styles/tb-learner-host.css client/src/pages/learner tests/ds-color-compliance.test.ts
git commit -m "fix(learner): обвязка ученических экранов берёт цвет у шаблона, а не литералом"
```

---

## Задача 4: категориальная палитра графиков

**Файлы:**

- Изменить: `client/src/styles/tb-components.css` (объявление `--tb-chart-1..8`)
- Изменить: `client/src/pages/author/analytics.tsx:1667`
- Изменить: `tests/ds-color-compliance.test.ts`

- [ ] **Шаг 1. Вычеркнуть analytics.tsx из allowlist, увидеть падение**

Ожидание: FAIL со строкой `pages/author/analytics.tsx:1667`.

- [ ] **Шаг 2. Объявить набор серий**

В `tb-components.css`, рядом с блоком `:root` локальных алиасов:

```css
/* Categorical series for charts. The DS ships no --ou-chart* scale, so the set is
   assembled from its semantic hues: distinguishable, and they follow the theme
   because every entry is a DS token. */
:root {
  --tb-chart-1: var(--ou-accent-default);
  --tb-chart-2: var(--ou-info-default);
  --tb-chart-3: var(--ou-success-default);
  --tb-chart-4: var(--ou-warning-default);
  --tb-chart-5: var(--ou-error-default);
  --tb-chart-6: var(--ou-accent-hover);
  --tb-chart-7: var(--ou-info-700);
  --tb-chart-8: var(--ou-success-700);
}
```

- [ ] **Шаг 3. Использовать набор в графике**

`analytics.tsx`, вместо `stroke={`hsl(${i * 60}, 70%, 50%)`}`:

```tsx
// Series colour comes from the shared categorical set — the hue-rotation formula
// guaranteed neither contrast nor distinguishable neighbours.
stroke={`var(--tb-chart-${(i % 8) + 1})`}
```

- [ ] **Шаг 4. Прогнать гард и тесты аналитики**

```bash
node_modules/.bin/vitest run tests/ds-color-compliance.test.ts client/src/pages/author --coverage.enabled=false
```

Ожидание: PASS.

- [ ] **Шаг 5. Приёмка в браузере**

Открыть `/author/tests/<id>/analytics` с тестом, у которого есть несколько серий; снять:

```js
[...document.querySelectorAll('path[stroke]')].map(p => getComputedStyle(p).stroke).slice(0, 8)
```

Ожидание: восемь РАЗНЫХ значений, ни одно не `rgb(…)` из формулы вращения тона; в тёмной теме
значения меняются.

- [ ] **Шаг 6. Коммит**

```bash
git add client/src/styles/tb-components.css client/src/pages/author/analytics.tsx tests/ds-color-compliance.test.ts
git commit -m "feat(analytics): категориальная палитра серий из токенов DS"
```

---

## Задача 5: вычистить легаси-палитру

**Файлы:**

- Изменить: `client/src/styles/preflight.css:30`
- Изменить: `client/src/styles/tb-components.css:2133`
- Изменить: `client/src/index.css` (удалить блоки `:root` и тёмной темы дошадсиэновской палитры)
- Изменить: `tests/ds-color-compliance.test.ts`

- [ ] **Шаг 1. Перевести двух потребителей `--border` на DS**

`preflight.css:30`:

```css
/* DS border token: the legacy --border variable is going away with the rest of
   the pre-DS palette. */
border: 0 solid var(--ou-border-soft);
```

`tb-components.css:2133`:

```css
.tb-row-sep { border-bottom: 1px solid var(--ou-border-soft); }
```

- [ ] **Шаг 2. Убедиться, что легаси-переменные больше никем не читаются**

```bash
rg -n "var\(--(background|foreground|primary|secondary|muted|accent|destructive|card|border|sidebar|chart-|popover|input|ring|shadow-|elevate-|button-outline|badge-outline)" client/src --glob '!client/src/styles/vendor/**' --glob '!client/src/index.css'
```

Ожидание: пусто. Если что-то нашлось — перевести на соответствующий токен `--ou-*` до удаления.

- [ ] **Шаг 3. Удалить мёртвые объявления из `index.css`**

Оставить только блок `@import`. Все объявления `:root { --button-outline … }` и парный тёмный блок
удалить целиком.

- [ ] **Шаг 4. Вычеркнуть `index.css` и `preflight.css` из allowlist, прогнать гард**

Ожидание: PASS (литералов в этих файлах больше нет).

- [ ] **Шаг 5. Приёмка в браузере: обе темы**

Открыть `/author/tests` и `/author/content`, переключить тему кнопкой в шапке, снять:

```js
getComputedStyle(document.body).backgroundColor + ' | ' + getComputedStyle(document.querySelector('.tb-row-sep') ?? document.body).borderBottomColor
```

Ожидание: значения меняются при переключении темы, разделители видны в обеих.

- [ ] **Шаг 6. Полный прогон и коммит**

```bash
npm test
```

Ожидание: все файлы зелёные, покрытие не ниже порога 80%.

```bash
git add client/src/index.css client/src/styles/preflight.css client/src/styles/tb-components.css tests/ds-color-compliance.test.ts
git commit -m "chore(styles): удалить мёртвую палитру дошадсиэновской эпохи"
```

---

## Задача 6: зафиксировать правило в документации

**Файлы:**

- Создать: `docs/guides/ds-usage.md` (если файла нет — иначе дополнить раздел о цвете)

- [ ] **Шаг 1. Написать раздел**

```markdown
## Цвет

Цвет в приложении приходит из одного из двух источников:

- токены DS `--ou-*` — для всего авторского интерфейса;
- палитра шаблона оформления (`--primary`, `--destructive`, … через `cssVars`) — для ученических
  экранов и обвязки вокруг них.

Литерал (`#hex`, `rgb()`, `hsl()` с числами) допустим только как фолбэк внутри
`var(--ou-…, фолбэк)` и в утилитах конвертации цвета. За этим следит
`tests/ds-color-compliance.test.ts`: новый литерал роняет тест, а список исключений в нём же
объясняет каждое из оставшихся.

Своих цветовых переменных слой `tb-*` не заводит — исключение только категориальный набор
`--tb-chart-1..8`, собранный из семантических токенов DS.
```

- [ ] **Шаг 2. Проверить markdownlint**

```bash
npx --no-install markdownlint-cli2 docs/guides/ds-usage.md
```

Ожидание: `0 issues`.

- [ ] **Шаг 3. Коммит**

```bash
git add docs/guides/ds-usage.md
git commit -m "docs(ds): правило источника цвета и как оно проверяется"
```

---

## Итоговая проверка плана

- [ ] `node_modules/.bin/vitest run tests/ds-color-compliance.test.ts --coverage.enabled=false` — PASS,
  в `ALLOWED` осталось не более четырёх записей (фолбэки в `tb-components.css`, `color-format.ts`,
  `design-section.tsx`).
- [ ] `npm run check` — без вывода.
- [ ] `npm test` — зелено, покрытие не ниже порога.
- [ ] Приёмка в браузере пройдена в обеих темах: список тестов, дерево контента, отладчик, экран
  вопроса ученика, аналитика.
- [ ] Временные учётки, назначения и попытки из БД удалены.
