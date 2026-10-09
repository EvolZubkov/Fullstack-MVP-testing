# План: приведение ящика редактора теста к утверждённому эскизу

> Для исполнителя-агента: обязательный под-навык — `superpowers:subagent-driven-development`
> (рекомендуется) либо `superpowers:executing-plans`. Шаги помечены чекбоксами `- [ ]`.

**Цель:** закрыть 205 расхождений ящика редактора теста с утверждённым эскизом
`docs/wireframes/editor-settings-target.html` и поставить машинный гейт, который не даст
им вернуться.

**Подход:** сначала инструмент, потом правки. Перед единой правкой UI собирается сверщик,
который сам вычитывает требования ИЗ эскиза и сравнивает их с живым ящиком. Каждая партия
правок принимается не глазами, а падением счётчика в зафиксированной базовой линии. Реестр
находок генерируется из отчёта приёмки скриптом, а не переписывается руками, поэтому
потерять находку нельзя.

**Стек:** Node 24 (глобальные `fetch` и `WebSocket`), CDP напрямую к
`chrome-headless-shell` (в проекте нет пакета playwright и новые зависимости не заводятся),
vitest для чистой логики, существующий каркас `scripts/check/*.mjs` и `npm run check:guards`.

---

## Почему план устроен именно так

Трек перестройки редактора закрылся 2026-09-03 приёмкой, которая сверяла реализацию
с пунктами плана (`Э3.2`…`Э3.7` — «вкладки и рейлы на месте»), а не с рисунком. Тот же
отчёт записал разделы «О тесте» и «Интеграция» как поставленные, хотя эти слова существуют
только в комментариях `basic-settings-section.tsx:14` и `:926` и на экран не выводятся.
Итог — 219 расхождений, вскрытых приёмкой 2026-09-04
([отчёт](../reports/editor-drawer-wireframe-acceptance.md)).

Отсюда три опоры плана, каждая закрывает свой способ ошибиться:

1. **Требования вычитываются из эскиза машиной.** Список ожидаемых отступов сверщик
   получает разбором блока `<style>` самого эскиза (комментарии вида `/* ui-kit: 20 -> 24 */`),
   а не из таблицы, набранной руками. Ошибка переписывания исключена.
2. **Реестр находок генерируется из отчёта.** 205 идентификаторов не переносятся в план
   текстом; скрипт превращает таблицы отчёта в JSON, каждая партия — выборка по полю
   `batch`, финальный гейт требует, чтобы у каждого идентификатора был исход.
3. **Приёмка партии — машинная.** Базовая линия фиксирует известные расхождения; сверщик
   падает, если появилось расхождение вне базовой линии, и печатает, какие записи ушли.
   Партия закрыта, только когда ушли ровно заявленные и не появилось ни одного нового.

## Гейты, обязательные в каждой задаче

Нарушение любого пункта означает, что задача не сделана.

- **Эскиз неприкосновенен.** Каталог `docs/wireframes/**` — эталон. Ни один шаг плана его
  не правит. Единственное исключение — задача 10.2, и только после письменного решения
  владельца.
- **Копия `tb-components.css` в эскизах — тоже эталон.** Правится только
  `client/src/styles/tb-components.css`. Файл `docs/wireframes/tb-components.css` не
  трогать: он отдельная копия, по которой рисуется эскиз.
- **Полный `npm test` не запускать.** Прогон занимает около восьми минут и занимает машину,
  на которой работают другие сессии. В задачах указаны целевые прогоны
  `npm test -- <путь>`. Полный прогон — только на шаге 11.3 и только после явного «да»
  от владельца.
- **`npm run test:cov` не запускать вовсе** в рамках этого плана: он требует одиночного
  запуска на машине.
- **`npm run check` может врать зелёным**: кэш `tsc` общий у worktree. Если проверка типов
  зелёная сразу после правки, повторить с `npx tsc --build --force` перед тем, как верить.
- **Правка серверного кода требует перезапуска `npm run dev`** — авторестарта нет. Правки
  клиента подхватываются HMR.
- **Скриншоты только в `.playwright-mcp/`** (каталог в `.gitignore`), никогда в корень
  репозитория.
- **Откат только с разрешения владельца.** Каждая партия — отдельный коммит; если партия
  оказалась неверной, не делать `git revert` самостоятельно.
- **Каждая партия заканчивается коммитом**, в сообщении — номер задачи и число закрытых
  находок.

## Карта файлов

Создаются:

| Файл | Ответственность |
| --- | --- |
| `scripts/check/editor-conformance/static-server.mjs` | Отдача репозитория по HTTP для рендера эскиза; без зависимостей, на `node:http` |
| `scripts/check/editor-conformance/cdp.mjs` | Минимальный клиент Chrome DevTools Protocol: запуск браузера, `Runtime.evaluate`, `Input.dispatchMouseEvent` |
| `scripts/check/editor-conformance/expectations.mjs` | Разбор блока `<style>` эскиза: список селекторов и ожидаемых значений из комментариев `/* ui-kit: X -> Y */` |
| `scripts/check/editor-conformance/inventory.mjs` | Съём структурной описи панели (заголовки, подписи, типы контролов, порядок, колонки таблиц) — одна и та же функция для эскиза и реализации |
| `scripts/check/editor-conformance/diff.mjs` | Чистое сравнение двух описей и сопоставление с базовой линией |
| `scripts/check/editor-conformance/map.json` | Соответствие состояний эскиза сочетаниям «вкладка — раздел рельса» живого ящика |
| `scripts/check/editor-conformance/baseline.json` | Базовая линия: известные расхождения, которые сверщик пока терпит |
| `scripts/check/check-editor-conformance.mjs` | Точка входа гейта: `npm run check:editor-ui` |
| `scripts/dev/findings-registry.mjs` | Генератор реестра находок из markdown-таблиц отчёта приёмки |
| `docs/reports/editor-drawer-wireframe-acceptance.findings.json` | Машиночитаемый реестр 219 находок с полями `id`, `area`, `severity`, `kind`, `batch`, `status` |
| `tests/editor-conformance/expectations.test.ts` | Тесты разбора перебивок эскиза |
| `tests/editor-conformance/diff.test.ts` | Тесты сравнения описей и базовой линии |
| `tests/editor-conformance/findings-registry.test.ts` | Тесты генератора реестра |

Правятся (перечислены в задачах поимённо): `client/src/styles/tb-components.css`,
`client/src/features/tests/editor/test-editor.tsx`,
`client/src/features/tests/editor/test-editor.validation.ts`,
`client/src/features/tests/editor/sections/*.tsx`,
`client/src/features/tests/review/*.tsx`, `client/src/features/tests/review/review-panel.css`,
`package.json` (два npm-скрипта), соответствующие `__tests__`.

---

## Э0. Подготовка

### Задача 0.1. Разрешить конфликт рабочего дерева

**Файлы:** только чтение.

- [ ] **Шаг 1: посмотреть, что лежит в рабочем дереве**

```bash
git status --short
git diff --stat -- client/src/features/tests/editor client/src/styles/tb-components.css
```

Ожидается: изменённые `basic-settings-section.tsx`, `editor-tabs.tsx`, `scales-section.tsx`,
`tb-components.css` и три файла `__tests__` — то есть ровно те файлы, которые правит этот
план.

- [ ] **Шаг 2: получить решение владельца**

Это блокирующий вопрос, работать дальше без ответа нельзя. Два варианта:

1. Правки в дереве — чужая незавершённая работа. Тогда план исполняется в отдельном
   worktree от чистой верхушки `main` (навык `superpowers:using-git-worktrees`), а чужие
   правки остаются нетронутыми.
2. Правки — свои и завершённые. Тогда их сначала коммитят отдельным коммитом, и план
   идёт в текущем дереве от чистого статуса.

Рекомендация: вариант 1. Он не зависит от того, чья это работа, и снимает риск затереть
чужие правки на девяти партиях подряд.

- [ ] **Шаг 3: зафиксировать точку отсчёта**

```bash
git rev-parse --short HEAD
```

Записать хеш в шапку отчёта о ходе работ (задача 11.4).

### Задача 0.2. Проверить, что окружение приёмки поднимается

**Файлы:** только чтение.

- [ ] **Шаг 1: найти браузер**

```bash
ls ~/AppData/Local/ms-playwright | grep chromium_headless_shell
```

Ожидается: хотя бы один каталог вида `chromium_headless_shell-1234`. Исполняемый файл —
`<каталог>/chrome-headless-shell-win64/chrome-headless-shell.exe`.

- [ ] **Шаг 2: проверить глобалы Node**

```bash
node -e "console.log(process.version, typeof fetch, typeof WebSocket)"
```

Ожидается: `v24.x function function`. Если `WebSocket` не `function`, план исполнять нельзя
без новой зависимости — остановиться и доложить владельцу.

- [ ] **Шаг 3: поднять dev и убедиться, что вход работает**

```bash
npm run dev
```

В другом окне:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"acceptance@local.test","password":"Acceptance!2026"}'
```

Ожидается `200`. Помнить: вход ограничен десятью попытками на пятнадцать минут по IP,
окно не продлевается. Поэтому сверщик обязан кэшировать cookie (задача 1.3, шаг 4).

### Задача 0.3. Сгенерировать машиночитаемый реестр находок

**Файлы:**

- Создать: `scripts/dev/findings-registry.mjs`
- Создать: `tests/editor-conformance/findings-registry.test.ts`
- Создать (генерацией): `docs/reports/editor-drawer-wireframe-acceptance.findings.json`

- [ ] **Шаг 1: написать падающий тест разбора таблицы**

```ts
// tests/editor-conformance/findings-registry.test.ts
import { describe, expect, it } from "vitest";
import { parseFindings } from "../../scripts/dev/findings-registry.mjs";

const SAMPLE = [
  "### A. Хром ящика и вкладка «Основное»",
  "",
  "| № | Место | Эскиз | Реализация | Тип | Важность | Ссылка на код |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  "| A-1 | Поповер изменений | Ширина 420 px | Токен не объявлен | размер | блокирующее | `tb-components.css:1055` |",
  "| A-2 | Поповер изменений | Высота тела 320 px | Навешено на поповер | размер | существенное | `tb-components.css:1070` |",
].join("\n");

describe("parseFindings", () => {
  it("собирает строки таблицы в записи реестра", () => {
    const rows = parseFindings(SAMPLE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "A-1",
      area: "A",
      severity: "блокирующее",
      place: "Поповер изменений",
      status: "open",
    });
  });

  it("не теряет ни одной строки таблицы", () => {
    const ids = parseFindings(SAMPLE).map((r) => r.id);
    expect(ids).toEqual(["A-1", "A-2"]);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npm test -- tests/editor-conformance/findings-registry.test.ts
```

Ожидается: FAIL, `Failed to resolve import "../../scripts/dev/findings-registry.mjs"`.

- [ ] **Шаг 3: написать генератор**

```js
#!/usr/bin/env node
/**
 * @module scripts/dev/findings-registry
 * @description Turns the markdown finding tables of the drawer acceptance report into a
 * machine-readable registry.
 *
 * Why this exists. The report holds 219 findings in six markdown tables. Re-typing their
 * ids into a plan or a checklist is exactly the transcription step that loses items, and
 * losing one is indistinguishable from fixing it. Generating the registry from the report
 * keeps a single source of truth: the report is written once, every batch of fixes is a
 * query over the generated JSON, and the final gate asserts that every id has an outcome.
 *
 * Usage: `node scripts/dev/findings-registry.mjs` — rewrites the JSON next to the report.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPORT = join(REPO_ROOT, "docs", "reports", "editor-drawer-wireframe-acceptance.md");
const OUT = join(REPO_ROOT, "docs", "reports", "editor-drawer-wireframe-acceptance.findings.json");

/** Splits one markdown table row into trimmed cells, dropping the outer pipes. */
function cells(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Parses every finding row of the report. A finding row starts with an id like `A-12`;
 * anything else (header, separator, prose) is skipped, so the parser survives edits to the
 * surrounding text.
 *
 * @param {string} markdown Report source.
 * @returns {Array<object>} Registry entries in report order.
 */
export function parseFindings(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const c = cells(line);
    const id = c[0];
    if (!/^[A-G]-\d+$/.test(id)) continue;
    rows.push({
      id,
      area: id.split("-")[0],
      place: c[1],
      expected: c[2],
      actual: c[3],
      kind: c[4],
      severity: c[5],
      code: c[6]?.replace(/`/g, "") ?? "",
      batch: null,
      status: "open",
    });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const rows = parseFindings(readFileSync(REPORT, "utf8"));
  writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  console.log(`Реестр собран: находок ${rows.length} -> ${OUT}`);
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

```bash
npm test -- tests/editor-conformance/findings-registry.test.ts
```

Ожидается: PASS, 2 теста.

- [ ] **Шаг 5: сгенерировать реестр и сверить число**

```bash
node scripts/dev/findings-registry.mjs
node -e "const r=require('./docs/reports/editor-drawer-wireframe-acceptance.findings.json');
console.log('всего', r.length);
console.log(Object.entries(r.reduce((a,x)=>{a[x.area]=(a[x.area]||0)+1;return a},{})).map(([k,v])=>k+':'+v).join(' '));"
```

Ожидается: `всего 219` и разбивка `A:28 B:52 C:16 D:58 E:36 F:24 G:5`. Любое другое число —
таблица отчёта повреждена, чинить отчёт, а не генератор.

- [ ] **Шаг 6: разметить партии**

Проставить поле `batch` каждой записи по правилу ниже. Разметка делается один раз, скриптом,
и проверяется тем, что ни одна запись не осталась с `batch: null`.

| Партия | Задача | Признак записи |
| --- | --- | --- |
| `grid` | Э2 | `kind` содержит «сетк» или «фиксированны», плюс `A-1`, `A-2` |
| `sections` | Э4 | `kind` содержит «отсутствующий элемент» или «не тот контейнер» и `place` называет заголовок раздела |
| `components` | Э5 | `kind` содержит «не тот тип контрола» или «обход ДС» |
| `quotas` | Э6 | `place` начинается с «Состав, блок квот» |
| `actions` | Э7 | `kind` содержит «отсутствующее действие», «потерянное состояние», «отсутствующий элемент» вне партии `sections` |
| `texts` | Э8 | `kind` содержит «подпис», «текст», «порядок» |
| `cosmetics` | Э9 | всё остальное |
| `owner` | Э10 | записи, помеченные в отчёте как разрешённые расхождения эскиза |

```bash
node -e "
const fs=require('fs');const p='docs/reports/editor-drawer-wireframe-acceptance.findings.json';
const r=JSON.parse(fs.readFileSync(p,'utf8'));
const left=r.filter(x=>!x.batch).map(x=>x.id);
console.log(left.length? 'без партии: '+left.join(', ') : 'все записи размечены');
"
```

Ожидается: `все записи размечены`.

- [ ] **Шаг 7: коммит**

```bash
git add scripts/dev/findings-registry.mjs tests/editor-conformance/findings-registry.test.ts \
  docs/reports/editor-drawer-wireframe-acceptance.findings.json
git commit -m "chore(editor-ui): реестр находок приёмки ящика редактора из отчёта"
```

---

## Э1. Сверщик, часть первая: отступы и фиксированные размеры

Эта часть закрывает самый механический класс расхождений и делает партию Э2 машинно
проверяемой. Она самодостаточна: даже если структурная часть (Э3) не будет доделана,
гейт по сетке уже работает.

### Задача 1.1. Разбор перебивок из эскиза

**Файлы:**

- Создать: `scripts/check/editor-conformance/expectations.mjs`
- Создать: `tests/editor-conformance/expectations.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
// tests/editor-conformance/expectations.test.ts
import { describe, expect, it } from "vitest";
import { parseOverrides } from "../../scripts/check/editor-conformance/expectations.mjs";

const STYLE = `
  .ou-drawer__head { padding: var(--ou-space-6); }            /* ui-kit: 20 -> 24 */
  .ou-tabs__list { padding-inline: var(--ou-space-6); }       /* ui-kit: 0 -> 24 */
  .ou-btn { gap: var(--ou-space-1); }                         /* ui-kit: 8 -> 4 */
  .tb-level-grid { gap: var(--ou-space-4); }                  /* проектный слой: 8 -> 16 */
  .tb-settings-content { padding: var(--ou-space-6); }
`;

describe("parseOverrides", () => {
  it("вынимает селектор, свойство и ожидаемое значение", () => {
    const rows = parseOverrides(STYLE);
    expect(rows).toContainEqual({ selector: ".ou-drawer__head", property: "padding", expected: "24px" });
    expect(rows).toContainEqual({ selector: ".ou-tabs__list", property: "padding-inline", expected: "24px" });
    expect(rows).toContainEqual({ selector: ".ou-btn", property: "gap", expected: "4px" });
  });

  it("берёт и перебивки проектного слоя, не только ui-kit", () => {
    expect(parseOverrides(STYLE)).toContainEqual({ selector: ".tb-level-grid", property: "gap", expected: "16px" });
  });

  it("пропускает правила без комментария-перебивки", () => {
    expect(parseOverrides(STYLE).some((r) => r.selector === ".tb-settings-content")).toBe(false);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npm test -- tests/editor-conformance/expectations.test.ts
```

Ожидается: FAIL с ошибкой разрешения импорта.

- [ ] **Шаг 3: реализовать разбор**

```js
#!/usr/bin/env node
/**
 * @module scripts/check/editor-conformance/expectations
 * @description Reads the spacing contract straight out of the approved wireframe.
 *
 * Why this exists. The target wireframe carries its own `<style>` block where every
 * deviation from the design system is written down as `selector { prop: token } /* ui-kit:
 * 20 -> 24 *\/`. That comment IS the contract for the 4/16/24 modular grid. Re-typing those
 * 22 rules into a checker would reintroduce the very transcription error this whole effort
 * is about, so the checker parses them instead: change the wireframe, the expectations move
 * with it.
 */

import { readFileSync } from "node:fs";

/** Design-system spacing scale, in px, indexed by the `--ou-space-N` token number. */
const SPACE_SCALE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 32, 8: 40, 9: 48, 10: 56 };

const RULE = /^\s*(\.[^{]+?)\s*\{\s*([a-z-]+)\s*:\s*var\(--ou-space-(\d+)\)\s*;?\s*\}\s*\/\*\s*(?:ui-kit|проектный слой)\s*:\s*[^*]*?->\s*(\d+)/;

/**
 * @param {string} css Contents of the wireframe's inline style block.
 * @returns {Array<{selector: string, property: string, expected: string}>}
 */
export function parseOverrides(css) {
  const rows = [];
  for (const line of css.split(/\r?\n/)) {
    const m = RULE.exec(line);
    if (!m) continue;
    const [, selector, property, token, stated] = m;
    const fromToken = SPACE_SCALE[Number(token)];
    if (fromToken === undefined) continue;
    if (fromToken !== Number(stated)) {
      throw new Error(
        `Эскиз противоречит сам себе: ${selector} { ${property} } — токен даёт ${fromToken}px, ` +
          `комментарий обещает ${stated}px. Чинить эскиз, а не сверщик.`,
      );
    }
    rows.push({ selector: selector.trim(), property, expected: `${fromToken}px` });
  }
  return rows;
}

/**
 * @param {string} wireframePath Absolute path to the target wireframe.
 * @returns {Array<{selector: string, property: string, expected: string}>}
 */
export function readExpectations(wireframePath) {
  const html = readFileSync(wireframePath, "utf8");
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  return parseOverrides(styles);
}
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

```bash
npm test -- tests/editor-conformance/expectations.test.ts
```

Ожидается: PASS, 3 теста.

- [ ] **Шаг 5: проверить на настоящем эскизе**

```bash
node -e "
const {readExpectations}=await import('./scripts/check/editor-conformance/expectations.mjs');
const rows=readExpectations('docs/wireframes/editor-settings-target.html');
console.log('перебивок найдено:', rows.length);
console.log(rows.map(r=>r.selector+' { '+r.property+' } = '+r.expected).join('\n'));
" --input-type=module
```

Ожидается: не менее 20 строк, среди них `.ou-drawer__head { padding } = 24px`,
`.ou-tabs__list { padding-inline } = 24px`, `.ou-btn { gap } = 4px`.

- [ ] **Шаг 6: коммит**

```bash
git add scripts/check/editor-conformance/expectations.mjs tests/editor-conformance/expectations.test.ts
git commit -m "feat(editor-ui): читать контракт отступов из эскиза"
```

### Задача 1.2. Статический сервер для эскиза

**Файлы:**

- Создать: `scripts/check/editor-conformance/static-server.mjs`

Эскиз ссылается на CSS абсолютными путями (`/docs/wireframes/ds/skillum-ds.css`), поэтому
открыть его как `file://` нельзя — нужен HTTP-корень репозитория.

- [ ] **Шаг 1: реализовать сервер**

```js
#!/usr/bin/env node
/**
 * @module scripts/check/editor-conformance/static-server
 * @description Serves the repository over HTTP so the wireframe can be rendered.
 *
 * Why this exists. The wireframes reference their stylesheets by absolute path
 * (`/docs/wireframes/ds/skillum-ds.css`), so opening one over `file://` renders it
 * unstyled and every measurement comes out wrong. A twenty-line static server on
 * `node:http` removes that trap without adding a dependency.
 */

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

/**
 * @param {number} port Port to listen on; 0 asks the OS for a free one.
 * @returns {Promise<{port: number, close: () => Promise<void>}>}
 */
export function startStaticServer(port = 0) {
  const server = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    const file = join(REPO_ROOT, rel);
    if (!file.startsWith(REPO_ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error("not a file");
    } catch {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
```

- [ ] **Шаг 2: проверить вручную**

```bash
node -e "
const {startStaticServer}=await import('./scripts/check/editor-conformance/static-server.mjs');
const s=await startStaticServer(0);
const r=await fetch('http://127.0.0.1:'+s.port+'/docs/wireframes/editor-settings-target.html');
console.log('статус', r.status, 'длина', (await r.text()).length);
await s.close();
" --input-type=module
```

Ожидается: `статус 200 длина` порядка 300000.

- [ ] **Шаг 3: коммит**

```bash
git add scripts/check/editor-conformance/static-server.mjs
git commit -m "feat(editor-ui): статический сервер для рендера эскиза"
```

### Задача 1.3. Клиент CDP

**Файлы:**

- Создать: `scripts/check/editor-conformance/cdp.mjs`

- [ ] **Шаг 1: реализовать клиент**

```js
#!/usr/bin/env node
/**
 * @module scripts/check/editor-conformance/cdp
 * @description Minimal Chrome DevTools Protocol client: launch, evaluate, real mouse input.
 *
 * Why this exists. The project has no playwright package and new dependencies are not
 * introduced for this task, but `chrome-headless-shell` is already installed and Node 24
 * ships global `fetch` and `WebSocket`. Two traps are baked in here so callers cannot hit
 * them: DS buttons ignore `element.click()` and need real `Input.dispatchMouseEvent`, and
 * the dev login is rate limited to ten attempts per fifteen minutes per IP, so the session
 * cookie is cached on disk and revalidated instead of re-issued.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const SHELL_GLOB = join(homedir(), "AppData", "Local", "ms-playwright");
const COOKIE_CACHE = join(tmpdir(), "editor-conformance-sid.txt");
const COOKIE_NAME = "connect.sid";

/** Finds the newest installed chrome-headless-shell binary. */
export function findBrowser() {
  const dirs = readdirSync(SHELL_GLOB).filter((d) => d.startsWith("chromium_headless_shell-")).sort();
  for (const d of dirs.reverse()) {
    const exe = join(SHELL_GLOB, d, "chrome-headless-shell-win64", "chrome-headless-shell.exe");
    if (existsSync(exe)) return exe;
  }
  throw new Error("chrome-headless-shell не найден в " + SHELL_GLOB);
}

/** Launches the browser and attaches to its first page target. */
export async function launch({ port = 9222, width = 1600, height = 1000 } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), "editor-conformance-"));
  const proc = spawn(findBrowser(), [
    "--headless",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    "--disable-gpu",
    "--hide-scrollbars",
  ]);
  let list = null;
  for (let i = 0; i < 50 && !list; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
      list = null;
    }
  }
  if (!list?.length) throw new Error("браузер не поднялся за 10 секунд");
  const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  return {
    send,
    /** Navigates and waits for the page to settle. */
    async goto(url, settleMs = 3000) {
      await send("Page.navigate", { url });
      await new Promise((r) => setTimeout(r, settleMs));
    },
    /** Evaluates a function body in the page and returns its JSON value. */
    async evaluate(fnSource, settleMs = 0) {
      const res = await send("Runtime.evaluate", {
        expression: `(${fnSource})()`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
      if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
      return res.result.value;
    },
    /**
     * Clicks the element by real mouse events. `element.click()` does NOT open the drawer
     * or switch a DS tab — this is a known trap, do not "simplify" it back.
     */
    async clickSelector(selector, settleMs = 1200) {
      const box = await this.evaluate(
        `() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
          const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`,
      );
      if (!box) throw new Error(`не найден селектор ${selector}`);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
      }
      await new Promise((r) => setTimeout(r, settleMs));
    },
    async close() {
      ws.close();
      proc.kill();
    },
  };
}

/**
 * Returns a valid dev session cookie, reusing the cached one when it still authenticates.
 * The login endpoint allows ten attempts per fifteen minutes per IP and the window does not
 * slide, so a checker that logs in on every run locks itself out.
 */
export async function sessionCookie(base = "http://localhost:8081") {
  if (existsSync(COOKIE_CACHE)) {
    const cached = readFileSync(COOKIE_CACHE, "utf8").trim();
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cached } });
    if (me.ok) return cached;
  }
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "acceptance@local.test", password: "Acceptance!2026" }),
  });
  if (!res.ok) throw new Error(`вход не удался: ${res.status}. Возможно, сработал лимит попыток — подождите 15 минут.`);
  const sid = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`))?.split(";")[0];
  if (!sid) throw new Error(`сервер не вернул ${COOKIE_NAME}`);
  writeFileSync(COOKIE_CACHE, sid, "utf8");
  return sid;
}

/**
 * Splits `connect.sid=<value>` into its parts. The signed value is percent-encoded and can
 * carry `=` padding, so splitting on every `=` truncates the cookie and the checker silently
 * runs as an anonymous visitor — take the name off the front instead.
 *
 * @param {string} cookie Cookie pair as returned by {@link sessionCookie}.
 * @returns {{name: string, value: string}}
 */
export function splitCookie(cookie) {
  return { name: COOKIE_NAME, value: cookie.slice(`${COOKIE_NAME}=`.length) };
}
```

- [ ] **Шаг 2: проверить, что браузер поднимается и считает стиль**

```bash
node -e "
const {launch}=await import('./scripts/check/editor-conformance/cdp.mjs');
const b=await launch();
await b.goto('data:text/html,<div id=x style=\"padding:24px\">x</div>');
console.log(await b.evaluate('() => getComputedStyle(document.getElementById(\"x\")).padding'));
await b.close();
" --input-type=module
```

Ожидается: `24px`.

- [ ] **Шаг 3: коммит**

```bash
git add scripts/check/editor-conformance/cdp.mjs
git commit -m "feat(editor-ui): клиент CDP без внешних зависимостей"
```

### Задача 1.4. Гейт по отступам

**Файлы:**

- Создать: `scripts/check/check-editor-conformance.mjs`
- Изменить: `package.json` (раздел `scripts`)

- [ ] **Шаг 1: написать точку входа**

```js
#!/usr/bin/env node
/**
 * @module scripts/check/check-editor-conformance
 * @description Guard: the test-editor drawer must keep the spacing contract of the approved
 * wireframe.
 *
 * Why this exists. The 2026-09-03 acceptance of the editor restructure checked the plan's
 * checklist ("seven tabs, rails in order") and not the drawing, and 219 divergences went out
 * with it. Six of the wireframe's 22 spacing overrides had simply never been ported. This
 * guard re-derives the contract from the wireframe on every run and measures the live drawer
 * against it, so the same class of miss cannot survive a commit again.
 *
 * Usage: `npm run check:editor-ui` with `npm run dev` already running.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sessionCookie, splitCookie } from "./editor-conformance/cdp.mjs";
import { readExpectations } from "./editor-conformance/expectations.mjs";
import { startStaticServer } from "./editor-conformance/static-server.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WIREFRAME = join(REPO_ROOT, "docs", "wireframes", "editor-settings-target.html");
const DEV = process.env.EDITOR_UI_BASE ?? "http://localhost:8081";
const TEST_ID = process.env.EDITOR_UI_TEST_ID ?? "6e10d1e6-0fc9-4e5a-a498-41662c663633";

/** Measures every expectation against the currently rendered page. */
const MEASURE = (rows) => `() => {
  const rows = ${JSON.stringify(rows)};
  return rows.map((r) => {
    const el = document.querySelector(r.selector);
    if (!el) return { ...r, actual: null };
    const cs = getComputedStyle(el);
    const prop = r.property === "padding-inline" ? "paddingLeft" : r.property;
    return { ...r, actual: cs[prop] };
  });
}`;

const expectations = readExpectations(WIREFRAME);
const server = await startStaticServer(0);
const browser = await launch();
const failures = [];

try {
  const { name, value } = splitCookie(await sessionCookie(DEV));
  await browser.send("Network.enable");
  await browser.send("Network.setCookie", { name, value, domain: "localhost", path: "/" });
  await browser.goto(`${DEV}/author/tests`, 4000);
  await browser.clickSelector(`[data-testid="test-edit-${TEST_ID}"]`, 3500);

  // Walk every tab so selectors that only exist on one of them are measured too.
  const tabCount = await browser.evaluate('() => document.querySelectorAll(".ou-tabs__tab").length');
  const seen = new Map();
  for (let i = 0; i < tabCount; i++) {
    await browser.clickSelector(`.ou-tabs__tab:nth-of-type(${i + 1})`, 1400);
    const railCount = await browser.evaluate('() => document.querySelectorAll(".ou-drawer__rail-item").length');
    for (let r = 0; r < Math.max(railCount, 1); r++) {
      if (railCount) await browser.clickSelector(`.ou-drawer__rail-item:nth-of-type(${r + 1})`, 1100);
      for (const row of await browser.evaluate(MEASURE(expectations))) {
        const key = `${row.selector}|${row.property}`;
        if (row.actual !== null && !seen.has(key)) seen.set(key, row);
      }
    }
  }

  for (const [, row] of seen) {
    if (row.actual !== row.expected) failures.push(row);
  }
  const missing = expectations.filter((e) => !seen.has(`${e.selector}|${e.property}`));
  if (missing.length) {
    console.warn(`Предупреждение: не встретились на экране — ${missing.map((m) => m.selector).join(", ")}`);
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`Отступы разошлись с эскизом: ${failures.length}`);
  for (const f of failures) {
    console.error(`  ${f.selector} { ${f.property} } = ${f.actual}, эскиз требует ${f.expected}`);
  }
  console.error("");
  console.error(
    "Правило 4/16/24 задано эскизом. Переносите перебивку в client/src/styles/tb-components.css, " +
      "не меняйте эскиз и не ослабляйте проверку.",
  );
  process.exit(1);
}
console.log(`OK: отступов проверено ${expectations.length}, расхождений нет.`);
```

- [ ] **Шаг 2: добавить npm-скрипт**

В `package.json`, раздел `scripts`, после `check:contrast`:

```json
"check:editor-ui": "node scripts/check/check-editor-conformance.mjs"
```

- [ ] **Шаг 3: запустить гейт на текущем коде**

При поднятом `npm run dev`:

```bash
npm run check:editor-ui
```

Ожидается: выход с кодом 1 и список из шести расхождений — `.ou-drawer__head { padding }`,
`.ou-tabs__list { padding-inline }`, `.ou-select { gap }`, `.ou-btn { gap }`,
`.ou-radio-group__items { gap }`, `.ou-banner__body { gap }`. Если список другой — сначала
разобраться, почему, и только потом идти дальше: гейт обязан воспроизводить находки отчёта.

- [ ] **Шаг 4: коммит**

```bash
git add scripts/check/check-editor-conformance.mjs package.json
git commit -m "feat(editor-ui): гейт отступов ящика редактора по эскизу"
```

---

## Э2. Партия «сетка»

Закрывает записи реестра с `batch: "grid"`. Проверяется гейтом из Э1 — это первая партия,
которую принимает машина, а не глаз.

### Задача 2.1. Перенести недостающие перебивки в проектный слой

**Файлы:**

- Изменить: `client/src/styles/tb-components.css`

- [ ] **Шаг 1: выписать, что требуется**

```bash
node -e "
const r=require('./docs/reports/editor-drawer-wireframe-acceptance.findings.json');
r.filter(x=>x.batch==='grid').forEach(x=>console.log(x.id,'|',x.place,'|',x.expected,'->',x.actual));
"
```

Держать этот список открытым: каждая строка должна быть закрыта до конца задачи.

- [ ] **Шаг 2: добавить блок перебивок**

В конец раздела оболочки ящика в `client/src/styles/tb-components.css` (рядом с
существующим правилом `.ou-drawer__foot`, чтобы перебивки лежали вместе):

```css
/* ── Модульная сетка ящика редактора (эскиз editor-settings-target.html) ─────────
   Эскиз перебивает ui-kit ради правила 4/16/24 и записывает это в своём блоке <style>
   комментариями вида `ui-kit: 20 -> 24`. Шесть перебивок не были перенесены сюда при
   перестройке редактора (приёмка 2026-09-04, находки G-1..G-6). Гейт
   `npm run check:editor-ui` вычитывает контракт прямо из эскиза, поэтому менять значения
   здесь без правки эскиза бессмысленно — проверка упадёт. */
.ou-drawer__head { padding: var(--ou-space-6); }
.ou-tabs__list { padding-inline: var(--ou-space-6); }
.ou-drawer .ou-select { gap: var(--ou-space-1); }
.ou-drawer .ou-btn { gap: var(--ou-space-1); }
.ou-drawer .ou-radio-group__items { gap: var(--ou-space-1); }
.ou-drawer .ou-banner__body { gap: var(--ou-space-1); }
```

- [ ] **Шаг 3: починить поповер изменений (A-1, A-2)**

В `client/src/styles/tb-components.css` заменить правило `.tb-changes-popover` (около
строки 1055):

```css
.tb-changes-popover {
  position: absolute; bottom: calc(100% + var(--wf-space-10)); right: 0;
  width: 420px; overflow: hidden;
  background: var(--ou-bg-elevated);
  border: var(--wf-border-w) solid var(--ou-border-default);
  border-radius: var(--ou-radius-m);
  box-shadow: var(--ou-shadow-lg);
  display: flex; flex-direction: column; z-index: 70;
}
.tb-changes-popover__body { max-height: 320px; overflow-y: auto; }
```

Причина правки: `--wf-size-400` и `--wf-size-420` не объявлены нигде в проекте, поэтому
правило было невалидным и поповер схлопывался по содержимому. Ограничение высоты по эскизу
принадлежит телу поповера, а не всему поповеру.

- [ ] **Шаг 4: проверить, что мёртвых токенов не осталось**

```bash
node -e "
const t=require('fs').readFileSync('client/src/styles/tb-components.css','utf8');
const used=[...t.matchAll(/var\(\s*(--wf-size-[0-9]+)\s*(?:,[^)]*)?\)/g)].map(m=>m[1]);
const declared=new Set([...t.matchAll(/(--wf-size-[0-9]+)\s*:/g)].map(m=>m[1]));
const withFallback=new Set([...t.matchAll(/var\(\s*(--wf-size-[0-9]+)\s*,[^)]*\)/g)].map(m=>m[1]));
const bad=[...new Set(used)].filter(v=>!declared.has(v)&&!withFallback.has(v));
console.log(bad.length? 'без объявления и без запасного значения: '+bad.join(', ') : 'мёртвых токенов нет');
"
```

Ожидается: `мёртвых токенов нет`.

- [ ] **Шаг 5: прогнать гейт**

```bash
npm run check:editor-ui
```

Ожидается: `OK: отступов проверено N, расхождений нет.` и выход с кодом 0.

- [ ] **Шаг 6: снять кадр поповера и убедиться глазами**

Открыть ящик, изменить описание, нажать «Показать изменения», снять кадр в
`.playwright-mcp/popover-after.png`. Ширина поповера должна быть 420 px, значения не должны
переноситься по два-три слова.

- [ ] **Шаг 7: закрыть записи реестра**

```bash
node -e "
const fs=require('fs');const p='docs/reports/editor-drawer-wireframe-acceptance.findings.json';
const r=JSON.parse(fs.readFileSync(p,'utf8'));
r.filter(x=>x.batch==='grid'&&/^(G-|A-1$|A-2$)/.test(x.id)).forEach(x=>x.status='fixed');
fs.writeFileSync(p, JSON.stringify(r,null,2)+'\n');
console.log('закрыто:', r.filter(x=>x.status==='fixed').length);
"
```

- [ ] **Шаг 8: коммит**

```bash
git add client/src/styles/tb-components.css docs/reports/editor-drawer-wireframe-acceptance.findings.json
git commit -m "fix(editor-ui): перенести перебивки сетки 4/16/24 и починить ширину поповера изменений"
```

### Задача 2.2. Точечные интервалы внутри панелей

**Файлы:**

- Изменить: `client/src/styles/tb-components.css` (правила `.tb-topic-row`,
  `.tb-topic-row__body`, `.tb-levels`, `.tb-levels__cover`, `.tb-levels__grid`,
  `.tb-levels__tone`, `.tb-fold-sec__body`, `.tpl-info`, `.tpl-actions`,
  `.design-theme-head`, `.design-color-field`)
- Изменить: `client/src/features/tests/editor/sections/scales-section.tsx` (`Grid gap`)
- Изменить: `client/src/features/tests/editor/sections/results-labels-pane.tsx` (`Stack gap`)

- [ ] **Шаг 1: получить список**

```bash
node -e "
const r=require('./docs/reports/editor-drawer-wireframe-acceptance.findings.json');
r.filter(x=>x.batch==='grid'&&x.status==='open').forEach(x=>console.log(x.id,'|',x.place,'|',x.expected,'|',x.code));
"
```

- [ ] **Шаг 2: править по одному, значение брать из колонки «Эскиз» реестра**

Образец для CSS (находки B-20, B-21):

```css
.tb-topic-row { margin-bottom: var(--ou-space-1); }
.tb-topic-row__body { padding: 0 var(--ou-space-6) var(--ou-space-6); }
```

Образец для свойства компонента (находка D-15, `scales-section.tsx`): заменить
`<Grid cols={2} gap={3}>` на `<Grid cols={2} gap={4}>` — шкала `gap` у `Grid` совпадает с
токенами `--ou-space-N`, поэтому 4 даёт требуемые 16 px.

Образец для находки E-13 (`results-labels-pane.tsx`): заменить `<Stack gap={2}>` на
`<Stack gap={1}>` в обоих местах — строках порядка подблоков и строке надписи.

- [ ] **Шаг 3: проверить типы**

```bash
npm run check
```

Ожидается: без ошибок. Если проверка зелёная подозрительно быстро, повторить
`npx tsc --build --force`.

- [ ] **Шаг 4: прогнать затронутые тесты**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__
```

Ожидается: PASS. Падения из-за изменившихся `gap` означают, что тест ассертит верстку —
обновить ожидание теста под эскиз, а не откатывать правку.

- [ ] **Шаг 5: прогнать гейт**

```bash
npm run check:editor-ui
```

Ожидается: `OK`.

- [ ] **Шаг 6: закрыть записи и закоммитить**

```bash
node -e "
const fs=require('fs');const p='docs/reports/editor-drawer-wireframe-acceptance.findings.json';
const r=JSON.parse(fs.readFileSync(p,'utf8'));
r.filter(x=>x.batch==='grid').forEach(x=>x.status='fixed');
fs.writeFileSync(p, JSON.stringify(r,null,2)+'\n');
console.log('партия grid закрыта, записей:', r.filter(x=>x.batch==='grid').length);
"
git add -A client/src docs/reports/editor-drawer-wireframe-acceptance.findings.json
git commit -m "fix(editor-ui): интервалы панелей ящика по правилу 4/16/24"
```

---

## Э3. Сверщик, часть вторая: структурная опись

Гейт по отступам ловит только числа. Пропавший заголовок раздела, переписанная подпись,
подменённый контрол и переставленные элементы он не видит — их закрывает эта часть.

### Задача 3.1. Съём описи

**Файлы:**

- Создать: `scripts/check/editor-conformance/inventory.mjs`

- [ ] **Шаг 1: реализовать съём**

```js
#!/usr/bin/env node
/**
 * @module scripts/check/editor-conformance/inventory
 * @description Structural inventory of one settings panel, taken identically on the
 * wireframe and on the live drawer.
 *
 * Why this exists. Comparing screenshots tells you something changed but not what; comparing
 * DOM trees drowns in noise. The inventory keeps exactly the properties the wireframe is a
 * contract for — section headings, field labels, hints, control kinds, button variants,
 * table columns and their order — and drops everything data-dependent, so a diff is short
 * enough to read and specific enough to act on.
 */

/**
 * Source of the browser-side extractor. Kept as a string because it is injected into two
 * different pages through `Runtime.evaluate`; keeping one copy guarantees the wireframe and
 * the implementation are measured by the same rules.
 */
export const EXTRACT = `() => {
  const root = document.querySelector(".tb-settings-content") || document.querySelector(".ou-drawer__body");
  if (!root) return null;
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const items = [];
  const KIND = (el) => {
    const t = el.tagName.toLowerCase();
    if (t === "input") return "input:" + el.type;
    if (t === "textarea" || t === "select" || t === "table" || t === "button") return t;
    return null;
  };
  const visit = (el) => {
    for (const c of el.children) {
      const cls = typeof c.className === "string" ? c.className : "";
      if (/ou-formsection__title/.test(cls)) items.push({ role: "heading", text: norm(c.textContent) });
      else if (/ou-formfield__lbl|ou-field__label|ou-switch-field__label/.test(cls)) items.push({ role: "label", text: norm(c.textContent) });
      else if (/ou-formfield__desc|ou-field__hint|ou-switch-field__desc/.test(cls)) items.push({ role: "hint", text: norm(c.textContent) });
      else if (/ou-empty__title/.test(cls)) items.push({ role: "empty", text: norm(c.textContent) });
      else if (/ou-banner__desc/.test(cls)) items.push({ role: "banner", text: norm(c.textContent) });
      else {
        const kind = KIND(c);
        if (kind === "table") {
          items.push({ role: "table", text: [...c.querySelectorAll("th")].map((th) => norm(th.textContent)).join(" | ") });
          continue;
        }
        if (kind === "button" && !/ou-tabs__tab|ou-drawer__rail-item/.test(cls)) {
          const variant = (cls.match(/ou-btn--(primary|secondary|ghost|destructive)/) || [])[1] || "";
          items.push({ role: "button", text: norm(c.textContent), variant });
        } else if (kind) {
          items.push({ role: "control", text: kind });
        }
      }
      visit(c);
    }
  };
  visit(root);
  return items;
}`;
```

- [ ] **Шаг 2: проверить съём на эскизе**

```bash
node -e "
const {launch}=await import('./scripts/check/editor-conformance/cdp.mjs');
const {startStaticServer}=await import('./scripts/check/editor-conformance/static-server.mjs');
const {EXTRACT}=await import('./scripts/check/editor-conformance/inventory.mjs');
const s=await startStaticServer(0); const b=await launch();
await b.goto('http://127.0.0.1:'+s.port+'/docs/wireframes/editor-settings-target.html');
console.log((await b.evaluate(EXTRACT)||[]).slice(0,15));
await b.close(); await s.close();
" --input-type=module
```

Ожидается: массив записей с `role: "heading"` и текстами разделов вкладки «Основное»
(«О тесте», «Интеграция») — то есть съём видит именно то, чего в реализации нет.

- [ ] **Шаг 3: коммит**

```bash
git add scripts/check/editor-conformance/inventory.mjs
git commit -m "feat(editor-ui): структурная опись панели настроек"
```

### Задача 3.2. Сравнение и базовая линия

**Файлы:**

- Создать: `scripts/check/editor-conformance/diff.mjs`
- Создать: `tests/editor-conformance/diff.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
// tests/editor-conformance/diff.test.ts
import { describe, expect, it } from "vitest";
import { diffInventories, applyBaseline } from "../../scripts/check/editor-conformance/diff.mjs";

const WF = [
  { role: "heading", text: "О тесте" },
  { role: "label", text: "Название" },
  { role: "label", text: "Описание" },
];
const IMPL = [
  { role: "label", text: "Название" },
  { role: "label", text: "Описание" },
];

describe("diffInventories", () => {
  it("сообщает о пропавшем заголовке раздела", () => {
    const d = diffInventories(WF, IMPL);
    expect(d).toEqual([{ op: "missing", role: "heading", text: "О тесте", index: 0 }]);
  });

  it("сообщает о лишнем элементе", () => {
    const d = diffInventories(WF, [...WF, { role: "hint", text: "Оставьте пустым" }]);
    expect(d).toEqual([{ op: "extra", role: "hint", text: "Оставьте пустым", index: 3 }]);
  });

  it("замечает переставленные элементы", () => {
    const d = diffInventories(WF, [WF[0], WF[2], WF[1]]);
    expect(d.some((x) => x.op === "order")).toBe(true);
  });
});

describe("applyBaseline", () => {
  it("гасит известное расхождение и отмечает его как встреченное", () => {
    const diff = diffInventories(WF, IMPL);
    const baseline = [{ op: "missing", role: "heading", text: "О тесте", index: 0, finding: "A-3" }];
    const { unexpected, stale } = applyBaseline(diff, baseline);
    expect(unexpected).toEqual([]);
    expect(stale).toEqual([]);
  });

  it("докладывает о новом расхождении вне базовой линии", () => {
    const { unexpected } = applyBaseline(diffInventories(WF, IMPL), []);
    expect(unexpected).toHaveLength(1);
  });

  it("докладывает об исчезнувшей записи базовой линии как о прогрессе", () => {
    const baseline = [{ op: "missing", role: "heading", text: "Интеграция", index: 9, finding: "A-4" }];
    const { stale } = applyBaseline([], baseline);
    expect(stale.map((s) => s.finding)).toEqual(["A-4"]);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npm test -- tests/editor-conformance/diff.test.ts
```

Ожидается: FAIL с ошибкой разрешения импорта.

- [ ] **Шаг 3: реализовать сравнение**

```js
#!/usr/bin/env node
/**
 * @module scripts/check/editor-conformance/diff
 * @description Pure comparison of two structural inventories against a baseline.
 *
 * Why this exists. A checker that simply prints differences is ignored the day it prints
 * two hundred of them. The baseline turns the backlog into a ratchet: known divergences are
 * listed with the finding id that owns them, anything else fails the build, and entries that
 * stop occurring are reported so they can be struck from the registry. That makes "the batch
 * is done" a machine verdict instead of an opinion.
 */

/** Stable key of one inventory item; index is deliberately excluded so order is a separate op. */
const keyOf = (i) => `${i.role}|${i.text}|${i.variant ?? ""}`;

/**
 * @param {Array<object>} wireframe Inventory taken on the wireframe.
 * @param {Array<object>} implementation Inventory taken on the live drawer.
 * @returns {Array<{op: string, role: string, text: string, index: number}>}
 */
export function diffInventories(wireframe, implementation) {
  const out = [];
  const implKeys = implementation.map(keyOf);
  const wfKeys = wireframe.map(keyOf);
  wireframe.forEach((item, i) => {
    if (!implKeys.includes(keyOf(item))) out.push({ op: "missing", role: item.role, text: item.text, index: i });
  });
  implementation.forEach((item, i) => {
    if (!wfKeys.includes(keyOf(item))) out.push({ op: "extra", role: item.role, text: item.text, index: i });
  });
  const common = wfKeys.filter((k) => implKeys.includes(k));
  const implCommon = implKeys.filter((k) => wfKeys.includes(k));
  for (let i = 0; i < common.length; i++) {
    if (common[i] !== implCommon[i]) {
      const [role, text] = common[i].split("|");
      out.push({ op: "order", role, text, index: i });
      break;
    }
  }
  return out;
}

/**
 * @param {Array<object>} diff Result of {@link diffInventories}.
 * @param {Array<object>} baseline Accepted divergences, each carrying its `finding` id.
 * @returns {{unexpected: Array<object>, stale: Array<object>}}
 */
export function applyBaseline(diff, baseline) {
  const seen = new Set();
  const unexpected = [];
  for (const d of diff) {
    const hit = baseline.find((b) => b.op === d.op && b.role === d.role && b.text === d.text);
    if (hit) seen.add(hit.finding);
    else unexpected.push(d);
  }
  const stale = baseline.filter((b) => !seen.has(b.finding));
  return { unexpected, stale };
}
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

```bash
npm test -- tests/editor-conformance/diff.test.ts
```

Ожидается: PASS, 6 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add scripts/check/editor-conformance/diff.mjs tests/editor-conformance/diff.test.ts
git commit -m "feat(editor-ui): сравнение описей с базовой линией"
```

### Задача 3.3. Карта состояний и снятие базовой линии

**Файлы:**

- Создать: `scripts/check/editor-conformance/map.json`
- Создать (генерацией): `scripts/check/editor-conformance/baseline.json`
- Изменить: `scripts/check/check-editor-conformance.mjs`

- [ ] **Шаг 1: заполнить карту**

Ключ — состояние эскиза, значение — как дойти до того же экрана в живом ящике.

```json
{
  "basic":         { "tab": "Основное",                "rail": null },
  "composition":   { "tab": "Состав и сценарий",       "rail": "Состав" },
  "scenario":      { "tab": "Состав и сценарий",       "rail": "Сценарий" },
  "adaptive":      { "tab": "Состав и сценарий",       "rail": "Адаптивные уровни", "testId": "6d1c9165-9569-4acb-8d76-e2b4e4b6d78f" },
  "rules":         { "tab": "Правила прохождения",     "rail": "Навигация" },
  "rules-during":  { "tab": "Правила прохождения",     "rail": "Во время прохождения" },
  "rules-limits":  { "tab": "Правила прохождения",     "rail": "Ограничения" },
  "rules-protect": { "tab": "Правила прохождения",     "rail": "Защита контента" },
  "answer":        { "tab": "Оценка результата",       "rail": "Оценка ответа" },
  "scoring":       { "tab": "Оценка результата",       "rail": "Вердикт" },
  "scales":        { "tab": "Оценка результата",       "rail": "Шкалы", "testId": "26553608-e1c6-428d-b09d-7b9939a526d8" },
  "metrics":       { "tab": "Оценка результата",       "rail": "Показатели", "testId": "26553608-e1c6-428d-b09d-7b9939a526d8" },
  "during":        { "tab": "Обратная связь и итоги",  "rail": "Во время теста" },
  "feedback":      { "tab": "Обратная связь и итоги",  "rail": "Состав итогов" },
  "texts":         { "tab": "Обратная связь и итоги",  "rail": "Обратная связь" },
  "report":        { "tab": "Обратная связь и итоги",  "rail": "Отчёт" },
  "design":        { "tab": "Оформление",              "rail": "Шаблон" },
  "design-colors": { "tab": "Оформление",              "rail": "Цвета" }
}
```

Состояния `s-labels`, `s-variants`, `s-qscoring*`, `s-topic-picker`, `s-report-palette`,
`s-metrics-number`, `s-metrics-builder`, `s-errors`, `s-dirty`, `s-changes`,
`s-empty-*` в карту не входят: это модалки и состояния, требующие взаимодействия. Они
остаются на ручной сверке по отчёту и закрываются партиями Э5-Э9 без машинного гейта.
Так честнее, чем делать вид, что гейт покрывает всё.

- [ ] **Шаг 2: дописать структурный проход в точку входа**

В `scripts/check/check-editor-conformance.mjs` дописать импорты и, после блока проверки
отступов (перед финальным `if (failures.length)`), вставить обход по карте:

```js
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { EXTRACT } from "./editor-conformance/inventory.mjs";
import { applyBaseline, diffInventories } from "./editor-conformance/diff.mjs";

const MAP = JSON.parse(readFileSync(join(REPO_ROOT, "scripts", "check", "editor-conformance", "map.json"), "utf8"));
const BASELINE_PATH = join(REPO_ROOT, "scripts", "check", "editor-conformance", "baseline.json");
const WRITE_BASELINE = process.env.EDITOR_UI_WRITE_BASELINE === "1";
const baseline = !WRITE_BASELINE && existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  : [];

/** Opens one state of the wireframe. The switcher only reacts to a click; it does not read the hash. */
const SHOW_STATE = (state) => `() => {
  const b = [...document.querySelectorAll(".wf-nav button")]
    .find((x) => (x.getAttribute("onclick") || "").includes("'${state}'"));
  if (!b) return false;
  b.click();
  return true;
}`;

const structural = [];
const collected = [];

for (const [state, target] of Object.entries(MAP)) {
  // 1. Опись эскиза.
  await browser.goto(`http://127.0.0.1:${server.port}/docs/wireframes/editor-settings-target.html`, 1500);
  if (!(await browser.evaluate(SHOW_STATE(state)))) {
    throw new Error(`в эскизе нет состояния ${state} — карта map.json разошлась с эскизом`);
  }
  await new Promise((r) => setTimeout(r, 400));
  const wfItems = await browser.evaluate(EXTRACT);

  // 2. Опись реализации. Тест берётся из карты, если состояние требует особых данных.
  await browser.goto(`${DEV}/author/tests`, 4000);
  await browser.clickSelector(`[data-testid="test-edit-${target.testId ?? TEST_ID}"]`, 3500);
  await browser.clickSelector(`#tab-${TAB_IDS[target.tab]}`, 1400);
  if (target.rail) {
    const railIndex = await browser.evaluate(`() => {
      const items = [...document.querySelectorAll(".ou-drawer__rail-item")];
      return items.findIndex((x) => x.textContent.trim() === ${JSON.stringify(target.rail)}) + 1;
    }`);
    if (!railIndex) throw new Error(`в ящике нет раздела «${target.rail}» на вкладке «${target.tab}»`);
    await browser.clickSelector(`.ou-drawer__rail-item:nth-of-type(${railIndex})`, 1100);
  }
  const implItems = await browser.evaluate(EXTRACT);

  // 3. Сравнение.
  for (const d of diffInventories(wfItems ?? [], implItems ?? [])) {
    collected.push({ ...d, state });
  }
}

if (WRITE_BASELINE) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(collected.map((c) => ({ ...c, finding: null })), null, 2)}\n`, "utf8");
  console.log(`Базовая линия записана: расхождений ${collected.length} -> ${BASELINE_PATH}`);
} else {
  const { unexpected, stale } = applyBaseline(collected, baseline);
  structural.push(...unexpected);
  if (stale.length) {
    console.log(`Прогресс: перестали воспроизводиться ${stale.length} — ${stale.map((s) => s.finding).join(", ")}`);
    console.log("Вычистите их из baseline.json и переведите находки в status: \\"fixed\\".");
  }
}
```

Вкладки открываются по устойчивому `id`, а не по порядковому номеру: порядковый номер
поедет от первой же перестановки. Рядом с `MAP` объявляется соответствие подписи и
идентификатора вкладки — значения взяты из разметки риббона `test-editor.tsx` и проверены
в живом DOM 2026-09-04:

```js
const TAB_IDS = {
  "Основное": "main",
  "Состав и сценарий": "composition",
  "Правила прохождения": "rules",
  "Оценка результата": "scoring",
  "Обратная связь и итоги": "feedback",
  "Оформление": "design",
  "Комментарии": "review",
};
```

Соответственно клик по вкладке пишется просто:

```js
await browser.clickSelector(`#tab-${TAB_IDS[target.tab]}`, 1400);
```

Финальный блок гейта дополняется структурной частью:

```js
if (failures.length || structural.length) {
  if (structural.length) {
    console.error(`Структура разошлась с эскизом вне базовой линии: ${structural.length}`);
    for (const s of structural) {
      console.error(`  [${s.state}] ${s.op}: ${s.role} «${s.text}»`);
    }
  }
  process.exit(1);
}
console.log(`OK: отступов ${expectations.length}, структура — известных ${baseline.length}, новых 0.`);
```

- [ ] **Шаг 3: снять базовую линию**

```bash
EDITOR_UI_WRITE_BASELINE=1 npm run check:editor-ui
```

Ожидается: файл `scripts/check/editor-conformance/baseline.json` создан, в нём порядка
двухсот записей, гейт завершается кодом 0 с сообщением о записанной базовой линии.

- [ ] **Шаг 4: понять, что базовая линия — не второй реестр**

Первая редакция плана требовала проставить каждой записи базовой линии поле `finding` из
реестра. Снятая линия показала, что требование неверно по существу, а не только трудоёмко:

- записей 376 против 231 находки, потому что опись мельче отчёта — одна находка вроде
  «раздел потерял заголовок» даёт и пропавший заголовок, и сдвиг порядка соседей;
- состояния `scales`, `metrics` и `adaptive` снимаются на ДРУГИХ тестах, и часть их
  расхождений — разница данных, а не кода. Приписать такой записи номер находки нельзя,
  потому что находки за ней нет.

Поэтому поле `finding` остаётся необязательным, а базовая линия выполняет ровно одну работу —
храповик: не допустить НОВОГО расхождения и показать исчезнувшие. Авторитетный список к работе
по-прежнему один — реестр находок из отчёта приёмки.

```bash
node -e "
const b=require('./scripts/check/editor-conformance/baseline.json');
const by=(k)=>Object.entries(b.reduce((a,x)=>{a[x[k]]=(a[x[k]]||0)+1;return a},{})).sort((a,b)=>b[1]-a[1]);
console.log('записей', b.length, '| по операции:', by('op').map(([k,v])=>k+':'+v).join(' '));
"
```

Ожидается: около 376 записей, преобладает `missing`. Резкий рост при следующем снятии —
признак того, что опись начала ловить данные вместо контракта; чинить `inventory.mjs`.

- [ ] **Шаг 5: убедиться, что гейт зелёный на текущем коде**

```bash
npm run check:editor-ui
```

Ожидается: код 0, сообщение вида `OK: отступы без расхождений; структура — известных N,
новых 0`.

- [ ] **Шаг 6: коммит**

```bash
git add scripts/check/editor-conformance/map.json scripts/check/editor-conformance/baseline.json \
  scripts/check/check-editor-conformance.mjs
git commit -m "feat(editor-ui): базовая линия структурных расхождений ящика"
```

---

## Э4-Э9. Партии правок

Все шесть партий устроены одинаково, поэтому протокол задачи описан один раз и применяется
к каждой. Отличаются только выборка из реестра, список файлов и образец правки.

### Протокол партии

- [ ] **Шаг 1: выбрать записи партии**

```bash
node -e "
const r=require('./docs/reports/editor-drawer-wireframe-acceptance.findings.json');
const b=process.env.B;
r.filter(x=>x.batch===b&&x.status==='open').forEach(x=>console.log(x.id,'|',x.severity,'|',x.place,'\n   эскиз:',x.expected,'\n   сейчас:',x.actual,'\n   код:',x.code));
"
```

- [ ] **Шаг 2: править по одной записи, значение брать из колонки «Эскиз»**

Ни одна правка не делается «по смыслу»: текст, вариант кнопки, тип контрола и порядок
берутся из реестра дословно. Если запись реестра непонятна — открыть соответствующее
состояние эскиза и посмотреть на него, а не додумать.

- [ ] **Шаг 3: проверить типы**

```bash
npm run check
```

- [ ] **Шаг 4: прогнать целевые тесты затронутых файлов**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__
npm test -- client/src/features/tests/review
```

Падение теста, ассертящего старую подпись, — ожидаемо: обновить ожидание теста под эскиз.
Падение теста, ассертящего поведение, — сигнал, что правка сломала логику: разбираться.

- [ ] **Шаг 5: прогнать гейт**

```bash
npm run check:editor-ui
```

Ожидается: `новых 0`, а в списке `stale` — ровно идентификаторы записей этой партии.
Появление хотя бы одной новой записи означает, что правка внесла регрессию: чинить до
коммита.

- [ ] **Шаг 6: вычистить закрытые записи из базовой линии и реестра**

```bash
node -e "
const fs=require('fs');
const B=process.env.B;
const rp='docs/reports/editor-drawer-wireframe-acceptance.findings.json';
const bp='scripts/check/editor-conformance/baseline.json';
const r=JSON.parse(fs.readFileSync(rp,'utf8'));
const done=new Set(r.filter(x=>x.batch===B).map(x=>x.id));
r.forEach(x=>{ if(done.has(x.id)) x.status='fixed'; });
const b=JSON.parse(fs.readFileSync(bp,'utf8')).filter(x=>!done.has(x.finding));
fs.writeFileSync(rp, JSON.stringify(r,null,2)+'\n');
fs.writeFileSync(bp, JSON.stringify(b,null,2)+'\n');
console.log('закрыто', done.size, 'осталось в базовой линии', b.length);
"
```

- [ ] **Шаг 7: коммит**

```bash
git add -A client/src scripts/check/editor-conformance/baseline.json \
  docs/reports/editor-drawer-wireframe-acceptance.findings.json
git commit -m "fix(editor-ui): <партия>, закрыто находок N"
```

### Э4. Партия «разделы и заголовки» (`B=sections`)

**Файлы:** `sections/basic-settings-section.tsx`, `sections/editor-tabs.tsx`,
`sections/topics-structure-section.tsx`, `sections/result-variables-section.tsx`,
`sections/question-feedback-registry.tsx`, `sections/topic-feedback-card.tsx`,
`sections/breakdown-feedback-card.tsx`, `sections/report-settings-card.tsx`,
`sections/design-section.tsx`, `../review/review-comment-form.tsx`.

Образец правки — вернуть раздел там, где поля идут голым потоком:

```tsx
// Было: поля лежат прямо во фрагменте панели.
// Стало: раздел эскиза с заголовком. FormSection из ui-kit даёт ровно
// ou-formsection--stacked + h3.ou-formsection__title, которых требует эскиз.
<FormSection title="О тесте" stacked>
  <Input label="Название" required value={model.title} onChange={onTitle} />
  <Textarea label="Описание" rows={3} value={model.description} onChange={onDescription} />
  <SegmentedControl aria-label="Режим теста" options={MODE_OPTIONS} value={model.mode} onChange={onMode} />
</FormSection>
```

Обратный образец — снять карточку там, где эскиз её не рисует (находки D-6, E-25): заменить
`<Card variant="outlined" size="sm"><CardHeader title="…" />…</Card>` на
`<FormSection title="…" stacked>…</FormSection>`.

Отдельные две записи партии — F-4 и F-5: панели «Оформления» обёрнуты в собственные
`div[data-testid]`, из-за чего правило `.tb-settings-content > *` до их блоков не достаёт и
интервал 16 px пропадает, а липкий баннер «Шаблон обновлён» теряет полноширинное исполнение.
Правка: снять лишнюю обёртку, перенеся `data-testid` на первый блок панели.

### Э5. Партия «подмены компонентов» (`B=components`)

**Файлы:** `sections/scales-section.tsx`, `sections/levels-editor.tsx`,
`sections/scoring-section.tsx`, `sections/scoring-builder.tsx`,
`sections/question-feedback-registry.tsx`, `sections/topics-structure-section.tsx`,
`../review/review-panel.tsx`.

Образец — вернуть DS-аккордеон вместо headless-примитива (находка G-7):

```tsx
// Было: Collapsible/CollapsibleTrigger/CollapsibleContent — примитив без CSS-слоя,
// класса .ou-collapsible в skillum-ds.css нет ни одного.
// Стало: аккордеон ДС, которого требует эскиз (ou-acc--separated + шеврон + подзаголовок).
<Accordion separated>
  <AccordionItem
    value={group.topicId}
    title={group.topicTitle}
    subtitle={`${group.questionCount} вопросов`}
    open={open}
    onOpenChange={() => fold.toggle(group.topicId)}
  >
    {rows}
  </AccordionItem>
</Accordion>
```

Перед правкой проверить сигнатуру компонента:

```bash
sed -n '1,80p' vendor/ui-kit/src/components/Accordion.tsx
```

Если у `Accordion` нет нужного свойства, добавить его в `vendor/ui-kit` — это редактируемая
зависимость, самодельная вёрстка вместо примитива ДС не допускается.

Остальные записи партии: ячейка вклада в шкалу — счётчик со степперами вместо `Input`
(D-32); таблица весов опций — `table.tb-table.tb-weights` вместо сетки из `div` с
инлайновыми стилями (D-37); реестр обратной связи вопросов — таблица с колонками «Вопрос»,
«Режим», «Текст» и колонкой действия вместо строк-`div` (E-7); исход комментария —
`SegmentedControl` с подписью поля «Исход» вместо двух кнопок (F-22); список тем — аккордеон,
свёрнутый по умолчанию (B-7).

### Э6. Партия «блок квот» (`B=quotas`)

**Файлы:** `sections/topics-structure-section.tsx`, `client/src/styles/tb-components.css`.

Это единственная партия, где перекладывается целый блок, поэтому она идёт отдельным
коммитом и отдельной сверкой. Эскиз (состояние `s-composition`, строки 710-792) рисует не
таблицу, а карточки: `h5` с именем подтемы, подзаголовок-сводка вида
`ровно 4 · доступно 11 · в вариантах A: 2 · B: 2`, действия «Удалить квоту «…»» и
«Свернуть квоту «…»», тело — группа в две колонки и группа в три колонки, над списком —
панель «Развернуть все» / «Свернуть все».

- [ ] **Дополнительный шаг: сверить кадром**

После правки открыть состояние `s-composition` эскиза и раздел «Состав» живого ящика,
снять оба кадра в `.playwright-mcp/` и сверить поэлементно: имя подтемы, состав
подзаголовка, обе группы полей, обе кнопки строки, панель свёртки. Расхождение — не
закрывать партию.

### Э7. Партия «потерянные действия и состояния» (`B=actions`)

**Файлы:** `sections/topics-structure-section.tsx`, `sections/basic-settings-section.tsx`,
`sections/scoring-section.tsx`, `sections/result-variables-section.tsx`,
`sections/results-labels-pane.tsx`, `sections/breakdown-feedback-card.tsx`,
`sections/level-feedback-card.tsx`, `sections/report-block-palette.tsx`,
`test-editor.tsx`, `../review/review-panel.tsx`, `../review/review-comment-form.tsx`.

Крупные записи, каждая — самостоятельный элемент, а не текст:

- поле «Поиск темы» в шапке раздела «Состав» (B-2);
- пары «Развернуть все» / «Свернуть все» в списке тем, блоке квот, адаптивных темах,
  разделах «По подтемам» и «По уровням» (B-6, B-14, B-30, E-19);
- тег состояния в шапке ящика по `combinedDirty`, а не по `editor.isDirty` (A-8), и тег
  «Изменено» в подвале (A-9);
- блок «Что получится» в конструкторе формулы (D-54) и тег «задано в тесте» у
  переопределённой строки оценки (D-2);
- разделы «По уровням шкал» и «По уровням показателей» обратной связи (E-17), показ раздела
  «По уровням» и для стандартного теста (E-18);
- колонка живого превью в палитре блоков отчёта и её размер `xl` (E-32, E-33);
- кнопка «Следующий комментарий» (F-10), аватары авторов (F-12), второе поле якоря «Вопрос
  или страница» (F-18), карточка «Новый комментарий» с заголовком (F-17).

Запись E-18 меняет условие показа, поэтому к ней обязателен тест:

```tsx
it("показывает раздел «По уровням» и стандартному тесту", () => {
  render(<FeedbackTab model={{ ...baseModel, mode: "standard" }} {...handlers} />);
  expect(screen.getByRole("heading", { name: "По уровням" })).toBeInTheDocument();
});
```

### Э8. Партия «тексты и порядок» (`B=texts`)

**Файлы:** все `sections/*.tsx` участка, `test-editor.tsx`,
`test-editor.validation.ts`, `../review/*.tsx`.

Самая массовая и самая механическая партия: подписи, подсказки, плейсхолдеры и порядок
элементов приводятся к эскизу дословно. Две записи важнее прочих:

- **A-5**: сообщения валидации выводятся по-английски («Test title is required.»,
  «Webhook URL must be a valid HTTP or HTTPS URL.»). Заменить на формулировки эскиза
  «Название обязательно.» и текст поля Webhook по состоянию `s-errors`.
- **B-22**: в тексте пустого состояния тем печатается код требования «(FR-12)». Коды
  требований пользователю не показываются — заменить текст на формулировку эскиза целиком.

Порядковые записи (C-2, C-10, E-9, E-16, F-11, B-47, D-52) — перестановка без изменения
логики; после каждой прогнать целевые тесты, потому что часть тестов ищет элементы по
индексу.

### Э9. Партия «иконки, размеры, aria» (`B=cosmetics`)

**Файлы:** все файлы участка.

Записи мелкие и независимые: не та иконка, не тот размер контрола, потерянный `aria-label`,
лишний разделитель, не тот вариант кнопки. Правятся пачкой, принимаются гейтом и целевыми
тестами. Отдельно проверить A-10: точка состояния должна стать `tb-status-dot--warn`
диаметром 12 px жёлтого тона, а не `status-dot dirty` 8 px акцентного.

---

## Э10. Решения владельца

### Задача 10.1. Собрать вопросы и получить ответы

**Файлы:** только чтение.

- [ ] **Шаг 1: выписать вопросы владельцу**

Источников два, и оба ведутся машиной, а не памятью:

```bash
node -e "
const r=require('./docs/reports/editor-drawer-wireframe-acceptance.findings.json');
r.filter(x=>x.batch==='owner').forEach(x=>console.log(x.id,'|',x.severity,'|',x.place,'\n   в эскизе:',x.expected,'\n   в ДС:   ',x.actual));
"
```

1. Раздел «Расхождения внутри самого эскиза, требующие решения владельца» отчёта приёмки —
   одиннадцать пунктов: десять нашла приёмка, одиннадцатый (`.ou-acc__body`: токен 16 px
   против комментария 4 px) нашёл сверщик отступов при разборе эскиза.
2. Участок W реестра — двенадцать выдуманных классов дизайн-системы в эскизах трека,
   найденных пятой категорией `npm run check:wireframes:ds`. Их нельзя починить в коде,
   только в рисунке и только после согласования.

Каждый пункт — вопрос с вариантами и текущим поведением реализации.

- [ ] **Шаг 2: задать вопросы владельцу пачкой, а не по одному**

Объявить число вопросов, задать их списком, дождаться ответов. Без ответов задача 10.2 не
начинается.

### Задача 10.2. Внести решения в эскиз и переутвердить

**Файлы:**

- Изменить: `docs/wireframes/editor-settings-target.html` — только после письменного решения
- Изменить: `docs/reports/editor-drawer-wireframe-acceptance.findings.json`

- [ ] **Шаг 1: править эскиз по решениям**

Это единственное место плана, где эскиз правится. Каждая правка снабжается комментарием в
разметке: какое противоречие снято и каким решением.

- [ ] **Шаг 2: прогнать линтер эскизов**

```bash
node scripts/docs/check-wireframes-ds.mjs 2>&1 | grep editor-settings-target
```

Ожидается: ни одной строки по этому файлу.

- [ ] **Шаг 3: привести реализацию к решению там, где она разошлась**

- [ ] **Шаг 4: прогнать гейт**

```bash
npm run check:editor-ui
```

Ожидается: `новых 0`. Правка эскиза меняет ожидания, поэтому гейт обязан пройти именно
после того, как реализация подтянута под решение.

- [ ] **Шаг 5: коммит**

```bash
git add docs/wireframes/editor-settings-target.html client/src docs/reports
git commit -m "docs(wireframes): снять противоречия целевого эскиза по решениям владельца"
```

---

## Э11. Закрытие

### Задача 11.1. Убедиться, что не осталось открытых находок

**Файлы:** только чтение.

- [ ] **Шаг 1: проверить реестр**

```bash
node -e "
const r=require('./docs/reports/editor-drawer-wireframe-acceptance.findings.json');
const open=r.filter(x=>x.status==='open');
console.log('всего', r.length, 'закрыто', r.filter(x=>x.status==='fixed').length, 'открыто', open.length);
open.forEach(x=>console.log('  ОТКРЫТО', x.id, x.severity, x.place));
"
```

Ожидается: `открыто 0`. Любая открытая запись должна быть либо исправлена, либо переведена
в `status: "deferred"` с полем `reason` и решением владельца — молча оставлять открытой
нельзя.

- [ ] **Шаг 2: проверить, что базовая линия пуста**

```bash
node -e "
const b=require('./scripts/check/editor-conformance/baseline.json');
console.log(b.length? 'осталось известных расхождений: '+b.length : 'базовая линия пуста');
"
```

Ожидается: `базовая линия пуста`. Непустая базовая линия допустима только если в ней
остались записи, соответствующие `deferred`-находкам.

### Задача 11.2. Включить гейт в общую проверку

**Файлы:**

- Изменить: `package.json`

- [ ] **Шаг 1: дописать гейт в `check:guards`**

```json
"check:guards": "npm run check:author-numbers && npm run check:contrast && npm run check:editor-ui"
```

- [ ] **Шаг 2: прогнать связку**

```bash
npm run check:guards
```

Ожидается: три `OK` подряд и код 0. Гейт требует поднятого `npm run dev` — это записать в
`CLAUDE.md` рядом с описанием команд.

- [ ] **Шаг 3: коммит**

```bash
git add package.json CLAUDE.md
git commit -m "chore(editor-ui): включить сверку ящика с эскизом в check:guards"
```

### Задача 11.3. Полный прогон тестов

- [ ] **Шаг 1: спросить разрешение**

Полный `npm test` занимает около восьми минут и занимает машину, на которой работают другие
сессии. Запускать только после явного «да».

- [ ] **Шаг 2: прогнать**

```bash
npm test
```

Ожидается: 0 падений. Число файлов и тестов записать в отчёт — оно вырастет на три файла
тестов сверщика.

- [ ] **Шаг 3: проверка типов**

```bash
npx tsc --build --force
```

Ожидается: без ошибок.

### Задача 11.4. Отчёт и приёмка

**Файлы:**

- Создать: `docs/reports/editor-drawer-conformance-fix-report.md`

- [ ] **Шаг 1: написать отчёт**

Обязательные разделы: точка отсчёта (хеш из задачи 0.1), закрытые находки по партиям,
отложенные с причинами и решениями владельца, что теперь проверяет машина и чего она не
видит (модалки и состояния взаимодействия из задачи 3.3, шаг 1), результаты прогонов с
числами.

- [ ] **Шаг 2: прогнать линтер разметки**

```bash
npm run lint:md
```

Ожидается: `0 issues`.

- [ ] **Шаг 3: показать владельцу и получить приёмку**

Приёмка считается пройденной, только когда владелец посмотрел живой ящик, а не отчёт.

- [ ] **Шаг 4: коммит**

```bash
git add docs/reports/editor-drawer-conformance-fix-report.md
git commit -m "docs(editor-ui): отчёт о приведении ящика редактора к эскизу"
```

---

## Что этот план сознательно не покрывает

Честный список, чтобы он не выдавался за полноту:

- Модалки («Оценка вопроса в тесте», «Настроить варианты…», «Добавить тему», «Добавить
  блок», редактор обратной связи) и состояния, требующие взаимодействия (грязный черновик,
  блокирующая валидация, поповер изменений, диалоги закрытия и конфликта, оверлей
  сохранения) машинным гейтом не покрываются. Их находки закрываются партиями Э5-Э9 и
  сверяются вручную по отчёту.
- Мобильная раскладка (правила NFR-19 - NFR-21, ширина окна меньше 960 px) в отчёте
  приёмки не проверялась и в этом плане не чинится — это отдельная работа.
- Тёмная тема: живой ящик снимался в тёмной теме, эскиз нарисован в светлой. Цветовые
  расхождения токенов в находки не попадали и здесь не правятся.
- Содержимое разделов «Макет», «Брендирование», «Вид диаграмм», «Облик отчёта» приходит из
  манифеста шаблона и в целевом эскизе не нарисовано ни разу. Сверять нечем; при
  необходимости это отдельная работа по дорисовке эскиза.
