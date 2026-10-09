# PRD-61. Вводный текст по исходу — план реализации

**Спецификация:** [PRD-61](../specs/prd-61/results-intro-by-outcome.md) (v1.0, согласована
2026-09-22)

**Ветка:** `feat/prd-61-intro-by-outcome`, worktree `.claude/worktrees/prd61-intro-outcome`

**Цель:** у вводного текста экрана итогов и отчёта появляются общее вступление и два текста по
вердикту; выбор делает та же функция, которой гасится вердиктная шапка.

**Устройство:** форма `tests.intro_json` расширяется аддитивно (нынешние `format`/`text` =
общее вступление, рядом необязательные `passed`/`failed`). Точки выдачи не меняются — они уже
возят ветвь целиком. Выбор происходит ОДИН раз, в `buildResultContext`, где вердикт уже известен;
отчёт приходит в тот же построитель. Контекст остаётся с одним `introHtml`, поэтому шаблоны и
контракт не трогаются.

**Порядок:** Э0 (эскиз, согласование) идёт первым и блокирует Э5. Э1-Э4 от эскиза не зависят и
могут делаться параллельно ему.

---

## Э0. Эскиз карточки «Вводный текст»

Блокирует Э5. React-кода до согласования эскиза не писать.

**Файлы:**

- Создать: `docs/wireframes/prd61-intro-by-outcome.html`; после согласования — переехал в
  `docs/wireframes/approved/prd61-intro-by-outcome.html` (СОГЛАСОВАН владельцем 2026-09-22)
- Читать перед началом: `docs/guides/ds-handbook.md` (handbook-first), существующий эскиз
  ящика `docs/wireframes/editor-settings-target.html` — карточка «Вводный текст» в нём уже есть

- [ ] **Шаг 1. Снять нынешнюю карточку с живого ящика**

Открыть тест в ящике: вкладка «Обратная связь и итоги» -> «Обратная связь» -> «Общее». Карточка
«Вводный текст» сейчас: поле «На экране итогов», переключатель «В отчёте — тот же текст, что на
экране итогов», поле «В отчёте» (скрыто, пока переключатель включён).

- [ ] **Шаг 2. Нарисовать целевую карточку**

Состав по FR-17: три поля экрана итогов, переключатель, три поля отчёта. Подписи полей по FR-19:
«Вводный текст», «Если тест пройден», «Если тест не пройден». Только эскизный фрейм, без
хромированной обвязки браузера; классы DS `ou-*`, никакого сырого Tailwind.

- [ ] **Шаг 3. Прогнать DS-линтер эскизов**

Команда: `npm run check:wireframes:ds`

- [ ] **Шаг 4. Показать владельцу и получить согласование**

После согласования — перенести в `docs/wireframes/approved/` и ТЕМ ЖЕ заходом отразить правку в
`docs/wireframes/editor-settings-target.html`: гейт `npm run check:editor-ui` меряет живой ящик
против этого отдельного эталона, а не против согласованного эскиза, и рассогласование он объявит
расхождением.

- [ ] **Шаг 5. Коммит**

```bash
git add docs/wireframes/prd61-intro-by-outcome.html docs/wireframes/approved docs/wireframes/editor-settings-target.html
git commit -m "docs(prd-61): эскиз карточки вводного текста по исходу"
```

---

## Э1. Схема: ветви исхода в `intro_json`

**Файлы:**

- Изменить: `shared/schema.ts` (блок `introBlockSchema` / `testIntroSchema`, около строки 1270)
- Тест: `tests/report-intro-block.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

Добавить в `tests/report-intro-block.test.ts`:

```ts
describe("схема вводного текста", () => {
  it("принимает тексты исхода рядом с общим вступлением", () => {
    const parsed = testIntroSchema.parse({
      results: {
        format: "plain",
        text: "Спасибо за прохождение теста.",
        passed: { format: "plain", text: "Сертификация пройдена." },
        failed: { format: "html", text: "<p>Не хватило баллов.</p>" },
      },
    });
    expect(parsed.results?.passed?.text).toBe("Сертификация пройдена.");
    expect(parsed.results?.failed?.format).toBe("html");
  });

  it("принимает старую форму без ветвей исхода", () => {
    const parsed = testIntroSchema.parse({ report: { format: "plain", text: "Об отчёте" } });
    expect(parsed.report?.text).toBe("Об отчёте");
    expect(parsed.report?.passed).toBeUndefined();
  });
});
```

Импорт `testIntroSchema` — из `@shared/schema`.

- [ ] **Шаг 2. Прогнать тест и убедиться, что он падает**

Команда: `npm test -- tests/report-intro-block.test.ts`
Ожидание: FAIL на первом тесте — `passed` вырезается схемой (zod по умолчанию отбрасывает
неизвестные ключи).

- [ ] **Шаг 3. Расширить схему**

В `shared/schema.ts` заменить нынешний `introBlockSchema` на пару:

```ts
/**
 * ОДИН текст вводного блока: разметка и формат, в котором автор его написал.
 *
 * Отдельный тип от {@link introBlockSchema}, потому что ветви исхода — это тексты, а не
 * блоки: у текста исхода не может быть собственных текстов исхода.
 */
export const introTextSchema = z.object({
  format: feedbackFormatSchema.default("plain"),
  text: z.string().default(""),
});

/**
 * ВВОДНЫЙ ТЕКСТ одной выдачи (PRD-61): общее вступление плюс необязательные тексты по исходу.
 *
 * `format`/`text` — общее вступление, печатаемое при ЛЮБОМ исходе; это ровно тот текст, что
 * лежал здесь до PRD-61, и смысл его не менялся. `passed`/`failed` печатаются вторым блоком,
 * когда вердикт вынесен (см. `shared/report/report-intro.ts`).
 *
 * Отсутствие ветвей исхода — не порча данных, а обычное состояние: так выглядит всякий тест,
 * заведённый до PRD-61, и всякий снимок публикации, сделанный до него.
 */
export const introBlockSchema = introTextSchema.extend({
  passed: introTextSchema.nullish(),
  failed: introTextSchema.nullish(),
});
```

`testIntroSchema` не трогать — она ссылается на `introBlockSchema` и подхватит расширение.
Рядом с `export type IntroBlock` добавить:

```ts
export type IntroText = z.infer<typeof introTextSchema>;
```

- [ ] **Шаг 4. Прогнать тест и типы**

Команды:

```bash
npm test -- tests/report-intro-block.test.ts
npm run check
```

Ожидание: тесты PASS. `npm run check` — без ошибок. ГОЧА: кэш `.tsbuildinfo` общий у worktree,
поэтому зелёный `check` может быть враньём; если правки типов не видны, удалить `.tsbuildinfo`
и повторить.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/schema.ts tests/report-intro-block.test.ts
git commit -m "feat(prd-61): ветви исхода в схеме вводного текста"
```

---

## Э2. Правило выбора

**Файлы:**

- Изменить: `shared/report/report-intro.ts`
- Тест: `shared/report/__tests__/report-intro.test.ts` (создать, если файла нет — проверить
  `ls shared/report/__tests__`)

- [ ] **Шаг 1. Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { introBlocksToPrint } from "../report-intro";

const block = {
  format: "plain" as const,
  text: "Спасибо за прохождение теста.",
  passed: { format: "plain" as const, text: "Поздравляем." },
  failed: { format: "plain" as const, text: "Не хватило баллов." },
};

describe("introBlocksToPrint", () => {
  it("пройден: общее вступление, затем текст прошедшему", () => {
    expect(introBlocksToPrint(block, { verdictPronounced: true, passed: true }))
      .toEqual([
        { format: "plain", text: "Спасибо за прохождение теста." },
        { format: "plain", text: "Поздравляем." },
      ]);
  });

  it("не пройден: общее вступление, затем текст не прошедшему", () => {
    const out = introBlocksToPrint(block, { verdictPronounced: true, passed: false });
    expect(out.map((b) => b.text)).toEqual([
      "Спасибо за прохождение теста.",
      "Не хватило баллов.",
    ]);
  });

  it("вердикт не вынесен: только общее вступление", () => {
    const out = introBlocksToPrint(block, { verdictPronounced: false, passed: false });
    expect(out.map((b) => b.text)).toEqual(["Спасибо за прохождение теста."]);
  });

  it("общее вступление пустое: печатается только текст исхода", () => {
    const out = introBlocksToPrint(
      { format: "plain", text: "   ", failed: { format: "plain", text: "Не хватило." } },
      { verdictPronounced: true, passed: false },
    );
    expect(out.map((b) => b.text)).toEqual(["Не хватило."]);
  });

  it("старая форма без ветвей исхода: только общее вступление", () => {
    const out = introBlocksToPrint(
      { format: "plain", text: "Об отчёте" },
      { verdictPronounced: true, passed: true },
    );
    expect(out.map((b) => b.text)).toEqual(["Об отчёте"]);
  });

  it("ничего не задано: пустой список", () => {
    expect(introBlocksToPrint(null, { verdictPronounced: true, passed: true })).toEqual([]);
  });
});

describe("resolveReportIntro (FR-11)", () => {
  it("переключатель отдаёт отчёту ветвь экрана ЦЕЛИКОМ, вместе с текстами исхода", () => {
    const intro = { results: block, report: { format: "plain" as const, text: "Своё" }, reportSameAsResults: true };
    expect(resolveReportIntro(intro)?.passed?.text).toBe("Поздравляем.");
  });
});
```

Импорт дополнить: `import { introBlocksToPrint, resolveReportIntro } from "../report-intro";`

- [ ] **Шаг 2. Прогнать тест и убедиться, что он падает**

Команда: `npm test -- shared/report/__tests__/report-intro.test.ts`
Ожидание: FAIL — `introBlocksToPrint` не экспортируется.

- [ ] **Шаг 3. Реализовать правило**

В `shared/report/report-intro.ts` расширить `IntroBlockLike` и добавить функцию:

```ts
/** Вводный блок: общее вступление и необязательные тексты по исходу (PRD-61). */
export interface IntroBlockLike {
  text?: string | null;
  format?: "plain" | "richText" | "html" | null;
  /** Текст прошедшему. Отсутствие = такого текста автор не писал. */
  passed?: IntroTextLike | null;
  /** Текст не прошедшему. */
  failed?: IntroTextLike | null;
}

/** Один текст вводного блока. */
export interface IntroTextLike {
  text?: string | null;
  format?: "plain" | "richText" | "html" | null;
}

/** Исход прогона в терминах, в которых его знает построитель контекста. */
export interface IntroOutcome {
  /**
   * Был ли вердикт ВЫНЕСЕН. Считается `hasPronouncedVerdict()` из `shared/scoring/pass-rule`
   * — ТОЙ ЖЕ функцией, которой построитель гасит вердиктную шапку. Второе определение этого
   * понятия заводить нельзя: расхождение двух копий вердиктного гейта уже давало дефект,
   * когда шапка печатала «Пройден» над блоком работы над ошибками.
   */
  verdictPronounced: boolean;
  passed: boolean;
}

/**
 * КАКИЕ тексты печатает вводный блок этой выдачи и в каком порядке (PRD-61 FR-06 - FR-09).
 *
 * Общее вступление идёт первым и печатается всегда; текст исхода — вторым и только когда
 * вердикт вынесен. Пустой текст блока не даёт: гейт стоит на самом тексте, а не на наличии
 * записи, — автор, стерший текст, ожидает, что блок исчезнет, а не станет пустой рамкой.
 *
 * Адаптивный режим сюда не ходит: он вердикта не выносит (см. `buildAdaptiveResultContext`).
 */
export function introBlocksToPrint(
  block: IntroBlockLike | null | undefined,
  outcome: IntroOutcome,
): Array<{ text: string; format: IntroTextLike["format"] }> {
  if (!block) return [];
  const out: Array<{ text: string; format: IntroTextLike["format"] }> = [];
  const push = (source: IntroTextLike | null | undefined) => {
    const text = String(source?.text ?? "");
    if (text.trim()) out.push({ text, format: source?.format ?? null });
  };
  push(block);
  if (outcome.verdictPronounced) push(outcome.passed ? block.passed : block.failed);
  return out;
}
```

`resolveReportIntro` не трогать: она отвечает на другой вопрос — какую ВЕТВЬ ВЫДАЧИ взять
(`results` или `report`), и переключатель `reportSameAsResults` остаётся её предметом.

- [ ] **Шаг 4. Прогнать тесты**

Команда: `npm test -- shared/report/__tests__/report-intro.test.ts`
Ожидание: PASS, шесть тестов.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/report/report-intro.ts shared/report/__tests__/report-intro.test.ts
git commit -m "feat(prd-61): правило выбора вводного текста по исходу"
```

---

## Э3. Построитель контекста

**Файлы:**

- Изменить: `shared/template/result-context.ts` (тип `ResultContextOptions.intro` около строки
  824; сборка `introHtml` в `buildResultContext` около строки 1298; адаптивная сборка около
  строки 1748)
- Изменить: `shared/report/report-html.ts` (тип `intro` в входе отчёта, около строки 79)
- Тест: `shared/template/__tests__/result-context.intro.test.ts` (создать)

- [ ] **Шаг 1. Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";

const intro = {
  format: "plain" as const,
  text: "Спасибо за прохождение теста.",
  passed: { format: "plain" as const, text: "Поздравляем." },
  failed: { format: "plain" as const, text: "Не хватило баллов." },
};

/** Минимальный вход оцениваемого прогона: важны только вердикт и наличие баллов. */
function runInput(passed: boolean) {
  return {
    passed,
    correctAnswers: 1,
    totalQuestions: 2,
    earnedPoints: 1,
    possiblePoints: 2,
    overallPercent: 50,
    topicResults: [],
  };
}

describe("вводный блок экрана итогов (PRD-61)", () => {
  it("пройден: печатает общее вступление и текст прошедшему", () => {
    const ctx = buildResultContext(runInput(true), "Тест", { intro, hasPassThreshold: true });
    expect(ctx.result.introHtml).toContain("Спасибо за прохождение теста.");
    expect(ctx.result.introHtml).toContain("Поздравляем.");
    expect(ctx.result.introHtml).not.toContain("Не хватило баллов.");
  });

  it("не пройден: печатает текст не прошедшему", () => {
    const ctx = buildResultContext(runInput(false), "Тест", { intro, hasPassThreshold: true });
    expect(ctx.result.introHtml).toContain("Не хватило баллов.");
    expect(ctx.result.introHtml).not.toContain("Поздравляем.");
  });

  it("порога нет: только общее вступление — вердикта никто не выносил", () => {
    const ctx = buildResultContext(runInput(false), "Тест", { intro, hasPassThreshold: false });
    expect(ctx.result.introHtml).toContain("Спасибо за прохождение теста.");
    expect(ctx.result.introHtml).not.toContain("Не хватило баллов.");
  });

  it("старая форма без ветвей исхода: контекст прежний", () => {
    const ctx = buildResultContext(runInput(true), "Тест", {
      intro: { format: "plain", text: "Об итогах" },
      hasPassThreshold: true,
    });
    expect(ctx.result.introHtml).toBe("<p>Об итогах</p>");
  });
});
```

Точную форму входа сверить с соседним тестом построителя (`ls shared/template/__tests__`) — поля
`ResultInput` там уже собраны, дублировать вымышленные имена нельзя.

- [ ] **Шаг 2. Прогнать тест и убедиться, что он падает**

Команда: `npm test -- shared/template/__tests__/result-context.intro.test.ts`
Ожидание: FAIL — печатается только общее вступление, текста исхода в `introHtml` нет.

- [ ] **Шаг 3. Расширить тип опции**

В `shared/template/result-context.ts` заменить тип `intro` в `ResultContextOptions`:

```ts
  /**
   * Вводный блок этой выдачи: общее вступление и тексты по исходу (`tests.intro_json`,
   * PRD-61). Разметку строит построитель, а не хост: правило одно и то же для экрана и для
   * отчёта, а два его применения разошлись бы ровно так же, как разошлись бы два расчёта
   * вердикта. Пустой текст блока не даёт (см. {@link CtxResult.introHtml}).
   */
  intro?: IntroBlockLike | null;
```

и добавить импорт:

```ts
import { introBlocksToPrint, type IntroBlockLike } from "../report/report-intro";
```

- [ ] **Шаг 4. Собрать `introHtml` из списка**

Заменить сборку в `buildResultContext` (нынешние три строки с `richTextToHtml(opts.intro?.text …)`):

```ts
  // Вводный блок — первым, до всего остального (см. `CtxResult.introHtml`). Разметку строит
  // ядро, поэтому правило одно и то же для экрана и для отчёта.
  //
  // PRD-61: блоков может быть два — общее вступление и текст исхода. Исход берётся из
  // `noVerdict`, посчитанного выше ДЛЯ ВЕРДИКТНОЙ ШАПКИ: одна причина — один ответ, иначе
  // шапка и текст под ней снова начнут говорить разное.
  const introHtml = introBlocksToPrint(opts.intro, {
    verdictPronounced: !noVerdict,
    passed: !!input.passed,
  })
    .map((b) => richTextToHtml(b.text, b.format ?? undefined))
    .filter(Boolean)
    .join("");
  if (introHtml) result.introHtml = introHtml;
```

Проверить порядок: `noVerdict` объявляется около строки 1228, сборка `introHtml` — около 1298,
то есть уже после. Если в ходе правки порядок изменится, `noVerdict` поднять выше, а не
пересчитывать вторым выражением.

- [ ] **Шаг 5. Адаптивный построитель: только общее вступление**

В `buildAdaptiveResultContext` заменить сборку на явный вызов того же правила:

```ts
  // Вводный блок — первым, до уровней и измерений: правило общее для обоих режимов.
  //
  // PRD-61 FR-14b: адаптивный режим вердикта НЕ выносит (заголовков исхода у него нет —
  // см. `AdaptiveResultContextOptions.headings`), поэтому печатается только общее
  // вступление. Текст исхода ходит парой с заголовком исхода.
  const adaptiveIntroHtml = introBlocksToPrint(opts.intro, {
    verdictPronounced: false,
    passed: !!input.passed,
  })
    .map((b) => richTextToHtml(b.text, b.format ?? undefined))
    .filter(Boolean)
    .join("");
  if (adaptiveIntroHtml) result.introHtml = adaptiveIntroHtml;
```

Тип `AdaptiveResultContextOptions.intro` привести к тому же `IntroBlockLike | null`.

- [ ] **Шаг 6. Расширить тип входа отчёта**

В `shared/report/report-html.ts` заменить тип поля `intro` на `IntroBlockLike | null` с импортом
из `./report-intro`, сохранив нынешний комментарий о том, что у документа вводное слово своё.

- [ ] **Шаг 7. Прогнать тесты и типы**

```bash
npm test -- shared/template/__tests__/result-context.intro.test.ts
npm test -- tests/report-intro-block.test.ts
npm run check
```

Ожидание: PASS, типы чисты.

- [ ] **Шаг 8. Коммит**

```bash
git add shared/template/result-context.ts shared/report/report-html.ts shared/template/__tests__/result-context.intro.test.ts
git commit -m "feat(prd-61): построитель печатает текст исхода вместе с вводным"
```

---

## Э4. Книга Excel

**Файлы:**

- Изменить: `server/utils/workbook-settings.ts` (блок «Intro blocks», строки 610-615)
- Тест: `tests/workbook-settings.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

Добавить в `tests/workbook-settings.test.ts`, используя ЕГО собственные помощники
(`serializeSettingsRows`, `cellOf` — объявлены в начале файла):

```ts
it("возит тексты исхода вводного блока в выгрузку", () => {
  const rows = serializeSettingsRows({
    introJson: {
      results: {
        format: "plain",
        text: "Общее",
        passed: { format: "plain", text: "Прошедшему" },
        failed: { format: "html", text: "<p>Не прошедшему</p>" },
      },
    },
  } as unknown as SettingsSource);
  expect(cellOf(rows, "Вводный текст на экране итогов, если тест пройден")).toBe("Прошедшему");
  expect(cellOf(rows, "Вводный текст на экране итогов, если тест не пройден"))
    .toBe("<p>Не прошедшему</p>");
  expect(cellOf(rows, "Формат вводного текста на экране итогов, если тест не пройден"))
    .toBe("HTML");
});
```

- [ ] **Шаг 2. Прогнать тест и убедиться, что он падает**

Команда: `npm test -- tests/workbook-settings.test.ts`
Ожидание: FAIL — таких строк в книге нет.

- [ ] **Шаг 3. Добавить параметры книги**

В `server/utils/workbook-settings.ts` после нынешних пяти строк вводного блока:

```ts
  // PRD-61: тексты по исходу. Отдельные строки, а не один столбец с разделителем: книга
  // редактируется руками, и склеенное поле автор порвёт первым же переносом строки.
  textParam("Вводный текст на экране итогов, если тест пройден", (s) => branch(s.introJson, "results", "passed").text, "introResultsPassed", "text"),
  enumParam("Формат вводного текста на экране итогов, если тест пройден", FORMAT_LABELS, (s) => branch(s.introJson, "results", "passed").format, "introResultsPassed", "format"),
  textParam("Вводный текст на экране итогов, если тест не пройден", (s) => branch(s.introJson, "results", "failed").text, "introResultsFailed", "text"),
  enumParam("Формат вводного текста на экране итогов, если тест не пройден", FORMAT_LABELS, (s) => branch(s.introJson, "results", "failed").format, "introResultsFailed", "format"),
  textParam("Вводный текст в отчёте, если тест пройден", (s) => branch(s.introJson, "report", "passed").text, "introReportPassed", "text"),
  enumParam("Формат вводного текста в отчёте, если тест пройден", FORMAT_LABELS, (s) => branch(s.introJson, "report", "passed").format, "introReportPassed", "format"),
  textParam("Вводный текст в отчёте, если тест не пройден", (s) => branch(s.introJson, "report", "failed").text, "introReportFailed", "text"),
  enumParam("Формат вводного текста в отчёте, если тест не пройден", FORMAT_LABELS, (s) => branch(s.introJson, "report", "failed").format, "introReportFailed", "format"),
```

- [ ] **Шаг 4. Свести новые «корзины» в `intro_json` при импорте**

Найти в этом же модуле место, где корзины `introResults` / `introReport` / `introRoot`
собираются обратно в колонку (искать по `introRoot`), и добавить туда сборку четырёх новых
корзин во вложенные ветви `passed` / `failed` соответствующей выдачи. Ветвь исхода создавать
только когда её текст непустой: пустая ветвь = ветви нет (FR-05).

- [ ] **Шаг 5. Дополнить фикстуру круга**

`ROUND_TRIP_SOURCE` в `tests/workbook-settings.test.ts` привязана к реестру параметров ГВАРДОМ:
параметр, добавленный без значения в фикстуре, роняет набор, а не тихо остаётся непроверенным.
Поэтому в её `introJson` завести обе ветви исхода у обеих выдач — значениями, отличными от того,
что отдаёт пустой источник.

- [ ] **Шаг 6. Прогнать тесты**

```bash
npm test -- tests/workbook-settings.test.ts
npm test -- tests/routes.tests-workbook.test.ts
```

Ожидание: PASS, включая тест круга и гвард реестра.

- [ ] **Шаг 7. Коммит**

```bash
git add server/utils/workbook-settings.ts tests/workbook-settings.test.ts
git commit -m "feat(prd-61): тексты исхода в книге настроек"
```

---

## Э5. Ящик редактора

Начинать ТОЛЬКО после согласования эскиза (Э0).

**Файлы:**

- Изменить: `client/src/features/tests/editor/test-editor.mappers.ts` (`readIntroFromApi`,
  строки 997-1014)
- Изменить: `client/src/features/tests/editor/sections/basic-settings-section.tsx` (карточка
  «Вводный текст», строки 353-394; `IntroEditTrigger`, строки 2372-2415)
- Тест: добавить в существующий `client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts`

- [ ] **Шаг 1. Написать падающий тест на маппер**

```ts
it("поднимает тексты исхода, даже когда общее вступление пусто", () => {
  const model = apiToEditorModel({
    introJson: {
      report: { format: "plain", text: "", failed: { format: "plain", text: "Не хватило" } },
    },
  });
  expect(model.intro?.report?.failed?.text).toBe("Не хватило");
});
```

`apiToEditorModel` уже импортирован в этом файле — второго импорта не заводить.

Этот тест — главный в задаче: сегодня ветвь с пустым общим текстом пропускается целиком
(`continue`), и тексты исхода, заведённые книгой или через API, молча терялись бы при первом же
сохранении теста из ящика (FR-20a).

- [ ] **Шаг 2. Прогнать тест и убедиться, что он падает**

Команда: `npm test -- client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts`
Ожидание: FAIL — `model.intro.report` отсутствует: ветвь отброшена по пустому общему тексту.

- [ ] **Шаг 3. Переписать `readIntroFromApi`**

```ts
/** Один текст вводного блока, прочитанный защитно: пустой текст = текста нет. */
function readIntroText(raw: unknown): IntroText | undefined {
  if (!isPlainObject(raw)) return undefined;
  const b = raw as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text : "";
  if (!text.trim()) return undefined;
  const format = b.format === "richText" || b.format === "html" ? b.format : "plain";
  return { text, format };
}

function readIntroFromApi(api: ApiTestResponse): TestIntro {
  const raw = api.introJson;
  if (!isPlainObject(raw)) return {};
  const out: TestIntro = {};
  for (const side of ["results", "report"] as const) {
    const branch = (raw as Record<string, unknown>)[side];
    if (!isPlainObject(branch)) continue;
    const b = branch as Record<string, unknown>;
    const common = readIntroText(b);
    const passed = readIntroText(b.passed);
    const failed = readIntroText(b.failed);
    // PRD-61: ветвь живёт, пока в ней есть ХОТЬ ОДИН текст. Прежний код выходил по пустому
    // общему вступлению и терял тексты исхода, заведённые книгой или через API.
    if (!common && !passed && !failed) continue;
    out[side] = {
      format: common?.format ?? "plain",
      text: common?.text ?? "",
      ...(passed ? { passed } : {}),
      ...(failed ? { failed } : {}),
    };
  }
  if ((raw as Record<string, unknown>).reportSameAsResults === true) out.reportSameAsResults = true;
  return out;
}
```

- [ ] **Шаг 4. Прогнать тесты мапперов**

```bash
npm test -- client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts
npm test -- client/src/features/tests/editor/__tests__/test-editor.mappers.branches.test.ts
```

Ожидание: PASS. Второй файл проверяет защитное чтение веток — правка `readIntroFromApi` его
затрагивает.

- [ ] **Шаг 5. Развести типы триггера**

`IntroEditTrigger` правит ОДИН текст, поэтому его `value`/`onSave` перевести с `IntroBlock` на
`IntroText` (тип из Э1). Тело функции не меняется — оно и сегодня работает с `format`/`text`.

- [ ] **Шаг 6. Собрать карточку по согласованному эскизу**

В `basic-settings-section.tsx` карточка «Вводный текст» получает шесть триггеров и переключатель
между ними, ровно в том порядке и с теми подписями, что в согласованном эскизе. Общее вступление
экрана правится как сегодня; тексты исхода пишут в `intro.results.passed` / `.failed`,
аналогично для отчёта. Пустой текст стирает ветвь исхода (`undefined`), а не пишет пустую.

- [ ] **Шаг 7. Проверить круг в браузере**

Открыть ящик, завести все три текста на экране и в отчёте, сохранить, перезагрузить страницу,
открыть снова — тексты на месте. Затем сохранить тест ещё раз, ничего не меняя, и перечитать:
ничего не стёрлось. Это и есть проверка FR-20a.

- [ ] **Шаг 8. Прогнать гейт эскиза**

Команда: `npm run check:editor-ui`
ГОЧА: гейт ходит на `EDITOR_UI_BASE` (по умолчанию :8081) — это чужой инстанс. Поднять свой
(`PORT=8099 npm run dev`) и указать его явно.

- [ ] **Шаг 9. Коммит**

```bash
git add client/src/features/tests/editor
git commit -m "feat(prd-61): три вводных текста в карточке ящика"
```

---

## Э6. Предпросмотр отчёта

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/report-preview-modal.tsx` (сборка
  контекста, строки 165-175)
- Изменить: функция `buildReportPreviewInput` (найти: `grep -rn "buildReportPreviewInput" client/src`)

- [ ] **Шаг 1. Подать вводный блок в образец**

`buildReportPreviewInput(test, outcome)` начинает класть в свой результат `intro` — ветвь отчёта,
разрешённую тем же `resolveReportIntro`, что и в выдаче. Вердикт образца уже задан переключателем
`outcome`, поэтому выбор текста построитель сделает сам, как и в реальной выдаче.

- [ ] **Шаг 2. Проверить в браузере**

Открыть предпросмотр отчёта у теста с тремя текстами, переключить «Пройден» / «Не пройден» —
меняется второй абзац вводного блока, первый остаётся.

- [ ] **Шаг 3. Коммит**

```bash
git add client/src/features/tests/editor/sections
git commit -m "fix(prd-61): предпросмотр отчёта печатает вводный блок"
```

---

## Э6а. Снятие общей обратной связи теста

Решение владельца 2026-09-22 (спецификация §10): три вводных текста делают обратную связь УРОВНЯ
ТЕСТА избыточной. Порядок — «скрыть сейчас, удалить потом»: колонки остаются, сносит их отдельная
миграция позже.

**Файлы:**

- Изменить: `shared/template/result-context.ts` (сборка `recommendationSources`, около строки 1336
  — и такая же в адаптивном построителе)
- Изменить: `server/scorm/builders/test-json.ts:304` и `:310` (оба поля обратной связи теста)
- Изменить: `server/utils/workbook-feedback.ts` (владелец уровня `OWNER_TEST`)
- Изменить: `client/src/features/tests/editor/sections/basic-settings-section.tsx` (карточка
  «Общая обратная связь теста» и её триггер)
- Изменить: `shared/schema.ts` (пометить `tests.feedbackJson` и `tests.feedback` устаревшими)

- [ ] **Шаг 1. Написать падающий тест на выдачу**

```ts
it("текст обратной связи ТЕСТА больше не попадает в рекомендации, а тексты ТЕМ попадают", () => {
  const ctx = buildResultContext(
    {
      passed: false,
      correctAnswers: 0,
      totalQuestions: 2,
      earnedPoints: 0,
      possiblePoints: 2,
      overallPercent: 0,
      topicResults: [
        { topicId: "t1", topicName: "Тема", correct: 0, total: 1, percent: 0, passed: false,
          feedbackTexts: ["Текст темы"] },
      ],
    },
    "Тест",
    { hasPassThreshold: true, testFeedback: { format: "plain", text: "Текст теста" } },
  );
  const printed = JSON.stringify(ctx.result);
  expect(printed).toContain("Текст темы");
  expect(printed).not.toContain("Текст теста");
});
```

Форму входа и имя поля темы сверить с соседним тестом построителя — вымышленные имена не
использовать.

- [ ] **Шаг 2. Прогнать тест и убедиться, что он падает**

Команда: `npm test -- shared/template/__tests__/result-context.intro.test.ts`
Ожидание: FAIL — «Текст теста» пока печатается.

- [ ] **Шаг 3. Убрать источник из сборщика**

В `buildResultContext` заменить строку сбора источников:

```ts
  // PRD-61 §10: обратная связь УРОВНЯ ТЕСТА снята — три вводных текста говорят то же самое и
  // там, где автор этого ждёт, в начале. Блок рекомендаций собирается только из тем, подтем,
  // шкал и показателей; `opts.testFeedback` больше не источник и не читается.
  const recommendationSources: Array<FeedbackBlock | null | undefined> = [];
```

Гейт `explicitPass` при этом остаётся: он гасит ещё и тексты тем (`topicRecommendationSources`),
и трогать его нельзя. То же изменение — в адаптивном построителе.

- [ ] **Шаг 4. Прогнать тест**

Команда: `npm test -- shared/template/__tests__/result-context.intro.test.ts`
Ожидание: PASS.

- [ ] **Шаг 5. Убрать из пакета**

В `server/scorm/builders/test-json.ts` снять оба поля — `testFeedback: data.test.feedback || null`
(строка 304) и ветвь `testFeedbackJson` (строка 310). Тест `server/scorm/__tests__/test-json-prd29.test.ts`
проверяет их наличие — переписать под новое поведение, а не удалить.

- [ ] **Шаг 6. Убрать строку уровня «Тест» из книги**

В `server/utils/workbook-feedback.ts` снять ветвь `OWNER_TEST` в `ownersOf`. Строки тем, разделов
и подтем не трогать. Прогнать: `npm test -- tests/workbook-feedback.test.ts` (имя файла сверить
по `ls tests | grep feedback`).

- [ ] **Шаг 7. Убрать карточку из ящика**

В `basic-settings-section.tsx` снять карточку «Общая обратная связь теста» вместе с
`TestFeedbackTrigger`, если он больше нигде не используется (проверить: `grep -rn "TestFeedbackTrigger" client/src`).

- [ ] **Шаг 8. Пометить колонки устаревшими**

В `shared/schema.ts` у `feedbackJson` и `feedback` таблицы `tests` поставить `@deprecated` с
ссылкой на PRD-61 §10 и на пункт технического долга.

- [ ] **Шаг 9. Прогнать затронутые наборы и закоммитить**

```bash
npm test -- shared/template/__tests__
npm test -- server/scorm/__tests__/test-json-prd29.test.ts
npm run check
git add -A
git commit -m "feat(prd-61): общая обратная связь теста снята с выдачи и из ящика"
```

## Э7. Приёмка

- [ ] **Шаг 1. Веб: два прогона**

Завести тест с тремя текстами и порогом, пройти дважды — выше порога и ниже. Сверить экран итогов
и скачанный PDF: заголовок и второй абзац вводного блока согласованы в обоих прогонах.

- [ ] **Шаг 2. Опросник без порога**

Тест без порога прохождения: печатается только общее вступление.

- [ ] **Шаг 3. Пакет**

```bash
npm run scorm:sample
npm run scorm:player
```

Пройти пакет дважды (выше и ниже порога), проверить экран итогов и экспорт PDF из пакета.
ГОЧА: плеер на :5050 может оказаться чужим и отдавать старый снимок — поднимать свой через
`SCORM_PLAYER_PORT`.

- [ ] **Шаг 4. Старые данные**

Открыть тест, у которого `intro_json` в старой форме, и убедиться, что выдача не изменилась.
Попытка по снимку публикации, сделанному до трека, печатает прежний текст.

- [ ] **Шаг 5. Книга**

Выгрузить книгу теста с текстами исхода, загрузить в другой тест, сверить все девять строк.
Заодно убедиться, что на листе обратной связи нет строки уровня «Тест», а строки тем на месте.

- [ ] **Шаг 5а. Снятая обратная связь теста**

Открыть тест, у которого `feedback_json` заполнен (на проде это черновики HRBP с «Благодарим за
участие!»): карточки в ящике нет, текст не печатается ни на экране, ни в отчёте, ни в пакете, а
рекомендации ТЕМ печатаются как раньше.

- [ ] **Шаг 6. Прогон тестов**

Полный `npm test` — ТОЛЬКО по явному разрешению владельца (занимает около 8 минут и занимает
машину). До того — точечные прогоны затронутых файлов.

---

## Что остаётся за планом

- Тексты боевого теста «Сертификация руководителей в «Ростелекоме»»: перенести нынешний текст в
  ветвь «не пройден» и написать текст прошедшему — работа автора в редакторе.
- Проверка связки `required_topics_only` + общий порог 0 % + `by_variant` (§12 спецификации).
- Срок повторной попытки внутри текста — вне охвата трека.
