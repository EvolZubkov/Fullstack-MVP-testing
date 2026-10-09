/**
 * @module features/questions/insert-markup
 *
 * Вставка разметки кнопкой в текст задания (PRD-57 FR-09a, FR-24b): листинг, формула,
 * пропуск.
 *
 * Чистые функции над строкой и положением курсора — без DOM и без формы. Так поведение
 * вставки проверяется тестом на всех краевых случаях (пустое поле, край текста, выделение),
 * а ящик остаётся тем, чем должен быть: местом, где это поведение вызывают.
 *
 * Правило, общее для всех трёх: ПУСТАЯ вставка оставляет курсор внутри (автор продолжит
 * печатать там же), а вставка вокруг ВЫДЕЛЕННОГО оставляет его за вставкой — внутри уже
 * набрано то, ради чего кнопку и нажали.
 */

/** Языки листинга — ровно те, что умеет подсветка сервера (Э1). */
export const CODE_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "python", label: "Python" },
  { value: "sql", label: "SQL" },
  { value: "javascript", label: "JavaScript" },
  // Пустой язык — блок без подсветки. Слово «text» сюда не пишется: подсветка его не
  // знает, и автор получил бы язык, которого нет.
  { value: "", label: "Без подсветки" },
];

export type MarkupKind = "code" | "formula" | "blank";

export interface InsertMarkupInput {
  kind: MarkupKind;
  /** Язык листинга; пусто — блок без подсветки. Прочие виды его игнорируют. */
  language?: string;
  /** Текст задания как он есть сейчас. */
  value: string;
  /** Границы выделения (курсор — когда они совпадают). */
  from: number;
  to: number;
}

export interface InsertMarkupResult {
  value: string;
  /** Куда поставить курсор после перерисовки поля. */
  caret: number;
}

/** Положение в пределах строки: поле могло сообщить позицию за концом текста. */
function clamp(position: number, length: number): number {
  if (!Number.isFinite(position) || position < 0) return 0;
  return Math.min(position, length);
}

/**
 * Вставить разметку в текст задания.
 *
 * @param input Вид разметки, текущий текст и границы выделения.
 * @returns Новый текст и положение курсора.
 */
export function insertMarkup(input: InsertMarkupInput): InsertMarkupResult {
  const value = input.value ?? "";
  const from = clamp(Math.min(input.from, input.to), value.length);
  const to = clamp(Math.max(input.from, input.to), value.length);
  const selected = value.slice(from, to);
  const before = value.slice(0, from);
  const after = value.slice(to);

  if (input.kind === "code") {
    const language = (input.language ?? "").trim();
    // Блок кода — блочная разметка: приклеенный к абзацу, он не будет распознан как
    // листинг вовсе. Пустая строка добавляется только если её там ещё нет.
    const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const tail = after === "" || after.startsWith("\n") ? "" : "\n";
    const body = selected === "" ? "" : selected;
    const block = "```" + language + "\n" + body + "\n```";
    return {
      value: before + lead + block + tail + after,
      // Пустой блок — курсор на пустой строке внутри; с выделенным кодом — за блоком.
      caret: selected === ""
        ? before.length + lead.length + block.length - 4
        : before.length + lead.length + block.length,
    };
  }

  const [open, close] = input.kind === "formula" ? ["$$", "$$"] : ["{{", "}}"];
  const inserted = open + selected + close;
  return {
    value: before + inserted + after,
    caret: selected === ""
      ? before.length + open.length
      : before.length + inserted.length,
  };
}
