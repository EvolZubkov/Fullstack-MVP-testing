# Анализ зависимостей проекта

Дата анализа: 2026-02-08

## Общая статистика

| Категория | Всего | Используются | Не используются |
| --- | --- | --- | --- |
| Production | 76 | 48 | 28 |
| Dev | 28 | 21 | 7 |

---

## Production-зависимости (используются)

### Ядро приложения

| Пакет | Где используется | Назначение |
| --- | --- | --- |
| `react` | 60+ файлов клиента | UI-фреймворк |
| `react-dom` | `client/src/main.tsx` | DOM-рендеринг React |
| `express` | `server/index.ts`, `routes.ts`, `vite.ts`, `static.ts` | HTTP-фреймворк бэкенда |
| `wouter` | `App.tsx` и 13+ файлов | Клиентский роутинг |
| `zod` | `shared/schema.ts`, страницы форм | Валидация данных |

### Работа с данными

| Пакет | Где используется | Назначение |
| --- | --- | --- |
| `drizzle-orm` | `shared/schema.ts`, `server/storage.ts`, `server/db.ts` | ORM для PostgreSQL |
| `drizzle-zod` | `shared/schema.ts` | Генерация Zod-схем из Drizzle-таблиц |
| `pg` | `server/db.ts`, `script/create-admin.cjs` | PostgreSQL-драйвер |
| `@tanstack/react-query` | `lib/queryClient.ts`, `App.tsx`, все страницы | Серверное состояние и кэширование |

### Аутентификация и безопасность

| Пакет | Где используется | Назначение |
| --- | --- | --- |
| `bcryptjs` | `server/storage.ts`, `script/create-admin.ts` | Хеширование паролей |
| `express-session` | `server/routes.ts` | Управление сессиями |
| `memorystore` | `server/routes.ts` | In-memory session store |
| `@vvlad1973/crypto` | `server/utils/crypto.ts`, `script/build.ts` | Шифрование email |
| `dotenv` | `script/create-admin.cjs`, `drizzle.config.ts` | Загрузка .env-переменных |

### UI-компоненты (Radix UI -- используемые)

| Пакет | Wrapper | Где используется |
| --- | --- | --- |
| `@radix-ui/react-alert-dialog` | `ui/alert-dialog.tsx` | `author/users`, `groups`, `topics` |
| `@radix-ui/react-avatar` | `ui/avatar.tsx` | `learner/layout`, `app-sidebar` |
| `@radix-ui/react-checkbox` | `ui/checkbox.tsx` | `take-test`, `first-login`, `users`, `questions`, `analytics`, `groups` |
| `@radix-ui/react-collapsible` | `ui/collapsible.tsx` | `author/analytics`, `topics` |
| `@radix-ui/react-dialog` | `ui/dialog.tsx` | `tests`, `users`, `questions`, `analytics`, `groups` |
| `@radix-ui/react-dropdown-menu` | `ui/dropdown-menu.tsx` | `author/users`, `groups` |
| `@radix-ui/react-label` | `ui/label.tsx` | Формы авторизации, `tests`, `users`, `questions` |
| `@radix-ui/react-popover` | `ui/popover.tsx` | `learner/take-test`, `result` |
| `@radix-ui/react-progress` | `ui/progress.tsx` | `learner/take-test`, `questions` |
| `@radix-ui/react-radio-group` | `ui/radio-group.tsx` | `learner/take-test`, `questions` |
| `@radix-ui/react-scroll-area` | `ui/scroll-area.tsx` | `author/analytics` |
| `@radix-ui/react-select` | `ui/select.tsx` | `tests`, `users`, `questions`, `analytics`, `topics` |
| `@radix-ui/react-separator` | `ui/separator.tsx` | `learner/result`, `first-login`, `tests`, `analytics`, `sidebar` |
| `@radix-ui/react-slider` | `ui/slider.tsx` | `author/questions` |
| `@radix-ui/react-slot` | `ui/button.tsx`, `sidebar.tsx` | Полиморфный Slot-компонент |
| `@radix-ui/react-switch` | `ui/switch.tsx` | `author/tests`, `questions` |
| `@radix-ui/react-tabs` | `ui/tabs.tsx` | `test-analytics`, `analytics`, `assign-test-dialog` |
| `@radix-ui/react-toast` | `ui/toast.tsx`, `use-toast.ts` | Уведомления по всему приложению |
| `@radix-ui/react-tooltip` | `ui/tooltip.tsx` | `App.tsx`, `sidebar` |

### Утилиты и стилизация

| Пакет | Где используется | Назначение |
| --- | --- | --- |
| `class-variance-authority` | 10 файлов в `ui/` | Варианты CSS-классов компонентов |
| `clsx` | `lib/utils.ts` | Условная конкатенация CSS-классов |
| `tailwind-merge` | `lib/utils.ts` | Merge Tailwind-классов без конфликтов |
| `tailwindcss-animate` | `tailwind.config.ts` | Анимационные утилиты для Tailwind |
| `lucide-react` | 42+ файлов | Библиотека иконок |
| `next-themes` | `theme-provider.tsx`, `theme-toggle.tsx` | Переключение темы (светлая/темная) |

### Формы

| Пакет | Где используется | Назначение |
| --- | --- | --- |
| `react-hook-form` | `ui/form.tsx`, страницы форм | Управление формами |
| `@hookform/resolvers` | Страницы форм | Интеграция Zod с react-hook-form |

### Прочие

| Пакет | Где используется | Назначение |
| --- | --- | --- |
| `archiver` | `server/scorm/zip.ts` | ZIP-архивы SCORM-пакетов |
| `date-fns` | `learner/history.tsx` | Форматирование дат |
| `multer` | `server/routes.ts` | Загрузка файлов |
| `nodemailer` | `server/email.ts` | Отправка email |
| `recharts` | `test-analytics.tsx`, `analytics.tsx`, `chart.tsx` | Графики аналитики |
| `xlsx` | `server/routes.ts` | Экспорт в Excel |

---

## Production-зависимости (НЕ ИСПОЛЬЗУЮТСЯ)

### Radix UI -- неиспользуемые wrapper-компоненты

Компоненты были сгенерированы через shadcn/ui, но в приложении не применяются.
Wrapper-файлы в `client/src/components/ui/` также можно удалить.

| Пакет | Wrapper-файл |
| --- | --- |
| `@radix-ui/react-accordion` | `ui/accordion.tsx` |
| `@radix-ui/react-aspect-ratio` | `ui/aspect-ratio.tsx` |
| `@radix-ui/react-context-menu` | `ui/context-menu.tsx` |
| `@radix-ui/react-hover-card` | `ui/hover-card.tsx` |
| `@radix-ui/react-menubar` | `ui/menubar.tsx` |
| `@radix-ui/react-navigation-menu` | `ui/navigation-menu.tsx` |
| `@radix-ui/react-toggle` | `ui/toggle.tsx` |
| `@radix-ui/react-toggle-group` | `ui/toggle-group.tsx` |

### Прочие неиспользуемые npm-пакеты

| Пакет | Причина |
| --- | --- |
| `@jridgewell/trace-mapping` | Нигде не импортируется; вероятно, добавлен для подавления warning |
| `bufferutil` | Опциональная оптимизация для `ws`, который сам не используется |
| `cmdk` | Wrapper `ui/command.tsx` нигде не импортируется |
| `connect-pg-simple` | Проект использует `memorystore`; упомянут только в `build.ts` allowlist |
| `embla-carousel-react` | Wrapper `ui/carousel.tsx` нигде не импортируется |
| `framer-motion` | Нигде не импортируется |
| `html2canvas` | Используется через CDN в SCORM-шаблоне, npm-пакет не нужен |
| `input-otp` | Wrapper `ui/input-otp.tsx` нигде не импортируется |
| `jspdf` | Используется через CDN в SCORM-шаблоне, npm-пакет не нужен |
| `passport` | Нигде не импортируется; упомянут только в `build.ts` allowlist |
| `passport-local` | Нигде не импортируется; упомянут только в `build.ts` allowlist |
| `react-day-picker` | Wrapper `ui/calendar.tsx` нигде не импортируется |
| `react-icons` | Проект использует `lucide-react` |
| `react-resizable-panels` | Wrapper `ui/resizable.tsx` нигде не импортируется |
| `tw-animate-css` | Дублирует `tailwindcss-animate` |
| `vaul` | Wrapper `ui/drawer.tsx` нигде не импортируется |
| `ws` | Нигде не импортируется в серверном коде |
| `zod-validation-error` | Только в `build.ts` allowlist, не импортируется |

### Пакеты для переноса в devDependencies

Типы не нужны в production -- они используются только при компиляции.

| Пакет |
| --- |
| `@types/archiver` |
| `@types/bcryptjs` |
| `@types/multer` |

---

## Dev-зависимости (используются)

### Сборка и компиляция

| Пакет | Конфигурация | Назначение |
| --- | --- | --- |
| `typescript` | `tsconfig.json` | TypeScript-компилятор |
| `tsx` | `package.json` scripts | TypeScript-раннер для Node.js |
| `esbuild` | `script/build.ts` | Сборка серверного бандла |
| `vite` | `vite.config.ts` | Бандлер и dev-сервер фронтенда |
| `@vitejs/plugin-react` | `vite.config.ts` | JSX, Fast Refresh |
| `cross-env` | `package.json` scripts | Кроссплатформенные env-переменные |

### Стилизация

| Пакет | Конфигурация | Назначение |
| --- | --- | --- |
| `tailwindcss` | `tailwind.config.ts`, `postcss.config.js` | CSS-фреймворк |
| `postcss` | `postcss.config.js` | CSS-процессор |
| `autoprefixer` | `postcss.config.js` | CSS-префиксы |
| `@tailwindcss/typography` | `tailwind.config.ts` | Типографические стили |

### Линтинг

| Пакет | Конфигурация | Назначение |
| --- | --- | --- |
| `eslint` | `eslint.config.js` | Линтинг кода |
| `@eslint/js` | `eslint.config.js` | Базовые ESLint-правила |
| `eslint-plugin-react` | `eslint.config.js` | Правила для React |
| `eslint-plugin-react-hooks` | `eslint.config.js` | Правила для React Hooks |
| `typescript-eslint` | `eslint.config.js` | TypeScript + ESLint |
| `globals` | `eslint.config.js` | Глобальные переменные для ESLint |
| `markdownlint-cli2` | `package.json` script `lint:md` | Линтинг Markdown |

### Тестирование

| Пакет | Конфигурация | Назначение |
| --- | --- | --- |
| `vitest` | `vitest.config.ts` | Тестовый фреймворк |
| `@vitest/coverage-v8` | `vitest.config.ts` | Покрытие кода |
| `jsdom` | `vitest.config.ts` | DOM-окружение для тестов |
| `@testing-library/jest-dom` | `client/src/test/setup.ts` | DOM-матчеры для тестов |

### Типы

| Пакет | Назначение |
| --- | --- |
| `@types/express` | Типы Express |
| `@types/express-session` | Типы express-session |
| `@types/node` | Типы Node.js API |
| `@types/nodemailer` | Типы nodemailer |
| `@types/react` | Типы React |
| `@types/react-dom` | Типы React DOM |

### БД

| Пакет | Конфигурация | Назначение |
| --- | --- | --- |
| `drizzle-kit` | `drizzle.config.ts` | Инструменты миграции БД |

### Replit

| Пакет | Конфигурация | Назначение |
| --- | --- | --- |
| `@replit/vite-plugin-cartographer` | `vite.config.ts` | Replit-интеграция |
| `@replit/vite-plugin-dev-banner` | `vite.config.ts` | Dev-баннер на Replit |
| `@replit/vite-plugin-runtime-error-modal` | `vite.config.ts` | Модальное окно ошибок |

---

## Dev-зависимости (НЕ ИСПОЛЬЗУЮТСЯ)

| Пакет | Причина |
| --- | --- |
| `@tailwindcss/vite` | Проект использует Tailwind 3 с PostCSS, а не Tailwind 4 с Vite-плагином |
| `@testing-library/react` | Установлен, но тесты компонентов не написаны |
| `@testing-library/user-event` | Нигде не импортируется |
| `@types/connect-pg-simple` | Типы для неиспользуемого `connect-pg-simple` |
| `@types/passport` | Типы для неиспользуемого `passport` |
| `@types/passport-local` | Типы для неиспользуемого `passport-local` |
| `@types/ws` | Типы для неиспользуемого `ws` |
| `ts-node-dev` | Проект использует `tsx` |

---

## Рекомендации

### 1. Удалить неиспользуемые production-зависимости (28 пакетов)

```text
@jridgewell/trace-mapping
@radix-ui/react-accordion
@radix-ui/react-aspect-ratio
@radix-ui/react-context-menu
@radix-ui/react-hover-card
@radix-ui/react-menubar
@radix-ui/react-navigation-menu
@radix-ui/react-toggle
@radix-ui/react-toggle-group
bufferutil
cmdk
connect-pg-simple
embla-carousel-react
framer-motion
html2canvas
input-otp
jspdf
passport
passport-local
react-day-picker
react-icons
react-resizable-panels
tw-animate-css
vaul
ws
zod-validation-error
```

### 2. Удалить неиспользуемые dev-зависимости (8 пакетов)

```text
@tailwindcss/vite
@testing-library/react
@testing-library/user-event
@types/connect-pg-simple
@types/passport
@types/passport-local
@types/ws
ts-node-dev
```

### 3. Перенести типы из dependencies в devDependencies

```text
@types/archiver
@types/bcryptjs
@types/multer
```

### 4. Удалить неиспользуемые wrapper-файлы

При удалении Radix-пакетов также удалить соответствующие wrapper-компоненты из
`client/src/components/ui/`:

```text
accordion.tsx
aspect-ratio.tsx
calendar.tsx
carousel.tsx
command.tsx
context-menu.tsx
drawer.tsx
hover-card.tsx
input-otp.tsx
menubar.tsx
navigation-menu.tsx
resizable.tsx
toggle.tsx
toggle-group.tsx
```

### 5. Удалить Replit-зависимости (если Replit не используется)

```text
@replit/vite-plugin-cartographer
@replit/vite-plugin-dev-banner
@replit/vite-plugin-runtime-error-modal
```

А также файл `.replit` и связанный код в `vite.config.ts`.

### 6. Очистить build.ts allowlist

После удаления `passport`, `passport-local`, `connect-pg-simple`, `ws`,
`zod-validation-error` -- убрать их из списка external-модулей в `script/build.ts`.
