# PRD-7: Стратегия реализации с переключением моделей

**Версия:** 1.2
**Последняя актуализация:** 2026-05-25 (закрыты S0–S8; Drawer + все секции +
FeedbackEditorModal реализованы; UI стек UniversityRT DS `ou-*`/`tb-*`;
S9–S11 — тесты, удаление legacy, acceptance — не начаты)
**Назначение:** Пошаговая инструкция по реализации PRD-7 разными моделями Claude Code.
**Связанные документы:**

- [PRD-7](prd-7-test-settings-editor-refactor.md) - источник требований
- [decisions.md](prd-7-decisions.md) - контракты, enum, JSON-shapes (читать перед кодом)
- [implementation-todo.md](prd-7-implementation-todo.md) - детальный список задач
- [PRD-1 §4.3](prd-1-templates-content-pages.md) - variant.kind модель (внесена 2026-05-21)

---

## 0. Текущий статус (на 2026-05-25)

| Сессия | Фаза | Статус | Артефакты |
| --- | --- | --- | --- |
| S0 | Контракты + skeleton | Закрыта | `decisions.md`, `client/src/features/tests/editor/` skeleton |
| S1 | Wireframes 153/153 | Закрыта 2026-05-21 | `docs/wireframes/approved/*.html`, `wireframes-acceptance-checklist.md` |
| S2 | Backend foundation | Закрыта | migration 003 + 004, `TestSettingsService`, `PATCH /status`, `DELETE`, `restore` endpoints |
| S2+ | Block 1A — variant.kind contract | Закрыта 2026-05-22 | zod-схемы манифеста, `validateManifest()`, `kind` field в default/corporate/minimal manifests |
| S2+ | Block 1B — silent variant binding | Закрыта 2026-05-22 | `server/services/variant-binding.ts` (pure functions) |
| S2+ | Block 1C — content_pages lifecycle | Закрыта 2026-05-22 | `server/services/content-pages-lifecycle.ts` + reconciliation в `TestSettingsService.save()` |
| S2+ | Block 1D — replace-variant endpoint | Закрыта 2026-05-22 | `POST /api/tests/:id/content-pages/:pageId/replace-variant` (FR-46) |
| S2+ | Block 1E — required-fields validation | Закрыта 2026-05-22 | `required-fields-validator.ts` + hook в `save()` при `status=published` |
| S2+ | Route-gap closure | Закрыта 2026-05-22 | `POST /api/tests` и `PUT /api/tests/:id` переведены на `testSettingsService.create()/save()` |
| S3 | Mappers + validation | Закрыта | 46 unit-тестов покрывают `apiToEditorModel`, `editorModelToPayload`, `validateTestEditor` |
| S4 | Фаза 4A Drawer каркас | Частично (FR-05, FR-25c, FR-25k, FR-20c, NFR-19-21 не закрыты) | `test-editor.tsx`, `use-test-editor.ts`, tests-list explorer (`afc5fe5` + `0850a64` + fix-commits) |
| S4 | Фаза 4B Reference basic-settings | Закрыта 2026-05-25 | `basic-settings-section.tsx` + FeedbackEditorModal (tb-rte + PDF assets) (`afc5fe5`, `0257b5b`, `57d77c1`) |
| S5 | Секция topics-structure | Закрыта 2026-05-25 | `topics-structure-section.tsx` + FeedbackPreview + TopicRow feedback integration (`afc5fe5`, `0257b5b`) |
| S6 | Секция pass-rules | Закрыта 2026-05-25 | `pass-rules-section.tsx` внутри настроек Drawer (`afc5fe5`) |
| S7 | Секция adaptive-settings | Закрыта 2026-05-25 | `adaptive-settings-section.tsx` + AdaptiveLevelCard + hide-in-standard (`afc5fe5`, `d5f3699`, `9331adf`, `2a77fd6`, `b68b0d3`) |
| S8 | Секция start-pages + design | Закрыта 2026-05-25 | `start-pages-section.tsx` (Structure tab), `design-section.tsx` (Design tab + ColorPicker) (`afc5fe5`, `88d3435`, `86ab7f0`) |
| S9 | Component + API тесты | Не начата | Следующая сессия |
| S10 | Удаление legacy | Не начата | Зависит от S9 |
| S11 | Acceptance pass | Не начата | Финал |

Незакрытые пункты S4-S8 (переходят в S9 или отдельный fix):

- FR-05 confirmation dialog при закрытии с несохранёнными изменениями
- FR-25c «Показать изменения» grouped summary в footer
- FR-25k optimistic conflict dialog (409 Conflict)
- FR-39 warning в «Структуре» при отсутствии system element
- NFR-19/20/21 focus trap + aria-label на индикаторах

Полный регрессионный набор на 2026-05-25: **~19 файлов × ~457 тестов, npm run check 0 errors**.

Контракты, внесённые после S0 и НЕ описанные оригинальной стратегией (Block 1A-1E),
зафиксированы в новой Фазе 1C-E ниже (§ «Сессия S2-расширения»).

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

| Сессия | Содержимое | Модели в сессии | Граница после | Статус |
| --- | --- | --- | --- | --- |
| S0 | Фаза 0 | Opus | `/clear` | ✓ Закрыта |
| S1 | Фаза W.3A + W.3B | Opus -> Sonnet | согласование (внешнее) | ✓ Закрыта 2026-05-21 |
| S2 | Фаза 1A + 1B | Opus -> Sonnet | `/clear` | ✓ Закрыта |
| S2+ | Block 1A-1E + route-gap | Opus -> Sonnet | `/clear` | ✓ Закрыта 2026-05-22 |
| S3 | Фаза 2A + 2B + 3A + 3B | Opus -> Sonnet -> Haiku | `/clear` | ✓ Закрыта |
| S4 | Фаза 4A + 4B | Opus -> Sonnet | `/clear` | ✓ Закрыта 2026-05-25 |
| S5 | Фаза 5A | Haiku | `/clear` | ✓ Закрыта 2026-05-25 |
| S6 | Фаза 5B | Haiku | `/clear` | ✓ Закрыта 2026-05-25 |
| S7 | Фаза 5C | Haiku | `/clear` | ✓ Закрыта 2026-05-25 |
| S8 | Фаза 5D + 5E | Haiku -> Sonnet | `/clear` | ✓ Закрыта 2026-05-25 |
| S9 | Фаза 6A + 6B | Haiku | `/clear` | Не начата (следующая) |
| S10 | Фаза 7A | Sonnet | `/clear` | Не начата |
| S11 | Фаза 7B + W.3C | Opus -> Sonnet | финал | Не начата |

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

> **Обновление 2026-05-22:** wireframes S1 утверждены и реализованы на DS
> UniversityRT, а НЕ на shadcn/ui. Дальнейшая UI-разработка обязана использовать
> ту же DS, иначе расхождение с утверждёнными эскизами = блокер
> (`feedback_wireframes_first_ui`). Старая инструкция «Tailwind + shadcn/ui»
> относилась к до-S1 этапу и более не действует.

Перед созданием/реализацией любого UI модель ОБЯЗАНА прочитать:

- `ENGINERING_HANDBOOK/design-system/AI-AGENT.md` — обязательный гайд для AI-агента
  по DS UniversityRT (порядок проверок, запреты, токены).
- `ENGINERING_HANDBOOK/design-system/DESIGN_SYSTEM_RT.md` — каталог DS-классов
  (`ou-drawer`, `ou-tabs`, `ou-btn`, `ou-iconbtn`, `ou-tag`, `ou-banner`,
  `ou-field`, `ou-modal`, `ou-seg` и т.д.) с правилами BEM-композиции.
- `ENGINERING_HANDBOOK/design-system/DESIGN_SYSTEM_RT_API.md` — токены
  (`--ou-bg-*`, `--ou-fg-*`, `--ou-accent-*`, `--ou-warning-*`, `--ou-space-*`,
  `--ou-radius-*` и т.д.), типографика, breakpoints.
- `docs/wireframes/approved/*.html` — утверждённые эскизы (153/153 закрыты
  2026-05-21). `prd7-editor-drawer.html` — эталонный контейнер; вкладочные
  файлы повторяют его структуру.
- `docs/wireframes/approved/prd7-shared.css` — общий wireframe-каркас
  (`wf-nav`, `wf-state`, `shell`); импортирует `ds/university-rt.css`.
- `client/src/styles/tb-components.css` — DS-расширения уровня проекта
  (`tb-topic-row`, `tb-draw-count-row`, `tb-feedback-preview`,
  `tb-saving-overlay`, `tb-changes-popover` и т.д.).
- `client/src/components/design-settings-dialog.tsx`,
  `client/src/components/content-pages-dialog.tsx` — существующие диалоги
  PRD-1 как пример интеграции в текущий проект (но они НЕ являются
  визуальным reference для PRD-7 Drawer — reference это approved wireframes).
- `client/src/pages/author/tests.tsx` — текущий wizard как источник legacy-кода,
  подлежащего удалению в Фазе 7A.

Принципы дизайна (выводятся из источников выше):

- **DS-only:** UI собирается из `ou-*` (UniversityRT) и `tb-*` (расширения).
  Локальные классы (`wf-dialog*`, `wf-overlay`, `wf-bg-*`) — запрещены
  (`feedback_wf_only_skeleton_frame`).
- **Токены-only:** цвета/spacing/radius через `var(--ou-*)`. Hex/HSL/RGB,
  именованные цвета, прямые `px` — запрещены (проверка `npm run check:wireframes:ds`).
- **Scope desktop ≥ 960px.** Mobile (< 960px) вынесен за scope PRD-7 — отдельный PRD
  (см. § «Out-of-scope: mobile» ниже).
- **Severity-rail и row-menu** — единые правила из PRD-1 §4.3.7 и §4.3.3
  (приоритет `error > warning > info`; row-menu без disabled-пунктов для
  системных kind).
- Status communication: `ou-tag` + цвет + `aria-label` (NFR-21).
- Single primary action per drawer footer.
- Эмоджи и иконки-картинки НЕ используются (только sprite через `<use href="#i-*">`).

#### W.1 Артефакты — ЗАКРЫТО 2026-05-21

Целевая директория: `docs/wireframes/approved/`. Согласовано
дизайнером / PM 2026-05-21; полный приёмочный чек-лист (153/153 пункта) —
`docs/wireframes/wireframes-acceptance-checklist.md`.

**Утверждённые файлы (вместо до-S1 минимального набора):**

- [x] `prd7-shared.css` (общий wireframe-каркас, импортирует DS)
- [x] `prd7-editor-drawer.html` — эталон контейнера Drawer + все вкладочные
      состояния (`s-default`, `s-default-adaptive` (FR-36), `s-dirty`, `s-error`,
      `s-saving`, `s-changes`, `s-settings`, `s-feedback-edit` (FR-36 + FR-37 + FR-37a))
- [x] `prd7-tests-list.html` (FR-30, FR-31, FR-08 BRD)
- [x] `prd7-tests-delete-confirm.html` (FR-30)
- [x] `prd7-tests-archive.html` (FR-31)
- [x] `prd7-editor-settings-tab.html` (FR-43, NFR-19, NFR-20; desktop-only)
- [x] `prd7-design-tab.html` (FR-26, FR-41, FR-42)
- [x] `prd7-structure-linear-flat.html` (FR-29, FR-33, FR-40, info-banner для смены режима)
- [x] `prd7-structure-linear-by-topics.html`
- [x] `prd7-structure-router.html` — **новая модель** (см. [decisions.md §2.3b](prd-7-decisions.md)):
      зоны «До теста»/«После теста» + системная router-row + темы как ветки
      иерархии через tree-connectors. Сценарная карта `Router → Раздел → Возврат → Итог`
      из до-S1 модели НЕ актуальна — она была заменена на иерархию веток.
- [x] `prd7-variant-replace.html` (FR-46, модал смены варианта с diff потерь)
- [x] `prd7-editor-close-confirm.html` (FR-05, FR-05a, FR-05b)
- [x] `prd7-editor-conflict.html` (FR-25k)
- [x] `prd7-mode-switch-warning.html` (FR-25d, FR-25e, FR-25f — переформулирован
      под info-banner модель FR-40 v2)
- [x] `prd7-editor-status-indicators.html` (FR-25b, NFR-21)

**Out-of-scope PRD-7 (вынесено явным решением 2026-05-21):**

- ~~`prd7-editor-mobile.html` (< 960px)~~ — отдельный PRD, временный fallback
  удалён (§21 acceptance-checklist).
- ~~`prd7-section-*.html`~~ — состояния всех секций интегрированы в
  `prd7-editor-drawer.html` как state'ы single-page wireframe; отдельные файлы
  удалены как дубликаты (§12-16 acceptance-checklist).

**Edge-states для финального acceptance pass (Фаза 7B / W.3C):** перенесены
в общий чек-лист, не требуют отдельных файлов. Состояния empty/loading/error
покрыты state-switcher'ом в `prd7-editor-drawer.html`.

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

### Сессия S2-расширения — Фаза 1C-1E: variant.kind контракт и lifecycle

**Модель:** Opus 4.7 + Sonnet 4.6 (последовательно, без `/clear` между блоками)
**Длительность:** Закрыта 2026-05-22 (1 сессия)
**Источник требований:** [PRD-1 §4.3](prd-1-templates-content-pages.md) (внесён 2026-05-21
параллельно с приёмкой S1 wireframes) + PRD-7 FR-46, §1.4.

Этот блок появился ПОСЛЕ оригинальной стратегии: контрактные дополнения PRD-1 §4.3
(`variant.kind` enum, row-menu, severity-rail, required-params validation) были
добавлены 2026-05-21 в спецификацию и требовали отдельной backend-имплементации.
Зафиксирован для согласованности с реальным графом коммитов и для будущих PRD,
где может встретиться аналогичный паттерн «контракт пришёл вместе с эскизами».

**Подфазы (выполнены последовательно):**

| Block | Что | Артефакты | Состояние |
| --- | --- | --- | --- |
| 1A | `VariantKind` enum + zod-схемы манифеста + `kind` поле в `manifest.json` встроенных шаблонов | `shared/schema.ts`, `server/template-registry.ts`, `tests/manifest-variant-kind.test.ts`, migration 004 | ✓ |
| 1B | Silent variant binding (pure functions, 1/N/0 правила из PRD-1 §4.3.2) | `server/services/variant-binding.ts` | ✓ |
| 1C | Content_pages lifecycle planner + интеграция в `TestSettingsService.create()/save()` | `server/services/content-pages-lifecycle.ts`, `_reconcileSystemPages()` | ✓ |
| 1D | `POST /api/tests/:id/content-pages/:pageId/replace-variant` endpoint (FR-46) | `server/routes/content-pages.ts` | ✓ |
| 1E | Required-fields validation на publish-transition (PRD-1 §4.3.6) | `server/services/required-fields-validator.ts`, `_validateAllRequiredFields()` | ✓ |
| — | Route-gap closure: `POST/PUT /api/tests` мигрированы на `testSettingsService` | `server/routes/tests.ts`, `tests/routes.tests.test.ts` | ✓ |

**Что зафиксировано как контракт для следующих PRD:**

- Default-шаблон ОБЯЗАН содержать минимум один `kind: "questions"` вариант
  (системный fallback). Проверяется `defaultTemplateManifestSchema.refine()`.
- Системные `content_pages` (intro/summary/router/questions) живут в общей
  таблице с пользовательскими (kind: info); жизненный цикл управляется
  `planSystemPages()` — pure-функция, вызывается из транзакции при
  изменениях `sections` / `flowPolicyJson` / `designSettingsJson`.
- Параметры варианта при смене `templateKey` переносятся по правилу
  «имя поля = контракт между вариантами одного `kind`» (PRD-1 §4.3.3).
- Required-fields валидация — soft на draft-saves, hard на transition
  в `status: "published"`. Frontend блокирует Save при незаполненных
  required-полях; server — defense in depth (422 со структурированным
  `fields: [{ pageId, templateKey, fieldName }]`).

**Урок для следующих сессий:** если внутри сессии S2 (или любой backend-сессии)
обнаруживается, что эскизы вносят НОВЫЙ контракт сверх PRD-7 — НЕ
имплементировать сразу. Сначала зафиксировать в [decisions.md](prd-7-decisions.md)
и в [PRD-1 §4.3](prd-1-templates-content-pages.md) (или соответствующем PRD),
получить согласование. Только после этого — реализация. Иначе backend и UI
разойдутся.

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

Контракт:
- docs/prd-7-decisions.md §8 (UI)
- docs/prd-7-test-settings-editor-refactor.md FR-04, FR-05, FR-05a, FR-05b,
  FR-25a..k, FR-43, NFR-17..NFR-21
- ENGINERING_HANDBOOK/design-system/{AI-AGENT,DESIGN_SYSTEM_RT,DESIGN_SYSTEM_RT_API}.md —
  обязательное чтение ДО кода (см. §W.0)
- docs/wireframes/approved/prd7-editor-drawer.html — VISUAL CONTRACT,
  любое расхождение = блокер (`feedback_wireframes_first_ui`)

Стек UI:
- DS UniversityRT (ou-* классы): ou-drawer-root, ou-drawer__backdrop,
  ou-drawer (ou-drawer--xl ou-drawer--right), ou-drawer__head/__body/__foot,
  ou-drawer__close, ou-tabs (ou-tabs--underline ou-tabs--m), ou-tabs__list,
  ou-tabs__tab, ou-btn (ou-btn--primary/--secondary/--ghost), ou-tag,
  ou-banner. Локальные классы (wf-dialog*, wf-overlay) — ЗАПРЕЩЕНЫ.
- DS-расширения проекта (tb-* в client/src/styles/tb-components.css):
  tb-saving-overlay, tb-changes-popover, status-dot (агрегированные индикаторы).
- НЕ использовать shadcn/ui компоненты (Dialog, Sheet, Drawer, Tabs из
  client/src/components/ui/*) — это устаревший стек, не соответствует
  утверждённым эскизам.

Задачи:
1. client/src/features/tests/editor/test-editor.tsx:
   - Структура DOM ОДИН-В-ОДИН с эскизом prd7-editor-drawer.html (state s-default):
     ou-drawer-root[role=dialog,aria-modal=true,aria-labelledby] →
     ou-drawer__backdrop + aside.ou-drawer.ou-drawer--xl.ou-drawer--right →
     header.ou-drawer__head (title + status-tag + version-tag + close-button) +
     nav.ou-tabs.ou-tabs--underline.ou-tabs--m → div.ou-tabs__list[role=tablist] +
     div.ou-drawer__body[tabindex=0] (заглушка per tab) +
     footer.ou-drawer__foot (Закрыть + Сохранить).
   - Tabs: "Состав", "Настройки", "Оформление", "Структура" (заглушки тел).
   - Агрегированные индикаторы dirty/warning/error на табах: status-dot
     с классами .dirty/--warn/--error + aria-label (FR-25b, NFR-21).
   - Footer: единая кнопка "Сохранить" (ou-btn--primary, disabled при !dirty
     || error), "Показать изменения" popover (visible при dirty) — открывает
     state s-changes по эскизу.
   - Close button (×) с FR-05 confirmation dialog по эскизу
     prd7-editor-close-confirm.html: ou-modal--m, 3 кнопки
     "Сохранить и выйти" / "Выйти без сохранения" / "Отмена". При блокирующих
     ошибках "Сохранить и выйти" disabled.
   - Optimistic conflict dialog по эскизу prd7-editor-conflict.html
     (ou-modal--m, ou-modal__icon--warning, "Обновить данные" / "Сохранить поверх").
   - Focus on open: первый интерактивный элемент (NFR-19).
   - Tab/Shift-Tab не выходят за пределы Drawer (NFR-20).
2. client/src/features/tests/editor/use-test-editor.ts:
   - Hook на @tanstack/react-query: загружает test через GET /api/tests/:id,
     держит draft-state в React state в памяти (FR-25j — НЕ писать в
     localStorage/sessionStorage).
   - Tracks dirty per tab/section + агрегированный dirty.
   - Tracks errors/warnings per tab/section через validateTestEditor (debounced
     300ms, FR-20a, NFR-18).
   - save(): PUT /api/tests/:id с expectedVersion, обрабатывает 409 (показ
     conflict dialog), 422 RequiredFieldsMissingError (anchor к первому
     missing field в нужной секции).
   - reset(): сбрасывает draft к снапшоту от API.
3. client/src/features/tests/editor/__tests__/test-editor.test.tsx:
   - Component-тесты: открытие, close-confirmation при dirty, focus management,
     409 conflict dialog, 422 anchor.

DoD:
- npm run check, vitest run для editor зелёные.
- Drawer открывается из TestsPage (временный onClick на карточке).
- Скриншот в Playwright совпадает с эскизом prd7-editor-drawer.html
  s-default (см. README по запуску storybook/dev в проекте).
- Линтер DS: npm run check:wireframes:ds зелёный для UI-кода тоже.

Anti-goals:
- НЕ использовать shadcn Dialog/Sheet/Drawer (старый стек, не утверждён).
- НЕ изобретать локальные классы (wf-*, custom-*) — только ou-* и tb-*.
- НЕ удалять старый wizard в этой фазе.
- НЕ реализовывать секции — только заглушки.
- НЕ писать draft в localStorage/sessionStorage (FR-25j).
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

| Сессия | Фаза | Что | Исполнитель | Блокирует | Статус |
| --- | --- | --- | --- | --- | --- |
| S0 | 0 | Контракты, decisions.md, skeleton | Opus | все | ✓ |
| S1 | W.3A | Wireframes: дизайн-система + reference | Opus | W.3B, 4 | ✓ 2026-05-21 |
| S1 | W.3B | Wireframes: остальные экраны минимального набора | Sonnet | 4, 5 | ✓ 2026-05-21 |
| - | W.согл. | Согласование wireframes (внешнее) | Продакт | 4, 5 | ✓ 2026-05-21 |
| S2 | 1A | SQL-миграция | Opus | 1B, 7B | ✓ |
| S2 | 1B | Storage и endpoints | Sonnet | 4A, 7B | ✓ |
| S2+ | 1A-1E + route-gap | variant.kind contract + lifecycle + replace-variant + required-fields + route migration | Opus → Sonnet | 4, 5 | ✓ 2026-05-22 |
| S3 | 2A | Типы и reference-mapper | Opus | 2B, 4 | ✓ |
| S3 | 2B | Дополнить mappers | Sonnet | 4 | ✓ |
| S3 | 3A | Reference-валидация | Sonnet | 3B, 4 | ✓ |
| S3 | 3B | Расширение валидации | Haiku | 4 | ✓ |
| S4 | 4A | Drawer-каркас (DS UniversityRT, не shadcn) | Opus | 4B, 5 | Частично (FR-05/25c/25k/20c, NFR-19-21 не закрыты) |
| S4 | 4B | Reference-секция basic-settings + s-feedback-edit | Sonnet | 5 | ✓ 2026-05-25 |
| S5 | 5A | Секция topics-structure | Haiku | 6 | ✓ 2026-05-25 |
| S6 | 5B | Секция pass-rules | Haiku | 6 | ✓ 2026-05-25 |
| S7 | 5C | Секция adaptive-settings | Haiku | 6 | ✓ 2026-05-25 |
| S8 | 5D | Секция start-pages | Haiku | 6 | ✓ 2026-05-25 |
| S8 | 5E | Секция design | Sonnet | 6 | ✓ 2026-05-25 |
| S9 | 6A | Component-тесты | Haiku | 7 | Не начата (следующая) |
| S9 | 6B | API и regression тесты | Haiku | 7 | Не начата |
| S10 | 7A | Удаление legacy | Sonnet | 7B | Не начата |
| S11 | 7B | Acceptance pass | Opus | - | Не начата |
| ~~S11~~ | ~~W.3C~~ | ~~Wireframes: edge-states~~ | — | — | Снято со scope — edge-states интегрированы как state'ы единого `prd7-editor-drawer.html` |

**Итого: 12 сессий моделей** (S0...S11) + 1 расширенная S2 для контрактов PRD-1 §4.3.
Закрыто полностью: S0–S3, S2+, S4/4B, S5–S8. S4/4A — частично (§1.7 пункты FR-05/25c/25k/20c, NFR-19-21).
Остаток S4/4A + S9, S10, S11. Следующая: S9 (component + API тесты) + довыполнение S4/4A.
Экономия за счёт группировки через `/model`-переключение внутри сессии (см. §1.4).

**Параллельно:** S1 (генерация wireframes моделью) шла одновременно с S2/S3
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
