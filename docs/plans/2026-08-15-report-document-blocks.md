# PRD-51. Отчёт как документ из блоков — план реализации, часть 1 (этапы Э1-Э2)

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ ПОДНАВЫК — `superpowers:subagent-driven-development`
> (рекомендуется) или `superpowers:executing-plans`. Шаги помечены чек-боксами (`- [ ]`).

**Статус: ВЫПОЛНЕН.** Этапы Э1-Э2 реализованы, приняты и влиты в `main` 2026-08-16 (последний коммит
трека `e272cb2f`), приёмка — [отчёт](../reports/prd51-e1-e2-acceptance.md). Все 68 пунктов отмечены
выполненными проходом актуализации 2026-09-01: план исполнялся прямо в сессии, а не через
`executing-plans`, поэтому построчных отметок по ходу работы не ставилось — свидетельством
исполнения служат отчёт приёмки и код, а не чекбоксы.

**Цель:** отчёт о результатах перестаёт быть одной раскладкой и собирается из упорядоченного списка
блоков; стандартный шаблон переведён на блоки, и тест, ничего не настраивавший, печатает прежний
документ.

**Архитектура:** перечень системных блоков закрыт продуктом (`shared/report/report-blocks.ts`).
Шаблон объявляет вариант на блок (`kind: "report.block"`) и документ по умолчанию
(`reportDocument`); тест хранит свой документ строками таблицы `report_blocks`. Одна чистая функция
сводит манифест и строки в упорядоченный список блоков (`resolveReportDocument`), одна браузерная
функция собирает из него DOM (`renderReportInto`), и обе зовут все три выдачи — PDF, SCORM-пакет,
предпросмотр автора. Блоки кладутся ПРЯМЫМИ детьми корня документа, потому что постраничная
раскладка режет именно по ним.

**Стек:** TypeScript, Vitest, Drizzle ORM (+ pglite для интеграционных тестов), React 19,
дизайн-система `@skillum/ui-kit`, собственный DSL шаблонов (`shared/template/dsl.ts`),
рантайм SCORM на ES5 (`server/scorm/template/app`).

**Спека:** `docs/specs/prd-51/report-document-blocks.md`.

**Охват этого плана:** этапы Э1 (модель и рендер) и Э2 (стандартный шаблон) — требования FR-01 -
FR-13, FR-20 и FR-21. FR-14 (очистка разметки) закрыт здесь ЧАСТИЧНО — в сборке пакета; половина
«очистка при сохранении» приезжает вместе с маршрутом сохранения документа, то есть в плане Э3:
пока документ нечем сохранить, чистить на сохранении нечего.

Этапы Э3 (редактор), Э4 (шаблон «Сертификация») и Э5 (документы контракта)
получают свои планы: их интерфейсы определяются кодом Э1, и писать их шаги сейчас значило бы
угадывать сигнатуры, которые ещё не существуют. Границы следующих планов — в разделе «Дальнейшие
планы» в конце документа.

**Правила прогона тестов в этом репозитории:**

- Только `npm test -- <путь>`; `npx vitest run` в этом проекте падает.
- Полный прогон (`npm test` без пути) и `npm run test:cov` — ТОЛЬКО по явному разрешению владельца:
  в одной рабочей копии параллельно работают несколько сессий.
- Интеграционные тесты слоя данных — `npm run test:it -- <путь>` (pglite, отдельный конфиг).
- В коммитах не должно быть трейлера `Co-Authored-By`.
- Перед `git commit` сверять `git diff --cached --name-only`: индекс общий на всю рабочую копию.
- Правка `manifest.json` не видна приложению без перезапуска `npm run dev` — манифест живёт в БД.

---

## Структура файлов

**Создаются:**

- `shared/report/report-blocks.ts` — закрытый реестр системных блоков: ключи, природа, подписи.
- `shared/report/__tests__/report-blocks.test.ts` — тесты реестра.
- `shared/report/report-document.ts` — разрешение документа: манифест + строки теста → список блоков.
- `shared/report/__tests__/report-document.test.ts` — тесты разрешения и правил смены шаблона.
- `shared/report/render-report.ts` — `renderReportInto`: сборка DOM документа из блоков.
- `shared/report/__tests__/render-report.test.ts` — тесты сборки (jsdom).
- `server/storage/report-blocks-repository.ts` — слой данных таблицы `report_blocks`.
- `server/storage/__tests__/report-blocks-repository.it.test.ts` — интеграционные тесты на pglite.
- `drizzle/00NN_prd51_report_blocks.sql` — миграция таблицы (имя даёт `drizzle-kit generate`).
- `server/scorm/templates/default/layouts/report/shell.html` — оболочка документа.
- `server/scorm/templates/default/layouts/report/header.html` — блок шапки.
- `server/scorm/templates/default/layouts/report/intro.html` — блок вводного текста автора.
- `server/scorm/templates/default/layouts/report/summary.html` — блок сводки баллов.
- `server/scorm/templates/default/layouts/report/topics.html` — блок тем и блоков разделов.
- `server/scorm/templates/default/layouts/report/breakdown.html` — блок сводного разреза.
- `server/scorm/templates/default/layouts/report/scales.html` — блок шкал и диаграммы.
- `server/scorm/templates/default/layouts/report/indicators.html` — блок показателей.
- `server/scorm/templates/default/layouts/report/recommendations.html` — блок рекомендаций.
- `server/scorm/templates/default/layouts/report/courses.html` — блок курсов.
- `server/scorm/templates/default/layouts/report/events.html` — блок мероприятий.
- `server/scorm/templates/default/layouts/report/page-text.html` — вариант авторской страницы.
- `tests/report-document-parity.test.ts` — сборка блоками даёт тот же DOM, что цельная раскладка.
- `docs/wireframes/prd51-report-document.html` — эскиз карточки-документа в редакторе.
- `docs/wireframes/prd51-certification-report.html` — эскиз трёх листов отчёта.

**Изменяются:**

- `shared/schema.ts` — таблица `reportBlocks` и её типы.
- `shared/report/report-variants.ts` — вид `report.block`, `reportDocument`, правила проверки.
- `shared/report/export-pdf.ts:171` — вызов `renderReportInto` вместо `renderScreenInto`.
- `server/storage.ts` — методы документа в контракте `IStorage` и делегирование.
- `server/scorm/builders/test-json.ts` — запекание документа и очистка значений блоков.
- `server/scorm/templates/default/manifest.json` — варианты блоков и `reportDocument`.
- `server/scorm/templates/default/layouts/report.html` — остаётся как путь совместимости.
- `client/src/features/tests/editor/sections/report-preview-modal.tsx` — предпросмотр документа.

**НЕ трогаются в этом плане:** `shared/report/paginate.ts`, `shared/report/paginate-dom.ts`
(контракт постраничной раскладки не меняется), экран итогов, `templates/certification/`.

---

## Task 1: Эскизы и их утверждение

**Files:**

- Create: `docs/wireframes/prd51-report-document.html`
- Create: `docs/wireframes/prd51-certification-report.html`

Правило проекта: UI реализуется только после сверки с утверждённым эскизом. Эскизы делаются до кода,
потому что они фиксируют вещи, которых спека не фиксирует: расположение ручки перетаскивания, вид
кнопки-вставки, тег природы блока, поведение раскрытия строки.

- [x] **Шаг 1: Снять образец разметки существующей «Структуры»**

Открыть `docs/wireframes/approved/prd7-structure-linear-flat.html` и выписать классы и композицию
строки страницы, кнопки-вставки и меню строки. Эскиз отчёта обязан использовать ТЕ ЖЕ классы —
`docs/wireframes/prd7-shared.css` и `docs/wireframes/tb-components.css` подключаются как есть.
Собственных классов в эскизе не заводить: расхождение с существующим экраном — дефект, а не свобода.

- [x] **Шаг 2: Собрать эскиз карточки-документа**

`docs/wireframes/prd51-report-document.html` — один холст, в нём карточка «Отчёт о результатах» со
списком блоков по §7.2 спеки: строка системного блока с тумблером, строка авторской страницы с
меню, строка разрыва листа, кнопки-вставки между строками, раскрытая строка страницы с полями.
Переключатель состояний (как в остальных эскизах): `s-default`, `s-row-expanded`, `s-add-palette`,
`s-readonly`. В холсте — только реальный UI; пояснения — в блоке заметок под холстом.

- [x] **Шаг 3: Собрать эскиз трёх листов отчёта**

`docs/wireframes/prd51-certification-report.html` — три листа A4 по §10.1 и §10.3 спеки, с метриками
из таблицы §10.3. Состояния: `s-pass`, `s-fail`.

- [x] **Шаг 4: Снять эскизы в браузере и сверить с референсом**

```bash
python -m http.server 8123
```

Сервер поднимать из КОРНЯ репозитория (иначе относительные пути к `prd7-shared.css` не разрешатся).
Снять `chrome-headless-shell` с `--virtual-time-budget`, положить снимки рядом со снимками
референса из `docs/references/` и сверить поэлементно: поля листа, высоту шапки карточки, размер
бейджа, высоту полосы.

- [x] **Шаг 5: Отдать эскизы владельцу и дождаться утверждения**

Гейт. Без явного «утверждено» следующие задачи не начинать: реализация UI без утверждённого эскиза —
блокирующий дефект по правилу проекта.

- [x] **Шаг 6: Коммит**

```bash
git add docs/wireframes/prd51-report-document.html docs/wireframes/prd51-certification-report.html
git commit -m "docs(prd-51): эскизы документа отчёта и карточки редактора"
```

---

## Task 2: Реестр системных блоков

**Files:**

- Create: `shared/report/report-blocks.ts`
- Test: `shared/report/__tests__/report-blocks.test.ts`

- [x] **Шаг 1: Написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import {
  REPORT_SYSTEM_BLOCKS,
  REPORT_BLOCK_KEYS,
  isReportBlockKey,
  reportBlockNature,
} from "../report-blocks";

describe("реестр блоков отчёта", () => {
  it("перечисляет десять системных блоков в порядке печати сегодняшнего отчёта", () => {
    expect(REPORT_SYSTEM_BLOCKS.map((b) => b.key)).toEqual([
      "header", "intro", "summary", "topics", "breakdown",
      "scales", "indicators", "recommendations", "courses", "events",
    ]);
  });

  it("знает служебные ключи страницы и разрыва", () => {
    expect(REPORT_BLOCK_KEYS).toContain("page");
    expect(REPORT_BLOCK_KEYS).toContain("page-break");
  });

  it("различает природу блока", () => {
    expect(reportBlockNature("topics")).toBe("system");
    expect(reportBlockNature("page")).toBe("page");
    expect(reportBlockNature("page-break")).toBe("page-break");
  });

  it("отвергает неизвестный ключ", () => {
    expect(isReportBlockKey("summary")).toBe(true);
    expect(isReportBlockKey("нет-такого")).toBe(false);
  });

  it("у каждого системного блока есть подпись для редактора", () => {
    for (const block of REPORT_SYSTEM_BLOCKS) {
      expect(block.label.length).toBeGreaterThan(0);
    }
  });
});
```

- [x] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
npm test -- shared/report/__tests__/report-blocks.test.ts
```

Ожидание: FAIL, `Failed to resolve import "../report-blocks"`.

- [x] **Шаг 3: Написать минимальную реализацию**

```ts
/**
 * @module shared/report/report-blocks
 *
 * ЗАКРЫТЫЙ реестр блоков документа отчёта (PRD-51 §3.1).
 *
 * Перечень системных блоков принадлежит ПРОДУКТУ, а не шаблону: это ровно то, что документ
 * умеет рассказать о попытке, и шаблон вправе решать, КАК блок выглядит, но не вправе
 * придумать одиннадцатый вид данных. Открытый перечень означал бы, что редактор не может
 * назвать строку списка, а движок — понять, что печатать.
 *
 * Порядок массива — порядок печати СЕГОДНЯШНЕГО отчёта. Он же становится документом по
 * умолчанию, поэтому тест, ничего не настраивавший, вида документа не меняет.
 *
 * Чистый модуль: ни DOM, ни Node.
 */

/** Природа блока: чем он управляется в редакторе и что печатает. */
export type ReportBlockNature = "system" | "page" | "page-break";

/** Один системный блок реестра. */
export interface ReportSystemBlock {
  key: string;
  /** Подпись строки в редакторе. */
  label: string;
}

/** Системные блоки в порядке печати сегодняшнего отчёта. */
export const REPORT_SYSTEM_BLOCKS: readonly ReportSystemBlock[] = [
  { key: "header", label: "Шапка документа" },
  { key: "intro", label: "Вводный блок" },
  { key: "summary", label: "Сводка баллов" },
  { key: "topics", label: "Результаты по темам" },
  { key: "breakdown", label: "Сводный разрез" },
  { key: "scales", label: "Шкалы" },
  { key: "indicators", label: "Показатели" },
  { key: "recommendations", label: "Рекомендации" },
  { key: "courses", label: "Курсы" },
  { key: "events", label: "Мероприятия" },
];

/** Ключ авторской страницы. */
export const REPORT_PAGE_BLOCK = "page";

/** Ключ разрыва листа. */
export const REPORT_PAGE_BREAK_BLOCK = "page-break";

/** Все допустимые ключи блока. */
export const REPORT_BLOCK_KEYS: readonly string[] = [
  ...REPORT_SYSTEM_BLOCKS.map((b) => b.key),
  REPORT_PAGE_BLOCK,
  REPORT_PAGE_BREAK_BLOCK,
];

/** Знает ли продукт такой блок. */
export function isReportBlockKey(value: unknown): value is string {
  return typeof value === "string" && REPORT_BLOCK_KEYS.includes(value);
}

/** Природа блока по ключу. Неизвестный ключ — системный: он придёт из строки теста,
 *  сохранённой под другим шаблоном, и трогать его нельзя (см. `resolveReportDocument`). */
export function reportBlockNature(key: string): ReportBlockNature {
  if (key === REPORT_PAGE_BLOCK) return "page";
  if (key === REPORT_PAGE_BREAK_BLOCK) return "page-break";
  return "system";
}
```

- [x] **Шаг 4: Прогнать тест и убедиться, что он проходит**

```bash
npm test -- shared/report/__tests__/report-blocks.test.ts
```

Ожидание: PASS, 5 тестов.

- [x] **Шаг 5: Коммит**

```bash
git add shared/report/report-blocks.ts shared/report/__tests__/report-blocks.test.ts
git commit -m "feat(prd-51): закрытый реестр блоков документа отчёта"
```

---

## Task 3: Вид `report.block` и `reportDocument` в манифесте

**Files:**

- Modify: `shared/report/report-variants.ts`
- Test: `shared/report/__tests__/report-variants.blocks.test.ts` (создаётся)

- [x] **Шаг 1: Написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { validateReportVariants, resolveReportDocumentDecl } from "../report-variants";

const shell = {
  key: "report.standard", kind: "report", layoutFile: "layouts/report/shell.html", isDefault: true,
};
const topics = {
  key: "report.block.topics", kind: "report.block", block: "topics",
  layoutFile: "layouts/report/topics.html", isDefault: true,
};
const page = {
  key: "report.block.page.text", kind: "report.block", block: "page",
  layoutFile: "layouts/report/page-text.html", isDefault: true,
  placeholders: [{ key: "body", type: "richText", label: "Текст" }],
};

describe("объявление блоков отчёта", () => {
  it("принимает вариант блока с placeholders", () => {
    const issues = validateReportVariants({ contentTemplates: [shell, topics, page] });
    expect(issues).toEqual([]);
  });

  it("отвергает вариант блока без ключа блока", () => {
    const bad = { ...topics, block: undefined };
    const issues = validateReportVariants({ contentTemplates: [shell, bad] });
    expect(issues.map((i) => i.message).join(" ")).toContain("не назвал блок");
  });

  it("отвергает неизвестный ключ блока", () => {
    const bad = { ...topics, block: "нет-такого" };
    const issues = validateReportVariants({ contentTemplates: [shell, bad] });
    expect(issues.map((i) => i.message).join(" ")).toContain("неизвестный блок");
  });

  it("требует ровно один isDefault на блок", () => {
    const second = { ...topics, key: "report.block.topics.b" };
    const issues = validateReportVariants({ contentTemplates: [shell, topics, second] });
    expect(issues.map((i) => i.message).join(" ")).toContain("isDefault");
  });

  it("оставляет запрет placeholders на ОБОЛОЧКЕ", () => {
    const bad = { ...shell, placeholders: [{ key: "x", type: "richText", label: "X" }] };
    const issues = validateReportVariants({ contentTemplates: [bad, topics] });
    expect(issues.map((i) => i.message).join(" ")).toContain("placeholders неприменимы");
  });

  it("отвергает ключ, объявленный и в placeholders, и в settings варианта", () => {
    const bad = { ...page, settings: [{ key: "body", type: "text", label: "Текст" }] };
    const issues = validateReportVariants({ contentTemplates: [shell, bad] });
    expect(issues.map((i) => i.message).join(" ")).toContain("объявлен дважды");
  });

  it("читает документ по умолчанию для вида", () => {
    const manifest = {
      contentTemplates: [shell, topics],
      reportDocument: { report: ["header", "topics"] },
    };
    expect(resolveReportDocumentDecl(manifest, "report")).toEqual(["header", "topics"]);
  });

  it("отвергает документ по умолчанию с неизвестным блоком", () => {
    const manifest = {
      contentTemplates: [shell, topics],
      reportDocument: { report: ["header", "нет-такого"] },
    };
    const issues = validateReportVariants(manifest);
    expect(issues.map((i) => i.message).join(" ")).toContain("неизвестный блок");
  });
});
```

- [x] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
npm test -- shared/report/__tests__/report-variants.blocks.test.ts
```

Ожидание: FAIL — `resolveReportDocumentDecl` не экспортируется, вид `report.block` не распознан.

- [x] **Шаг 3: Реализовать правила в `report-variants.ts`**

В `shared/report/report-variants.ts`:

1. Расширить `ReportVariantDecl` полем `block?: string`.
2. Добавить `report.block` в перечень видов, которые обходит валидатор.
3. Для варианта вида `report.block`:
   - `block` обязателен, иначе сообщение `вариант "<key>" не назвал блок, которому принадлежит`;
   - `block` проходит `isReportBlockKey`, иначе `неизвестный блок "<block>"`;
   - `block` не равен `page-break`, иначе `разрыв листа не имеет раскладки`;
   - `placeholders[]` РАЗРЕШЕНЫ и проверяются общим `validateVariantFields`;
   - ключ, встреченный и в `placeholders[]`, и в `settings[]`, даёт `ключ "<key>" объявлен дважды`.
4. Существующий запрет `placeholders[]` оставить, но ТОЛЬКО для видов `report` и `report.adaptive`
   (сегодня он висит на всех вариантах цикла).
5. Проверку «ровно один `isDefault` на вид» дополнить проверкой «ровно один `isDefault` на БЛОК».
6. Добавить экспорт:

   ```ts
   /**
    * Документ по умолчанию, объявленный шаблоном для вида (PRD-51 §3.3).
    *
    * @param manifest Манифест шаблона.
    * @param kind Вид отчёта: `report` или `report.adaptive`.
    * @returns Ключи блоков в порядке печати; пустой массив = шаблон документа не объявил, и
    *   отчёт печатается цельной раскладкой (§5.4).
    */
   export function resolveReportDocumentDecl(manifest: unknown, kind: ReportKind): string[] {
     const raw = (manifest as { reportDocument?: Record<string, unknown> } | null)?.reportDocument;
     const list = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[kind] : null;
     return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : [];
   }
   ```

7. Валидировать `reportDocument`: каждый ключ проходит `isReportBlockKey`, каждый системный ключ
   имеет объявленный вариант, дубли ключей запрещены.

- [x] **Шаг 4: Прогнать тест и убедиться, что он проходит**

```bash
npm test -- shared/report/__tests__/report-variants.blocks.test.ts
```

Ожидание: PASS, 8 тестов.

- [x] **Шаг 5: Прогнать существующие тесты варианта отчёта — регрессия запрета**

```bash
npm test -- shared/report/__tests__
```

Ожидание: PASS. Если тест на запрет `placeholders` красный — он проверял запрет на ВСЕХ видах;
поправить его так, чтобы он проверял запрет на оболочке, и дописать случай разрешения на блоке.

- [x] **Шаг 6: Коммит**

```bash
git add shared/report/report-variants.ts shared/report/__tests__
git commit -m "feat(prd-51): вид report.block и документ по умолчанию в манифесте"
```

---

## Task 4: Таблица `report_blocks`

**Files:**

- Modify: `shared/schema.ts`
- Create: `drizzle/00NN_prd51_report_blocks.sql` (имя даёт генератор)
- Create: `server/storage/report-blocks-repository.ts`
- Modify: `server/storage.ts`
- Test: `server/storage/__tests__/report-blocks-repository.it.test.ts`

- [x] **Шаг 1: Описать таблицу в схеме**

В `shared/schema.ts`, рядом с `contentPages`:

```ts
/**
 * PRD-51 §4: документ отчёта — упорядоченный список блоков ОДНОГО теста.
 *
 * Своя таблица, а не зона в `content_pages`, хотя форма совпадает. Страница отчёта не
 * участвует в выдаче, а каждый потребитель `content_pages` (сборка выдачи, последовательности
 * страниц, гард целостности, книга Excel, снимок публикации) обходит таблицу целиком: один
 * пропущенный фильтр означал бы страницу отчёта посреди прохождения теста. Отдельная таблица
 * делает эту ошибку невозможной, а не маловероятной.
 *
 * Пустой набор строк = документ по умолчанию шаблона; строки материализуются при первой
 * правке документа, как страницы теста.
 */
export const reportBlocks = pgTable("report_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: varchar("test_id", { length: 36 })
    .notNull()
    .references(() => tests.id, { onDelete: "cascade" }),
  /** Документ на РЕЖИМ теста: обе ветви живут одновременно, как в `report_settings_json`. */
  mode: text("mode", { enum: ["standard", "adaptive"] }).notNull(),
  /** Ключ блока (`shared/report/report-blocks`). Текст, а не enum: реестр принадлежит коду,
   *  и расширять CHECK-констрейнт при каждом новом блоке пришлось бы миграцией. */
  block: text("block").notNull(),
  /** Выбранный вариант шаблона; NULL = вариант с `isDefault` этого блока. */
  templateKey: text("template_key"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Системный блок гасится этим признаком и остаётся в списке (PRD-51 §3.1). */
  enabled: boolean("enabled").notNull().default(true),
  /** Содержимое: значения `placeholders[]` варианта. */
  valuesJson: jsonb("values_json").notNull().default({}),
  /** Свойства: значения `settings[]` варианта. */
  settingsJson: jsonb("settings_json").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  testModeSortIdx: index("report_blocks_test_mode_sort_idx").on(table.testId, table.mode, table.sortOrder),
}));

export type ReportBlockRow = typeof reportBlocks.$inferSelect;
export type InsertReportBlockRow = typeof reportBlocks.$inferInsert;
```

- [x] **Шаг 2: Сгенерировать миграцию**

```bash
npx drizzle-kit generate
```

Ожидание: новый файл в `drizzle/` с `CREATE TABLE "report_blocks"`. Переименовать его в
`00NN_prd51_report_blocks.sql`, сохранив номер, который выдал генератор, и проверить, что журнал
`drizzle/meta/_journal.json` обновился.

ГОЧА: пересобирать уже применённую миграцию нельзя — механизм судит по времени, а не по хешам.
Если файл придётся править, править ДО первого `db:migrate`.

- [x] **Шаг 3: Применить миграцию к dev-БД**

```bash
npm run db:migrate
```

Ожидание: `report_blocks` создана. dev-БД общая для всех рабочих копий — миграция аддитивная,
поэтому применять её безопасно.

- [x] **Шаг 4: Написать падающий интеграционный тест репозитория**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { makeTestDb } from "./helpers/test-db";
import { ReportBlocksRepository } from "../report-blocks-repository";

describe("ReportBlocksRepository", () => {
  let db: Awaited<ReturnType<typeof makeTestDb>>;
  let repo: ReportBlocksRepository;
  let testId: string;

  beforeEach(async () => {
    db = await makeTestDb();
    repo = new ReportBlocksRepository(db.db);
    testId = await db.seedTest();
  });

  it("у нового теста документа нет", async () => {
    expect(await repo.listReportBlocks(testId, "standard")).toEqual([]);
  });

  it("сохраняет документ целиком и читает его в порядке sortOrder", async () => {
    await repo.replaceReportBlocks(testId, "standard", [
      { block: "topics", sortOrder: 1, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {} },
      { block: "header", sortOrder: 0, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {} },
    ]);
    const rows = await repo.listReportBlocks(testId, "standard");
    expect(rows.map((r) => r.block)).toEqual(["header", "topics"]);
  });

  it("замена документа одного режима не трогает другой", async () => {
    await repo.replaceReportBlocks(testId, "adaptive", [
      { block: "header", sortOrder: 0, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {} },
    ]);
    await repo.replaceReportBlocks(testId, "standard", []);
    expect(await repo.listReportBlocks(testId, "adaptive")).toHaveLength(1);
  });

  it("удаление теста уносит его документ", async () => {
    await repo.replaceReportBlocks(testId, "standard", [
      { block: "header", sortOrder: 0, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {} },
    ]);
    await db.deleteTest(testId);
    expect(await repo.listReportBlocks(testId, "standard")).toEqual([]);
  });
});
```

Хелпер `makeTestDb` уже есть у соседних интеграционных тестов — взять его из существующего файла в
`server/storage/__tests__/`, не писать свой.

- [x] **Шаг 5: Прогнать тест и убедиться, что он падает**

```bash
npm run test:it -- server/storage/__tests__/report-blocks-repository.it.test.ts
```

Ожидание: FAIL, модуль репозитория не найден.

- [x] **Шаг 6: Написать репозиторий**

```ts
/**
 * @module server/storage/report-blocks-repository
 *
 * Слой данных документа отчёта (PRD-51 §4).
 *
 * Замена документа — ОДНА транзакция: удалить строки режима и вставить новые. Порядок и состав
 * блоков осмысленны только целиком, и частично записанный документ означал бы отчёт, которого
 * автор не собирал.
 */
import { and, asc, eq } from "drizzle-orm";
import { reportBlocks, type ReportBlockRow, type InsertReportBlockRow } from "@shared/schema";
import type { DrizzleDb } from "./shared";

/** Поля строки, которые задаёт вызывающий; `testId` и `mode` приходят аргументами. */
export type ReportBlockInput = Omit<InsertReportBlockRow, "id" | "testId" | "mode" | "createdAt" | "updatedAt">;

export class ReportBlocksRepository {
  constructor(private readonly db: DrizzleDb) {}

  /** Документ теста для режима, в порядке печати. Пустой массив = документ по умолчанию шаблона. */
  async listReportBlocks(testId: string, mode: "standard" | "adaptive"): Promise<ReportBlockRow[]> {
    return this.db
      .select()
      .from(reportBlocks)
      .where(and(eq(reportBlocks.testId, testId), eq(reportBlocks.mode, mode)))
      .orderBy(asc(reportBlocks.sortOrder));
  }

  /** Заменить документ режима целиком. Пустой список стирает документ и возвращает тест к умолчанию. */
  async replaceReportBlocks(
    testId: string,
    mode: "standard" | "adaptive",
    blocks: ReportBlockInput[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(reportBlocks).where(and(eq(reportBlocks.testId, testId), eq(reportBlocks.mode, mode)));
      if (!blocks.length) return;
      await tx.insert(reportBlocks).values(blocks.map((b) => ({ ...b, testId, mode })));
    });
  }
}
```

- [x] **Шаг 7: Прогнать тест и убедиться, что он проходит**

```bash
npm run test:it -- server/storage/__tests__/report-blocks-repository.it.test.ts
```

Ожидание: PASS, 4 теста.

- [x] **Шаг 8: Подключить репозиторий к фасаду**

В `server/storage.ts` добавить в контракт `IStorage` два метода и делегировать их так же, как это
сделано для соседних репозиториев (взять образец у `content-pages`, не изобретать свой):

```ts
listReportBlocks(testId: string, mode: "standard" | "adaptive"): Promise<ReportBlockRow[]>;
replaceReportBlocks(testId: string, mode: "standard" | "adaptive", blocks: ReportBlockInput[]): Promise<void>;
```

- [x] **Шаг 9: Проверить типы**

```bash
npm run check
```

Ожидание: 0 ошибок.

- [x] **Шаг 10: Коммит**

```bash
git add shared/schema.ts drizzle/ server/storage.ts server/storage/report-blocks-repository.ts server/storage/__tests__/report-blocks-repository.it.test.ts
git commit -m "feat(prd-51): таблица report_blocks и слой данных документа"
```

---

## Task 5: Разрешение документа

**Files:**

- Create: `shared/report/report-document.ts`
- Test: `shared/report/__tests__/report-document.test.ts`

- [x] **Шаг 1: Написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { resolveReportDocument } from "../report-document";

const manifest = {
  contentTemplates: [
    { key: "report.standard", kind: "report", layoutFile: "shell.html", isDefault: true },
    { key: "b.header", kind: "report.block", block: "header", layoutFile: "header.html", isDefault: true },
    { key: "b.topics", kind: "report.block", block: "topics", layoutFile: "topics.html", isDefault: true },
    { key: "b.page", kind: "report.block", block: "page", layoutFile: "page.html", isDefault: true,
      placeholders: [{ key: "body", type: "richText", label: "Текст" }] },
  ],
  reportDocument: { report: ["header", "topics"] },
};

describe("разрешение документа отчёта", () => {
  it("без строк теста отдаёт документ по умолчанию, всё включено", () => {
    const doc = resolveReportDocument(manifest, "report", []);
    expect(doc.blocks.map((b) => b.block)).toEqual(["header", "topics"]);
    expect(doc.blocks.every((b) => b.enabled)).toBe(true);
    expect(doc.blocks[0].layoutFile).toBe("header.html");
  });

  it("со строками теста берёт их порядок и признак показа", () => {
    const doc = resolveReportDocument(manifest, "report", [
      { block: "topics", sortOrder: 0, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {} },
      { block: "header", sortOrder: 1, enabled: false, templateKey: null, valuesJson: {}, settingsJson: {} },
    ]);
    expect(doc.blocks.map((b) => b.block)).toEqual(["topics", "header"]);
    expect(doc.blocks[1].enabled).toBe(false);
  });

  it("блок, которого шаблон не объявляет, пропускается, но строка не теряется", () => {
    const doc = resolveReportDocument(manifest, "report", [
      { block: "scales", sortOrder: 0, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {} },
      { block: "header", sortOrder: 1, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {} },
    ]);
    expect(doc.blocks.map((b) => b.block)).toEqual(["header"]);
    expect(doc.skipped).toEqual(["scales"]);
  });

  it("блок, появившийся в шаблоне позже, дописывается в конец выключенным", () => {
    const doc = resolveReportDocument(manifest, "report", [
      { block: "header", sortOrder: 0, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {} },
    ]);
    expect(doc.blocks.map((b) => b.block)).toEqual(["header", "topics"]);
    expect(doc.blocks[1].enabled).toBe(false);
  });

  it("неизвестный вариант деградирует к isDefault своего блока", () => {
    const doc = resolveReportDocument(manifest, "report", [
      { block: "topics", sortOrder: 0, enabled: true, templateKey: "нет-такого", valuesJson: {}, settingsJson: {} },
    ]);
    expect(doc.blocks[0].layoutFile).toBe("topics.html");
  });

  it("разрыв листа проходит без раскладки", () => {
    const doc = resolveReportDocument(manifest, "report", [
      { block: "page-break", sortOrder: 0, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {} },
    ]);
    expect(doc.blocks[0].nature).toBe("page-break");
    expect(doc.blocks[0].layoutFile).toBe("");
  });

  it("шаблон без объявлений отдаёт пустой документ — признак цельной раскладки", () => {
    const doc = resolveReportDocument({ contentTemplates: [] }, "report", []);
    expect(doc.blocks).toEqual([]);
    expect(doc.monolithic).toBe(true);
  });
});
```

- [x] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
npm test -- shared/report/__tests__/report-document.test.ts
```

Ожидание: FAIL, модуль не найден.

- [x] **Шаг 3: Написать реализацию**

```ts
/**
 * @module shared/report/report-document
 *
 * Разрешение ДОКУМЕНТА отчёта: манифест шаблона плюс строки теста дают упорядоченный список
 * блоков с раскладкой, значениями и признаком показа (PRD-51 §5.1).
 *
 * Одна функция на все три выдачи — PDF, SCORM-пакет, предпросмотр автора. Вторая реализация
 * означала бы, что автор согласовывает не тот документ, который получит слушатель.
 *
 * Чистый модуль: ни DOM, ни Node.
 */
import { REPORT_SYSTEM_BLOCKS, reportBlockNature, type ReportBlockNature } from "./report-blocks";
import { resolveReportDocumentDecl, type ReportKind } from "./report-variants";

/** Строка документа, как её хранит тест (подмножество `report_blocks`). */
export interface ReportBlockRowInput {
  block: string;
  sortOrder: number;
  enabled: boolean;
  templateKey: string | null;
  valuesJson: Record<string, unknown>;
  settingsJson: Record<string, unknown>;
}

/** Блок, готовый к печати. */
export interface ResolvedReportBlock {
  block: string;
  nature: ReportBlockNature;
  enabled: boolean;
  /** Путь раскладки; пуст у разрыва листа — он не раскладка, а инструкция документу. */
  layoutFile: string;
  /** Объявление `placeholders[]` варианта — для заполнения областей содержимого. */
  placeholders: Array<{ key: string; type: string }>;
  values: Record<string, unknown>;
  settings: Record<string, unknown>;
}

/** Разрешённый документ. */
export interface ResolvedReportDocument {
  blocks: ResolvedReportBlock[];
  /** Блоки строк теста, которых текущий шаблон не объявляет: пропущены, но не удалены. */
  skipped: string[];
  /** Шаблон блоков не объявил — печатается цельная раскладка (§5.4). */
  monolithic: boolean;
}

interface BlockVariant {
  key: string;
  block: string;
  layoutFile: string;
  isDefault?: boolean;
  placeholders?: unknown;
}

function blockVariants(manifest: unknown): BlockVariant[] {
  const list = (manifest as { contentTemplates?: unknown[] } | null)?.contentTemplates;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (v): v is BlockVariant =>
      !!v && typeof v === "object" && (v as { kind?: unknown }).kind === "report.block",
  );
}

function placeholdersOf(variant: BlockVariant | undefined): Array<{ key: string; type: string }> {
  const raw = variant?.placeholders;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is { key: string; type: string } => !!p && typeof (p as { key?: unknown }).key === "string")
    .map((p) => ({ key: p.key, type: String((p as { type?: unknown }).type ?? "text") }));
}

/**
 * Свести манифест и строки теста в документ.
 *
 * @param manifest Манифест активного шаблона.
 * @param kind Вид отчёта: `report` или `report.adaptive`.
 * @param rows Строки `report_blocks` теста для режима, в любом порядке.
 */
export function resolveReportDocument(
  manifest: unknown,
  kind: ReportKind,
  rows: readonly ReportBlockRowInput[],
): ResolvedReportDocument {
  const variants = blockVariants(manifest);
  const declared = resolveReportDocumentDecl(manifest, kind);
  if (!variants.length && !declared.length) return { blocks: [], skipped: [], monolithic: true };

  const defaultOf = new Map<string, BlockVariant>();
  const byKey = new Map<string, BlockVariant>();
  for (const v of variants) {
    byKey.set(v.key, v);
    if (v.isDefault) defaultOf.set(v.block, v);
  }

  const known = (block: string): boolean =>
    reportBlockNature(block) !== "system" || defaultOf.has(block);

  const build = (row: ReportBlockRowInput): ResolvedReportBlock => {
    const nature = reportBlockNature(row.block);
    if (nature === "page-break") {
      return { block: row.block, nature, enabled: row.enabled, layoutFile: "",
               placeholders: [], values: {}, settings: {} };
    }
    const chosen = (row.templateKey && byKey.get(row.templateKey)) || defaultOf.get(row.block);
    return {
      block: row.block,
      nature,
      enabled: row.enabled,
      layoutFile: chosen?.layoutFile ?? "",
      placeholders: placeholdersOf(chosen),
      values: row.valuesJson ?? {},
      settings: row.settingsJson ?? {},
    };
  };

  // Строк нет — печатается документ по умолчанию шаблона, всё включено.
  if (!rows.length) {
    return {
      blocks: declared.filter(known).map((block) =>
        build({ block, sortOrder: 0, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {} }),
      ),
      skipped: [],
      monolithic: false,
    };
  }

  const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const skipped = ordered.filter((r) => !known(r.block)).map((r) => r.block);
  const blocks = ordered.filter((r) => known(r.block)).map(build);

  // Блок, появившийся в шаблоне ПОСЛЕ того, как автор собрал документ, дописывается в конец
  // ВЫКЛЮЧЕННЫМ: молча вставить чужому документу новый блок в середину нельзя, а потерять его —
  // тоже: автор о нём никогда не узнает.
  const present = new Set(ordered.map((r) => r.block));
  const missing = declared.filter((b) => !present.has(b) && known(b));
  for (const block of missing) {
    blocks.push(
      build({ block, sortOrder: 0, enabled: false, templateKey: null, valuesJson: {}, settingsJson: {} }),
    );
  }

  return { blocks, skipped, monolithic: false };
}

/** Подпись системного блока для редактора; пусто у неизвестного ключа. */
export function reportBlockLabel(block: string): string {
  return REPORT_SYSTEM_BLOCKS.find((b) => b.key === block)?.label ?? "";
}
```

- [x] **Шаг 4: Прогнать тест и убедиться, что он проходит**

```bash
npm test -- shared/report/__tests__/report-document.test.ts
```

Ожидание: PASS, 7 тестов.

- [x] **Шаг 5: Коммит**

```bash
git add shared/report/report-document.ts shared/report/__tests__/report-document.test.ts
git commit -m "feat(prd-51): разрешение документа отчёта из манифеста и строк теста"
```

---

## Task 6: Сборка документа в DOM

**Files:**

- Create: `shared/report/render-report.ts`
- Test: `shared/report/__tests__/render-report.test.ts`

- [x] **Шаг 1: Написать падающий тест**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderReportInto } from "../render-report";

const SHELL = '<div class="tb-report"></div>';
const HEADER = '<section class="tb-report__card"><h1 data-path="course.title"></h1></section>';
const PAGE = '<section class="tb-report__card"><div data-placeholder="body"></div></section>';

const ctx = { course: { title: "Тест руководителя" } };

function stage(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("сборка документа отчёта", () => {
  it("кладёт блоки ПРЯМЫМИ детьми корня", () => {
    const el = stage();
    renderReportInto(el, {
      shell: SHELL,
      context: ctx,
      blocks: [
        { block: "header", nature: "system", enabled: true, layoutFile: "h", layout: HEADER,
          placeholders: [], values: {}, settings: {} },
        { block: "topics", nature: "system", enabled: true, layoutFile: "t", layout: HEADER,
          placeholders: [], values: {}, settings: {} },
      ],
    });
    const root = el.firstElementChild as HTMLElement;
    expect(root.className).toBe("tb-report");
    expect(root.children).toHaveLength(2);
    expect(root.children[0].tagName).toBe("SECTION");
  });

  it("печатает контекст в блоке", () => {
    const el = stage();
    renderReportInto(el, {
      shell: SHELL, context: ctx,
      blocks: [{ block: "header", nature: "system", enabled: true, layoutFile: "h", layout: HEADER,
                 placeholders: [], values: {}, settings: {} }],
    });
    expect(el.textContent).toContain("Тест руководителя");
  });

  it("заполняет области содержимого страницы", () => {
    const el = stage();
    renderReportInto(el, {
      shell: SHELL, context: ctx,
      blocks: [{ block: "page", nature: "page", enabled: true, layoutFile: "p", layout: PAGE,
                 placeholders: [{ key: "body", type: "richText" }],
                 values: { body: "<p>Про тест</p>" }, settings: {} }],
    });
    expect(el.innerHTML).toContain("Про тест");
  });

  it("выключенный блок не печатается вовсе", () => {
    const el = stage();
    renderReportInto(el, {
      shell: SHELL, context: ctx,
      blocks: [{ block: "header", nature: "system", enabled: false, layoutFile: "h", layout: HEADER,
                 placeholders: [], values: {}, settings: {} }],
    });
    expect((el.firstElementChild as HTMLElement).children).toHaveLength(0);
  });

  it("разрыв листа печатается узлом data-page-break", () => {
    const el = stage();
    renderReportInto(el, {
      shell: SHELL, context: ctx,
      blocks: [{ block: "page-break", nature: "page-break", enabled: true, layoutFile: "", layout: "",
                 placeholders: [], values: {}, settings: {} }],
    });
    expect(el.querySelectorAll("[data-page-break]")).toHaveLength(1);
  });

  it("блок, не давший видимых узлов, не оставляет следа", () => {
    const el = stage();
    renderReportInto(el, {
      shell: SHELL, context: ctx,
      blocks: [{ block: "scales", nature: "system", enabled: true, layoutFile: "s",
                 layout: "{{#if result.scales}}<section>шкалы</section>{{/if}}",
                 placeholders: [], values: {}, settings: {} }],
    });
    expect((el.firstElementChild as HTMLElement).children).toHaveLength(0);
  });
});
```

- [x] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
npm test -- shared/report/__tests__/render-report.test.ts
```

Ожидание: FAIL, модуль не найден.

- [x] **Шаг 3: Написать реализацию**

```ts
/**
 * @module shared/report/render-report
 *
 * Сборка ДОКУМЕНТА отчёта в DOM (PRD-51 §5.2).
 *
 * Оболочка даёт корневой узел, блоки становятся его ПРЯМЫМИ детьми. Прямыми — потому что
 * постраничная раскладка меряет и режет именно детей корня (`paginate-dom`), и промежуточный
 * контейнер превратил бы документ в один неделимый переросток. Размещение делает эта функция,
 * а не шаблон: у шаблона нет узла, в который блоки бы попали, поэтому завернуть их он не может.
 *
 * Браузерный модуль: требует DOM. Правило документа считает `report-document.ts`, тут только
 * отрисовка.
 */
import { renderScreenInto } from "../template/render-screen";
import type { ResolvedReportBlock } from "./report-document";

/** Блок с уже прочитанной раскладкой: файлы читает ХОСТ, ядро их не видит. */
export interface ReportBlockToRender extends ResolvedReportBlock {
  /** Разметка раскладки блока; пуста у разрыва листа. */
  layout: string;
}

export interface RenderReportInput {
  /** Разметка оболочки: один корневой узел `.tb-report`. */
  shell: string;
  /** Публичный контекст отчёта — ОДИН на весь документ. */
  context: unknown;
  blocks: readonly ReportBlockToRender[];
}

/**
 * Отрисовать документ в контейнер.
 *
 * @param stage Контейнер; после вызова его единственный ребёнок — корень документа.
 * @param input Оболочка, контекст и блоки в порядке печати.
 */
export function renderReportInto(stage: HTMLElement, input: RenderReportInput): void {
  renderScreenInto(stage, { layout: input.shell, context: input.context });
  const root = stage.firstElementChild as HTMLElement | null;
  if (!root) throw new Error("Оболочка отчёта ничего не отрисовала");

  const doc = stage.ownerDocument;
  for (const block of input.blocks) {
    if (!block.enabled) continue;

    if (block.nature === "page-break") {
      const mark = doc.createElement("div");
      mark.setAttribute("data-page-break", "");
      root.appendChild(mark);
      continue;
    }

    if (!block.layout) continue;

    // Блок рисуется в СВОЙ буфер, а его дети переносятся в корень: так буфер не становится
    // тем самым промежуточным контейнером, из-за которого документ перестал бы делиться.
    const buffer = doc.createElement("div");
    renderScreenInto(buffer, {
      layout: block.layout,
      context: input.context,
      content: { template: { placeholders: block.placeholders }, values: block.values },
    });
    while (buffer.firstElementChild) root.appendChild(buffer.firstElementChild);
  }
}
```

- [x] **Шаг 4: Прогнать тест и убедиться, что он проходит**

```bash
npm test -- shared/report/__tests__/render-report.test.ts
```

Ожидание: PASS, 6 тестов.

- [x] **Шаг 5: Коммит**

```bash
git add shared/report/render-report.ts shared/report/__tests__/render-report.test.ts
git commit -m "feat(prd-51): сборка документа отчёта из блоков"
```

---

## Task 7: Три выдачи зовут сборку

**Files:**

- Modify: `shared/report/export-pdf.ts:171`
- Modify: `shared/report/report-variants.ts` (`resolveReportBake`)
- Modify: `server/scorm/builders/test-json.ts`
- Modify: `client/src/features/tests/editor/sections/report-preview-modal.tsx`
- Test: `shared/report/__tests__/export-pdf.document.test.ts` (создаётся)

- [x] **Шаг 1: Написать падающий тест конвейера PDF**

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { exportReportPdf } from "../export-pdf";

/** Двойник jsPDF: считает страницы и не рисует ничего. */
function makeDeps() {
  const pages: unknown[] = [];
  return {
    document,
    html2canvas: vi.fn(async () => ({ toDataURL: () => "data:image/png;base64,", width: 595, height: 842 })),
    jsPDF: class {
      addImage(...args: unknown[]) { pages.push(args); }
      addPage() {}
      output() { return "PDF"; }
    },
    pages,
  };
}

describe("конвейер PDF собирает документ из блоков", () => {
  it("печатает блоки прямыми детьми корня", async () => {
    const deps = makeDeps();
    await exportReportPdf(
      {
        shell: '<div class="tb-report"></div>',
        blocks: [
          { block: "header", nature: "system", enabled: true, layoutFile: "h",
            layout: '<section id="b1"></section>', placeholders: [], values: {}, settings: {} },
          { block: "topics", nature: "system", enabled: true, layoutFile: "t",
            layout: '<section id="b2"></section>', placeholders: [], values: {}, settings: {} },
        ],
        context: {},
        css: "",
      } as never,
      "Тест",
      deps as never,
    );
    expect(deps.pages.length).toBeGreaterThan(0);
  });
});
```

- [x] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
npm test -- shared/report/__tests__/export-pdf.document.test.ts
```

Ожидание: FAIL — `ReportPage` не принимает `shell`/`blocks`.

- [x] **Шаг 3: Расширить `ReportPage` и переключить конвейер**

В `shared/report/export-pdf.ts`:

1. Тип `ReportPage` получает необязательные `shell?: string` и `blocks?: ReportBlockToRender[]`
   рядом с существующим `layout`.
2. Строка 171 заменяется на:

   ```ts
       // ДОКУМЕНТ ИЗ БЛОКОВ (PRD-51). Шаблон, объявивший блоки, приходит с оболочкой и списком;
       // шаблон без блоков — со старым цельным `layout`, и путь совместимости остаётся живым
       // (§5.4). Разводить это по двум конвейерам нельзя: постраничная раскладка, стыки листов и
       // растеризация ниже одни и те же, и вторая копия разошлась бы с первой на первой же правке.
       if (page.shell && page.blocks?.length) {
         renderReportInto(stage, { shell: page.shell, context: page.context, blocks: page.blocks });
       } else {
         renderScreenInto(stage, { layout: page.layout, context: page.context });
       }
   ```

3. Импортировать `renderReportInto` из `./render-report`.

- [x] **Шаг 4: Прогнать тест и убедиться, что он проходит**

```bash
npm test -- shared/report/__tests__/export-pdf.document.test.ts
```

Ожидание: PASS.

- [x] **Шаг 5: Прогнать существующие тесты конвейера — путь совместимости жив**

```bash
npm test -- shared/report
```

Ожидание: PASS, ни один существующий тест не покраснел.

- [x] **Шаг 6: Отдавать документ из `resolveReportBake`**

В `shared/report/report-variants.ts` в возвращаемое значение `resolveReportBake` добавить поле
`document: ResolvedReportDocument | null` (null, когда `monolithic`). Строки теста функция получает
новым необязательным аргументом `rows`, потому что манифест их не знает, а два источника документа
недопустимы.

- [x] **Шаг 7: Запечь документ в пакет**

В `server/scorm/builders/test-json.ts` рядом с существующей выпечкой отчёта:

- положить в `TEST_DATA` оболочку, список блоков и их значения;
- очистить строковые значения блоков ТЕМ ЖЕ вызовом, каким чистятся значения контентных страниц:

```ts
      const sanitizedBlockValues: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(block.values ?? {})) {
        sanitizedBlockValues[k] = typeof v === "string" ? sanitizeHtml(v, { scope: placeholderScope(k) }) : v;
      }
```

- объявить в пакете раскладки ВСЕХ использованных вариантов блоков (иначе в LMS документ соберётся
  из пустых блоков).

- [x] **Шаг 8: Переключить предпросмотр автора**

В `client/src/features/tests/editor/sections/report-preview-modal.tsx` передавать в `TemplateScreen`
оболочку и блоки черновика вместо цельной раскладки. Второго движка предпросмотра нет и заводить его
нельзя — окно обязано показывать ровно то, что уйдёт слушателю.

- [x] **Шаг 9: Проверить типы и прогнать затронутые тесты**

```bash
npm run check
npm test -- shared/report server/scorm/__tests__
```

Ожидание: 0 ошибок типов; тесты зелёные.

- [x] **Шаг 10: Коммит**

```bash
git add shared/report server/scorm/builders/test-json.ts client/src/features/tests/editor/sections/report-preview-modal.tsx
git commit -m "feat(prd-51): PDF, пакет и предпросмотр собирают документ из блоков"
```

---

## Task 8: Деградация шаблона без блоков

**Files:**

- Test: `shared/report/__tests__/report-document.test.ts` (дополняется)
- Modify: `shared/report/report-variants.ts` (при необходимости)

- [x] **Шаг 1: Написать падающий тест**

```ts
  it("шаблон без блоков собирает цельную раскладку, как сегодня", () => {
    const legacy = {
      contentTemplates: [
        { key: "report.standard", kind: "report", layoutFile: "layouts/report.html", isDefault: true },
      ],
    };
    const bake = resolveReportBake(legacy, "report", null);
    expect(bake.document).toBeNull();
    expect(bake.layoutKey).toBe("layouts/report.html");
  });
```

- [x] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
npm test -- shared/report/__tests__/report-document.test.ts
```

Ожидание: FAIL — поля `document` нет либо оно не `null`.

- [x] **Шаг 3: Довести реализацию до зелёного**

`resolveReportBake` отдаёт `document: null`, когда `resolveReportDocument` вернул `monolithic: true`;
`layoutKey` при этом остаётся прежним. Никакой второй ветки в конвейере не заводить: разводит их
уже условие шага 3 задачи 7.

- [x] **Шаг 4: Прогнать тест**

```bash
npm test -- shared/report/__tests__/report-document.test.ts
```

Ожидание: PASS.

- [x] **Шаг 5: Коммит**

```bash
git add shared/report
git commit -m "feat(prd-51): шаблон без блоков печатает цельную раскладку"
```

---

## Task 9: Разбор стандартного шаблона на блоки

**Files:**

- Create: `server/scorm/templates/default/layouts/report/shell.html` и десять файлов блоков
  (перечень — в разделе «Структура файлов»)
- Modify: `server/scorm/templates/default/manifest.json`
- Read: `server/scorm/templates/default/layouts/report.html` (источник разбора)

- [x] **Шаг 1: Разрезать раскладку по секциям**

Прочитать `server/scorm/templates/default/layouts/report.html` целиком и перенести его секции в
файлы блоков ДОСЛОВНО, вместе с комментариями: комментарии в этой раскладке объясняют гейты и
решения (почему сводка гейтится `hideScoreSummary`, почему показатель — своя карточка), и потеря
комментария при переносе — потеря обоснования.

Разрез по секциям:

| Файл блока | Что переносится из `report.html` |
| --- | --- |
| `report/shell.html` | Корневой `<div class="tb-report …">` с подложкой и `tb-report__brand`, БЕЗ содержимого |
| `report/header.html` | `tb-report__title--head`, `__headline`, `__attempts`, `__learner`, `__date` |
| `report/intro.html` | Секция `result.introHtml` |
| `report/summary.html` | Карточка `{{#unless result.hideScoreSummary}}` целиком |
| `report/topics.html` | Карточка `{{#if report.hasTopics}}` целиком, вместе с группами и плоским списком |
| `report/breakdown.html` | Карточка `{{#if result.breakdown}}` |
| `report/scales.html` | Карточка `{{#if result.scales}}` вместе с диаграммой |
| `report/indicators.html` | Цикл `{{#each result.indicators}}` |
| `report/recommendations.html` | Карточка `{{#if result.recommendations.hasAny}}` |
| `report/courses.html` | Карточка `{{#if report.hasCourses}}` |
| `report/events.html` | Карточка `{{#if report.hasEvents}}` |

ГОЧА зонтичного заголовка: строка `{{#if labels.results.heading}}` сегодня стоит МЕЖДУ шапкой и
сводкой и покрывает сводку, темы, шкалы и показатели. Она переносится в `summary.html` первой
строкой — там же, где стояла. Если положить её в `header.html`, документ без сводки напечатает
заголовок над пустотой.

- [x] **Шаг 2: Объявить варианты и документ в манифесте**

В `server/scorm/templates/default/manifest.json`:

1. Существующему `report.standard` сменить `layoutFile` на `layouts/report/shell.html`.
2. Добавить одиннадцать вариантов `kind: "report.block"` (десять системных + `page`), каждый
   `isDefault: true` для своего блока.
3. Вариант страницы объявляет поля:

   ```json
   {
     "key": "report.block.page.text",
     "kind": "report.block",
     "block": "page",
     "label": "Страница: заголовок и текст",
     "layoutFile": "layouts/report/page-text.html",
     "isDefault": true,
     "placeholders": [
       { "key": "title", "type": "text", "label": "Заголовок" },
       { "key": "body", "type": "richText", "label": "Текст" }
     ]
   }
   ```

4. Добавить `reportDocument` с сегодняшним порядком печати:

   ```json
   "reportDocument": {
     "report": ["header", "intro", "summary", "topics", "breakdown", "scales",
                "indicators", "recommendations", "courses", "events"],
     "report.adaptive": ["header", "intro", "topics", "breakdown", "scales",
                         "indicators", "recommendations", "courses", "events"]
   }
   ```

- [x] **Шаг 3: Написать раскладку авторской страницы**

`server/scorm/templates/default/layouts/report/page-text.html`:

```html
<section class="tb-report__card">
  <div class="tb-report__title tb-report__title--tight" data-placeholder="title"></div>
  <div class="tb-report__rec tb-report__rec--plain"><div data-placeholder="body"></div></div>
</section>
```

- [x] **Шаг 4: Перезапустить dev-сервер**

```bash
npm run dev
```

Манифест живёт в БД, и правка файла не видна приложению без перезапуска.

- [x] **Шаг 5: Коммит**

```bash
git add server/scorm/templates/default
git commit -m "feat(prd-51): стандартный шаблон разобран на блоки отчёта"
```

---

## Task 10: Побайтовое совпадение документа

**Files:**

- Create: `tests/report-document-parity.test.ts`

Это ГЛАВНАЯ проверка Э2: разбор на блоки не имел права сдвинуть вёрстку.

- [x] **Шаг 1: Написать падающий тест**

```ts
// @vitest-environment jsdom
/**
 * @module tests/report-document-parity
 *
 * Разбор стандартного отчёта на блоки обязан быть ПЕРЕНОСОМ, а не редизайном: тест, ничего не
 * настраивавший, печатает тот же документ. Сравнивается отрисованный DOM, а не файлы: файлы
 * разошлись намеренно (одна раскладка стала двенадцатью), а документ разойтись не имеет права.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderScreenInto } from "@shared/template/render-screen";
import { renderReportInto } from "@shared/report/render-report";
import { resolveReportDocument } from "@shared/report/report-document";
import { buildReportFixtureContext } from "./helpers/report-fixture";

const DIR = path.resolve(__dirname, "../server/scorm/templates/default");
const read = (p: string): string => fs.readFileSync(path.join(DIR, p), "utf8");

/** Пробелы между узлами — не часть документа: DSL печатает их по-разному в двух путях. */
const normalize = (html: string): string => html.replace(/>\s+</g, "><").trim();

describe("паритет документа отчёта", () => {
  it("блоки дают тот же DOM, что цельная раскладка", () => {
    const manifest = JSON.parse(read("manifest.json"));
    const context = buildReportFixtureContext();

    const legacyStage = document.createElement("div");
    renderScreenInto(legacyStage, { layout: read("layouts/report.html"), context });

    const doc = resolveReportDocument(manifest, "report", []);
    const blockStage = document.createElement("div");
    renderReportInto(blockStage, {
      shell: read("layouts/report/shell.html"),
      context,
      blocks: doc.blocks.map((b) => ({ ...b, layout: b.layoutFile ? read(b.layoutFile) : "" })),
    });

    expect(normalize(blockStage.innerHTML)).toBe(normalize(legacyStage.innerHTML));
  });
});
```

- [x] **Шаг 2: Написать фикстуру контекста**

`tests/helpers/report-fixture.ts` — контекст с ЗАПОЛНЕННЫМИ данными всех десяти блоков: темы с
группами и разрезами, шкалы, показатели, рекомендации, курсы, мероприятия, вводный блок. Пустой
контекст не годится: он погасил бы гейты и сравнил два пустых документа.

Собирать его настоящим `buildResultContext` + `buildReportContext` из `@shared/report/report-context`
на синтетическом входе, а не руками: контекст, собранный руками, не заметит, если ядро сменит форму
поля.

- [x] **Шаг 3: Прогнать тест**

```bash
npm test -- tests/report-document-parity.test.ts
```

Ожидание: сперва FAIL с наглядным диффом — по нему и доводится разрез шага 1 задачи 9. Разрешается
править ТОЛЬКО файлы блоков, приводя их к источнику; трогать `layouts/report.html` ради зелёного
теста запрещено — он и есть эталон.

- [x] **Шаг 4: Добиться зелёного и повторить для адаптивного отчёта**

Дописать второй случай, сравнивающий `layouts/report.adaptive.html` с документом вида
`report.adaptive`.

```bash
npm test -- tests/report-document-parity.test.ts
```

Ожидание: PASS, 2 теста.

- [x] **Шаг 5: Коммит**

```bash
git add tests/report-document-parity.test.ts tests/helpers/report-fixture.ts
git commit -m "test(prd-51): документ из блоков совпадает с цельной раскладкой"
```

---

## Task 11: Приёмка Э1-Э2 в браузере

**Files:** нет — проверка на живом стенде.

Юнит-тесты сравнивают DOM; растеризацию и стыки листов они не видят. Правило проекта: приёмка
фронтенда — в браузере.

- [x] **Шаг 1: Поднять второй экземпляр dev-сервера**

```bash
PORT=8099 npm run dev
```

Живой dev серверные правки не подхватывает — нужен именно новый запуск.

- [x] **Шаг 2: Скачать отчёт учётной записью приёмки**

Войти как `acceptance@local.test`, пройти тест с темами, шкалами и показателями, нажать «Скачать
отчёт».

- [x] **Шаг 3: Сверить PDF с эталоном, снятым ДО правки**

Открыть оба PDF постранично и сверить: число листов, положение карточек, стыки листов, непрозрачный
низ каждого листа. Расхождение — дефект Э2, а не «мелочь оформления».

- [x] **Шаг 4: Повторить в SCORM-пакете**

```bash
npm run scorm:sample
npm run scorm:player
```

Пройти пакет на `:5050`, скачать отчёт, сверить с веб-версией: документ обязан совпасть.

- [x] **Шаг 5: Записать результат приёмки**

`docs/reports/prd51-e1-e2-acceptance.md` — что проверено, чем, с какими числами. Отчёт без чисел
приёмкой не считается.

- [x] **Шаг 6: Коммит**

```bash
git add docs/reports/prd51-e1-e2-acceptance.md
git commit -m "docs(prd-51): приёмка этапов Э1-Э2"
```

---

## Дальнейшие планы

| План | Охват | Предусловие |
| --- | --- | --- |
| `2026-XX-XX-report-document-editor.md` | Э3, FR-15 - FR-19: карточка-документ, палитра, перетаскивание, вынос `PlaceholderControl` в общий модуль, маршруты сохранения документа | Э1-Э2 приняты; эскиз `prd51-report-document.html` утверждён |
| `2026-XX-XX-certification-report.md` | Э4, FR-22 - FR-23: оболочка и блоки шаблона «Сертификация», светлый `report.css`, вывод раскладок отчёта из паритета | Э3 принят; эскиз `prd51-certification-report.html` утверждён |
| `2026-XX-XX-template-contract-2-0.md` | Э5, FR-24: спецификация формата 2.0.0, руководство 2.0.0, `npm run docs:pdf` | Э4 принят |

Планы пишутся ПОСЛЕ приёмки предыдущего этапа, а не сейчас: их шаги опираются на сигнатуры
`resolveReportDocument`, `renderReportInto` и методов `IStorage`, которые появляются в этом плане, и
написанные заранее они содержали бы угаданные имена — то есть протухли бы к моменту исполнения.
