# @universityrt/ui-kit

React-компонентная библиотека на базе **UniversityRT Design System**.

- **52 компонента** — формы, оверлеи, данные, навигация, фидбэк, layout
- **Storybook 10** с переключением темы (light/dark), плотности (normal/compact) и component tests
- **TypeScript** строгий, дженерики, `forwardRef` + `displayName` везде
- **A11y** — ARIA-роли, клавиатурная навигация, focus-visible
- Один CSS-бандл (`css/university-rt.css`), никакого CSS-in-JS

## Место в хэндбуке

`ui-kit` входит в общий scope Engineering Handbook как локальная React-реализация
UniversityRT Design System.

- Правила дизайн-системы: [`../DESIGN_SYSTEM_RT.md`](../DESIGN_SYSTEM_RT.md)
- API reference UI Kit: [`../DESIGN_SYSTEM_RT_API.md`](../DESIGN_SYSTEM_RT_API.md)
- UI-правила разработки: [`../CODE_STYLE.md`](../CODE_STYLE.md#ui-разработка)
- Передача и публикация пакета: [`./HANDOFF.md`](./HANDOFF.md)

В продуктовых React-проектах сначала используется публичный API `@universityrt/ui-kit`.
Если нужного компонента или токена нет, расширяется этот пакет и его Storybook, а не создаётся
одноразовый локальный компонент в продукте.

## Установка

```bash
npm install @universityrt/ui-kit
```

```tsx
import { Button, Modal, ToastProvider } from '@universityrt/ui-kit';
import '@universityrt/ui-kit/css';

<body class="ou ou--light ou--normal">
  <Button variant="primary">Применить</Button>
</body>
```

## Локальный Workflow

```bash
npm install
```

После установки зависимостей проверьте, что Playwright browser установлен для Storybook/Vitest tests:

```bash
npx playwright install chromium
```

### Ежедневная разработка

```bash
npm run storybook
```

Storybook доступен на `http://localhost:6006`. Это основной рабочий режим для проверки компонентов, states, тем и density. Глобальные переключатели темы и плотности находятся в toolbar Storybook.

### Быстрая проверка перед PR

```bash
npm run type-check
npm run test-storybook:ci
npm run build-storybook
npm run build
```

`type-check` проверяет TypeScript-контракты. `test-storybook:ci` запускает stories как component tests через Vitest browser mode и Playwright Chromium. `build-storybook` проверяет статичную сборку витрины. `build` собирает CSS, ESM/CJS и declaration files.

### Storybook Tests

Functional сценарии пишутся прямо в `*.stories.tsx` через `play`:

```tsx
import { expect, fn } from 'storybook/test';

export const SelectToday: Story = {
  args: {
    today: { y: 2026, m: 4, d: 13 },
    onChange: fn(),
  },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Сегодня' }));

    await expect(args.onChange).toHaveBeenCalledWith({
      y: 2026,
      m: 4,
      d: 13,
    });
  },
};
```

Для запросов используйте accessibility queries: `getByRole`, `getByLabelText`, `findByText`. Для компонентов, которые рендерятся через portal (`Toast`, `Modal`, `Popover`), ищите элементы через `screen` из `storybook/test`, если они находятся вне canvas.

Локальный watch-режим:

```bash
npm run test-storybook
```

CI-режим:

```bash
npm run test-storybook:ci
```

### Visual Regression

Visual checks выполняются через Chromatic. Перед первым запуском создайте проект на Chromatic и получите `CHROMATIC_PROJECT_TOKEN`.

Локально в `cmd.exe`:

```bat
set "CHROMATIC_PROJECT_TOKEN=chpt_xxx"
npm run chromatic
```

Локально в PowerShell:

```powershell
$env:CHROMATIC_PROJECT_TOKEN="chpt_xxx"
npm run chromatic
```

В CI токен должен лежать в secrets как `CHROMATIC_PROJECT_TOKEN`. `chromatic.config.json` хранит только безопасные настройки запуска; сам token не коммитится.

Если нужно проверить только статичную сборку без публикации в Chromatic:

```bash
npm run build-storybook
```

Публикация visual baseline:

```bash
npm run chromatic
```

Для стабильных snapshots stories должны быть детерминированными: фиксируйте дату через props вроде `today`, не используйте случайные значения, контролируйте timers/auto-dismiss и добавляйте отдельные stories для dark/compact/long-content states.

### Storybook QA Status

Каждая story/state получает видимый QA badge в верхней части canvas. Если статус не задан явно, Storybook показывает `QA: Unvalidated`.

Статус задается декларативно в `parameters.qa`:

```tsx
const meta: Meta<typeof Component> = {
  title: 'Inputs/Component',
  component: Component,
  parameters: {
    qa: {
      status: 'review',
      visual: 'todo',
      functional: 'todo',
      a11y: 'todo',
      notes: 'Проверить keyboard navigation',
    },
  },
};
```

Допустимые `status`: `unvalidated`, `draft`, `review`, `blocked`, `visual-ok`, `functional-ok`, `stable`.

Допустимые проверки: `todo`, `ok`, `blocked`, `skip`.

Story/state считается полностью готовой для baseline только при:

```tsx
qa: {
  status: 'stable',
  visual: 'ok',
  functional: 'ok',
  a11y: 'ok',
}
```

Отчет по оставшейся валидации:

```bash
npm run qa:report
```

Изменить статус без ручного редактирования story:

```bash
npm run qa:set -- Inputs/Button/Primary --status stable
```

Для `stable` скрипт автоматически выставляет `visual`, `functional` и `a11y` в `ok`. Можно задать проверки явно:

```bash
npm run qa:set -- Inputs/Button/Primary --status review --visual ok --functional todo --a11y todo
```

Порядок флагов не важен:

```bash
npm run qa:set -- Inputs/Button/Primary --a11y todo --visual ok --status review --functional todo
```

Можно добавить заметку:

```bash
npm run qa:set -- Pickers/Calendar/Range --status blocked --notes "Range keyboard navigation needs fixing"
```

Статус можно задать и на уровне компонента. Он будет fallback для всех stories компонента, пока у конкретной story нет своего статуса:

```bash
npm run qa:set -- Inputs/Button --status review
```

CI-gate режим:

```bash
npm run qa:report:strict
```

### CSS Bundle

Итоговый CSS лежит в `css/university-rt.css` и экспортируется как:

```tsx
import '@universityrt/ui-kit/css';
```

`npm run build:css` собирает bundle из `../tokens` при наличии исходников. Если `../tokens/components` отсутствует, скрипт сохраняет существующий `css/university-rt.css` и продолжает сборку, чтобы локальная сборка библиотеки не блокировалась отсутствующими token sources.

### Полезные Команды

```bash
npm run storybook          # dev Storybook на localhost:6006
npm run build-storybook    # статичная сборка Storybook
npm run test-storybook     # Storybook component tests в watch-режиме
npm run test-storybook:ci  # Storybook component tests для CI
npm run type-check         # TypeScript без emit
npm run build:css          # CSS bundle
npm run build:lib          # Vite build библиотеки
npm run build              # CSS + library build
npm run chromatic          # visual regression
npm run qa:report          # отчет по QA-статусам stories
npm run qa:set -- Inputs/Button/Primary --status stable
```

Подробный гид по интеграции — [`HANDOFF.md`](./HANDOFF.md).

## Структура

```
src/components/  ── 52 компонента + stories
.storybook/      ── конфиг
scripts/         ── build-css
css/             ── итоговый стилевой бандл
dist/            ── сборка библиотеки (после npm run build)
```

## Ссылки

- Дизайн-система: `../tokens/`
- Storybook: `npm run storybook`
- Visual regression: Chromatic (см. `chromatic.config.json` и `.github/workflows/chromatic.yml`)
