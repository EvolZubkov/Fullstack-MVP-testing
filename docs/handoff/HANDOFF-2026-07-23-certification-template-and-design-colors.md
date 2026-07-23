# Передача работы: шаблон «Сертификация», превью в редакторе, цвета оформления

Дата: 2026-07-23. Ветка: `feat/prd12-fr6-content-pages`.
Базовый коммит: `f05a650` — chore(templates): перегенерировать preview.html под рефакторинг рантайма FR-6.
Статус: в работе. Ничего не закоммичено.

Важно про состояние дерева: до этой сессии в нём уже лежала незакоммиченная работа по PRD-22
(см. [HANDOFF-2026-07-22-prd22-preview-and-variants.md](HANDOFF-2026-07-22-prd22-preview-and-variants.md)).
`git status` показывает 84 изменённых файла, из них к этой сессии относятся только перечисленные
в разделе 2. Остальные правки — чужие, не трогать.

## 1. Задача

Три связанные задачи, поставленные последовательно в одной сессии.

1. Привести шаблон `templates/certification` в порядок: дать ему полный набор вариантов страниц
   шаблона «Стандартный», чтобы тест переключался между ними без переназначения страниц.
   Дизайн — из существующего шаблона, не переизобретать. Затем импортировать в dev.
2. Починить превью шаблона в редакторе теста (вкладка «Оформление») и добавить команды
   предпросмотра: в строки элементов структуры и на карточки шаблона.
3. Починить настройку цветов: значения в панели должны совпадать с реально используемыми в
   шаблоне, переопределения — доходить до отрисовки. Отдельно — предложение по системным темам,
   для которого запрошены эскизы.

Связанных PRD/плана у задач 2 и 3 нет: это дефекты, найденные по ходу. Задача 1 опирается на
контракт вариантов из [docs/specs/prd-22/page-fields-and-sequences.md](../specs/prd-22/page-fields-and-sequences.md).

## 2. Что сделано

### 2.1. Шаблон «Сертификация» — паритет со «Стандартным»

Набор ключей `contentTemplates[]` теперь совпадает с шаблоном `default` побайтно: 20 вариантов,
ни одного лишнего, ни одного пропущенного. Совпадают и ключи полей (`title`/`lead`/`body`/`image`)
и настроек (`sequenceId`/`nextLabel`/`backgroundImage`).

- [templates/certification/manifest.json](../../templates/certification/manifest.json) — версия
  поднята `1.1.0` → `1.2.1`; добавлены 13 вариантов (`info.text-lead`, `info.image-left`,
  `info.image-left-lead`, `info.image-right`, `info.image-right-lead`, шесть `gallery.*`,
  `summary.result`); в `capabilities.contentPages` добавлен `summary`; `preview.routes` расширен
  до 26 записей.
- Новые макеты в [templates/certification/layouts/](../../templates/certification/layouts/):
  `content.text.html`, `content.image-left.html`, `content.image-right.html`, `gallery.text.html`,
  `gallery.image-left.html`, `gallery.image-right.html`, `summary.html`.
- Удалён `templates/certification/layouts/gallery.html` вместе с вариантом `gallery.card`.
- [templates/certification/styles/base.css](../../templates/certification/styles/base.css) — блок
  `.gallery*` заменён общим компонентом `.slide` (один на `info.*` и `gallery.*`, отличие только в
  точках последовательности); дописаны пять классов, которые макеты уже использовали, а стилей для
  них не было: `topic-links`, `topic-link`, `transition-level-icon`, `transition-level-msg`,
  `transition-actions`.
- [templates/certification/demo/course.json](../../templates/certification/demo/course.json) — по
  одной демо-странице на каждый вариант; шесть галерейных идут подряд с общим `sequenceId`.
- [templates/certification/preview.html](../../templates/certification/preview.html) — перегенерирован.

### 2.2. Экран перехода в офлайновом превью

- [scripts/_preview-bootstrap.js](../../scripts/_preview-bootstrap.js) — добавлен
  `renderTransitionRoute()` и ветка под него в `navigateTo`. Контекст строится тем же общим
  билдером, что и в бою (`window.TBTemplate.buildTransitionContext`), по образцу соседних
  `renderReviewRoute` / `renderSectionResultsRoute`. Данные берутся из `runtime.transition`
  демо-набора шаблона, иначе — дефолты, задействующие все ветки макета.
- Правка общая для всех шаблонов, поэтому
  [server/scorm/templates/default/preview.html](../../server/scorm/templates/default/preview.html)
  тоже перегенерирован (бутстрап инлайнится в каждое превью).

### 2.3. Превью шаблона в редакторе теста

Карточка шаблона и карточки галереи рисовали синтетический скетч из `div`-ов, перенесённый из
эскиза, — превью не зависело от шаблона вообще.

- [client/src/features/tests/editor/sections/template-thumb.tsx](../../client/src/features/tests/editor/sections/template-thumb.tsx)
  (новый) — строит URL из `manifest.assets.preview` и отдаёт `<img>` на
  `/api/templates/:id/assets/*`. Скетч остался запасным вариантом через `children`.
- [client/src/features/tests/editor/sections/design-section.tsx](../../client/src/features/tests/editor/sections/design-section.tsx)
  и [template-gallery-modal.tsx](../../client/src/features/tests/editor/sections/template-gallery-modal.tsx)
  — подключены к нему.
- [client/src/features/tests/editor/use-design-settings.ts](../../client/src/features/tests/editor/use-design-settings.ts)
  — в тип `TemplateRow.manifest` добавлен `assets`.
- [client/src/styles/tb-components.css](../../client/src/styles/tb-components.css) — `.tpl-thumb__img`
  с `object-fit: cover`, как у карточки в реестре `/author/templates`.

### 2.4. Команды предпросмотра

- [start-pages-section.tsx](../../client/src/features/tests/editor/sections/start-pages-section.tsx)
  — пиктограмма «глаз» перед меню действий в обоих типах строк структуры: системные узлы и
  авторские страницы. В опубликованном тесте кнопка показывается, хотя меню действий скрыто.
- [template-gallery-modal.tsx](../../client/src/features/tests/editor/sections/template-gallery-modal.tsx)
  — «глаз» в правом верхнем углу каждой карточки галереи открывает предпросмотр шаблона, не меняя
  выбор; пока предпросмотр открыт, галерея получает `closeOnEsc={false}` / `closeOnBackdrop={false}`.
- [template-preview-modal.tsx](../../client/src/features/tests/editor/sections/template-preview-modal.tsx)
  — попутно исправлен обрыв цепочки `bundle?.manifest.params` (падал, если ответ приходил без манифеста).

### 2.5. Цвета оформления

- [color-format.ts](../../client/src/features/tests/editor/sections/color-format.ts) — добавлена
  `manifestColorFormat()`: формат берётся из манифеста, а не угадывается по текущему значению;
  запасной формат в `fromHex` сменён с HEX на HSL (конвенция платформы).
- [theme-tokens.ts](../../client/src/features/tests/editor/sections/theme-tokens.ts) (новый) —
  извлекает токены из `theme.css` шаблона, отдельно светлую и тёмную палитры.
- [design-section.tsx](../../client/src/features/tests/editor/sections/design-section.tsx) — панель
  показывает реальный цвет шаблона вместо `#000000`, помечает происхождение значения
  («из шаблона» / «Вернуть из шаблона»); бандл тянется только для секции, где есть цвета.
- [use-design-settings.ts](../../client/src/features/tests/editor/use-design-settings.ts) — новый
  `clearParam(key)`: удаляет ключ, а не пишет `null`.

### 2.6. Эскиз раздела «Цвета»

- [docs/wireframes/branding-theme-colors.html](../wireframes/branding-theme-colors.html) (новый) —
  четыре состояния: шаблон без тем (плоский список), тема зафиксирована, тема «Авто», остаток
  «Брендирования». Под холстом четыре таблицы: состояния, дельта, соответствие контролов DS, что
  требуется вне панели. Не согласован.

### 2.7. Тесты

Дописаны: [template-thumb.test.tsx](../../client/src/features/tests/editor/sections/__tests__/template-thumb.test.tsx)
и [theme-tokens.test.ts](../../client/src/features/tests/editor/sections/__tests__/theme-tokens.test.ts)
(оба новые), плюс кейсы в `design-section.test.tsx`, `design-section.branches.test.tsx`,
`start-pages-section.test.tsx`, `color-format.test.ts`.

## 3. Что НЕ сделано

- **Темы не реализованы.** Эскиз раздела «Цвета» отрисован, но не согласован и в код не переносился.
  Четыре пункта из его таблицы «что требуется вне панели» не спроектированы: формат объявления тем
  в манифесте, хранение значения на каждую тему, печать двух наборов переопределений в рендер,
  поведение предпросмотра при «Авто».
- **`system.transition` не покрыт проверкой работоспособности «Стандартного».** Шаблон `default`
  не объявляет этот маршрут в `preview.routes`; правка бутстрапа его поддерживает, но одну строку
  в манифест `default` я не добавлял — это отдельное решение.
- **Плашка обложки «Сертификации».** `.cover-brand` в `styles/base.css` залита фиксированным
  оранжевым градиентом мимо `var(--primary)`: при смене цвета кнопок обложка расходится с
  остальным экраном. Не чинил, вынесено в эскиз как известный дефект шаблона.
- **Веб-хост не применяет `backgroundImage` страницы.** `applyPageBackground` есть только в
  SCORM-рантайме; на вебе фоновое изображение страницы не рисуется. Пробел PRD-22, не мой.
- **Ничего не закоммичено.** Ветка та же, что и у чужой работы PRD-22, — коммитить надо выборочно.

## 4. Как проверить

Всё выполняется из корня репозитория.

### 4.1. Шаблон и его превью

```bash
node scripts/generate-prd1-template-previews.mjs
```

Ожидается: `Found 2 template(s): default, certification` и две галочки. Затем открыть
`templates/certification/preview.html` через любой статический сервер (файловый протокол не
подойдёт: превью грузит CSS относительными путями) и пройти все 26 пунктов навбара — пустых
экранов быть не должно.

### 4.2. Валидация пакета и проверка работоспособности

Постоянного теста на это нет. Разовая проверка делалась временным vitest-файлом, который вызывал
`validateTemplatePackage` и `runSmokeChecks` на каталоге шаблона; файл удалён. Результат последнего
прогона зафиксирован в разделе 5.

### 4.3. Состояние dev

```bash
docker exec test-builder-db psql -U test_builder -d test_builder -t -A -F' | ' \
  -c "select id, status, version, (validation_json->>'ok'), (smoke_test_json->>'total'), (smoke_test_json->>'failed') from templates order by id;"
```

Ожидается: `certification | active | 1.2.1 | true | 27 | 0`.

### 4.4. Редактор

Открыть `/author/tests`, войти в тест «Сертификационный тест для руководителей»:

- вкладка «Оформление» → карточка шаблона показывает настоящее превью, «Заменить шаблон» →
  у обеих карточек своя обложка и «глаз» в правом верхнем углу;
- «Оформление» → «Брендирование» → цвета показывают палитру шаблона (`#E63900` у кнопок), у
  незаданных стоит «из шаблона»;
- вкладка «Структура» → в каждой строке «глаз» перед меню действий.

Учётные данные администратора dev в этом документе не приводятся: временный администратор
создавался инструментом `npm run create-admin` и после работы удалён. Способ повторить — тот же
инструмент, параметры смотреть в `script/create-admin.ts`.

## 5. Состояние проверок

Полный прогон `./node_modules/.bin/vitest run --coverage.enabled=false` от 2026-07-23:

```text
Test Files  3 failed | 265 passed (268)
     Tests  9 failed | 4878 passed (4887)
```

Все 9 падений — в аналитике: `tests/routes.analytics-attempts.coverage.test.ts`,
`tests/routes.analytics-scorm.coverage.test.ts`, `tests/routes.scorm-telemetry-analytics.test.ts`.
**Эти падения предшествуют работе.** Обоснование: перечисленные файлы и `server/routes/analytics.ts`
не менялись ни в этой сессии, ни относительно `HEAD` (`git status` по ним пуст), а ровно те же
9 падений зафиксированы в [docs/reports/AUDIT_TEMPLATE_LAYOUT_FALLBACK.md:205](../reports/AUDIT_TEMPLATE_LAYOUT_FALLBACK.md)
от 2026-07-17.

Прочее:

- `npm run check` (tsc) — чисто.
- `npm run check:wireframes:ds` — 0 нарушений в новом эскизе (в других файлах нарушения есть, они
  не мои).
- `npm run lint:md` — чисто.
- Набор редактора `./node_modules/.bin/vitest run client/src/features/tests/editor` — 42 файла,
  774 теста, зелёные.
- Покрытие с порогом 80 % **не проверялось**: все прогоны шли с `--coverage.enabled=false`.
- Приёмка в реальном браузере (Playwright) пройдена по каждому пункту раздела 4.4; скриншоты в
  `.playwright-mcp/`.

## 6. Принятые решения

- **`gallery.card` удалён, а не оставлен рядом.** Он не имеет пары в «Стандартном» и ломал бы
  переключение в обратную сторону. Страницы, привязанные к нему, подставятся на `info.text` и
  покажут пустые поля: соответствие полей — `header` → `title`, `subheader` → `lead`,
  `cardText` → `body`, `image` → `image`. Согласовано с заказчиком (сообщено в отчёте, возражений
  не поступило).
- **Ключи макетов в `manifest.layouts` заданы путями к файлу** (`"layouts/content.text.html":
  "layouts/content.text.html"`). Выглядит странно, но это единственный ключ, по которому вариантные
  макеты находят все четыре хоста сразу: SCORM-рантайм и веб-хост ищут по `layoutFile`, а офлайновый
  генератор превью — по ключу `layouts`. Иначе офлайновое превью рисует все варианты общей обёрткой.
- **Версия шаблона поднята дважды** (`1.2.0`, затем `1.2.1`): первый пакет уже был импортирован в
  dev, и выпускать другое содержимое под тем же номером нельзя.
- **`system.transition` убран из `preview.routes` «Сертификации», потом возвращён** — после того как
  бутстрап научился строить его контекст. До правки экран рисовался пустым.
- **HSL как запасной формат цвета.** Конвенция платформы записана в
  [shared/template/params-css.ts:12-14](../../shared/template/params-css.ts): значения
  подставляются как есть и оборачиваются шаблоном в `hsl()`. Прежний запасной HEX давал
  `hsl(#7700FF)`, который браузер отбрасывает, и элемент оставался без цвета.
- **Цвета попадут в новый раздел по ТИПУ параметра**, а не по объявленному в манифесте `section`:
  иначе каждый уже загруженный шаблон пришлось бы переиздавать. Решение зафиксировано в эскизе,
  кодом не подтверждено.
- **Таблица цветов показывается всегда при поддержке тем**, а не только при «Авто» — прямое
  указание заказчика. Подобранная палитра не теряется при смене выбора темы.
- **Вариант с переключателем правимой палитры отвергнут** заказчиком в пользу таблицы; состояние
  удалено из эскиза.

## 7. Грабли

- **Эскизные тоглы навбара не в общем файле.** `toggleTheme` / `toggleDensity` / `toggleAnnots`
  в `docs/wireframes/prd7-shared.js` НЕ объявлены — каждый эскиз держит их копию у себя в
  `<script>`. Забыть перенести = кнопки Dark/Compact/Аннотации молча не работают.
- **Баннер внутри `.tb-settings-content` — липкий во всю ширину.** Правило в
  [client/src/styles/tb-components.css:101](../../client/src/styles/tb-components.css) рассчитано
  на баннер вверху формы: поставленный между полями он наезжает на описание поля выше на 4px.
- **`.ou-table` держит ячейки в `white-space: nowrap`.** Длинное описание параметра уезжает под
  соседние колонки, а `.ou-table-wrap` не прокручивается — колонка обрезается молча. Нужны
  `table-layout: fixed` и явный перенос в колонке с текстом.
- **Селекты `data-ou-options` в эскизах раскрываются сами** и закрывают собой то, что под ними.
  При снятии скриншотов их надо гасить.
- **Загрузка файла в Playwright** ограничена корнем репозитория и `.playwright-mcp/`: ZIP из
  каталога временных файлов не примется, надо класть рядом.
- **Аналитические тесты падают на чистой ветке** — см. раздел 5, не искать причину в этой работе.
- **`templates/certification/*.zip`** (`certification-5.zip`, `certification-6.zip`) лежат внутри
  каталога шаблона. При зипировании папки они попадут в пакет: лишние 180 КБ и предупреждения
  `UNUSED_FILE`. Сборка архива для импорта должна их исключать.
- **Рабочий каталог Bash-инструмента сохраняется между вызовами.** После `cd` в каталог шаблона
  скрипты из корня перестают находиться; путать легко.

## 8. Следующий шаг

Начинать с согласования эскиза [docs/wireframes/branding-theme-colors.html](../wireframes/branding-theme-colors.html).
После согласования первым делом спроектировать признак поддержки тем в манифесте шаблона —
без него раздел «Цвета» не знает, показывать ли переключатель и вторую колонку. Точка входа для
кода: `SectionPane` в
[client/src/features/tests/editor/sections/design-section.tsx](../../client/src/features/tests/editor/sections/design-section.tsx),
там уже разобраны токены тем через `extractThemeTokens` — сейчас берётся только светлая палитра
(`tokens.light`), тёмная вычисляется, но не используется.

Если приоритет иной — шаблон и правки редактора самодостаточны и готовы к выборочному коммиту.
