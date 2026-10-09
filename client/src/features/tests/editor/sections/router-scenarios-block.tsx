/**
 * @module features/tests/editor/sections/router-scenarios-block
 * @description Пункт-сценарий теста с роутером в «Составе» — согласованный эскиз
 * `docs/wireframes/sim-scenario-test-editor.html` (состояния «роутер: сценарий в составе»,
 * «роутер: добавить сценарий»).
 *
 * Пункт стоит в ОДНОМ списке с темами и нумеруется вместе с ними; его строка устроена как
 * строка темы (ручка, заголовок со сводкой, «Убрать», шеврон) и отличается пиктограммой
 * `monitor-play`. Свойства пункта: название в меню участника, тема-банк, выдача (случайный или
 * фиксированный сценарий), обязательность. Порядок и группу задаёт перетаскивание — общее с
 * темами (`composition-items`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, GripVertical, MonitorPlay, Search, Trash2 } from "lucide-react";
import { Button, IconButton, Input, ModalDialog, Stack, Switch } from "@skillum/ui-kit";
import { plural } from "@/features/questions/scenario/scenario-summary";
import { REVEAL_EVENT } from "../field-errors";
import type { ScenarioItemDraft } from "../test-editor.types";
import { ScenarioBankFields, scenarioItemFacts, type ScenarioBank } from "./scenario-bank-fields";

/** Сводка свёрнутой строки: банк и выдача, как у темы — «… · выдаётся …». */
export function scenarioSubtitle(item: ScenarioItemDraft, banks: ScenarioBank[]): string {
  const { bank, fixed, exposure } = scenarioItemFacts(item, banks);
  const name = item.topicName || bank?.topicName || "";
  if (fixed) return `Сценарий · банк «${name}» · фиксированный «${fixed.summary.title}»`;
  const size = bank ? ` из ${bank.scenarios.length}` : "";
  return `Сценарий · банк «${name}» · случайный${size}${exposure ? ` · увидят ${exposure.percent}%` : ""}`;
}

export interface ScenarioItemRowProps {
  /** Ключ пункта `scenario:<id>` — он же адрес перетаскивания. */
  itemKey: string;
  /** Место пункта в `model.scenarioItems` — адрес ошибок `scenarioItems[i]`. */
  index: number;
  /** Номер в общем списке с темами. */
  number: number;
  item: ScenarioItemDraft;
  banks: ScenarioBank[];
  isLoading: boolean;
  open: boolean;
  onToggleOpen: () => void;
  /** Новое состояние пункта; `null` — пункт убран. */
  onChange: (next: ScenarioItemDraft | null) => void;
  titleError?: string;
  /** Ошибка внутри пункта — точка в шапке видна, пока строка свёрнута. */
  hasIssue?: boolean;
  /** Техдолг №8: поля «Открывается» / «Каких пунктов» — сразу под «Обязательный». */
  unlockFields?: React.ReactNode;
  /** Хвост подзаголовка — «откроется после …»; нет правила — `null`. */
  unlockTail?: string | null;
}

/** Строка пункта-сценария в списке «Состава». */
export function ScenarioItemRow(props: ScenarioItemRowProps) {
  const { item } = props;
  const name = item.title?.trim() || item.topicName;
  const sortable = useSortable({ id: props.itemKey });
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : undefined,
  };

  // «Перейти к ошибкам» просит свёрнутую строку раскрыться — так же, как у темы.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const setRowRef = useCallback(
    (el: HTMLDivElement | null) => {
      rowRef.current = el;
      sortable.setNodeRef(el);
    },
    [sortable],
  );
  const { open, onToggleOpen } = props;
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const reveal = () => {
      if (!open) onToggleOpen();
    };
    el.addEventListener(REVEAL_EVENT, reveal);
    return () => el.removeEventListener(REVEAL_EVENT, reveal);
  }, [open, onToggleOpen]);

  return (
    <div
      ref={setRowRef}
      style={dragStyle}
      className={`ou-acc__item${open ? " is-open" : ""}`}
      data-testid={`router-scenario-${props.itemKey}`}
      data-field={`scenarioItems[${props.index}]`}
    >
      <div className="tb-acc-head">
        <span
          className="drag-handle"
          aria-label={`Переместить сценарий «${name}»`}
          data-testid={`router-scenario-grip-${props.itemKey}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical size={14} aria-hidden="true" />
        </span>
        {props.hasIssue && (
          <span className="tb-status-dot tb-status-dot--err" aria-label={`Есть ошибки: ${name}`} />
        )}
        <button
          type="button"
          className="ou-acc__trigger"
          aria-expanded={open}
          onClick={onToggleOpen}
          data-testid={`router-scenario-toggle-${props.itemKey}`}
        >
          <span className="ou-acc__trigger-text">
            <span className="ou-acc__title">
              <MonitorPlay size={16} className="tb-acc-title-ico" aria-label="Сценарий" />{`${props.number}. ${name}`}
            </span>
            <span className="ou-acc__subtitle">
              {scenarioSubtitle(item, props.banks)}
              {props.unlockTail ? ` · ${props.unlockTail}` : ""}
            </span>
          </span>
        </button>
        <span className="tb-topic-actions">
          <IconButton
            icon={<Trash2 size={14} aria-hidden="true" />}
            aria-label={`Убрать сценарий «${name}»`}
            variant="ghost"
            size="s"
            onClick={() => props.onChange(null)}
            data-testid={`router-scenario-remove-${props.itemKey}`}
          />
        </span>
        {/* Шеврон — мишень мыши, как у темы; клавиатурный путь — кнопка-триггер рядом. */}
        <span className="ou-acc__chev" aria-hidden="true" onClick={onToggleOpen}>
          <ChevronDown size={16} />
        </span>
      </div>
      <div className="ou-acc__body" role="region">
        <Stack gap={4}>
          <Input
            size="m"
            fullWidth
            required
            label="Название в меню"
            value={item.title ?? ""}
            error={props.titleError}
            onChange={(e) => props.onChange({ ...item, title: e.target.value })}
            data-field={`scenarioItems[${props.index}].title`}
            data-testid="router-scenario-title"
          />
          <ScenarioBankFields
            item={item}
            // Убрать банк у пункта роутера значит убрать сам пункт: пункт без банка ничего не
            // выдаёт, а держать пустую строку незачем.
            onChange={(next) => props.onChange(next ? { ...item, ...next } : null)}
            banks={props.banks}
            isLoading={props.isLoading}
            beforeActions={
              <>
                <Switch
                  label="Обязательный"
                  checked={item.required !== false}
                  onChange={(e) => props.onChange({ ...item, required: e.target.checked })}
                  data-testid="router-scenario-required"
                />
                {/* Одним блоком: карточка — стопка с шагом 16, а соседние `ou-formfield` добавляют
                    свои 16 сверху. Без обёртки «Каких пунктов» отстояло бы от «Открывается» на 32,
                    а не на 16, как в эскизе и в карточке темы. */}
                {props.unlockFields && <div>{props.unlockFields}</div>}
              </>
            }
          />
        </Stack>
      </div>
    </div>
  );
}

export interface ScenarioPickerModalProps {
  open: boolean;
  banks: ScenarioBank[];
  isLoading: boolean;
  onPick: (bank: ScenarioBank) => void;
  onCancel: () => void;
}

/** Окно «Добавить сценарий»: темы со сценариями, с поиском — как окно «Добавить тему». */
export function ScenarioPickerModal({ open, banks, isLoading, onPick, onCancel }: ScenarioPickerModalProps) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const filtered = banks.filter((b) => b.topicName.toLowerCase().includes(needle));
  return (
    <ModalDialog
      open={open}
      onClose={onCancel}
      size="m"
      title="Добавить сценарий"
      description="Темы, в которых есть сценарии. Выдачу — случайный или фиксированный сценарий — настроите в составе"
      footer={<Button variant="ghost" size="m" onClick={onCancel}>Отмена</Button>}
      data-testid="router-scenario-picker"
    >
      <Input
        size="m"
        fullWidth
        label="Поиск темы"
        placeholder="Название темы"
        iconRight={<Search size={16} aria-hidden="true" />}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
        className="tb-topic-picker__search"
        data-testid="router-scenario-picker-search"
      />
      <ul className="tb-topic-picker__list">
        {filtered.length === 0 && (
          <li className="tb-topic-picker__empty">
            {isLoading ? "Загрузка…" : banks.length === 0 ? "В доступных темах нет сценариев" : "Ничего не найдено"}
          </li>
        )}
        {filtered.map((bank) => (
          <li key={bank.topicId}>
            <button
              type="button"
              className="tb-topic-picker__item"
              onClick={() => onPick(bank)}
              data-testid={`router-scenario-picker-${bank.topicId}`}
            >
              <span>{bank.topicName}</span>
              <span className="tb-topic-picker__item-count">
                {plural(bank.scenarios.length, ["сценарий", "сценария", "сценариев"])}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ModalDialog>
  );
}
