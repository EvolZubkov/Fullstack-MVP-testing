/**
 * @module shared/questions/blanks
 *
 * Разметка пропуска в тексте задания (PRD-57 FR-24): `{{идентификатор}}`.
 *
 * Разбор ОДИН на весь продукт, и это не вкусовщина: по нему строится список пропусков в
 * ящике, по нему же рендер ставит поля на экране участника, подстановка печатает прочерк в
 * обзоре и в отчёте, а выдача складывает эталоны для LMS. Второй разбор означал бы, что
 * список и экран расходятся во мнении, где пропуск, — и расходились бы они молча.
 *
 * Совпадение написания с шаблонизатором (`shared/template/dsl.ts`) проверено и безопасно:
 * текст задания попадает на экран как ДАННЫЕ, а не как шаблон. Обратная сторона записана в
 * требованиях: двойные фигурные скобки в тексте задания заняты, и подстановка переменных,
 * если она когда-нибудь понадобится, обязана получить другое написание.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */

/** Одно вхождение `{{…}}` в тексте. */
export interface BlankOccurrence {
  /** Имя пропуска без скобок. */
  id: string;
  /** Положение первой скобки и позиция сразу за последней. */
  start: number;
  end: number;
  /** Имя уже встречалось выше по тексту (FR-24a: повтор запрещён). */
  duplicate: boolean;
  /** Написание из зарезервированного набора — `{{#…}}`, `{{$…}}`, `{{&…}}`, `{{>…}}`. */
  reserved?: boolean;
}

export interface ParseOptions {
  /**
   * Вернуть и зарезервированные написания. Их читает ТОЛЬКО редактор, чтобы предупредить
   * автора: молча печатать `{{#if}}` как текст нельзя — человек, написавший это, ждал
   * чего угодно, только не буквальной печати (FR-24j).
   */
  withReserved?: boolean;
}

/** Имя пропуска: латиница, цифры, подчёркивание. Регистр значим. */
const NAME = /^[A-Za-z0-9_]+$/;

/** Префиксы, оставленные на будущее (FR-24j). */
const RESERVED = "#$&>/^!";

/**
 * Разобрать текст задания.
 *
 * @param text    Текст как его набрал автор.
 * @param options См. {@link ParseOptions}.
 * @returns Вхождения по порядку. Пустое имя (`{{}}`) вхождением не считается: автор ещё
 *   печатает, и это состояние, а не ошибка (FR-24b).
 */
export function parseBlanks(text: string, options: ParseOptions = {}): BlankOccurrence[] {
  if (typeof text !== "string" || text === "") return [];
  const found: BlankOccurrence[] = [];
  const seen = new Set<string>();

  for (let at = 0; at < text.length - 1; at += 1) {
    if (text[at] !== "{" || text[at + 1] !== "{") continue;
    // Экранирование: `\{{` печатается буквально (FR-24e). Слеш снимает подстановку и
    // сам исчезает при показе — так принято в разметке, и автор этого ждёт.
    if (at > 0 && text[at - 1] === "\\") {
      at += 1;
      continue;
    }
    const close = text.indexOf("}}", at + 2);
    if (close === -1) break;
    const id = text.slice(at + 2, close);
    const end = close + 2;

    if (RESERVED.indexOf(id.charAt(0)) !== -1) {
      if (options.withReserved) found.push({ id, start: at, end, duplicate: false, reserved: true });
      at = end - 1;
      continue;
    }
    if (!NAME.test(id)) {
      at = end - 1;
      continue;
    }
    found.push({ id, start: at, end, duplicate: seen.has(id) });
    seen.add(id);
    at = end - 1;
  }

  return found;
}

/**
 * Имена пропусков задания — по одному на имя, в порядке первого вхождения.
 *
 * Это и есть список, который показывает ящик вопроса: повтор имени запрещён (FR-24a), и
 * показывать его второй строкой значило бы обещать второй набор правил.
 */
export function blankIds(text: string): string[] {
  const ids: string[] = [];
  for (const blank of parseBlanks(text)) {
    if (!blank.duplicate) ids.push(blank.id);
  }
  return ids;
}
