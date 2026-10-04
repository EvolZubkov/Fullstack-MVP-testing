/**
 * @module features/analytics/test/term-hint
 * @description PRD-66 FR-14b: термин с подсказкой — заголовок колонки или подпись плитки.
 *
 * Без значка подсказка невидима: читатель не знает, что на термин можно навести. Значок обязан
 * держаться при последнем слове: жалоба владельца 2026-09-25 — в узкой колонке значок уходил на
 * отдельную строку, и заголовок читался оторванным от своей колонки.
 *
 * Значок — компонент `Info` из lucide-react (решение владельца 2026-09-28: значки только из
 * lucide-react). Прежде он был переписанной вручную маской lucide в 12 px, и при таком размере
 * черта и точка «i» пропадали — оставался пустой кружок. Держится значок при последнем слове
 * тем, что последнее слово и значок завёрнуты в один неразрывный блок
 * (`.tb-term-hint__tail`): перенос возможен только перед ним. Термин при этом остаётся одним
 * текстом — так его читает экранный диктор и находит поиск по странице.
 *
 * Где стоит термин в заголовке колонки, решает сама колонка (`align` у DataGrid): заголовок и
 * значения выровнены одинаково (правило владельца 2026-10-03). Своего выравнивания у термина нет.
 *
 * Пузырь выводится поверх страницы (`FloatingHint`): внутри таблицы его обрезала рамка, а у
 * последних колонок скрытый пузырь включал горизонтальную прокрутку.
 *
 * Э4а: текст подсказки берётся из словаря аналитики (`glossary.ts`) по ключу `entry`; подпись
 * можно заменить (`term`), пояснение — нет: одно слово объясняется везде одинаково.
 */
import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { FloatingHint } from "./floating-hint";
import { GLOSSARY, type GlossaryKey } from "../glossary";

/** Значок подсказки: lucide `Info` в 14 px — в 12 px его черта и точка не читаются. */
const HINT_ICON = <Info size={14} aria-hidden="true" className="tb-term-hint__icon" />;

/**
 * Термин со значком, который не отрывается от последнего слова.
 *
 * Строка делится на всё до последнего слова и последнее слово — оно уходит в неразрывный блок
 * вместе со значком. Термин-разметка (не строка) целиком становится таким блоком: делить её по
 * словам нечем, а короткие составные подписи в продукте и так не переносятся.
 */
function withIcon(term: ReactNode): ReactNode {
  if (typeof term !== "string") {
    return <span className="tb-term-hint__tail">{term}{HINT_ICON}</span>;
  }
  const at = term.trimEnd().lastIndexOf(" ");
  const head = at === -1 ? "" : term.slice(0, at + 1);
  const last = at === -1 ? term.trimEnd() : term.slice(at + 1).trimEnd();
  return (
    <>
      {head}
      <span className="tb-term-hint__tail">{last}{HINT_ICON}</span>
    </>
  );
}

/** Свойства термина с подсказкой. */
export interface TermHintProps {
  /** Запись словаря аналитики: из неё берутся пояснение и, если `term` не задан, подпись. */
  entry: GlossaryKey;
  /** Подпись вместо словарной — «Дискриминативность (r)» у плитки, «Слабые 27 %» у колонки. */
  term?: ReactNode;
}

/**
 * Термин с подсказкой (FR-14b).
 *
 * @param props - запись словаря и, при необходимости, своя подпись
 * @returns триггер подсказки; значок рисует стиль термина и держится при последнем слове
 */
export function TermHint({ entry, term }: TermHintProps) {
  const record = GLOSSARY[entry];
  return (
    // `tb-term-hint` — метка для раскладки заголовка в `tb-components.css`.
    <FloatingHint content={record.hint} className="tb-term-hint">
      <span className="tb-term-hint__term">{withIcon(term ?? record.term)}</span>
    </FloatingHint>
  );
}
