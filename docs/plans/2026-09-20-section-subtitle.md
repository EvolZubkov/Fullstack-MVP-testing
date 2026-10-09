# Подзаголовок раздела: план реализации

> **Для исполнителя:** план выполняется задача за задачей. Шаги помечены чекбоксами
> (`- [ ]`). Каждая задача заканчивается коммитом и оставляет работающий продукт.

**Цель:** заголовок «Инструкция» на экране «Введение раздела» перестаёт быть жёсткой строкой
макета и становится настройкой варианта — автор переформулирует его или выключает у каждого
раздела отдельно.

**Архитектура:** механизм — обычные настройки страницы (PRD-22 `settings[]`), тот же, которым
живёт подпись кнопки `nextLabel`. Вариант `intro.standard` объявляет тумблер
`sectionSubtitleShown` и поле `sectionSubtitle`; значения лежат в `content_pages.settings_json`;
ядро разрешает их одной функцией и отдаёт макету как `page.sectionSubtitle`. Реестр надписей
PRD-49 не расширяется, новых экранов редактора не появляется.

**Спецификация:** [PRD-22 раздел 11](../specs/prd-22/page-fields-and-sequences.md), FR-38 – FR-46.

**Технологии:** TypeScript, vitest, React 19, DSL шаблонов (`shared/template`), рантайм пакета
на plain JS (`server/scorm/template/app`).

---

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `shared/template/page-sequences.ts` | Ключи настроек, читатель `sectionSubtitleOf`, поле `PageContext.sectionSubtitle` |
| `tests/page-sequences.test.ts` | Юниты читателя и сборки контекста |
| `server/scorm/template/app/render/contentPage.js` | Экран введения в пакете получает блок `page.*` |
| `client/src/features/tests/editor/sections/page-preview-modal.tsx` | Предпросмотр страницы получает тот же блок |
| `shared/template/preview-context.ts` | Предпросмотр ШАБЛОНА (демо-набор) получает тот же блок |
| `shared/template/__tests__/preview-context.test.ts` | Юнит предпросмотра шаблона |
| `client/src/features/tests/editor/sections/start-pages-section.tsx` | Тумблер по умолчанию манифеста; скрытие поля при выключенном тумблере |
| `client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx` | Юниты формы страницы |
| `tests/section-intro-subtitle.test.ts` | Паритет: макеты трёх шаблонов печатают подзаголовок одинаково |
| Манифесты и макеты трёх шаблонов | Объявление настроек и печать по условию |
| `docs/specs/spec-template-platform.md`, `docs/guides/template-development.md` | Контракт 3.9.0 |

Внешние шаблоны лежат в собственных репозиториях (`C:\Repositories\skill'um\templates`),
встроенный — в дереве продукта. Пути знает `tests/helpers/template-roots.ts`.

---

## Задача 1: ядро — читатель и поле контекста

**Файлы:**

- Изменить: `shared/template/page-sequences.ts`
- Тест: `tests/page-sequences.test.ts`

- [ ] **Шаг 1: написать падающие тесты**

Дописать в `tests/page-sequences.test.ts` новый блок. Файл уже импортирует `buildPageContext` и
`buildPageContextFor` из `@shared/template/page-sequences` — к тому же списку добавить
`sectionSubtitleOf` и `DEFAULT_SECTION_SUBTITLE` (импорт идёт через алиас, не относительным
путём):

```ts
describe("sectionSubtitleOf — подзаголовок раздела (PRD-22 FR-38 – FR-41)", () => {
  it("без настроек печатает умолчание шаблона", () => {
    expect(sectionSubtitleOf({ id: "p1" } as never)).toBe("Инструкция");
    expect(sectionSubtitleOf(null)).toBe("Инструкция");
  });

  it("берёт авторскую формулировку", () => {
    expect(
      sectionSubtitleOf({ id: "p1", settingsJson: { sectionSubtitle: "Как отвечать" } } as never),
    ).toBe("Как отвечать");
  });

  it("обрезает пробелы по краям", () => {
    expect(
      sectionSubtitleOf({ id: "p1", settingsJson: { sectionSubtitle: "  Как отвечать  " } } as never),
    ).toBe("Как отвечать");
  });

  it("пустое поле при включённом тумблере возвращает к тексту шаблона, а не гасит надпись", () => {
    expect(sectionSubtitleOf({ id: "p1", settingsJson: { sectionSubtitle: "" } } as never)).toBe(
      "Инструкция",
    );
    expect(sectionSubtitleOf({ id: "p1", settingsJson: { sectionSubtitle: "   " } } as never)).toBe(
      "Инструкция",
    );
  });

  it("выключенный тумблер гасит надпись, даже когда формулировка задана", () => {
    expect(
      sectionSubtitleOf({
        id: "p1",
        settingsJson: { sectionSubtitleShown: false, sectionSubtitle: "Как отвечать" },
      } as never),
    ).toBe("");
  });

  it("читает настройки в той форме, в какой их везёт пакет", () => {
    expect(sectionSubtitleOf({ id: "p1", settings: { sectionSubtitle: "Памятка" } } as never)).toBe(
      "Памятка",
    );
  });
});

describe("buildPageContext — подзаголовок в блоке page.*", () => {
  it("без явного значения отдаёт умолчание, а не пустую строку", () => {
    expect(buildPageContext(null).sectionSubtitle).toBe(DEFAULT_SECTION_SUBTITLE);
  });

  it("пустую строку НЕ подменяет умолчанием: это выключенная надпись", () => {
    expect(buildPageContext(null, { sectionSubtitle: "" }).sectionSubtitle).toBe("");
  });

  it("buildPageContextFor разрешает подзаголовок по настройкам страницы", () => {
    const pages = [
      { id: "p1", settingsJson: { sectionSubtitleShown: false } },
      { id: "p2", settingsJson: { sectionSubtitle: "Памятка" } },
    ] as never[];
    expect(buildPageContextFor("p1", pages).sectionSubtitle).toBe("");
    expect(buildPageContextFor("p2", pages).sectionSubtitle).toBe("Памятка");
  });
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запустить: `npm test -- tests/page-sequences.test.ts`
Ожидается: FAIL — `sectionSubtitleOf is not a function` / отсутствует экспорт
`DEFAULT_SECTION_SUBTITLE`.

- [ ] **Шаг 3: добавить ключи, умолчание и читатель**

В `shared/template/page-sequences.ts` после блока `DEFAULT_NEXT_LABEL` (строка 90) добавить:

```ts
/** Ключ настройки-тумблера подзаголовка раздела (PRD-22 FR-38). */
export const SECTION_SUBTITLE_SHOWN_SETTING_KEY = "sectionSubtitleShown";

/** Ключ настройки с формулировкой подзаголовка раздела (PRD-22 FR-38). */
export const SECTION_SUBTITLE_SETTING_KEY = "sectionSubtitle";

/** Текст, который печатается, пока автор ничего не задал, — умолчание манифеста. */
export const DEFAULT_SECTION_SUBTITLE = "Инструкция";
```

После `nextLabelOf` (строка 116) добавить читатель:

```ts
/**
 * Подзаголовок раздела — строка над авторской инструкцией на экране «Введение раздела»
 * (PRD-22 FR-41).
 *
 * Гасит надпись ТОЛЬКО тумблер. Пустое поле при включённом тумблере означает «следовать
 * шаблону» и возвращает умолчание: контрол настройки показывает умолчание серой подсказкой,
 * поэтому «не трогал» и «очистил» выглядят в форме одинаково и пустота не может означать
 * выключение (FR-40).
 */
export function sectionSubtitleOf(page: SequenceContentPage | null | undefined): string {
  const bag = settingsOf(page);
  if (bag && bag[SECTION_SUBTITLE_SHOWN_SETTING_KEY] === false) return "";
  const raw = bag ? bag[SECTION_SUBTITLE_SETTING_KEY] : undefined;
  return (typeof raw === "string" ? raw.trim() : "") || DEFAULT_SECTION_SUBTITLE;
}
```

- [ ] **Шаг 4: добавить поле в контекст**

В интерфейс `PageContext` (после `nextDisabled`, строка 80) добавить:

```ts
  /**
   * Подзаголовок раздела на экране «Введение раздела» (PRD-22 FR-42). Пустая строка —
   * автор выключил надпись; макет печатает её по непустоте.
   */
  sectionSubtitle: string;
```

В `buildPageContext` (строка 220) расширить опции и оба возврата:

```ts
export function buildPageContext(
  placement: SequencePlacement | null | undefined,
  options?: {
    canGoBack?: boolean;
    nextLabel?: string;
    nextDisabled?: boolean;
    sectionSubtitle?: string;
  },
): PageContext {
  const canGoBack = options?.canGoBack === true;
  const nextLabel = options?.nextLabel?.trim() || DEFAULT_NEXT_LABEL;
  const nextDisabled = options?.nextDisabled === true;
  // `??`, а НЕ `||`: пустая строка здесь — выключенная автором надпись, и подмена её
  // умолчанием вернула бы на экран ровно то, что автор убрал. Отсутствие значения —
  // другое дело: вызывающий не знает про подзаголовок, и безопасный исход — текст шаблона.
  const sectionSubtitle = options?.sectionSubtitle ?? DEFAULT_SECTION_SUBTITLE;
  if (!placement)
    return {
      dots: [], dotIndex: 0, dotsTotal: 0, pageLabel: "", progressPercent: 0,
      canGoBack, nextLabel, nextDisabled, sectionSubtitle,
    };

  const dots: SequenceDot[] = [];
  for (let i = 1; i <= placement.total; i++) {
    dots.push({ statusClass: i === placement.index ? "is-current" : "" });
  }
  const pageLabel = placement.total > 0 ? "Страница " + placement.index + " из " + placement.total : "";
  const progressPercent = placement.total > 0 ? Math.round((placement.index / placement.total) * 100) : 0;
  return {
    dots, dotIndex: placement.index, dotsTotal: placement.total, pageLabel, progressPercent,
    canGoBack, nextLabel, nextDisabled, sectionSubtitle,
  };
}
```

В `buildPageContextFor` (строка 245) разрешить значение по странице:

```ts
export function buildPageContextFor(
  pageId: string,
  pages: SequenceContentPage[] | null | undefined,
  options?: { canGoBack?: boolean; nextLabel?: string; nextDisabled?: boolean },
): PageContext {
  const page = (pages ?? []).find((p) => p.id === pageId);
  return buildPageContext(buildSequencePlacements(pages).get(pageId), {
    ...options,
    nextLabel: options?.nextLabel ?? nextLabelOf(page),
    sectionSubtitle: sectionSubtitleOf(page),
  });
}
```

- [ ] **Шаг 5: убедиться, что тесты проходят**

Запустить: `npm test -- tests/page-sequences.test.ts`
Ожидается: PASS, включая существующие тесты файла.

- [ ] **Шаг 6: проверить типы**

Запустить: `npm run check`
Ожидается: 0 ошибок. Если `PageContext` собирается где-то ещё вручную, компилятор укажет
место — дописать `sectionSubtitle` там же значением `DEFAULT_SECTION_SUBTITLE`.

- [ ] **Шаг 7: коммит**

```bash
git add shared/template/page-sequences.ts tests/page-sequences.test.ts
git commit -m "feat(prd-22): подзаголовок раздела разрешается ядром"
```

---

## Задача 2: экран введения в пакете получает блок `page.*`

**Файлы:**

- Изменить: `server/scorm/template/app/render/contentPage.js:232-236`

Экран введения рендерится своим путём (`renderSectionIntro`) и собирает контекст из трёх веток,
без `page`. Общий путь контентной страницы кладёт его строкой ниже (`page: pageCtx`), поэтому
здесь достаточно того же вызова.

- [ ] **Шаг 1: добавить блок в контекст**

В `renderSectionIntro` заменить сборку контекста:

```js
  var context = {
    course: built.course,
    design: (typeof scormDesignContext === "function") ? scormDesignContext() : {},
    sectionIntro: built.sectionIntro,
  };
```

на:

```js
  var context = {
    course: built.course,
    design: (typeof scormDesignContext === "function") ? scormDesignContext() : {},
    sectionIntro: built.sectionIntro,
    // PRD-22 FR-42: экран введения — такая же контентная страница, и её настройки
    // (подзаголовок раздела) приезжают тем же блоком `page.*`, каким общий путь рендера
    // отдаёт подпись кнопки и точки последовательности. Собирается тем же вызовом, чтобы
    // два пути не разошлись.
    page: buildPageRenderContext(page),
  };
```

- [ ] **Шаг 2: проверить, что пакет собирается**

Запустить: `npm run scorm:template`
Ожидается: сборка без ошибок, пакет в `out/`.

- [ ] **Шаг 3: коммит**

```bash
git add server/scorm/template/app/render/contentPage.js
git commit -m "feat(prd-22): экран введения в пакете получает блок page.*"
```

---

## Задача 3: предпросмотр страницы в редакторе

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/page-preview-modal.tsx:218-233`

- [ ] **Шаг 1: добавить блок в контекст ветки `intro`**

Дописать импорты в начало файла:

```tsx
import { buildPageContext, sectionSubtitleOf } from "@shared/template/page-sequences";
```

В ветке `page.kind === "intro"` заменить возвращаемый объект:

```tsx
      return {
        id: page.id,
        route: "content.intro",
        layoutKey: "section-intro",
        expectedSlots: [],
        input: {
          context: { course: built.course, sectionIntro: built.sectionIntro },
          slots: { instruction: instr },
        },
      };
```

на:

```tsx
      return {
        id: page.id,
        route: "content.intro",
        layoutKey: "section-intro",
        expectedSlots: [],
        input: {
          context: {
            course: built.course,
            sectionIntro: built.sectionIntro,
            // PRD-22 FR-42: подзаголовок раздела — настройка страницы, и предпросмотр обязан
            // показывать её так же, как оба хоста прохождения; иначе автор правит вслепую.
            page: buildPageContext(sequencePlacement, {
              sectionSubtitle: sectionSubtitleOf({ settingsJson: page.settingsJson ?? null } as never),
            }),
          },
          slots: { instruction: instr },
        },
      };
```

- [ ] **Шаг 2: проверить типы**

Запустить: `npm run check`
Ожидается: 0 ошибок.

- [ ] **Шаг 3: прогнать существующие тесты окна предпросмотра**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/page-preview-modal.coverage.test.tsx`
Ожидается: PASS.

- [ ] **Шаг 4: коммит**

```bash
git add client/src/features/tests/editor/sections/page-preview-modal.tsx
git commit -m "feat(prd-22): предпросмотр страницы показывает подзаголовок раздела"
```

---

## Задача 4: предпросмотр шаблона (демо-набор)

Предпросмотр ШАБЛОНА (`preview.html`, окно проверки в разделе «Шаблоны») строит экран введения
своим кодом в `shared/template/preview-context.ts`. Без правки карточка инструкции в нём
осталась бы без подзаголовка — предпросмотр разошёлся бы с продом.

**Файлы:**

- Изменить: `shared/template/preview-context.ts:505-528` и вызов на строке 646
- Тест: `shared/template/__tests__/preview-context.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Дописать в `shared/template/__tests__/preview-context.test.ts`:

```ts
describe("экран введения в предпросмотре шаблона (PRD-22 FR-42)", () => {
  it("несёт подзаголовок раздела, иначе предпросмотр печатает карточку без надписи", () => {
    const screens = buildScreenInputs(demoDataset(), manifest());
    const intro = screens.find((s) => s.layoutKey === "section-intro");
    expect(intro).toBeDefined();
    expect((intro!.input.context as { page?: { sectionSubtitle?: string } }).page?.sectionSubtitle)
      .toBe("Инструкция");
  });
});
```

Если в файле ещё нет помощника `manifest()`, добавить рядом с `demoDataset()`:

```ts
/** Манифест поставляемого шаблона — тот же файл, что читает предпросмотр. */
function manifest() {
  return JSON.parse(
    readFileSync("server/scorm/templates/default/manifest.json", "utf8"),
  ) as Parameters<typeof buildScreenInputs>[1];
}
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- shared/template/__tests__/preview-context.test.ts`
Ожидается: FAIL — `expected undefined to be "Инструкция"`.

- [ ] **Шаг 3: передать настройки в построитель экрана**

В `preview-context.ts` добавить импорт читателя к существующему импорту из `./page-sequences`:

```ts
import { buildPageContext, nextLabelOf, sectionSubtitleOf } from "./page-sequences";
```

(если `buildPageContext`/`nextLabelOf` уже импортированы — дописать только `sectionSubtitleOf`).

Расширить сигнатуру `buildSectionIntroParts` и её возврат:

```ts
function buildSectionIntroParts(
  values: Record<string, unknown>,
  facts: SectionIntroFacts,
  settings?: Record<string, unknown> | null,
): ScreenParts {
```

и в возвращаемом объекте:

```ts
  return {
    expectedSlots: built.sectionIntro.hasInstruction ? ["instruction"] : [],
    input: {
      context: {
        course: built.course,
        sectionIntro: built.sectionIntro,
        // PRD-22 FR-42: тот же блок, что у рантайма. Демо-набор настроек обычно не несёт —
        // тогда печатается умолчание шаблона, как на нетронутой автором странице.
        page: buildPageContext(null, {
          sectionSubtitle: sectionSubtitleOf({ settingsJson: settings ?? null } as never),
        }),
      },
      slots: { instruction },
    },
  };
```

В вызове на строке 646 передать настройки демо-страницы:

```ts
        ...buildSectionIntroParts(
          page?.values ?? {},
          {
            sectionNumber: 1,
            topicName: topic?.title ?? "Раздел",
            questionCount: c.questionCount ?? c.questions?.length ?? 0,
            description: c.description,
            timeLimitMinutes: c.timeLimitMinutes,
          },
          (page as { settings?: Record<string, unknown> } | undefined)?.settings ?? null,
        ),
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Запустить: `npm test -- shared/template/__tests__/preview-context.test.ts`
Ожидается: PASS.

- [ ] **Шаг 5: коммит**

```bash
git add shared/template/preview-context.ts shared/template/__tests__/preview-context.test.ts
git commit -m "feat(prd-22): предпросмотр шаблона показывает подзаголовок раздела"
```

---

## Задача 5: тумблер незаданной настройки показывает умолчание манифеста

Контрол `boolean` рисует `checked={Boolean(value)}` и умолчание манифеста игнорирует. У страниц,
созданных до объявления настройки, ключа нет — тумблер нарисовался бы выключенным при
печатающемся подзаголовке (FR-45).

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/start-pages-section.tsx:2095-2108`
- Тест: `client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx`

- [ ] **Шаг 1: написать падающий тест**

Дописать в `start-pages-section.test.tsx`:

```tsx
describe("SettingControl — тумблер и умолчание манифеста (PRD-22 FR-45)", () => {
  it("незаданное значение показывается по умолчанию манифеста", () => {
    render(
      <SettingControl
        setting={{ key: "sectionSubtitleShown", type: "boolean", label: "Показывать", default: true }}
        value={undefined}
        onChange={vi.fn()}
        sequenceIds={[]}
        sequenceTotal={0}
        testId="s-shown"
      />,
    );
    expect(screen.getByTestId("s-shown")).toBeChecked();
  });

  it("явное «выключено» умолчанием не перебивается", () => {
    render(
      <SettingControl
        setting={{ key: "sectionSubtitleShown", type: "boolean", label: "Показывать", default: true }}
        value={false}
        onChange={vi.fn()}
        sequenceIds={[]}
        sequenceTotal={0}
        testId="s-shown"
      />,
    );
    expect(screen.getByTestId("s-shown")).not.toBeChecked();
  });

  it("без объявленного умолчания тумблер выключен", () => {
    render(
      <SettingControl
        setting={{ key: "flag", type: "boolean", label: "Флаг" }}
        value={undefined}
        onChange={vi.fn()}
        sequenceIds={[]}
        sequenceTotal={0}
        testId="s-flag"
      />,
    );
    expect(screen.getByTestId("s-flag")).not.toBeChecked();
  });
});
```

Импорт `SettingControl` добавить к существующим импортам файла из `../start-pages-section`.

- [ ] **Шаг 2: убедиться, что первый тест падает**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx -t "умолчанию манифеста"`
Ожидается: FAIL — элемент не отмечен.

- [ ] **Шаг 3: починить контрол**

Заменить ветку `case "boolean"`:

```tsx
    case "boolean":
      return (
        <Switch
          label={label}
          description={st.description}
          // PRD-22 FR-45: незаданное значение — это «автор не открывал настройку», и показать
          // надо объявленное манифестом умолчание, а не выключенное состояние. Ветка `text`
          // уже показывает своё умолчание подсказкой; здесь было расхождение: страница,
          // созданная до объявления настройки, показывала выключенный тумблер при
          // работающей настройке.
          checked={value === undefined || value === null ? st.default === true : Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={testId}
        />
      );
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx`
Ожидается: PASS (весь файл, включая существующие тесты).

- [ ] **Шаг 5: коммит**

```bash
git add client/src/features/tests/editor/sections/start-pages-section.tsx client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx
git commit -m "fix(prd-22): тумблер настройки показывает умолчание манифеста"
```

---

## Задача 6: поле формулировки скрывается при выключенном тумблере

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/start-pages-section.tsx:2035-2038`
- Тест: `client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx`

- [ ] **Шаг 1: написать падающий тест**

```tsx
describe("showsSetting — зависимые настройки (PRD-22 FR-44)", () => {
  const subtitle = { key: "sectionSubtitle", type: "text", label: "Подзаголовок раздела" };

  it("поле формулировки скрыто при выключенном тумблере", () => {
    expect(showsSetting({ sectionSubtitleShown: false })(subtitle)).toBe(false);
  });

  it("поле формулировки показано при включённом тумблере", () => {
    expect(showsSetting({ sectionSubtitleShown: true })(subtitle)).toBe(true);
  });

  it("поле формулировки показано, пока тумблер не задан", () => {
    expect(showsSetting({})(subtitle)).toBe(true);
  });
});
```

Импорт `showsSetting` добавить к существующим импортам файла.

- [ ] **Шаг 2: убедиться, что первый тест падает**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx -t "showsSetting"`
Ожидается: FAIL — получено `true`, ожидалось `false`.

- [ ] **Шаг 3: добавить правило**

Импортировать ключи в `start-pages-section.tsx`:

```tsx
import {
  SECTION_SUBTITLE_SETTING_KEY,
  SECTION_SUBTITLE_SHOWN_SETTING_KEY,
} from "@shared/template/page-sequences";
```

Заменить предикат:

```tsx
export function showsSetting(settings: Record<string, unknown>) {
  return (st: ContentTemplateSetting): boolean => {
    // Вид оформления розы имеет смысл только у диаграмм, которые его читают.
    if (st.key === SCALE_APPEARANCE_KEY) {
      return CHART_KINDS_WITH_LOOK.has(String(settings.scalesChartKind));
    }
    // PRD-22 FR-44: живое поле формулировки под выключенным тумблером напрашивается на
    // «я вписал, почему не видно» — поэтому оно прячется вместе с надписью.
    if (st.key === SECTION_SUBTITLE_SETTING_KEY) {
      return settings[SECTION_SUBTITLE_SHOWN_SETTING_KEY] !== false;
    }
    return true;
  };
}
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx`
Ожидается: PASS.

- [ ] **Шаг 5: коммит**

```bash
git add client/src/features/tests/editor/sections/start-pages-section.tsx client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx
git commit -m "feat(prd-22): поле подзаголовка скрыто при выключенном тумблере"
```

---

## Задача 7: макеты и манифесты трёх шаблонов

Правка одинаковая в трёх шаблонах: встроенный `default` лежит в дереве продукта, `certification`
и `standard-rt` — в своих репозиториях. Паритет между ними не проверяется гардом автоматически,
поэтому тест этой задачи и держит их вместе.

**Файлы:**

- Изменить: `server/scorm/templates/default/layouts/section-intro.html:31-36`
- Изменить: `server/scorm/templates/default/manifest.json` (вариант `intro.standard`, `version`)
- Изменить: `<templates>/skillum-template-certification/template/layouts/section-intro.html`
- Изменить: `<templates>/skillum-template-certification/template/manifest.json`
- Изменить: `<templates>/skillum-template-standard-rt/template/layouts/section-intro.html`
- Изменить: `<templates>/skillum-template-standard-rt/template/manifest.json`
- Создать: `tests/section-intro-subtitle.test.ts`

`<templates>` — `C:\Repositories\skill'um\templates` либо каталог из `SKILLUM_TEMPLATES_DIR`.

- [ ] **Шаг 1: написать падающий тест паритета**

Создать `tests/section-intro-subtitle.test.ts`:

```ts
/**
 * @module tests/section-intro-subtitle
 * @description PRD-22 FR-38 – FR-46: подзаголовок раздела на экране «Введение раздела».
 *
 * Держит три шаблона вместе: макет печатает надпись из `page.sectionSubtitle`, выключенную
 * надпись не печатает, а карточку с авторским текстом при этом сохраняет. Жёсткая строка
 * «Инструкция» в разметке недопустима — она и была тем, что автор не мог изменить.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildSectionIntroContext } from "../shared/template/result-context";
import { buildPageContext } from "../shared/template/page-sequences";
import { TEMPLATE_IDS, templateFile, templateManifest } from "./helpers/template-roots";

/** Рендерит экран введения с заданным подзаголовком и возвращает корень разметки. */
function renderIntro(id: (typeof TEMPLATE_IDS)[number], sectionSubtitle: string): HTMLElement {
  const layout = readFileSync(templateFile(id, "layouts/section-intro.html"), "utf8");
  const built = buildSectionIntroContext({
    sectionNumber: 1,
    sectionsTotal: 8,
    topicName: "О компании",
    questionCount: 16,
    instruction: "<p>Авторский текст инструкции</p>",
  });
  const root = document.createElement("div");
  renderScreenInto(root, {
    layout,
    context: { ...built, design: {}, page: buildPageContext(null, { sectionSubtitle }) },
    slots: { instruction: "<p>Авторский текст инструкции</p>" },
  });
  return root;
}

describe.each(TEMPLATE_IDS)("%s — подзаголовок раздела", (id) => {
  it("печатает авторскую формулировку", () => {
    expect(renderIntro(id, "Как отвечать").textContent).toContain("Как отвечать");
  });

  it("при выключенной надписи не печатает её, но сохраняет текст инструкции", () => {
    const root = renderIntro(id, "");
    expect(root.textContent).not.toContain("Инструкция");
    expect(root.textContent).toContain("Авторский текст инструкции");
  });

  it("не содержит жёсткой строки «Инструкция» в разметке макета", () => {
    const layout = readFileSync(templateFile(id, "layouts/section-intro.html"), "utf8");
    expect(layout).not.toContain(">Инструкция<");
  });

  it("объявляет обе настройки подзаголовка у варианта введения", () => {
    const manifest = JSON.parse(readFileSync(templateManifest(id), "utf8")) as {
      contentTemplates?: Array<{ kind?: string; settings?: Array<{ key: string; default?: unknown }> }>;
    };
    const intro = (manifest.contentTemplates ?? []).find((v) => v.kind === "intro");
    const settings = intro?.settings ?? [];
    expect(settings.find((s) => s.key === "sectionSubtitleShown")?.default).toBe(true);
    expect(settings.find((s) => s.key === "sectionSubtitle")?.default).toBe("Инструкция");
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- tests/section-intro-subtitle.test.ts`
Ожидается: FAIL по всем трём шаблонам — макет печатает жёсткое «Инструкция», настроек в
манифесте нет.

- [ ] **Шаг 3: править макет (во всех ТРЁХ шаблонах одинаково)**

В `layouts/section-intro.html` заменить блок:

```html
      {{#if sectionIntro.hasInstruction}}
      <div class="tb-card">
        <span class="tb-card__head">Инструкция</span>
        <span class="tb-card__body" data-slot="instruction"></span>
      </div>
      {{/if}}
```

на:

```html
      {{#if sectionIntro.hasInstruction}}
      <div class="tb-card">
        {{#if page.sectionSubtitle}}<span class="tb-card__head">{{ page.sectionSubtitle }}</span>{{/if}}
        <span class="tb-card__body" data-slot="instruction"></span>
      </div>
      {{/if}}
```

- [ ] **Шаг 4: править манифест (во всех ТРЁХ шаблонах одинаково)**

В варианте `intro.standard` после массива `placeholders` добавить:

```json
      "settings": [
        {
          "key": "sectionSubtitleShown",
          "type": "boolean",
          "default": true,
          "label": "Показывать подзаголовок раздела"
        },
        {
          "key": "sectionSubtitle",
          "type": "text",
          "default": "Инструкция",
          "label": "Подзаголовок раздела",
          "required": false,
          "maxLength": 120
        }
      ]
```

Поднять `version` в каждом манифесте: `default` 1.12.0 → 1.13.0, `certification` 1.18.0 →
1.19.0, `standard-rt` 1.6.0 → 1.7.0. Правка макета обязана бампить манифест: без этого
загруженная копия в базе не обновится.

- [ ] **Шаг 5: убедиться, что тест проходит**

Запустить: `npm test -- tests/section-intro-subtitle.test.ts`
Ожидается: PASS по всем трём шаблонам.

- [ ] **Шаг 6: прогнать соседние проверки шаблонов**

Запустить: `npm test -- tests/template-layout-parity.test.ts tests/template-dsl-layouts.test.ts`
Ожидается: PASS. Эти тесты сверяют раскладки между шаблонами и разбирают DSL каждого макета —
опечатка в условии всплывёт здесь.

- [ ] **Шаг 7: коммит (репозиторий продукта)**

```bash
git add server/scorm/templates/default/layouts/section-intro.html server/scorm/templates/default/manifest.json tests/section-intro-subtitle.test.ts
git commit -m "feat(prd-22): подзаголовок раздела в шаблоне default"
```

- [ ] **Шаг 8: коммиты в репозиториях вынесенных шаблонов**

В каждом из двух репозиториев отдельно:

```bash
git -C "<templates>/skillum-template-certification" add template/layouts/section-intro.html template/manifest.json
git -C "<templates>/skillum-template-certification" commit -m "feat: подзаголовок раздела настраивается автором"
git -C "<templates>/skillum-template-standard-rt" add template/layouts/section-intro.html template/manifest.json
git -C "<templates>/skillum-template-standard-rt" commit -m "feat: подзаголовок раздела настраивается автором"
```

---

## Задача 8: перегенерация предпросмотров шаблонов

`preview.html` каждого шаблона СОБИРАЕТСЯ из рантайма и макетов, вручную не правится.

- [ ] **Шаг 1: перегенерировать**

Запустить: `npm run scorm:previews`
Ожидается: скрипт отчитывается о трёх шаблонах; файлы `preview.html` обновлены — встроенный в
дереве продукта, вынесенные в своих репозиториях.

- [ ] **Шаг 2: проверить глазами**

Открыть `server/scorm/templates/default/preview.html` в браузере, экран «Введение раздела»:
карточка инструкции печатается с надписью «Инструкция».

- [ ] **Шаг 3: коммит**

```bash
git add server/scorm/templates/default/preview.html
git commit -m "chore(prd-22): перегенерированы предпросмотры шаблонов"
```

Предпросмотры вынесенных шаблонов коммитятся в их собственных репозиториях тем же сообщением.

---

## Задача 9: документы

**Файлы:**

- Изменить: `docs/specs/spec-template-platform.md` (версия контракта, `page.*`)
- Изменить: `docs/guides/template-development.md` (версия в трёх местах, описание настроек)
- Изменить: руководство автора теста — раздел про страницу «Введение раздела»
- Пересобрать: PDF руководства

- [ ] **Шаг 1: контракт платформы**

В `docs/specs/spec-template-platform.md` поднять версию документа 3.8.0 → 3.9.0, добавить
строку в таблицу версий и описать поле рядом с `page.nextLabel`:

> `page.sectionSubtitle` — подзаголовок раздела на экране «Введение раздела» (настройки
> `sectionSubtitleShown` и `sectionSubtitle` варианта вида `intro`, умолчание «Инструкция»).
> Пустая строка означает, что автор выключил надпись: макет печатает её по непустоте
> (`{{#if page.sectionSubtitle}}`), а не безусловно.

- [ ] **Шаг 2: руководство разработчика шаблонов**

В `docs/guides/template-development.md` поднять номер версии в ТРЁХ местах (строки 16, 28, 38 —
«соответствует спецификации формата»), в разделе о настройках страницы дописать обе настройки
рядом с `nextLabel`, показав объявление и печать по условию.

- [ ] **Шаг 3: руководство автора теста**

Дописать в раздел о структуре и странице «Введение раздела»: подзаголовок правится в раскрытой
строке раздела; пустое поле означает «как в шаблоне»; убирает надпись тумблер; настройка своя у
каждого раздела.

- [ ] **Шаг 4: пересобрать PDF**

Запустить: `npm run docs:pdf`
Ожидается: PDF руководства пересобран без ошибок.

- [ ] **Шаг 5: проверить разметку документов**

Запустить: `npx markdownlint-cli2 "docs/specs/spec-template-platform.md" "docs/guides/template-development.md" "docs/specs/prd-22/page-fields-and-sequences.md"`
Ожидается: `Summary: 0 issues`.

- [ ] **Шаг 6: коммит**

```bash
git add docs/
git commit -m "docs(prd-22): контракт 3.9.0 — подзаголовок раздела"
```

---

## Задача 10: приёмка

- [ ] **Шаг 1: типы и целевые тесты**

```bash
npm run check
npm test -- tests/page-sequences.test.ts tests/section-intro-subtitle.test.ts shared/template/__tests__/preview-context.test.ts client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx
```

Ожидается: 0 ошибок типов, все тесты PASS.

- [ ] **Шаг 2: приёмка в редакторе**

Поднять `npm run dev`, открыть тест с разделами, вкладка «Состав», раскрыть строку «Введение
раздела». Проверить: тумблер «Показывать подзаголовок раздела» включён; поле «Подзаголовок
раздела» пустое с серой подсказкой «Инструкция»; выключение тумблера прячет поле.

- [ ] **Шаг 3: приёмка на ученическом прохождении (веб)**

Пройти тест до экрана введения в трёх состояниях: нетронутая настройка — «Инструкция»; своя
формулировка — она; выключенный тумблер — надписи нет, текст инструкции на месте.

- [ ] **Шаг 4: приёмка в пакете**

```bash
npm run scorm:template
npm run scorm:player
```

Открыть собранный пакет на `:5050`, проверить те же три состояния на экране введения. Пакет —
единственное место, где расхождение хостов видно честно: контекст там собирает другой код.

- [ ] **Шаг 5: регресс существующих тестов**

Открыть тест, созданный до этой работы (настроек у его страниц нет), пройти до экрана введения:
печатается «Инструкция», вид не изменился.

- [ ] **Шаг 6: обновить загруженные копии шаблонов**

Через раздел «Шаблоны» загрузить новые ZIP шаблонов `certification` и `standard-rt`: манифест
живёт в БАЗЕ, и до перезаливки правка файла в репозитории на работающий стенд не влияет.

---

## Что сознательно НЕ делается

- Слой «одна формулировка на весь тест» и кнопка «применить ко всем разделам».
- Остальные жёсткие строки ученических экранов: подписи таймеров «тест» и «раздел», строки
  экрана вопроса, обзора, блокировки и перехода.
- Расширение реестра надписей PRD-49 на экран введения.
- Полный прогон `npm test` — только по явному разрешению владельца.
