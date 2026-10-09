/**
 * @module features/tests/editor/sections/report-document-list
 * @description СПИСОК БЛОКОВ ДОКУМЕНТА ОТЧЁТА (PRD-51 §7.2, FR-15/FR-09/FR-16).
 *
 * Эскиз: `docs/wireframes/prd51-report-document.html`, состояния `s-default` и
 * `s-readonly`. Разметка взята оттуда узел за узлом, а сам эскиз собран из утверждённого
 * эскиза структуры теста: те же `page-row`, `drag-handle`, `page-variant-badge`,
 * `page-actions`, `insert-row`, то же меню строки. Своих классов здесь не заводится
 * намеренно — автор собирает документ тем же способом, что структуру теста, и разойтись в
 * облике эти два списка не вправе.
 *
 * Отличие от списка страниц одно и оно смысловое: СИСТЕМНЫЙ блок гасится тумблером, а не
 * удаляется (FR-09). Он остаётся на своём месте и читается приглушённым: выключенный
 * раздел, исчезнувший из списка, автор искал бы в палитре, не понимая, куда он делся.
 *
 * Порядок меняется перетаскиванием ЛЮБОЙ строки, включая системные: порядок документа
 * принадлежит автору. Клавиатурная альтернатива — сенсор `KeyboardSensor` с
 * `sortableKeyboardCoordinates`, как в «Структуре».
 */
import { useState } from "react";
import {
  ChevronRight,
  Eye,
  FileText,
  GripVertical,
  Info,
  LayoutTemplate,
  MoreVertical,
  Plus,
  Scissors,
  Trash2,
} from "lucide-react";
import { Button, MenuItem, MenuTrigger, Switch, Tag } from "@skillum/ui-kit";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { reportBlockLabel, reportBlockNature } from "@shared/report/report-blocks";
import type { ContentTemplatePlaceholder } from "../use-content-pages";
import { moveBlock, removeBlock, toggleBlock, type DraftBlock } from "../use-report-document";

/** Вариант блока активного шаблона в том виде, в каком его читает список. */
export interface ReportBlockVariantOption {
  key: string;
  block: string;
  label?: string;
  /** Чем вариант отличается от соседнего; объявляет шаблон. */
  description?: string;
  isDefault?: boolean;
  /** Поля содержимого варианта: их показывает раскрытая строка авторской страницы. */
  placeholders?: ContentTemplatePlaceholder[];
}

export interface ReportDocumentListProps {
  blocks: DraftBlock[];
  /** Варианты блоков активного шаблона: подпись бейджа и доступность «Сменить вариант». */
  variants: ReportBlockVariantOption[];
  onChange: (next: DraftBlock[]) => void;
  /** Открыть палитру. Аргумент — позиция, НА которую встанет новый блок. */
  onAdd: (at: number) => void;
  /** Позиция раскрытой строки авторской страницы; `null` — все свёрнуты. */
  expandedIndex?: number | null;
  onToggleExpand?: (index: number) => void;
  /** Поля раскрытой строки. Рисует вызывающий: список полей не знает. */
  renderExpanded?: (index: number) => React.ReactNode;
  onPreview?: (index: number) => void;
  onReplaceVariant?: (index: number) => void;
  /** Опубликованный тест: строки читаются, но не правятся. */
  readOnly?: boolean;
}

/** Подпись строки: у системного блока — из реестра продукта, у страницы — своя. */
function titleOf(block: DraftBlock): string {
  const nature = reportBlockNature(block.block);
  if (nature === "page-break") return "Разрыв листа";
  if (nature === "page") return String(block.values.title || "Страница без заголовка");
  return reportBlockLabel(block.block) || block.block;
}

/** Тег природы: он объясняет, почему у строки разный набор действий. */
const NATURE_TAG: Record<string, string> = { system: "системный", page: "страница" };

export function ReportDocumentList(props: ReportDocumentListProps) {
  const { blocks, variants, onChange, onAdd, readOnly = false } = props;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Идентификатор строки — её позиция. Своего ключа у блока нет и заводить его незачем:
  // список перестраивается только по завершении перетаскивания, а до тех пор позиции
  // неподвижны.
  const ids = blocks.map((_, i) => `report-block-${i}`);

  const onDragEnd = (event: DragEndEvent) => {
    const from = ids.indexOf(String(event.active.id));
    const to = event.over ? ids.indexOf(String(event.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    onChange(moveBlock(blocks, from, to - from));
  };

  /** Кнопка-вставка между строками; в режиме чтения не рисуется вовсе. */
  const insert = (at: number) =>
    readOnly ? null : (
      <div className="insert-row" key={`insert-${at}`}>
        <div className="insert-row-line" aria-hidden="true" />
        <button
          type="button"
          className="insert-btn"
          onClick={() => onAdd(at)}
          data-testid={`report-document-insert-${at}`}
        >
          <Plus size={12} aria-hidden="true" /> Добавить блок
        </button>
        <div className="insert-row-line" aria-hidden="true" />
      </div>
    );

  const body = (
    <div className="topic-body">
      {insert(0)}
      {blocks.map((block, index) => (
        <div key={ids[index]}>
          <ReportBlockRow
            id={ids[index]}
            index={index}
            block={block}
            variants={variants}
            onChange={onChange}
            blocks={blocks}
            expanded={props.expandedIndex === index}
            onToggleExpand={props.onToggleExpand}
            onPreview={props.onPreview}
            onReplaceVariant={props.onReplaceVariant}
            readOnly={readOnly}
          />
          {props.expandedIndex === index && props.renderExpanded?.(index)}
          {insert(index + 1)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="zone-block" data-testid="report-document">
      <div className="zone-header">
        <FileText size={14} aria-hidden="true" /> Документ
      </div>
      {readOnly ? (
        body
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {body}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

/** Одна строка документа. */
function ReportBlockRow(props: {
  id: string;
  index: number;
  block: DraftBlock;
  blocks: DraftBlock[];
  variants: ReportBlockVariantOption[];
  onChange: (next: DraftBlock[]) => void;
  expanded: boolean;
  onToggleExpand?: (index: number) => void;
  onPreview?: (index: number) => void;
  onReplaceVariant?: (index: number) => void;
  readOnly: boolean;
}) {
  const { block, index, blocks, variants, onChange, readOnly } = props;
  const nature = reportBlockNature(block.block);
  const title = titleOf(block);

  const sortable = useSortable({ id: props.id, disabled: readOnly });
  const [confirming, setConfirming] = useState(false);

  const forBlock = variants.filter((v) => v.block === block.block);
  const variant = variants.find((v) => v.key === block.templateKey) ?? forBlock.find((v) => v.isDefault);
  const canSwitch = !readOnly && forBlock.length > 1 && !!props.onReplaceVariant;

  const remove = () => onChange(removeBlock(blocks, index));

  return (
    <div
      ref={sortable.setNodeRef}
      className={
        "page-row" +
        (nature === "system" ? " page-row--system" : "") +
        (nature === "page-break" ? " page-row--break" : "") +
        (block.enabled ? "" : " is-off") +
        (props.expanded ? " is-expanded" : "") +
        (sortable.isDragging ? " dragging" : "")
      }
      data-testid={`report-document-row-${index}`}
      data-block={block.block}
    >
      {/* В опубликованном тесте ручки нет: порядок не меняется. На её месте — иконка
          природы блока, чтобы строка не выглядела обрубленной. */}
      {readOnly ? (
        nature !== "page-break" && (
          <span className="page-icon">
            {nature === "page" ? (
              <FileText size={14} aria-hidden="true" />
            ) : (
              <LayoutTemplate size={14} aria-hidden="true" />
            )}
          </span>
        )
      ) : (
        <span
          className="drag-handle"
          aria-label={`Переместить блок «${title}»`}
          data-testid={`report-document-grip-${index}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical size={14} aria-hidden="true" />
        </span>
      )}

      {nature === "page" && !readOnly && props.onToggleExpand && (
        <button
          type="button"
          className="page-expand-toggle"
          aria-expanded={props.expanded}
          aria-label={props.expanded ? "Свернуть" : "Развернуть"}
          onClick={() => props.onToggleExpand?.(index)}
          data-testid={`report-document-expand-${index}`}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      )}

      {nature !== "page-break" && variant && (
        <span className="page-variant-badge">{variant.label ?? variant.key}</span>
      )}

      <span className="page-title">
        {nature === "page-break" && <Scissors size={12} aria-hidden="true" />}
        {title}
      </span>

      {nature !== "page-break" && (
        <Tag tone="neutral" size="s">
          {NATURE_TAG[nature]}
        </Tag>
      )}

      <div className="page-actions">
        {/* Системный блок гаснет, а не исчезает: строка остаётся на месте. */}
        {nature === "system" && !readOnly && (
          <Switch
            size="s"
            checked={block.enabled}
            aria-label={`Показывать блок «${title}»`}
            onChange={() => onChange(toggleBlock(blocks, index))}
            data-testid={`report-document-toggle-${index}`}
          />
        )}

        {/* Предпросмотр остаётся и в опубликованном тесте: смотреть можно всегда. */}
        {nature === "page" && props.onPreview && (
          <button
            type="button"
            className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
            aria-label={`Предпросмотр блока «${title}»`}
            onClick={() => props.onPreview?.(index)}
            data-testid={`report-document-preview-${index}`}
          >
            <Eye size={13} aria-hidden="true" />
          </button>
        )}

        {/* У разрыва листа меню не из чего собрать: ни варианта, ни полей у него нет —
            остаётся одно действие, и прятать его за «…» значило бы удлинить путь к
            единственной кнопке строки. */}
        {nature === "page-break" && !readOnly && (
          <button
            type="button"
            className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
            aria-label="Удалить разрыв листа"
            onClick={remove}
            data-testid={`report-document-delete-${index}`}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        )}

        {nature !== "page-break" &&
          !readOnly &&
          (confirming ? (
            <>
              <span className="page-row__delete-confirm-label">Удалить?</span>
              <Button
                variant="secondary"
                size="s"
                onClick={() => setConfirming(false)}
                data-testid={`report-document-delete-cancel-${index}`}
              >
                Отмена
              </Button>
              <Button
                variant="destructive"
                size="s"
                onClick={remove}
                data-testid={`report-document-delete-confirm-${index}`}
              >
                Удалить
              </Button>
            </>
          ) : (
            <MenuTrigger
              size="sm"
              placement="bottom-end"
              trigger={
                <button
                  type="button"
                  className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
                  aria-label={`Действия для блока «${title}»`}
                  data-testid={`report-document-actions-${index}`}
                >
                  <MoreVertical size={13} aria-hidden="true" />
                </button>
              }
            >
              <MenuItem
                disabled={!canSwitch}
                onClick={canSwitch ? () => props.onReplaceVariant?.(index) : undefined}
                data-testid={`report-document-replace-${index}`}
              >
                Сменить вариант
              </MenuItem>
              {/* Системный блок удалению не подлежит: его выключают тумблером, а
                  удалённым он вернулся бы при следующем разрешении документа. */}
              {nature === "page" && (
                <MenuItem
                  danger
                  onClick={() => setConfirming(true)}
                  data-testid={`report-document-delete-${index}`}
                >
                  Удалить
                </MenuItem>
              )}
            </MenuTrigger>
          ))}
      </div>

      {nature !== "page-break" && (forBlock.length > 1 || block.block === "intro" || block.appended) && (
        <div className="page-row__meta">
          {/* Блок, добавленный шаблоном уже после сборки документа, приходит выключенным
              и в конце списка. Без этой метки он читался бы как забытый автором. */}
          {block.appended && (
            <Tag tone="warning" size="s" data-testid={`report-document-appended-${index}`}>
              <Info size={12} aria-hidden="true" />
              Добавлен шаблоном — включите, если нужен в документе
            </Tag>
          )}
          {block.block === "intro" && (
            <Tag tone="info" size="s" data-testid={`report-document-intro-hint-${index}`}>
              <Info size={12} aria-hidden="true" />
              Текст задаётся в подразделе «Обратная связь», карточка «Вводный текст»
            </Tag>
          )}
          {forBlock.length > 1 && (
            <Tag tone="info" size="s" data-testid={`report-document-variant-hint-${index}`}>
              <Info size={12} aria-hidden="true" />
              Доступно вариантов: {forBlock.length}
            </Tag>
          )}
        </div>
      )}
    </div>
  );
}
