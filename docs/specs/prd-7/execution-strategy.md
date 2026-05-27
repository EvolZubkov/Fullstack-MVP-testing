# PRD-7: Стратегия реализации с переключением моделей (S9-S11)

**Версия:** 1.3
**Последняя актуализация:** 2026-05-27 (S0-S9 закрыты; история S0-S8 в
`specs/prd-7/s0-s8-closed.md`, детали закрытия S9 — в `s9-s11-in-progress.md`)
**Назначение:** Пошаговая инструкция и промпты для оставшихся фаз PRD-7 (S10-S11).
**Статус:** S9 закрыта 2026-05-27; S10 почти закрыта 2026-05-27 (остаток — чтение
`start_page_content` из runtime/SCORM, отдельный шаг); S11 — следующая
**Связанные документы:**

- [PRD-7 S9-S11 in-progress](./s9-s11-in-progress.md) — детальный чек-лист
  активных фаз и DoD
- [PRD-7 S0-S8 closed](./s0-s8-closed.md) — архив закрытых фаз с коммитами и
  артефактами
- [decisions.md](./decisions.md) — контракты, enum, JSON-shapes (читать перед кодом)
- [implementation-todo.md](./implementation-todo.md) — активные tasks S9-S11
- [PRD-1 §4.3](../prd-1/templates-content-pages.md) — variant.kind модель

---

## 0. Текущий статус (на 2026-05-27)

| Сессия | Фаза | Статус | Артефакты |
| --- | --- | --- | --- |
| S0-S8 | Контракты, wireframes, backend, mappers/validation, UI | Закрыты 2026-05-25 | См. [specs/prd-7/s0-s8-closed.md](./s0-s8-closed.md) |
| S9 | Component + API тесты + FR-20c | Закрыта 2026-05-27 | Тесты + FR-20c; полный suite 1375 зелёных |
| S10 | Удаление legacy | Почти закрыта 2026-05-27 (остаток — runtime-read) | Зависит от S9 (закрыта) |
| S11 | Acceptance pass | **Активна (следующая)** | Финал |

Регрессия на момент закрытия S0-S8: ~19 файлов × ~457 тестов. На закрытие S9
(2026-05-27): полный `vitest run` — 52 файла / 1375 тестов, `npm run check` 0 ошибок.

Пункт S4/4A — FR-20c (anchor-навигация из summary ошибки к проблемному полю) —
реализован в S9 (2026-05-27).

---

## 1. Принципы

### 1.1 Какая модель что делает

| Модель | Сильные стороны | Где использовать |
| --- | --- | --- |
| Opus 4.7 | Архитектура, чтение PRD/BRD целиком, конфликты, финальный acceptance | Acceptance pass S11 |
| Sonnet 4.6 | Сложные секции, рефакторинг, удаление legacy | S10, W.3C при необходимости |
| Haiku 4.5 | Копирование паттернов, шаблонные тесты | S9 (component + API тесты) |

### 1.2 Правила переключения

1. Эскалация назад (Haiku → Sonnet → Opus) при первых же двух неудачных итерациях.
2. Возврат на Opus обязателен при: новом контракте, конфликте PRD, edge-case вне
   `decisions.md`, финальном acceptance pass.

### 1.3 Переключение в Claude Code

```text
/model opus     -- acceptance, новые контракты
/model sonnet   -- удаление legacy, edge-state wireframes
/model haiku    -- тесты по образцу
/clear          -- очистить контекст между независимыми сессиями
```

### 1.4 Группировка фаз в сессии

Один промпт != одна сессия. Внутри одной сессии переключение моделей через
`/model` сохраняет kv-cache и уже прочитанные файлы. `/clear` между независимыми
зонами кода.

Рекомендованная нарезка оставшихся сессий:

| Сессия | Содержимое | Модели в сессии | Граница после |
| --- | --- | --- | --- |
| S9 | Фаза 6A + 6B (component + API/regression) | Haiku | `/clear` |
| S10 | Фаза 7A (удаление legacy) | Sonnet | `/clear` |
| S11 | Фаза 7B (acceptance) + W.3C при необходимости | Opus → Sonnet | финал |

---

## 2. Фазы реализации S9-S11

### Сессия S9 — Тесты по образцу

**Модель:** Haiku 4.5
**Длительность:** 2 части (component и API+regression через `/model`-переключение
или последовательно)
**Блокер:** S5-S8 завершены — закрыто 2026-05-25.

#### Фаза 6A (Haiku): Component-тесты

См. чек-лист §2.2 [specs/prd-7/s9-s11-in-progress.md](./s9-s11-in-progress.md) и
§1.13.2 [implementation-todo.md](./implementation-todo.md).

Промпт для Haiku:

```text
Расширь component-тесты для всех секций редактора PRD-7 по чек-листу
§1.13.2 docs/specs/prd-7/implementation-todo.md (он же §2.2
docs/specs/prd-7/s9-s11-in-progress.md).

Reference: __tests__/sections/basic-settings-section.test.tsx и
__tests__/test-editor.test.tsx как образец стиля.

Задачи: для каждого пункта чек-листа §1.13.2 добавить тест-кейс. Если кейс уже
покрыт - отметить в комментарии и пропустить.

Дополнительная задача (FR-20c): реализовать anchor-навигацию из summary ошибки
секции к первому проблемному полю. Использовать поле `field` из ValidationIssue
как селектор. Покрыть тестом: при клике на ошибку в summary фокус переходит
на input.

DoD: vitest run client/src/features/tests/editor зелёный, минимум 1 тест на каждый
пункт чек-листа.
Anti-goals: НЕ менять production-код секций (кроме anchor-navigation для FR-20c).
НЕ менять existing test setup utilities.
Эскалация: если для какого-то теста нужен новый mock или новая утилита - сообщи.
```

#### Фаза 6B (Haiku): API и regression тесты

См. чек-листы §2.3 [specs/prd-7/s9-s11-in-progress.md](./s9-s11-in-progress.md) и
§1.13.3, §1.13.4 [implementation-todo.md](./implementation-todo.md).

Промпт для Haiku:

```text
Расширь API и regression тесты по чек-листам §1.13.3 и §1.13.4
docs/specs/prd-7/implementation-todo.md (они же §2.3 docs/specs/prd-7/s9-s11-in-progress.md).

Reference: tests/routes.tests.test.ts существующий, tests/services/test-settings.test.ts
от Фазы 1B (см. specs/prd-7/s0-s8-closed.md S2).

Задачи: для каждого пункта чек-листов §1.13.3 и §1.13.4 добавить тест-кейс.

DoD: vitest run всех тестов зелёный, все пункты чек-листов покрыты.
Anti-goals: НЕ менять production routes/storage без острой необходимости.
Эскалация: если тест требует изменения production-кода - сообщи.
```

---

### Сессия S10 — Удаление legacy (Фаза 7A, Sonnet)

См. §3 [specs/prd-7/s9-s11-in-progress.md](./s9-s11-in-progress.md) для детального
scope и DoD.

**Блокер:** S9 зелёный.

Промпт для Sonnet:

```text
Удали inline wizard и dialogs из client/src/pages/author/tests.tsx.

Контракт: §1.12 docs/specs/prd-7/implementation-todo.md (он же §3
docs/specs/prd-7/s9-s11-in-progress.md), anti-goals из decisions.md §1.

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

---

### Сессия S11 — Acceptance pass (Фаза 7B, Opus)

См. §4 [specs/prd-7/s9-s11-in-progress.md](./s9-s11-in-progress.md) для детального
scope, criteria и DoD.

**Блокер:** S10 завершена; полный набор UI работает в браузере.

В той же сессии S11 после Acceptance pass: при необходимости `/model sonnet`
для W.3C (edge-states wireframes, см. ниже §W.3C).

Промпт для Opus:

```text
Финальный acceptance pass PRD-7.

Задачи:
1. Пройти все ~50 acceptance criteria PRD-7 §10 (см. specs/prd-7/s0-s8-closed.md для
   ссылок на код) - для каждого либо подтвердить реализацию ссылкой на код/тест,
   либо открыть issue.
2. Проверить полноту покрытия decisions.md - все ли enum/shapes используются
   как заявлено.
3. Lighthouse/axe accessibility audit Drawer (NFR-19..NFR-21).
4. Performance check: Drawer открывается за < 1.5s на тесте с 20 темами (NFR-17).
5. Manual end-to-end smoke (см. §4.4 docs/specs/prd-7/s9-s11-in-progress.md):
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

#### W.3C — Edge-state wireframes (Sonnet, при необходимости)

По решению 2026-05-21 edge-states интегрированы как state'ы единого
`prd7-editor-drawer.html` (state-switcher); отдельные файлы W.3C не создаются.
Запускается ТОЛЬКО если в ходе acceptance pass обнаружится сценарий без визуального
покрытия.

Промпт для Sonnet:

```text
Дополни wireframes выявленным edge-state по образцу reference.

Reference и принципы: те же, что в W.3B (см. docs/specs/prd-7/s0-s8-closed.md §S1
артефакты — prd7-editor-drawer.html и prd7-shared.css как образец).

Задачи:
1. Создать каждый файл из выявленного гэпа edge-state по образцу
   prd7-editor-drawer.html (или добавить state в state-switcher).
2. Сосредоточиться на состояниях, которые сложно проверить без визуализации:
   ошибки, конфликты версий, archived/read-only, перегруженные списки.

Anti-goals: НЕ изобретать новые UI-паттерны вне DS UniversityRT. НЕ менять
утверждённые wireframes без явной задачи.
DoD: новый wireframe открывается в браузере без ошибок, использует ou-* + tb-*
классы, имеет acceptance-блок.
```

---

## 3. Сводная таблица оставшихся сессий

| Сессия | Фаза | Что | Исполнитель | Блокирует | Статус |
| --- | --- | --- | --- | --- | --- |
| S9 | 6A | Component-тесты + FR-20c | Haiku | 7A | Закрыта 2026-05-27 |
| S9 | 6B | API и regression тесты | Haiku | 7A | Закрыта 2026-05-27 |
| S10 | 7A | Удаление legacy | Sonnet | 7B | Почти закрыта 2026-05-27 (остаток — runtime-read) |
| S11 | 7B | Acceptance pass | Opus | релиз | **Активна (следующая)** |

История по закрытым S0-S8 — см. [specs/prd-7/s0-s8-closed.md](./s0-s8-closed.md).

---

## 4. Чек-лист перед каждым PR

Применяется на любой фазе:

- [ ] Изменён только указанный в задаче scope файлов.
- [ ] `npm run check` проходит.
- [ ] Затронутые vitest-файлы зелёные.
- [ ] Нет `console.log`, `debugger`, `TODO`, `FIXME`.
- [ ] Все enum-значения и default-значения соответствуют
  [decisions.md](./decisions.md).
- [ ] Если задача требует нового контракта — НЕ изобретён, а эскалирован на Opus.
- [ ] Для UI-фаз: соответствующие wireframes из
  [specs/prd-7/s0-s8-closed.md](./s0-s8-closed.md) §S1 согласованы и доступны в
  `docs/wireframes/approved/`. Если wireframe для конкретного состояния
  отсутствует — работа возвращается в W.3C, состояние не изобретается.
- [ ] **Передача знания между сессиями:** если в сессии принято решение сверх
  `decisions.md` (новый контракт, edge case, лучший паттерн) — зафиксировано в
  `decisions.md`, reference-коде или
  [implementation-todo.md](./implementation-todo.md) ДО завершения сессии.

---

## 5. Признаки необходимости эскалации

Младшая модель должна остановиться и эскалировать на старшую, если:

1. Задача требует enum/shape, не описанного в [decisions.md](./decisions.md).
2. Reference-имплементация не покрывает паттерн, который требуется для текущей
   задачи.
3. Тест требует изменения production-кода вне scope текущей задачи.
4. Возникает конфликт с существующим API/типами, не предусмотренный задачей.
5. Дважды подряд не удаётся сделать тесты зелёными.
6. Появляется неожиданная зависимость от другого PRD (PRD-4, PRD-6, PRD-8).
7. Для UI-фазы отсутствует согласованный wireframe конкретного состояния (включая
   edge state: empty, loading, error, read-only). Не изобретать макет — возвращать
   в W.3C.

В случае эскалации — НЕ изобретать обходные пути. Зафиксировать гэп и остановиться.

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
```

Признаки, что пора закончить сессию:

- размер контекста подходит к 80k токенов;
- задача из плана сессии завершена и DoD выполнен;
- следующая фаза работает в другой зоне кода;
- требуется внешнее действие (миграция БД, согласование, code review).

Признаки, что НЕ пора закончить сессию:

- 1-2 неудачные итерации — это сигнал эскалировать модель, а не делать `/clear`;
- хочется «начать с чистого листа после ошибки» — новая сессия не узнает, что не
  сработало.
