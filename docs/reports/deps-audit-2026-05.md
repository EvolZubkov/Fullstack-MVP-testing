# Аудит зависимостей проекта (2026-05-26)

Полный разбор `package.json` SCORM Test Constructor: где используются пакеты, какую функцию выполняют,
оценка выбора, варианты оптимизации (включая миграцию на `@universityrt/ui-kit`), стоп-факторы и риски.

Источник истины: `package.json` в корне; даты grep-обхода — 2026-05-26.

## 1. Сводка

Цифры приведены на момент первичного аудита; актуальное состояние после §1.1 указано в скобках.

| Категория | Пакетов | Активно используется | Wrapper-only / dead-weight |
| --- | --- | --- | --- |
| Client runtime UI/forms/state | 49 (39 после §1.1) | 41 (39) | 8 (2 после §1.1: `accordion`, `pagination` — см. §2.2) |
| Server runtime | 14 | 14 | 0 |
| Build / Dev / Test | 26 (23 после §1.1) | 25 (23) | 1 (0 после §1.1) |
| Optional | 1 | 1 (`bufferutil` — транзитивно через `ws`) | 0 |

Точка интеграции `@universityrt/ui-kit`: 7 файлов, 19 уникальных компонентов из 54 экспортируемых (покрытие 35%).

## 1.1 Изменения с момента аудита (2026-05-26)

Зафиксированы правки, выполненные после первичного аудита. Все источники (`package.json`,
`vite.config.ts`, `vitest.config.ts`, `client/src/components/ui/*`) обновлены, типы и клиентские
тесты прошли (`npm run check`, `npx vitest run client/src`).

Применённые quick wins:

- Удалены Replit-плагины из `vite.config.ts` и `devDependencies`: `@replit/vite-plugin-cartographer`,
  `@replit/vite-plugin-dev-banner`. Условный блок в [`vite.config.ts`](../../vite.config.ts) убран —
  обе ветки активировались только при `process.env.REPL_ID`, проект больше не запускается в Replit.
- Унифицирован React-плагин Vite/Vitest на `@vitejs/plugin-react`; `@vitejs/plugin-react-swc`
  удалён из `devDependencies`, [`vitest.config.ts`](../../vitest.config.ts) переключён на тот же
  плагин, что и prod-сборка. Расхождение JSX-трансформации между прод-путём и тестами устранено.
- Удалены wrapper-only обёртки `client/src/components/ui/`:
  `aspect-ratio.tsx`, `carousel.tsx`, `command.tsx`, `context-menu.tsx`, `hover-card.tsx`,
  `input-otp.tsx`, `menubar.tsx`, `navigation-menu.tsx`, `toggle-group.tsx`, плюс
  `toggle.tsx` (после удаления `toggle-group` стал wrapper-only).
- Сняты с `dependencies` соответствующие пакеты: Radix —
  `react-aspect-ratio`, `react-context-menu`, `react-hover-card`, `react-menubar`,
  `react-navigation-menu`, `react-toggle`, `react-toggle-group`; плюс `cmdk`,
  `embla-carousel-react`, `input-otp`.
- Заведён [`docs/specs/prd-9/crypto-password-hashing.md`](../specs/prd-9/crypto-password-hashing.md) —
  план доработки `@vvlad1973/crypto` (добавить scrypt-based password hashing) и отказа от
  `bcryptjs` с миграцией через ленивый rehash.

Корректировка аудита:

- Поле «sheet» в исходном списке wrapper-only было ошибочным: `ui/sheet.tsx` импортируется в
  [`client/src/components/ui/sidebar.tsx:13-19`](../../client/src/components/ui/sidebar.tsx#L13-L19),
  а `sidebar.tsx` используется в `pages/author/layout.tsx` и `components/app-sidebar.tsx`. Sheet
  и его зависимость `@radix-ui/react-dialog` оставлены — обеспечивают мобильное выезжающее меню.

Не сделано (остаётся в backlog):

- Перенос `drizzle-kit`, `@types/archiver`, `@types/bcryptjs`, `@types/multer` в
  `devDependencies` (см. §5.2.4-5).
- Замена `memorystore` на persistent store (§5.2.3).
- Замена `bcryptjs` на scrypt из `@vvlad1973/crypto` (см. PRD-9).
- Удаление `client.zip`, `testing.zip` из корня.

## 2. Client runtime: маппинг «пакет → использование»

### 2.1 Формы, валидация, схемы

| Пакет | Файлы | Функция | Заметки |
| --- | --- | --- | --- |
| `react-hook-form` | 7 страниц (login, questions, topics, password reset, forgot-password) | Form-state, `FormProvider`, `Controller`, `useFormContext` | Основной form-контроллер |
| `@hookform/resolvers` | 6 | `zodResolver` для интеграции с Zod | Лёгкая прослойка |
| `zod` | 5 (client) + `shared/schema.ts` | Runtime-валидация, типы | Версия 4 (мажорный апгрейд относительно архивного отчёта) |
| `drizzle-zod` | `shared/schema.ts` | `createInsertSchema` для генерации Zod-схем из таблиц Drizzle | 1 модуль; цепляет server-схему в client через `shared/` |

### 2.2 UI: shadcn-обёртки на Radix

На момент аудита: 42 обёртки в `client/src/components/ui/*`. Активно импортируется 26, 16 — wrapper-only.

После §1.1: 32 обёртки. Активно — 25 (выпала `toggle`, удалённая вместе с `toggle-group`),
wrapper-only осталось 5 (`accordion`, `alert-dialog`, `label`, `pagination`, плюс `sheet` —
последний на самом деле **используется** в `sidebar.tsx`, корректировка в §1.1).

Активно используется (с числом импортов в `client/src/**`):

| Обёртка | Radix | Импортов | UI-kit аналог | Gap |
| --- | --- | --- | --- | --- |
| `button` | `react-slot` | 26 | `Button` | ok |
| `card` | — | 15 | `Card`/`CardHeader`/`CardBody` | ok |
| `input` | — | 14 | `Input` | ok |
| `badge` | — | 14 | `Chip` | различная семантика |
| `dialog` | `react-dialog` | 10 | `ModalDialog` | ok |
| `select` | `react-select` | 7 | `Select` | ok |
| `checkbox` | `react-checkbox` | 7 | `Checkbox` | ok |
| `form` | (RHF-обвязка) | 6 | `Form*` | разные API |
| `textarea` | — | 4 | `Textarea` | ok |
| `separator` | `react-separator` | 4 | — | нет в DS |
| `tabs` | `react-tabs` | 3 | `Tabs` | ok |
| `table` | — | 3 | `Table` | ok |
| `switch` | `react-switch` | 3 | `Switch` | ok |
| `sidebar` | `react-slot` | 2 | `Sidebar` | различная архитектура |
| `dropdown-menu` | `react-dropdown-menu` | 2 | `Menu` | ok |
| `radio-group` | `react-radio-group` | 2 | `Radio`/`RadioGroup` | ok |
| `avatar` | `react-avatar` | 2 | `Avatar` | ok |
| `collapsible` | `react-collapsible` | 2 | `Accordion` | близко |
| `tooltip` | `react-tooltip` | 2 | `Tooltip` | ok |
| `popover` | `react-popover` | 2 | `Popover` | ok |
| `toast` + `toaster` | `react-toast` | 2 + 1 | `Toast`/`ToastProvider` | ok |
| `progress` | `react-progress` | 1 | `ProgressBar` | ok |
| `slider` | `react-slider` | 1 | `Slider` | ok |
| `skeleton` | — | 1 | `Skeleton` | ok |
| `scroll-area` | `react-scroll-area` | 1 | — | нет в DS |
| `toggle` | `react-toggle` | 1 | `SegmentedControl` | удалён в §1.1 (был wrapper-only после удаления `toggle-group`) |
| `breadcrumb` | `react-slot` | 1 | `Breadcrumbs` | ok |
| `drawer` (vaul) | — | 1 | `Drawer` | ok |

Wrapper-only (импортируется только сам файл-обёртка, в фичах не используется):

- На момент аудита: `accordion`, `alert-dialog`, `aspect-ratio`, `carousel`, `command`,
  `context-menu`, `hover-card`, `input-otp`, `label` (стандалон), `menubar`, `navigation-menu`,
  `pagination`, `sheet`, `toggle-group`.
- Корректировка после повторной проверки: `alert-dialog`, `label` и `sheet` использовались
  в реальных страницах/компонентах ещё до §1.1 и были ошибочно отнесены к wrapper-only.
  - `alert-dialog` — `pages/author/users.tsx`, `pages/author/topics.tsx`, `pages/author/groups.tsx`.
  - `label` — `pages/learner/take-test.tsx`, `pages/author/*` и несколько диалогов в
    `client/src/components/`.
  - `sheet` — `client/src/components/ui/sidebar.tsx` (мобильное меню в author layout).
- После §1.1 и корректировки wrapper-only остаются: `accordion`, `pagination`.
  Из них `accordion` тянет собственный пакет `@radix-ui/react-accordion` — кандидат на следующий
  раунд чистки, если фичи его так и не подключат. `pagination` использует общий `react-slot`,
  отдельного Radix-пакета не приносит.

### 2.3 UI: `@universityrt/ui-kit`

Линкуется как `file:../ENGINERING_HANDBOOK/ui-kit`, peer-зависит от React 18. В `vite.config.ts` и `vitest.config.ts` явная дедупликация `react`/`react-dom` (иначе ui-kit подтягивает собственную копию и хуки падают на `useId`).

Используется в 7 файлах:

1. `client/src/features/test-editor/test-editor.tsx` — `IconButton`, `Tag`, `Tabs`, `ModalDialog`, `Banner`, `EmptyState`, `Button`
2. `client/src/features/test-editor/basic-settings-section.tsx` — `Accordion`, `Card`, `Switch`, `RadioGroup`, `NumberInput`, `Banner`, `Textarea`, `Input`, `Select`
3. `client/src/features/test-editor/topics-structure-section.tsx` — `EmptyState`, `ModalDialog`, `NumberInput`, `Select`, `Button`
4. `client/src/features/test-editor/design-section.tsx` — `ColorPicker`, и прочее
5. `client/src/features/test-editor/feedback-editor-modal.tsx` — `SegmentedControl`, `Textarea`, `Input`
6. `client/src/features/test-editor/start-pages-section.tsx` — структура потока
7. `client/src/pages/author/tests-list.tsx` — `ModalDialog`, `Skeleton`, `Button`

Уникальных компонентов из ui-kit задействовано: 19 (`Accordion`, `Banner`, `Button`, `Card`, `CardBody`, `CardHeader`, `ColorPicker`, `EmptyState`, `IconButton`, `Input`, `ModalDialog`, `NumberInput`, `RadioGroup`, `SegmentedControl`, `Select`, `Skeleton`, `Switch`, `Tabs`, `Tag`, `Textarea`).

Не задействованные сейчас компоненты ui-kit (потенциал для дальнейшей миграции): `AppShell`, `Avatar`, `Breadcrumbs`, `Calendar`, `Charts`, `Checkbox`, `Chip`, `ChoiceCard`, `Combobox`, `CommandPalette`, `DataGrid`, `DatePicker`, `Drawer`, `FAB*`, `FileUploader`, `Form*`, `GradientPicker`, `Kanban`, `Matching`, `Menu*`, `Modal` (без `ModalDialog`), `PageNav`, `Pagination`, `Popover`, `ProgressBar`, `Sidebar`, `Slider`, `Spinner`, `Toast`, `Tooltip`, `TransferList`, `Tree`, `WizardSteps`.

### 2.4 State / data

| Пакет | Файлов | Функция |
| --- | --- | --- |
| `@tanstack/react-query` | 28 | Server-state, кэширование, мутации; повсеместно (editor, list, pages, analytics, history, users, logs, groups) |

### 2.5 Routing

| Пакет | Файлов | Функция |
| --- | --- | --- |
| `wouter` | 13 | `Link`, `useLocation`, `Route`, навигация |

### 2.6 Styling utilities

| Пакет | Файлов | Функция |
| --- | --- | --- |
| `clsx` | 1 (`client/src/lib/utils.ts`) | Условная конкатенация классов внутри `cn()` |
| `tailwind-merge` | 1 (там же) | Merge конфликтов Tailwind в `cn()` |
| `class-variance-authority` | 10 (внутри `components/ui/*`) | Вариативные компоненты (`button`, `badge`, `alert`, `label`, `toggle`, `navigation-menu`, ...) |
| `tailwindcss-animate` | Подключён в `tailwind.config.ts` | Keyframes для анимаций |

### 2.7 Узкоспециализированные

| Пакет | Файлов | Функция | Точка использования |
| --- | --- | --- | --- |
| `lucide-react` | 48 | Иконки | Повсеместно |
| `cmdk` | — | (удалён в §1.1) | был в `ui/command.tsx`, фичей не подключался |
| `embla-carousel-react` | — | (удалён в §1.1) | был в `ui/carousel.tsx`, фичей не подключался |
| `input-otp` | — | (удалён в §1.1) | был в `ui/input-otp.tsx`, фичей не подключался |
| `vaul` | 1 wrapper | Drawer | `ui/drawer.tsx`, обёртка используется |
| `date-fns` | 1 | Локализованное форматирование дат | `pages/learner/history.tsx` (locale `ru`) |
| `recharts` | 2 | Bar/line-графики | `pages/author/analytics.tsx`, `test-analytics.tsx` |
| `react-is` | 0 прямых импортов | Type-guards для React-элементов | Транзитивная (нужна Radix/recharts), прямые импорты отсутствуют |

## 3. Server runtime: маппинг «пакет → использование»

| Пакет | Файлы | Функция |
| --- | --- | --- |
| `express` 5.x | 29 | HTTP-фреймворк, монолит `routes.ts` + модули `routes/*.ts` |
| `express-session` | 2 | Session middleware, `SessionData.userId` |
| `memorystore` | 1 | Хранилище сессий в памяти; pair к `express-session`; **сессии не persist между рестартами** |
| `bcryptjs` | 2 (`storage.ts`) | `hash()` при регистрации/сбросе пароля, `compare()` при логине, rounds=10 |
| `@vvlad1973/crypto` | 1 (`server/utils/crypto.ts`) | PBES2 + SHA512 + 10000 итераций для шифрования email (PII); потребители — `storage.ts`, `routes/auth.ts`, `routes/users.ts` |
| `pg` | 1 (`server/db.ts`) | `Pool` (max=20, idle 30s), health-check `SELECT 1`, reconnect backoff |
| `drizzle-orm` | 6 | Диалект `drizzle-orm/node-postgres`, основной CRUD в `storage.ts`, `routes/tests.ts`, `routes/templates.ts`, `services/test-settings.ts` |
| `drizzle-zod` | `shared/schema.ts` | `createInsertSchema` |
| `drizzle-kit` | CLI `npm run db:push` | Конфиг `drizzle.config.ts`; **сейчас в `dependencies`, не в `devDependencies`** |
| `dotenv` | `server/index.ts`, `drizzle.config.ts` | Чтение `.env` |
| `nodemailer` | `server/email.ts` | SMTP-транспорт + fallback на `logger.info`; функции `sendPasswordResetEmail`, `sendAssignmentEmail`, `sendInviteEmail`, `verifySmtpConnection` |
| `multer` | `server/routes.ts` | Загрузка медиа в `uploads/media/`, `diskStorage`, лимит 200 МБ, фильтр MIME (image/audio/video) |
| `exceljs` | `server/utils/excel.ts` + 3 потребителя | Адаптер под старый SheetJS-стиль API: `addJsonSheet`, `readWorkbookFromBuffer`, `workbookToBuffer`; недавний фикс Buffer/ArrayBuffer (`server/utils/excel`, коммит `c564fbc`) |
| `archiver` | `server/scorm/zip.ts` | SCORM-zip с `zlib level=9` |
| `tsx` | npm-скрипты `dev`, `build`, `create-admin` | Прямой запуск TS без сборки |

Типы (`@types/archiver`, `@types/bcryptjs`, `@types/multer`) находятся в `dependencies` — это легальный, но необычный выбор; обычно держат в `devDependencies`.

## 4. Build / Dev / Test

| Пакет | Где подключен | Назначение |
| --- | --- | --- |
| `vite` 8 | `vite.config.ts`, `script/build.ts` | Dev-server (HMR), production-сборка клиента |
| `@vitejs/plugin-react` | `vite.config.ts`, `vitest.config.ts` | JSX/Fast-refresh для prod-сборки, dev и тестов (унифицирован в §1.1) |
| `@vitejs/plugin-react-swc` | — | удалён в §1.1 (дублировал react-плагин в vitest) |
| `@replit/vite-plugin-cartographer` | — | удалён в §1.1 (Replit-наследие, активировался только при `REPL_ID`) |
| `@replit/vite-plugin-dev-banner` | — | удалён в §1.1 (Replit-наследие, активировался только при `REPL_ID`) |
| `esbuild` | `script/build.ts` | Бандл бэка в `dist/index.cjs` (Node, CJS) |
| `tsx` | dev/build/seed-скрипты | Прямой запуск TS |
| `cross-env` | `dev`, `start` | Кроссплатформный `NODE_ENV` |
| `typescript` 5.6.3 | `npm run check` (`tsc`) | Type-check (no-emit) |
| `tailwindcss` 4 + `@tailwindcss/postcss` | `postcss.config.js`, `tailwind.config.ts` | CSS-стек (PostCSS-интеграция, не `@tailwindcss/vite`) |
| `@tailwindcss/typography` | `tailwind.config.ts` | Typography-плагин |
| `tailwindcss-animate` | `tailwind.config.ts` | Анимации |
| `autoprefixer`, `postcss` | `postcss.config.js` | Префиксы CSS |
| `vitest` 4 + `@vitest/coverage-v8` | `vitest.config.ts` | Тесты, jsdom, coverage 50% |
| `@testing-library/react` + `jest-dom` + `user-event` | `client/src/test/setup.ts` | Component-tests |
| `jsdom` | env для `vitest` | Browser-окружение |
| `supertest` + `@types/supertest` | server-тесты | HTTP-интеграция |
| `@eslint/js` | `eslint.config.js` | Recommended-набор правил |
| `@types/*` (node, express, express-session, nodemailer, pg, react, react-dom) | `tsconfig.json` | Типы |
| `bufferutil` (optional) | Транзитивно через `ws` (Storybook/vitest-browser в ui-kit) | Ускоряет WebSocket-кадры |

В корне репозитория лежат `client.zip` и `testing.zip` — это не зависимости, но мусор по гигиене.

## 5. Эффективность и оптимальность выбора

### 5.1 Сильные стороны стека

- **Drizzle + node-postgres**: типобезопасный ORM с минимальным runtime-overhead; диалект `node-postgres` соответствует фактическому драйверу `pg`. Связка корректная.
- **bcryptjs (а не bcrypt)**: чистый JS, нет native-биндинга — удобно в Docker и кросс-платформенно. Незначительно медленнее, чем `bcrypt`, но для login-rate проекта это не bottleneck.
- **react-hook-form + Zod + drizzle-zod**: единая Zod-схема между БД и клиентскими формами через `shared/`. Сокращает дублирование валидации.
- **TanStack Query 5** — индустриальный стандарт для server-state.
- **wouter** вместо react-router: ~1 КБ, достаточен для текущего набора маршрутов и не требует SSR.
- **Vite 8 + esbuild + tsx**: разделение «vite сборка клиента / esbuild сборка бэка / tsx dev» — чисто, без webpack-нагрузки.
- **`@vvlad1973/crypto` PBES2-SHA512**: соответствует требованию GDPR (зашифрованные email), при этом deterministic-режим позволяет искать по email через индекс.

### 5.2 Узкие места и неоптимальные участки

1. **Двойной React-плагин Vite/Vitest** (`plugin-react` + `plugin-react-swc`). Дублирование оправдано только в зрелых проектах с большим test-suite (SWC быстрее в CI). Сейчас оба установлены, поведение JSX-трансформации различается между prod-сборкой и тестами — низкий, но реальный риск расхождения. Рекомендация: унифицировать на `plugin-react-swc` либо подтвердить выбор комментарием.

   **Применено 2026-05-26 (§1.1):** унифицировано на `@vitejs/plugin-react` — этот плагин уже стоит на
   prod-пути, перенос менее рискован, чем менять prod-трансформацию.

2. **42 shadcn-обёртки → 26 активных + 16 wrapper-only**. 14 из неактивных тянут собственный Radix-пакет. Это ~6-8 npm-пакетов dead-weight, около 200-400 КБ распакованного `node_modules` плюс tree-shake-нагрузка при анализе.

   **Частично применено 2026-05-26 (§1.1):** удалены 10 wrapper-only обёрток и 10 пакетов;
   остались `accordion`, `pagination` (последний без уникального Radix-пакета).
3. **`memorystore`**: сессии теряются при каждом рестарте. Для prod-нагрузки нужен Redis (`connect-redis`) или PG-store (`connect-pg-simple`). Сейчас это техдолг, не неоптимальный выбор.
4. **`drizzle-kit` в `dependencies`** вместо `devDependencies`. Это раздувает прод-образ на ~30 МБ (kit и его деревья). Перенос в dev — однострочное улучшение, если миграции не запускаются `npm start`.
5. **`@types/*` (archiver, bcryptjs, multer) в `dependencies`**. Не критично — npm не тянет их в runtime, но прод-образ бьётся.
6. **`zod` v4**. Версия только-только мажорная, экосистема (`drizzle-zod`, `@hookform/resolvers`) подтянулась, но миграционные edge-кейсы возможны.
7. **`recharts` 3.x** для двух графиков. Пакет ~600 КБ min+gzip ~150 КБ. Если речь только о двух bar/line-графиках, можно заменить на `Charts` из ui-kit (`BarChart`, `LineChart`, `ProgressRing`) и убрать `recharts` целиком.
8. **`cmdk`, `embla-carousel-react`, `input-otp`** — каждый сидит в одной shadcn-обёртке, никем больше не вызывается. Чистый dead-weight, пока обёртки не используются в фичах.

   **Применено 2026-05-26 (§1.1):** все три пакета и их wrapper-файлы удалены.

9. **`tsx watch` vs Vite 8**: уже зафиксировано в проектной памяти — `tsx watch` зависает с `vite createServer` v8, поэтому dev-сервер запускается без `--watch`. Server auto-restart отсутствует. Это не дефект пакетов, но фактическое ограничение текущего стека.
10. **`@vitejs/plugin-react-swc` 4.x + `@vitejs/plugin-react` 6.x** — разные major-цепочки, обе официально совместимы с Vite 8, но за совместимость придётся следить вручную при апгрейдах.

    **Применено 2026-05-26 (§1.1):** `@vitejs/plugin-react-swc` удалён; обе ветки сборки идут через
    `@vitejs/plugin-react` 6.x.

## 6. Варианты оптимизации

### 6.1 Уборка dead-weight (low risk, прямой выигрыш)

| Действие | Эффект | Риск | Статус |
| --- | --- | --- | --- |
| Удалить wrapper-only `ui/aspect-ratio.tsx`, `ui/carousel.tsx`, `ui/command.tsx`, `ui/context-menu.tsx`, `ui/hover-card.tsx`, `ui/input-otp.tsx`, `ui/menubar.tsx`, `ui/navigation-menu.tsx`, `ui/sheet.tsx`, `ui/toggle-group.tsx`, и соответствующие Radix-пакеты | -7 Radix-пакетов + cmdk + embla-carousel-react + input-otp | Минимум — обёртки нигде не импортируются | Выполнено 2026-05-26 за исключением `ui/sheet.tsx` (используется `sidebar.tsx`); дополнительно удалён `ui/toggle.tsx` и `@radix-ui/react-toggle` |
| Перенести `drizzle-kit`, `@types/archiver`, `@types/bcryptjs`, `@types/multer` в `devDependencies` | Меньше образ Docker | Нулевой, если `npm run db:push` не вызывается в prod-контейнере | В работе вне этой сессии (изменения уже видны в `git status`) |
| Удалить `client.zip`, `testing.zip` из корня | Чистота репо | Нулевой, если уже в `.gitignore` | Не выполнено |

### 6.2 Унификация Vite-плагинов

- Перевести `vite.config.ts` на `@vitejs/plugin-react-swc` (или оставить классический `plugin-react` и в vitest) — убрать один пакет из дерева. Риск: при переходе на SWC надо проверить, что Fast-Refresh, decorators и emotion (нет в проекте) работают одинаково.

  **Применено 2026-05-26 (§1.1):** выбрано обратное направление — унифицировано на `@vitejs/plugin-react`,
  т.к. он уже стоял на prod-пути и менять prod-трансформацию ради скорости тестов в этом размере проекта
  не оправдано.

### 6.3 Замена `recharts` на ui-kit `Charts`

- ui-kit экспортирует `BarChart`, `LineChart`, `ProgressRing`.
- В проекте всего две страницы аналитики; объём правок небольшой.
- Стоп-фактор: нужно проверить, поддерживает ли ui-kit Charts требуемые конфигурации (легенды, tooltip, динамические series). Если нет — оставить `recharts`.

### 6.4 Миграция shadcn → `@universityrt/ui-kit`

Текущее покрытие — 35% (19 из 54). Из 26 активных shadcn-обёрток 23 имеют аналог в DS (88%). Прямой 1:1 маппинг возможен для 19 (button, card, input, dialog→ModalDialog, select, checkbox, textarea, tabs, table, switch, dropdown→Menu, radio, avatar, tooltip, popover, toast, progress, slider, skeleton).

Поэтапная стратегия (по убыванию ROI):

1. **Этап 1 — pure 1:1 замены без правок UX**: `button`, `input`, `select`, `checkbox`, `switch`, `textarea`, `radio-group`, `tooltip`, `popover`, `skeleton`, `progress`, `slider`, `tabs`. Это около 80 файлов-импортов; правки механические. Эффект: минус 13 shadcn-обёрток, минус ~10 Radix-пакетов, минус `cva` зависимость в этих файлах.
2. **Этап 2 — диалоги и таблицы**: `dialog` → `ModalDialog`, `alert-dialog` → `ModalDialog` (с `confirm`-режимом), `table` → `Table`, `dropdown-menu` → `Menu`, `avatar` → `Avatar`. Семантически близко, но API отличается (особенно у `Menu` vs `dropdown-menu`). Около 30 файлов.
3. **Этап 3 — компоненты с расхождением семантики**: `badge` → `Chip` (визуальная сверка), `collapsible` → `Accordion` (с одним item), `sidebar` (свой DS-вариант), `toggle`/`toggle-group` → `SegmentedControl`.
4. **Этап 4 — пробелы DS**: `aspect-ratio`, `scroll-area`, `separator`, `carousel`, `input-otp`. Либо оставить локальные обёртки (узкая ниша), либо запросить добавление в DS.
5. **Этап 5 — form-stack**: `form` (RHF-обвязка shadcn) против `Form`, `FormField`, `FormGroup`, `FormSection`, `FormCard`, `FormActions` из ui-kit. Это самая инвазивная часть — потребует переписать integration с `react-hook-form`.

### 6.5 Альтернатива миграции — фиксация смешанного стека

Если миграция тянется (см. риски ниже), стоит хотя бы зафиксировать «новые компоненты пишем на ui-kit, legacy shadcn — не трогаем». В CLAUDE.md или ENGINERING_HANDBOOK уже есть DS-AI-AGENT правила — нужно дополнить их явным запретом на новые shadcn-обёртки.

## 7. Стоп-факторы и риски миграции на ui-kit

### 7.1 Стоп-факторы

1. **ui-kit подключён как `file:../ENGINERING_HANDBOOK/ui-kit`**. Линк только локальный, нет публичной регистрации в npm/private registry. Каждое окружение (CI, Docker, dev-машины) должно иметь handbook-репозиторий рядом, либо требуется собрать ui-kit в tarball/publish. Это блокирует прозрачную сборку и контейнеризацию.
2. **Дедупликация React** вручную через alias в `vite.config.ts` и `vitest.config.ts`. Если кто-то поднимет storybook/jest/webpack — придётся повторно настраивать дедуп. Хрупко.
3. **API-расхождения**: `Form`/`Menu`/`SegmentedControl`/`Chip`/`ModalDialog` имеют отличающиеся props от shadcn-аналогов. Прямой sed-замены не получится — нужен PR-by-PR review.
4. **shadcn-`form`-обвязка** глубоко интегрирована с RHF через `<FormField>` + `<Controller>`. ui-kit `Form*`-семейство имеет другую модель композиции; миграция страниц с большим количеством полей (например, `pages/author/questions/*.tsx`) — дорогостоящая.
5. **Отсутствие в DS** `aspect-ratio`, `scroll-area`, `separator`, `carousel`, `input-otp` — три из них реально используются (`scroll-area`, `separator`, `breadcrumb` ok). Часть придётся оставить локально.
6. **Стабильность ui-kit 0.1.0**: версия pre-1.0, API может меняться. Для рабочего продукта это значит фиксировать конкретный коммит handbook-репо и принимать breaking-changes вручную.

### 7.2 Риски

| Риск | Вероятность | Влияние | Митигация |
| --- | --- | --- | --- |
| Breaking changes в ui-kit между версиями | Высокая (0.x релиз) | Среднее | Замок версии (фиксированный коммит/тег), changelog handbook, ручной апгрейд по этапам |
| Регрессии UX/визуала после замены компонентов | Средняя | Высокое (UI-критично) | Wireframes-first проверка (см. memory `feedback_wireframes_first_ui`), скриншот-тесты, постадийный rollout |
| CI/Docker не видит локальную ссылку `file:..` | Средняя | Высокое | Опубликовать ui-kit в внутренний registry (Verdaccio/GitHub Packages) либо собирать tgz в pipeline |
| React duplication из-за peer вне Vite-конфига | Низкая | Высокое (хуки падают) | Перенести dedupe-конфигурацию в общий хелпер; держать тест, который проверяет один экземпляр `react` в build-output |
| Удаление shadcn-обёрток ломает скрытые импорты | Низкая | Среднее | TypeScript-проверка после удаления, тесты `vitest` на критичных страницах |
| `Form*` миграция увеличивает PR-объём | Высокая | Среднее | Делать страницами, не «все формы за раз»; начать с самой простой (`login`, `forgot-password`) |
| Несоответствие визуала между ui-kit и shadcn в переходный период | Высокая | Низкое | Принять explicit, проектная память уже фиксирует «новые UI — DS-only» |
| Зависимость от стороннего репо `ENGINERING_HANDBOOK` для билда | Постоянная | Среднее | Документировать в README; в `docker/Dockerfile` явно копировать handbook на этапе сборки |

### 7.3 Когда миграцию не делать

- Если product-roadmap в ближайшие 3-6 месяцев требует крупных фич, конкурирующих за бюджет — миграция конкурирует за то же время.
- Если команда не контролирует репо `ENGINERING_HANDBOOK` (нельзя влиять на API DS).
- Если ui-kit ещё не покрыт визуальной регрессией (Chromatic) — каждый замен компонент может тихо сломать макет.

## 8. Приоритизация (рекомендуемая последовательность)

1. **Quick wins (1-2 дня)**: удалить wrapper-only shadcn-обёртки, перенести `drizzle-kit` и `@types/*` в `devDependencies`, унифицировать React-плагины Vite. Удалить мусорные zip-файлы из корня.

   **Прогресс 2026-05-26 (§1.1):** wrapper-only обёртки и React-плагины сделано; перенос `drizzle-kit`
   и `@types/*` в `devDependencies` — в работе вне этой сессии; `client.zip`/`testing.zip` пока в корне.

2. **Среднесрочно (2-3 спринта)**: миграция «безопасной двадцатки» shadcn → ui-kit (этапы 1-2 из 6.4), параллельно зафиксировать DS-only-правило для нового кода.
3. **Перед prod-сценариями**: заменить `memorystore` на persistent store (`connect-pg-simple` поверх существующего `pg`), снять зависимость от перезапуска.
4. **Опционально**: заменить `recharts` на `Charts` из ui-kit, если конфигурации совпадают.
5. **Стратегически**: опубликовать `@universityrt/ui-kit` в private registry — это снимает главный стоп-фактор (см. 7.1.1).
6. **Запланировано (PRD-9):** доработать `@vvlad1973/crypto` (добавить scrypt-based password hashing)
   и удалить `bcryptjs` через ленивый rehash при логине. См.
   [`docs/specs/prd-9/crypto-password-hashing.md`](../specs/prd-9/crypto-password-hashing.md).

## 9. Что НЕ трогать

- `drizzle-orm` + `pg`: связка работает корректно, миграция на `postgres.js` или `neon-serverless` не оправдана без причины.
- `bcryptjs`: пока нет performance-боли — лучше pure-JS вариант, чем native `bcrypt`.
  **Уточнение 2026-05-26 (PRD-9):** пакет будет полностью заменён на `scrypt` из встроенного `node:crypto`
  через расширение `@vvlad1973/crypto`. Это не «оптимизация ради скорости» (PRD не про performance),
  а консолидация криптостека — обе задачи (irreversible password hashing и reversible email encryption)
  встают на одну библиотеку поверх Node-нативного `crypto`. Без `@vvlad1973/crypto` оставление
  `bcryptjs` по-прежнему оправдано.
- `wouter`: маленький, быстрый, текущие маршруты покрывает.
- `@tanstack/react-query`: индустриальный стандарт, замены не требует.
- `Vite 8 + esbuild + tsx`: текущая конфигурация рабочая; апгрейды только при сильной причине.
- `@vvlad1973/crypto`: завязан на схему БД (зашифрованные email), замена потребует миграции данных.
