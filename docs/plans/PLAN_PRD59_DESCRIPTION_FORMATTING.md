# PRD-59. Форматирование описания теста — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Цель:** описание теста получает три режима ввода («Простой текст», «Форматированный», «HTML»),
и заданное автором оформление доходит до стартового экрана трёх шаблонов на обоих хостах.

**Устройство:** `tests.description` остаётся исходником, формат живёт в новой колонке
`tests.description_format`. Разметку строит существующая `richTextToHtml`, очистку — новая
`richTextToPlain` из того же модуля. В контекст рендера разметка едет ПАРНЫМ полем
`course.descriptionHtml` рядом с `course.description`, поэтому старые шаблоны не ломаются.

**Технологии:** TypeScript, Drizzle ORM + PostgreSQL, React 19, `@skillum/ui-kit` (редактируемая
зависимость в `vendor/ui-kit`), Vitest, движок шаблонов `shared/template`.

**Спецификация:** [docs/specs/prd-59/test-description-formatting.md](../specs/prd-59/test-description-formatting.md).

---

## Правила прогона

- Тесты запускать ТОЛЬКО через `npm test -- <путь>`; `npx vitest run` в этом репозитории падает.
- Полный прогон (`npm test` без пути) не запускать без явного разрешения владельца.
- `npm run check` использует общий с другими worktree кэш `.tsbuildinfo` и может соврать зелёным;
  при сомнении удалить `tsconfig.tsbuildinfo` перед запуском.
- Коммиты — после каждой задачи, по-русски, без трейлера `Co-Authored-By`.

## Состав файлов

| Файл | Ответственность |
| --- | --- |
| `shared/template/rich-text.ts` | Политика формата: исходник → разметка и исходник → плоский текст. Изменяется |
| `shared/template/rich-text.test.ts` | Тесты обеих функций. Создаётся |
| `shared/schema.ts` | Колонка `description_format` в таблице `tests`. Изменяется |
| `drizzle/0035_prd59_description_format.sql` | Миграция. Создаётся генератором |
| `tests/it/schema.sql` | Схема для pglite. Пересобирается |
| `server/routes/tests.ts` | Приём поля в POST/PUT. Изменяется |
| `server/services/test-settings.ts` | Запись поля и очистка разметки на сервере. Изменяется |
| `server/utils/workbook-settings.ts` | Параметр «Формат описания» листа «Настройки». Изменяется |
| `shared/template/context.ts` | Поле `course.descriptionHtml`. Изменяется |
| `shared/template/start-state.ts` | Сборка парного поля. Изменяется |
| `client/src/pages/learner/take-test.tsx` | Передача формата веб-хостом. Изменяется |
| `server/scorm/builders/test-json.ts` | Формат в `test.json`. Изменяется |
| `server/scorm/template/app/render/startPage.js` | Передача формата рантаймом пакета. Изменяется |
| `server/scorm/templates/default/layouts/start*.html`, `styles/theme.css` | Макет и оформление. Изменяются |
| `templates/certification/layouts/start*.html`, `styles/theme.css` | То же. Изменяются |
| `server/email.ts` | Разметка в HTML-части, плоский текст в текстовой. Изменяется |
| `server/scorm/builders/metadata.ts` | Плоский текст в XML. Изменяется |
| `client/src/pages/learner/test-list.tsx` | Одна строка с обрезом в карточке. Изменяется |
| `vendor/ui-kit/src/components/RichTextEditor.tsx` | Режим «значение — исходник». Изменяется |
| `docs/wireframes/prd59-description-field.html` | Эскиз подраздела «Основное». Создаётся |
| `client/src/features/tests/editor/sections/basic-settings-section.tsx` | Поле в ящике. Изменяется |
| `client/src/features/tests/editor/test-editor.types.ts`, `.mappers.ts` | Модель и маппинг. Изменяются |
| `docs/specs/spec-template-platform.md`, `docs/guides/template-development.md` | Контракт 3.4.0. Изменяются |

---

## Задача 1. Плоская проекция разметки

Реализует FR-18. Функция чистая, без DOM и Node: её зовут сервер при сборке пакета, браузерный
редактор и рантайм SCORM-пакета.

**Файлы:**

- Изменить: `shared/template/rich-text.ts`
- Создать: `shared/template/rich-text.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Создать `shared/template/rich-text.test.ts`:

```ts
/**
 * @module shared/template/rich-text.test
 * @description PRD-59 FR-18: markup -> plain text with line breaks preserved.
 */
import { describe, it, expect } from "vitest";
import { richTextToPlain } from "./rich-text";

describe("richTextToPlain", () => {
  it("returns plain source untouched, newlines and all", () => {
    expect(richTextToPlain("Первая строка\nВторая строка", "plain")).toBe(
      "Первая строка\nВторая строка",
    );
  });

  it("treats an absent format as plain", () => {
    expect(richTextToPlain("Текст\nещё", undefined)).toBe("Текст\nещё");
  });

  it("turns paragraph boundaries into line breaks", () => {
    expect(richTextToPlain("<p>Первый</p><p>Второй</p>", "richText")).toBe("Первый\nВторой");
  });

  it("turns <br> into a line break", () => {
    expect(richTextToPlain("Строка<br>Другая", "html")).toBe("Строка\nДругая");
  });

  it("turns list items into separate lines", () => {
    expect(richTextToPlain("<ul><li>Паспорт</li><li>Доступ</li></ul>", "richText")).toBe(
      "Паспорт\nДоступ",
    );
  });

  it("drops inline tags but keeps their text", () => {
    expect(richTextToPlain("<p>Курс для <strong>новых</strong> сотрудников</p>", "richText")).toBe(
      "Курс для новых сотрудников",
    );
  });

  it("decodes named and numeric entities", () => {
    expect(richTextToPlain("<p>&laquo;Ремонт&raquo; &amp; &#1090;&#1077;&#1089;&#1090;</p>", "html")).toBe(
      "«Ремонт» & тест",
    );
  });

  it("collapses three or more line breaks into two", () => {
    expect(richTextToPlain("<p>А</p><p></p><p></p><p>Б</p>", "richText")).toBe("А\n\nБ");
  });

  it("returns an empty string for empty input", () => {
    expect(richTextToPlain("   ", "richText")).toBe("");
    expect(richTextToPlain(null, "html")).toBe("");
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- shared/template/rich-text.test.ts`

Ожидается: FAIL, `richTextToPlain is not a function`.

- [ ] **Шаг 3: реализовать функцию**

Дописать в конец `shared/template/rich-text.ts`:

```ts
/** Closing tags that end a visual block — each becomes a line break. */
const BLOCK_END = /<\/(?:p|div|li|ul|ol|h[1-6]|blockquote|section|article|tr|figure)\s*>/gi;

/** Explicit line break. */
const LINE_BREAK = /<br\s*\/?>/gi;

/** Anything else in angle brackets — dropped, its text content stays. */
const ANY_TAG = /<[^>]*>/g;

/**
 * Named entities the author's editor can produce. A short closed table on purpose:
 * the module is dependency-free, and an unknown name is left as written rather than
 * guessed at.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
  laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…",
};

/** Expands `&amp;`, `&#1090;` and `&#x43f;`; leaves an unknown name as it stands. */
function decodeEntities(value: string): string {
  return value.replace(/&(#[Xx]?[0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Author's text as a reader without markup sees it: the e-mail's text part, the
 * package's XML metadata, the editor's mode switch.
 *
 * Line breaks are the point of this function. Stripping tags through `textContent`
 * glues paragraphs into one line, and an author who laid a description out in three
 * paragraphs gets a single run of words in the letter — which is exactly the defect
 * this closes.
 *
 * @param text Author's text.
 * @param format Its format. Absent or `plain` = already plain: returned as written.
 * @returns Plain text; empty when there is nothing to print.
 */
export function richTextToPlain(text: unknown, format?: RichTextFormat | null): string {
  const source = typeof text === "string" ? text : "";
  if (!source.trim()) return "";
  if (format !== "richText" && format !== "html") return source;
  const broken = source.replace(LINE_BREAK, "\n").replace(BLOCK_END, "\n");
  return decodeEntities(broken.replace(ANY_TAG, ""))
    .replace(/\r\n|\r/g, "\n")
    .replace(/[ \t\u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Запустить: `npm test -- shared/template/rich-text.test.ts`

Ожидается: PASS, 9 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add shared/template/rich-text.ts shared/template/rich-text.test.ts
git commit -m "feat(prd-59): плоская проекция разметки с сохранением переводов строк"
```

---

## Задача 2. Одна строка с обрезом для карточки

Реализует FR-21. Отдельная функция, а не параметр первой: у карточки политика ОБРАТНАЯ —
переводы строк там не нужны.

**Файлы:**

- Изменить: `shared/template/rich-text.ts`
- Изменить: `shared/template/rich-text.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Дописать в `shared/template/rich-text.test.ts`:

```ts
import { richTextToOneLine } from "./rich-text";

describe("richTextToOneLine", () => {
  it("collapses line breaks into spaces", () => {
    expect(richTextToOneLine("<p>Первый</p><p>Второй</p>", "richText")).toBe("Первый Второй");
  });

  it("keeps a short text whole, without an ellipsis", () => {
    expect(richTextToOneLine("Короткое описание.", "plain")).toBe("Короткое описание.");
  });

  it("cuts at a word boundary and marks the cut", () => {
    const long = "Курс для новых сотрудников компании, перед началом подготовьте паспорт данных и доступ к порталу обучения";
    const out = richTextToOneLine(long, "plain", 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out).toBe("Курс для новых сотрудников компании…");
  });

  it("cuts inside a word when there is no space to cut at", () => {
    expect(richTextToOneLine("Абвгдеёжзийклмн", "plain", 5)).toBe("Абвгд…");
  });

  it("returns an empty string for empty input", () => {
    expect(richTextToOneLine("", "richText")).toBe("");
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- shared/template/rich-text.test.ts`

Ожидается: FAIL, `richTextToOneLine is not a function`.

- [ ] **Шаг 3: реализовать функцию**

Дописать в конец `shared/template/rich-text.ts`:

```ts
/** Default cut for the learner card's subtitle (PRD-59 FR-21). */
export const ONE_LINE_LIMIT = 120;

/**
 * Author's text as an INDEX ENTRY: one line, no markup, no line breaks, cut to
 * length. The learner's test card is the only consumer.
 *
 * The card is not a reading surface. Its list is laid out as a grid, and a grid row
 * takes the height of its tallest card — so one long description lifts the whole row.
 * Cutting by LENGTH rather than by rendered lines keeps the result independent of the
 * card's width and of how a browser counts lines inside nested blocks.
 *
 * @param text Author's text.
 * @param format Its format.
 * @param limit Characters to keep; the ellipsis is added on top of it.
 * @returns One line, ending in an ellipsis when something was dropped.
 */
export function richTextToOneLine(
  text: unknown,
  format?: RichTextFormat | null,
  limit: number = ONE_LINE_LIMIT,
): string {
  const flat = richTextToPlain(text, format).replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  const head = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return head.replace(/[\s.,;:!?-]+$/u, "") + "…";
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Запустить: `npm test -- shared/template/rich-text.test.ts`

Ожидается: PASS, 14 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add shared/template/rich-text.ts shared/template/rich-text.test.ts
git commit -m "feat(prd-59): однострочная проекция описания для карточки"
```

---

## Задача 3. Колонка формата в базе

Реализует FR-02 и FR-03.

**ГОЧА:** миграцию, написанную руками, `npm run db:migrate` пропускает МОЛЧА — применяются только
записи из `drizzle/meta/_journal.json`, а их создаёт генератор. Вывод при этом бодрый, а колонки
в базе нет.

**Файлы:**

- Изменить: `shared/schema.ts:520`
- Создать: `drizzle/0035_*.sql` (генератором)
- Изменить: `tests/it/schema.sql`

- [ ] **Шаг 1: добавить колонку в модель**

В `shared/schema.ts`, сразу после `description: text("description"),` в таблице `tests`:

```ts
  /**
   * PRD-59 FR-02: the format `description` is written in. The column holds the
   * FORMAT only — the text itself stays the author's source in `description`, so
   * every plain consumer (the letter's text part, the package's XML metadata, the
   * Excel workbook) keeps reading what it always read.
   *
   * The spelling repeats `feedbackContentSchema.format` deliberately: a second
   * vocabulary of formats in the product is how two screens start disagreeing about
   * what «Форматированный» means.
   */
  descriptionFormat: text("description_format", {
    enum: ["plain", "richText", "html"],
  }).notNull().default("plain"),
```

- [ ] **Шаг 2: сгенерировать миграцию**

Запустить: `npx drizzle-kit generate --name prd59_description_format`

Ожидается: создан `drizzle/0035_prd59_description_format.sql` и новая запись в
`drizzle/meta/_journal.json` с `"idx": 35`.

- [ ] **Шаг 3: дописать пояснение в миграцию**

В начало `drizzle/0035_prd59_description_format.sql`, ПЕРЕД сгенерированным `ALTER TABLE`:

```sql
-- PRD-59 FR-02/FR-03: формат, в котором написано описание теста.
--
-- Аддитивно: у всех существующих тестов формат `plain`, и это ровно их сегодняшнее
-- поведение — описание печатается как плоский текст. Сам текст не мигрируется:
-- колонка `description` остаётся исходником.
```

- [ ] **Шаг 4: применить миграцию**

Запустить: `npm run db:migrate`

Проверить: `docker exec test-builder-db psql -U test_builder -d test_builder -c "\d tests"`

Ожидается: в списке колонка `description_format | text | not null default 'plain'::text`.

- [ ] **Шаг 5: пересобрать схему для интеграционных тестов**

```bash
npx drizzle-kit export --sql > tests/it/schema.sql
```

**ГОЧА:** первой строкой команда кладёт `DATABASE_URL: postgresql://…`. Это не комментарий SQL,
pglite падает на нём с `syntax error at or near "DATABASE_URL"`, и валятся ВСЕ интеграционные
тесты сразу. Удалить первую строку, если она начинается с `DATABASE_URL:`, и убедиться, что файл
начинается с `CREATE TABLE`.

- [ ] **Шаг 6: проверить типы**

Запустить: `npm run check`

Ожидается: без ошибок.

- [ ] **Шаг 7: коммит**

```bash
git add shared/schema.ts drizzle/0035_prd59_description_format.sql drizzle/meta tests/it/schema.sql
git commit -m "feat(prd-59): колонка tests.description_format"
```

---

## Задача 4. Сервер принимает и чистит формат

Реализует FR-04 (часть про API), FR-23 и FR-24.

**Файлы:**

- Изменить: `server/routes/tests.ts:650` (схема тела запроса)
- Изменить: `server/services/test-settings.ts` (`create` и `update`)
- Создать: `server/services/__tests__/description-format.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Создать `server/services/__tests__/description-format.test.ts`:

```ts
/**
 * @module server/services/__tests__/description-format
 * @description PRD-59 FR-23/FR-24: description markup is sanitised on the server,
 * because the editor is not the only writer (workbook import, test transfer).
 */
import { describe, it, expect } from "vitest";
import { sanitizeDescription, DESCRIPTION_SCOPE } from "../description-format";

describe("sanitizeDescription", () => {
  it("leaves plain text untouched, script tag and all", () => {
    const raw = "Текст со словом <script> внутри";
    expect(sanitizeDescription(raw, "plain")).toBe(raw);
  });

  it("strips a script element from markup", () => {
    expect(sanitizeDescription("<p>Курс</p><script>alert(1)</script>", "richText")).toBe(
      "<p>Курс</p>",
    );
  });

  it("strips an inline event handler", () => {
    expect(sanitizeDescription('<p onclick="steal()">Курс</p>', "html")).not.toContain("onclick");
  });

  it("confines a pasted style block to the description's own region", () => {
    const out = sanitizeDescription("<style>body { display: none }</style><p>Курс</p>", "html");
    expect(out).toContain(DESCRIPTION_SCOPE);
    expect(out).not.toMatch(/(^|\s)body\s*\{/);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- server/services/__tests__/description-format.test.ts`

Ожидается: FAIL, `Cannot find module '../description-format'`.

- [ ] **Шаг 3: создать модуль очистки**

Создать `server/services/description-format.ts`:

```ts
/**
 * @module server/services/description-format
 * @description PRD-59 §8: the ONE place the test description's markup is cleaned.
 *
 * The description is written from more than one place — the editor's drawer, the
 * Excel workbook import, a test transfer — so cleaning on the client alone would
 * leave two of the three doors open. Every writer goes through here.
 *
 * The policy is not a new one: it is the same sanitiser the content-page fields use
 * (`shared/security/html-sanitize`), because the source is the same person — the
 * test's author — and one source must not be read two ways.
 */
import { sanitizeHtml } from "@shared/security/html-sanitize";
import type { RichTextFormat } from "@shared/template/rich-text";

/**
 * Region the description renders into. A pasted `<style>` is confined to it, so an
 * author's stray `body { … }` restyles their description instead of the whole player.
 */
export const DESCRIPTION_SCOPE = ".tb-cover__desc";

/**
 * @param text Author's description as it arrived.
 * @param format Its format. `plain` is NOT markup: it is returned untouched, tags and
 *   all, because a plain description shows them as text rather than running them.
 * @returns The description, safe to print as markup.
 */
export function sanitizeDescription(text: string, format: RichTextFormat | null | undefined): string {
  if (format !== "richText" && format !== "html") return text;
  return sanitizeHtml(text, { scope: DESCRIPTION_SCOPE });
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Запустить: `npm test -- server/services/__tests__/description-format.test.ts`

Ожидается: PASS, 4 теста.

- [ ] **Шаг 5: принять поле в схеме тела запроса**

В `server/routes/tests.ts`, в `testBodyBaseSchema`, сразу после
`description: z.string().nullable().optional(),`:

```ts
  // PRD-59 FR-02. MUST be listed here: an unlisted key is stripped by zod and
  // silently lost — the editor would show the mode switching and the save doing
  // nothing.
  descriptionFormat: z.enum(["plain", "richText", "html"]).optional(),
```

- [ ] **Шаг 6: писать поле при создании и обновлении теста**

В `server/services/test-settings.ts`, в методе `create`, сразу после
`description: payload.test.description ?? null,`:

```ts
        // PRD-59 FR-03: a test created without a format is a plain-text one.
        descriptionFormat: payload.test.descriptionFormat ?? "plain",
```

В том же файле найти место, где `update` собирает обновляемые поля теста
(`grep -n "description" server/services/test-settings.ts`), и рядом с записью `description`
добавить очистку и формат:

```ts
        ...(payload.test.descriptionFormat !== undefined
          ? { descriptionFormat: payload.test.descriptionFormat }
          : {}),
        ...(payload.test.description !== undefined
          ? {
              description: sanitizeDescription(
                payload.test.description ?? "",
                payload.test.descriptionFormat ?? existing.descriptionFormat,
              ) || null,
            }
          : {}),
```

Импорт в шапке файла:

```ts
import { sanitizeDescription } from "./description-format";
```

**Проверка перед правкой:** имя переменной с текущей строкой теста в `update` может отличаться от
`existing` — посмотреть на месте и подставить фактическое. Формат берётся из запроса, а при его
отсутствии — из сохранённого: иначе правка одного текста без переключения режима очистила бы
разметку по неверной политике.

- [ ] **Шаг 7: проверить типы и прогнать смежные тесты**

```bash
npm run check
npm test -- server/services/__tests__/description-format.test.ts
npm test -- tests/workbook-settings.test.ts
```

Ожидается: без ошибок, оба файла PASS.

- [ ] **Шаг 8: коммит**

```bash
git add server/services/description-format.ts server/services/__tests__/description-format.test.ts server/routes/tests.ts server/services/test-settings.ts
git commit -m "feat(prd-59): сервер принимает формат описания и чистит разметку"
```

---

## Задача 5. Параметр «Формат описания» в книге Excel

Реализует FR-04 (часть про PRD-48). Готовый словарь подписей `FORMAT_LABELS` в этом файле уже
есть — им подписан формат вводного текста.

**Файлы:**

- Изменить: `server/utils/workbook-settings.ts:516`
- Изменить: `tests/workbook-settings.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Дописать в `tests/workbook-settings.test.ts` (внутрь существующего верхнего `describe`):

```ts
  it("возит формат описания рядом с самим описанием (PRD-59 FR-04)", () => {
    const param = SETTINGS_PARAMS.find((p) => p.name === "Формат описания");
    expect(param).toBeDefined();
    expect(param!.read({ ...baseSource, descriptionFormat: "richText" } as never)).toBe(
      "Форматированный",
    );
    const draft = emptyDraft();
    param!.write("HTML", draft);
    expect(draft.test.descriptionFormat).toBe("html");
  });
```

**Проверка перед правкой:** имена `SETTINGS_PARAMS`, `baseSource` и `emptyDraft` взять
фактические из шапки этого файла — тест должен повторять приём соседних проверок, а не заводить
свой.

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- tests/workbook-settings.test.ts`

Ожидается: FAIL, `expect(param).toBeDefined()` — параметра нет.

- [ ] **Шаг 3: добавить параметр**

В `server/utils/workbook-settings.ts`, сразу после строки
`textParam("Описание", (s) => s.description, "test", "description"),`:

```ts
  // PRD-59 FR-04: формат едет рядом с текстом. Отдельным параметром, а не разметкой
  // внутри ячейки: ячейка книги — это ИСХОДНИК, и читать его надо тем же способом,
  // каким его читает продукт.
  enumParam("Формат описания", FORMAT_LABELS, (s) => s.descriptionFormat, "test", "descriptionFormat"),
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Запустить: `npm test -- tests/workbook-settings.test.ts`

Ожидается: PASS.

- [ ] **Шаг 5: коммит**

```bash
git add server/utils/workbook-settings.ts tests/workbook-settings.test.ts
git commit -m "feat(prd-59): параметр «Формат описания» на листе «Настройки»"
```

---

## Задача 6. Парное поле в контексте рендера

Реализует FR-10, FR-11, FR-12, FR-13.

**Файлы:**

- Изменить: `shared/template/context.ts:35`
- Изменить: `shared/template/start-state.ts:26` и `:172`
- Изменить: `tests/start-state.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Дописать в `tests/start-state.test.ts` внутрь `describe("buildStartState", …)`:

```ts
  describe("описание и его формат (PRD-59)", () => {
    const base = {
      maxAttempts: null,
      completedAttempts: 0,
      hasCompletedResults: false,
      canStartNew: true,
    };

    it("печатает плоское описание экранированным, с переводами строк", () => {
      const { course } = buildStartState({
        info: { title: "Т", description: "Первая\nВторая" },
        ...base,
      });
      expect(course.description).toBe("Первая\nВторая");
      expect(course.descriptionHtml).toBe("Первая<br>Вторая");
    });

    it("печатает размеченное описание как есть", () => {
      const { course } = buildStartState({
        info: { title: "Т", description: "<p>Курс</p>", descriptionFormat: "richText" },
        ...base,
      });
      expect(course.descriptionHtml).toBe("<p>Курс</p>");
      expect(course.description).toBe("<p>Курс</p>");
    });

    it("не даёт разметки, когда описания нет", () => {
      const { course } = buildStartState({ info: { title: "Т" }, ...base });
      expect(course.description).toBe("");
      expect(course.descriptionHtml).toBe("");
    });
  });
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- tests/start-state.test.ts`

Ожидается: FAIL, `course.descriptionHtml` — `undefined`.

- [ ] **Шаг 3: объявить поле в контракте контекста**

В `shared/template/context.ts`, в интерфейсе `CtxCourse`, сразу после `description?: string;`:

```ts
  /**
   * PRD-59 FR-11: the description as MARKUP, built by the core from the text and its
   * format. Paired with `description` rather than replacing it — a template that
   * binds the plain string keeps working and simply shows the text unformatted.
   *
   * Printed through the controlled-HTML channel (`{{& course.descriptionHtml }}`);
   * the block is gated on the STRING, so an empty description prints nothing.
   */
  descriptionHtml?: string;
```

- [ ] **Шаг 4: принять формат во входных данных строителя**

В `shared/template/start-state.ts`, в интерфейсе `StartInfo`, сразу после `description?: string;`:

```ts
  /**
   * PRD-59: the format `description` is written in. Absent = `plain`, which is how
   * a host that has not been taught about the field behaves — and how every test
   * created before the track behaves.
   */
  descriptionFormat?: RichTextFormat | null;
```

Импорт в шапке файла:

```ts
import { richTextToHtml, type RichTextFormat } from "./rich-text";
```

- [ ] **Шаг 5: собрать парное поле**

В том же файле, где собирается `course`, рядом со строкой `description: i.description || "",`:

```ts
    description: i.description || "",
    descriptionHtml: richTextToHtml(i.description, i.descriptionFormat),
```

- [ ] **Шаг 6: убедиться, что тест проходит**

Запустить: `npm test -- tests/start-state.test.ts`

Ожидается: PASS.

- [ ] **Шаг 7: коммит**

```bash
git add shared/template/context.ts shared/template/start-state.ts tests/start-state.test.ts
git commit -m "feat(prd-59): course.descriptionHtml парным полем контекста"
```

---

## Задача 7. Веб-хост передаёт формат

Реализует FR-12 на стороне веба.

**Файлы:**

- Изменить: `client/src/pages/learner/take-test.tsx:2735`

- [ ] **Шаг 1: убедиться, что API отдаёт поле**

`GET /api/tests/:id` возвращает строку теста целиком через `loadFullTest`
(`server/routes/tests.ts:257`), поэтому отдельной правки API не нужно. Проверить фактом:

```bash
npm run dev
```

в другом окне:

```bash
curl -s -b cookies.txt http://localhost:8080/api/tests/<id> | grep -o '"descriptionFormat":"[^"]*"'
```

Ожидается: `"descriptionFormat":"plain"`.

Если поле не пришло — значит `loadFullTest` перечисляет поля вручную; тогда добавить
`descriptionFormat` в его выдачу и только после этого идти дальше.

- [ ] **Шаг 2: передать формат в строитель**

В `client/src/pages/learner/take-test.tsx`, в вызове `buildStartState`, сразу после
`description: testInfo.description || "",`:

```ts
        // PRD-59 FR-12: the format rides with the text; the markup is built by the
        // shared builder, not here.
        descriptionFormat: testInfo.descriptionFormat,
```

- [ ] **Шаг 3: проверить типы**

Запустить: `npm run check`

Ожидается: без ошибок — `testInfo` типизирован как `Test` из `@shared/schema`, поле пришло вместе
с колонкой.

- [ ] **Шаг 4: коммит**

```bash
git add client/src/pages/learner/take-test.tsx
git commit -m "feat(prd-59): веб-хост передаёт формат описания на стартовый экран"
```

---

## Задача 8. SCORM-пакет передаёт формат

Реализует FR-12 на стороне пакета.

**Файлы:**

- Изменить: `server/scorm/builders/test-json.ts:265`
- Изменить: `server/scorm/template/app/render/startPage.js:88`

- [ ] **Шаг 1: положить формат в `test.json`**

В `server/scorm/builders/test-json.ts`, сразу после `description: data.test.description,`:

```ts
    // PRD-59 FR-12: формат рядом с текстом. Исходник остаётся исходником — разметку
    // строит рантайм тем же общим строителем, что и веб.
    descriptionFormat: data.test.descriptionFormat ?? "plain",
```

- [ ] **Шаг 2: передать формат в строитель внутри пакета**

В `server/scorm/template/app/render/startPage.js`, в объекте `info`, сразу после
`description: TEST_DATA.description || '',`:

```js
      // PRD-59: absent in every package built before the field existed — the shared
      // builder reads that as 'plain', which is those packages' current behaviour.
      descriptionFormat: TEST_DATA.descriptionFormat,
```

- [ ] **Шаг 3: собрать образцовый пакет и проверить поле**

```bash
npm run scorm:sample
```

Ожидается: пакет собран в `out/`. Проверить содержимое:

```bash
unzip -p out/*.zip test.json | grep -o '"descriptionFormat":"[^"]*"'
```

Ожидается: `"descriptionFormat":"plain"`.

- [ ] **Шаг 4: коммит**

```bash
git add server/scorm/builders/test-json.ts server/scorm/template/app/render/startPage.js
git commit -m "feat(prd-59): SCORM-пакет везёт формат описания"
```

---

## Задача 9. Макеты шаблонов из репозитория

Реализует FR-14, FR-15, FR-16 для `default` и `certification`.

**ГОЧА:** `data-path` заполняет узел присваиванием `textContent` уже ПОСЛЕ прохода DSL
(`shared/template/render-screen.ts:123`). Оставить атрибут рядом с интерполяцией нельзя — он
затрёт разметку.

**Файлы:**

- Изменить: `server/scorm/templates/default/layouts/start.html:14`
- Изменить: `server/scorm/templates/default/layouts/start.image-right.html:17`
- Изменить: `server/scorm/templates/default/styles/theme.css:316`
- Изменить: `server/scorm/templates/default/manifest.json`
- Изменить: `templates/certification/layouts/start.html:15`
- Изменить: `templates/certification/layouts/start.image-right.html:18`
- Изменить: `templates/certification/styles/theme.css:324`
- Изменить: `templates/certification/manifest.json`

- [ ] **Шаг 1: перевести строку описания на канал разметки**

В КАЖДОМ из четырёх файлов макетов заменить строку

```html
{{#if course.description}}<p class="tb-cover__desc" data-path="course.description"></p>{{/if}}
```

на

```html
{{#if course.description}}<div class="tb-cover__desc">{{& course.descriptionHtml }}</div>{{/if}}
```

Элемент меняется с `p` на `div` намеренно: в размеченном описании могут быть абзацы и списки, а
`<p>` внутри `<p>` браузер закрывает сам и вёрстка разъезжается. Гейт остаётся на СТРОКЕ
(FR-13).

- [ ] **Шаг 2: довести оформление блока до многоабзацного вида**

В КАЖДОМ из двух `theme.css` заменить строку `.tb-cover__desc { … }` на блок (значения слева
сохранены дословно, добавлены только правила для вложенного содержимого):

```css
.tb-cover__desc { margin: 0; font: var(--ou-text-body-l); color: var(--ou-fg-soft); max-width: 60ch; text-wrap: pretty; }
/* PRD-59: описание автора теперь может нести абзацы, списки и ссылки. Интервалы —
   по модульной сетке 4px, цвета — на токенах шаблона. */
.tb-cover__desc > :first-child { margin-top: 0; }
.tb-cover__desc > :last-child { margin-bottom: 0; }
.tb-cover__desc p { margin: 0 0 var(--ou-space-2); }
.tb-cover__desc ul, .tb-cover__desc ol { margin: 0 0 var(--ou-space-2); padding-inline-start: var(--ou-space-5); }
.tb-cover__desc li { margin: 0 0 var(--ou-space-1); }
.tb-cover__desc a { color: var(--ou-fg-accent); text-decoration: underline; }
.tb-cover__desc strong { font-weight: 600; }
```

**Проверка перед правкой:** убедиться, что токены `--ou-space-1`, `--ou-space-2`, `--ou-space-5`
и `--ou-fg-accent` объявлены в этом шаблоне (`grep -n "ou-fg-accent" <файл theme.css>`). Если
какого-то нет — взять фактический из соседних правил файла, не выдумывать имя.

- [ ] **Шаг 3: поднять версии шаблонов**

В `server/scorm/templates/default/manifest.json`: `"version": "1.7.0"` → `"1.8.0"`.

В `templates/certification/manifest.json`: `"version": "1.13.0"` → `"1.14.0"`.

- [ ] **Шаг 4: прогнать тесты макетов**

```bash
npm test -- shared/template/__tests__/certification-layout.test.ts
npm test -- shared/template/__tests__/results-layout.test.ts
```

Ожидается: PASS. Если тест проверяет уникальность узлов `data-path` — снятый атрибут ему не
мешает.

- [ ] **Шаг 5: собрать приёмочный пакет шаблона**

```bash
npm run scorm:template
```

Ожидается: сборка без ошибок валидации шаблона.

- [ ] **Шаг 6: коммит**

```bash
git add server/scorm/templates/default templates/certification
git commit -m "feat(prd-59): стартовый экран шаблонов печатает размеченное описание"
```

---

## Задача 10. Шаблон «Стандартный Ростелеком»

Реализует FR-16a. Работа идёт в ДРУГОМ репозитории — `C:/Repositories/skillum-template-standard-rt`.

**ГОЧА:** каталог `uploads/templates/standard-rt` в репозитории продукта — это результат загрузки,
а не источник. Правка в нём потеряется при следующем обновлении.

- [ ] **Шаг 1: завести worktree в репозитории шаблона**

```bash
git -C C:/Repositories/skillum-template-standard-rt worktree add \
  C:/Repositories/skillum-template-standard-rt/.worktrees/prd59 -b feat/prd59-description-markup main
```

Ожидается: worktree создан от коммита `59ed121` («базовое состояние шаблона 1.1.3»).

- [ ] **Шаг 2: повторить правку макетов**

В `.worktrees/prd59/template/layouts/start.html` и
`.worktrees/prd59/template/layouts/start.image-right.html` заменить строку

```html
{{#if course.description}}<p class="tb-cover__desc" data-path="course.description"></p>{{/if}}
```

на

```html
{{#if course.description}}<div class="tb-cover__desc">{{& course.descriptionHtml }}</div>{{/if}}
```

- [ ] **Шаг 3: повторить правку оформления**

В `.worktrees/prd59/template/styles/theme.css` найти правило `.tb-cover__desc { … }` и дописать
под ним тот же блок правил, что в Задаче 9 Шаг 2 (дословно те же восемь строк).

**ГОЧА:** файл около 820 КБ — в нём `data:`-URI гарнитуры. Искать правило поиском по
`.tb-cover__desc`, а не листанием.

- [ ] **Шаг 4: поднять версию**

В `.worktrees/prd59/template/manifest.json`: `"version": "1.1.3"` → `"1.2.0"`.

- [ ] **Шаг 5: собрать пакет**

```bash
cd C:/Repositories/skillum-template-standard-rt/.worktrees/prd59 && powershell -File ./build.ps1
```

Ожидается: строка вида `standard-rt-1.2.0.zip - <N> KB, template id 'standard-rt' v1.2.0`.

- [ ] **Шаг 6: закоммитить в репозитории шаблона**

```bash
git -C C:/Repositories/skillum-template-standard-rt/.worktrees/prd59 add template
git -C C:/Repositories/skillum-template-standard-rt/.worktrees/prd59 \
  commit -m "feat: стартовый экран печатает размеченное описание теста (PRD-59)"
```

- [ ] **Шаг 7: загрузить шаблон в продукт**

Через интерфейс: «Шаблоны» → карточка «Стандартный Ростелеком» → обновление шаблона, файл
`standard-rt-1.2.0.zip`.

Проверить: `curl -s -b cookies.txt http://localhost:8080/api/templates/standard-rt | grep -o '"version":"[^"]*"'`

Ожидается: `"version":"1.2.0"`.

**ГОЧА:** приложение читает манифест ИЗ БАЗЫ (колонка `templates.manifest`), поэтому проверять
надо по ответу API, а не по файлу на диске.

---

## Задача 11. Письмо-приглашение

Реализует FR-20 и FR-22.

**Файлы:**

- Изменить: `server/email.ts:207`, `:309`, `:339`
- Изменить: `server/services/assignment-link.ts:57`
- Изменить: `server/routes/assignments.ts` (места, где собирается `testDescription`)

- [ ] **Шаг 1: написать падающий тест**

Создать `tests/invite-email-description.test.ts`:

```ts
/**
 * @module tests/invite-email-description
 * @description PRD-59 FR-20/FR-22: the invite letter prints the description as markup
 * in its HTML part and as plain text — line breaks intact — in its text part.
 */
import { describe, it, expect } from "vitest";
import { richTextToHtml, richTextToPlain } from "../shared/template/rich-text";

describe("описание в письме-приглашении", () => {
  const source = "<p>Курс для новых</p><p>Возьмите паспорт</p>";

  it("в HTML-часть идёт разметка", () => {
    expect(richTextToHtml(source, "richText")).toBe(source);
  });

  it("в текстовую часть идёт плоский текст с переводами строк", () => {
    expect(richTextToPlain(source, "richText")).toBe("Курс для новых\nВозьмите паспорт");
  });

  it("плоское описание в HTML-части экранируется, а не исполняется", () => {
    expect(richTextToHtml("Сравните a < b", "plain")).toBe("Сравните a &lt; b");
  });
});
```

- [ ] **Шаг 2: убедиться, что тест проходит**

Запустить: `npm test -- tests/invite-email-description.test.ts`

Ожидается: PASS — это закрепление политики; поведение письма правится следующими шагами.

- [ ] **Шаг 3: принять формат в параметрах письма**

В `server/email.ts`, рядом с `testDescription?: string | null;`:

```ts
  /** PRD-59: format of `testDescription`; absent = plain. */
  testDescriptionFormat?: RichTextFormat | null;
```

Импорт в шапке:

```ts
import { richTextToHtml, richTextToPlain, type RichTextFormat } from "@shared/template/rich-text";
```

- [ ] **Шаг 4: печатать разметку в HTML-части**

В `server/email.ts:309` заменить

```ts
        ${opts.testDescription ? `<p><strong>📝 Описание:</strong> ${opts.testDescription}</p>` : ""}
```

на

```ts
        ${opts.testDescription ? `<p><strong>📝 Описание:</strong> ${richTextToHtml(opts.testDescription, opts.testDescriptionFormat)}</p>` : ""}
```

Это закрывает и старый дефект: до правки описание подставлялось сырым, и символ `<` в нём портил
письмо.

- [ ] **Шаг 5: печатать плоский текст в текстовой части**

В `server/email.ts:339` заменить `${opts.testDescription}` на
`${richTextToPlain(opts.testDescription, opts.testDescriptionFormat)}`.

- [ ] **Шаг 6: довезти формат до вызовов**

Во всех местах, где собирается `testDescription: test.description`, дописать рядом
`testDescriptionFormat: test.descriptionFormat`. Найти их:

```bash
grep -rn "testDescription:" server/ --include=*.ts
```

Ожидается список из `server/services/participants-invite.ts`, `server/services/assignment-link.ts`,
`server/routes/assignments.ts`, `server/routes/groups.ts`. В `assignment-link.ts` добавить поле и
в тип параметров, и в пробрасывание дальше.

- [ ] **Шаг 7: проверить типы**

Запустить: `npm run check`

Ожидается: без ошибок.

- [ ] **Шаг 8: коммит**

```bash
git add server/email.ts server/services/assignment-link.ts server/services/participants-invite.ts server/routes/assignments.ts server/routes/groups.ts tests/invite-email-description.test.ts
git commit -m "feat(prd-59): описание в письме — разметкой в HTML и плоским текстом в тексте"
```

---

## Задача 12. Метаданные SCORM-манифеста

Реализует FR-20 для `imsmanifest.xml`.

**Файлы:**

- Изменить: `server/scorm/builders/metadata.ts:18`

- [ ] **Шаг 1: написать падающий тест**

Создать `tests/scorm-metadata-description.test.ts`:

```ts
/**
 * @module tests/scorm-metadata-description
 * @description PRD-59 FR-20: the package's XML metadata carries the description
 * without tags and with its line breaks intact; the file stays valid XML.
 */
import { describe, it, expect } from "vitest";
import { buildMetadata } from "../server/scorm/builders/metadata";

describe("описание в метаданных манифеста", () => {
  it("печатает размеченное описание без тегов", () => {
    const xml = buildMetadata({
      id: "t1",
      title: "Тест",
      description: "<p>Курс</p><p>Возьмите паспорт</p>",
      descriptionFormat: "richText",
    } as never);
    expect(xml).not.toContain("&lt;p&gt;");
    expect(xml).toContain("Курс\nВозьмите паспорт");
  });

  it("экранирует угловые скобки плоского описания", () => {
    const xml = buildMetadata({
      id: "t1",
      title: "Тест",
      description: "Сравните a < b",
      descriptionFormat: "plain",
    } as never);
    expect(xml).toContain("a &lt; b");
  });
});
```

**Проверка перед правкой:** имя экспортируемой функции взять фактическое
(`grep -n "export function" server/scorm/builders/metadata.ts`) и подставить в тест.

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- tests/scorm-metadata-description.test.ts`

Ожидается: FAIL, в XML остались экранированные теги.

- [ ] **Шаг 3: применить плоскую проекцию**

В `server/scorm/builders/metadata.ts:18` заменить

```ts
      <string language="en">${escapeXml(test.description || "Assessment test")}</string>
```

на

```ts
      <string language="en">${escapeXml(richTextToPlain(test.description, test.descriptionFormat) || "Assessment test")}</string>
```

Импорт в шапке:

```ts
import { richTextToPlain } from "@shared/template/rich-text";
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Запустить: `npm test -- tests/scorm-metadata-description.test.ts`

Ожидается: PASS, 2 теста.

- [ ] **Шаг 5: коммит**

```bash
git add server/scorm/builders/metadata.ts tests/scorm-metadata-description.test.ts
git commit -m "feat(prd-59): метаданные пакета несут описание без тегов"
```

---

## Задача 13. Карточка в списке тестов участника

Реализует FR-21.

**Файлы:**

- Изменить: `client/src/pages/learner/test-list.tsx:69`

- [ ] **Шаг 1: написать падающий тест**

Создать `client/src/pages/learner/__tests__/test-list-description.test.tsx`:

```tsx
/**
 * @module client/src/pages/learner/__tests__/test-list-description
 * @description PRD-59 FR-21: the card prints the description as ONE line, without
 * markup and without line breaks, cut to length.
 */
import { describe, it, expect } from "vitest";
import { richTextToOneLine } from "@shared/template/rich-text";

describe("описание в карточке теста", () => {
  it("сводит абзацы в одну строку", () => {
    expect(richTextToOneLine("<p>Курс</p><p>Возьмите паспорт</p>", "richText")).toBe(
      "Курс Возьмите паспорт",
    );
  });

  it("обрезает длинное описание по границе слова", () => {
    const long = "Курс для новых сотрудников компании. ".repeat(10);
    const out = richTextToOneLine(long, "plain");
    expect(out.length).toBeLessThanOrEqual(121);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("\n");
  });
});
```

- [ ] **Шаг 2: убедиться, что тест проходит**

Запустить: `npm test -- client/src/pages/learner/__tests__/test-list-description.test.tsx`

Ожидается: PASS — политика уже реализована Задачей 2; шаг закрепляет её за этим потребителем.

- [ ] **Шаг 3: применить проекцию в карточке**

В `client/src/pages/learner/test-list.tsx:69` заменить

```tsx
                <CardHeader title={test.title} subtitle={test.description || undefined} />
```

на

```tsx
                {/* PRD-59 FR-21: карточка — строка указателя, а не поверхность для
                    чтения. Разметка снимается, переводы строк становятся пробелами,
                    текст обрезается по длине — иначе одно длинное описание поднимает
                    весь ряд сетки. */}
                <CardHeader
                  title={test.title}
                  subtitle={richTextToOneLine(test.description, test.descriptionFormat) || undefined}
                />
```

Импорт в шапке файла:

```tsx
import { richTextToOneLine } from "@shared/template/rich-text";
```

- [ ] **Шаг 4: проверить типы**

Запустить: `npm run check`

Ожидается: без ошибок.

- [ ] **Шаг 5: коммит**

```bash
git add client/src/pages/learner/test-list.tsx client/src/pages/learner/__tests__/test-list-description.test.tsx
git commit -m "feat(prd-59): описание в карточке одной строкой с обрезом"
```

---

## Задача 14. Режим «значение — исходник» в DS-компоненте

Реализует FR-07 и FR-08. `vendor/ui-kit` — редактируемая зависимость, правка в ней санкционирована.

Сегодня `RichTextEditor` во всех режимах хранит HTML, а переход «Форматированный → Простой текст»
снимает теги через `textContent` и СКЛЕИВАЕТ текст в одну строку. Для описания нужен исходник и
сохранённые абзацы.

**Файлы:**

- Изменить: `vendor/ui-kit/src/components/RichTextEditor.tsx`

- [ ] **Шаг 1: объявить свойство**

В интерфейс `RichTextEditorProps`, после `onModeChange?: (mode: RichTextMode) => void;`:

```tsx
  /**
   * Opt-in: in `plain` mode the value is the author's SOURCE text — real newlines,
   * no escaping — instead of markup. Mode switches route through these converters,
   * so the markup policy stays with the host and the DS keeps no second copy of it.
   *
   * Without it the component behaves exactly as before: the value is markup in every
   * mode.
   */
  sourceMode?: {
    /** Plain source -> markup. Called when the author raises the mode. */
    toMarkup: (text: string) => string;
    /** Markup -> plain source. Called when the author lowers it; must keep line breaks. */
    toPlain: (html: string) => string;
  };
```

- [ ] **Шаг 2: принять свойство в теле компонента**

В деструктуризации параметров, рядом с `sanitize`:

```tsx
      sanitize, sourceMode, rows = 4, id, className, ...rest
```

- [ ] **Шаг 3: провести исходник через переключатель режимов**

Заменить функцию `switchMode` целиком на:

```tsx
    const switchMode = (next: RichTextMode) => {
      if (next === current) return;
      if (sourceMode) {
        // The value crosses the plain boundary in one direction or the other; inside
        // the markup modes it only needs cleaning on the way out of raw HTML.
        if (current === 'plain') onChange(sourceMode.toMarkup(value));
        else if (next === 'plain') onChange(sourceMode.toPlain(clean(value)));
        else if (current === 'html') onChange(clean(value));
      } else {
        if (current === 'html') onChange(clean(value));
        if (next === 'plain') onChange(fromPlainText(toPlainText(value)));
      }
      if (mode === undefined) setInternalMode(next);
      onModeChange?.(next);
    };
```

- [ ] **Шаг 4: показывать исходник в поле**

В ветке `textarea` заменить `value` и `onChange`:

```tsx
              value={current === 'plain' && !sourceMode ? toPlainText(value) : value}
              rows={rows}
              disabled={disabled}
              onChange={(e) =>
                onChange(
                  current === 'plain' && !sourceMode
                    ? fromPlainText(e.target.value)
                    : e.target.value,
                )
              }
```

- [ ] **Шаг 5: проверить типы**

Запустить: `npm run check`

Ожидается: без ошибок.

- [ ] **Шаг 6: убедиться, что поля контентных страниц не затронуты**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx
npm test -- client/src/features/tests/editor/__tests__/page-settings.test.ts
```

Ожидается: PASS — `PlaceholderControl` свойства не передаёт, его ветка кода прежняя.

- [ ] **Шаг 7: коммит**

```bash
git add vendor/ui-kit/src/components/RichTextEditor.tsx
git commit -m "feat(ui-kit): режим «значение — исходник» у RichTextEditor"
```

---

## Задача 15. Эскиз подраздела «Основное»

Правило проекта: UI правится только после сверки с эскизом. Эскиз рисуется ДО React.

**Файлы:**

- Создать: `docs/wireframes/prd59-description-field.html`

- [ ] **Шаг 1: собрать эскиз**

Файл строится по образцу соседних эскизов ящика: холст `prd7-editor-drawer.html`, общие стили
`prd7-shared.css`, скрипт `prd7-shared.js`, снимок ДС `docs/wireframes/ds/skillum-ds.css`.

Показать четыре состояния подраздела «Основное»:

1. `s-plain` — режим «Простой текст»: лента режимов над полем, поле в три строки, панели нет.
2. `s-rich` — режим «Форматированный»: лента, под ней панель B / курсив / зачёркнутый /
   маркированный список / нумерованный список / ссылка / очистить, под ней область ввода с
   оформленным текстом.
3. `s-html` — режим «HTML»: лента, поле моноширинным шрифтом с разметкой.
4. `s-long` — длинное описание в режиме «Форматированный»: два абзаца и список, чтобы видеть
   высоту поля.

В холсте — только настоящий UI. Пояснения, ссылки на требования и замеры — в блоке заметок вне
эскизного фрейма.

- [ ] **Шаг 2: взять пиктограммы из lucide, а не писать руками**

Значки панели сгенерировать из `node_modules/lucide-react/dist/esm/icons/*.mjs`: `bold`,
`italic`, `strikethrough`, `list`, `list-ordered`, `link`, `remove-formatting`.

**ГОЧА:** значки, написанные по памяти, расходятся с lucide 1.45 — у `bold` там ОДИН элемент.

- [ ] **Шаг 3: прогнать линтер эскизов в изоляции**

```bash
npm run check:wireframes:ds
```

**ГОЧА:** в общем прогоне около 3000 легаси-находок из чужих файлов, вывод обрезается и своих
строк не видно. Приём: скопировать свой `.html` вместе с `docs/wireframes/ds/skillum-ds.css`,
`client/src/styles/tb-components.css` и `vendor/ui-kit/src` в отдельный каталог и запустить
скрипт оттуда.

- [ ] **Шаг 4: показать эскиз владельцу и получить согласование**

Открыть в браузере, дождаться ответа. Без согласования Задачу 16 не начинать.

- [ ] **Шаг 5: коммит**

```bash
git add docs/wireframes/prd59-description-field.html
git commit -m "docs(prd-59): эскиз поля «Описание» с переключателем режимов"
```

---

## Задача 16. Поле в ящике теста

Реализует FR-05 и FR-06. Выполняется ТОЛЬКО после согласования эскиза.

**Файлы:**

- Изменить: `client/src/features/tests/editor/test-editor.types.ts:538`
- Изменить: `client/src/features/tests/editor/test-editor.mappers.ts:853`, `:1129`, `:1245`, `:1352`
- Изменить: `client/src/features/tests/editor/sections/basic-settings-section.tsx:137`
- Создать: `client/src/features/tests/editor/sections/__tests__/description-format-field.test.tsx`

- [ ] **Шаг 1: написать падающий тест**

Создать `client/src/features/tests/editor/sections/__tests__/description-format-field.test.tsx`:

```tsx
/**
 * @module features/tests/editor/sections/__tests__/description-format-field
 * @description PRD-59 FR-05..FR-08: the description field offers three modes, keeps
 * the plain value as SOURCE text, and never glues paragraphs when the mode is lowered.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RichTextEditor } from "@skillum/ui-kit";
import { richTextToHtml, richTextToPlain } from "@shared/template/rich-text";

function Field(props: { value: string; mode: "plain" | "rich" | "html"; onChange: (v: string) => void }) {
  return (
    <RichTextEditor
      label="Описание"
      value={props.value}
      mode={props.mode}
      onChange={props.onChange}
      onModeChange={() => {}}
      modes={["plain", "rich", "html"]}
      sourceMode={{
        toMarkup: (text) => richTextToHtml(text, "plain"),
        toPlain: (html) => richTextToPlain(html, "richText"),
      }}
      data-testid="settings-description-input"
    />
  );
}

describe("поле «Описание» с режимами", () => {
  it("в простом режиме показывает исходник с переводами строк", () => {
    render(<Field value={"Первая\nВторая"} mode="plain" onChange={() => {}} />);
    const area = screen.getByTestId("settings-description-input-input") as HTMLTextAreaElement;
    expect(area.value).toBe("Первая\nВторая");
  });

  it("при переходе в форматированный превращает переводы строк в разметку", () => {
    const onChange = vi.fn();
    render(<Field value={"Первая\nВторая"} mode="plain" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("settings-description-input-mode-rich"));
    expect(onChange).toHaveBeenCalledWith("Первая<br>Вторая");
  });

  it("при возврате в простой режим не склеивает абзацы", () => {
    const onChange = vi.fn();
    render(<Field value={"<p>Первая</p><p>Вторая</p>"} mode="rich" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("settings-description-input-mode-plain"));
    expect(onChange).toHaveBeenCalledWith("Первая\nВторая");
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/description-format-field.test.tsx`

Ожидается: FAIL — без Задачи 14 значение в простом режиме приходит экранированным.

Если Задача 14 уже сделана, тест должен пройти. Тогда это закрепление контракта: убедиться, что
все три проверки зелёные, и идти дальше.

- [ ] **Шаг 3: добавить формат в модель редактора**

В `client/src/features/tests/editor/test-editor.types.ts`, в блоке `basic`, после
`description: string;`:

```ts
    /** PRD-59 FR-06: режим ввода описания; сохраняется вместе с тестом. */
    descriptionFormat: RichTextFormat;
```

Импорт в шапке файла:

```ts
import type { RichTextFormat } from "@shared/template/rich-text";
```

- [ ] **Шаг 4: провести формат через маппер**

В `client/src/features/tests/editor/test-editor.mappers.ts`:

в типе ответа API, рядом с `description?: string | null;`:

```ts
  descriptionFormat?: "plain" | "richText" | "html" | null;
```

в сборке модели (строки 853 и 1245), рядом с `description: …`:

```ts
      descriptionFormat:
        r.descriptionFormat === "richText" || r.descriptionFormat === "html"
          ? r.descriptionFormat
          : "plain",
```

**Проверка перед правкой:** на строке 1245 источник называется `src`, а не `r` — подставить
фактическое имя.

в пустой модели (строка 1129), рядом с `description: "",`:

```ts
      descriptionFormat: "plain",
```

в сборке тела запроса (строка 1352), рядом с `description: emptyToNull(model.basic.description),`:

```ts
    descriptionFormat: model.basic.descriptionFormat,
```

- [ ] **Шаг 5: заменить поле в подразделе «Основное»**

В `client/src/features/tests/editor/sections/basic-settings-section.tsx:136-154` заменить блок
`<div className="ou-formfield"><Textarea id="settings-description" … /></div>` на:

```tsx
      <div className="ou-formfield">
        {/* PRD-59 FR-05..FR-08: описание пишется в одном из трёх режимов. Значение —
            ИСХОДНИК автора: в простом режиме это настоящий текст с настоящими
            переводами строк, и именно он уезжает в письмо и в метаданные пакета. */}
        <RichTextEditor
          id="settings-description"
          label="Описание"
          fullWidth
          rows={3}
          value={model.basic.description}
          mode={model.basic.descriptionFormat === "richText" ? "rich" : model.basic.descriptionFormat}
          modes={["plain", "rich", "html"]}
          sourceMode={{
            toMarkup: (text) => richTextToHtml(text, "plain"),
            toPlain: (html) => richTextToPlain(html, "richText"),
          }}
          sanitize={(html) => sanitizeContentHtml(html, { scope: ".tb-cover__desc" })}
          onChange={(value) =>
            updateModel((m) => ({ ...m, basic: { ...m.basic, description: value } }))
          }
          onModeChange={(next) =>
            updateModel((m) => ({
              ...m,
              basic: { ...m.basic, descriptionFormat: next === "rich" ? "richText" : next },
            }))
          }
          data-testid="settings-description-input"
        />
      </div>
```

Импорты в шапке файла:

```tsx
import { RichTextEditor } from "@skillum/ui-kit";
import { richTextToHtml, richTextToPlain } from "@shared/template/rich-text";
import { sanitizeHtml as sanitizeContentHtml } from "@shared/security/html-sanitize";
```

**Внимание:** `placeholder` у прежнего поля («Опишите цели теста и аудиторию») у `RichTextEditor`
нет. Подпись поля сохраняется, подсказка переносится в `hint`:
`hint="Опишите цели теста и аудиторию"`.

- [ ] **Шаг 6: прогнать тесты подраздела**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__/description-format-field.test.tsx
npm test -- client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx
npm test -- client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts
```

Ожидается: PASS. Тесты, искавшие `settings-description-input` как `textarea`, могут потребовать
правки селектора на `settings-description-input-input` — это ожидаемо: контрол сменился.

- [ ] **Шаг 7: коммит**

```bash
git add client/src/features/tests/editor
git commit -m "feat(prd-59): поле «Описание» с переключателем режимов ввода"
```

---

## Задача 17. Контракт платформы шаблонов

Реализует FR-17 и FR-17a.

**Файлы:**

- Изменить: `docs/specs/spec-template-platform.md`
- Изменить: `docs/guides/template-development.md`
- Изменить: `docs/dist/spec-template-platform.pdf`, `docs/dist/template-development.pdf`

- [ ] **Шаг 1: описать поле в спецификации**

В `docs/specs/spec-template-platform.md`, в §10.3 (парные поля контекста), добавить
`course.descriptionHtml` рядом с описанием прочих парных полей: строка остаётся, разметка
приезжает парным полем, гейт стоит на строке.

- [ ] **Шаг 2: поднять версию и дописать историю**

В шапке: `**Версия:** 3.3.0` → `3.4.0`.

Первой строкой таблицы «История версий»:

```markdown
| 3.4.0 | 2026-09-18 | **Описание теста печатается с оформлением** (PRD-59 FR-11): в контекст стартового экрана добавлено парное поле `course.descriptionHtml` рядом с `course.description` (§10.3). Ядро строит его из текста и его формата — `plain` экранируется и переводы строк становятся `<br>`, `richText` и `html` печатаются как есть. Версия МИНОРНАЯ: шаблон, связывающий только строку, работает как прежде и показывает описание без оформления. Гейт блока по-прежнему стоит на СТРОКЕ. |
```

- [ ] **Шаг 3: догнать руководство до 3.4.0**

В `docs/guides/template-development.md`:

- описать `course.descriptionHtml` в разделе данных стартового экрана;
- дописать раздел о параметрах шаблона, выпущенных версиями 3.2.0 и 3.3.0: `optionPreviews` (путь
  к картинке на каждый вариант `select`; значением может быть и пара `{ light, dark }` под тему
  редактора) и `dataAttr` (имя атрибута `data-имя`, в который оба хоста кладут выбранное значение
  на корне сцены);
- в шапке: `**Версия руководства:** 3.1.0 · **соответствует спецификации формата:** 3.1.0` →
  `3.4.0` и `3.4.0`.

- [ ] **Шаг 4: пересобрать PDF**

```bash
npm run docs:pdf
```

**ГОЧА:** команда пересобирает ВСЕ четыре PDF, включая руководства автора и импорта, которых
правка не касается, — байты у них меняются всё равно. Вернуть чужие:

```bash
git checkout -- docs/dist/test-authoring-guide.pdf docs/dist/import-workbook-guide.pdf
```

Первый запуск может упасть с `ETIMEDOUT` на `spawnSync chrome` — повторный проходит.

- [ ] **Шаг 5: проверить разметку документов**

Запустить: `npm run lint:md`

Ожидается: без ошибок.

- [ ] **Шаг 6: коммит**

```bash
git add docs/specs/spec-template-platform.md docs/guides/template-development.md docs/dist/spec-template-platform.pdf docs/dist/template-development.pdf
git commit -m "docs: контракт платформы шаблонов 3.4.0 — course.descriptionHtml"
```

---

## Задача 18. Приёмка в браузере

Закрывает критерии приёмки 1-10 спецификации.

- [ ] **Шаг 1: поднять среду**

```bash
npm run dev
```

Войти под приёмочной учётной записью `acceptance@local.test`.

- [ ] **Шаг 2: критерий 1 — оформление на стартовом экране веб-теста**

Задать описание в режиме «Форматированный»: два абзаца, маркированный список, полужирное слово.
Сохранить, открыть тест как участник. Ожидается: абзацы, список и выделение видны.

- [ ] **Шаг 3: критерий 4 — переключение режимов**

В ящике переключить «Форматированный» → «Простой текст» → «Форматированный». Ожидается: абзацы на
месте, текст в одну строку не склеился.

- [ ] **Шаг 4: критерий 3 — три шаблона, два варианта стартового экрана**

Повторить шаг 2 на «Стандартном», «Стандартном Ростелеком» и «Сертификации (РТК)», в каждом — на
`start` и на `start.image-right`.

- [ ] **Шаг 5: критерий 2 — пакет**

```bash
npm run scorm:sample
npm run scorm:player
```

Открыть `http://localhost:5050`, проверить стартовый экран. Затем загрузить пакет на стенд
WebTutor и повторить проверку там.

- [ ] **Шаг 6: критерий 5 — письмо**

Назначить тест участнику, посмотреть письмо в dev-ящике.

**ГОЧА:** dev-SMTP отправляет НАСТОЯЩИЕ письма. Назначать на адрес приёмочной учётной записи, а
не на чужой.

Ожидается: HTML-часть с оформлением, текстовая часть — плоский текст с переводами строк.

- [ ] **Шаг 7: критерий 6 — метаданные пакета**

```bash
unzip -p out/*.zip imsmanifest.xml | grep -A 2 "<description>"
```

Ожидается: описание без тегов, переводы строк на месте, XML валиден.

- [ ] **Шаг 8: критерий 7 — карточка участника**

Открыть список тестов участника, где у одного теста описание в три абзаца, у другого — короткое.
Ожидается: обе карточки одной высоты, длинное описание одной строкой с многоточием.

Если ряд всё равно выглядит неровным — поправить `ONE_LINE_LIMIT` в
`shared/template/rich-text.ts` и повторить проверку. Спека это разрешает: 120 символов —
проверяемое на приёмке значение.

- [ ] **Шаг 9: критерий 8 — книга Excel**

Выгрузить книгу теста, проверить на листе «Настройки» строки «Описание» и «Формат описания».
Изменить формат в книге, загрузить обратно, убедиться, что режим в ящике сменился.

- [ ] **Шаг 10: критерий 9 — старый тест**

Открыть тест, созданный до трека. Ожидается: описание выглядит как раньше, тегов текстом нет,
поле открывается в режиме «Простой текст».

- [ ] **Шаг 11: критерий 10 — очистка**

Вставить в описание в режиме HTML фрагмент со `<script>` и правилом `body { display: none }`.
Сохранить, перезагрузить ящик. Ожидается: скрипт удалён, правило ограничено областью описания,
плеер не переоформлен. Повторить через импорт книги Excel.

- [ ] **Шаг 12: зафиксировать отчёт о приёмке**

Записать результат по каждому критерию в описание задачи трека, отметив, на чём именно
проверялось (какой шаблон, какой стенд).

---

## Самопроверка плана

**Покрытие спецификации:**

| Требование | Задача |
| --- | --- |
| FR-01, FR-02, FR-03 | 3 |
| FR-04 | 3 (снимок), 4 (API), 5 (книга), 8 (пакет) |
| FR-05, FR-06 | 16 |
| FR-07, FR-08, FR-09 | 14, 16 |
| FR-10, FR-11, FR-12, FR-13 | 6, 7, 8 |
| FR-14, FR-15, FR-16 | 9 |
| FR-16a | 10 |
| FR-17, FR-17a | 17 |
| FR-18, FR-19 | 1 |
| FR-20 | 11 (письмо), 12 (XML), 13 (карточка) |
| FR-21 | 2, 13 |
| FR-22 | 11 |
| FR-23, FR-24, FR-25 | 4 |
| FR-26, FR-27, FR-28 | 6 (парное поле), 3 (умолчание), 18 шаг 10 |
| Критерии приёмки 1-10 | 18 |
| Критерий приёмки 11 | 17 |

**Согласованность имён:** `richTextToPlain`, `richTextToOneLine`, `ONE_LINE_LIMIT`,
`sanitizeDescription`, `DESCRIPTION_SCOPE`, `descriptionFormat`, `course.descriptionHtml`,
`sourceMode` — каждое объявлено в своей задаче до первого использования в следующих.

**Порядок:** Задача 14 (DS) обязана идти до Задачи 16 (React), Задача 15 (эскиз) — до Задачи 16.
Задачи 1 и 2 — до всех, кто зовёт функции. Задача 3 — до 4, 5, 7, 8.
