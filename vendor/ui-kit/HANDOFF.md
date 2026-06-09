# UniversityRT UI Kit · Handoff Guide

Гид как получить артефакты `ui-kit` из этого проекта и подключить их в свой репозиторий или продуктовый проект.

`ui-kit` является частью общего scope Engineering Handbook. Нормативные правила по токенам,
темам и компонентам описаны в [`../DESIGN_SYSTEM_RT.md`](../DESIGN_SYSTEM_RT.md), правила
использования в коде — в [`../CODE_STYLE.md`](../CODE_STYLE.md#ui-разработка).

---

## 1. Что собрано

```bash
ui-kit/
├── package.json              # npm-манифест + scripts + deps
├── vite.config.ts            # сборка библиотеки (ESM + CJS + dts)
├── tsconfig.json             # TS-конфиг
├── chromatic.config.json     # Chromatic настройки
├── .storybook/
│   ├── main.ts               # Vite-builder + autodocs + аддоны
│   └── preview.tsx           # Тема (light/dark) + плотность (normal/compact) toolbar
├── scripts/
│   └── build-css.mjs         # Bundler для css/university-rt.css
├── css/
│   └── university-rt.css     # Single-file бандл всех стилей (~275 KB)
└── src/
    ├── index.ts              # Реэкспорт всех 52 компонентов + типов
    ├── utils.ts              # cn(), shared типы
    └── components/
        ├── <Component>.tsx        # 52 файла — компоненты
        └── <Component>.stories.tsx # 53 файла — Storybook stories
```

Плюс `.github/workflows/chromatic.yml` — пайплайн визуальной регрессии.

---

## 2. Получение артефактов

### Вариант A · Скачать архив

В чате с агентом запроси: «дай скачать ui-kit/». Будет ссылка на zip с папкой `ui-kit/` целиком. Распакуй в свой репозиторий.

### Вариант B · Скопировать вручную

Папка `ui-kit/` в этом проекте — самодостаточна. Кросс-зависимостей нет (CSS уже скопирован в `ui-kit/css/`).

Что обязательно нужно перенести:

| Источник | Куда | Зачем |
| --- | --- | --- |
| `ui-kit/src/` | `<твой-репо>/ui-kit/src/` | 52 .tsx компонента + stories |
| `ui-kit/.storybook/` | `<твой-репо>/ui-kit/.storybook/` | конфиг Storybook |
| `ui-kit/scripts/build-css.mjs` | `<твой-репо>/ui-kit/scripts/` | bundler CSS |
| `ui-kit/css/university-rt.css` | `<твой-репо>/ui-kit/css/` | готовый стилевой бандл |
| `ui-kit/package.json` | `<твой-репо>/ui-kit/` | deps + scripts |
| `ui-kit/vite.config.ts` | `<твой-репо>/ui-kit/` | библиотечная сборка |
| `ui-kit/tsconfig.json` | `<твой-репо>/ui-kit/` | TS-конфиг |
| `ui-kit/chromatic.config.json` | `<твой-репо>/ui-kit/` | Chromatic-конфиг |
| `.github/workflows/chromatic.yml` | `<твой-репо>/.github/workflows/` | CI |

Если хочешь оставить возможность пересобирать CSS — также копируй папку `tokens/` рядом с `ui-kit/` (на том же уровне). Скрипт `build-css.mjs` ходит в `../tokens/`. Если положишь иначе, поправь путь `TOKENS` в скрипте.

---

## 3. Установка и запуск локально

```bash
cd ui-kit
npm install            # ~30 сек, ~250 МБ node_modules
npm run storybook      # → http://localhost:6006
```

Storybook покажет:

- Введение (Overview / Introduction)
- 52 компонента, сгруппированных по `Inputs / Pickers / Overlay / Data / Navigation / Feedback / Layout`
- В тулбаре сверху: переключатель **Theme** (☀ Light / 🌙 Dark) и **Density** (Normal / Compact)
- Для каждого компонента — `Docs`-вкладка с автогенерированной таблицей props, `Controls`-панель

---

## 4. Сборка артефактов для публикации

```bash
npm run build              # build:css + build:lib
# выводит:
#   dist/index.mjs         (ESM)
#   dist/index.js          (CJS)
#   dist/index.d.ts        (типы)
#   css/university-rt.css  (стили, ~275 KB)
```

Артефакт готов к публикации в npm-registry (внутренний Nexus / GitHub Packages / npmjs).

---

## 5. Подключение в продуктовых проектах

### 5.1. Через npm-пакет (рекомендую)

После `npm publish` в свой registry:

```bash
npm install @universityrt/ui-kit
```

```tsx
import { Button, Modal, ToastProvider } from '@universityrt/ui-kit';
import '@universityrt/ui-kit/css';

export default function App() {
  return (
    <ToastProvider>
      <Button variant="primary" size="m">Применить</Button>
    </ToastProvider>
  );
}
```

### 5.2. Через монорепо (workspaces)

В корне репо:

```json
// package.json
{
  "workspaces": ["ui-kit", "apps/*"]
}
```

В проекте-потребителе (`apps/lms/package.json`):

```json
{
  "dependencies": {
    "@universityrt/ui-kit": "*"
  }
}
```

И собирай через `npm install` в корне. Hot-reload работает между пакетами автоматически.

### 5.3. Прямой импорт исходников

Если не нужна сборка библиотеки — можно настроить алиас в проекте-потребителе:

```ts
// vite.config.ts потребителя
resolve: {
  alias: { '@ui-kit': '/path/to/ui-kit/src' },
}
```

```tsx
import { Button } from '@ui-kit';
import '/path/to/ui-kit/css/university-rt.css';
```

---

## 6. Применение темы и плотности в проекте

CSS-бандл активируется классами на любом контейнере (обычно `<html>` или `<body>`):

```html
<body class="ou ou--light ou--normal">
  ...
</body>
```

| Класс | Назначение |
| --- | --- |
| `ou` | base-namespace (обязательно) |
| `ou--light` / `ou--dark` | тема |
| `ou--normal` / `ou--compact` | плотность (`compact` уменьшает row-heights, паддинги) |

Переключение в рантайме:

```ts
document.documentElement.classList.toggle('ou--dark', isDark);
```

Все компоненты и CSS-переменные `--ou-*` автоматически следуют за этими классами — никакого CSS-in-JS, никаких runtime-провайдеров.

---

## 7. Visual regression · Chromatic

1. Зарегистрироваться на [chromatic.com](https://www.chromatic.com), создать проект (точкой входа — `ui-kit/`)
2. Получить `CHROMATIC_PROJECT_TOKEN`, положить в GitHub secrets
3. Локально перед запуском экспортировать `CHROMATIC_PROJECT_TOKEN`
4. Workflow `.github/workflows/chromatic.yml` должен читать секрет `CHROMATIC_PROJECT_TOKEN` — на каждый PR делает `build-storybook` и публикует. Дальше Chromatic диффит против baseline и блокирует merge при визуальных изменениях.

Локально:

```bat
npm run build-storybook        # storybook-static/
set "CHROMATIC_PROJECT_TOKEN=chpt_xxx"
npm run chromatic
```

---

## 8. Версионирование и changelog

Рекомендованный flow:

```bash
# изменения в компоненте → bump
npm version patch    # 0.1.0 → 0.1.1   (фикс)
npm version minor    # 0.1.0 → 0.2.0   (новый компонент / совместимое изменение API)
npm version major    # 0.1.0 → 1.0.0   (breaking change)

npm run build
npm publish --access restricted
```

Для строгости — добавь `changesets` или `semantic-release`. Я этого не добавлял по умолчанию, чтобы не диктовать стратегию.

---

## 9. Поддержание CSS в синхроне с tokens/

Если в `tokens/components/*.css` появились правки:

```bash
cd ui-kit
npm run build:css      # пересобирает css/university-rt.css
```

После этого либо коммитить артефакт (рекомендую — потребители получат стили сразу), либо собирать на CI перед публикацией.

---

## 10. Что НЕ переносить

- `tokens/_preview-shell.css` — нужен только для preview-страниц в design-system проекте, в продакшене не нужен
- `tokens/components/*.preview.html` — это reference-страницы для дизайнеров, не код
- `index.html`, `docs.html`, `contrast-audit.html` — внутренний каталог design-system, к ui-kit не относится

---

## 11. Troubleshooting

**`Cannot find module 'vite-plugin-dts'`** — `npm install` забыл этот dev-dep. Запусти ещё раз.

**Storybook не находит CSS** — проверь что `tokens/` лежит рядом с `ui-kit/` на том же уровне. `import.meta.glob` в `preview.tsx` смотрит на `../../tokens/`.

**TypeScript ругается на `import.meta.glob`** — нужен `/// <reference types="vite/client" />`. Я добавил это в `.storybook/vite-env.d.ts`.

**Темы не переключаются** — убедись что класс `ou` есть на родительском элементе (`<html>` или `<body>`). Без него CSS-переменные не активируются.

---

## 12. Дальнейшее развитие

| Задача | Куда смотреть |
| --- | --- |
| Добавить новый компонент | `src/components/<Name>.tsx` → реэкспорт в `index.ts` → `<Name>.stories.tsx` |
| Изменить токен | `tokens/tokens.css` → `npm run build:css` |
| Тестирование (unit) | Vitest + `@testing-library/react` — НЕ настроено, нужно добавить |
| E2E | Playwright — НЕ настроено, можно завести отдельно |
| A11y-аудит | `@storybook/addon-a11y` — НЕ настроено, добавляется в `.storybook/main.ts` |

---

## 13. Контракты на которые опираются другие части дизайн-системы

- CSS-классы в BEM `ou-<component>__<element>--<modifier>` — стабильный API, ломать нельзя
- Имена CSS-переменных `--ou-*` (200+) — стабильный API
- React-компоненты — semver

Если делаешь breaking change в любом из них — обязательно major-bump.
