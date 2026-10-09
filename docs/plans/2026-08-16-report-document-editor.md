# PRD-51. Редактор документа отчёта — план реализации, часть 2 (этап Э3)

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ ПОДНАВЫК — `superpowers:subagent-driven-development`
> (рекомендуется) или `superpowers:executing-plans`. Шаги помечены чек-боксами (`- [ ]`).

**Статус: ВЫПОЛНЕН.** Этап Э3 реализован, принят и влит в `main` 2026-08-16 (последний коммит трека
`e272cb2f`), приёмка — [отчёт](../reports/prd51-e3-acceptance.md). Все 40 пунктов отмечены
выполненными проходом актуализации 2026-09-01: план исполнялся прямо в сессии, а не через
`executing-plans`, поэтому построчных отметок по ходу работы не ставилось — свидетельством
исполнения служат отчёт приёмки и код, а не чекбоксы.

**Цель:** автор собирает документ отчёта тем же способом, что структуру теста — строками с
перетаскиванием, кнопками-вставками и палитрой вариантов, — и видит собранное в предпросмотре
до сохранения.

**Архитектура:** документ живёт в черновике редактора рядом с прочими настройками и уходит на
сервер тем же `PUT /api/tests/:id`, что и они. Строки `report_blocks` заменяются ЦЕЛИКОМ внутри
той же транзакции, что и остальной ящик настроек (`TestSettingsService.save`): порядок и состав
осмысленны только вместе, а частично сохранённый документ означал бы отчёт, которого автор не
собирал. Разрешение документа и его сборку клиент не повторяет — зовёт те же
`resolveReportDocument` / `renderReportInto`, что и обе выдачи.

**Стек:** React 19, дизайн-система `@skillum/ui-kit`, `@dnd-kit/core` (перетаскивание строк —
как в «Структуре»), Vitest + Testing Library, Drizzle ORM.

**Спека:** `docs/specs/prd-51/report-document-blocks.md` (§4 хранение, §5.1 разрешение, §7 редактор).

**Предшествующий план:** `docs/plans/2026-08-15-report-document-blocks.md` (Э1-Э2, закрыт;
приёмка — `docs/reports/prd51-e1-e2-acceptance.md`).

**Эскиз:** `docs/wireframes/prd51-report-document.html` — УТВЕРЖДЁН. Состояния `s-default`,
`s-row-expanded`, `s-add-palette`, `s-readonly`. Правило проекта: UI кодится узел-за-узлом из
открытого эскиза, «DONE» гейтится поэлементным скрин-диффом, а не «выглядит DS-чисто».

**Охват:** FR-15 - FR-19 и вторая половина FR-14 (очистка разметки при сохранении). Э4 (шаблон
«Сертификация») и Э5 (контракт формата 2.0.0) получают свои планы.

**Правила прогона тестов в этом репозитории:**

- Только `npm test -- <путь>`; `npx vitest run` в этом проекте падает.
- Полный прогон и `npm run test:cov` — ТОЛЬКО по явному разрешению владельца.
- Интеграционные тесты слоя данных — `npm run test:it -- <путь>`.
- В коммитах не должно быть трейлера `Co-Authored-By`.
- Перед `git commit` сверять `git diff --cached --name-only`: индекс общий на всю копию.

---

## Структура файлов

**Создаются:**

- `client/src/features/tests/editor/sections/placeholder-control.tsx` — вынесенные из
  `start-pages-section.tsx` контролы полей PRD-22 (`PlaceholderControl`, `ImagePlaceholderControl`).
- `client/src/features/tests/editor/sections/report-document-list.tsx` — список блоков документа:
  строки, тумблеры, меню, кнопки-вставки, перетаскивание.
- `client/src/features/tests/editor/sections/report-block-palette.tsx` — палитра добавления блока.
- `client/src/features/tests/editor/use-report-document.ts` — черновик документа: разрешение
  состава для активного шаблона и операции над списком.
- `client/src/features/tests/editor/sections/__tests__/report-document-list.test.tsx`
- `client/src/features/tests/editor/__tests__/use-report-document.test.ts`
- `tests/it/report-document-save.it.test.ts` — сохранение документа в одной транзакции с ящиком.

**Изменяются:**

- `client/src/features/tests/editor/test-editor.types.ts` — срез `reportDocument` в модели.
- `client/src/features/tests/editor/test-editor.mappers.ts` — чтение из API и сборка тела запроса.
- `client/src/features/tests/editor/sections/report-settings-card.tsx` — список блоков в карточке.
- `client/src/features/tests/editor/sections/report-preview-modal.tsx` — предпросмотр берёт черновик.
- `client/src/features/tests/editor/sections/start-pages-section.tsx` — импорт вынесенных контролов.
- `server/routes/tests.ts` — приём `reportBlocks` в теле `PUT /api/tests/:id`.
- `server/services/test-settings.ts` — замена строк документа внутри общей транзакции.
- `server/services/content-page-fields.ts` — очистка разметки областей документа тем же вызовом.
- `shared/schema.ts` — схема тела запроса для строк документа.

---

## Task 1: Вынести контролы полей в общий модуль

Второй копии контрола быть не должно: режимы ввода и очистка разошлись бы на первой правке.

**Files:**

- Create: `client/src/features/tests/editor/sections/placeholder-control.tsx`
- Modify: `client/src/features/tests/editor/sections/start-pages-section.tsx:1931-2000` (и
  `ImagePlaceholderControl` ниже по файлу)

- [x] **Шаг 1: Перенести функции без единой правки поведения**

Вырезать `PlaceholderControl` и `ImagePlaceholderControl` вместе с их JSDoc и перенести в новый
модуль. Экспортировать обе. Перенос ДОСЛОВНЫЙ: любая правка по дороге не будет отличима от
переноса ни в ревью, ни в диффе.

- [x] **Шаг 2: Заменить определения импортом**

В `start-pages-section.tsx` удалить перенесённые определения и добавить:

```tsx
import { PlaceholderControl, ImagePlaceholderControl } from "./placeholder-control";
```

- [x] **Шаг 3: Прогнать тесты структуры — поведение не изменилось**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__
```

Ожидание: столько же зелёных, сколько было до правки. Красный тест здесь означает, что перенос
дословным не был.

- [x] **Шаг 4: Коммит**

```bash
git add client/src/features/tests/editor/sections/placeholder-control.tsx client/src/features/tests/editor/sections/start-pages-section.tsx
git commit -m "refactor(prd-51): контрол полей PRD-22 вынесен в общий модуль"
```

---

## Task 2: Черновик документа в модели редактора

**Files:**

- Create: `client/src/features/tests/editor/use-report-document.ts`
- Test: `client/src/features/tests/editor/__tests__/use-report-document.test.ts`
- Modify: `client/src/features/tests/editor/test-editor.types.ts`

- [x] **Шаг 1: Написать падающий тест операций над документом**

```ts
import { describe, expect, it } from "vitest";
import { moveBlock, toggleBlock, insertBlock, removeBlock, type DraftBlock } from "../use-report-document";

const draft = (): DraftBlock[] => [
  { block: "header", templateKey: null, enabled: true, values: {}, settings: {} },
  { block: "topics", templateKey: null, enabled: true, values: {}, settings: {} },
  { block: "page", templateKey: "report.block.page.text", enabled: true, values: { body: "текст" }, settings: {} },
];

describe("черновик документа отчёта", () => {
  it("перемещает блок вверх, сохраняя остальные на местах", () => {
    expect(moveBlock(draft(), 1, -1).map((b) => b.block)).toEqual(["topics", "header", "page"]);
  });

  it("не двигает первый блок выше начала", () => {
    expect(moveBlock(draft(), 0, -1).map((b) => b.block)).toEqual(["header", "topics", "page"]);
  });

  it("гасит системный блок, не удаляя его", () => {
    const next = toggleBlock(draft(), 0);
    expect(next[0].enabled).toBe(false);
    expect(next).toHaveLength(3);
  });

  it("вставляет блок НА МЕСТО, откуда его добавили", () => {
    const next = insertBlock(draft(), 1, { block: "page-break", templateKey: null, enabled: true, values: {}, settings: {} });
    expect(next.map((b) => b.block)).toEqual(["header", "page-break", "topics", "page"]);
  });

  it("удаляет страницу вместе с её текстом", () => {
    expect(removeBlock(draft(), 2).map((b) => b.block)).toEqual(["header", "topics"]);
  });
});
```

- [x] **Шаг 2: Прогнать — падает на отсутствии модуля**

```bash
npm test -- client/src/features/tests/editor/__tests__/use-report-document.test.ts
```

Ожидание: FAIL, `Failed to resolve import`.

- [x] **Шаг 3: Реализовать чистые операции**

Все четыре — ЧИСТЫЕ функции над массивом, без React: их зовёт и компонент, и тест, и будущий
импорт книги. Порядок в массиве и есть `sortOrder`; отдельного поля в черновике нет — второй
источник истины о порядке разошёлся бы с первым.

- [x] **Шаг 4: Прогнать — зелено**

```bash
npm test -- client/src/features/tests/editor/__tests__/use-report-document.test.ts
```

Ожидание: PASS, 5 тестов.

- [x] **Шаг 5: Добавить срез в модель редактора**

В `test-editor.types.ts`:

```ts
  /**
   * PRD-51: ДОКУМЕНТ ОТЧЁТА — состав и порядок блоков по ветви режима. Отсутствует у
   * черновика теста, который документа не собирал: тогда печатается документ по
   * умолчанию шаблона, а не пустой отчёт.
   */
  reportDocument?: { standard?: DraftBlock[]; adaptive?: DraftBlock[] };
```

- [x] **Шаг 6: Коммит**

```bash
git add client/src/features/tests/editor/use-report-document.ts client/src/features/tests/editor/__tests__/use-report-document.test.ts client/src/features/tests/editor/test-editor.types.ts
git commit -m "feat(prd-51): черновик документа отчёта в модели редактора"
```

---

## Task 3: Сохранение документа одной транзакцией с ящиком

**Files:**

- Modify: `shared/schema.ts` (схема тела запроса)
- Modify: `server/routes/tests.ts:1072` (разбор тела)
- Modify: `server/services/test-settings.ts:362` (`save`)
- Test: `tests/it/report-document-save.it.test.ts`

- [x] **Шаг 1: Написать падающий интеграционный тест**

```ts
/**
 * @module tests/it/report-document-save
 * @description PRD-51: документ сохраняется В ТОЙ ЖЕ транзакции, что и прочие настройки.
 * Проверяется наблюдаемое следствие: неудача на любом шаге сохранения не оставляет
 * документ применённым, а прочий ящик — нет.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHarness, type Harness } from "./db-harness";
// ... vi.mock("../../server/db") как в соседних it-тестах

it("сохраняет документ вместе с настройками", async () => {
  await service.save(testId, { test: { title: "Тест" }, reportBlocks: [
    { block: "header", templateKey: null, enabled: true, sortOrder: 0, valuesJson: {}, settingsJson: {} },
  ] } as never);
  expect((await storage.listReportBlocks(testId, "standard")).map((r) => r.block)).toEqual(["header"]);
});

it("откат ящика откатывает и документ", async () => {
  // Ронять сохранение на шаге ПОСЛЕ записи документа и убеждаться, что строк нет.
});
```

- [x] **Шаг 2: Прогнать — падает**

```bash
npm run test:it -- tests/it/report-document-save.it.test.ts
```

Ожидание: FAIL — `reportBlocks` в полезной нагрузке не принимается.

- [x] **Шаг 3: Принять документ в теле запроса**

Схема строки в `shared/schema.ts`: `block` (строка из реестра), `templateKey` (строка либо null),
`enabled`, `values`, `settings`. `sortOrder` НЕ принимается от клиента — он выводится из позиции
в массиве: два источника истины о порядке разошлись бы, и спорить с ними было бы нечем.

- [x] **Шаг 4: Заменить строки внутри существующей транзакции**

В `TestSettingsService.save`, рядом с заменой разделов и системных страниц:

```ts
// PRD-51: документ отчёта заменяется ЦЕЛИКОМ и в ТОЙ ЖЕ транзакции, что остальной ящик.
// Порядок и состав осмысленны только вместе, а документ, применившийся без прочих
// настроек, — это отчёт, которого автор не собирал.
if (payload.reportBlocks) {
  await tx.replaceReportBlocks(testId, mode, payload.reportBlocks.map((b, i) => ({ ...b, sortOrder: i })));
}
```

- [x] **Шаг 5: Очистить разметку областей при сохранении**

Вторая половина FR-14. Значения областей проходят `sanitizeHtmlWithDiagnostics` с областью
`placeholderScope(ключ)` — тем же вызовом, каким чистятся значения контентных страниц
(`server/services/content-page-fields.ts`). Диагностика удалённого возвращается автору так же,
как у страниц: молча выбросить вставленный скрипт нельзя, автор должен знать.

- [x] **Шаг 6: Прогнать интеграционные и юнит-тесты маршрута**

```bash
npm run test:it -- tests/it/report-document-save.it.test.ts
npm test -- tests/test-settings
```

Ожидание: оба зелёные.

- [x] **Шаг 7: Коммит**

```bash
git add shared/schema.ts server/routes/tests.ts server/services/test-settings.ts server/services/content-page-fields.ts tests/it/report-document-save.it.test.ts
git commit -m "feat(prd-51): документ отчёта сохраняется одной транзакцией с настройками"
```

---

## Task 4: Список блоков в карточке отчёта

Кодить УЗЕЛ ЗА УЗЛОМ из открытого эскиза `prd51-report-document.html`, состояние `s-default`.

**Files:**

- Create: `client/src/features/tests/editor/sections/report-document-list.tsx`
- Test: `client/src/features/tests/editor/sections/__tests__/report-document-list.test.tsx`
- Modify: `client/src/features/tests/editor/sections/report-settings-card.tsx`

- [x] **Шаг 1: Открыть эскиз и выписать структуру строки**

```bash
python -m http.server 8123
```

Открыть `http://localhost:8123/docs/wireframes/prd51-report-document.html`, пройти все четыре
состояния, выписать классы: `zone-block`, `zone-header`, `page-row`, `drag-handle`,
`page-variant-badge`, `page-title`, `page-actions`, `insert-row`, `insert-btn`,
`page-expand-toggle`, `page-row-expand`. Своих классов не заводить.

- [x] **Шаг 2: Написать падающий тест списка**

```tsx
it("системный блок гасится тумблером и остаётся в списке", async () => {
  render(<ReportDocumentList blocks={blocks} onChange={onChange} />);
  await userEvent.click(screen.getAllByLabelText("Показывать блок")[0]);
  expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ block: "header", enabled: false })]));
  expect(screen.getByText("Шапка документа")).toBeInTheDocument();
});

it("у системного блока нет удаления, у страницы есть", async () => { /* … */ });
it("опубликованный тест не редактируется", () => { /* … */ });
```

- [x] **Шаг 3: Прогнать — падает**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__/report-document-list.test.tsx
```

- [x] **Шаг 4: Реализовать список по эскизу**

Строка несёт: ручку, бейдж варианта, название блока (`reportBlockLabel` для системных, заголовок
страницы для авторских), тег природы, действия. У системного блока — тумблер показа и меню без
«Удалить»; у страницы и разрыва — «Удалить» есть. Перетаскивание — `@dnd-kit/core`, как в
«Структуре», с клавиатурной альтернативой (`sortableKeyboardCoordinates`).

- [x] **Шаг 5: Прогнать — зелено**

- [x] **Шаг 6: Коммит**

```bash
git commit -m "feat(prd-51): список блоков документа в карточке отчёта"
```

---

## Task 5: Палитра добавления и раскрытие строки

**Files:**

- Create: `client/src/features/tests/editor/sections/report-block-palette.tsx`
- Modify: `client/src/features/tests/editor/sections/report-document-list.tsx`

- [x] **Шаг 1: Написать падающий тест палитры**

Три группы по эскизу (`s-add-palette`): страницы (варианты вида `page` активного шаблона),
служебное (разрыв листа), удалённые из документа (системные блоки, которых сейчас нет в списке).
Группа без единого элемента НЕ рисуется.

- [x] **Шаг 2: Прогнать — падает**

- [x] **Шаг 3: Реализовать палитру и раскрытие**

Раскрытая строка страницы показывает поля её варианта контролом из задачи 1. Состав полей берётся
из `placeholders[]` варианта, значения — из черновика строки.

- [x] **Шаг 4: Прогнать — зелено**

- [x] **Шаг 5: Коммит**

```bash
git commit -m "feat(prd-51): палитра добавления блока и правка полей страницы"
```

---

## Task 6: Предпросмотр показывает черновик документа

**Files:**

- Modify: `client/src/features/tests/editor/sections/report-preview-modal.tsx:83-110`

- [x] **Шаг 1: Написать падающий тест**

Окно, которому передан черновик из двух блоков, обязано показать ИХ, а не документ по умолчанию
шаблона.

- [x] **Шаг 2: Прогнать — падает**

- [x] **Шаг 3: Передать строки черновика в разрешение**

Сегодня окно зовёт `resolveReportDocument(bundle.manifest, kind)` без строк — оно и показывает
умолчание (см. `docs/reports/prd51-e1-e2-acceptance.md`). Достаточно передать третьим аргументом
строки черновика, приведённые к форме `ReportBlockRowInput`.

- [x] **Шаг 4: Прогнать — зелено**

- [x] **Шаг 5: Коммит**

```bash
git commit -m "feat(prd-51): предпросмотр показывает собранный автором документ"
```

---

## Task 7: Приёмка в браузере

Юниты не видят ни перетаскивания, ни того, что автор получит на бумаге.

- [x] **Шаг 1: Поднять второй экземпляр dev-сервера**

```bash
PORT=8099 npm run dev
```

- [x] **Шаг 2: Собрать документ живым тестом**

Войти как `acceptance@local.test`, открыть тест, переставить блоки, выключить сводку, добавить
страницу с текстом и разрыв листа, сохранить, перезагрузить — документ обязан вернуться тем же.

- [x] **Шаг 3: Сверить с эскизом поэлементно**

Снимок реализации рядом со снимком `prd51-report-document.html`. Сверять КАЖДЫЙ элемент:
композицию строки, положение тумблера, состав меню, вид кнопки-вставки. Любое расхождение — не
done.

- [x] **Шаг 4: Скачать отчёт и убедиться, что документ тот самый**

Пройти тест, скачать PDF, сверить порядок разделов с собранным документом.

- [x] **Шаг 5: Закрыть хвосты приёмки Э1-Э2**

Четыре пункта из `docs/reports/prd51-e1-e2-acceptance.md` §«Что НЕ проверено» закрываются здесь
же: живое прохождение, пакет в плеере (`npm run scorm:player`, `:5050`), адаптивный отчёт на
растре, предпросмотр на живом тесте.

- [x] **Шаг 6: Записать отчёт приёмки**

`docs/reports/prd51-e3-acceptance.md` — что проверено, чем, с числами. Отчёт без чисел приёмкой
не считается.

- [x] **Шаг 7: Коммит**

```bash
git add docs/reports/prd51-e3-acceptance.md
git commit -m "docs(prd-51): приёмка этапа Э3"
```

---

## Дальнейшие планы

| План | Охват | Предусловие |
| --- | --- | --- |
| `2026-XX-XX-certification-report.md` | Э4, FR-22 - FR-23: оболочка и блоки «Сертификации», светлый `report.css`, вывод раскладок отчёта из паритета | Э3 принят; эскиз `prd51-certification-report.html` утверждён |
| `2026-XX-XX-template-contract-2-0.md` | Э5, FR-24: спецификация формата 2.0.0, руководство 2.0.0, `npm run docs:pdf` | Э4 принят |

Открытым остаётся [issue #39](https://github.com/vvlad1973/Fullstack-MVP-testing/issues/39):
перенос теста между инсталляциями документ отчёта не переносит. Это чужой трек (PRD-48), и в
границы этого плана он не входит.
