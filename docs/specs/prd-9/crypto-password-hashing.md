# PRD-9: Доработка @vvlad1973/crypto и отказ от bcryptjs

**Версия:** 1.0
**Статус:** Backlog (queued, шаг 8 ROADMAP — tech debt, low priority)
**Дата актуализации:** 2026-05-26
**Связанные документы:** [Service Architecture](../../architecture/service-architecture.md),
[Deps audit 2026-05](../../reports/deps-audit-2026-05.md), [ROADMAP](../../ROADMAP.md)
**Зависимости:** npm-пакет `@vvlad1973/crypto` (внешний, владелец — тот же автор),
`server/storage.ts`, `server/utils/crypto.ts`, `script/create-admin.ts`

## Статус реализации (на 2026-05-26)

**Не начато**. Tech debt, добавлен в [ROADMAP](../../ROADMAP.md) шагом 8. БД-миграция не
требуется (колонка `passwordHash` имеет тип `text`). Legacy bcrypt-хеши поддерживаются
через lazy rehash при логине. Не блокирует другие PRD; может выполняться параллельно
с PRD-3 после стабилизации PRD-7 S9-S11.

**Текущие файлы с `bcryptjs`**: `server/storage.ts` (`createUser`, `validatePassword`,
`updateUserPassword`, demo seeder), `script/create-admin.ts`, тесты `tests/storage*.test.ts`,
`script/build.ts` (forceExternal).

---

## 1. Обзор

### 1.1 Контекст

В проекте используются два разных криптографических пакета:

- `@vvlad1973/crypto` — тонкая обёртка над встроенным `node:crypto` (AES-256-CTR + PBKDF2),
  применяется в `server/utils/crypto.ts` для обратимого шифрования email (PII) и хеша email для поиска.
  Runtime-зависимостей у пакета нет, native-биндингов не приносит.
- `bcryptjs` — pure-JS bcrypt, применяется в `server/storage.ts` для одностороннего хеширования
  паролей (`bcrypt.hash`, `bcrypt.compare`, rounds=10) и в `script/create-admin.ts` при сидинге.

Функционально это две разные задачи (обратимое шифрование PII vs необратимое хеширование пароля),
но в коде они представлены двумя отдельными SDK с разными API. Для проекта это означает лишний
runtime-пакет (`bcryptjs` + `@types/bcryptjs`), отдельный `forceExternal` в `script/build.ts`
и дублирование mock-точек в тестах (`tests/storage.test.ts`, `tests/storage2.test.ts`).

При этом всё, что делает `bcryptjs`, можно построить поверх того же `node:crypto`, который уже
лежит в основе `@vvlad1973/crypto`. Встроенный `crypto.scrypt` соответствует рекомендации OWASP
для password storage, поддерживает per-record salt и адаптивный cost-factor.

### 1.2 Цель

Свести криптографические нужды проекта к одной библиотеке `@vvlad1973/crypto`:

1. Добавить в пакет `@vvlad1973/crypto` API для одностороннего хеширования паролей
   на базе `crypto.scrypt` (встроенный Node.js).
2. Заменить вызовы `bcrypt.hash` / `bcrypt.compare` в `server/storage.ts`
   и `script/create-admin.ts` на новое API из `@vvlad1973/crypto`.
3. Сохранить совместимость с уже сохранёнными в БД bcrypt-хешами через ленивый rehash
   при первом успешном логине.
4. Удалить `bcryptjs` и `@types/bcryptjs` из `package.json`, чистить `script/build.ts`
   (`forceExternal`) и заменить mock-точки в тестах.

### 1.3 Метрики успеха

| Цель | Метрика |
| --- | --- |
| Пакет покрывает обе задачи | `@vvlad1973/crypto` экспортирует hash/verify для пароля и сохраняет AES API для email |
| Зависимости проекта сокращены | В `package.json` не остаётся `bcryptjs` и `@types/bcryptjs` |
| Совместимость с legacy-хешами | 100% пользователей с `$2a$...` логинятся и получают rehash в новый формат |
| Сборка не требует special-case | Из `script/build.ts:forceExternal` убран `bcryptjs` |
| Тесты обновлены | `tests/storage.test.ts`, `tests/storage2.test.ts` не содержат `vi.mock("bcryptjs", ...)` |

---

## 2. Пользователи и заинтересованные стороны

### 2.1 Пользователи приложения

Пользователи не должны заметить миграцию: пароли продолжают работать без сброса, время логина
сопоставимо с текущим (scrypt-параметры подобраны под аналогичную задержку, см. раздел 4.2).

### 2.2 Сопровождающий проекта

Уменьшается количество runtime-зависимостей и точек обновления, упрощается аудит безопасности
(одна криптобиблиотека вместо двух), пропадает специальное обращение с `bcryptjs` в `script/build.ts`.

### 2.3 Автор пакета @vvlad1973/crypto

Получает доработку самого пакета: новый класс/метод для password-хеширования, описание в README,
покрытие тестами, отдельный мажорный релиз с changelog.

---

## 3. Объём работ

### 3.1 Часть А: доработка пакета `@vvlad1973/crypto`

Работа выполняется в репозитории пакета (вне `test-builder`), результат — новая мажорная версия
в npm.

Требования к API:

- Экспортировать утилиту password-хеширования. Возможные формы:
  - функции верхнего уровня `hashPassword(plain, options?)`, `verifyPassword(plain, stored)`;
  - либо класс `PasswordHasher` с методами `hash`, `verify` (по аналогии с существующим `Crypto`).
- Алгоритм по умолчанию: `crypto.scrypt` с параметрами OWASP-рекомендованного профиля
  (например, `N=2^15, r=8, p=1, keyLength=64`); параметры опционально настраиваются.
- Соль: per-record, длина >= 16 байт, генерируется через `crypto.randomBytes`.
- Формат хранимого значения: единая строка с префиксом версии и параметрами, например
  `scrypt$1$N=32768,r=8,p=1$<saltHex>$<hashHex>`. Префикс нужен, чтобы будущая ротация параметров
  не требовала миграции схемы БД и чтобы можно было отличать новый формат от bcrypt (`$2a$...`).
- `verifyPassword` использует `timingSafeEqual` для constant-time-сравнения.
- API асинхронное (`async` / `Promise`) — `scrypt` достаточно дорогой, чтобы не блокировать loop.
- Никаких новых runtime-зависимостей у пакета не появляется (только `node:crypto`).

Документация и релиз:

- Обновить `README.md` пакета: добавить раздел Password hashing с примерами и пояснением,
  что AES API остаётся для обратимого шифрования.
- Обновить TypeDoc-документацию (`docs/`).
- Добавить unit-тесты на hash/verify, edge-cases (короткий/пустой пароль, неверный формат,
  таймсейф сравнение).
- Поднять мажорную версию (минимум `2.x -> 3.0`, если меняется default export shape;
  иначе минор), записать в changelog.
- Опубликовать в npm под существующим тегом доступа.

Точки риска:

- Подбор `scrypt` параметров: время хеширования должно остаться в пределах 50-200 мс на типичном
  prod-CPU, иначе логин начнёт ощутимо тормозить. Окончательные параметры зафиксировать после
  замера на целевом окружении (см. раздел 4.2).
- Нужно проверить, что добавление нового API не ломает существующих потребителей (минимум —
  сам `test-builder/server/utils/crypto.ts` должен компилироваться без изменений после обновления).

### 3.2 Часть Б: миграция test-builder

Работа в `test-builder` после публикации новой версии пакета.

Изменения в коде:

- `server/utils/crypto.ts` — добавить `hashPassword` / `verifyPassword` обёртки поверх
  `@vvlad1973/crypto` (или реэкспортировать). Сюда же логика определения формата хеша:
  - значение начинается с `$2a$` / `$2b$` / `$2y$` — это legacy bcrypt;
  - значение начинается с `scrypt$` — новый формат.
- `server/storage.ts`:
  - `createUser`, `updateUserPassword`, демо-сидер (admin/learner) переводятся на `hashPassword`;
  - `verifyCredentials` (`getUserByEmailWithPassword` / соответствующий метод) проверяет хеш по
    формату; для legacy bcrypt — переходный путь, см. ниже;
  - убрать `import bcrypt from "bcryptjs"`.
- `script/create-admin.ts` — заменить вызов на `hashPassword` из общего модуля.
- `script/build.ts` — убрать `bcryptjs` из массива `forceExternal`.
- `tests/storage.test.ts`, `tests/storage2.test.ts` — заменить `vi.mock("bcryptjs", ...)`
  на mock новой функции либо на честное использование scrypt в тестах
  (scrypt быстрый при низких параметрах, можно прокинуть test-профиль).
- `package.json`:
  - убрать `bcryptjs` из `dependencies`;
  - убрать `@types/bcryptjs` из `devDependencies`;
  - поднять минимальную версию `@vvlad1973/crypto` до релиза с password API.

Legacy-совместимость bcrypt-хешей:

- При логине, если у пользователя в `passwordHash` лежит значение в формате bcrypt,
  и пароль прошёл проверку через `bcryptjs.compare` через **временную** утилиту (см. ниже) —
  немедленно перехешировать пароль scrypt-ом и обновить запись (`passwordHash = scryptHash(plain)`).
- Чтобы не тащить `bcryptjs` как dependency, проверку bcrypt-хеша делать через минимальную
  собственную реализацию compare (или временно держать `bcryptjs` под dynamic import + deprecation
  warning). Окончательный выбор зафиксировать на этапе детального дизайна; в любом случае bcryptjs
  не должен оказаться в prod-bundle после миграции.
- Метрика на отдельный счётчик `auth.legacy_bcrypt_rehash`. После того как метрика длительно
  стоит на нуле, удалить ветку проверки bcrypt и сам fallback.

Out of scope:

- Изменение политики паролей (длина, сложность, blacklist).
- Изменение схемы БД (тип/длина колонки `passwordHash`). Проверить, что новый формат укладывается
  в текущий тип, иначе вынести в отдельную миграцию.
- Замена `@vvlad1973/crypto` API для email — этот блок не трогаем.

---

## 4. Технические требования

### 4.1 Совместимость

- Хранимое значение пароля остаётся одной строкой в колонке `users.passwordHash`. Никаких новых
  колонок и таблиц.
- Любой пользователь, чей хеш был создан старой версией кода, должен мочь залогиниться без сброса.
- После успешного логина пользователя с bcrypt-хешем хеш записывается в новом формате; повторный
  логин уже не идёт через bcrypt-ветку.
- Существующие тесты, не относящиеся к авторизации, не меняются.

### 4.2 Производительность

- Целевое время `hashPassword` на CI/prod-CPU: 50-200 мс.
- Целевое время `verifyPassword` совпадает с `hashPassword` (одинаковая работа).
- Параметры scrypt подобрать измерением, зафиксировать в коде пакета и в этом PRD как ADR-приложении.

### 4.3 Безопасность

- Соль уникальная на каждый вызов `hashPassword`, не короче 16 байт.
- Сравнение через `timingSafeEqual`.
- Никаких глобальных секретов или захардкоженных параметров: соль и параметры сохраняются в самом
  хеш-строке.
- Документировано: `@vvlad1973/crypto.encrypt/decrypt` — для обратимого шифрования PII;
  `hashPassword/verifyPassword` — только для паролей. Эти API не взаимозаменяемы.

### 4.4 Аудитируемость

- Логирование: успешный rehash legacy-хеша пишет info-событие с user id (без пароля и хеша).
- Метрика-счётчик `auth.legacy_bcrypt_rehash` доступна оператору для отслеживания доли
  смигрированных пользователей.

---

## 5. План выполнения

### 5.1 Этап 1 — Пакет

1. Спека API и формата хранения (`scrypt$<ver>$<params>$<salt>$<hash>`).
2. Реализация в `@vvlad1973/crypto`, тесты, README, TypeDoc.
3. Замер параметров scrypt на целевом CPU, фиксация дефолтов.
4. Релиз новой версии в npm.

### 5.2 Этап 2 — Test-builder

1. Поднять зависимость `@vvlad1973/crypto` до новой версии.
2. Добавить `hashPassword`/`verifyPassword` обёртки в `server/utils/crypto.ts`.
3. Перевести `storage.ts`, `script/create-admin.ts` на новое API.
4. Реализовать legacy-совместимость и rehash при логине.
5. Обновить тесты (`tests/storage.test.ts`, `tests/storage2.test.ts`).
6. Убрать `bcryptjs` и `@types/bcryptjs` из `package.json`, очистить `script/build.ts:forceExternal`.
7. Прогнать `npm run check`, `npm test`, smoke авторизации (логин старого юзера, логин нового юзера,
   создание нового аккаунта, сброс пароля).

### 5.3 Этап 3 — Чистка

1. Дать метрике `auth.legacy_bcrypt_rehash` отстояться (минимум один полный цикл активных
   пользователей).
2. После того как ноль за стабильный период — удалить legacy-ветку проверки bcrypt из
   `storage.ts` и связанной утилиты.
3. Обновить документацию (`docs/architecture/service-architecture.md`, `docs/reports/deps-audit-2026-05.md`,
   `README.md`) — убрать `bcryptjs` из списков зависимостей.

---

## 6. Acceptance criteria

- В `package.json` нет `bcryptjs` и `@types/bcryptjs`.
- В `script/build.ts:forceExternal` нет `bcryptjs`.
- `grep -r "bcryptjs"` по репозиторию (без `node_modules`, `docs/legacy`, `.local`) даёт ноль
  совпадений в коде; разрешены упоминания только в исторических PRD/changelog.
- Существующий пользователь с bcrypt-хешем успешно логинится; после логина его `passwordHash`
  в БД начинается с `scrypt$`.
- Новый пользователь после `createUser` имеет `passwordHash`, начинающийся с `scrypt$`.
- `npm run check` и `npm test` зелёные.
- README.md пакета `@vvlad1973/crypto` содержит раздел про password hashing с примерами.

---

## 7. Открытые вопросы

1. Финальный профиль scrypt-параметров (нужны замеры на целевом prod-CPU).
2. Форма API: функции верхнего уровня vs отдельный класс `PasswordHasher`. Решить на этапе спеки
   пакета.
3. Способ временной проверки bcrypt-хешей в test-builder без runtime-зависимости от `bcryptjs`:
   а) dynamic import + deprecation warning, б) минимальная локальная реализация compare,
   в) короткое окно сосуществования с bcryptjs в `dependencies`.
4. Нужна ли поддержка argon2id поверх того же API в будущем (предусмотреть префикс/расширяемость
   формата хранения), либо ограничиться scrypt.
