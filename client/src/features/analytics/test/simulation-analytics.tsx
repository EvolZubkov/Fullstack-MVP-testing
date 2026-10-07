/**
 * @module features/analytics/test/simulation-analytics
 * @description «Сценарий в ИС», этап Э5б: аналитика вопроса-сценария на странице вопроса —
 * согласованный эскиз `docs/wireframes/sim-scenario-analytics.html` (состояние sim-question).
 *
 * Шесть плиток, затем «Исходы», «По сценам», «Типичные ошибки» и «Карта промахов». Данные считает
 * сервер (`GET .../questions/:id/simulation`, `server/services/analytics/simulation-stats.ts`) по
 * тем же условиям страницы, что и ответы задания. Сцены, ошибки и карта — только по прогонам с
 * протоколом: у прогонов из выгрузки LMS его нет, и подпись блока называет, сколько их.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Card, CardBody, CardHeader, DataGrid, Grid, PageNav, Stack, Tag, Text,
} from "@skillum/ui-kit";

import { LoadingState } from "@/components/loading-state";
import { pluralize } from "@/lib/i18n";

import { percentOfShare } from "../format";
import { Tile } from "./item-breakdown";
import { Labelled, Scale } from "./question-distribution";
import { COEFFICIENT_MIN, num } from "./psychometrics-format";
import { TermHint } from "./term-hint";

type Outcome = "success" | "partial" | "fail" | "exited" | "timeout";

/** Ответ `GET .../questions/:questionId/simulation`. */
export interface SimulationStatsView {
  runs: number;
  withProtocol: number;
  outcomes: Array<{ outcome: Outcome; label: string; runs: number }>;
  meanShare: number | null;
  duration: { medianMs: number; q1Ms: number; q3Ms: number; measured: number } | null;
  limitSeconds: number | null;
  misses: { perRun: number; median: number; topScene: string | null };
  hints: { runs: number; topScene: string | null };
  scenes: Array<{
    id: string;
    title: string;
    onPath: boolean;
    reached: number;
    medianMs: number | null;
    missesPerRun: number | null;
    hintShare: number | null;
    flag: { kind: "bottleneck" | "abandon" | "hints" | "detour"; note?: string } | null;
  }>;
  errors: Array<{ kind: "trap" | "wrong" | "blocked" | "detour"; text: string; where: string; runs: number }>;
  missMap: Array<{
    sceneId: string;
    /** Сцена и открытые в момент промаха слои. */
    stateKey: string;
    title: string;
    /** Чем состояние отличается от входа в сцену; `null` — вид при входе. */
    stateLabel: string | null;
    stage: { w: number; h: number };
    layers: Array<{ file: string; x: number; y: number; w: number; h: number }>;
    points: Array<[number, number]>;
    runs: number;
  }>;
  missRuns: number;
}

/** Цвет исхода — тот же, что в полосе таблицы вопросов. */
const OUTCOME_COLOR: Record<Outcome, string> = {
  success: "var(--ou-success-default)",
  partial: "var(--ou-warning-default)",
  fail: "var(--ou-error-default)",
  exited: "var(--ou-cat-digital)",
  timeout: "var(--ou-cat-bti)",
};

const KIND: Record<SimulationStatsView["errors"][number]["kind"], { label: string; tone: "error" | "warning" | "neutral" }> = {
  trap: { label: "Ловушка", tone: "error" },
  wrong: { label: "Неверное значение", tone: "warning" },
  blocked: { label: "Недоступное действие", tone: "warning" },
  detour: { label: "Шаг в сторону", tone: "neutral" },
};

const FLAG: Record<NonNullable<SimulationStatsView["scenes"][number]["flag"]>["kind"], { label: string; tone: "warning" | "neutral" }> = {
  bottleneck: { label: "Узкое место", tone: "warning" },
  abandon: { label: "Бросают", tone: "warning" },
  hints: { label: "Частая подсказка", tone: "warning" },
  detour: { label: "Шаг в сторону", tone: "neutral" },
};

/** Длительность «2:41». */
function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function runsWord(n: number): string {
  return `${n} ${pluralize(n, "прогон", "прогона", "прогонов")}`;
}

/** Свойства панели. */
export interface SimulationAnalyticsProps {
  testId: string;
  questionId: string;
  /** Условия страницы — те же, что у ответов задания. */
  search: string;
  /** Дискриминативность из разбора вопроса и число наблюдений под ней. */
  itemRest: number | null;
  observations: number;
}

/**
 * Аналитика вопроса-сценария.
 *
 * @param props - тест, вопрос, условия страницы и коэффициент разбора
 * @returns плитки и четыре карточки эскиза
 */
export function SimulationAnalytics({ testId, questionId, search, itemRest, observations }: SimulationAnalyticsProps) {
  const url = `/api/analytics/tests/${testId}/questions/${questionId}/simulation${search}`;
  const { data, isLoading } = useQuery<SimulationStatsView>({ queryKey: [url] });
  const [stateKey, setStateKey] = useState<string | null>(null);
  // Открыта сцена, выбранная в рейле; до выбора — та, где промахов больше всего.
  const map = useMemo(() => {
    if (!data) return null;
    const chosen = data.missMap.find(s => s.stateKey === stateKey);
    if (chosen) return chosen;
    return [...data.missMap].sort((a, b) => b.points.length - a.points.length)[0] ?? null;
  }, [data, stateKey]);

  if (isLoading || !data) return <LoadingState message="Считаем прогоны..." />;

  const count = (o: Outcome) => data.outcomes.find(x => x.outcome === o)?.runs ?? 0;
  const share = (n: number) => (data.runs > 0 ? n / data.runs : 0);
  const fewForCoefficients = observations < COEFFICIENT_MIN;
  const noProtocol = data.withProtocol === 0;
  const protocolNote = data.withProtocol === data.runs
    ? runsWord(data.runs)
    : `протокол есть у ${data.withProtocol} ${pluralize(data.withProtocol, "прогона", "прогонов", "прогонов")} из ${data.runs}: у загруженных из выгрузки LMS его нет`;
  const totalMisses = data.missMap.reduce((sum, s) => sum + s.points.length, 0);
  const missRuns = data.missRuns;

  return (
    <Stack gap={4}>
      <Grid cols={3} gap={1}>
        <Tile
          entry="simGoal"
          value={percentOfShare(share(count("success") + count("partial")))}
          caption={`полностью ${percentOfShare(share(count("success")))}, частично ${percentOfShare(share(count("partial")))}`}
        />
        {data.meanShare === null
          ? <Tile entry="simShare" value="нет данных" empty caption="баллов у прогонов нет" />
          : <Tile entry="simShare" value={num(data.meanShare)} caption="по штрафам этого теста" />}
        {itemRest === null || fewForCoefficients
          ? <Tile entry="simItemRest" value="мало данных" empty caption={`нужно ${COEFFICIENT_MIN} наблюдений · собрано ${observations}`} />
          : <Tile entry="simItemRest" value={num(itemRest)} caption="корреляция вопрос-остаток · хорошо от 0,30" />}
        {data.duration === null
          ? <Tile entry="simDuration" value="нет данных" empty caption="длительность не измерялась" />
          : (
            <Tile
              entry="simDuration"
              value={clock(data.duration.medianMs)}
              caption={`половина прогонов ${clock(data.duration.q1Ms)} — ${clock(data.duration.q3Ms)}${data.limitSeconds ? ` · лимит ${clock(data.limitSeconds * 1000)}` : ""}`}
            />
          )}
        <Tile
          entry="simMisses"
          value={num(data.misses.perRun, 1)}
          caption={`медиана ${num(data.misses.median, 0)}${data.misses.topScene ? ` · больше всего в «${data.misses.topScene}»` : ""}`}
        />
        <Tile
          entry="simHints"
          value={percentOfShare(share(data.hints.runs))}
          caption={data.hints.topScene ? `чаще всего в «${data.hints.topScene}»` : "подсказок не было"}
        />
      </Grid>

      <Card variant="outlined">
        <CardHeader title="Исходы" subtitle={`Чем закончились прогоны · ${runsWord(data.runs)}`} />
        <CardBody>
          <DataGrid
            className="tb-psy-grid"
            columns={[
              { key: "label", width: "40%", frozen: true, header: "Исход", render: (row: typeof data.outcomes[number]) => <Labelled label={row.label} color={OUTCOME_COLOR[row.outcome]} /> },
              { key: "runs", width: "15%", align: "center" as const, header: "Прогонов", render: (row: typeof data.outcomes[number]) => <Text variant="body-s">{row.runs}</Text> },
              { key: "share", width: "45%", align: "center" as const, header: "Доля", render: (row: typeof data.outcomes[number]) => <Scale share={share(row.runs)} color={OUTCOME_COLOR[row.outcome]} /> },
            ]}
            rows={data.outcomes}
            rowKey={row => row.outcome}
          />
        </CardBody>
      </Card>

      <Card variant="outlined">
        <CardHeader title="По сценам" subtitle={`В порядке основного пути · ${protocolNote}`} />
        <CardBody>
          {noProtocol ? (
            <Text variant="body-s" tone="muted">Протоколов нет: прогоны загружены из выгрузки LMS.</Text>
          ) : (
            <DataGrid
              className="tb-psy-grid"
              columns={[
                { key: "title", width: "26%", frozen: true, header: "Сцена", render: (row: typeof data.scenes[number]) => <Labelled label={row.title} sub={row.onPath ? undefined : "вне основного пути"} /> },
                { key: "reached", width: "20%", align: "center" as const, header: <TermHint entry="simReach" />, render: (row: typeof data.scenes[number]) => <Scale share={row.reached / data.withProtocol} /> },
                { key: "time", width: "13%", align: "center" as const, header: <TermHint entry="simSceneTime" />, render: (row: typeof data.scenes[number]) => <Text variant="body-s" tone={row.medianMs === null ? "muted" : undefined}>{row.medianMs === null ? "—" : clock(row.medianMs)}</Text> },
                { key: "misses", width: "13%", align: "center" as const, header: <TermHint entry="simSceneMisses" />, render: (row: typeof data.scenes[number]) => <Text variant="body-s" tone={row.missesPerRun === null ? "muted" : undefined}>{row.missesPerRun === null ? "—" : num(row.missesPerRun, 1)}</Text> },
                { key: "hint", width: "11%", align: "center" as const, header: <TermHint entry="simSceneHint" />, render: (row: typeof data.scenes[number]) => <Text variant="body-s" tone={row.hintShare === null ? "muted" : undefined}>{row.hintShare === null ? "—" : percentOfShare(row.hintShare)}</Text> },
                {
                  key: "flag", width: "17%", align: "center" as const, header: "Что не так",
                  render: (row: typeof data.scenes[number]) => (row.flag ? (
                    <Stack gap={1} align="center">
                      <Tag tone={FLAG[row.flag.kind].tone} size="s">{FLAG[row.flag.kind].label}</Tag>
                      {row.flag.note ? <Text variant="body-xs" tone="muted">{row.flag.note}</Text> : null}
                    </Stack>
                  ) : null),
                },
              ]}
              rows={data.scenes}
              rowKey={row => row.id}
            />
          )}
        </CardBody>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Типичные ошибки" subtitle="Ловушки, неверные значения, недоступные действия и шаги в сторону · по доле прогонов с протоколом" />
        <CardBody>
          {data.errors.length === 0 ? (
            <Text variant="body-s" tone="muted">{noProtocol ? "Протоколов нет: прогоны загружены из выгрузки LMS." : "Ошибок не было."}</Text>
          ) : (
            <DataGrid
              className="tb-psy-grid"
              columns={[
                { key: "text", width: "32%", frozen: true, header: "Ошибка", render: (row: typeof data.errors[number]) => <Labelled label={row.text} /> },
                { key: "kind", width: "20%", align: "center" as const, header: "Вид", render: (row: typeof data.errors[number]) => <Tag tone={KIND[row.kind].tone} size="s">{KIND[row.kind].label}</Tag> },
                { key: "where", width: "28%", header: "Где", render: (row: typeof data.errors[number]) => <Text variant="body-s">{row.where}</Text> },
                { key: "runs", width: "20%", align: "center" as const, header: <TermHint entry="simErrorRuns" />, render: (row: typeof data.errors[number]) => <Scale share={row.runs / data.withProtocol} /> },
              ]}
              rows={data.errors}
              rowKey={row => `${row.kind}:${row.text}:${row.where}`}
            />
          )}
        </CardBody>
      </Card>

      <Card variant="outlined">
        <CardHeader
          title="Карта промахов"
          subtitle={`Где щёлкали мимо действий экрана · ${totalMisses} ${pluralize(totalMisses, "промах", "промаха", "промахов")} в ${missRuns} ${pluralize(missRuns, "прогоне", "прогонах", "прогонах")}`}
        />
        <CardBody>
          {map && totalMisses > 0 ? (
            <div className="tb-miss-body">
              {/* Рейл сцен (эскиз, замечание владельца): все сцены по основному пути, затем вне
                  его; у сцены — число промахов, «нет» — промахов не было. Щелчок — сразу карта. */}
              <PageNav
                orientation="vertical"
                variant="rail"
                aria-label="Сцены сценария"
                value={map.stateKey}
                onChange={id => setStateKey(id)}
                // Пункт — состояние экрана: вид сцены при входе и, под ним, состояния с другими
                // открытыми слоями, где промахивались. Карта рисует ровно то, что было на экране.
                items={data.missMap.map(state => {
                  const onPath = data.scenes.find(scene => scene.id === state.sceneId)?.onPath ?? true;
                  return {
                    id: state.stateKey,
                    label: state.stateLabel ? (
                      <Stack gap={0}>
                        <span>{state.title}</span>
                        <Text variant="body-xs" tone="muted">{state.stateLabel}</Text>
                      </Stack>
                    ) : state.title,
                    count: state.points.length > 0 ? state.points.length : "нет",
                    group: onPath ? "Основной путь" : "Вне основного пути",
                  };
                })}
                data-testid="sim-miss-rail"
              />
            <div className="tb-miss-map" style={{ aspectRatio: `${map.stage.w} / ${map.stage.h}` }} data-testid="sim-miss-map">
              {map.layers.map((layer, index) => (
                <img
                  key={`${layer.file}-${index}`}
                  src={layer.file}
                  alt={index === 0 ? `Сцена «${map.title}»${map.stateLabel ? ` ${map.stateLabel}` : ""}` : ""}
                  className="tb-miss-map__layer"
                  style={{
                    left: `${(layer.x / map.stage.w) * 100}%`,
                    top: `${(layer.y / map.stage.h) * 100}%`,
                    width: `${(layer.w / map.stage.w) * 100}%`,
                    height: `${(layer.h / map.stage.h) * 100}%`,
                  }}
                />
              ))}
              {map.points.map(([x, y], index) => (
                <span
                  key={index}
                  className="tb-miss-dot"
                  style={{ left: `${(x / map.stage.w) * 100}%`, top: `${(y / map.stage.h) * 100}%` }}
                />
              ))}
            </div>
            </div>
          ) : (
            <Text variant="body-s" tone="muted">{noProtocol ? "Протоколов нет: прогоны загружены из выгрузки LMS." : "Промахов не было."}</Text>
          )}
        </CardBody>
      </Card>
    </Stack>
  );
}
