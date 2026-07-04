# План миграции оболочки приложения на DS AppShell + Sidebar

**Статус:** Реализован 2026-06-10 (tsc + сборка + тесты зелёные); живая визуальная сверка
авторской оболочки — за пользователем (нужен dev-стенд с БД)
**Дата актуализации:** 2026-06-10
**Связанные документы:** [PRD-14](./specs/prd-14/questions-import-export.md) (пункт навигации
«Импорт/экспорт» добавляется после миграции)

---

## 1. Контекст и цель

Фичевые экраны уже используют дизайн-систему `@universityrt/ui-kit` (templates,
секции редактора теста, панель доступа). При этом **главная оболочка приложения и боковая
навигация остаются на shadcn** ([components/ui/sidebar.tsx](../client/src/components/ui/sidebar.tsx)
через [app-sidebar.tsx](../client/src/components/app-sidebar.tsx) и
[pages/author/layout.tsx](../client/src/pages/author/layout.tsx)). Это последний «островок»
не-DS во фрейме и расхождение с правилом «брать готовые компоненты из ui-kit».

В ui-kit есть готовые `AppShell` (рендерит `ou-shell` со слотами `side`/`header`/`main`) и
`Sidebar` (рендерит `ou-side`, принимает `groups`/`activeId`/`onSelect`/`collapsed`/`brand`/
`footer`; пункт — `{ id, label, icon, badge }`).

**Цель:** перевести авторскую оболочку с shadcn на DS `AppShell` + `Sidebar`, сохранив
поведение (навигация, активный пункт, гейтинг по правам PRD-13, пользователь и выход).

## 2. Охват

Малый — shadcn-сайдбар используют только два файла:

- [pages/author/layout.tsx](../client/src/pages/author/layout.tsx) — `SidebarProvider` +
  `AppSidebar` + `SidebarTrigger`;
- [components/app-sidebar.tsx](../client/src/components/app-sidebar.tsx) — пункты навигации,
  бренд, пользователь, выход.

Не затрагивается:

- **Learner-оболочка** ([pages/learner/layout.tsx](../client/src/pages/learner/layout.tsx))
  боковую навигацию не использует.
- **CSS** уже подключён глобально ([index.css](../client/src/index.css) импортирует
  `styles/vendor/university-rt.css`) — стили `ou-shell`/`ou-side` доступны, проводка не нужна.
- **Тесты** vitest от сайдбара не зависят; `data-testid` (`button-logout`,
  `button-sidebar-toggle`) сохранить для возможных e2e.

## 3. Решения

| Тема | Решение |
| --- | --- |
| Мобильная вёрстка | **Вне охвата** (сейчас не актуальна): off-canvas + мобильный триггер не сохраняем. Только десктопный DS `Sidebar`; коллапс (64px) — опционально |
| Пользователь + выход | Слот `footer` у `Sidebar` (паритет с текущим расположением внизу) |
| Навигация | Пункты — `onSelect(id)` → `setLocation` (wouter); `activeId` из `useLocation`; гейтинг по `can(perm)` (PRD-13) сохраняется |
| Бренд | Имя приложения + иконка → ссылка на `/` (слот `brand`) |

## 4. Целевая структура

- `pages/author/layout.tsx`:
  `<AppShell side={<Sidebar groups activeId onSelect brand footer/>} header={…}>{children}</AppShell>`.
- `components/app-sidebar.tsx` → адаптер: строит `Sidebar.groups` из текущего `authorNavItems`
  (фильтр `can(perm)`), `icon` (lucide), `label` (i18n `t.navigation.*`); footer — пользователь
  (аватар/имя/роль) + кнопка выхода.

## 5. Шаги

1. Адаптер конфигурации `Sidebar` (группы/пункты из `authorNavItems` + `can()`), иконки и метки.
2. Переписать `author/layout.tsx` на `AppShell` + `Sidebar`: активный пункт по `location`,
   `onSelect` → навигация, бренд, footer (пользователь + выход).
3. Проверка: `npm run check`, vitest, визуальная сверка десктопа (Playwright); сверка с
   approved-эскизами оболочки (`prd3-templates-admin.html` как образец `ou-shell`/`ou-side`).
4. Выпил использования shadcn-сайдбара; удалить [components/ui/sidebar.tsx](../client/src/components/ui/sidebar.tsx),
   если он больше нигде не нужен (сейчас — только эти два файла).

## 6. Риски

| Риск | Митигация |
| --- | --- |
| Различие активных состояний/клавиатурной навигации | Сверка с эскизом-образцом; ручная проверка фокуса/active |
| Удаление shadcn `ui/sidebar.tsx` затронет скрытого потребителя | Перед удалением — повторный grep по `components/ui/sidebar` (сейчас только 2 файла) |
| Регресс гейтинга по правам | Сохранить `can(perm)`-фильтр пунктов; проверить под разными ролями |

## 7. Критерии приёмки

- [x] Авторская оболочка рендерится через DS `AppShell` + `Sidebar` (`ou-shell`/`ou-side`) —
  [layout.tsx](../client/src/pages/author/layout.tsx) + [app-sidebar.tsx](../client/src/components/app-sidebar.tsx)
- [x] Навигация (onSelect→wouter), активный пункт (по location), бренд, пользователь и выход — в коде
- [x] Пункты фильтруются по правам (PRD-13, `can(perm)`)
- [x] shadcn `@/components/ui/sidebar` не используется; файл удалён
- [x] `npm run check`, `npm run build` и vitest зелёные (кроме несвязанного DB-теста); learner не затронут
- [x] Визуальная сверка оболочки — faithful-реплика (реальный собранный CSS приложения +
  точная разметка, которую эмитят `AppShell`/`Sidebar`), Playwright-скриншот: бренд, группа,
  пункты с active-подсветкой, футер (пользователь + «Выход»), шапка с тоглом — корректны
- [ ] Живой прогон на dev-стенде с БД (рантайм/интеракции) — рекомендуется дополнительно (БД в окружении не поднята)

## 8. Вне охвата

- Мобильная/адаптивная вёрстка сайдбара (сейчас не актуальна).
- Learner-оболочка.
- Функционал импорта/экспорта (PRD-14): после миграции добавляется один пункт «Импорт/экспorт»
  в `Sidebar` и страница раздела — это отдельная задача PRD-14.

## 9. Будущая задача: заголовок страницы в шапке (header-title)

Решение 2026-06-11: принять паттерн «заголовок страницы — в `ou-shell__header` слева» (как в
approved `prd3-templates-admin`) для **всех** авторских страниц — но **отдельной задачей, позже**.

- Сейчас страницы рисуют заголовок в контенте через компонент `PageHeader`
  ([client/src/components/page-header.tsx](../client/src/components/page-header.tsx)).
- Задача: дать `AppShell`-шапке слот заголовка (через проп/контекст/route→title), перенести
  заголовки со всех страниц, убрать дублирующий `PageHeader`-в-контенте (учесть страницы с
  «богатой» шапкой: подзаголовок, действия, фильтры — для них решить, что остаётся в контенте).
- Эскиз раздела «Импорт» (`docs/wireframes/prd14-workbook.html`) уже показывает целевой вид
  (заголовок в шапке). До выката этой задачи реализация раздела «Импорт» может временно
  использовать текущий `PageHeader`-в-контенте — выровняется в рамках этой задачи.
