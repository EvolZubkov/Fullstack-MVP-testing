/**
 * @module features/tests/editor/sections/scenario-task-section
 * @description Вкладка «Задание» теста «Сценарий» — согласованный эскиз
 * `docs/wireframes/sim-scenario-test-editor.html` (состояния «сценарий: задание», «выбор банка»,
 * «фиксированный»).
 *
 * Тест «Сценарий» состоит из одного пункта: темы-банка сценариев и способа выдачи. Случайная
 * выдача берёт один сценарий темы с поправкой на экспозицию (PRD-55) — и автор видит ожидаемую
 * экспозицию тем же расчётом, что у темы (`shared/draw/expected-exposure`). Фиксированная выдача
 * отдаёт выбранный сценарий всем участникам; его можно сыграть прямо отсюда.
 *
 * Ниже — страницы теста: зоны «До теста» и «После теста» того же полотна, что у обычного теста,
 * с одной строкой задания между ними.
 */
import { FormSection } from "@skillum/ui-kit";
import type { ScenarioItemDraft, TestEditorModel } from "../test-editor.types";
import type { UseContentPagesResult } from "../use-content-pages";
import { StructureSection } from "./start-pages-section";
import { ScenarioBankFields, scenarioItemFacts, useScenarioBanks } from "./scenario-bank-fields";

export interface ScenarioTaskSectionProps {
  model: TestEditorModel;
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  testId?: string;
  content?: UseContentPagesResult;
  savedFlowMode: string | null;
  designDraft?: { templateId: string; params?: Record<string, unknown> };
}

/** The «Задание» tab of a «Сценарий» test. */
export function ScenarioTaskSection({ model, updateModel, testId, content, savedFlowMode, designDraft }: ScenarioTaskSectionProps) {
  const { banks, isLoading } = useScenarioBanks();

  // Тест «Сценарий» использует первый пункт; остальные (от роутера) хранятся нетронутыми.
  const item = (model.scenarioItems ?? [])[0] ?? null;
  const { bank, fixed } = scenarioItemFacts(item, banks);

  const setItem = (next: ScenarioItemDraft | null) =>
    updateModel((m) => {
      const rest = (m.scenarioItems ?? []).slice(1);
      // Новый пункт сразу получает id: на нём держится ключ `scenario:<id>`.
      const base = m.scenarioItems?.[0] ?? { id: crypto.randomUUID() };
      return { ...m, scenarioItems: next ? [{ ...base, ...next }, ...rest] : rest };
    });

  const taskLabel = item
    ? fixed
      ? `Сценарий «${fixed.summary.title}» на весь экран`
      : `Сценарий из банка «${item.topicName || bank?.topicName || ""}» на весь экран`
    : "Банк сценариев не выбран";

  return (
    <div className="tb-settings-content" data-testid="settings-pane-scenario-task">
      <FormSection title="Задание" stacked>
        <ScenarioBankFields item={item} onChange={setItem} banks={banks} isLoading={isLoading} />
      </FormSection>

      <FormSection title="Страницы теста" stacked>
        <StructureSection
          // Тест «Сценарий» идёт одним потоком: страницы «До теста», задание, «После теста».
          model={{ ...model, flowMode: "linear_flat", sections: [] }}
          testId={testId}
          content={content}
          savedFlowMode={savedFlowMode as never}
          updateModel={updateModel}
          designDraft={designDraft}
          taskLabel={taskLabel}
        />
      </FormSection>
    </div>
  );
}
