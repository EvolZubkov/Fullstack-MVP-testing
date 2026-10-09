/**
 * @module features/questions/answer-rules/regex-bar
 *
 * Панель вставки кусков выражения (PRD-57 FR-28i).
 *
 * Зачем она: автор, которому нужна проверка формата, редко помнит наизусть, что `\s` —
 * это пробел, а `{2,4}` — счётчик. Кнопка ставит кусок в позицию курсора, подсказка
 * объясняет словами — и выражение собирается из понятных частей, а не набирается по
 * памяти.
 *
 * Порядок кнопок — из согласованного эскиза (`prd57-answer-rule.html`, состояние
 * `k-regex`) и повторяет порядок мысли: из чего состоит ответ → сколько раз это
 * повторяется → где ответ начинается и кончается. Подписи тоже оттуда, дословно: их
 * писали, чтобы автор понял без документации.
 */
import { Button, Tooltip } from "@skillum/ui-kit";

/** Один кусок выражения: что вставляется и как это объясняется. */
interface Piece {
  /** Что видно на кнопке и что попадает в выражение. */
  insert: string;
  title: string;
  hint: string;
  /**
   * Куда встанет курсор после вставки, считая от конца вставленного куска. Для парных
   * знаков — внутрь, потому что следом автор пишет именно там.
   */
  caretBack?: number;
}

const PIECES: Piece[] = [
  { insert: ".", title: "Любой символ", hint: "Один любой символ: буква, цифра, пробел, знак" },
  { insert: "\\d", title: "Цифра", hint: "Одна любая цифра от 0 до 9" },
  { insert: "\\w", title: "Буква или цифра", hint: "Одна буква, цифра или знак подчёркивания" },
  { insert: "\\s", title: "Пробел", hint: "Пробел, табуляция или перенос строки" },
  { insert: "[абв]", title: "Набор символов", hint: "Один символ из перечисленных в скобках", caretBack: 1 },
  { insert: "()", title: "Группа", hint: "Часть выражения, к которой относится повтор или перечисление", caretBack: 1 },
  { insert: "|", title: "Или", hint: "Подходит либо то, что слева, либо то, что справа" },
  { insert: "?", title: "Ноль или один раз", hint: "Предыдущий кусок может быть, а может отсутствовать" },
  { insert: "*", title: "Сколько угодно раз", hint: "Предыдущий кусок повторяется любое число раз или отсутствует" },
  { insert: "+", title: "Один раз и больше", hint: "Предыдущий кусок повторяется хотя бы раз" },
  { insert: "{2,4}", title: "Ровно столько раз", hint: "Предыдущий кусок повторяется от двух до четырёх раз" },
  { insert: "^", title: "Начало ответа", hint: "Совпадение считается от начала ответа, а не с середины" },
  { insert: "$", title: "Конец ответа", hint: "Совпадение должно доходить до конца ответа" },
];

export interface RegexBarProps {
  /** Поле выражения: в него вставляется кусок и в нём остаётся курсор. */
  field: () => HTMLInputElement | null;
  /** Новое выражение целиком — хост сохраняет его в правило. */
  onInsert: (value: string) => void;
}

/**
 * Панель вставки над полем выражения.
 *
 * Вставка идёт В ПОЗИЦИЮ КУРСОРА, а не в конец: автор правит середину выражения чаще,
 * чем дописывает хвост, и кнопка, роняющая кусок в конец, заставляет его вырезать и
 * переносить руками.
 */
export function RegexBar({ field, onInsert }: RegexBarProps) {
  const insert = (piece: Piece) => {
    const input = field();
    if (!input) return;
    const value = input.value ?? "";
    const from = input.selectionStart ?? value.length;
    const to = input.selectionEnd ?? from;
    const next = value.slice(0, from) + piece.insert + value.slice(to);
    onInsert(next);
    // Курсор ставится после перерисовки: React вернёт значение из состояния, и позиция,
    // выставленная до неё, потерялась бы.
    const caret = from + piece.insert.length - (piece.caretBack ?? 0);
    window.setTimeout(() => {
      input.focus();
      input.setSelectionRange(caret, caret);
    }, 0);
  };

  return (
    <div className="tb-rxbar" role="toolbar" aria-label="Вставить в выражение" data-testid="answer-rules-rxbar">
      {PIECES.map((piece) => (
        <Tooltip key={piece.insert} title={piece.title} content={piece.hint} placement="top" wrap>
          <Button
            variant="secondary"
            size="xs"
            className="tb-mono"
            aria-label={piece.title}
            onClick={() => insert(piece)}
            data-testid={`answer-rules-rx-${piece.title}`}
          >
            {piece.insert}
          </Button>
        </Tooltip>
      ))}
    </div>
  );
}

export { PIECES as REGEX_PIECES };
