# PRD-7: Стратегия реализации с переключением моделей

**Версия:** 1.0
**Назначение:** Пошаговая инструкция по реализации PRD-7 разными моделями Claude Code.
**Связанные документы:**

- [PRD-7](prd-7-test-settings-editor-refactor.md) - источник требований
- [decisions.md](prd-7-decisions.md) - контракты, enum, JSON-shapes (читать перед кодом)
- [implementation-todo.md](prd-7-implementation-todo.md) - детальный список задач

---

## 1. Принципы

### 1.1 Какая модель что делает

| Модель | Сильные стороны | Где использовать |
| --- | --- | --- |
| Opus 4.7 | Архитектура, чтение PRD/BRD целиком, новые контракты, конфликты, дизайн-каркас wireframes | Контракты, миграции, reference-имплементации, дизайн-система wireframes, финальный acceptance |
| Sonnet 4.6 | Сложные секции, логика state, transactions, рефакторинг, UI по reference-стилю | Backend сервис, Drawer-каркас, mappers, wireframes по reference, удаление legacy |
| Haiku 4.5 | Копирование паттернов, шаблонные тесты, наполнение по образцу | Доменные секции после reference, тесты по образцу, валидация |

### 1.2 Правила переключения

1. Opus -> Sonnet ТОЛЬКО после фиксации reference-имплементации (типы / схема / каркас).
2. Sonnet -> Haiku ТОЛЬКО если задача = копирование паттерна с заменой полей.
3. Эскалация назад (Haiku -> Sonnet -> Opus) при первых же двух неудачных итерациях. Не "ещё разок".
4. Возврат на Opus обязателен при: новом контракте, конфликте PRD, edge-case вне decisions.md,
   финальном acceptance pass.

### 1.3 Переключение в Claude Code

```text
/model opus     -- архитектурные и контрактные задачи
/model sonnet   -- основная разработка
/model haiku    -- наполнение по образцу
/clear          -- очистить контекст между независимыми сессиями
```

### 1.4 Группировка фаз в сессии и передача знания

Один промпт != одна сессия. Подход «каждая фаза в отдельной сессии» наивен:
кэш PRD-7/decisions.md прогревается заново, контекст теряется,
расходуется ~30-50k токенов на одно «открытие». При этом «всё в одной сессии»
тоже плохо: после ~60-80k токенов модель деградирует.

Правила группировки:

1. **Группируйте связанные подфазы в одну сессию через `/model`-переключение,
   а не через `/clear`.** Каждая смена модели обнуляет инструкции, но НЕ
   обнуляет уже прочитанные файлы и kv-cache. Это бесплатный способ передать
   контекст между Opus и Sonnet или Sonnet и Haiku.
2. **`/clear` между независимыми зонами** (frontend foundation -> UI-каркас,
   секции -> тесты). Это сбрасывает kv-cache и позволяет модели начать
   с чистого листа.
3. **Не используйте `/clear` для итеративной отладки.** Если в сессии 2 раза
   подряд не сработало - это сигнал эскалировать модель, а не обнулять
   контекст. Новая сессия не узнает, что не сработало в прошлой.
4. **После каждой сессии, где принято новое решение:**
   - Если открылся новый контракт/edge case - дописать в [decisions.md](prd-7-decisions.md).
   - Если найден лучший паттерн - обновить reference-код в репозитории.
   - Если выявился новый блокер - дописать в [implementation-todo.md](prd-7-implementation-todo.md).
   Только так знание переживает `/clear` и переход к следующей сессии.
5. **Длинные сессии тоже плохи.** Если контекст разрастается (>80k токенов) -
   зафиксировать промежуточный артефакт (commit + обновление decisions.md),
   `/clear`, начать чистую сессию с готовым артефактом.
6. **Когда фаза маленькая (< полсессии)** - объединяйте её со следующей в
   одну сессию, чтобы амортизировать стоимость cache-warming.

Рекомендованная нарезка на сессии (12 сессий вместо 19-21):

| Сессия | Содержимое | Модели в сессии | Граница после |
| --- | --- | --- | --- |
| S0 | Фаза 0 (готово) | Opus | `/clear` |
| S1 | Фаза W.3A + W.3B | Opus -> Sonnet | согласование (внешнее) |
| S2 | Фаза 1A + 1B | Opus -> Sonnet | `/clear` |
| S3 | Фаза 2A + 2B + 3A + 3B | Opus -> Sonnet -> Haiku | `/clear` |
| S4 | Фаза 4A + 4B | Opus -> Sonnet | `/clear` |
| S5 | Фаза 5A | Haiku | `/clear` |
| S6 | Фаза 5B | Haiku | `/clear` |
| S7 | Фаза 5C | Haiku | `/clear` |
| S8 | Фаза 5D + 5E | Haiku -> Sonnet | `/clear` |
| S9 | Фаза 6A + 6B | Haiku | `/clear` |
| S10 | Фаза 7A | Sonnet | `/clear` |
| S11 | Фаза 7B + W.3C | Opus -> Sonnet | финал |

Группировки выбраны так, чтобы:

- внутри сессии все подфазы работают в одной зоне кода;
- модели переключались через `/model` (не `/clear`), сохраняя cache;
- между сессиями всегда есть commit + обновление decisions.md как граница.

Допустимо разделить сессию на две, если:

- задача оказалась сложнее ожидаемого и контекст подходит к 80k токенов;
- внутри сессии возник конфликт с другим PRD или неожиданная зависимость
  (тогда эскалация на Opus в новой сессии);
- между подфазами требуется внешнее действие (миграция БД, согласование
  wireframes, code review).

Недопустимо склеивать сессии, если:

- они работают в разных зонах кода (frontend секции и backend service);
- между ними должно быть code review или ручное тестирование;
- одна из них дольше 60 минут или > 80k токенов.

---

## 2. Фазы реализации

Фазы перечислены в рекомендованном порядке выполнения. Перед каждым заголовком
указана сессия из §1.4 (S0...S11). Фазы внутри одной сессии выполняются
последовательно с переключением модели через `/model`. Между сессиями -
`/clear` после commit и обновления decisions.md.

### Сессия S0 - Фаза 0: Подготовка контрактов и фундамента

**Модель:** Opus 4.7
**Длительность:** 1 сессия
**Вход:** PRD-7, PRD-4, BRD прочитаны
**Выход:** decisions.md, обновлённый todo, skeleton-каркас

Готово на текущий момент:

- [x] decisions.md создан
- [x] todo.md обновлён с anti-goals и DoD
- [ ] Skeleton-каркас в `client/src/features/tests/editor/`

Промпт для финализации skeleton (Фаза 0, Opus):

```text
Создай skeleton-каркас в client/src/features/tests/editor/ согласно §10
docs/prd-7-decisions.md.

Файлы создать пустыми с экспортами TypeScript:
- test-editor.types.ts: экспортировать TestEditorModel, TestSettingsPayload,
  TestSectionPayload, AdaptiveSettingsPayload, FeedbackContent, FeedbackAsset,
  AdaptiveTestSettings, все enum-типы из §2 decisions.md
- test-editor.mappers.ts: экспортировать функции apiToEditorModel(api: unknown):
  TestEditorModel и editorModelToPayload(model: TestEditorModel):
  TestSettingsPayload, обе бросают throw new Error("not implemented")
- test-editor.validation.ts: экспортировать validateTestEditor(model:
  TestEditorModel): ValidationResult, бросает throw new Error("not implemented")
- use-test-editor.ts: экспортировать useTestEditor(testId?: string), пустой hook
- test-editor.tsx: экспортировать <TestEditor />, возвращающий null
- sections/basic-settings-section.tsx: пустой компонент
- sections/topics-structure-section.tsx: пустой компонент
- sections/pass-rules-section.tsx: пустой компонент
- sections/adaptive-settings-section.tsx: пустой компонент
- sections/start-pages-section.tsx: пустой компонент
- sections/design-section.tsx: пустой компонент

Все файлы должны компилироваться (npm run check проходит).
Не реализовывать логику. Только сигнатуры и типы.
Anti-goals: не трогать существующие файлы вне нового каталога.
DoD: npm run check зелёный.
```

---

### Сессия S1 - Фаза W: Wireframes и согласование

**Генерация wireframes:** модель Claude Code (Opus для дизайн-системы и reference,
Sonnet для остальных экранов).
**Согласование:** продакт + автор PRD-7. Согласование - человеческий шаг,
генерация - модельный.
**Длительность:** 1 сессия модели (W.3A + W.3B через `/model`-переключение).
Параллельно с S2/S3 идут 1-2 итерации согласования продакта.
**Когда стартовать:** сразу после S0. Согласование может завершиться к началу S4.
**Блокирует:** Фазы 4, 5 (UI) и UI-часть Фазы 7B.

Правило BRD (§2.6, NFR-14): UI-разработка начинается только после подготовки и явного
согласования wireframes. Любое изменение сценария, состава полей или порядка действий
во время разработки возвращает изменение на повторное согласование wireframes до
продолжения UI-реализации.

Дизайн-система: модель опирается на существующие wireframes и реальный UI сервиса,
не изобретая новые токены/паттерны.

#### W.0 Источники дизайн-системы (обязательно для модели)

Перед созданием любого нового wireframe модель ОБЯЗАНА прочитать:

- `docs/wireframes/design-tab.html` - актуальный стиль wireframes, дизайн-токены
  (CSS variables `--bg`, `--fg`, `--primary` и т.д.), радиусы, типографика, layout.
- `docs/wireframes/pages-tab.html` - тот же стиль для второго экрана,
  паттерн "tabs + content + footer".
- `client/src/index.css` - источник дизайн-токенов (HSL палитра, radius, typography).
- `client/src/components/ui/` - реальная shadcn-библиотека сервиса:
  `dialog.tsx`, `drawer.tsx`, `sheet.tsx`, `tabs.tsx`, `select.tsx`, `input.tsx`,
  `button.tsx`, `card.tsx`, `badge.tsx`, `alert.tsx`, `form.tsx`. Wireframe
  должен показывать только те элементы, которые реально существуют в библиотеке.
- `client/src/components/design-settings-dialog.tsx` -
  пример сложного dialog'а с tabs/sections, который близок по сложности к
  будущему `TestEditor` Drawer.
- `client/src/components/content-pages-dialog.tsx` -
  пример CRUD dialog для content pages.
- `client/src/pages/author/tests.tsx` - текущий wizard, чтобы понять, что именно
  заменяется и какие паттерны переиспользуются.

Принципы дизайна сервиса (выводятся из источников выше):

- Tailwind + shadcn/ui, без сторонних UI-китов.
- HSL дизайн-токены через CSS variables, dark/light не в скоупе PRD-7.
- Layout: card-based, mid-radius (`--radius: 9px`).
- Status communication: badge + цвет + иконка + `aria-label` (NFR-21).
- Inline-валидация под полем красным текстом + иконкой; section warning - alert-блок.
- Single primary action per dialog/drawer footer.
- Эмоджи и иконки-картинки НЕ используются в wireframes (markdown-проверка).

#### W.1 Артефакты

Целевая директория: `docs/wireframes/`. Имя файла: `prd7-<scenario>.html`
(например `prd7-editor-drawer.html`, `prd7-tests-list.html`).
Существующие файлы `design-tab.html` и `pages-tab.html` требуют ревизии
(см. блокер из §7 PRD-7).

Полный чек-лист 17 wireframes-пунктов: §1.3 [implementation-todo.md](prd-7-implementation-todo.md).

Минимальный набор для разблокировки Фазы 4A (Drawer-каркас):

- [ ] `prd7-tests-list.html`: список тестов с компактными actions и меню
      расширенных действий (FR-30, FR-31, FR-08 BRD).
- [ ] `prd7-editor-drawer.html`: wide Drawer редактора - header, footer,
      агрегированные статусы вкладок (FR-43, FR-25b).
- [ ] `prd7-editor-settings-tab.html`: вкладка **"Настройки"** с двухпанельным
      side nav (>= 960px) и selector (< 960px) (FR-43, NFR-19, NFR-20).
- [ ] `prd7-editor-close-confirm.html`: confirmation dialog при закрытии
      с несохранёнными изменениями + блокирующие ошибки (FR-05, FR-05a, FR-05b).
- [ ] `prd7-editor-conflict.html`: optimistic conflict dialog
      "Обновить данные" / "Сохранить поверх" (FR-25k).
- [ ] `prd7-editor-status-indicators.html`: индикаторы `изменено` / `warning` /
      `error` на вкладках и секциях с `aria-label` (FR-25b, NFR-21).

Минимальный набор для разблокировки Фазы 4B (reference-секция basic):

- [ ] `prd7-section-basic.html`: вкладка **"Состав"** + секция "Основные":
      title, description, status, feedback, telemetry, webhook (FR-35, FR-36).
- [ ] `prd7-section-basic-feedback-editor.html`: feedback-редактор с базовым
      форматированием bold/italic/links/lists (FR-36).
- [ ] `prd7-section-basic-states.html`: empty/loading/error state базовой секции.

Минимальный набор для разблокировки Фазы 5 (доменные секции):

- [ ] `prd7-structure-linear-flat.html`: вкладка **"Структура"** для `linear_flat`
      (зоны «До теста» / «После теста» + единый блок вопросов из всех тем,
      без группировки по темам).
- [ ] `prd7-structure-linear-by-topics.html`: для `linear_by_topics`
      (темы со страницами до/после внутри каждой темы).
- [ ] `prd7-structure-router.html`: для `router_by_topics` как сценарная карта
      `Router → Раздел → Возврат → Итог` (FR-29, FR-33, FR-40, блокер §7).
- [ ] `prd7-section-adaptive.html`: adaptive-секция с уровнями теста
      и темы (FR-38).
- [ ] `prd7-tests-delete-confirm.html`: confirmation dialog удаления теста
      с вводом точного названия (FR-30).
- [ ] `prd7-tests-archive.html`: раздел **"Архив"** и восстановление (FR-31).
- [ ] `prd7-section-start-pages.html`: стартовая страница как content page
      типа `intro` без `topic_id` (FR-44).
- [ ] `prd7-mode-switch-warning.html`: inline warning при переключении
      `mode` / `flowMode` без удаления данных (FR-25d, FR-25e, FR-25f).
- [ ] `prd7-editor-mobile.html`: mobile/narrow viewport для всех секций.

Полный набор edge-states (для финального acceptance pass в Фазе 7B,
выполняется в Сессии S11 через W.3C):

- [ ] `prd7-tests-list-states.html`: empty list, loading list, error API.
- [ ] `prd7-editor-many-topics.html`: 20+ тем в редакторе.
- [ ] `prd7-editor-empty-topic.html`: тема без вопросов.
- [ ] `prd7-editor-distribution-error.html`: ошибка загрузки difficulty distribution.
- [ ] `prd7-editor-readonly.html`: read-only состояние (archived test).
- [ ] `prd7-editor-save-error.html`: ошибка сохранения с anchor к первой
      ошибочной секции (FR-05a).
- [ ] `prd7-editor-show-changes.html`: grouped summary "Показать изменения" (FR-25c1).

#### W.2 Definition of Done для Фазы W

- [ ] Все wireframes минимального набора подготовлены в `docs/wireframes/`.
- [ ] Каждый wireframe использует токены и компоненты из §W.0
      (CSS variables, shadcn-эквиваленты), без сторонних библиотек/CDN.
- [ ] Каждый wireframe в конце имеет блок `<section class="acceptance">`
      со списком FR/NFR PRD-7, которые он покрывает.
- [ ] Покрыты состояния: default, empty, loading/saving, error, read-only, mobile.
- [ ] Wireframes явно согласованы продакт-ментом и автором PRD-7
      (фиксация в issue/комментарии "Wireframes PRD-7 минимальный набор approved").
- [ ] Правило фиксации: изменение сценария или состава полей в ходе
      UI-разработки возвращает задачу в Фазу W (NFR-14).
- [ ] Пункты §1.3 [implementation-todo.md](prd-7-implementation-todo.md) и
      §W.1 этого документа отмечены `[x]`.

#### W.3A Промпт для Opus: дизайн-система wireframes + reference

```text
Подготовь дизайн-систему wireframes для PRD-7 и первый reference-wireframe.

Источники дизайн-системы (читать ОБЯЗАТЕЛЬНО): см. §W.0
docs/prd-7-execution-strategy.md.

Контракт UI: docs/prd-7-decisions.md §8.

Задачи:
1. Прочитать docs/wireframes/design-tab.html и pages-tab.html. Извлечь общий
   header/style block (CSS-токены, типографика, layout-классы) в общий
   фрагмент, который будет повторяться во всех новых файлах.
2. Создать docs/wireframes/prd7-shared.css с этим фрагментом, чтобы новые
   wireframes подключали его через <link rel="stylesheet">. Если такая структура
   ломает существующие файлы - оставить inline <style>, но в одинаковом виде.
3. Создать docs/wireframes/prd7-editor-drawer.html как REFERENCE-wireframe:
   - wide Drawer min(1120px, calc(100vw - 48px))
   - header: заголовок теста, статус-badge, close button
   - 4 вкладки: "Состав", "Настройки", "Оформление", "Структура"
   - агрегированные индикаторы dirty/warning/error на вкладках (FR-25b)
     с aria-label (NFR-21)
   - footer: единая кнопка "Сохранить" (active при dirty + нет error),
     "Показать изменения" (visible при dirty), строка изменённых областей,
     БЕЗ "Сбросить всё" (FR-05b)
   - placeholder для contents области ("Coming soon")
4. В конце файла добавить <section class="acceptance"> с чек-листом FR-04, FR-05,
   FR-25a, FR-25b, FR-25c, FR-43, NFR-19, NFR-21, которые покрывает wireframe.
5. Добавить mobile-вариант (< 960px) того же экрана как второй блок в файле
   с подзаголовком "Mobile / narrow viewport".

Принципы дизайна (см. §W.0):
- Tailwind/shadcn визуальный язык, никаких сторонних UI.
- HSL дизайн-токены из existing wireframes.
- Single primary action в footer.
- Все статусы: badge + текст + aria-label, без эмоджи и иконок-картинок.
- Card-based layout, radius из --radius.

Anti-goals:
- НЕ менять docs/wireframes/design-tab.html и pages-tab.html без явной задачи.
- НЕ использовать внешние CDN, изображения, эмоджи.
- НЕ изобретать токены, которых нет в существующих файлах или index.css.
- НЕ показывать на wireframe компоненты, которых нет в client/src/components/ui/.

DoD:
- prd7-editor-drawer.html открывается в браузере без ошибок консоли.
- Стиль визуально совместим с design-tab.html и pages-tab.html.
- Acceptance-блок ссылается на конкретные FR/NFR.
- Готово к ревью продактом.
```

После W.3A в той же сессии: `/model sonnet`, затем W.3B.

#### W.3B Промпт для Sonnet: остальные wireframes по reference

После того как Opus подготовил `prd7-editor-drawer.html` и shared CSS, Sonnet
наполняет остальные экраны по образцу.

```text
Создай остальные wireframes минимального набора PRD-7 по образцу reference.

Reference: docs/wireframes/prd7-editor-drawer.html и (если есть)
docs/wireframes/prd7-shared.css. Полностью повторяй стиль, layout-структуру
и acceptance-блок reference-файла.

Источники дизайн-системы: §W.0 docs/prd-7-execution-strategy.md
(читать перед началом).

Контракт UI: docs/prd-7-decisions.md §8.

Список файлов и FR/NFR: §W.1 docs/prd-7-execution-strategy.md
(минимальный набор для Фаз 4A/4B/5, кроме prd7-editor-drawer.html).

Задачи:
1. Для каждого файла из минимального набора (кроме reference):
   - Создать docs/wireframes/<filename>.html с тем же header/footer стилем.
   - Реализовать конкретный экран согласно описанию в §W.1.
   - Покрыть default + один edge state (empty/loading/error/mobile),
     если применимо.
   - В конце файла добавить <section class="acceptance"> с чек-листом
     FR/NFR, перечисленных в §W.1 для этого файла.
2. Для prd7-structure-router.html обязательно показать сценарную карту
   "Router -> Раздел -> Возврат -> Итог" как визуальный flow,
   а не как линейный список (FR-29 PRD-7).

Принципы и anti-goals: как в Фазе W.3A.

Эскалация: если для какого-то экрана состояние не описано в §W.1 или
требует нового UI-паттерна (которого нет в reference и shadcn) - остановись
и эскалируй на Opus с описанием пробела.

DoD:
- Все файлы минимального набора §W.1 (Фазы 4A + 4B + 5) присутствуют.
- Каждый файл открывается в браузере без ошибок.
- Каждый файл имеет acceptance-блок.
- Стиль совместим с reference.
- Готово к ревью продактом.
```

После W.3B - commit, отправка на согласование продакту, `/clear`. Параллельно
с согласованием можно стартовать S2.

#### W.3C Промпт для Sonnet: edge-states (выполняется в Сессии S11)

Запускается перед Фазой 7B, когда основная UI-реализация готова.

```text
Дополни wireframes полным набором edge-states из §W.1
docs/prd-7-execution-strategy.md.

Reference и принципы: те же, что в W.3B.

Задачи:
1. Создать каждый файл из "Полный набор edge-states" §W.1 по образцу
   reference-wireframe.
2. Сосредоточиться на состояниях, которые сложно проверить без визуализации:
   ошибки, конфликты версий, archived/read-only, перегруженные списки.

Anti-goals и DoD: как в W.3B.
```

#### W.4 Что разблокирует параллельно

Пока модель готовит wireframes (S1) и идёт согласование продактом (внешний шаг),
без блокировки можно вести Сессии S2 и S3:

- Фаза 1 (миграция БД и backend foundation);
- Фаза 2 (типы, mappers);
- Фаза 3 (валидация);
- §1.1 implementation-todo.md (baseline и инвентаризация);
- §1.2 implementation-todo.md (контракты с PRD-4 - уже зафиксировано в decisions.md).

После согласования W.2 и завершения Фаз 1-3 можно стартовать Сессию S4
(Фаза 4A + 4B).

---

### Сессия S2 - Фаза 1: Миграция БД и backend foundation

**Модель:** Opus 4.7 (миграция) -> Sonnet 4.6 (storage и endpoints)
**Длительность:** 2-3 сессии

#### Фаза 1A (Opus): SQL-миграция

Промпт для Opus:

```text
Реализуй SQL-миграцию tests.status и связанные изменения схемы PRD-7.

Контракт: §4 docs/prd-7-decisions.md (маппинг published->status,
start_page_content->content_pages, новые колонки test_sections).

Задачи:
1. Создать migrations/003_prd7_test_settings.sql со следующими операциями:
   - ALTER TABLE tests ADD COLUMN status text NOT NULL DEFAULT 'draft'
     CHECK (status IN ('draft', 'published', 'archived'))
   - UPDATE tests SET status = CASE WHEN published THEN 'published' ELSE 'draft' END
   - ALTER TABLE tests ADD COLUMN telemetry_enabled boolean NOT NULL DEFAULT false
   - ALTER TABLE tests ADD COLUMN feedback_json jsonb
   - ALTER TABLE tests ADD COLUMN flow_policy_json jsonb
   - ALTER TABLE test_sections ADD COLUMN required boolean NOT NULL DEFAULT true
   - ALTER TABLE test_sections ADD COLUMN time_limit_minutes integer
   - ALTER TABLE test_sections ADD COLUMN feedback_json jsonb
   - CREATE INDEX tests_status_idx ON tests(status)
   - INSERT INTO content_pages для каждого tests.start_page_content != NULL
     с type='intro', topic_id=NULL, position='before'
2. Обновить shared/schema.ts добавлением новых колонок в Drizzle schema.
3. Создать tests/migrations/migration-prd7.test.ts с проверкой:
   - legacy published=true -> status='published'
   - legacy published=false -> status='draft'
   - tests.start_page_content создаёт content_pages запись
   - test_sections.required = true для существующих записей

DoD: миграция применима на копии prod-данных, npm run check проходит,
migration-prd7.test.ts зелёный.
Anti-goals: НЕ удалять published, НЕ удалять start_page_content,
НЕ менять existing content_pages.
```

#### Фаза 1B (Sonnet): Storage и endpoints

Промпт для Sonnet:

```text
Реализуй backward-compatible storage layer и новые endpoints для PRD-7.

Контракт: §5 docs/prd-7-decisions.md.

Задачи:
1. server/storage.ts: обновить getTests/getTest/createTest/updateTest:
   - всегда читать и писать status
   - синхронизировать published из status (status='published' -> published=true)
   - возвращать новые поля: telemetryEnabled, feedbackJson, flowPolicyJson,
     test_sections.required, test_sections.time_limit_minutes,
     test_sections.feedback_json
2. server/services/test-settings.ts: новый файл с TestSettingsService.
   - Метод save(testId, payload, expectedVersion): сохраняет test + sections +
     adaptive в одной transaction. Бросает VersionConflictError при mismatch.
   - Метод create(payload): создаёт test + sections в transaction.
3. server/routes/tests.ts:
   - PATCH /api/tests/:id/status: меняет status, возвращает 409 при version mismatch.
     Body: { status, expectedVersion }
   - DELETE /api/tests/:id: проверяет body.confirmTitle === test.title,
     возвращает 400 при mismatch.
   - POST /api/tests/:id/restore: переводит archived -> draft.
   - GET /api/tests: добавить query param ?status=archived, по умолчанию
     не показывать archived.
4. tests/services/test-settings.test.ts и tests/routes.tests.test.ts:
   покрыть все новые сценарии и backward compat.

Reference: посмотри как устроен существующий transactional pattern в
server/storage.ts (если есть) или используй db.transaction(async (tx) => ...) из drizzle.

DoD: npm run check, vitest run tests/services/test-settings.test.ts и
tests/routes.tests.test.ts зелёные. Существующие routes.tests.test.ts тоже зелёные.
Anti-goals: НЕ менять контракт существующих POST /api/tests и PUT /api/tests/:id
для legacy clients.
```

---

### Сессия S3 (часть 1) - Фаза 2: Типы, DTO, mappers (frontend foundation)

**Модель:** Opus 4.7 (reference) -> Sonnet 4.6 (наполнение)
**Длительность:** 1-2 сессии

#### Фаза 2A (Opus): Типы и reference-mapper

Промпт для Opus:

```text
Реализуй типы и базовые mappers для редактора теста PRD-7.

Контракт: §2, §3, §4, §6, §7 docs/prd-7-decisions.md, PRD-7 §6.2 и §6.3.

Задачи:
1. client/src/features/tests/editor/test-editor.types.ts:
   реализовать все типы согласно PRD-7 §6.2 и §6.3 + enum из §2 decisions.md.
2. client/src/features/tests/editor/test-editor.mappers.ts:
   - apiToEditorModel(api): полная реализация для basic, runtime, passRules секций
     с применением всех default-ов из §4.4 decisions.md и legacy-маппинга из §4.1, §4.3.
   - editorModelToPayload(model): полная реализация для basic, runtime, passRules
     с правилами из §6 decisions.md.
   - Для секций sections, adaptive, flowSettings оставить заглушку throw.
3. client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts:
   reference-тест с одним полным сценарием для каждого направления:
   - apiToEditorModel: legacy тест (published=false, feedback string, без status)
   - editorModelToPayload: новый тест (status='published', feedback object)
   - apiToEditorModel: новый тест (status='archived')

DoD: npm run check, vitest run этого файла теста зелёный.
Anti-goals: не реализовывать sections/adaptive/flowSettings - оставить заглушку
для следующей фазы.
```

#### Фаза 2B (Sonnet): Дополнить mappers

Промпт для Sonnet:

```text
Дополни test-editor.mappers.ts реализацией для sections, adaptive, flowSettings.

Контракт: docs/prd-7-decisions.md §3, §4, §6, §7.
Reference: уже реализованные basic/runtime/passRules в этом же файле.

Задачи:
1. apiToEditorModel: реализовать sections (с required, timeLimit, feedback),
   adaptive (skip если mode != 'adaptive'), flowSettings (skip если flowPolicyJson null).
2. editorModelToPayload: реализовать sections с правилом FR-45
   (required из sections[], не из passRules.byTopic), adaptive и flowSettings
   с правилом FR-25h (скрытые draft-настройки несовместимого режима не попадают в payload).
3. Расширить test-editor.mappers.test.ts по чек-листу §1.13.1
   docs/prd-7-implementation-todo.md - 10 пунктов unit-тестов.

DoD: npm run check, vitest run mappers test зелёный, все 10 пунктов чек-листа покрыты.
Anti-goals: не менять типы test-editor.types.ts, не менять reference-mapper для
basic/runtime/passRules без явной необходимости.
```

---

### Сессия S3 (часть 2) - Фаза 3: Валидация (zod-схемы)

**Модель:** Sonnet 4.6 (reference) -> Haiku 4.5 (расширение)
**Длительность:** 1 сессия

#### Фаза 3A (Sonnet): Reference-схема

Промпт для Sonnet:

```text
Реализуй базовую zod-схему валидации для редактора теста PRD-7.

Контракт: docs/prd-7-decisions.md §2 (enum), §8.2 (валидация), PRD-7 FR-11..FR-20c.

Задачи:
1. client/src/features/tests/editor/test-editor.validation.ts:
   - validateTestEditor(model): возвращает { errors: ValidationError[],
     warnings: ValidationWarning[] }
   - Тип ValidationError = { field: string, code: string, message: string,
     severity: 'error' | 'warning' }
   - Покрыть валидации: title обязателен (FR-11), минимум одна тема (FR-12),
     overall pass rule percent 0..100 (FR-14), webhook URL валиден (FR-20),
     passDecisionPolicy (FR-15a), passDecisionPolicy='all_topics_passed' блокирует
     inherit_overall при overall.type='none' (FR-15g).
2. client/src/features/tests/editor/__tests__/test-editor.validation.test.ts:
   reference-тест с happy path и одним sad path для каждой валидации.

Reference: используй существующие zod-схемы в shared/schema.ts как пример стиля
(z.object, z.enum, z.string().url()).

DoD: npm run check, vitest run этого теста зелёный.
Anti-goals: не реализовывать валидацию sections/adaptive деталей - оставить для Haiku.
```

#### Фаза 3B (Haiku): Расширение по чек-листу

Промпт для Haiku:

```text
Дополни test-editor.validation.ts валидациями по образцу.

Контракт: PRD-7 FR-13, FR-15, FR-15c, FR-15d, FR-15e, FR-15f, FR-16, FR-17, FR-18, FR-19.
Reference: уже реализованные валидации title/topics/overall/webhook в
client/src/features/tests/editor/test-editor.validation.ts.

Задачи:
1. Добавить валидации по образцу reference-валидаций:
   - drawCount от 1 до topic.maxQuestions (FR-13)
   - absolute pass rule не больше числа выбранных вопросов (FR-15)
   - adaptive level: minDifficulty < maxDifficulty, 0..100 (FR-16)
   - adaptive level: questionsCount >= 1 (FR-17)
   - adaptive level: passThreshold по типу: percent 0..100, absolute 0..questionsCount (FR-18)
   - adaptive link: title и URL обязательны вместе (FR-19)
2. Для каждой добавленной валидации добавить тест в test-editor.validation.test.ts
   по образцу: один happy path, один sad path.

DoD: npm run check, vitest run validation test зелёный, все валидации FR-13..FR-19
покрыты тестами.
Anti-goals: не менять reference-валидации, не менять формат ValidationError,
не добавлять новые правила сверх перечисленных FR.
```

---

### Сессия S4 - Фаза 4: UI-каркас Drawer и reference-секция

**Модель:** Opus 4.7 (Drawer-каркас) -> Sonnet 4.6 (reference-секция)
**Длительность:** 2 сессии

**Блокер:** Фаза W (минимальный набор wireframes для 4A и 4B) согласована.
Если wireframes не готовы, Opus/Sonnet останавливают работу и возвращают задачу
в Фазу W.

#### Фаза 4A (Opus): Drawer-каркас

Промпт для Opus:

```text
Реализуй wide Drawer контейнер для редактора теста PRD-7 без доменных секций.

Контракт: docs/prd-7-decisions.md §8 (UI), PRD-7 FR-04, FR-05, FR-05a, FR-05b,
FR-25a..k, FR-43, NFR-17..NFR-21.

Задачи:
1. client/src/features/tests/editor/test-editor.tsx:
   - Wide Drawer (используй shadcn/ui Sheet или Drawer): width
     min(1120px, calc(100vw - 48px))
   - Tabs: "Состав", "Настройки", "Оформление", "Структура" (заглушки, кроме каркаса)
   - Side nav второго уровня для вкладки "Настройки" (>= 960px) или selector сверху
   - Footer: единая кнопка "Сохранить" (active при dirty + нет error),
     кнопка "Показать изменения" (visible при dirty), строка изменённых областей
   - Confirmation dialog при закрытии с dirty: "Сохранить" / "Выйти без сохранения" / "Отмена"
   - При блокирующих ошибках "Сохранить" в dialog disabled с anchor к первой ошибке
   - Focus on open: первый интерактивный элемент
   - Optimistic conflict dialog "Обновить данные" / "Сохранить поверх"
2. client/src/features/tests/editor/use-test-editor.ts:
   - Hook: загружает test через React Query, держит draft-state в memory
   - Tracks dirty per section + aggregated dirty
   - Tracks errors/warnings per section + aggregated
   - save(): отправляет payload с expectedVersion, обрабатывает 409
   - reset(): сбрасывает draft к снапшоту от API
3. client/src/features/tests/editor/__tests__/test-editor.test.tsx:
   - Component-тесты: открытие, закрытие с dirty (confirmation), focus management,
     conflict dialog.

Reference UI components: посмотри
client/src/components/design-settings-dialog.tsx и
client/src/components/content-pages-dialog.tsx как примеры существующих dialog'ов.

DoD: npm run check, vitest run этого теста зелёный, Drawer открывается из
существующей TestsPage (заглушечный onClick), все индикаторы dirty/error работают.
Anti-goals: НЕ удалять старый wizard в этой фазе. НЕ реализовывать секции -
только заглушки <div>Coming soon</div>.
```

#### Фаза 4B (Sonnet): Reference-секция

Промпт для Sonnet:

```text
Реализуй reference-секцию basic-settings-section.tsx для редактора теста PRD-7.

Контракт: PRD-7 FR-35, FR-36 + decisions.md §3.4 (FeedbackContent).
Reference: Drawer-каркас в client/src/features/tests/editor/test-editor.tsx,
типы в test-editor.types.ts, валидация в test-editor.validation.ts.

Задачи:
1. client/src/features/tests/editor/sections/basic-settings-section.tsx:
   - Поля: title (required), description (optional textarea),
     status (select: draft/published/archived)
   - Feedback editor с базовым форматированием (bold, italic, ссылки, списки).
     Используй существующий rich text компонент проекта если есть, иначе textarea
     с форматом 'plain'.
   - Telemetry toggle (отдельно от webhook URL, FR-35)
   - Webhook URL field (URL валидация)
   - Все поля интегрированы с useTestEditor() hook: чтение из model.basic,
     запись в draft через setBasic()
   - Debounced валидация 300ms (NFR-18) с показом error/warning у поля
2. client/src/features/tests/editor/__tests__/sections/basic-settings-section.test.tsx:
   - Happy path: ввод title, сохранение в draft
   - Sad path: пустой title -> error
   - Sad path: невалидный URL -> error
   - Toggle telemetry: значение пишется в draft

DoD: npm run check, vitest run этого теста зелёный, секция отображается во вкладке
"Настройки" -> "Основные" в Drawer.
Anti-goals: НЕ реализовывать другие секции в этой фазе. НЕ менять useTestEditor
без необходимости.
```

---

### Сессии S5-S8 - Фаза 5: Доменные секции (наполнение по reference)

**Модель:** Haiku 4.5 (с эскалацией на Sonnet при сложностях)
**Длительность:** 3-5 сессий, по одной секции на сессию
**Блокер:** Фаза W (минимальный набор wireframes для 5) согласована.
Если в задаче встречается состояние без wireframe (например, mobile-вариант
структуры или пустой adaptive-уровень), Haiku/Sonnet останавливают работу.

Reference для всех: `basic-settings-section.tsx` + его тест.

#### Сессия S5 / Фаза 5A (Haiku): topics-structure-section

Промпт для Haiku:

```text
Реализуй секцию topics-structure-section.tsx для вкладки "Состав" редактора PRD-7.

Контракт: PRD-7 FR-12, FR-13, FR-15d, FR-34.
Reference: client/src/features/tests/editor/sections/basic-settings-section.tsx -
полностью повторяй паттерн структуры компонента, useTestEditor(), валидации.

Задачи:
1. client/src/features/tests/editor/sections/topics-structure-section.tsx:
   - Список выбранных тем (из model.sections)
   - Для каждой темы: drawCount input (1..topic.maxQuestions),
     required toggle (boolean), timeLimit selector (inherit_test/custom/none)
     с custom minutes input
   - Кнопка "Добавить тему" с диалогом выбора из доступных топиков
   - Удаление темы из списка
   - Все изменения через useTestEditor().setSections()
2. client/src/features/tests/editor/__tests__/sections/topics-structure-section.test.tsx:
   - Happy path: добавить тему, изменить drawCount
   - Sad path: drawCount > maxQuestions -> error
   - Toggle required работает
   - timeLimit selector переключает между inherit_test и custom

DoD: npm run check, vitest run этого теста зелёный.
Anti-goals: НЕ менять reference-секцию basic-settings-section.tsx.
НЕ менять useTestEditor сигнатуру - только использовать существующие методы.
Эскалация: если useTestEditor не имеет setSections - остановись и сообщи.
```

#### Сессия S6 / Фаза 5B (Haiku): pass-rules-section

Промпт для Haiku:

```text
Реализуй pass-rules-section.tsx для редактора PRD-7.

Контракт: PRD-7 FR-15a..FR-15g + decisions.md §2.4, §2.6.
Reference: basic-settings-section.tsx и topics-structure-section.tsx.

Задачи:
1. client/src/features/tests/editor/sections/pass-rules-section.tsx:
   - decisionPolicy selector (4 значения из decisions.md §2.4)
   - overall pass rule: type (percent/absolute/none) + value input
   - Для каждой темы: source selector (inherit_overall/custom/none),
     для custom - type + value
   - Inline warning при invalid combinations (например all_topics_passed +
     inherit_overall + overall.type=none)
2. Test файл по образцу - happy path для каждого decisionPolicy + sad path для FR-15g.

DoD/Anti-goals: те же, что в Фазе 5A.
Эскалация: если не понятна семантика какого-то FR - остановись и сообщи.
```

#### Сессия S7 / Фаза 5C (Haiku): adaptive-settings-section

Промпт для Haiku:

```text
Реализуй adaptive-settings-section.tsx для редактора PRD-7.

Контракт: PRD-7 FR-16..FR-18, FR-32, FR-38.
Reference: предыдущие секции в client/src/features/tests/editor/sections/.
Существующие adaptive-компоненты: ищи в client/src/pages/author/tests.tsx
по слову "adaptive" - там есть существующие level/link UI, можно скопировать паттерн.

Задачи:
1. adaptive-settings-section.tsx:
   - Возвращает null если model.mode !== 'adaptive' (FR-38)
   - showDifficultyLevel toggle (FR-32)
   - Для каждой темы: список уровней (levels) с полями minDifficulty, maxDifficulty,
     questionsCount, passThreshold, passThresholdType
   - Управление links уровня (title + URL)
2. Test файл с happy/sad path по образцу.

DoD/Anti-goals: те же.
Эскалация: если уровни сложности связаны с difficulty distribution API - остановись,
эта зависимость должна быть документирована Sonnet'ом.
```

#### Сессия S8 (часть 1) / Фаза 5D (Haiku): start-pages-section

Промпт для Haiku:

```text
Реализуй start-pages-section.tsx для редактора PRD-7.

Контракт: PRD-7 FR-44 + decisions.md §4.2.
Reference: client/src/components/content-pages-dialog.tsx (существующий компонент
content pages).

Задачи:
1. start-pages-section.tsx:
   - Использовать существующий ContentPagesDialog или его компоненты для управления
     content_pages типа intro без topic_id
   - Если в legacy тесте есть start_page_content и нет content page intro -
     показать баннер "Требуется миграция" со ссылкой на админку
2. Test файл.

DoD/Anti-goals: те же. НЕ менять ContentPagesDialog.
```

#### Сессия S8 (часть 2) / Фаза 5E (Sonnet): design-section (требует интеграции с PRD-1)

Эта секция эскалируется на Sonnet, потому что нужно переиспользовать существующий
`design-settings-dialog.tsx` как inline-компонент.

Промпт для Sonnet:

```text
Реализуй design-section.tsx для редактора PRD-7.

Контракт: PRD-7 FR-26, FR-41, FR-42.
Reference: client/src/components/design-settings-dialog.tsx -
переиспользовать содержимое как inline-секцию (без обёртки Dialog).

Задачи:
1. Извлечь body design-settings-dialog.tsx в отдельный компонент DesignSettingsBody
   (если ещё не extracted) и использовать его в design-section.tsx.
2. templateVersion и templateApiVersion показать read-only (FR-41).
3. Поддержать в форме params типы multiselect, url, file, downloadLink (FR-42)
   если они уже не реализованы.
4. Test файл по образцу.

DoD: npm run check, vitest зелёный, secция отображается во вкладке "Оформление".
Существующий design-settings-dialog продолжает работать без регрессии.
Anti-goals: НЕ ломать существующий flow открытия design dialog из старой TestsPage
до Фазы 7.
```

---

### Сессия S9 - Фаза 6: Тесты по образцу

**Модель:** Haiku 4.5
**Длительность:** 2 сессии

#### Сессия S9 (часть 1) / Фаза 6A (Haiku): Component-тесты

Промпт для Haiku:

```text
Расширь component-тесты для всех секций редактора PRD-7 по чек-листу
§1.13.2 docs/prd-7-implementation-todo.md.

Reference: __tests__/sections/basic-settings-section.test.tsx и
__tests__/test-editor.test.tsx как образец стиля.

Задачи: для каждого пункта чек-листа §1.13.2 добавить тест-кейс. Если кейс уже
покрыт - отметить в комментарии и пропустить.

DoD: vitest run client/src/features/tests/editor зелёный, минимум 1 тест на каждый
пункт чек-листа.
Anti-goals: НЕ менять production-код секций. НЕ менять existing test setup utilities.
Эскалация: если для какого-то теста нужен новый mock или новая утилита - сообщи.
```

#### Сессия S9 (часть 2) / Фаза 6B (Haiku): API и regression тесты

Промпт для Haiku:

```text
Расширь API и regression тесты по чек-листам §1.13.3 и §1.13.4
docs/prd-7-implementation-todo.md.

Reference: tests/routes.tests.test.ts существующий, tests/services/test-settings.test.ts
от Фазы 1B.

Задачи: для каждого пункта чек-листов §1.13.3 и §1.13.4 добавить тест-кейс.

DoD: vitest run всех тестов зелёный, все пункты чек-листов покрыты.
Anti-goals: НЕ менять production routes/storage без острой необходимости.
Эскалация: если тест требует изменения production-кода - сообщи.
```

---

### Сессии S10-S11 - Фаза 7: Удаление legacy и финальный pass

**Модель:** Sonnet 4.6 (удаление) -> Opus 4.7 (acceptance pass)
**Длительность:** 1-2 сессии

#### Сессия S10 / Фаза 7A (Sonnet): Удаление legacy

Промпт для Sonnet:

```text
Удали inline wizard и dialogs из client/src/pages/author/tests.tsx.

Контракт: §1.12 docs/prd-7-implementation-todo.md, anti-goals из decisions.md §1.

Задачи:
1. Удалить inline wizard create/edit из TestsPage. Заменить на открытие нового TestEditor.
2. Удалить inline state для design dialog, content pages dialog, export SCORM dialog
   из TestsPage.
3. Заменить открытие design/content pages на навигацию в соответствующие секции TestEditor.
   Export SCORM остаётся как действие карточки/меню.
4. Удалить все console.log, debugger, dead code.
5. Прогрепать tests.published в production-коде - оставить только обратный маппинг
   (storage layer пишет published = status === 'published').
6. Прогрепать tests.start_page_content в production-коде - удалить чтение,
   оставить только запись (для legacy clients до удаления колонки).

DoD: npm run check, vitest run полностью зелёный (включая existing tests).
Manual: создание/редактирование теста через новый редактор работает end-to-end.
Anti-goals: НЕ удалять колонки tests.published и tests.start_page_content.
НЕ ломать backward compatibility API.
```

#### Сессия S11 (часть 1) / Фаза 7B (Opus): Acceptance pass

В той же сессии S11 после Acceptance pass: `/model sonnet`, затем W.3C
(edge-states wireframes, см. §W.3C в Сессии S1).

**Блокер:** полный набор wireframes Фазы W (минимальный + edge-states из §W.1)
согласован. Acceptance pass сверяет реализацию с wireframes,
а не с воображаемым макетом.

Промпт для Opus:

```text
Финальный acceptance pass PRD-7.

Задачи:
1. Пройти все ~50 acceptance criteria PRD-7 §10 - для каждого либо подтвердить
   реализацию ссылкой на код/тест, либо открыть issue.
2. Проверить полноту покрытия decisions.md - все ли enum/shapes используются
   как заявлено.
3. Lighthouse/axe accessibility audit Drawer (NFR-19..NFR-21).
4. Performance check: Drawer открывается за < 1.5s на тесте с 20 темами (NFR-17).
5. Manual end-to-end smoke:
   - create standard, edit standard
   - create adaptive, edit adaptive
   - переключение standard <-> adaptive
   - переключение flowMode
   - удаление с вводом названия
   - архив и восстановление
   - optimistic conflict при параллельной правке статуса

Выход: docs/prd-7-acceptance-report.md со списком пройденных/непройденных criteria
и issues для невыполненных.

Anti-goals: НЕ начинать новые фичи. Только проверка и фиксация результата.
```

---

## 3. Сводная таблица

| Сессия | Фаза | Что | Исполнитель | Блокирует |
| --- | --- | --- | --- | --- |
| S0 | 0 | Контракты, decisions.md, skeleton | Opus | все |
| S1 | W.3A | Wireframes: дизайн-система + reference | Opus | W.3B, 4 |
| S1 | W.3B | Wireframes: остальные экраны минимального набора | Sonnet | 4, 5 |
| - | W.согл. | Согласование wireframes (внешнее) | Продакт | 4, 5 |
| S2 | 1A | SQL-миграция | Opus | 1B, 7B |
| S2 | 1B | Storage и endpoints | Sonnet | 4A, 7B |
| S3 | 2A | Типы и reference-mapper | Opus | 2B, 4 |
| S3 | 2B | Дополнить mappers | Sonnet | 4 |
| S3 | 3A | Reference-валидация | Sonnet | 3B, 4 |
| S3 | 3B | Расширение валидации | Haiku | 4 |
| S4 | 4A | Drawer-каркас (требует W согласования) | Opus | 4B, 5 |
| S4 | 4B | Reference-секция (требует W согласования) | Sonnet | 5 |
| S5 | 5A | Секция topics-structure | Haiku | 6 |
| S6 | 5B | Секция pass-rules | Haiku | 6 |
| S7 | 5C | Секция adaptive-settings | Haiku | 6 |
| S8 | 5D | Секция start-pages | Haiku | 6 |
| S8 | 5E | Секция design | Sonnet | 6 |
| S9 | 6A | Component-тесты | Haiku | 7 |
| S9 | 6B | API и regression тесты | Haiku | 7 |
| S10 | 7A | Удаление legacy | Sonnet | 7B |
| S11 | 7B | Acceptance pass | Opus | - |
| S11 | W.3C | Wireframes: edge-states | Sonnet | - |

**Итого: 12 сессий моделей** (S0...S11) против ~19-21 фазы. Экономия за счёт
группировки через `/model`-переключение внутри сессии (см. §1.4).
Распределение моделей: Opus ~6, Sonnet ~8-9, Haiku ~5-6, плюс 1-2 итерации
согласования продактом между S1 и S4.

**Параллельно:** S1 (генерация wireframes моделью) идёт одновременно с S2/S3
(backend и доменные слои не зависят от UI).

---

## 4. Чек-лист перед каждым PR

Применяется на любой фазе:

- [ ] Изменён только указанный в задаче scope файлов.
- [ ] `npm run check` проходит.
- [ ] Затронутые vitest-файлы зелёные.
- [ ] Нет `console.log`, `debugger`, `TODO`, `FIXME`.
- [ ] Все enum-значения и default-значения соответствуют [decisions.md](prd-7-decisions.md).
- [ ] Если задача требует нового контракта - НЕ изобретён, а эскалирован на Opus.
- [ ] Для UI-фаз (4, 5, UI-часть 7B): соответствующие wireframes из §W.1 согласованы
      и доступны в `docs/wireframes/`. Если wireframe для конкретного состояния
      отсутствует - работа возвращается в Фазу W, состояние не изобретается.
- [ ] **Передача знания между сессиями:** если в этой сессии принято решение
      сверх decisions.md (новый контракт, edge case, лучший паттерн) -
      зафиксировано в [decisions.md](prd-7-decisions.md), reference-коде или
      [implementation-todo.md](prd-7-implementation-todo.md) ДО завершения
      сессии. Иначе знание потеряется при `/clear` (см. §1.4).

---

## 5. Признаки необходимости эскалации

Младшая модель должна остановиться и эскалировать на старшую, если:

1. Задача требует enum/shape, не описанного в [decisions.md](prd-7-decisions.md).
2. Reference-имплементация не покрывает паттерн, который требуется для текущей задачи.
3. Тест требует изменения production-кода вне scope текущей задачи.
4. Возникает конфликт с существующим API/типами, не предусмотренный задачей.
5. Дважды подряд не удаётся сделать тесты зелёными.
6. Появляется неожиданная зависимость от другого PRD (PRD-4, PRD-6, PRD-8).
7. Для UI-фазы отсутствует согласованный wireframe конкретного состояния
   (включая edge state: empty, loading, error, mobile, read-only).
   Не изобретать макет - возвращать в Фазу W.

В случае эскалации - НЕ изобретать обходные пути. Зафиксировать гэп и остановиться.

---

## 6. Краткая шпаргалка по командам

```text
# Переключение моделей внутри сессии (сохраняет cache PRD-7/decisions.md)
/model opus
/model sonnet
/model haiku

# Граница между сессиями (после commit + обновления decisions.md)
/clear

# Проверка
npm run check
npx vitest run <path-to-test>
npx vitest run                          # полный suite перед PR

# Применение миграции (Фаза 1A)
DATABASE_URL=... npm run db:push
npx tsx tests/migrations/migration-prd7.test.ts
```

Признаки, что пора закончить сессию:

- размер контекста подходит к 80k токенов;
- задача из плана сессии завершена и DoD выполнен;
- следующая фаза работает в другой зоне кода;
- требуется внешнее действие (миграция БД, согласование, code review).

Признаки, что НЕ пора закончить сессию:

- 1-2 неудачные итерации - это сигнал эскалировать модель, а не делать `/clear`;
- хочется «начать с чистого листа после ошибки» - новая сессия не узнает,
  что не сработало.
