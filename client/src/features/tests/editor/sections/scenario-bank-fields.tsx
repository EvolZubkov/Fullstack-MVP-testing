/**
 * @module features/tests/editor/sections/scenario-bank-fields
 * @description Поля пункта-сценария: тема-банк, выдача (случайный сценарий темы или
 * фиксированный), сводка банка или сценария, ожидаемая экспозиция, «Сыграть» —
 * согласованный эскиз `docs/wireframes/sim-scenario-test-editor.html`.
 *
 * Одни и те же поля стоят во вкладке «Задание» теста «Сценарий» и в карточке пункта-сценария
 * роутера: два разных набора полей для одного пункта однажды разошлись бы.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { Banner, Button, Cluster, SegmentedControl, Select, Tag } from "@skillum/ui-kit";
import { expectedExposure, type ExpectedExposure } from "@shared/draw/expected-exposure";
import type { Scenario } from "@shared/sim/contract";
import type { ScenarioSummary } from "@shared/sim/validate";
import { megabytes, plural, summaryTags } from "@/features/questions/scenario/scenario-summary";
import { ScenarioRun, requestScenarioFullscreen } from "@/features/questions/scenario/scenario-run";
import type { ScenarioItemDraft } from "../test-editor.types";

/** One scenario of a bank, as `GET /api/questions/scenario-banks` lists it. */
export interface BankScenario {
  questionId: string;
  summary: ScenarioSummary;
  mediaBytes: number;
  scenario: Scenario;
}

/** A topic that holds scenarios. */
export interface ScenarioBank {
  topicId: string;
  topicName: string;
  scenarios: BankScenario[];
}

/**
 * Темы со сценариями, видимые автору.
 *
 * Банк правят в ДРУГОЙ вкладке (раздел «Темы и вопросы»), а клиентский кэш по умолчанию вечный
 * (`staleTime: Infinity`, без перезапроса при фокусе): без перезапроса список, загруженный пустым,
 * оставался бы пустым в уже открытом ящике и после того, как сценарий добавили. Поэтому запрос
 * обновляется при каждом монтировании и при возврате на вкладку.
 */
export function useScenarioBanks() {
  const { data = [], isLoading, isError } = useQuery<ScenarioBank[]>({
    queryKey: ["/api/questions/scenario-banks"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  return { banks: data, isLoading, isError };
}

/** Что известно о выдаче пункта: его банк, фиксированный сценарий, ожидаемая экспозиция. */
export interface ScenarioItemFacts {
  bank: ScenarioBank | null;
  fixed: BankScenario | null;
  exposure: ExpectedExposure | null;
}

/** Сведения о выдаче пункта по списку банков. */
export function scenarioItemFacts(item: ScenarioItemDraft | null, banks: ScenarioBank[]): ScenarioItemFacts {
  const bank = item ? banks.find((b) => b.topicId === item.topicId) ?? null : null;
  const fixed = item?.questionId ? bank?.scenarios.find((s) => s.questionId === item.questionId) ?? null : null;
  const exposure = bank && !item?.questionId ? expectedExposure({ drawCount: 1, poolSize: bank.scenarios.length }) : null;
  return { bank, fixed, exposure };
}

/** Что пункты-сценарии теста добавят в пакет. */
export interface PackageScenarioWeight {
  /** Разных сценариев в пакете. */
  scenarios: number;
  /** Разных банков, из которых они взяты. */
  banks: number;
  /** Вес их изображений. */
  bytes: number;
}

/**
 * Техдолг №6 (план, раздел 5): сколько сценариев и какой вес изображений пункты добавят в пакет.
 *
 * Считается по ОБЪЕДИНЕНИЮ сценариев, а не суммой тегов пунктов: случайная выдача несёт весь банк
 * пункта, фиксированная — один сценарий, а сценарий, который берут два пункта, ложится в пакет один
 * раз (пакет кладёт изображения по адресу файла). Пункт, чей банк ещё не загружен или исчез, не
 * учитывается — о нём говорит его собственная карточка. Пунктов нет — `null`.
 */
export function packageScenarioWeight(items: ScenarioItemDraft[], banks: ScenarioBank[]): PackageScenarioWeight | null {
  if (items.length === 0) return null;
  const picked = new Map<string, BankScenario>();
  const usedBanks = new Set<string>();
  for (const item of items) {
    const { bank, fixed } = scenarioItemFacts(item, banks);
    if (!bank) continue;
    const pool = item.questionId ? (fixed ? [fixed] : []) : bank.scenarios;
    if (pool.length === 0) continue;
    usedBanks.add(bank.topicId);
    for (const scenario of pool) picked.set(scenario.questionId, scenario);
  }
  let bytes = 0;
  for (const scenario of picked.values()) bytes += scenario.mediaBytes;
  return { scenarios: picked.size, banks: usedBanks.size, bytes };
}

/** Строка итога под «Темы теста»: «В пакет войдут 4 сценария из 1 банка, изображения — 9,6 МБ». */
export function packageScenarioWeightText(weight: PackageScenarioWeight): string {
  // После «из» — родительный падеж: «из 1 банка», «из 21 банка», «из 2 банков».
  const bankWord = weight.banks % 10 === 1 && weight.banks % 100 !== 11 ? "банка" : "банков";
  const scenarios = plural(weight.scenarios, ["сценарий", "сценария", "сценариев"]);
  const verb = weight.scenarios % 10 === 1 && weight.scenarios % 100 !== 11 ? "войдёт" : "войдут";
  return `В пакет ${verb} ${scenarios} из ${weight.banks} ${bankWord}, изображения — ${megabytes(weight.bytes)}`;
}

/** Range of scene counts of a bank: «7–14 сцен» or «11 сцен». */
function scenesRange(scenarios: BankScenario[]): string {
  const counts = scenarios.map((s) => s.summary.scenes);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return min === max ? plural(min, ["сцена", "сцены", "сцен"]) : `${min}–${plural(max, ["сцена", "сцены", "сцен"])}`;
}

type PickMode = "random" | "fixed";

export interface ScenarioBankFieldsProps {
  item: ScenarioItemDraft | null;
  /** Новое состояние пункта; `null` — банк убран. */
  onChange: (next: ScenarioItemDraft | null) => void;
  banks: ScenarioBank[];
  isLoading: boolean;
  /** Список банков не загрузился: «нет сценариев» тут было бы неправдой. */
  loadError?: boolean;
  /** Поля пункта, стоящие перед действиями («Обязательный» у пункта роутера). */
  beforeActions?: React.ReactNode;
}

/** Поля пункта-сценария. */
export function ScenarioBankFields({ item, onChange, banks, isLoading, loadError, beforeActions }: ScenarioBankFieldsProps) {
  const [playing, setPlaying] = useState<Scenario | null>(null);
  const { bank, fixed, exposure } = scenarioItemFacts(item, banks);
  const mode: PickMode = item?.questionId ? "fixed" : "random";
  const bankOptions = useMemo(() => banks.map((b) => ({ value: b.topicId, label: b.topicName })), [banks]);

  return (
    <>
      <Select
        label="Банк сценариев"
        value={item?.topicId ?? ""}
        onChange={(topicId) => {
          const picked = banks.find((b) => b.topicId === topicId);
          onChange(picked ? { ...(item ?? {}), topicId, topicName: picked.topicName, questionId: null } : null);
        }}
        onClear={() => onChange(null)}
        clearLabel="Убрать банк"
        placeholder={
          isLoading
            ? "Загрузка…"
            : loadError
              ? "Не удалось загрузить список тем"
              : banks.length
                ? "Выберите тему со сценариями"
                : "В доступных темах нет сценариев"
        }
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
            onChange={(next) => onChange({ ...item, questionId: next === "fixed" ? bank?.scenarios[0]?.questionId ?? null : null })}
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
            onChange={(questionId) => onChange({ ...item, questionId })}
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

      {beforeActions}

      {fixed && (
        <Cluster gap={1}>
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
        </Cluster>
      )}

      {playing && (
        <ScenarioRun
          scenario={playing}
          caption="Проверка сценария · результат не сохраняется"
          onClose={() => setPlaying(null)}
          closeOnFullscreenExit
        />
      )}
    </>
  );
}
