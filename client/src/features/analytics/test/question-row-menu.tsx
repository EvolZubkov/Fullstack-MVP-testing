/**
 * @module features/analytics/test/question-row-menu
 * @description PRD-56 FR-17, FR-17a, PRD-66 FR-03: меню «⋯» строки вопроса — одно на таблицы
 * «Вопросы» и «Качество вопросов».
 *
 * Действия строки живут ПОД ТРОЕТОЧИЕМ, а не щелчком по строке: щелчок по строке обещает один
 * переход, а действий у вопроса несколько — разбор, переход в тему, прохождения с ошибкой,
 * выдача. Порядок пунктов — как в эскизах prd66-item-quality и prd56-test-analytics: сначала
 * куда перейти, потом что сделать с выдачей.
 *
 * Название вопроса стоит в доступном имени каждого пункта: в длинном списке «Вернуть в выдачу»
 * неотличим от соседних на слух.
 */
import { MoreHorizontal } from "lucide-react";

import { IconButton, MenuItem, MenuTrigger } from "@skillum/ui-kit";

export interface QuestionRowMenuProps {
  /** Текст вопроса — для доступных имён кнопки и пунктов. */
  prompt: string;
  /** Открыть разбор вопроса (PRD-66 FR-24). Без обработчика пункта нет. */
  onOpenQuality?: () => void;
  /** Открыть вопрос в его теме — там, где его чинят. */
  onOpenInTopic: () => void;
  /** Уйти в реестр к прохождениям с ошибкой в этом вопросе (PRD-56 FR-17). */
  onOpenRegistry?: () => void;
  /** Вопрос исключён из выдачи этого теста (FR-17a). */
  excluded?: boolean;
  /** Попросить подтверждение исключения. Без обработчика пункта нет. */
  onExclude?: () => void;
  /** Вернуть вопрос в выдачу — без подтверждения: возврат ничего не отнимает (FR-17b). */
  onRestore?: () => void;
}

/**
 * Меню действий строки вопроса.
 *
 * @param props вопрос и доступные действия
 * @returns кнопка «⋯» с меню дизайн-системы
 */
export function QuestionRowMenu({
  prompt, onOpenQuality, onOpenInTopic, onOpenRegistry, excluded, onExclude, onRestore,
}: QuestionRowMenuProps) {
  return (
    // `tb-rowmenu` — метка ячейки меню для раскладки узкой колонки (`tb-components.css`).
    <span className="tb-rowmenu">
      <MenuTrigger
        size="sm"
        placement="bottom-end"
        trigger={
          <IconButton
            variant="ghost"
            size="s"
            aria-label={`Действия с вопросом: ${prompt}`}
            icon={<MoreHorizontal size={16} aria-hidden="true" />}
          />
        }
      >
        {onOpenQuality && (
          <MenuItem aria-label={`Разбор вопроса: ${prompt}`} onClick={onOpenQuality}>
            Разбор вопроса
          </MenuItem>
        )}
        <MenuItem aria-label={`Открыть вопрос в теме: ${prompt}`} onClick={onOpenInTopic}>
          Открыть вопрос в теме
        </MenuItem>
        {onOpenRegistry && (
          <MenuItem aria-label={`Прохождения с ошибкой: ${prompt}`} onClick={onOpenRegistry}>
            Прохождения с ошибкой
          </MenuItem>
        )}
        {excluded
          ? onRestore && (
            <MenuItem aria-label={`Вернуть в выдачу: ${prompt}`} onClick={onRestore}>
              Вернуть в выдачу
            </MenuItem>
          )
          : onExclude && (
            <MenuItem aria-label={`Исключить из выдачи: ${prompt}`} onClick={onExclude}>
              Исключить из выдачи…
            </MenuItem>
          )}
      </MenuTrigger>
    </span>
  );
}
