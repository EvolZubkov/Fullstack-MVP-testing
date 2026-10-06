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
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { Banner, Button, Cluster, FormSection, SegmentedControl, Select, Tag } from "@skillum/ui-kit";
import { expectedExposure } from "@shared/draw/expected-exposure";
import type { Scenario } from "@shared/sim/contract";
import type { ScenarioSummary } from "@shared/sim/validate";
import { megabytes, plural, summaryTags } from "@/features/questions/scenario/scenario-summary";
import { ScenarioRun, requestScenarioFullscreen } from "@/features/questions/scenario/scenario-run";
import type { TestEditorModel } from "../test-editor.types";
import type { UseContentPagesResult } from "../use-content-pages";
import { StructureSection } from "./start-pages-section";

/** One scenario of a bank, as `GET /api/questions/scenario-banks` lists it. */
interface BankScenario {
  questionId: string;
  summary: ScenarioSummary;
  mediaBytes: number;
  scenario: Scenario;
}

/** A topic that holds scenarios. */
interface ScenarioBank {
  topicId: string;
  topicName: string;
  scenarios: BankScenario[];
}

type PickMode = "random" | "fixed";

export interface ScenarioTaskSectionProps {
  model: TestEditorModel;
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  testId?: string;
  content?: UseContentPagesResult;
  savedFlowMode: string | null;
  designDraft?: { templateId: string; params?: Record<string, unknown> };
}

/** Range of scene counts of a bank: «7–14 сцен» or «11 сцен». */
function scenesRange(scenarios: BankScenario[]): string {
  const counts = scenarios.map((s) => s.summary.scenes);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return min === max ? plural(min, ["сцена", "сцены", "сцен"]) : `${min}–${plural(max, ["сцена", "сцены", "сцен"])}`;
}

/** The «Задание» tab of a «Сценарий» test. */
export function ScenarioTaskSection({ model, updateModel, testId, content, savedFlowMode, designDraft }: ScenarioTaskSectionProps) {
  const { data: banks = [], isLoading } = useQuery<ScenarioBank[]>({ queryKey: ["/api/questions/scenario-banks"] });
  const [playing, setPlaying] = useState<Scenario | null>(null);

  const item = model.scenario ?? null;
  const bank = item ? banks.find((b) => b.topicId === item.topicId) ?? null : null;
  const mode: PickMode = item?.questionId ? "fixed" : "random";
  const fixed = item?.questionId ? bank?.scenarios.find((s) => s.questionId === item.questionId) ?? null : null;
  const exposure = bank ? expectedExposure({ drawCount: 1, poolSize: bank.scenarios.length }) : null;

  const setItem = (next: TestEditorModel["scenario"]) => updateModel((m) => ({ ...m, scenario: next }));

  const bankOptions = useMemo(
    () => banks.map((b) => ({ value: b.topicId, label: b.topicName })),
    [banks],
  );

  const taskLabel = item
    ? fixed
      ? `Сценарий «${fixed.summary.title}» на весь экран`
      : `Сценарий из банка «${item.topicName || bank?.topicName || ""}» на весь экран`
    : "Банк сценариев не выбран";

  return (
    <div className="tb-settings-content" data-testid="settings-pane-scenario-task">
      <FormSection title="Задание" stacked>
        <Select
          label="Банк сценариев"
          value={item?.topicId ?? ""}
          onChange={(topicId) => {
            const picked = banks.find((b) => b.topicId === topicId);
            setItem(picked ? { topicId, topicName: picked.topicName, questionId: null } : null);
          }}
          onClear={() => setItem(null)}
          clearLabel="Убрать банк"
          placeholder={isLoading ? "Загрузка…" : banks.length ? "Выберите тему со сценариями" : "В доступных темах нет сценариев"}
          fullWidth
          searchable
          searchPlaceholder="Название темы"
          emptyMessage="Нет тем со сценариями"
          options={bankOptions}
          data-testid="scenario-bank-select"
        />

        {item && (
          <div className="ou-formfield">
            <label className="ou-formfield__lbl">Выдача</label>
            <SegmentedControl<PickMode>
              size="m"
              value={mode}
              aria-label="Выдача"
              items={[
                { value: "random", label: "Случайный сценарий темы" },
                { value: "fixed", label: "Фиксированный сценарий" },
              ]}
              onChange={(next) =>
                setItem({
                  ...item,
                  questionId: next === "fixed" ? bank?.scenarios[0]?.questionId ?? null : null,
                })
              }
              data-testid="scenario-pick-mode"
            />
          </div>
        )}

        {item && bank && mode === "random" && (
          <>
            <Cluster gap={1} wrap data-testid="scenario-bank-summary">
              <Tag size="s">{plural(bank.scenarios.length, ["сценарий", "сценария", "сценариев"])}</Tag>
              <Tag size="s">{scenesRange(bank.scenarios)}</Tag>
              <Tag size="s">изображения: {megabytes(bank.scenarios.reduce((n, s) => n + s.mediaBytes, 0))}</Tag>
            </Cluster>
            {exposure && (
              <Banner
                tone={exposure.tone}
                variant="subtle"
                title={`Каждый сценарий темы увидят около ${exposure.percent}% участников`}
                description={
                  exposure.tone === "warning"
                    ? `Выдача 1 из ${bank.scenarios.length} — сценарий быстро станет известен. Добавьте сценарии в тему.`
                    : `Выдача 1 из ${bank.scenarios.length} — участник получает случайный сценарий, реже выдававшиеся выпадают чаще.`
                }
                data-testid="scenario-exposure-banner"
              />
            )}
          </>
        )}

        {item && bank && mode === "fixed" && (
          <>
            <Select
              label="Сценарий"
              value={item.questionId ?? ""}
              onChange={(questionId) => setItem({ ...item, questionId })}
              fullWidth
              options={bank.scenarios.map((s) => ({ value: s.questionId, label: s.summary.title }))}
              data-testid="scenario-fixed-select"
            />
            {fixed && (
              <Cluster gap={1} wrap data-testid="scenario-fixed-summary">
                {summaryTags(fixed.summary).map((tag) => <Tag key={tag} size="s">{tag}</Tag>)}
                <Tag size="s">изображения: {megabytes(fixed.mediaBytes)}</Tag>
              </Cluster>
            )}
          </>
        )}

        {item && !bank && !isLoading && (
          <Banner
            tone="error"
            variant="subtle"
            title="В теме больше нет сценариев"
            description="Выберите другой банк или добавьте сценарии в эту тему."
            data-testid="scenario-bank-empty"
          />
        )}

        <Cluster gap={1}>
          {fixed && (
            <Button
              variant="secondary"
              size="s"
              leadingIcon={<Play size={14} aria-hidden="true" />}
              onClick={() => {
                requestScenarioFullscreen();
                setPlaying(fixed.scenario);
              }}
              data-testid="scenario-fixed-play"
            >
              Сыграть
            </Button>
          )}
          <Button
            variant="ghost"
            size="s"
            onClick={() => window.open("/author/content?type=simulation", "_blank", "noopener")}
            data-testid="scenario-open-bank"
          >
            Открыть банк
          </Button>
        </Cluster>
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

      {playing && (
        <ScenarioRun
          scenario={playing}
          caption="Проверка сценария · результат не сохраняется"
          onClose={() => setPlaying(null)}
          closeOnFullscreenExit
        />
      )}
    </div>
  );
}
