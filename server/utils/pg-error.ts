/**
 * @module server/utils/pg-error
 * @description Код ошибки PostgreSQL из того, что бросил запрос.
 *
 * Drizzle заворачивает ошибку драйвера в `DrizzleQueryError`, и SQLSTATE лежит в `cause`, а не
 * на самой ошибке. Проверка `error.code === "23505"` поэтому не срабатывала НИКОГДА: повторное
 * имя сохранённого фильтра уходило читателю как 500 «Failed to save slice» вместо понятного 409,
 * а гонка загрузки одного файла в медиатеке — исключением вместо повторного чтения победителя.
 */

/** Нарушение уникальности. */
export const UNIQUE_VIOLATION = "23505";
/** Нарушение внешнего ключа. */
export const FOREIGN_KEY_VIOLATION = "23503";

/** Сколько звеньев `cause` просматривать: цепочка короткая, предел — защита от петли. */
const MAX_DEPTH = 5;

/**
 * SQLSTATE ошибки запроса: на самой ошибке или в цепочке её причин.
 *
 * @param error то, что бросил запрос
 * @returns пятизначный код или `undefined`, если это не ошибка базы
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_DEPTH && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Нарушение уникальности — на любом уровне обёртки.
 *
 * @param error то, что бросил запрос
 */
export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION;
}
