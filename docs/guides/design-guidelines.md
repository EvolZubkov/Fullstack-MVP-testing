# Руководство по дизайну

**Статус:** актуально (указатель на источники истины дизайна)  
**Дата актуализации:** 2026-06-06

Проект использует дизайн-систему UniversityRT. Локального дизайн-гайда, дублирующего токены и
компоненты DS, в репозитории нет: единый источник истины — хэндбук дизайн-системы и его React-реализация
`@universityrt/ui-kit`. Этот документ не повторяет DS, а указывает, где искать канон и какие
проектные слои поверх него существуют.

## Источники истины (репозиторий ENGINERING_HANDBOOK)

- `handbook/design-system/DESIGN_SYSTEM_RT.md` — токены и компоненты DS.
- `handbook/design-system/DESIGN_SYSTEM_RT_API.md` — API компонентов DS.
- `handbook/design-system/AI-AGENT.md` — правила работы с DS для агентов (читать до любой работы с UI).
- `ui-kit/README.md` — локальная React-реализация дизайн-системы (`@universityrt/ui-kit`).

## Правила применения в этом проекте

- Использовать готовые React-компоненты из `@universityrt/ui-kit` (NumberInput, Select, Combobox,
  Switch, Tag, Drawer, Tabs, ColorPicker и другие). Не писать руками `.ou-*` DS-разметку и не
  оборачивать нативные `<select>` / `<input type=number>` в `.ou-field`.
- Иконки — `lucide-react`.
- Брендовый шрифт `RostelecomBasis` вендорится в `client/public/fonts/` и подключается из
  `client/src/styles/vendor/university-rt.css`.

## Проектные слои поверх DS

- `client/src/styles/tb-components.css` — проектный компонентный слой (`tb-*`) поверх токенов DS.
- `client/src/styles/tb-tests-list.css` — стили списка тестов.
- `client/src/components/template-screen.tsx` — монтирование общего рендерера ученических экранов
  (`renderScreenInto`) в Shadow DOM; компонентная CSS-конвенция шаблонов общая для веба и SCORM
  (см. [PRD-12](../specs/prd-12/web-runtime-parity.md) и
  [платформа SCORM-шаблонов](../specs/spec-template-platform.md)).

## Доступность

Соответствие WCAG AA во всех взаимодействиях: видимые focus-состояния, тач-таргет не меньше
44x44px, ARIA-метки на кнопках только с иконкой, ошибки обозначаются иконкой и текстом, а не
только цветом. Конкретные токены и паттерны — в DS-хэндбуке.
