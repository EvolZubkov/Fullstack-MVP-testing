# PRD-44 «Распределение баллов»: план реализации

> Для исполнителя: план ведётся по чек-боксам `- [ ]`. Шаг — одно действие на 2-5 минут.
> Порядок внутри задачи всегда один: сначала падающий тест, потом минимальная реализация, потом прогон, потом коммит.

**Цель:** ввести тип вопроса `allocation` — учащийся распределяет общий бюджет баллов между утверждениями,
и это распределение становится вкладом в шкалы PRD-5, величину которого впервые задаёт учащийся, а не автор.

**Архитектура:** тип объявляется признаками в единственном классификаторе `shared/questions/question-type.ts`
(новый признак `distributesBudget`), вклад считается общей функцией «вклад единицы при данном ответе» в
`shared/scales/engine.ts`, разметка порождается одной функцией `renderAllocation` в
`shared/template/question-interaction.ts`, а обе плоские копии рантайма (движок шкал, язык формул, признаки типа)
правятся симметрично под golden-тестами.

**Стек:** TypeScript, Vitest, React 19, `@universityrt/ui-kit`, esbuild-бандл `TBTemplate` для SCORM.

**Источник требований:** [PRD-44](scale-allocation-question-type.md). Ссылки вида FR-NN ниже — на него.

## Состояние

- **Фаза 1 (ядро) — ГОТОВА** 2026-08-06: тип и признаки, `dataJson` и перечисления схемы, чистая модель
  распределения, вклад в шкалы с доменом и референсом ЧИЛ, паритет JS-двойника. Приёмка A-02 закрыта
  тестом: 34 / 16 / 14 / 34 при сумме 98, домен стиля 0..98.
- **Фаза 0 (эскиз) — СДЕЛАН** 2026-08-06, `docs/wireframes/question-allocation.html`, шесть состояний,
  проверен в браузере на 1280 / 920 / 760 / 375. НА СОГЛАСОВАНИИ.
- **Фаза 6 (ведущая и слабая шкала) — ГОТОВА** 2026-08-06: модуль рейтинга, источники `topScale` /
  `bottomScale` в парсере, вычислителе и валидаторе, JS-двойник, +15 случаев в golden-корпусе.
- **Фаза 5 (книга) — ГОТОВА** 2026-08-06: три колонки листа «Вопросы», источник «распределение»,
  шаблон и лист-справка. Приёмка A-03 закрыта тестом (опросник ЧИЛ целиком).
- Фазы 2-4 (дизайн-система, экран учащегося, редактор) ждут согласованного эскиза. Фаза 7 впереди.

### Найденные по ходу дефекты, которые старше PRD-44

- **Сравнение с `null` в языке формул возвращало ИСТИНУ.** `null = "строка"` уходило в числовое
  сравнение, где `toNum(null)` и нечисловая строка одинаково дают 0. Проявиться могло только с
  источником, который возвращает `null` рядом с кодом исхода, — то есть с `topScale`. Исправлено в
  обоих хостах: `null` равен только себе.
- **`QUESTION_WIDTHS` позиционно параллелен `QUESTION_HEADERS`**, и это ничем не проверяется: три новые
  колонки требовали трёх ширин, иначе оформление уезжает молча.
- **Строки-примеры шаблона обязаны нести ВСЕ колонки:** книга берёт набор колонок из первой строки,
  поэтому ключ, пропущенный в первом примере, стирает колонку целиком.

### Решения, принятые по ходу и отличающиеся от первоначального плана

- **Бюджеты едут в `ScoringConfig`, а не отдельным аргументом.** Задача 1.5 планировалась как «протянуть
  бюджеты во все вызовы `achievableRange`». Вместо этого `ScoringConfig` получил поле `budgets`, которое
  заполняет `loadScoringConfig` через ИСТОЧНИК конфигурации. Причины две: бюджет ограничивает домен,
  значит он такая же часть «как считается этот тест», как и вклады; и попытка по снапшоту получает
  бюджет, с которым тест был опубликован, а не текущий. Побочный выигрыш — `server/routes/attempts.ts`
  править не потребовалось, а его сейчас правит другая сессия в этой же рабочей копии.
- **Точная арифметика домена оказалась сложнее формулы FR-15.** Формула спеки
  (`[сумма min; min(бюджет, сумма max)]`) не учитывает, что ОСТАЛЬНЫЕ утверждения вопроса тоже связаны
  своим доменом. При четырёх вариантах, бюджете 7 и максимуме 2 нижняя граница шкалы одного варианта
  равна не нулю, а единице: остальные три впитают не больше шести. Реализовано точное решение (жадное
  распределение пула по коэффициентам), формула спеки остаётся верной для случая по умолчанию
  (`min = 0`, `max = budget`), в том числе для референса.
- **Долг фазы 4:** клиентская кнопка «Рассчитать по вкладам»
  (`scales-section.tsx`, `suggestedDomainOf`) зовёт `achievableRange` без бюджетов, потому что
  `ContributionQuestion` не несёт `dataJson`. Домен вопроса-распределения там сейчас схлопывается в ноль.
  Закрывается вместе с матрицей вкладов в задаче 4.2.

---

## 0. Инвентарь точек ветвления по типу вопроса

Риск R-1 спеки: ветвление по типу рассыпано по коду и почти нигде не является исчерпывающим `switch` —
новый тип компилируется и молча работает неправильно. Перечень ниже собран поиском по литералам типов и по
вызовам признаков; он обязателен к проходу целиком, каждая строка закрывается либо правкой, либо явной
записью «правка не нужна, потому что…».

### 0.1. Ядро и общие модули

| Точка | Что делает сегодня | Что нужно |
| --- | --- | --- |
| `shared/questions/question-type.ts:22` | список `QUESTION_TYPES` | добавить `allocation` |
| `shared/questions/question-type.ts:33-49` | признаки типа | `hasOptionList` — да; `isSingleIndexChoice` — нет; `hasFixedOptionOrder` — нет; новый `distributesBudget` |
| `shared/questions/question-type.ts:73` | `isMeasurementOnly` | вернуть `true` для `allocation` БЕЗУСЛОВНО (FR-09) |
| `server/scorm/template/app/utils/qtype.js` | ES5-зеркало признаков | те же четыре правки |
| `shared/template/runtime-entry.ts:91-94` | экспорт признаков в глобал `TBTemplate` | добавить `distributesBudget`, `renderAllocation`, модель распределения |
| `shared/schema.ts` | 4 места перечисления типов | колонка `questions.type`, `detailedAnswerSchema`, `questionStatsSchema`, `scorm_answers.question_type` (FR-01) |
| `shared/scales/engine.ts:53` | `MeasurementSpec.sourceType` | добавить `option_allocation` (FR-12) |
| `shared/scales/engine.ts:77-99` | `isActive` | ветка `option_allocation`: активна при ненулевом балле |
| `shared/scales/engine.ts:131` | `computeAnswerContributions`, дельта `value * weight` | через общую `unitContribution` (FR-13) |
| `shared/scales/engine.ts:194-200` | `achievableRange`, две ветки | третья ветка для `distributesBudget` (FR-15) |
| `shared/scales/engine.ts:261` | подсчёт активных вкладов | та же `unitContribution` |
| `server/scorm/template/app/scales/engine.js:21,77` | плоский двойник движка шкал | симметрично (FR-16) |
| `shared/scoring/engine.ts:102-229` | проверка ответа и балл | правок НЕ требует: `allocation` не попадает ни в одну ветку и падает в `default`; закрывается тестом «вопрос-распределение не приносит баллов» |
| `shared/scoring/aggregate.ts:115` | пропуск измерительных вопросов | правок не требует — работает через `isMeasurementOnly` |
| `server/scorm/template/app/scoring/engine.js:25-161` | двойник подсчёта баллов | правок не требует по той же причине; закрывается golden-тестом |

### 0.2. Экран учащегося, веб-хост

| Точка | Что делает сегодня | Что нужно |
| --- | --- | --- |
| `shared/template/question-interaction.ts:74` | подсказки типа | строка «Распределите N баллов между вариантами» (FR-32) — подсказка становится функцией от вопроса, а не константой |
| `shared/template/question-interaction.ts:92` | `answerTexts` | тексты утверждений для подгонки шрифта (FR-35) |
| `shared/template/question-interaction.ts` | рендеры по типам | новая `renderAllocation` (FR-27) |
| `client/src/pages/learner/answer-gate.ts:87` | `hasAnswer` | ЯВНАЯ ветка: сумма ровно равна бюджету (FR-31). Ветка `default` засчитала бы частичное распределение |
| `client/src/pages/learner/answer-gate.ts:72` | `deliversShuffledOrder` | правок не требует: тип подчиняется общему признаку (FR-07) |
| `client/src/pages/learner/template-question-screen.tsx:97` | `interactionHtml` | ветка `allocation` |
| `client/src/pages/learner/template-question-screen.tsx:49` | `nextAnswer` по клику | распределение идёт не кликом — новый обработчик ввода |
| `client/src/components/template-screen.tsx:420` | делегирование `change` по `[data-change]` | добавить делегирование `input` по `[data-input]` |
| `client/src/pages/learner/take-test.tsx:742,1135,1273` | сериализация ответа для сохранения и отчёта | ветка `allocation` |
| `client/src/pages/learner/take-test.tsx:1485,1541,1550` | догадки о «пустом» ответе | ветка `allocation` (пустой = сумма меньше бюджета) |

### 0.3. Рантайм SCORM-пакета

| Точка | Что делает сегодня | Что нужно |
| --- | --- | --- |
| `server/scorm/template/app/render/questions/index.js:17-23` | диспетчер рендеров | ветка `allocation` |
| `server/scorm/template/app/render/questions/allocation.js` | — | новая обёртка над `TBTemplate.renderAllocation` (FR-27) |
| `server/scorm/template/app/actions/answers.js:77` | `hasAnswer` | зеркало правила FR-31 |
| `server/scorm/template/app/actions/answers.js:228` | делегирование кликов | делегирование ввода `input` для распределения |
| `server/scorm/template/app/utils/shuffle.js:62-74` | карта перемешивания | ветка для `allocation` (перемешиваются утверждения) |
| `server/scorm/template/app/feedback/feedback.js:24,116` | тексты ответа в обратной связи | ветка `allocation`: вектор баллов, без верности |
| `server/scorm/template/app/adaptive/adaptive.js:203` | извлечение текста ответа | ветка `allocation` |
| `server/scorm/template/app/render/adaptiveRender.js:264-269` | охрана пустого ответа | ветка `allocation` |
| `server/scorm/template/app/render/resultsPage.js:616,734,744,758` | обзор ответов и запись взаимодействия | тип взаимодействия `other`, `learner_response` вида `0[.]3,1[.]1` (FR-54), обзор без разметки верности (FR-33) |

### 0.4. Сервер

| Точка | Что делает сегодня | Что нужно |
| --- | --- | --- |
| `server/routes/questions.ts` | валидация сохранения вопроса | FR-04 и FR-05 с числами в сообщении (FR-46) |
| `server/services/questions-import.ts:102,222,236,259,383` | импорт листа «Вопросы» | тип, три колонки, проверка выполнимости (FR-37, FR-38, FR-39, FR-40) |
| `server/services/questions-export.ts:70-87` | экспорт листа «Вопросы» | вывод типа и трёх колонок |
| `server/services/workbook-import.ts:97,305` | сводка книги, счёт единиц | число утверждений для `allocation` |
| `server/services/workbook-template.ts` | шаблон книги и лист-справка | описание типа, колонок, источника вклада, строка примера (FR-42) |
| `server/utils/scoring-excel.ts:141-207` | лист «Оценка» | предупреждение вместо расчёта (FR-10) |
| `server/routes/analytics/attempts.ts:210-227` | тексты ответа в выгрузке попытки | ветка `allocation` (FR-51) |
| `server/routes/analytics/helpers.ts` | статистика по вопросу | среднее распределение бюджета (FR-51) |
| `server/scorm/debug-player/assets/inspector-compute.js:91,263,932` | инспектор PRD-18 | вектор распределения, вклад в шкалы, пустое поле верности (FR-52) |

### 0.5. Авторские экраны

| Точка | Что делает сегодня | Что нужно |
| --- | --- | --- |
| `client/src/features/questions/question-editor-drawer.tsx:204-216` | список типов и умолчания | пункт «Распределение баллов», поля бюджета и домена, скрытый блок верного ответа (FR-44, FR-45, FR-49) |
| `client/src/features/content/question-preview.tsx:36-68` | предпросмотр вопроса | распределение только для чтения (FR-50) |
| `client/src/features/content/content-filters.tsx` | фильтр по типу | новый пункт |
| `client/src/features/tests/editor/scales-api.ts:359,410,431` | перечень единиц измерения по типу | единицы `option_allocation` (FR-47) |
| `client/src/features/tests/editor/sections/scales-section.tsx:1187` | матрица вкладов | утверждения как варианты, подпись ячейки — коэффициент; предупреждение о связанности шкал (FR-47, FR-48) |
| `client/src/features/tests/editor/sections/scoring-builder.tsx` | конструктор градуированной цены | тип исключается (FR-10) |
| `client/src/features/tests/debug-player/debug-player-page.tsx:479` | иконка типа | иконка распределения |

### 0.6. Формулы, шаблоны, дизайн-система

| Точка | Что нужно |
| --- | --- |
| `shared/formula/tokens.ts`, `parser.ts`, `types.ts`, `evaluator.ts`, `validate.ts` | источники `topScale`/`bottomScale` (FR-18 - FR-24) |
| `server/scorm/template/app/dsl/formula.js` | двойник языка формул (FR-26) |
| `shared/template/preview-context.ts` | демонстрационный вопрос-распределение (FR-55) |
| `server/scorm/templates/<id>/styles/theme.css` | раскладка узкого экрана (FR-36) |
| `vendor/ui-kit/css/university-rt.css` и `client/src/styles/vendor/` | ОБЕ копии бандла дизайн-системы (FR-59) |

---

## 1. Новые файлы

| Файл | Ответственность |
| --- | --- |
| `shared/questions/allocation.ts` | чистая модель распределения: разбор `dataJson`, проверка выполнимости, клампы, остаток, готовность |
| `shared/questions/__tests__/allocation.test.ts` | тесты модели |
| `shared/scales/__tests__/allocation-contribution.test.ts` | вклад FR-12, домен FR-15, ссылочный расчёт FR-17 |
| `shared/scales/__tests__/fixtures/chil-reference.ts` | контрольное заполнение опросника ЧИЛ (A-02) |
| `shared/template/allocation-dom.ts` | framework-free синхронизация DOM при вводе (значения, доступный максимум, остаток) |
| `shared/formula/scale-rank.ts` | построение рейтинга шкал и правило ничьей (FR-20, FR-21) |
| `shared/formula/__tests__/scale-rank.test.ts` | тесты рейтинга, ничьей, пустого рейтинга |
| `server/scorm/template/app/render/questions/allocation.js` | обёртка рендера в пакете |
| `vendor/ui-kit/src/components/BudgetAllocation.tsx` | составной компонент дизайн-системы (FR-57) |
| `vendor/ui-kit/src/components/BudgetAllocation.stories.tsx` | стори (FR-60) |
| `docs/wireframes/question-allocation.html` | эскиз (фаза 0) |

---

## Фаза 0. Эскиз

Согласование формы ДО React — правило проекта: UI принимается по эскизу, а не по вкусу исполнителя.

### Задача 0.1: эскиз экрана учащегося и карточки редактора

**Файлы:**

- Создать: `docs/wireframes/question-allocation.html`

- [ ] **Шаг 1: взять за образец соседний эскиз того же рода**

Открыть `docs/wireframes/approved/question-scale.html` (тип-прецедент PRD-26) и `docs/wireframes/prd7-shared.css`.
Эскизный фрейм берётся оттуда дословно, внутри холста — только реальная разметка дизайн-системы.

- [ ] **Шаг 2: нарисовать три состояния экрана учащегося**

Состояния: (1) нетронутый вопрос, счётчик «Осталось: 7 из 7»; (2) частичное распределение;
(3) весь бюджет распределён, счётчик «Вы использовали все баллы». В каждом состоянии — строка утверждения
из пары «ползунок + числовое поле со степпером» и счётчик остатка над группой (FR-28).

- [ ] **Шаг 3: нарисовать узкий экран**

Раскладка пары «ползунок и поле» при ширине сцены телефона (FR-36).

- [ ] **Шаг 4: нарисовать карточку редактора**

Список утверждений как у одиночного выбора плюс три поля: «Бюджет», «Минимум на вариант»,
«Максимум на вариант»; блок верного ответа отсутствует (FR-45).

- [ ] **Шаг 5: браузерная сверка эскиза**

Поднять `chrome-headless-shell` над `http.server` из КОРНЯ репозитория, снять скриншоты всех состояний,
сверить каждую деталь. Скриншоты — в `.playwright-mcp/`, не в корне.

- [ ] **Шаг 6: согласование и коммит**

Показать скриншоты владельцу продукта. После согласования перенести файл в `docs/wireframes/approved/`
и закоммитить:

```bash
git add docs/wireframes/approved/question-allocation.html
git commit -m "docs(prd-44): эскиз экрана распределения баллов"
```

---

## Фаза 1. Ядро

### Задача 1.1: тип и признаки

**Файлы:**

- Изменить: `shared/questions/question-type.ts`
- Изменить: `server/scorm/template/app/utils/qtype.js`
- Изменить: `shared/template/runtime-entry.ts`
- Тест: `shared/questions/__tests__/question-type.test.ts`

- [ ] **Шаг 1: написать падающую тест-матрицу «тип x признак»**

Матрица закрывает риск R-1: каждый признак проверяется на КАЖДОМ типе, поэтому забытый тип виден сразу.

```ts
import { describe, expect, it } from "vitest";
import {
  QUESTION_TYPES,
  distributesBudget,
  hasFixedOptionOrder,
  hasOptionList,
  isMeasurementOnly,
  isSingleIndexChoice,
} from "../question-type";

const TRAITS: Record<string, Record<string, boolean>> = {
  single:     { hasOptionList: true,  isSingleIndexChoice: true,  hasFixedOptionOrder: false, distributesBudget: false },
  multiple:   { hasOptionList: true,  isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false },
  matching:   { hasOptionList: false, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false },
  ranking:    { hasOptionList: false, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false },
  scale:      { hasOptionList: true,  isSingleIndexChoice: true,  hasFixedOptionOrder: true,  distributesBudget: false },
  allocation: { hasOptionList: true,  isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: true },
};

describe("признаки типа вопроса", () => {
  it("перечень типов совпадает с матрицей", () => {
    expect([...QUESTION_TYPES].sort()).toEqual(Object.keys(TRAITS).sort());
  });

  for (const type of Object.keys(TRAITS)) {
    it(`${type}: признаки`, () => {
      expect(hasOptionList(type)).toBe(TRAITS[type].hasOptionList);
      expect(isSingleIndexChoice(type)).toBe(TRAITS[type].isSingleIndexChoice);
      expect(hasFixedOptionOrder(type)).toBe(TRAITS[type].hasFixedOptionOrder);
      expect(distributesBudget(type)).toBe(TRAITS[type].distributesBudget);
    });
  }

  it("распределение всегда измерительное, даже с непустым correctJson", () => {
    expect(isMeasurementOnly({ type: "allocation", correctJson: { correctIndex: 1 } })).toBe(true);
  });
});
```

- [ ] **Шаг 2: прогнать тест и увидеть падение**

Запуск: `npm test -- shared/questions/__tests__/question-type.test.ts`
Ожидание: FAIL, `distributesBudget is not a function`.

- [ ] **Шаг 3: реализовать признаки**

В `shared/questions/question-type.ts`:

```ts
export const QUESTION_TYPES = ["single", "multiple", "matching", "ranking", "scale", "allocation"] as const;

export function hasOptionList(type: string): boolean {
  return type === "single" || type === "multiple" || type === "scale" || type === "allocation";
}

/**
 * The learner splits a fixed BUDGET across the options, so the answer is a per-option
 * amount (`Record<index, points>`) and the size of the amount — not the mere fact of
 * choosing — is what the measurement reads. This is the trait behind every branch that
 * would otherwise ask `type === "allocation"`.
 */
export function distributesBudget(type: string): boolean {
  return type === "allocation";
}
```

В `isMeasurementOnly` первой строкой:

```ts
  // A budget allocation is measurement-only BY TYPE (PRD-44 FR-09): the method has no
  // reference distribution at all, so there is nothing an author could switch on.
  if (question.type === "allocation") return true;
```

- [ ] **Шаг 4: прогнать тест — зелёный**

Запуск: `npm test -- shared/questions/__tests__/question-type.test.ts`
Ожидание: PASS.

- [ ] **Шаг 5: повторить в ES5-зеркале и экспортировать признак в рантайм**

`server/scorm/template/app/utils/qtype.js` — те же четыре правки плюс `distributesBudget` в возвращаемом
объекте. `shared/template/runtime-entry.ts` — добавить `distributesBudget` в реэкспорт рядом с остальными
признаками (иначе рантайм пакета его не увидит).

- [ ] **Шаг 6: прогнать тест экспортов рантайма**

Запуск: `npm test -- shared/template/__tests__/runtime-entry-exports.test.ts`
Ожидание: PASS после добавления имени в ожидаемый список этого теста.

- [ ] **Шаг 7: коммит**

```bash
git add shared/questions server/scorm/template/app/utils/qtype.js shared/template/runtime-entry.ts
git commit -m "feat(prd-44): тип allocation и признак distributesBudget"
```

### Задача 1.2: схема данных

**Файлы:**

- Изменить: `shared/schema.ts` (4 места перечисления типов)
- Тест: `shared/__tests__/schema-allocation.test.ts`

- [ ] **Шаг 1: написать падающий тест схемы**

```ts
import { describe, expect, it } from "vitest";
import { allocationDataSchema, insertQuestionSchema } from "../schema";

describe("схема вопроса-распределения", () => {
  it("принимает корректный dataJson", () => {
    const parsed = allocationDataSchema.parse({ options: ["a", "b"], budget: 7, minPerOption: 0, maxPerOption: 7 });
    expect(parsed.budget).toBe(7);
  });

  it("подставляет умолчания домена", () => {
    const parsed = allocationDataSchema.parse({ options: ["a", "b"], budget: 5 });
    expect(parsed.minPerOption).toBe(0);
    expect(parsed.maxPerOption).toBe(5);
  });

  it("отвергает бюджет вне 1..1000", () => {
    expect(() => allocationDataSchema.parse({ options: ["a", "b"], budget: 0 })).toThrow();
  });

  it("отвергает меньше двух и больше десяти утверждений", () => {
    expect(() => allocationDataSchema.parse({ options: ["a"], budget: 3 })).toThrow();
  });

  it("тип allocation допустим в insertQuestionSchema", () => {
    expect(() => insertQuestionSchema.shape.type.parse("allocation")).not.toThrow();
  });
});
```

- [ ] **Шаг 2: прогнать — FAIL** (`allocationDataSchema` не экспортируется)

Запуск: `npm test -- shared/__tests__/schema-allocation.test.ts`

- [ ] **Шаг 3: добавить `allocation` в четыре перечисления и схему `dataJson`**

Миграция базы НЕ требуется (FR-01): обе колонки — `text NOT NULL` без `CHECK`.
`maxPerOption` по умолчанию равен бюджету, поэтому умолчание задаётся через `superRefine`/`transform`,
а не `default()` — оно зависит от соседнего поля.

- [ ] **Шаг 4: прогнать — PASS**

- [ ] **Шаг 5: коммит**

```bash
git add shared/schema.ts shared/__tests__/schema-allocation.test.ts
git commit -m "feat(prd-44): dataJson распределения в схеме"
```

### Задача 1.3: чистая модель распределения

Одна модель — один источник арифметики для рендера, готовности ответа, редактора и импорта.

**Файлы:**

- Создать: `shared/questions/allocation.ts`
- Тест: `shared/questions/__tests__/allocation.test.ts`

- [ ] **Шаг 1: написать падающие тесты модели**

```ts
import { describe, expect, it } from "vitest";
import {
  allocationSpec,
  allocationTotal,
  allocationRemaining,
  optionCeiling,
  seedAllocation,
  setAllocationValue,
  isAllocationFeasible,
  isAllocationComplete,
} from "../allocation";

const spec = { options: ["a", "b", "c", "d"], budget: 7, minPerOption: 0, maxPerOption: 7 };

describe("модель распределения", () => {
  it("выполнимость: 4 варианта по минимуму 2 при бюджете 7 невыполнимы", () => {
    expect(isAllocationFeasible({ ...spec, minPerOption: 2 })).toEqual({
      ok: false, required: 8, available: 7, kind: "min",
    });
  });

  it("выполнимость: максимум по варианту не может закрыть бюджет", () => {
    expect(isAllocationFeasible({ ...spec, maxPerOption: 1 })).toEqual({
      ok: false, required: 7, available: 4, kind: "max",
    });
  });

  it("предзаполнение при нулевом минимуме отсутствует", () => {
    expect(seedAllocation(spec)).toEqual({});
  });

  it("предзаполнение ставит минимум каждому варианту", () => {
    const withMin = { ...spec, minPerOption: 1 };
    expect(seedAllocation(withMin)).toEqual({ 0: 1, 1: 1, 2: 1, 3: 1 });
    expect(allocationRemaining(withMin, seedAllocation(withMin))).toBe(3);
  });

  it("доступный максимум варианта равен текущему значению плюс остаток", () => {
    const answer = { 0: 3, 1: 1, 2: 0, 3: 0 };
    expect(allocationRemaining(spec, answer)).toBe(3);
    expect(optionCeiling(spec, answer, 0)).toBe(6);
    expect(optionCeiling(spec, answer, 2)).toBe(3);
  });

  it("превышение бюджета невозможно: ввод срезается по остатку", () => {
    const answer = { 0: 3, 1: 1, 2: 0, 3: 0 };
    expect(setAllocationValue(spec, answer, 2, 99)).toEqual({ 0: 3, 1: 1, 2: 3, 3: 0 });
  });

  it("после первого взаимодействия ответ содержит запись для каждого утверждения", () => {
    expect(setAllocationValue(spec, {}, 1, 2)).toEqual({ 0: 0, 1: 2, 2: 0, 3: 0 });
  });

  it("ввод не опускается ниже минимума", () => {
    const withMin = { ...spec, minPerOption: 1 };
    expect(setAllocationValue(withMin, seedAllocation(withMin), 0, 0)).toEqual({ 0: 1, 1: 1, 2: 1, 3: 1 });
  });

  it("готовность строгая: ровно бюджет", () => {
    expect(isAllocationComplete(spec, { 0: 3, 1: 1, 2: 3, 3: 0 })).toBe(true);
    expect(isAllocationComplete(spec, { 0: 3, 1: 1, 2: 0, 3: 0 })).toBe(false);
    expect(isAllocationComplete(spec, {})).toBe(false);
  });

  it("нечисловой dataJson даёт безопасную спецификацию, а не исключение", () => {
    expect(allocationSpec({ type: "allocation", dataJson: null }).budget).toBe(0);
    expect(allocationTotal({})).toBe(0);
  });
});
```

- [ ] **Шаг 2: прогнать — FAIL**

Запуск: `npm test -- shared/questions/__tests__/allocation.test.ts`

- [ ] **Шаг 3: реализовать модель**

Ключевые правила, повторяющие спеку буквально:

```ts
/** Ceiling of ONE option right now: its own max, bounded by what is still unspent. */
export function optionCeiling(spec: AllocationSpec, answer: AllocationAnswer, index: number): number {
  const current = answer[index] ?? spec.minPerOption;
  return Math.min(spec.maxPerOption, current + allocationRemaining(spec, answer));
}

/** Feasibility (FR-05): the budget must be reachable both from below and from above. */
export function isAllocationFeasible(spec: AllocationSpec): AllocationFeasibility {
  const count = spec.options.length;
  const required = count * spec.minPerOption;
  if (required > spec.budget) return { ok: false, kind: "min", required, available: spec.budget };
  const available = count * spec.maxPerOption;
  if (available < spec.budget) return { ok: false, kind: "max", required: spec.budget, available };
  return { ok: true };
}
```

- [ ] **Шаг 4: прогнать — PASS**

- [ ] **Шаг 5: коммит**

```bash
git add shared/questions/allocation.ts shared/questions/__tests__/allocation.test.ts
git commit -m "feat(prd-44): чистая модель распределения бюджета"
```

### Задача 1.4: вклад в шкалы и домен шкалы

**Файлы:**

- Изменить: `shared/scales/engine.ts`
- Создать: `shared/scales/__tests__/allocation-contribution.test.ts`
- Создать: `shared/scales/__tests__/fixtures/chil-reference.ts`

- [ ] **Шаг 1: зафиксировать контрольное заполнение опросника ЧИЛ**

Фикстура: 14 вопросов по 4 утверждения, бюджет 7, четыре шкалы, 56 вкладов с `value = weight = 1`,
агрегация `sum`, плюс контрольные ответы из `docs/references/Опросник ЧИЛ_V3.6_фин.xlsx`.
Ожидаемый итог зашивается числами: Целеустремленный 34, Вдохновляющий 16, Командный 14, Процессный 34,
сумма 98 (FR-17, приёмка A-02).

- [ ] **Шаг 2: написать падающие тесты вклада и домена**

```ts
import { describe, expect, it } from "vitest";
import { achievableRange, computeAnswerContributions, computeScales } from "../engine";
import { CHIL_ANSWERS, CHIL_MEASUREMENTS, CHIL_SCALES, CHIL_TYPES } from "./fixtures/chil-reference";

const spec = (i: number) => ({
  questionId: "q1", scaleKey: "s", sourceType: "option_allocation" as const,
  sourceKey: String(i), value: 1, weight: 1,
});

describe("вклад распределения", () => {
  it("вклад равен присвоенному баллу, умноженному на коэффициент и вес", () => {
    const out = computeAnswerContributions(
      [{ ...spec(0), value: 2, weight: 1 }], "q1", { 0: 3, 1: 0 }, "allocation",
    );
    expect(out).toEqual([{ scaleKey: "s", delta: 6 }]);
  });

  it("нулевой балл не активирует единицу", () => {
    expect(computeAnswerContributions([spec(1)], "q1", { 0: 3, 1: 0 }, "allocation")).toEqual([]);
  });

  it("домен ограничен бюджетом, а не суммой максимумов вариантов", () => {
    const ms = [spec(0), spec(1), spec(2)];
    const types = { q1: "allocation" as const };
    // budget 7, maxPerOption 7, три варианта у этой шкалы: 3 * 7 = 21, но бюджет 7.
    expect(achievableRange(ms, "sum", types, { q1: { budget: 7, minPerOption: 0, maxPerOption: 7 } }))
      .toEqual({ min: 0, max: 7 });
  });

  it("расчёт на референсе совпадает с итогами файла", () => {
    const { values } = computeScales(CHIL_SCALES, CHIL_MEASUREMENTS, CHIL_ANSWERS, CHIL_TYPES);
    expect(values.cel.raw).toBe(34);
    expect(values.vdo.raw).toBe(16);
    expect(values.kom.raw).toBe(14);
    expect(values.pro.raw).toBe(34);
    expect(values.cel.raw + values.vdo.raw + values.kom.raw + values.pro.raw).toBe(98);
  });
});
```

- [ ] **Шаг 3: прогнать — FAIL**

Запуск: `npm test -- shared/scales/__tests__/allocation-contribution.test.ts`

- [ ] **Шаг 4: ввести общую функцию вклада единицы**

Два пути расчёта не появляются: и `computeAnswerContributions`, и `computeScales` спрашивают одну функцию
(FR-13).

```ts
/**
 * What ONE measurement unit contributes for this answer — `0` when it does not fire.
 *
 * Every source type except `option_allocation` contributes a value the AUTHOR fixed
 * (`value * weight`); an allocation contributes the amount the LEARNER assigned, scaled
 * by the same coefficients (PRD-44 FR-12). Both call sites go through here so the two
 * cannot drift.
 */
export function unitContribution(m: MeasurementSpec, answer: Answer, qType: QuestionType | undefined): number {
  if (!isActive(m, answer, qType)) return 0;
  if (m.sourceType === "option_allocation") {
    const assigned = (answer as Record<string, number>)[String(Number(m.sourceKey))] ?? 0;
    return assigned * m.value * m.weight;
  }
  return m.value * m.weight;
}
```

В `isActive` — ветка источника:

```ts
  if (m.sourceType === "option_allocation") {
    if (typeof answer !== "object" || Array.isArray(answer)) return false;
    const assigned = (answer as Record<string, number>)[String(Number(m.sourceKey))];
    return typeof assigned === "number" && assigned !== 0;
  }
```

- [ ] **Шаг 5: ветка домена шкалы**

`achievableRange` получает дополнительный параметр — спецификации бюджета по вопросам. Верхняя граница
вопроса-распределения ограничена бюджетом, потому что варианты делят общий бюджет (FR-15):

```ts
    if (distributesBudget(questionTypes[questionId] ?? "")) {
      const b = budgets?.[questionId];
      const coeffs = ms.map((m) => m.value * m.weight);
      const lo = (b?.minPerOption ?? 0) * coeffs.filter((c) => c > 0).length;
      const hiUnits = Math.min(b?.budget ?? 0, (b?.maxPerOption ?? 0) * ms.length);
      mins.push(Math.min(0, ...coeffs.map((c) => c * (b?.budget ?? 0))) === 0 ? lo * 0 : lo);
      maxes.push(hiUnits * Math.max(0, ...coeffs));
    } else if (isSingleIndexChoice(...)) { ... }
```

Точная арифметика уточняется тестом из шага 2; параметр `budgets` объявляется НЕОБЯЗАТЕЛЬНЫМ, чтобы
существующие вызовы `achievableRange` (нормализация в проценты, домен PRD-29) компилировались без правок,
и добавляется в каждый вызов отдельным шагом задачи 1.5.

- [ ] **Шаг 6: прогнать — PASS**

- [ ] **Шаг 7: прогнать соседние тесты движка шкал на регресс**

Запуск: `npm test -- shared/scales`
Ожидание: PASS, включая `achievable-range.test.ts` и `engine.test.ts`.

- [ ] **Шаг 8: коммит**

```bash
git add shared/scales
git commit -m "feat(prd-44): вклад распределения и домен шкалы"
```

### Задача 1.5: протянуть бюджеты в вызовы домена

**Файлы:**

- Изменить: `shared/scales/engine.ts` (`rawRange`), `server/services/result-compute.ts`,
  места вычисления домена PRD-29

- [ ] **Шаг 1: найти все вызовы `achievableRange`**

Запуск: `npm test -- shared/scales` не поймает пропуск — искать вызовы поиском по коду и закрыть каждый.

- [ ] **Шаг 2: написать тест на смешанный тест**

Тест по риску R-3: тест из вопроса-распределения И обычного одиночного выбора, нормализация `percent`;
проверяется, что процент не выходит за 0..100 и что маркер уровня попадает в свою полосу.

- [ ] **Шаг 3: передать бюджеты во всех вызовах, прогнать, закоммитить**

```bash
git commit -am "fix(prd-44): бюджеты вопросов в домене шкалы на всех вызовах"
```

### Задача 1.6: JS-двойник движка шкал

**Файлы:**

- Изменить: `server/scorm/template/app/scales/engine.js`

- [ ] **Шаг 1: прогнать golden-тест паритета и увидеть расхождение**

Запуск: `npm test -- shared/scales`
Ожидание: FAIL golden-теста, потому что в двойнике нет источника `option_allocation`.

- [ ] **Шаг 2: перенести правки задачи 1.4 в двойник дословно**

- [ ] **Шаг 3: прогнать — PASS. Коммит**

```bash
git add server/scorm/template/app/scales/engine.js
git commit -m "feat(prd-44): паритет двойника движка шкал"
```

---

## Фаза 2. Дизайн-система

### Задача 2.1: составной компонент `BudgetAllocation`

**Файлы:**

- Создать: `vendor/ui-kit/src/components/BudgetAllocation.tsx`
- Создать: `vendor/ui-kit/src/components/BudgetAllocation.stories.tsx`
- Изменить: `vendor/ui-kit/src/index.ts`, `vendor/ui-kit/css/university-rt.css`
- Изменить: `client/src/styles/vendor/university-rt.css` (ВТОРАЯ копия, FR-59)

- [ ] **Шаг 1: собрать компонент из существующих примитивов**

Строка утверждения = `Slider` + `NumberInput`, синхронные между собой; над группой — счётчик остатка.
Локальный шим вместо правки `vendor/ui-kit` недопустим: зависимость редактируемая.
Классы: `.ou-alloc`, `.ou-alloc__counter`, `.ou-alloc__row`, `.ou-alloc__label`, `.ou-alloc__slider`,
`.ou-alloc__field` — те же имена потом повторяет framework-free двойник (FR-58).

- [ ] **Шаг 2: сверить каждый класс `ou-*` по `university-rt.css`**

Контролёр НЕ ловит несуществующий класс дизайн-системы — сверять глазами по бандлу.

- [ ] **Шаг 3: стори с тремя состояниями (пустое, частичное, полное) и с ненулевым минимумом**

- [ ] **Шаг 4: правки CSS внести в ОБЕ копии бандла**

- [ ] **Шаг 5: коммит**

```bash
git add vendor/ui-kit client/src/styles/vendor
git commit -m "feat(ui-kit): составной компонент BudgetAllocation"
```

---

## Фаза 3. Экран учащегося

### Задача 3.1: `renderAllocation`

**Файлы:**

- Изменить: `shared/template/question-interaction.ts`
- Тест: `shared/template/__tests__/question-interaction.allocation.test.ts`

- [ ] **Шаг 1: тест-снимок разметки**

Проверяется: число строк равно числу утверждений; каждая строка несёт `data-index` (сверка DOM с данными
идёт по индексам, не по тексту); доступный максимум ползунка равен `optionCeiling`; счётчик остатка —
область `aria-live`; при нулевом остатке текст «Вы использовали все баллы»; в режиме обзора разметка
только для чтения и БЕЗ классов верности (FR-33).

- [ ] **Шаг 2: прогнать — FAIL**

- [ ] **Шаг 3: реализовать `renderAllocation` и подсказку типа**

Подсказка (FR-32) зависит от бюджета, поэтому `questionHint` получает второй, необязательный аргумент —
вопрос; существующие вызовы с одним аргументом продолжают работать.

Доступность (FR-34) закладывается сразу, а не «потом»: у каждой пары «ползунок и поле» — `aria-label`
из текста утверждения, ползунок отзывается на стрелки и `Home`/`End`, счётчик остатка объявлен областью
`aria-live`, чтобы изменение остатка озвучивалось экранным диктором.

Размер подписи утверждения берётся ТОЛЬКО из `--tb-answer-fs` и нигде не задаётся литералом (FR-35).
Переменную ставят два общих прохода, и оба обязаны работать для нового типа:

- длиновой — `optionFont(answerTexts(question))` до рендера; он уже видит утверждения, потому что они
  лежат в `dataJson.options` (FR-02). Заперто тестом
  `shared/template/__tests__/question-interaction.allocation-font.test.ts`;
- рантаймовый по высоте — `fitQuestionScene` после рендера. Он измеряет переполнение поля и от типа не
  зависит, но литерал в разметке отнял бы у него единственный рычаг. Проверяется на браузерной приёмке
  A-04: длинные утверждения не должны прокручивать поле.

- [ ] **Шаг 4: прогнать — PASS. Коммит**

### Задача 3.2: живой ввод без пересборки узлов

**Файлы:**

- Создать: `shared/template/allocation-dom.ts`
- Изменить: `client/src/components/template-screen.tsx`

- [ ] **Шаг 1: понять ограничение и записать его в тест**

Ползунок дизайн-системы — не нативный `input[type=range]`, а собственный узел с обработчиками указателя.
Полная перерисовка разметки на каждое движение уничтожает узел, за который держится палец, и жест рвётся.
Поэтому: во время жеста DOM патчится на месте (`syncAllocationDom`), а ответ уходит в состояние хоста
по завершении ввода. Тест на jsdom: после `syncAllocationDom` значения полей и текст счётчика обновлены,
а сами узлы — те же (сравнение по ссылке).

- [ ] **Шаг 2: реализовать `syncAllocationDom` и делегирование ввода**

`TemplateScreen` уже делегирует `click` и `change`; добавляется делегирование `input` по атрибуту
`data-input` с тем же форматом действия `"<ключ>=<значение>"`.

- [ ] **Шаг 3: прогнать, коммит**

### Задача 3.3: готовность ответа

**Файлы:**

- Изменить: `client/src/pages/learner/answer-gate.ts`
- Изменить: `server/scorm/template/app/actions/answers.js`
- Тест: `client/src/pages/learner/__tests__/answer-gate.test.ts`

- [ ] **Шаг 1: падающий тест**

```ts
const q = { type: "allocation", dataJson: { options: ["a", "b"], budget: 4, minPerOption: 0, maxPerOption: 4 } };

it("нетронутый вопрос не отвечен", () => expect(hasAnswer(q, undefined)).toBe(false));
it("частичное распределение не отвечено", () => expect(hasAnswer(q, { 0: 1, 1: 0 })).toBe(false));
it("ровно бюджет — отвечен", () => expect(hasAnswer(q, { 0: 1, 1: 3 })).toBe(true));
```

- [ ] **Шаг 2: прогнать — FAIL** (ветка `default` возвращает `true` для объекта)

- [ ] **Шаг 3: добавить ЯВНУЮ ветку `case "allocation"` через `isAllocationComplete`**

- [ ] **Шаг 4: зеркалить в рантайме пакета, прогнать, коммит**

### Задача 3.4: подключение обоих хостов

**Файлы:**

- Изменить: `client/src/pages/learner/template-question-screen.tsx`
- Изменить: `client/src/pages/learner/take-test.tsx`
- Создать: `server/scorm/template/app/render/questions/allocation.js`
- Изменить: `server/scorm/template/app/render/questions/index.js`,
  `server/scorm/template/app/utils/shuffle.js`, `server/scorm/template/app/feedback/feedback.js`,
  `server/scorm/template/app/adaptive/adaptive.js`, `server/scorm/template/app/render/adaptiveRender.js`,
  `server/scorm/template/app/render/resultsPage.js`
- Изменить: `server/scorm/templates/<id>/styles/theme.css` (узкий экран, FR-36)

- [ ] **Шаг 1: пройти по таблицам 0.2 и 0.3 строка за строкой**

Каждая строка закрывается правкой или явной записью «правка не нужна, потому что…» прямо в этом плане.

- [ ] **Шаг 2: тест побайтового совпадения разметки обоих хостов**

Тот же тест, что для остальных типов: обёртка пакета не имеет собственной разметки, а зовёт
`TBTemplate.renderAllocation`.

- [ ] **Шаг 3: запись взаимодействия FR-54**

Тип `other`, `learner_response` вида `0[.]3,1[.]1,2[.]1,3[.]2`. Тип `numeric` не подходит — ответ векторный.

- [ ] **Шаг 4: прогнать веб-тесты прохождения, коммит**

Запуск: `npm test -- client/src/pages/learner`

### Задача 3.5: браузерная приёмка веб-прохождения (A-04)

- [ ] **Шаг 1: поднять второй экземпляр dev на своём порту**

Серверные правки не подхватываются живым dev: `PORT=8099 npm run dev`.

- [ ] **Шаг 2: пройти вопрос-распределение в браузере**

Проверить: распределение ползунком и полем, счётчик остатка, невозможность перебора, блокировку отправки
при недоборе, узкий экран. Скриншоты сверить с эскизом фазы 0 по каждой детали.

---

## Фаза 4. Редактор

### Задача 4.1: карточка вопроса

**Файлы:**

- Изменить: `client/src/features/questions/question-editor-drawer.tsx`
- Изменить: `server/routes/questions.ts`
- Тест: `client/src/features/questions/__tests__/question-editor-drawer.allocation.test.tsx`

- [ ] **Шаг 1: падающие тесты** — пункт «Распределение баллов» в списке типов; три поля; скрытый блок
      верного ответа; сообщение о невыполнимости называет числа («нужно минимум 8 баллов, доступно 7»).
- [ ] **Шаг 2: реализация, включая перенос подписей при смене типа (FR-49)**
- [ ] **Шаг 3: серверная валидация FR-04 и FR-05 на сохранении**
- [ ] **Шаг 4: прогон, коммит**

### Задача 4.2: вкладка «Вклады вопросов»

**Файлы:**

- Изменить: `client/src/features/tests/editor/scales-api.ts`
- Изменить: `client/src/features/tests/editor/sections/scales-section.tsx`

- [ ] **Шаг 1: падающий тест** — утверждения вопроса-распределения показываются как варианты, ячейка
      подписана коэффициентом, а не фиксированным вкладом; при вкладе от распределения показывается
      предупреждение о связанности шкал (FR-48).
- [ ] **Шаг 2: реализация, прогон, коммит**

### Задача 4.3: предпросмотр, фильтры, конструктор цены

**Файлы:**

- Изменить: `client/src/features/content/question-preview.tsx`,
  `client/src/features/content/content-filters.tsx`,
  `client/src/features/tests/editor/sections/scoring-builder.tsx`,
  `server/utils/scoring-excel.ts`

- [ ] **Шаг 1: тесты и реализация по строкам таблицы 0.5, коммит**

---

## Фаза 5. Книга импорта и экспорта

### Задача 5.1: лист «Вопросы»

**Файлы:**

- Изменить: `server/services/questions-import.ts`, `server/services/questions-export.ts`,
  `server/services/workbook-import.ts`, `server/services/workbook-template.ts`

- [ ] **Шаг 1: падающие тесты** — три новые колонки; пустые «Минимум»/«Максимум» дают умолчания FR-04;
      заполненные колонки у другого типа — предупреждение; заполненные «Номера правильных ответов» —
      ошибка строки; невыполнимая конфигурация отвергается с числами (FR-40).
- [ ] **Шаг 2: реализация, прогон, коммит**

### Задача 5.2: лист «Вклады вопросов» и справка

- [ ] **Шаг 1: источник `распределение`, ключ — индекс утверждения с нуля, умолчания `value = weight = 1`**
- [ ] **Шаг 2: шаблон книги и лист-справка: описание типа, колонок, источника, строка примера**
- [ ] **Шаг 3: прогон, коммит**

### Задача 5.3: приёмочный импорт опросника ЧИЛ (A-03)

- [ ] **Шаг 1: собрать книгой опросник целиком** — 14 вопросов по 4 утверждения, бюджет 7,
      четыре шкалы с агрегацией «сумма», 56 строк вкладов с коэффициентом 1.
- [ ] **Шаг 2: импортировать без ошибок, выгрузить обратно, сверить бюджет, домен и вклады**

---

## Фаза 6. Ведущая и слабая шкала

### Задача 6.1: рейтинг шкал

**Файлы:**

- Создать: `shared/formula/scale-rank.ts`
- Создать: `shared/formula/__tests__/scale-rank.test.ts`

- [ ] **Шаг 1: падающие тесты**

Рейтинг строится по НОРМАЛИЗОВАННОМУ значению (FR-20); шкалы без значения не входят; ничья
разрешается авторским порядком шкал теста (FR-21); `tiedCount` и `margin` считаются (FR-22);
пустой рейтинг и место больше числа шкал дают `null` (FR-23). Контрольный случай ничьей берётся
из референса: два стиля по 34 балла.

- [ ] **Шаг 2: реализация, прогон, коммит**

### Задача 6.2: источники в языке формул

**Файлы:**

- Изменить: `shared/formula/tokens.ts`, `parser.ts`, `types.ts`, `evaluator.ts`, `validate.ts`

- [ ] **Шаг 1: падающие тесты парсера и вычислителя**

Форма `topScale(["cel","vdo"], 1).key` повторяет существующий `countScales([...], "level")`,
расширенный доступом к свойству. Свойства: `key`, `label`, `value`, `margin`, `tiedCount` (FR-19).

- [ ] **Шаг 2: реализация, включая авторский порядок шкал в контексте**

Порядок нужен для правила ничьей. `EvalContext` получает НЕОБЯЗАТЕЛЬНОЕ поле `scaleOrder: string[]`;
при его отсутствии порядок берётся из ключей `ctx.scales` — он совпадает с авторским, потому что
`computeScales` заполняет результат, перебирая шкалы в порядке `sort_order`.

- [ ] **Шаг 3: валидация FR-24**

Неизвестный ключ шкалы — ошибка. Проверка «строковый показатель возвращает только объявленные коды
исходов» на свойстве `key` НЕ работает (код приходит из данных, а не литералом) — здесь ПРЕДУПРЕЖДЕНИЕ
с подсказкой «ключи шкал должны совпадать с кодами исходов показателя», а не ошибка.

- [ ] **Шаг 4: прогон, коммит**

### Задача 6.3: двойник языка формул

**Файлы:**

- Изменить: `server/scorm/template/app/dsl/formula.js`

- [ ] **Шаг 1: прогнать golden-корпус PRD-2 и увидеть расхождение**
- [ ] **Шаг 2: перенести правки дословно, прогнать — PASS, коммит**

---

## Фаза 7. Смежное и приёмка

### Задача 7.1: аналитика и инспектор

**Файлы:**

- Изменить: `server/routes/analytics/attempts.ts`, `server/routes/analytics/helpers.ts`,
  `client/src/pages/author/analytics.tsx`,
  `server/scorm/debug-player/assets/inspector-compute.js`,
  `client/src/features/tests/debug-player/debug-player-page.tsx`

- [ ] **Шаг 1: среднее распределение бюджета по утверждениям; показатели верности не применяются (FR-51)**
- [ ] **Шаг 2: инспектор PRD-18 — вектор во вкладках «Протокол» и «Выдача», вклад во вкладке «Шкалы»,
      поле верности пустое (FR-52)**
- [ ] **Шаг 3: прогон, коммит**

### Задача 7.2: снапшоты и предпросмотр шаблона

- [ ] **Шаг 1: тест FR-53** — новая форма `dataJson` переносится в снапшот и УЧАСТВУЕТ в `content_hash`.
      Это фиксируется тестом, а не предполагается.
- [ ] **Шаг 2: демонстрационный вопрос-распределение в `shared/template/preview-context.ts` (FR-55)**
- [ ] **Шаг 3: прогон, коммит**

Отчёт по попытке PRD-27 (FR-56) правок НЕ требует: он строится на шкалах и показателях, а ведущая и слабая
шкала приходят к нему через показатели фазы 6. Это записано здесь, чтобы отсутствие правки было решением,
а не пропуском.

### Задача 7.3: приёмка

- [ ] **A-05: SCORM.** Собрать пакет, пройти в локальном плеере (`npm run scorm:player`) и на стенде
      WebTutor; сверить побайтовое совпадение разметки с веб-хостом и запись взаимодействия FR-54.
- [ ] **A-06: тестовый прогон PRD-18.** Вопрос виден в инспекторе, вклад в шкалы совпадает с серверным
      расчётом.
- [ ] **A-07: паритет двойников.** Golden-тесты движка шкал и языка формул зелёные.
- [ ] **A-08: покрытие.** `npm run test:cov` — порог 80% не падает. Прогон ТОЛЬКО по явному разрешению
      и в одиночку: покрытие чистит общий каталог, параллельный запуск даёт ложное падение порога.
- [ ] **Актуализировать статус PRD-44 и запись в `docs/ROADMAP.md`**

---

## Правила ведения работы

- Полный прогон тестов — только по явному разрешению владельца. В работе точечно: `npm test -- <путь>`.
- Индекс git общий на сессии: перед коммитом сверять `git diff --cached`, чужие файлы не коммитить.
- Сверка DOM с данными — только по индексам (`data-index`), никогда по тексту: типографика ломает
  сравнение по строкам.
- Правки CSS дизайн-системы вносятся в ОБЕ копии бандла, иначе правило не доедет до приложения.
