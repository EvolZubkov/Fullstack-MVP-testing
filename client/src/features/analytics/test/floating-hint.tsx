/**
 * @module features/analytics/test/floating-hint
 * @description PRD-66 FR-14b, FR-30c: подсказка, которую не обрезает таблица.
 *
 * Подсказка дизайн-системы (`Tooltip`) рисует пузырь ВНУТРИ своего триггера. В таблице это
 * значит — внутри `DataGrid`, а у той рамка обрезает всё, что выходит за край (`overflow:
 * hidden` ради скруглённых углов), и прокрутка с пределом высоты. Приёмка этапа 6 вскрыла оба
 * следствия: расшифровка градаций у нижней строки обрезалась по краю таблицы, а скрытые пузыри,
 * прозрачные, но занимающие место, раздували прокрутку таблицы из двух строк до двух тысяч
 * пикселей — справа стояла полоса прокрутки, под строками зияла пустота.
 *
 * Поэтому пузырь выводится порталом поверх страницы — всплывающим окном дизайн-системы
 * (`Popover` без собственной поверхности), а оформлен как пузырь подсказки. Текст подсказки при
 * этом остаётся в разметке триггера скрытым (`ou-sr-only`): его читает экранный диктор, и
 * связь «термин — пояснение» не зависит от того, открыт ли пузырь.
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { Popover } from "@skillum/ui-kit";

/** Свойства подсказки. */
export interface FloatingHintProps {
  /** То, на что наводят: термин, число, гистограмма. */
  children: ReactNode;
  /** Текст или разметка подсказки. */
  content: ReactNode;
  /** Заголовок пузыря — строкой над текстом. */
  title?: ReactNode;
  /** Сторона открытия; у нижнего края окна пузырь сам перевернётся вверх. */
  placement?: "top" | "bottom" | "left" | "right";
  /** Класс триггера — метка для раскладки (например, заголовка колонки). */
  className?: string;
  /** Дополнительный класс пузыря — например, шире обычного под легенду (Э4а). */
  bubbleClassName?: string;
}

/**
 * Подсказка по наведению и фокусу, выведенная поверх страницы.
 *
 * @param props - триггер, текст подсказки, заголовок и сторона открытия
 * @returns триггер со скрытым для глаз текстом подсказки и пузырём в портале
 */
export function FloatingHint({ children, content, title, placement = "bottom", className, bubbleClassName }: FloatingHintProps) {
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      ref={anchor}
      className={className}
      // Подсказка открывается и с клавиатуры: термин в заголовке — не кнопка, но до пояснения
      // к нему должен дотянуться и тот, кто не пользуется мышью.
      tabIndex={0}
      aria-describedby={id}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <span id={id} className="ou-sr-only">
        {title ? <>{title}: </> : null}
        {content}
      </span>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        placement={placement}
        chrome={false}
        arrow={false}
        offset={8}
        closeOnOutside={false}
        // Для экранного диктора пояснение уже есть в триггере; второй раз его не озвучивать.
        aria-hidden="true"
        className={bubbleClassName ? `tb-float-hint ${bubbleClassName}` : "tb-float-hint"}
      >
        {title ? <span className="tb-float-hint__title">{title}</span> : null}
        {content}
      </Popover>
    </span>
  );
}
