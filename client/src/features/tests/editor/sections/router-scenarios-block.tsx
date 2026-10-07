/**
 * @module features/tests/editor/sections/router-scenarios-block
 * @description Пункты-сценарии теста с роутером в «Составе» — согласованный эскиз
 * `docs/wireframes/sim-scenario-test-editor.html` (состояния «роутер: сценарий в составе»,
 * «роутер: добавить сценарий»).
 *
 * Пункт стоит в одном списке с темами и нумеруется вместе с ними; его карточка устроена как
 * карточка темы. Свойства пункта: название в меню участника, тема-банк, выдача (случайный или
 * фиксированный сценарий), обязательность. Правила разблокировки пунктов задаются так же, как у
 * тем — в настройках маршрутизатора.
 *
 * Порядок: пункты идут после тем. Выдача уже понимает общий порядок `router.itemOrder`
 * (`shared/test-items`); перетаскивание сценария между темами в редакторе — следующий шаг.
 */
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { IconButton, Input, ModalDialog, Button, Switch, Stack } from "@skillum/ui-kit";
import { plural } from "@/features/questions/scenario/scenario-summary";
import type { ScenarioItemDraft, TestEditorModel } from "../test-editor.types";
import { ScenarioBankFields, scenarioItemFacts, useScenarioBanks, type ScenarioBank } from "./scenario-bank-fields";

export interface RouterScenariosBlockProps {
  model: TestEditorModel;
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  /** Номер первого пункта-сценария: после тем. */
  startNumber: number;
  /** Открыто ли окно «Добавить сценарий» (кнопка стоит в панели состава). */
  pickerOpen: boolean;
  onPickerClose: () => void;
}

/** Сводка свёрнутой карточки: банк и выдача, как у темы — «N в банке · выдаётся …». */
function subtitleOf(item: ScenarioItemDraft, banks: ScenarioBank[]): string {
  const { bank, fixed, exposure } = scenarioItemFacts(item, banks);
  const name = item.topicName || bank?.topicName || "";
  if (fixed) return `Сценарий · банк «${name}» · фиксированный «${fixed.summary.title}»`;
  const size = bank ? ` из ${bank.scenarios.length}` : "";
  return `Сценарий · банк «${name}» · случайный${size}${exposure ? ` · увидят ${exposure.percent}%` : ""}`;
}

/** Пункты-сценарии роутера и окно их добавления. */
export function RouterScenariosBlock({ model, updateModel, startNumber, pickerOpen, onPickerClose }: RouterScenariosBlockProps) {
  const { banks, isLoading } = useScenarioBanks();
  const items = model.scenarioItems ?? [];
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const updateItem = (index: number, next: ScenarioItemDraft | null) =>
    updateModel((m) => {
      const list = [...(m.scenarioItems ?? [])];
      if (next) list[index] = { ...list[index], ...next };
      else list.splice(index, 1);
      return { ...m, scenarioItems: list };
    });

  const addItem = (bank: ScenarioBank) => {
    const id = crypto.randomUUID();
    updateModel((m) => ({
      ...m,
      scenarioItems: [...(m.scenarioItems ?? []), { id, topicId: bank.topicId, topicName: bank.topicName, questionId: null, title: null, required: true }],
    }));
    setOpen((prev) => ({ ...prev, [id]: true }));
    onPickerClose();
  };

  return (
    <>
      {items.length > 0 && (
        <div className="ou-acc" data-testid="router-scenarios">
          {items.map((item, index) => {
            const key = item.id ?? `new-${index}`;
            const isOpen = open[key] === true;
            const name = item.title?.trim() || item.topicName;
            return (
              <div key={key} className={`ou-acc__item${isOpen ? " is-open" : ""}`} data-testid={`router-scenario-${key}`}>
                <div className="tb-acc-head">
                  <button
                    type="button"
                    className="ou-acc__trigger"
                    aria-expanded={isOpen}
                    onClick={() => setOpen((prev) => ({ ...prev, [key]: !isOpen }))}
                  >
                    <span className="ou-acc__trigger-text">
                      <span className="ou-acc__title">{`${startNumber + index}. ${name}`}</span>
                      <span className="ou-acc__subtitle">{subtitleOf(item, banks)}</span>
                    </span>
                  </button>
                  <span className="tb-topic-actions">
                    <IconButton
                      icon={<Trash2 size={14} aria-hidden="true" />}
                      aria-label={`Убрать сценарий «${name}»`}
                      variant="ghost"
                      size="s"
                      onClick={() => updateItem(index, null)}
                      data-testid={`router-scenario-remove-${key}`}
                    />
                  </span>
                </div>
                {isOpen && (
                  <div className="ou-acc__body" role="region">
                    <Stack gap={4}>
                      <Input
                        size="m"
                        fullWidth
                        label="Название в меню"
                        placeholder={item.topicName}
                        hint="Так пункт называется в меню участника. Пусто — название темы."
                        value={item.title ?? ""}
                        onChange={(e) => updateItem(index, { ...item, title: e.target.value })}
                        data-testid="router-scenario-title"
                      />
                      <ScenarioBankFields
                        item={item}
                        // Убрать банк у пункта роутера значит убрать сам пункт: пункт без банка
                        // ничего не выдаёт, а держать пустую карточку незачем.
                        onChange={(next) => updateItem(index, next ? { ...item, ...next } : null)}
                        banks={banks}
                        isLoading={isLoading}
                      />
                      <Switch
                        label="Обязательный"
                        checked={item.required !== false}
                        onChange={(e) => updateItem(index, { ...item, required: e.target.checked })}
                        data-testid="router-scenario-required"
                      />
                    </Stack>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ModalDialog
        open={pickerOpen}
        onClose={onPickerClose}
        size="m"
        title="Добавить сценарий"
        description="Темы, в которых есть сценарии. Выдачу — случайный или фиксированный сценарий — настроите в составе"
        footer={<Button variant="ghost" size="m" onClick={onPickerClose}>Отмена</Button>}
        data-testid="router-scenario-picker"
      >
        <ul className="tb-topic-picker__list">
          {banks.length === 0 && (
            <li className="tb-topic-picker__empty">{isLoading ? "Загрузка…" : "В доступных темах нет сценариев"}</li>
          )}
          {banks.map((bank) => (
            <li key={bank.topicId}>
              <button
                type="button"
                className="tb-topic-picker__item"
                onClick={() => addItem(bank)}
                data-testid={`router-scenario-picker-${bank.topicId}`}
              >
                <span>{bank.topicName}</span>
                <span className="tb-topic-picker__item-count">{plural(bank.scenarios.length, ["сценарий", "сценария", "сценариев"])}</span>
              </button>
            </li>
          ))}
        </ul>
      </ModalDialog>
    </>
  );
}
