# PRD-51, этап Э4: отчёт шаблона «Сертификация»

> **Исполнителю:** ОБЯЗАТЕЛЬНЫЙ ПОДНАВЫК: вести работу по этому плану задача за задачей
> через `superpowers:subagent-driven-development` или `superpowers:executing-plans`.
> Шаги помечены чекбоксами (`- [ ]`) для отметки готовности.

**Статус: ВЫПОЛНЕН.** Этап Э4 реализован, принят и влит в `main` 2026-08-16 (последний коммит трека
`e272cb2f`), приёмка — [отчёт](../reports/prd51-e4-acceptance.md). Все 47 пунктов отмечены
выполненными проходом актуализации 2026-09-01: план исполнялся прямо в сессии, а не через
`executing-plans`, поэтому построчных отметок по ходу работы не ставилось — свидетельством
исполнения служат отчёт приёмки и код, а не чекбоксы.

**Цель:** шаблон «Сертификация» печатает отчёт документом из блоков по §10.1 спецификации
с метриками §10.3, а гард паритета продолжает стеречь 17 раскладок ученических экранов.

**Подход:** «Сертификация» получает СВОЙ комплект раскладок отчёта (оболочка + блоки) в
каталоге `layouts/report/`, своё объявление `reportDocument` и переписанный
`styles/report.css` — светлый документ вместо тёмного. Ученические экраны остаются
побайтовыми копиями эталона: из-под правила выводится ТОЛЬКО семейство отчёта, и выводится
по виду (`report`, `report.adaptive`, `report.block`), а не перечнем ключей.

**Технологии:** мустач-подмножество `shared/template/dsl.ts`, движок сборки документа
`shared/report/render-report.ts`, vitest, `chrome-headless-shell` для растровой сверки.

**Спецификация:** `docs/specs/prd-51/report-document-blocks.md` §10.
**Эскиз (утверждён):** `docs/wireframes/prd51-certification-report.html`, состояния
`s-pass` и `s-fail`.

---

## Решения, принятые этим планом

Три решения не выводятся из спецификации однозначно. Они приняты здесь и подлежат
согласованию ДО начала работ.

### Р-1. Имена классов берутся у ЭТАЛОНА, а не из эскиза

Эскиз рисует лист бумаги и завёл под него свои имена: `tb-report__block`,
`tb-report__counter`, `tb-report__pill`, `tb-report__list`. У эталона те же сущности
называются `tb-report__topic-group`, `tb-report__topic-group-counter`,
`tb-report__topic-verdict`, `tb-report__breakdown`.

Раскладки «Сертификации» берут ИМЕНА ЭТАЛОНА и меняют только облик — в `styles/report.css`.
Причина: имена классов отчёта — общий словарь двух шаблонов, по которому написан гард
селекторов (`tests/template-layout-parity.test.ts`), и разойдясь в именах, «Сертификация»
потеряла бы проверку на пропущенные правила PRD-50. Вид на бумаге от этого не меняется:
эскиз задаёт ОБЛИК, а не разметку.

Исключение — узлы, которых у эталона нет вовсе: полотно титула (`tb-report__cover`),
карточка вердикта (`tb-report__card--verdict`), знак исхода (`tb-report__mark`), место
иллюстрации (`tb-report__decor`), колонки авторской страницы (`tb-report__cols-2`,
`tb-report__cols-3`), врезка (`tb-report__note`). Они заводятся с именами эскиза.

### Р-2. Из-под паритета выводится ВСЁ семейство отчёта, а не только блоки

Сегодня гард исключает варианты `report.block`. Этого мало: «Сертификации» нужно СВОЁ поле
оболочки — иллюстрация титула (`coverImage`), а `settings[]` вида `report` гард сравнивает
с эталоном. Объявить это поле у эталона значило бы завести настройку без слота за ней —
ровно тот дефект, ради которого гард настроек и писался (см. его комментарий про PRD-29).

Поэтому `isReportVariant` расширяется до всего семейства: `report`, `report.adaptive`,
`report.block`. Формулировка §10.4 это и предполагает: «ВСЁ, что относится к отчёту, —
оболочка и раскладки блоков — выводится из-под правила».

### Р-3. Варианты авторской страницы у «Сертификации» СВОИ и их три

Эталон даёт один вариант страницы («Заголовок и текст»). «Сертификации» по §10.1 нужны три:
одна колонка, две, три. Это законно: состав вариантов блока — дело шаблона, и гард ключей
их не сравнивает (Р-2). Тест, переехавший с «Сертификации» на эталон, деградирует к
умолчанию блока `page` и печатает свой текст одной колонкой — работа автора не теряется.

---

## Структура файлов

**Создаются** (все пути от корня репозитория):

| Файл | Ответственность |
| --- | --- |
| `templates/certification/layouts/report/shell.html` | Оболочка документа: лист, фон, логотип |
| `templates/certification/layouts/report/header.html` | Титул: полотно, название, карточка вердикта со знаком исхода, ФИО, дата |
| `templates/certification/layouts/report/intro.html` | Обращение к слушателю внутри полотна титула |
| `templates/certification/layouts/report/summary.html` | Сводка баллов, светлая карточка |
| `templates/certification/layouts/report/topics.html` | Блоки разделов: шапка со счётчиком, строки тем с пилюлей и разрезами |
| `templates/certification/layouts/report/breakdown.html` | Сводный разрез |
| `templates/certification/layouts/report/scales.html` | Шкалы |
| `templates/certification/layouts/report/indicators.html` | Показатели |
| `templates/certification/layouts/report/recommendations.html` | Рекомендации |
| `templates/certification/layouts/report/courses.html` | Курсы |
| `templates/certification/layouts/report/events.html` | Мероприятия |
| `templates/certification/layouts/report/page-text.html` | Авторская страница: заголовок и текст |
| `templates/certification/layouts/report/page-cols-2.html` | Авторская страница: две колонки |
| `templates/certification/layouts/report/page-cols-3.html` | Авторская страница: три колонки |
| `templates/certification/layouts/report/adaptive/*.html` | Девять адаптивных раскладок + оболочка |
| `tests/certification-report-document.test.ts` | Гард документа «Сертификации»: состав, привязки, области |
| `docs/reports/prd51-e4-acceptance.md` | Отчёт приёмки |

**Изменяются:**

| Файл | Что меняется |
| --- | --- |
| `templates/certification/manifest.json` | 22 варианта `report.block`, `reportDocument` на оба вида, поле оболочки `coverImage`, версия 1.10.0 |
| `templates/certification/styles/report.css` | Светлый документ: лист, полотно, карточки, пилюли, разрезы, колонки |
| `tests/template-layout-parity.test.ts` | `isReportVariant` расширен до семейства; `report.html`/`report.adaptive.html` выведены из побайтового сравнения |
| `tests/report-shipped-templates.test.ts` | Проверки распространяются на «Сертификацию» |

**Не трогаются:** `shared/report/*` (движок готов), `server/scorm/*` (сборка готова),
`client/src/features/tests/editor/*` (редактор готов). Э4 — работа ТОЛЬКО в шаблоне.

---

## Task 1: Вывести семейство отчёта из-под паритета

Первой задачей, иначе любая следующая правка манифеста роняет гард и работа идёт по
красному.

**Files:**

- Modify: `tests/template-layout-parity.test.ts:163-164` (`isReportVariant`)
- Modify: `tests/template-layout-parity.test.ts:82-95` (побайтовое сравнение раскладок)

- [x] **Шаг 1: Написать падающий тест правила исключения**

В `tests/template-layout-parity.test.ts` добавить в конец файла:

```ts
describe("PRD-51 §10.4: из-под паритета выведено ВСЁ семейство отчёта", () => {
  const cert = JSON.parse(fs.readFileSync(path.join(CERT_DIR, "manifest.json"), "utf8"));

  it("гард стережёт РОВНО 17 раскладок ученических экранов", () => {
    // Девятнадцать минус две раскладки отчёта. Число названо явно: молчаливое
    // сокращение списка — это и есть та регрессия, ради которой гард заведён.
    expect(htmlIn(DEFAULT_LAYOUTS).filter((f) => !f.startsWith("report."))).toHaveLength(17);
  });

  it("«Сертификация» вправе объявить своё поле оболочки отчёта", () => {
    const shell = cert.contentTemplates.find((t: { key: string }) => t.key === "report.standard");
    expect(shell.settings.map((s: { key: string }) => s.key)).toContain("coverImage");
  });
});
```

- [x] **Шаг 2: Прогнать — падает**

```bash
npm test -- tests/template-layout-parity.test.ts
```

Ожидание: FAIL — «Сертификация» поля `coverImage` пока не объявляет, а раскладок под
гардом 19.

- [x] **Шаг 3: Расширить правило исключения**

Заменить `isReportVariant` (строки 163-164):

```ts
  /**
   * PRD-51 §10.4 (решение Р-2 плана Э4): из-под паритета выведено ВСЁ семейство отчёта —
   * оболочка, её поля и раскладки блоков.
   *
   * Одних блоков мало: «Сертификации» нужно СВОЁ поле оболочки (иллюстрация титула), а
   * `settings[]` вида `report` гард сравнивает с эталоном. Объявить это поле у эталона
   * значило бы завести настройку без слота за ней — ровно тот дефект, ради которого гард
   * настроек и писался.
   *
   * Исключение снимается по ВИДУ, а не перечнем ключей: число раскладок блоков будет
   * меняться, и перечень протух бы на первой же правке шаблона.
   */
  const REPORT_KINDS = new Set(["report", "report.adaptive", "report.block"]);
  const isReportVariant = (t: { key: string; kind?: string }): boolean =>
    REPORT_KINDS.has(String(t.kind)) || t.key.startsWith("report.");
```

- [x] **Шаг 4: Вывести раскладки отчёта из побайтового сравнения**

Заменить тело `describe("certification layouts track the standard template", …)`
(строки 79-94):

```ts
describe("certification layouts track the standard template", () => {
  /**
   * PRD-51 §10.4: `report.html` и `report.adaptive.html` из сравнения выведены — у
   * «Сертификации» свой документ (§10.1). Под гардом остаются 17 раскладок УЧЕНИЧЕСКИХ
   * экранов: именно там он ловит расхождения контракта рантайма, ради которых заводился.
   *
   * Каталог `layouts/report/` сюда не попадает и без фильтра: `htmlIn` читает только
   * верхний уровень. Фильтр назван явно, чтобы правило было видно, а не выводилось из
   * особенности чтения каталога.
   */
  const isReportLayout = (f: string): boolean => f.startsWith("report.");
  const standardFiles = htmlIn(DEFAULT_LAYOUTS).filter((f) => !isReportLayout(f));

  it("declares every learner-screen layout the standard template ships, and no others", () => {
    expect(htmlIn(CERT_LAYOUTS).filter((f) => !isReportLayout(f))).toEqual(standardFiles);
  });

  for (const file of standardFiles) {
    it(`${file} matches the standard layout (modulo intended deltas)`, () => {
      const standard = fs.readFileSync(path.join(DEFAULT_LAYOUTS, file), "utf8");
      const cert = fs.readFileSync(path.join(CERT_LAYOUTS, file), "utf8");
      expect(lf(cert)).toBe(expectedCertLayout(file, standard));
    });
  }
});
```

- [x] **Шаг 5: Прогнать — второй тест всё ещё падает**

```bash
npm test -- tests/template-layout-parity.test.ts
```

Ожидание: тест про 17 раскладок ЗЕЛЁНЫЙ, тест про `coverImage` красный — поле появится
в задаче 3. Это ожидаемое промежуточное состояние: правило исключения готово, объявление
ещё нет.

- [x] **Шаг 6: Коммит**

```bash
git add tests/template-layout-parity.test.ts
git commit -m "test(prd-51): семейство отчёта выведено из-под паритета шаблонов"
```

---

## Task 2: Светлый лист документа

CSS идёт ДО раскладок: раскладка без стилей выглядит сломанной, и сверять её с эскизом
нечем. Метрики — из §10.3 спецификации и таблицы эскиза.

**Files:**

- Modify: `templates/certification/styles/report.css`

- [x] **Шаг 1: Написать падающий тест метрик**

Создать `tests/certification-report-document.test.ts`:

```ts
/**
 * @module tests/certification-report-document
 *
 * PRD-51 Э4 — ДОКУМЕНТ ОТЧЁТА шаблона «Сертификация» (FR-22).
 *
 * Пиннятся метрики, снятые с референса (§10.3), и привязки раскладок к данным. Облик
 * проверяется растром в приёмке; здесь — то, что растр не покажет: если полотно титула
 * перестанет быть белым, снимок это увидит, а вот подмену `course.title` на статику —
 * нет.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const CERT = path.join(process.cwd(), "templates", "certification");
const css = fs.readFileSync(path.join(CERT, "styles", "report.css"), "utf8");

describe("лист документа «Сертификации» светлый", () => {
  it("фон листа — серый референса, а не тёмный эталона", () => {
    expect(css).toMatch(/\.tb-report\s*\{[^}]*background:\s*#E2E2E2/i);
  });

  it("полотно титула белое и скруглённое", () => {
    expect(css).toMatch(/\.tb-report__cover\s*\{[^}]*background:\s*#FFFFFF/i);
  });

  it("карточка вердикта тёмная — единственный тёмный узел документа", () => {
    expect(css).toMatch(/\.tb-report__card--verdict\s*\{[^}]*background:\s*#101828/i);
  });

  it("бейдж счётчика оранжевый", () => {
    expect(css).toMatch(/\.tb-report__topic-group-counter\s*\{[^}]*background:\s*#FF4F12/i);
  });

  it("цвета исхода объявлены оба", () => {
    expect(css).toContain("#FF4F12");
    expect(css).toContain("#19D7A4");
  });
});
```

- [x] **Шаг 2: Прогнать — падает**

```bash
npm test -- tests/certification-report-document.test.ts
```

Ожидание: FAIL на первом же тесте — сегодняшний `report.css` «Сертификации» тёмный.

- [x] **Шаг 3: Переписать `styles/report.css`**

Файл переписывается целиком. Правила эталона сохраняются ВСЕ (их стережёт гард
селекторов), меняются только значения; ниже добавляются правила узлов, которых у эталона
нет. Каркас документа:

```css
/* ─── Лист ────────────────────────────────────────────────────────────────── */
.tb-report {
  width: 595px;
  min-height: 842px;
  padding: 13px 15px;
  background: #E2E2E2;
  color: #101828;
  font: 400 11px/1.45 var(--tb-font-body, "Basis Grotesque Pro", system-ui, sans-serif);
}

/* Полотно титула: белая скруглённая плита, на которой стоит вся первая страница. */
.tb-report__cover {
  position: relative;
  padding: 20px 15px;
  border-radius: 12px;
  background: #FFFFFF;
  overflow: hidden;
}

/* Карточка вердикта — единственный тёмный узел документа: он и притягивает взгляд. */
.tb-report__card--verdict {
  margin: 36px;
  padding: 24px;
  border-radius: 10px;
  background: #101828;
  color: #FFFFFF;
}
.tb-report__card--verdict .tb-report__headline { border-top: 1px solid rgba(255,255,255,.16); }
.tb-report__card--verdict .tb-report__learner { border-top: 1px solid rgba(255,255,255,.16); }

/* Знак исхода: цвет берётся от класса вердикта на КОРНЕ документа. */
.tb-report__mark { font-size: 28px; line-height: 1; }
.tb-report.is-pass .tb-report__mark { color: #19D7A4; }
.tb-report.is-fail .tb-report__mark { color: #FF4F12; }

/* ─── Карточка блока разделов ─────────────────────────────────────────────── */
.tb-report__topic-group {
  margin-bottom: 10px;
  border: 1px solid #D8D8D8;
  border-radius: 8px;
  background: #F7F7F7;
  overflow: hidden;
}
.tb-report__topic-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 59px;
  padding: 0 22px;
  background: #E2E2E2;
}
.tb-report__topic-group-counter {
  min-width: 50px;
  height: 31px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: #FF4F12;
  color: #FFFFFF;
  font-weight: 600;
}

/* Строка раздела: высота по содержимому, разделитель — волосяная линия. */
.tb-report__topic {
  min-height: 83px;
  padding: 14px 22px;
  border-top: 1px solid #E2E2E2;
}
.tb-report__topic-verdict {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 10px;
}
.tb-report.is-pass .tb-report__topic-verdict { background: rgba(25,215,164,.16); color: #0B7A5E; }
.tb-report.is-fail .tb-report__topic-verdict { background: rgba(255,79,18,.14); color: #C23A0C; }

/* Полоса разреза: реальная доля плюс значение (§10.2 — решение владельца). */
.tb-report__breakdown {
  display: grid;
  grid-template-columns: repeat(3, 76px);
  gap: 0 30px;
}
.tb-report__breakdown-bar {
  height: 5px;
  border-radius: 3px;
  background: #E2E2E2;
  overflow: hidden;
}
.tb-report__breakdown-bar > span { display: block; height: 100%; background: #FF4F12; }
.tb-report.is-pass .tb-report__breakdown-bar > span { background: #19D7A4; }

/* ─── Авторская страница ──────────────────────────────────────────────────── */
.tb-report__cols-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.tb-report__cols-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.tb-report__note {
  padding: 14px;
  border-radius: 8px;
  background: #F7F7F7;
  border: 1px solid #E2E2E2;
}
.tb-report__col-title { font-weight: 600; margin: 0 0 6px; }

/* Место иллюстрации оболочки: не рисует ничего, пока автор не подставил файл. */
.tb-report__decor { position: absolute; right: 0; bottom: 0; width: 240px; height: 240px; }
```

Остальные правила (карточки, метрики, рекомендации, курсы, мероприятия, шкалы,
показатели, разрезы PRD-50) переносятся из сегодняшнего `templates/certification/styles/report.css`
с заменой тёмной палитры на светлую: фон карточки `#F7F7F7`, текст `#101828`, рамка
`#D8D8D8`. Ни один селектор не удаляется — их стережёт гард.

- [x] **Шаг 4: Прогнать оба гарда**

```bash
npm test -- tests/certification-report-document.test.ts tests/template-layout-parity.test.ts
```

Ожидание: тесты метрик зелёные; гард селекторов зелёный (ни один селектор эталона не
пропал); тест `coverImage` по-прежнему красный.

- [x] **Шаг 5: Коммит**

```bash
git add templates/certification/styles/report.css tests/certification-report-document.test.ts
git commit -m "feat(prd-51): светлый лист документа «Сертификации»"
```

---

## Task 3: Манифест — оболочка, блоки, документ по умолчанию

**Files:**

- Modify: `templates/certification/manifest.json`
- Modify: `tests/certification-report-document.test.ts`

- [x] **Шаг 1: Дописать падающий тест объявлений**

В `tests/certification-report-document.test.ts` добавить:

```ts
const manifest = JSON.parse(fs.readFileSync(path.join(CERT, "manifest.json"), "utf8"));
const blocks = (manifest.contentTemplates as Array<Record<string, unknown>>).filter(
  (v) => v.kind === "report.block",
);

describe("манифест «Сертификации» объявляет документ", () => {
  it("объявляет вариант каждого системного блока для обычного отчёта", () => {
    const forReport = blocks.filter((b) => !b.kinds || (b.kinds as string[]).includes("report"));
    expect(forReport.map((b) => b.block).sort()).toEqual(
      ["breakdown", "courses", "events", "header", "indicators", "intro", "page", "page", "page", "recommendations", "scales", "summary", "topics"].sort(),
    );
  });

  it("на блок ровно одно умолчание для каждого вида", () => {
    for (const kind of ["report", "report.adaptive"]) {
      const seen = new Map<string, number>();
      for (const b of blocks) {
        const kinds = (b.kinds as string[]) ?? ["report", "report.adaptive"];
        if (!kinds.includes(kind) || !b.isDefault) continue;
        seen.set(String(b.block), (seen.get(String(b.block)) ?? 0) + 1);
      }
      for (const [block, n] of seen) {
        expect(n, `${kind}: у блока ${block} умолчаний ${n}`).toBe(1);
      }
    }
  });

  it("объявляет документ по умолчанию для обоих видов", () => {
    expect(manifest.reportDocument.report).toEqual([
      "header", "intro", "page-break", "topics", "page-break",
      "summary", "breakdown", "scales", "indicators", "recommendations", "courses", "events",
    ]);
    expect(manifest.reportDocument["report.adaptive"][0]).toBe("header");
  });

  it("каждая объявленная раскладка лежит в шаблоне", () => {
    for (const b of blocks) {
      const file = path.join(CERT, String(b.layoutFile));
      expect(fs.existsSync(file), `нет файла ${b.layoutFile}`).toBe(true);
    }
  });

  it("даёт автору три варианта страницы: одна колонка, две, три", () => {
    expect(blocks.filter((b) => b.block === "page")).toHaveLength(3);
  });
});
```

- [x] **Шаг 2: Прогнать — падает**

```bash
npm test -- tests/certification-report-document.test.ts
```

Ожидание: FAIL — вариантов `report.block` в манифесте нет.

- [x] **Шаг 3: Дописать манифест**

Правка ТЕКСТОВАЯ, точечная: перечитывать и пересохранять JSON целиком нельзя — сериализация
переформатирует файл и утопит правку в шуме (эта ошибка уже допускалась в Э2).

В `contentTemplates` добавить 22 объявления. Обычный отчёт (11):

```json
{ "key": "report.block.header", "label": "Титул: полотно, вердикт, слушатель", "kind": "report.block", "block": "header", "kinds": ["report"], "isDefault": true, "layoutFile": "layouts/report/header.html" },
{ "key": "report.block.intro", "label": "Обращение к слушателю", "kind": "report.block", "block": "intro", "kinds": ["report"], "isDefault": true, "layoutFile": "layouts/report/intro.html" },
{ "key": "report.block.summary", "label": "Сводка баллов", "kind": "report.block", "block": "summary", "kinds": ["report"], "isDefault": true, "layoutFile": "layouts/report/summary.html" },
{ "key": "report.block.topics", "label": "Разделы: карточки со счётчиком", "kind": "report.block", "block": "topics", "kinds": ["report"], "isDefault": true, "layoutFile": "layouts/report/topics.html" },
{ "key": "report.block.breakdown", "label": "Сводный разрез", "kind": "report.block", "block": "breakdown", "kinds": ["report"], "isDefault": true, "layoutFile": "layouts/report/breakdown.html" },
{ "key": "report.block.scales", "label": "Шкалы", "kind": "report.block", "block": "scales", "kinds": ["report"], "isDefault": true, "layoutFile": "layouts/report/scales.html" },
{ "key": "report.block.indicators", "label": "Показатели", "kind": "report.block", "block": "indicators", "kinds": ["report"], "isDefault": true, "layoutFile": "layouts/report/indicators.html" },
{ "key": "report.block.recommendations", "label": "Рекомендации", "kind": "report.block", "block": "recommendations", "kinds": ["report"], "isDefault": true, "layoutFile": "layouts/report/recommendations.html" },
{ "key": "report.block.courses", "label": "Курсы", "kind": "report.block", "block": "courses", "kinds": ["report"], "isDefault": true, "layoutFile": "layouts/report/courses.html" },
{ "key": "report.block.events", "label": "Мероприятия", "kind": "report.block", "block": "events", "kinds": ["report"], "isDefault": true, "layoutFile": "layouts/report/events.html" }
```

Авторские страницы — общие обоим видам, поэтому БЕЗ `kinds` (3):

```json
{ "key": "report.block.page.text", "label": "Страница: заголовок и текст", "kind": "report.block", "block": "page", "isDefault": true, "layoutFile": "layouts/report/page-text.html",
  "placeholders": [ { "key": "title", "type": "text", "label": "Заголовок" }, { "key": "body", "type": "richText", "label": "Текст" } ] },
{ "key": "report.block.page.cols2", "label": "Страница: две колонки", "kind": "report.block", "block": "page", "layoutFile": "layouts/report/page-cols-2.html",
  "placeholders": [ { "key": "title", "type": "text", "label": "Заголовок" }, { "key": "left", "type": "richText", "label": "Левая колонка" }, { "key": "right", "type": "richText", "label": "Правая колонка" } ] },
{ "key": "report.block.page.cols3", "label": "Страница: три колонки", "kind": "report.block", "block": "page", "layoutFile": "layouts/report/page-cols-3.html",
  "placeholders": [ { "key": "title", "type": "text", "label": "Заголовок" }, { "key": "col1", "type": "richText", "label": "Колонка 1" }, { "key": "col2", "type": "richText", "label": "Колонка 2" }, { "key": "col3", "type": "richText", "label": "Колонка 3" } ] }
```

Адаптивный отчёт (8): те же поля с `"kinds": ["report.adaptive"]`, ключами
`report.block.adaptive.<блок>` и путями `layouts/report/adaptive/<блок>.html` для блоков
`header`, `intro`, `topics`, `breakdown`, `scales`, `indicators`, `recommendations`,
`courses`.

Оболочке `report.standard` добавить поле иллюстрации:

```json
{ "key": "coverImage", "type": "image", "label": "Иллюстрация титула",
  "description": "Картинка в правом нижнем углу первого листа. Пусто — угол остаётся пустым." }
```

Рядом с `contentTemplates` добавить объявление документа:

```json
"reportDocument": {
  "report": ["header", "intro", "page-break", "topics", "page-break", "summary", "breakdown", "scales", "indicators", "recommendations", "courses", "events"],
  "report.adaptive": ["header", "intro", "page-break", "topics", "page-break", "breakdown", "scales", "indicators", "recommendations", "courses"]
}
```

Поднять `"version"` до `"1.10.0"`.

- [x] **Шаг 4: Прогнать — тест раскладок падает, остальные зелёные**

```bash
npm test -- tests/certification-report-document.test.ts tests/template-layout-parity.test.ts
```

Ожидание: тест `coverImage` из задачи 1 ЗЕЛЁНЫЙ; тест «каждая объявленная раскладка лежит
в шаблоне» красный — файлов ещё нет. Это ожидаемо: объявление опережает раскладки ровно на
одну задачу.

- [x] **Шаг 5: Коммит**

```bash
git add templates/certification/manifest.json tests/certification-report-document.test.ts
git commit -m "feat(prd-51): манифест «Сертификации» объявляет документ отчёта"
```

---

## Task 4: Оболочка и титул

**Files:**

- Create: `templates/certification/layouts/report/shell.html`
- Create: `templates/certification/layouts/report/header.html`
- Create: `templates/certification/layouts/report/intro.html`

- [x] **Шаг 1: Открыть эскиз и выписать структуру титула**

```bash
python -m http.server 8123
```

Открыть `http://localhost:8123/docs/wireframes/prd51-certification-report.html`, состояние
`s-pass`, лист 1. Выписать порядок узлов: полотно → бренд-плашка → название → карточка
вердикта (знак, «Тест пройден», ФИО, дата) → обращение → место иллюстрации.

- [x] **Шаг 2: Написать оболочку**

`templates/certification/layouts/report/shell.html`:

```html
<!-- ОБОЛОЧКА ДОКУМЕНТА (PRD-51 §5.2): корень, в который движок вкладывает блоки прямыми
     детьми. Своих разделов у неё нет и быть не может — оболочка, завернувшая блоки в
     контейнер, сломала бы постраничную раскладку (FR-07).
     Логотип и подложка — поля ОБОЛОЧКИ: чужие товарные знаки в шаблон не кладутся, автор
     подставляет свои файлы (§10.2). -->
<div class="tb-report {{ report.verdictClass }}" style="{{#if report.values.backgroundImage}}background-image: url({{ report.values.backgroundImage }});{{/if}}">
{{#if report.values.logoImage}}<div class="tb-report__brand"><img src="{{ report.values.logoImage }}" alt=""></div>{{/if}}
</div>
```

- [x] **Шаг 3: Написать титул**

`templates/certification/layouts/report/header.html`:

```html
<!-- ТИТУЛ. Полотно открывается здесь и закрывается блоком `intro`: обращение к слушателю
     печатается ВНУТРИ белой плиты, как на эскизе. Это единственное место документа, где
     два блока делят один контейнер, и держится оно на порядке `reportDocument` —
     `header`, затем `intro`. Автор вправе выключить обращение: плита закроется пустой.
     Название документа — `course.title`: имя бумаги принадлежит тесту, а не шаблону
     (§10.2). Фиксированной фразы референса «Сертификация пройдена» у нас нет. -->
<div class="tb-report__cover">
  <h1 class="tb-report__title--head" data-path="course.title"></h1>
  <div class="tb-report__card tb-report__card--verdict">
    <!-- Знак исхода рисуется СТИЛЕМ по классу `report.verdictClass` на корне документа
         (`is-pass` / `is-fail`), а не ветвлением в разметке: булева `isPass` в контракте
         контекста нет, и заводить её ради галочки значило бы расширять ядро под один
         шаблон. Узел пустой — содержимое даёт `::before` в `styles/report.css`. -->
    <div class="tb-report__mark" aria-hidden="true"></div>
    <div class="tb-report__headline" data-path="report.verdictHeadline"></div>
    {{#if report.hasLearnerName}}<div class="tb-report__learner" data-path="report.learnerName"></div>{{/if}}
    <div class="tb-report__date" data-path="report.attemptDateLabel"></div>
  </div>
  {{#if report.values.coverImage}}<div class="tb-report__decor" style="background-image: url({{ report.values.coverImage }});"></div>{{/if}}
</div>
```

В `styles/report.css` (задача 2) знак задаётся содержимым псевдоэлемента:

```css
.tb-report.is-pass .tb-report__mark::before { content: "\2713"; color: #19D7A4; }
.tb-report.is-fail .tb-report__mark::before { content: "\0021"; color: #FF4F12; }
```

- [x] **Шаг 4: Написать обращение**

`templates/certification/layouts/report/intro.html`:

```html
<!-- ОБРАЩЕНИЕ К СЛУШАТЕЛЮ — текст автора (`tests.intro_json`, PRD-27 §7.1). Пусто =
     блока нет: пустая плашка на титуле читалась бы как обрыв вёрстки. -->
{{#if result.introHtml}}<div class="tb-report__intro">{{& result.introHtml }}</div>{{/if}}
```

- [x] **Шаг 5: Прогнать гард раскладок**

```bash
npm test -- tests/certification-report-document.test.ts
```

Ожидание: тест существования файлов всё ещё красный (не хватает остальных десяти), тесты
метрик и объявлений зелёные.

- [x] **Шаг 6: Коммит**

```bash
git add templates/certification/layouts/report/shell.html templates/certification/layouts/report/header.html templates/certification/layouts/report/intro.html
git commit -m "feat(prd-51): оболочка и титул отчёта «Сертификации»"
```

---

## Task 5: Разделы со счётчиком и разрезами

Главный блок документа: именно он отличает «Сертификацию» от эталона на бумаге.

**Files:**

- Create: `templates/certification/layouts/report/topics.html`

- [x] **Шаг 1: Написать раскладку**

```html
<!-- РАЗДЕЛЫ. Состав и счётчик считает ЯДРО (PRD-50): `result.topicGroups[]` появляется
     только у теста, где автор завёл блоки разделов, а плоский `result.topicResults`
     остаётся полным — печатать оба значило бы вывести тему дважды. Порядок ветвей тот
     же, что у эталона: сперва блоки, потом темы без блока. -->
{{#if report.hasTopics}}
{{#each result.topicGroups}}
<section class="tb-report__topic-group">
  <div class="tb-report__topic-group-head">
    {{#if label}}<div class="tb-report__topic-group-title">{{ label }}</div>{{/if}}
    {{#if counterLabel}}<div class="tb-report__topic-group-counter">{{ counterLabel }}</div>{{/if}}
  </div>
  {{#each topics}}
  <div class="tb-report__topic {{ passClass }}">
    <div class="tb-report__topic-head">
      <div class="tb-report__topic-name">{{ topicName }}</div>
      {{#if verdictLabel}}<div class="tb-report__topic-verdict">{{ verdictLabel }}</div>{{/if}}
    </div>
    <!-- РАЗРЕЗЫ (PRD-50). В отличие от референса полоса показывает реальную долю и
         называет значение: полоса, кодирующая цветом один лишь уровень, числа не
         сообщает (§10.2, решение владельца). -->
    {{#if breakdown}}
    <div class="tb-report__breakdown">
      {{#each breakdown}}
      <div class="tb-report__breakdown-row {{ passClass }}" data-item="{{ key }}">
        <div class="tb-report__breakdown-name">{{ key }}{{#if statusLabel}}<span class="tb-report__breakdown-status">{{ statusLabel }}</span>{{/if}}</div>
        <div class="tb-report__breakdown-bar"><span style="width: {{ barPercent }}%;"></span></div>
        {{#if showValue}}<div class="tb-report__breakdown-val">{{ valueLabel }}</div>{{/if}}
      </div>
      {{/each}}
    </div>
    {{/if}}
  </div>
  {{/each}}
</section>
{{/each}}

<!-- Темы ВНЕ блоков идут после блоков — тем же порядком, что на экране итогов. -->
{{#each result.ungroupedTopics}}
<section class="tb-report__topic-group">
  <div class="tb-report__topic {{ passClass }}">
    <div class="tb-report__topic-head">
      <div class="tb-report__topic-name">{{ topicName }}</div>
      {{#if verdictLabel}}<div class="tb-report__topic-verdict">{{ verdictLabel }}</div>{{/if}}
    </div>
    <div class="tb-report__topic-stats"><span>{{ countsLabel }}</span><span>{{ pointsFixedLabel }}</span></div>
  </div>
</section>
{{/each}}
{{/if}}
```

- [x] **Шаг 2: Свериться с эталоном по именам путей**

```bash
grep -n "data-path\|{{#each\|{{ " server/scorm/templates/default/layouts/report/topics.html | head -40
```

Каждое имя (`topicGroups`, `counterLabel`, `passClass`, `verdictLabel`, `barPercent`,
`valueLabel`, `ungroupedTopics`) обязано совпасть с эталонным. Расхождение здесь означает
не «другой облик», а блок, который ничего не напечатает: контекст один на оба шаблона.

- [x] **Шаг 3: Прогнать**

```bash
npm test -- tests/certification-report-document.test.ts
```

- [x] **Шаг 4: Коммит**

```bash
git add templates/certification/layouts/report/topics.html
git commit -m "feat(prd-51): разделы отчёта «Сертификации» со счётчиком и разрезами"
```

---

## Task 6: Остальные системные блоки

**Files:**

- Create: `templates/certification/layouts/report/summary.html`, `breakdown.html`,
  `scales.html`, `indicators.html`, `recommendations.html`, `courses.html`, `events.html`

- [x] **Шаг 1: Перенести раскладки эталона под светлую палитру**

Для каждого из семи блоков взять эталонную раскладку и изменить ТОЛЬКО структуру внешней
карточки: `<section class="tb-report__card">` остаётся, внутренности не трогаются.

```bash
for f in summary breakdown scales indicators recommendations courses events; do
  cp "server/scorm/templates/default/layouts/report/$f.html" "templates/certification/layouts/report/$f.html"
done
```

Перенос ДОСЛОВНЫЙ, без единой правки разметки. Облик целиком задаёт `styles/report.css`
(задача 2): класс `tb-report__card` у «Сертификации» уже светлый, и второго класса под
светлую карточку не заводится — правка по дороге не была бы отличима от переноса ни в
ревью, ни в диффе.

Зонтичный заголовок `labels.results.heading` остаётся в начале `summary.html` там же, где
у эталона: его гейт стоит СНАРУЖИ гейта карточки, и перенос заголовка сменил бы порядок
документа у методики без баллов.

- [x] **Шаг 2: Прогнать — тест существования файлов зеленеет**

```bash
npm test -- tests/certification-report-document.test.ts
```

Ожидание: PASS всех тестов задачи 3, кроме страниц (задача 7).

- [x] **Шаг 3: Коммит**

```bash
git add templates/certification/layouts/report/
git commit -m "feat(prd-51): системные блоки отчёта «Сертификации»"
```

---

## Task 7: Три варианта авторской страницы

**Files:**

- Create: `templates/certification/layouts/report/page-text.html`
- Create: `templates/certification/layouts/report/page-cols-2.html`
- Create: `templates/certification/layouts/report/page-cols-3.html`

- [x] **Шаг 1: Одна колонка**

```html
<!-- АВТОРСКАЯ СТРАНИЦА: заголовок и текст. Незаполненная область не печатает ничего, но
     карточка остаётся: пустая страница — решение автора не заполнять её, а не сбой. -->
<section class="tb-report__card">
  <h2 class="tb-report__page-title" data-placeholder="title"></h2>
  <div class="tb-report__text" data-placeholder="body"></div>
</section>
```

- [x] **Шаг 2: Две колонки**

```html
<!-- ДВЕ КОЛОНКИ. Правая колонка эскиза оформлена врезкой — это её ОБЛИК, заданный
     стилем, а не отдельный тип поля: автор кладёт туда обычный текст. -->
<section class="tb-report__card">
  <h2 class="tb-report__page-title" data-placeholder="title"></h2>
  <div class="tb-report__cols-2">
    <div class="tb-report__text" data-placeholder="left"></div>
    <div class="tb-report__note"><div class="tb-report__text" data-placeholder="right"></div></div>
  </div>
</section>
```

- [x] **Шаг 3: Три колонки**

```html
<!-- ТРИ КОЛОНКИ — раскладка листа рекомендаций эскиза. -->
<section class="tb-report__card">
  <h2 class="tb-report__page-title" data-placeholder="title"></h2>
  <div class="tb-report__cols-3">
    <div class="tb-report__text" data-placeholder="col1"></div>
    <div class="tb-report__text" data-placeholder="col2"></div>
    <div class="tb-report__text" data-placeholder="col3"></div>
  </div>
</section>
```

- [x] **Шаг 4: Прогнать — всё зелено**

```bash
npm test -- tests/certification-report-document.test.ts tests/template-layout-parity.test.ts
```

- [x] **Шаг 5: Коммит**

```bash
git add templates/certification/layouts/report/page-*.html
git commit -m "feat(prd-51): три варианта авторской страницы «Сертификации»"
```

---

## Task 8: Адаптивная ветвь

**Files:**

- Create: `templates/certification/layouts/report/adaptive/` — девять файлов

- [x] **Шаг 1: Перенести адаптивные раскладки эталона**

```bash
mkdir -p templates/certification/layouts/report/adaptive
for f in shell header intro topics breakdown scales indicators recommendations courses; do
  cp "server/scorm/templates/default/layouts/report/adaptive/$f.html" "templates/certification/layouts/report/adaptive/$f.html"
done
```

- [x] **Шаг 2: Привести титул и разделы к облику «Сертификации»**

`adaptive/header.html` — та же плита титула, что в задаче 4, но с адаптивной подписью:

```html
<div class="tb-report__cover">
  <h1 class="tb-report__title--head" data-path="course.title"></h1>
  <div class="tb-report__card tb-report__card--verdict">
    <div class="tb-report__mark" aria-hidden="true">{{#if report.isPass}}&#10003;{{else}}&#33;{{/if}}</div>
    <div class="tb-report__headline" data-path="report.verdictHeadline"></div>
    {{#if report.hasLearnerName}}<div class="tb-report__learner" data-path="report.learnerName"></div>{{/if}}
    <div class="tb-report__date" data-path="report.attemptDateLabel"></div>
  </div>
  {{#if report.values.coverImage}}<div class="tb-report__decor" style="background-image: url({{ report.values.coverImage }});"></div>{{/if}}
</div>
```

`adaptive/topics.html` оставить эталонным: адаптивная карточка темы говорит подтверждённым
УРОВНЕМ, а не долей, и её структура к референсу «Сертификации» отношения не имеет.
Светлый облик ей даёт общий `styles/report.css`.

- [x] **Шаг 3: Прогнать**

```bash
npm test -- tests/certification-report-document.test.ts
```

- [x] **Шаг 4: Коммит**

```bash
git add templates/certification/layouts/report/adaptive/
git commit -m "feat(prd-51): адаптивная ветвь отчёта «Сертификации»"
```

---

## Task 9: Гард пакета и предпросмотра

Раскладки, которые не доехали в пакет, — это отчёт, который не напечатается у слушателя.

**Files:**

- Modify: `tests/report-shipped-templates.test.ts`

- [x] **Шаг 1: Написать падающий тест**

`resolveReportBundle` в этом файле уже импортирован; дописать к импорту разрешение
документа:

```ts
import { resolveReportBundle, resolveReportDocument } from "@shared/report/report-document";
```

```ts
describe("«Сертификация» кладёт документ в пакет", () => {
  it("каждая объявленная раскладка блока попадает в сборку", async () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "templates", "certification", "manifest.json"), "utf8"),
    );
    const kind = "report";
    const bundle = resolveReportBundle(manifest, kind, null, [], "");
    expect(bundle.document, "документ не разрешился — шаблон объявил блоки?").not.toBeNull();
    for (const b of bundle.document!.blocks) {
      if (b.nature === "page-break") continue;
      expect(b.layoutFile, `у блока ${b.block} нет раскладки`).not.toBe("");
    }
  });

  it("документ по умолчанию начинается с титула и содержит два разрыва листа", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "templates", "certification", "manifest.json"), "utf8"),
    );
    const doc = resolveReportDocument(manifest, "report", []);
    expect(doc.blocks[0].block).toBe("header");
    expect(doc.blocks.filter((b) => b.nature === "page-break")).toHaveLength(2);
  });
});
```

- [x] **Шаг 2: Прогнать — падает или зеленеет**

```bash
npm test -- tests/report-shipped-templates.test.ts
```

Красный тест здесь означает расхождение манифеста с файлами — вернуться в задачу 3.

- [x] **Шаг 3: Коммит**

```bash
git add tests/report-shipped-templates.test.ts
git commit -m "test(prd-51): документ «Сертификации» доезжает до сборки"
```

---

## Task 10: Приёмка растром рядом с референсом

Юниты не видят бумаги. Сверка — снимками рядом, поэлементно по §10.3.

**Files:**

- Create: `docs/reports/prd51-e4-acceptance.md`

- [x] **Шаг 1: Собрать пакет приёмки**

```bash
PORT=8097 npm run dev
```

Войти как `acceptance@local.test` / `Acceptance!2026`, взять тест
`608932a1-b0d0-4953-8484-ba45890ddd1f` (создан приёмкой Э3), во вкладке «Оформление»
выбрать шаблон «Сертификация», собрать документ по §10.1: `header`, `intro`, разрыв,
`topics`, разрыв, три авторские страницы. Сохранить и выгрузить пакет:

```bash
curl -s -b cookies "http://localhost:8097/api/tests/608932a1-b0d0-4953-8484-ba45890ddd1f/export/scorm" -o out/prd51-e4.zip
```

- [x] **Шаг 2: Пройти в плеере и скачать PDF**

```bash
npm run scorm:player
```

Открыть `http://localhost:5050`, загрузить `prd51-e4.zip`, пройти тест, нажать «Скачать
отчёт».

- [x] **Шаг 3: Растеризовать и сверить с референсом**

Извлечь листы из PDF (страницы — DCTDecode-изображения 1190 × 1684):

```bash
python - <<'PY'
import re, glob
f=[x for x in glob.glob('.playwright-mcp/*.pdf') if 'PRD-51' in x][0]
d=open(f,'rb').read()
n=0
for m in re.finditer(rb'/Subtype\s*/Image', d):
    st=d.find(b'stream', m.start()); s=st+6
    while d[s:s+1] in (b'\r', b'\n'): s+=1
    e=d.find(b'endstream', s)
    open(f'out/e4-sheet{n+1}.jpg','wb').write(d[s:e]); n+=1
print('листов:', n)
PY
```

Сверить каждый лист с `docs/references/Макарова Анна Васильевна_успешная попытка.pdf`
поэлементно по таблице §10.3: поля листа, полотно титула, карточка титула, карточка блока,
бейдж счётчика, строка раздела, полоса разреза, цвета исхода. Каждое расхождение — либо
правка, либо строка в разделе «принято сознательно» отчёта приёмки.

- [x] **Шаг 4: Проверить непройденную попытку**

Повторить прогон с результатом ниже порога. Ожидание: знак исхода и пилюли уровня
оранжевые (`#FF4F12`), раскладка та же — различия только в данных (эскиз, `s-fail`).

- [x] **Шаг 5: Записать отчёт приёмки**

`docs/reports/prd51-e4-acceptance.md`: что проверено, чем, с числами — размеры листов,
число листов, снятые цвета, найденные расхождения. Отчёт без чисел приёмкой не считается.

- [x] **Шаг 6: Коммит**

```bash
git add docs/reports/prd51-e4-acceptance.md
git commit -m "docs(prd-51): приёмка этапа Э4"
```

---

## Дальнейшие планы

| План | Охват | Предусловие |
| --- | --- | --- |
| `2026-XX-XX-template-contract-2-0.md` | Э5, FR-24: спецификация формата 2.0.0, руководство 2.0.0, `npm run docs:pdf` | Э4 принят |

Хвост приёмки Э1-Э2 — растр адаптивного отчёта — закрывается там же, где появится
адаптивная фикстура без лимита времени: сегодняшняя фикстура стенда до конца не проходится
(см. `docs/reports/prd51-e3-acceptance.md` §4).
