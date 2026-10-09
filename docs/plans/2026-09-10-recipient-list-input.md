# Набранный вручную список получателей — план работ

> **Для исполнителя:** шаги помечены чекбоксами (`- [ ]`). Порядок задач менять нельзя: задача 1 (эскизы) —
> гейт для задачи 5 (React), это hard-правило проекта.

**Цель:** вкладка «Списком» в диалогах назначения теста и «Отправить на рецензирование» принимает получателей
двумя способами — набранным списком адресов или книгой xlsx. Попутно приглашение рецензентов перестаёт ехать
на правах назначения и получает своё.

**Спеки:** `docs/specs/prd-28/external-participant.md` раздел 16 (FR-23 — FR-30),
`docs/specs/prd-52/test-review.md` раздел 14 (FR-33 — FR-35),
`docs/specs/access-control/role-model.md` версия 1.5.

**Архитектура:** разбор набранной записи — один модуль в `shared/`, вызывается браузером. Клиент превращает
текст в те же строки `{index, email, name}`, что даёт разбор книги, и отдаёт их предпросмотру телом JSON.
Классификация строк, таблица предпросмотра, прогон и отчёт не меняются: у них появляется второй ИСТОЧНИК
строк, а не вторая копия. Гейт при этом у каждого назначения свой — общим делается конвейер, а не право.

**Стек:** TypeScript, React 19, Express, Vitest + Testing Library, DS `@skillum/ui-kit`.

---

## Задача 1: эскизы (гейт, блокирует задачу 5)

**Файлы:**

- Правка: `docs/wireframes/approved/prd52-invite-dialog.html` (состояние `bulk`, строки 269–279)
- Правка: `docs/wireframes/prd28-bulk-invite-upload.html` (панель вкладки, строки 110–170)
- Правка: `client/src/styles/tb-components.css` (перебивка разделителя)

- [ ] **Шаг 1: поднять статику и открыть оба эскиза**

```bash
python -m http.server 8010 --directory .
```

Открыть `http://localhost:8010/docs/wireframes/approved/prd52-invite-dialog.html?state=bulk` и
`http://localhost:8010/docs/wireframes/prd28-bulk-invite-upload.html`. Смотреть в обеих темах (кнопка
`Dark` в навбаре).

- [ ] **Шаг 2: нарисовать верхнюю половину в обоих эскизах**

Разметка одна и та же, DS-классы без самодельных div-ов. Вставляется ПЕРЕД зоной файла:

```html
<div class="ou-field ou-field--m ou-field--full">
  <label class="ou-field__lbl" for="wf-emails">Адреса почты</label>
  <div class="ou-field__box ou-field__box--area">
    <textarea class="ou-field__input" id="wf-emails" rows="4"
      placeholder="Ирина Петрова &lt;i.petrova@example.com&gt;&#10;s.kovalev@example.com"></textarea>
  </div>
  <div class="ou-field__msg">По одному в строке или через запятую. Запись «Имя &lt;адрес&gt;» задаёт имя,
    голый адрес — только адрес.</div>
</div>

<div class="tb-orsep"><span class="tb-orsep__word">или</span></div>
```

- [ ] **Шаг 3: описать разделитель в проектном слое, а не в эскизе**

Перебивку из `<style>` эскиза перенести в `client/src/styles/tb-components.css` (иначе она останется
эскизной и в приложении её не будет):

```css
/* Разделитель «или» между двумя способами задать список (PRD-28 раздел 16). */
.tb-orsep { display: flex; align-items: center; gap: var(--ou-space-3); }
.tb-orsep::before,
.tb-orsep::after { content: ""; flex: 1; height: 1px; background: var(--ou-border-soft); }
.tb-orsep__word { font: var(--ou-text-body-s); color: var(--ou-fg-muted); }
```

- [ ] **Шаг 4: показать состояние «вторая половина погашена»**

В `prd28-bulk-invite-upload.html` добавить в навбар второе состояние (кнопка `2 · Набран список`), где поле
заполнено двумя записями, а зона файла отрисована в погашенном виде — `ou-uploader is-disabled` с
`aria-disabled="true"`. Симметричное состояние (файл выбран, поле погашено — `disabled` на `textarea`) —
третьей кнопкой.

- [ ] **Шаг 5: снять скриншоты обоих эскизов в обеих темах и показать владельцу**

Ждать явного «утверждено». Без него задача 5 не начинается. Правка `approved/prd52-invite-dialog.html`
делается прямо в `approved/` — эскиз там уже лежит, и это его новая редакция.

- [ ] **Шаг 6: коммит**

```bash
git add docs/wireframes/approved/prd52-invite-dialog.html docs/wireframes/prd28-bulk-invite-upload.html client/src/styles/tb-components.css
git commit -m "docs(wireframes): вторая половина вкладки «Списком» — набранный список адресов"
```

---

## Задача 2: разбор набранной записи

**Файлы:**

- Создать: `shared/recipients/parse-recipient-list.ts`
- Создать: `shared/recipients/__tests__/parse-recipient-list.test.ts`

- [ ] **Шаг 1: написать падающие тесты**

`shared/recipients/__tests__/parse-recipient-list.test.ts`:

```ts
/**
 * @module shared/recipients/__tests__/parse-recipient-list.test
 * @description PRD-28 FR-25 — FR-28: чтение набранного списка получателей.
 */
import { describe, it, expect } from "vitest";
import { parseRecipientList } from "../parse-recipient-list";

describe("parseRecipientList", () => {
  it("голый адрес даёт строку без имени", () => {
    expect(parseRecipientList("s.kovalev@example.com")).toEqual([
      { index: 0, email: "s.kovalev@example.com", name: null },
    ]);
  });

  it("запись «Имя <адрес>» разносит имя и адрес", () => {
    expect(parseRecipientList("Ирина Петрова <i.petrova@example.com>")).toEqual([
      { index: 0, email: "i.petrova@example.com", name: "Ирина Петрова" },
    ]);
  });

  it("делит по переводу строки, точке с запятой и запятой", () => {
    const rows = parseRecipientList("a@x.ru\nb@x.ru; c@x.ru, d@x.ru");
    expect(rows.map((r) => r.email)).toEqual(["a@x.ru", "b@x.ru", "c@x.ru", "d@x.ru"]);
  });

  it("запятая внутри кавычек не разделяет запись", () => {
    const rows = parseRecipientList('"Петров, Иван" <p@example.com>; Сидорова <s@example.com>');
    expect(rows).toEqual([
      { index: 0, email: "p@example.com", name: "Петров, Иван" },
      { index: 1, email: "s@example.com", name: "Сидорова" },
    ]);
  });

  it("нераспознанную запись отдаёт как есть, а не выбрасывает", () => {
    const rows = parseRecipientList("ivanov.example.com\nb@x.ru");
    expect(rows[0]).toEqual({ index: 0, email: "ivanov.example.com", name: null });
    expect(rows).toHaveLength(2);
  });

  it("схлопывает повтор адреса, оставляя дыру в позициях", () => {
    const rows = parseRecipientList("a@x.ru\nA@X.ru\nb@x.ru");
    expect(rows).toEqual([
      { index: 0, email: "a@x.ru", name: null },
      { index: 2, email: "b@x.ru", name: null },
    ]);
  });

  it("пустые куски и хвостовой разделитель строк не дают", () => {
    expect(parseRecipientList("a@x.ru;\n\n  \n")).toHaveLength(1);
    expect(parseRecipientList("   ")).toEqual([]);
  });
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- shared/recipients
```

Ожидается: `Failed to resolve import "../parse-recipient-list"`.

- [ ] **Шаг 3: написать модуль**

`shared/recipients/parse-recipient-list.ts`:

```ts
/**
 * @module shared/recipients/parse-recipient-list
 * @description PRD-28 раздел 16 (FR-25 — FR-28, FR-30): reads a hand-typed
 * recipient list into the SAME rows `parseParticipantsWorkbook` yields, so the
 * classification, the preview table and the run behind them stay single.
 *
 * It lives in `shared/` rather than in the browser because the rows it produces
 * are a contract with the server: the parser and the pipeline that consumes it
 * must not be able to drift, and a rule proven by a unit test here is proven for
 * whoever calls it next.
 */

/** One recipient, in the shape the workbook parser produces. */
export interface RecipientRow {
  /**
   * Position among the entries that were typed, zero-based. A collapsed repeat
   * leaves a GAP here, exactly as a collapsed row of a workbook does — the
   * preview counts entries by the last position and reports the difference.
   */
  index: number;
  email: string;
  name: string | null;
}

/**
 * Cut the text into entries.
 *
 * Newline, `;` and `,` all separate, but neither inside quotes nor inside angle
 * brackets: a mail client hands over `"Петров, Иван" <p@example.com>; …`, and a
 * naive split on the comma would tear that display name in half — precisely the
 * cleanup this feature exists to spare the operator.
 */
function splitEntries(text: string): string[] {
  const entries: string[] = [];
  let current = "";
  let quoted = false;
  let angled = false;

  for (const ch of text) {
    if (ch === '"') { quoted = !quoted; current += ch; continue; }
    if (!quoted && ch === "<") { angled = true; current += ch; continue; }
    if (!quoted && ch === ">") { angled = false; current += ch; continue; }
    if (!quoted && !angled && (ch === "\n" || ch === "\r" || ch === ";" || ch === ",")) {
      entries.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  entries.push(current);
  return entries;
}

/** `Имя <адрес>` / `"Имя" <адрес>` / `<адрес>` / `адрес`. */
const ANGLED = /^(.*)<([^<>]*)>$/;

function readEntry(entry: string): { email: string; name: string | null } {
  const trimmed = entry.trim();
  const angled = ANGLED.exec(trimmed);
  if (!angled) return { email: trimmed, name: null };
  const name = angled[1].trim().replace(/^"(.*)"$/, "$1").trim();
  return { email: angled[2].trim(), name: name || null };
}

/**
 * Read a typed list into recipient rows.
 *
 * An entry that is not an address at all is KEPT, verbatim, so it reaches the
 * preview as an «Некорректный адрес» row: silently dropping it would leave the
 * operator counting recipients to notice that their list was understood only in
 * part. A repeated address collapses on the first occurrence, as in a workbook.
 *
 * @param text What the operator typed or pasted.
 * @returns Rows in typing order; no ceiling is applied here — the row limit is a
 *   server setting and is checked by the route.
 */
export function parseRecipientList(text: string): RecipientRow[] {
  const seen = new Set<string>();
  const rows: RecipientRow[] = [];
  let index = 0;

  for (const entry of splitEntries(text)) {
    if (!entry.trim()) continue;
    const position = index++;
    const { email, name } = readEntry(entry);
    const key = email.toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    rows.push({ index: position, email, name });
  }
  return rows;
}
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

```bash
npm test -- shared/recipients
```

Ожидается: 7 passed.

- [ ] **Шаг 5: коммит**

```bash
git add shared/recipients
git commit -m "feat(invite): разбор набранного вручную списка получателей"
```

---

## Задача 3: общее чтение строк и предпросмотр участников

Модуль общий сразу: в задаче 4 те же три вещи (чтение строк из тела, русская фраза отказа, шаблон книги)
понадобятся маршрутам рецензирования, а вторая копия однажды разошлась бы с первой в формулировке отказа.

**Файлы:**

- Создать: `server/services/recipient-list.ts`
- Правка: `server/services/participants-invite.ts:19-23` (перечень видов отказа)
- Правка: `server/routes/assignments.ts` (удалить локальную `participantsRefusalMessage`, звать общее,
  ветвить предпросмотр по источнику, отдать шаблон из общего модуля)
- Правка: `tests/routes.participants.test.ts`

- [ ] **Шаг 1: написать падающие роут-тесты**

Добавить в `tests/routes.participants.test.ts` внутрь `describe("POST /api/tests/:id/participants/preview")`:

```ts
  it("принимает набранные строки телом JSON и классифицирует их так же", async () => {
    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/preview"))
      .send({ rows: [{ index: 0, email: "a@x.ru", name: "Анна" }, { index: 1, email: "b@x.ru", name: null }] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ email: "a@x.ru", name: "Анна", status: "new" });
  });

  it("не доверяет телу: берёт только адрес, имя и позицию", async () => {
    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/preview"))
      .send({ rows: [{ index: 0, email: " a@x.ru ", name: "  ", status: "privileged", userId: "u-9" }] });

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ email: "a@x.ru", name: null, status: "new", userId: null });
  });

  it("держит тот же потолок строк, что и книга", async () => {
    config.limits = { ...config.limits, participantsImportMaxRows: 1 };

    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/preview"))
      .send({ rows: [{ index: 0, email: "a@x.ru", name: null }, { index: 1, email: "b@x.ru", name: null }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("too_many_rows");
  });

  it("пустой список отклоняет своей фразой, а не фразой про файл", async () => {
    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/preview")).send({ rows: [] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("empty_list");
    expect(res.body.error).toBe("В списке нет ни одного адреса.");
  });

  it("права и область теста проверяются и на этом пути", async () => {
    const res = await as("lrn1", request(app).post("/api/tests/t1/participants/preview"))
      .send({ rows: [{ index: 0, email: "a@x.ru", name: null }] });

    expect(res.status).toBe(403);
  });
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- tests/routes.participants.test.ts
```

Ожидается: пять новых падают, первый — с `400 File required`.

- [ ] **Шаг 3: добавить вид отказа**

В `server/services/participants-invite.ts` расширить объединение:

```ts
/** What the pipeline refused on, told apart without reading the message. */
export type ParticipantsInviteErrorKind =
  | "empty_file"
  | "empty_list"
  | "too_many_rows"
  | "test_not_found"
  | "group_name_taken";
```

- [ ] **Шаг 4: создать общий модуль**

`server/services/recipient-list.ts`:

```ts
/**
 * @module server/services/recipient-list
 * @description What the two recipient-list routes share (PRD-28 раздел 16,
 * PRD-52 раздел 14): reading a hand-typed list out of a request body, the
 * Russian sentence for a refusal, and the template workbook.
 *
 * These live together, and outside both routers, because назначение and
 * рецензирование now have SEPARATE gates but the SAME list: a second copy of
 * the refusal wording would drift from the first, and the operator would be told
 * two different things about one and the same list.
 */
import ExcelJS from "exceljs";
import { ParticipantsInviteError, type ParticipantRow } from "./participants-invite";
import { addAoaSheet, workbookToBuffer } from "../utils/excel";

/**
 * Rows a hand-typed list arrives as (PRD-28 FR-29).
 *
 * The text itself is read in the browser by `shared/recipients` — the module the
 * unit tests pin — so what lands here is already the shape the workbook yields.
 * Only the three fields the pipeline uses are kept: the body is operator input,
 * and a `status` or `userId` smuggled in it must not decide anything, because
 * the whole point of the preview is that the SERVER classifies the rows.
 *
 * @param value The `rows` field of the request body, untrusted.
 * @param maxRows Ceiling from configuration; checked here rather than in the
 *   browser, which has no business knowing a system setting.
 * @throws {ParticipantsInviteError} `empty_list` / `too_many_rows`.
 */
export function readGivenRows(value: unknown, maxRows: number): ParticipantRow[] {
  const given = Array.isArray(value) ? value : [];
  if (given.length === 0) throw new ParticipantsInviteError("empty_list", "No rows given");
  if (given.length > maxRows) {
    throw new ParticipantsInviteError("too_many_rows", `Maximum ${maxRows} rows per upload`, { maxRows });
  }
  return given.map((row: Record<string, unknown>, position) => {
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    return {
      index: typeof row?.index === "number" ? row.index : position,
      email: typeof row?.email === "string" ? row.email.trim() : "",
      name: name || null,
    };
  });
}

/**
 * The sentence the operator reads for a refusal the pipeline raised.
 *
 * The pipeline speaks English — its messages go to the log and to developers —
 * and the Russian phrasing is composed here, out of `kind` and the values the
 * refusal carries. Never matched against the message text: rewording the prose
 * must not silently change a status code.
 */
export function recipientRefusalMessage(error: ParticipantsInviteError): string {
  switch (error.kind) {
    case "empty_file":
      return "В файле нет ни одной строки с участниками.";
    case "empty_list":
      return "В списке нет ни одного адреса.";
    case "too_many_rows":
      return `Слишком много строк: за один раз можно загрузить не больше ${error.detail.maxRows}.`;
    case "group_name_taken":
      return `Группа с таким именем уже есть: ${error.detail.groupName}`;
    case "test_not_found":
      return "Тест не найден.";
  }
}

/**
 * The template workbook offered next to the file zone.
 *
 * Two columns only, unlike the users-import template: `role` and `group` are
 * ignored in this scenario (the role is always `learner`, the group comes from
 * the form), and offering them would promise behaviour that does not exist.
 */
export async function buildRecipientTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, "Участники", [
    ["email", "name"],
    ["ivanov@example.com", "Иван Иванов"],
    ["petrova@example.com", "Анна Петрова"],
  ]);
  return workbookToBuffer(wb);
}
```

- [ ] **Шаг 5: перевести маршруты участников на общий модуль**

В `server/routes/assignments.ts`:

- удалить локальную функцию `participantsRefusalMessage` (строки 496–516) и импортировать общее:

```ts
import {
  buildRecipientTemplateWorkbook,
  readGivenRows,
  recipientRefusalMessage,
} from "../services/recipient-list";
```

- заменить два вызова `participantsRefusalMessage(error)` на `recipientRefusalMessage(error)`;
- заменить тело обработчика предпросмотра (то, что начинается с `if (!req.file)`) на:

```ts
      // Два источника строк, одна классификация: книга и набранный вручную
      // список (раздел 16). Ветка здесь — последняя, дальше пути неразличимы.
      const rows = req.file
        ? await parseParticipantsWorkbook(req.file.buffer, {
            maxRows: config.limits.participantsImportMaxRows,
          })
        : readGivenRows(req.body?.rows, config.limits.participantsImportMaxRows);
      res.json(await classifyParticipants(rows, { testId: req.params.id, storage }));
```

- в маршруте шаблона книги заменить сборку на `const buf = await buildRecipientTemplateWorkbook();`
  (импорты `ExcelJS`, `addAoaSheet`, `workbookToBuffer` в этом файле могут стать лишними — проверить
  `npm run check` и удалить неиспользуемые).

- [ ] **Шаг 6: убедиться, что тесты проходят**

```bash
npm test -- tests/routes.participants.test.ts
npm run check
```

Ожидается: все тесты файла зелёные, `tsc` без ошибок.

- [ ] **Шаг 7: коммит**

```bash
git add server/services/recipient-list.ts server/services/participants-invite.ts server/routes/assignments.ts tests/routes.participants.test.ts
git commit -m "feat(invite): предпросмотр принимает набранный список наравне с книгой"
```

---

## Задача 4: право `tests.review.invite` и свои маршруты рецензирования

Чинит живой дефект: у роли «автор» нет `assignments.manage` и `users.create`, а вкладка рецензирования
ходила за предпросмотром, шаблоном и отметкой о выгрузке в маршруты УЧАСТНИКОВ — то есть автору отвечали 403
там, где он и есть целевая роль.

**Файлы:**

- Правка: `shared/access/capabilities.ts`
- Правка: `shared/access/permissions.ts:41-63`
- Правка: `tests/access/permissions.test.ts`
- Правка: `server/routes/review.ts`
- Правка: `tests/review-routes.test.ts`

- [ ] **Шаг 1: обновить золотые тесты прав**

В `tests/access/permissions.test.ts`: в `EXPECTED_AUTHOR` дописать после `"tests.access.grant",` строку
`"tests.review.invite",`; счётчик каталога поднять до 36:

```ts
  it("has 36 unique capabilities", () => {
    expect(CAPABILITIES.length).toBe(36);
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });
```

и добавить отдельный случай в `describe("role -> permission map (golden)")`:

```ts
  it("приглашение рецензентов — право авторских ролей, но не методиста", () => {
    expect(hasPermission([ROLES.AUTHOR], "tests.review.invite")).toBe(true);
    expect(hasPermission([ROLES.DEVELOPER], "tests.review.invite")).toBe(true);
    expect(hasPermission([ROLES.ADMINISTRATOR], "tests.review.invite")).toBe(true);
    expect(hasPermission([ROLES.MANAGER], "tests.review.invite")).toBe(false);
    expect(hasPermission([ROLES.LEARNER], "tests.review.invite")).toBe(false);
  });
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- tests/access/permissions.test.ts
```

Ожидается: падение на `"tests.review.invite" is not assignable to type Capability` и на счётчике 35.

- [ ] **Шаг 3: завести право**

В `shared/access/capabilities.ts` — в каталог, следом за `"tests.access.grant"`:

```ts
  "tests.access.grant",
  // PRD-52 раздел 14: приглашение рецензентов — своё право, а не следствие
  // прав на назначения. Заведение внешней учётки рецензента входит в него:
  // без учётной записи комментарий нечем подписать.
  "tests.review.invite",
```

и в `SCOPE_AWARE_CAPABILITIES`, рядом с `"tests.access.grant"`:

```ts
  "tests.review.invite",
```

В `shared/access/permissions.ts`, в `AUTHOR_CAPABILITIES` следом за `"tests.access.grant"`:

```ts
  // PRD-52 раздел 14: звать рецензентов на СВОЙ тест (объектная область).
  "tests.review.invite",
```

Разработчик получает право по наследству от автора, администратор — фильтром `ADMINISTRATOR_CAPABILITIES`.

- [ ] **Шаг 4: убедиться, что тесты прав проходят**

```bash
npm test -- tests/access/permissions.test.ts
```

Ожидается: зелено.

- [ ] **Шаг 5: написать падающие роут-тесты рецензирования**

В `tests/review-routes.test.ts` добавить блок (в `beforeEach` этого файла `canGrantAccess` уже мок):

```ts
describe("список рецензентов", () => {
  beforeEach(() => {
    accessMock.canGrantAccess.mockReturnValue(true);
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.getTestAssignments.mockResolvedValue([]);
  });

  it("разбирает набранные строки и отдаёт их со статусами", async () => {
    const res = await request(authorApp())
      .post("/api/tests/t1/review/preview")
      .send({ rows: [{ index: 0, email: "expert@x.test", name: "Ирина" }] });

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ email: "expert@x.test", name: "Ирина", status: "new" });
  });

  it("не владельцу теста отказывает", async () => {
    accessMock.canGrantAccess.mockReturnValue(false);

    const res = await request(authorApp())
      .post("/api/tests/t1/review/preview")
      .send({ rows: [{ index: 0, email: "expert@x.test", name: null }] });

    expect(res.status).toBe(403);
  });

  it("пустой список отклоняет фразой про список", async () => {
    const res = await request(authorApp()).post("/api/tests/t1/review/preview").send({ rows: [] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("empty_list");
    expect(res.body.error).toBe("В списке нет ни одного адреса.");
  });

  it("шаблон книги отдаётся под тем же правом", async () => {
    const res = await request(authorApp()).get("/api/tests/t1/review/template");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("participants-template.xlsx");
  });

  it("отметка о выгрузке ссылок принимается и ничего не возвращает", async () => {
    const res = await request(authorApp())
      .post("/api/tests/t1/review/links-exported")
      .send({ count: 3 });

    expect(res.status).toBe(204);
  });
});
```

В хойстед-мок `storageMock` этого файла дописать недостающие методы: `getUserByEmail`, `getTestAssignments`,
`getGroupUsers`, `getUserRoles` (последний уже есть).

- [ ] **Шаг 6: убедиться, что тесты падают**

```bash
npm test -- tests/review-routes.test.ts
```

Ожидается: 404 на всех трёх новых маршрутах.

- [ ] **Шаг 7: написать маршруты**

В `server/routes/review.ts` добавить импорты:

```ts
import { config } from "../config";
import { respondWorkbookReadError, workbookUploadSingle } from "../middleware/upload";
import {
  buildRecipientTemplateWorkbook,
  readGivenRows,
  recipientRefusalMessage,
} from "../services/recipient-list";
import {
  ParticipantsInviteError,
  classifyParticipants,
  parseParticipantsWorkbook,
} from "../services/participants-invite";
import { audit } from "../logger";
```

и рядом с приглашением — три маршрута:

```ts
/** Книга со списком рецензентов приходит тем же полем, что и книга участников. */
const reviewerListUpload = workbookUploadSingle("file");

/**
 * Гейт списка рецензентов: право `tests.review.invite` даёт действие в принципе,
 * `canGrantAccess` — на ЭТОТ тест. Ровно та же пара, что у `review/invite`:
 * предпросмотр показывает, кого затронет приглашение, и прятать его за более
 * слабой дверью, чем само приглашение, бессмысленно.
 */
async function ensureInviteScope(req: Request, res: Response): Promise<boolean> {
  const test = await storage.getTest(req.params.id);
  if (!test) { res.status(404).json({ error: "Тест не найден" }); return false; }
  if (!canGrantAccess(req.effectiveRoles ?? [], req.currentUser!.id, test)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// POST /api/tests/:id/review/preview — разбор списка рецензентов (PRD-52 FR-35).
router.post(
  "/:id/review/preview",
  requirePermission("tests.review.invite"),
  reviewerListUpload,
  async (req: Request, res: Response) => {
    try {
      if (!(await ensureInviteScope(req, res))) return;
      const rows = req.file
        ? await parseParticipantsWorkbook(req.file.buffer, {
            maxRows: config.limits.participantsImportMaxRows,
          })
        : readGivenRows(req.body?.rows, config.limits.participantsImportMaxRows);
      res.json(await classifyParticipants(rows, { testId: req.params.id, storage }));
    } catch (error) {
      if (respondWorkbookReadError(res, error)) return;
      if (error instanceof ParticipantsInviteError) {
        return res.status(400).json({ code: error.kind, error: recipientRefusalMessage(error) });
      }
      logger.error("Review preview failed: " + (error as Error).message, "review");
      res.status(500).json({ error: "Не удалось разобрать список" });
    }
  },
);

// GET /api/tests/:id/review/template — шаблон книги для списка рецензентов.
router.get(
  "/:id/review/template",
  requirePermission("tests.review.invite"),
  async (req: Request, res: Response) => {
    if (!(await ensureInviteScope(req, res))) return;
    const buf = await buildRecipientTemplateWorkbook();
    res.setHeader("Content-Disposition", "attachment; filename=participants-template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  },
);

// POST /api/tests/:id/review/links-exported — отметка о выгрузке ссылок.
// Ссылки сюда НЕ едут: файл собирается в браузере из отчёта, который он уже
// держит, — серверу сообщается только факт и число (PRD-28 FR-20).
router.post(
  "/:id/review/links-exported",
  requirePermission("tests.review.invite"),
  async (req: Request, res: Response) => {
    if (!(await ensureInviteScope(req, res))) return;
    const raw = Number(req.body?.count);
    audit.participantLinksExported(req.params.id, Number.isFinite(raw) ? raw : 0);
    res.status(204).end();
  },
);
```

И перевесить приглашение: в маршруте `POST /:id/review/invite` заменить
`requirePermission("tests.access.grant")` на `requirePermission("tests.review.invite")`; повторную проверку
`canGrantAccess` в его теле заменить на `if (!(await ensureInviteScope(req, res))) return;` не нужно — там
уже есть свой разбор с чтением теста, оставить как есть.

- [ ] **Шаг 8: убедиться, что тесты проходят**

```bash
npm test -- tests/review-routes.test.ts tests/access/permissions.test.ts
npm run check
```

- [ ] **Шаг 9: коммит**

```bash
git add shared/access server/routes/review.ts tests/access/permissions.test.ts tests/review-routes.test.ts docs/specs/access-control/role-model.md
git commit -m "feat(review): приглашение рецензентов — своё право tests.review.invite"
```

---

## Задача 5: две половины на вкладке (только после утверждения эскизов)

**Файлы:**

- Правка: `client/src/features/tests/assign/bulk-invite-tab.tsx`
- Правка: `client/src/components/assign-test-dialog.tsx:792` (ярлык вкладки)
- Правка: `client/src/features/tests/assign/__tests__/bulk-invite-tab.test.tsx`

- [ ] **Шаг 1: написать падающие компонентные тесты**

Добавить в `client/src/features/tests/assign/__tests__/bulk-invite-tab.test.tsx` новый блок:

```ts
describe("<BulkInviteTab /> — набранный список", () => {
  it("отдаёт предпросмотру разобранные строки, а не файл", async () => {
    renderTab();
    fireEvent.change(screen.getByLabelText("Адреса почты"), {
      target: { value: "Ирина Петрова <i.petrova@example.com>\ns.kovalev@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Проверить список" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/participants/preview"))!;
    const init = call[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      rows: [
        { index: 0, email: "i.petrova@example.com", name: "Ирина Петрова" },
        { index: 1, email: "s.kovalev@example.com", name: null },
      ],
    });
  });

  it("заполненное поле гасит зону файла, очистка возвращает её", () => {
    const { container } = renderTab();
    const emails = screen.getByLabelText("Адреса почты");

    fireEvent.change(emails, { target: { value: "a@x.ru" } });
    expect((container.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);

    fireEvent.change(emails, { target: { value: "" } });
    expect((container.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(false);
  });

  it("выбранный файл гасит поле адресов", () => {
    const { container } = renderTab();
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [xlsx()] },
    });
    expect((screen.getByLabelText("Адреса почты") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("кнопка проверки мертва, пока не задан ни один источник", () => {
    renderTab();
    expect(screen.getByRole("button", { name: "Проверить список" })).toBeDisabled();
  });

  it("на рецензировании ходит в свои маршруты, а не в маршруты участников", async () => {
    renderTab({ purpose: "review" });
    fireEvent.change(screen.getByLabelText("Адреса почты"), { target: { value: "e@x.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить список" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/review/preview"))).toBe(true));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/participants/preview"))).toBe(false);
  });
});
```

Помощник `renderTab` в этом файле принимает параметры — расширить его:

```ts
function renderTab(props: { purpose?: "assign" | "review" } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  const onGoToAssignments = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <BulkInviteTab
        testId="t1"
        testTitle="Основы ИБ"
        onGoToAssignments={onGoToAssignments}
        purpose={props.purpose}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onGoToAssignments };
}
```

и заглушку `fetch` — отвечать и на ревью-маршруты:

```ts
    if (url.endsWith("/participants/preview") || url.endsWith("/review/preview")) return previewResponse();
    if (url.endsWith("/participants/invite") || url.endsWith("/review/invite")) return inviteResponse();
    if (url.endsWith("/links-exported")) return jsonRes(null, true, 204);
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- client/src/features/tests/assign
```

Ожидается: пять новых падают на `Unable to find a label with the text of: Адреса почты`.

- [ ] **Шаг 3: собрать адреса маршрутов в одном месте**

В `client/src/features/tests/assign/bulk-invite-tab.tsx`, сразу после `const isReview = purpose === "review";`:

```tsx
  /**
   * Маршруты назначения и рецензирования РАЗНЫЕ: конвейер общий, а право своё
   * (PRD-52 раздел 14). Собраны здесь одним объектом, чтобы вкладка не решала
   * это заново в каждой мутации — так один из четырёх вызовов однажды и остался
   * бы на чужом маршруте.
   */
  const api = isReview
    ? {
      preview: `/api/tests/${testId}/review/preview`,
      invite: `/api/tests/${testId}/review/invite`,
      template: `/api/tests/${testId}/review/template`,
      exported: `/api/tests/${testId}/review/links-exported`,
    }
    : {
      preview: `/api/tests/${testId}/participants/preview`,
      invite: `/api/tests/${testId}/participants/invite`,
      template: `/api/tests/${testId}/participants/template`,
      exported: `/api/tests/${testId}/participants/links-exported`,
    };
```

и заменить на них четыре зашитых адреса: в `previewMutation`, в `inviteMutation` (там сейчас тернарник по
`isReview`), в `exportMutation` и в кнопке «Скачать шаблон .xlsx» (`saveFromUrl(api.template)`).

- [ ] **Шаг 4: добавить поле и развилку источника**

Добавить импорты:

```tsx
import { Separator, Textarea } from "@skillum/ui-kit";
import { parseRecipientList } from "@shared/recipients/parse-recipient-list";
```

(`Separator` и `Textarea` дописать в существующий список импортов из ui-kit; `useMemo` — в импорт из
`react`.)

Состояние рядом с `const [file, setFile] = useState<File | null>(null);`:

```tsx
  /**
   * Набранный список. Он и файл — АЛЬТЕРНАТИВЫ (раздел 16): заполненное поле
   * гасит зону книги и наоборот, поэтому источник ВЫВОДИТСЯ из полей, а не
   * хранится третьим флагом: флаг и поля однажды разошлись бы.
   */
  const [emails, setEmails] = useState("");
  const typedRows = useMemo(() => parseRecipientList(emails), [emails]);
  const source: "text" | "file" | null = emails.trim() ? "text" : file ? "file" : null;
```

`mutationFn` предпросмотра:

```tsx
    mutationFn: async () => {
      const res = file
        ? await fetch(api.preview, { method: "POST", credentials: "include", body: fileBody(file) })
        : await fetch(api.preview, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: typedRows }),
          });
      if (!res.ok) throw new Error((await res.json()).error || "Не удалось разобрать список");
      return res.json() as Promise<ParticipantPreviewRow[]>;
    },
```

помощник рядом с `formatBytes`:

```tsx
/** Multipart body the preview route reads the workbook from. */
function fileBody(picked: File): FormData {
  const fd = new FormData();
  fd.append("file", picked);
  return fd;
}
```

кнопка: `onClick={() => previewMutation.mutate()}` и `disabled={source === null}`.

- [ ] **Шаг 5: собрать верхнюю половину и разделитель**

Заменить начало `uploadPanel` (от `<Stack gap={5}>` до конца блока с `FileUploader`) на:

```tsx
    <Stack gap={5}>
      <Textarea
        label="Адреса почты"
        fullWidth
        rows={4}
        value={emails}
        disabled={Boolean(file)}
        onChange={(e) => setEmails(e.target.value)}
        placeholder={"Ирина Петрова <i.petrova@example.com>\ns.kovalev@example.com"}
        hint="По одному в строке или через запятую. Запись «Имя <адрес>» задаёт имя, голый адрес — только адрес."
      />

      <div className="tb-orsep"><Text variant="body-s" tone="muted" className="tb-orsep__word">или</Text></div>

      {file ? (
        <FileItem
          name={file.name}
          kind="xls"
          meta={formatBytes(file.size)}
          actions={[
            {
              icon: <Trash2 size={16} />,
              ariaLabel: "Убрать файл",
              danger: true,
              onClick: () => setFile(null),
            },
          ]}
        />
      ) : (
        <FileUploader
          accept=".xlsx"
          disabled={Boolean(emails.trim())}
          title="Перетащите книгу или нажмите, чтобы выбрать"
          description="Только .xlsx. Колонки: email, name."
          cta="Выбрать файл"
          onFiles={handleFiles}
        />
      )}
```

`Separator` использовать, если после сверки с эскизом окажется, что жёлоб рисуется им, а не
`.tb-orsep::before/::after`; лишний импорт затем убрать.

- [ ] **Шаг 6: подписать счётчик предпросмотра по источнику**

Строка счётчика сейчас всегда говорит «строк файла». Завести рядом с `rows` состояние источника:

```tsx
  /** Чем разобран текущий предпросмотр: подпись счётчика у путей разная. */
  const [previewSource, setPreviewSource] = useState<"text" | "file">("file");
```

в `onSuccess` предпросмотра дописать `setPreviewSource(file ? "file" : "text");`, а в `previewPanel`
заменить обе фразы на:

```tsx
        <Text variant="body-s" tone="muted">
          {sheetRowCount > rows.length
            ? `${sheetRowCount} ${previewSource === "file" ? "строк файла" : "записей списка"} · ${rows.length} после схлопывания повторов`
            : `${rows.length} ${previewSource === "file" ? "строк файла" : "записей списка"}`}
        </Text>
```

- [ ] **Шаг 7: проверить возврат с предпросмотра**

`backToUpload` возвращает на шаг загрузки и НЕ трогает ни `file`, ни `emails`: оператор возвращается,
чтобы поправить список, а не набрать его заново. Убедиться, что новая ветка ничего туда не добавила.

- [ ] **Шаг 8: переименовать вкладку**

`client/src/components/assign-test-dialog.tsx:792`: `label: "Списком из файла"` → `label: "Списком"`.
Обновить `@module`-описание в `bulk-invite-tab.tsx` (первый абзац говорит «from an uploaded workbook» —
теперь источников два) и шапки обоих тест-файлов, где встречается старое имя вкладки.

- [ ] **Шаг 9: убедиться, что тесты проходят**

```bash
npm test -- client/src/features/tests/assign client/src/components/__tests__/assign-test-dialog.test.tsx
npm run check
```

- [ ] **Шаг 10: коммит**

```bash
git add client/src/features/tests/assign client/src/components/assign-test-dialog.tsx
git commit -m "feat(invite): вкладка «Списком» принимает набранные адреса наравне с книгой"
```

---

## Задача 6: приёмка

**Файлы:**

- Создать: `docs/reports/recipient-list-input-acceptance.md`

- [ ] **Шаг 1: поднять dev и войти учётной записью приёмки**

```bash
npm run dev
```

Учётная запись — `acceptance@local.test`. Тест взять свой, чтобы не трогать чужие назначения на общей dev-базе.

- [ ] **Шаг 2: пройти семь критериев PRD-28 раздел 16.4**

По каждому — снимок экрана. Особое внимание пунктам 4 (вставка с запятой внутри кавычек даёт ДВЕ строки)
и 6 (подпись комментария рецензента: имя, если оно было задано; адрес, если нет — для этого пригласить
двух рецензентов, одного записью с именем, другого голым адресом, и открыть окно рецензирования).

- [ ] **Шаг 3: пройти четыре критерия PRD-52 раздел 14.2**

Ключевой — первый: пользователь с ОДНОЙ ролью «автор», владелец теста, проходит «Отправить на
рецензирование» → «Списком» целиком, включая «Скачать шаблон .xlsx» и «Выгрузить ссылки», не получив ни
одного отказа по правам. Именно этот путь сегодня сломан.

- [ ] **Шаг 4: сверить обе половины с утверждённым эскизом поэлементно**

Скриншот эскиза и скриншот реализации рядом: подписи дословно, тип контрола, порядок, отступы, погашенное
состояние. Любое расхождение — не «готово».

- [ ] **Шаг 5: записать отчёт и закрыть статусы в спеках**

В шапках `docs/specs/prd-28/external-participant.md` и `docs/specs/prd-52/test-review.md` перевести
дополнения из «НЕ РЕАЛИЗОВАНО» в «РЕАЛИЗОВАН, приёмка пройдена <дата>».

- [ ] **Шаг 6: коммит**

```bash
git add docs/reports/recipient-list-input-acceptance.md docs/specs/prd-28/external-participant.md docs/specs/prd-52/test-review.md
git commit -m "docs(invite): приёмка набранного списка получателей"
```

---

## Чего в плане сознательно нет

- Сложения двух источников в одном прогоне (вне охвата, PRD-28 раздел 16.5).
- Правок прогона `participants/invite` и `review/invite` по существу: они и сегодня принимают готовые
  строки; у второго меняется только гейт.
- Классификации строк по грантам рецензирования. Статус «уже назначен» считается по назначениям теста и в
  диалоге рецензирования объясняется словами про назначение, которого у рецензента нет. Расхождение
  существует с первой редакции общей вкладки и записано в PRD-52 раздел 14.3 — отдельная задача.
