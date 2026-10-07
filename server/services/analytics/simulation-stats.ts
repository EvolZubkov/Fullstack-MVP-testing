/**
 * @module server/services/analytics/simulation-stats
 * @description «Сценарий в ИС», этап Э5б: аналитика вопроса-сценария — согласованный эскиз
 * `docs/wireframes/sim-scenario-analytics.html`.
 *
 * Прогон приходит в факты ответов тремя видами, и все три читает {@link readSimRun}:
 *   - полный результат плеера с протоколом — веб (переигранный сервером) и телеметрия пакета;
 *   - компактный прогон без протокола — исход, доля цели, счётчики;
 *   - строка шагов взаимодействия `performance` из выгрузки отчёта LMS
 *     (`outcome[.]success[,]goal[.]100[,]misses[.]1…`).
 *
 * Исходы, доля цены, время и счётчики считаются по всем прогонам. Сцены, ошибки и карта промахов
 * — только по прогонам с протоколом: у выгрузки LMS его нет, и подпись блока называет, сколько
 * прогонов легло в основу.
 *
 * Модуль чистый: на входе сценарий и факты, на выходе вид для страницы.
 */
import type { Outcome, Scenario, Scene, SimEvent } from "@shared/sim/contract";
import { replayRun } from "@shared/sim/replay";

/** Прогон в том виде, в каком его читает аналитика. */
export interface SimRunView {
  outcome: Outcome;
  goalShare: number | null;
  counts: { misses: number; blocked: number; wrongValues: number; detours: number; traps: number; hints: number };
  durationMs: number | null;
  /** Протокол; нет — прогон из выгрузки LMS или компактный. */
  events: SimEvent[] | null;
}

const OUTCOMES: readonly Outcome[] = ["success", "partial", "fail", "exited", "timeout"];

/** Подписи исходов — как на странице и в таблице вопросов. */
export const OUTCOME_LABEL: Record<Outcome, string> = {
  success: "Цель достигнута",
  partial: "Частично",
  fail: "Цель не достигнута",
  exited: "Вышли досрочно",
  timeout: "Время вышло",
};

const COUNT_KEYS = ["misses", "blocked", "wrongValues", "detours", "traps", "hints"] as const;
/** Имена шагов `performance` пакета (`resultsPage.js formatResponse`) → счётчики. */
const STEP_TO_COUNT: Record<string, (typeof COUNT_KEYS)[number]> = {
  misses: "misses", blocked: "blocked", wrong: "wrongValues", detours: "detours", traps: "traps", hints: "hints",
};

function n(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function isOutcome(value: unknown): value is Outcome {
  return typeof value === "string" && (OUTCOMES as readonly string[]).includes(value);
}

/**
 * Прочитать прогон из ответа любого из трёх видов.
 *
 * @returns прогон либо `null`, когда ответ — не прогон (пустой ответ, чужая форма)
 */
export function readSimRun(answer: unknown): SimRunView | null {
  if (typeof answer === "string") return readPerformance(answer);
  if (!answer || typeof answer !== "object") return null;
  const raw = answer as { outcome?: unknown; goal?: { share?: unknown } | null; counts?: Record<string, unknown>; durationMs?: unknown; events?: unknown };
  if (!isOutcome(raw.outcome)) return null;
  const counts = raw.counts ?? {};
  return {
    outcome: raw.outcome,
    goalShare: typeof raw.goal?.share === "number" ? raw.goal.share : null,
    counts: {
      misses: n(counts.misses), blocked: n(counts.blocked), wrongValues: n(counts.wrongValues),
      detours: n(counts.detours), traps: n(counts.traps), hints: n(counts.hints),
    },
    durationMs: typeof raw.durationMs === "number" && raw.durationMs > 0 ? raw.durationMs : null,
    events: Array.isArray(raw.events) ? (raw.events as SimEvent[]) : null,
  };
}

/** Шаги взаимодействия `performance`: «имя[.]значение» через `[,]`. */
function readPerformance(text: string): SimRunView | null {
  const steps = new Map<string, string>();
  for (const part of text.split("[,]")) {
    const [name, value] = part.split("[.]");
    if (name && value !== undefined) steps.set(name.trim(), value.trim());
  }
  const outcome = steps.get("outcome");
  if (!isOutcome(outcome)) return null;
  const counts = { misses: 0, blocked: 0, wrongValues: 0, detours: 0, traps: 0, hints: 0 };
  for (const [step, key] of Object.entries(STEP_TO_COUNT)) counts[key] = n(Number(steps.get(step)));
  const goal = Number(steps.get("goal"));
  return { outcome, goalShare: Number.isFinite(goal) ? goal / 100 : null, counts, durationMs: null, events: null };
}

/** Факт ответа в той части, что нужна аналитике сценария. */
export interface SimFact {
  answer: unknown;
  earnedPoints: number | null;
  possiblePoints: number | null;
  latencyMs: number | null;
}

export interface SceneRow {
  id: string;
  title: string;
  onPath: boolean;
  /** Сколько прогонов с протоколом побывали на сцене. */
  reached: number;
  /** Медиана суммарного времени на сцене за прогон, мс. */
  medianMs: number | null;
  missesPerRun: number | null;
  /** Доля прогонов (из побывавших), где на сцене показана подсказка. */
  hintShare: number | null;
  /** «Что не так»: узкое место, бросают, частая подсказка, шаг в сторону. */
  flag: { kind: "bottleneck" | "abandon" | "hints" | "detour"; note?: string } | null;
}

export interface ErrorRow {
  kind: "trap" | "wrong" | "blocked" | "detour";
  text: string;
  where: string;
  /** Сколько прогонов с протоколом встретили ошибку хотя бы раз. */
  runs: number;
}

/**
 * Одно состояние экрана для карты промахов: сцена и набор слоёв, открытых в момент промаха
 * (меню, диалог, сообщение). Участник видел ровно это — подложка рисуется из тех же слоёв.
 * У каждой сцены есть состояние «как при входе»; состояния с другими слоями — только где
 * промахивались.
 */
export interface MissMapScene {
  sceneId: string;
  /** Ключ состояния: сцена и видимые слои. */
  stateKey: string;
  title: string;
  /** Чем состояние отличается от входа в сцену: «+ «Ошибка сохранения»»; нет — вид при входе. */
  stateLabel: string | null;
  stage: { w: number; h: number };
  /** Видимые слои — изображения в координатах сцены, в порядке наложения. */
  layers: Array<{ file: string; x: number; y: number; w: number; h: number }>;
  points: Array<[number, number]>;
  runs: number;
}

export interface SimulationStatsView {
  runs: number;
  withProtocol: number;
  outcomes: Array<{ outcome: Outcome; label: string; runs: number }>;
  meanShare: number | null;
  duration: { medianMs: number; q1Ms: number; q3Ms: number; measured: number } | null;
  limitSeconds: number | null;
  misses: { perRun: number; median: number; topScene: string | null };
  hints: { runs: number; topScene: string | null };
  scenes: SceneRow[];
  errors: ErrorRow[];
  missMap: MissMapScene[];
  /** Сколько прогонов с протоколом промахнулись хотя бы раз. */
  missRuns: number;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/** Сцены основного пути по порядку: от старта по переходам действий роли `path`. */
function mainPath(scenario: Scenario): string[] {
  const byId = new Map(scenario.scenes.map((s) => [s.id, s]));
  const order: string[] = [];
  const queue = [scenario.start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (order.includes(id) || !byId.has(id)) continue;
    order.push(id);
    const scene = byId.get(id)!;
    for (const action of [...(scene.zones ?? []), ...(scene.keys ?? [])]) {
      if (action.role !== "path") continue;
      for (const effect of action.effects ?? []) if ("goto" in effect) queue.push(effect.goto);
    }
  }
  return order;
}

function actionOf(scene: Scene | undefined, id: string) {
  return [...(scene?.zones ?? []), ...(scene?.keys ?? [])].find((a) => a.id === id);
}

/** Нормализованное значение поля — чтобы «1183» и « 1183 » были одной ошибкой. */
function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

const MISS_POINTS_MAX = 2000;
const ERRORS_MAX = 12;

/**
 * Аналитика вопроса-сценария по фактам его ответов.
 *
 * @param scenario хранимый сценарий вопроса
 * @param facts факты ответов на него в выборке страницы
 */
export function buildSimulationStats(scenario: Scenario, facts: readonly SimFact[]): SimulationStatsView {
  const scenes = new Map(scenario.scenes.map((s) => [s.id, s]));
  const titleOf = (id: string) => scenes.get(id)?.title ?? id;
  const fieldTitle = new Map((scenario.fields ?? []).map((f) => [f.id, f.title ?? f.id]));

  const runs = facts.map((fact) => ({ fact, run: readSimRun(fact.answer) })).filter((x): x is { fact: SimFact; run: SimRunView } => x.run !== null);

  const outcomeCount = new Map<Outcome, number>();
  const shares: number[] = [];
  const durations: number[] = [];
  const missCounts: number[] = [];
  let hintRuns = 0;

  // По сценам — только прогоны с протоколом.
  const reached = new Map<string, number>();
  const sceneTimes = new Map<string, number[]>();
  const sceneMisses = new Map<string, number>();
  const sceneHintRuns = new Map<string, number>();
  const exitScenes = new Map<string, number>();
  const missStates = new Map<string, { scene: string; visible: string[]; points: Array<[number, number]>; runs: number }>();
  const errorRuns = new Map<string, ErrorRow>();
  let withProtocol = 0;
  let runsWithMisses = 0;

  for (const { fact, run } of runs) {
    outcomeCount.set(run.outcome, (outcomeCount.get(run.outcome) ?? 0) + 1);
    if (fact.possiblePoints && fact.possiblePoints > 0 && fact.earnedPoints !== null) shares.push(fact.earnedPoints / fact.possiblePoints);
    const duration = run.durationMs ?? fact.latencyMs;
    if (duration && duration > 0) durations.push(duration);
    missCounts.push(run.counts.misses);
    if (run.counts.hints > 0) hintRuns += 1;

    if (!run.events) continue;
    withProtocol += 1;
    const seen = new Set<string>();
    const time = new Map<string, number>();
    const hinted = new Set<string>();
    const missedHere = new Set<string>();
    const errorsHere = new Set<string>();
    let current: string | null = null;
    let since = 0;
    const enter = (scene: string, t: number) => {
      if (current !== null) time.set(current, (time.get(current) ?? 0) + Math.max(0, t - since));
      current = scene;
      since = t;
      seen.add(scene);
    };
    if (!run.events.some((e) => e.type === "enter")) enter(scenario.start, 0);
    const noteError = (key: string, row: Omit<ErrorRow, "runs">) => {
      if (errorsHere.has(key)) return;
      errorsHere.add(key);
      const prev = errorRuns.get(key);
      errorRuns.set(key, prev ? { ...prev, runs: prev.runs + 1 } : { ...row, runs: 1 });
    };
    for (const event of run.events) {
      if (event.type === "enter") { enter(event.scene, event.t); continue; }
      if (event.type === "miss") {
        sceneMisses.set(event.scene, (sceneMisses.get(event.scene) ?? 0) + 1);
        missedHere.add(event.scene);
        continue;
      }
      if (event.type === "hint") { hinted.add(event.scene); continue; }
      if (event.type === "action" && (event.role === "trap" || event.role === "detour")) {
        const action = actionOf(scenes.get(event.scene), event.id);
        if (event.role === "trap") {
          noteError(`trap:${event.id}`, { kind: "trap", text: event.error ?? action?.error ?? action?.title ?? event.id, where: titleOf(event.scene) });
        } else {
          const target = action?.effects?.find((e): e is { goto: string } => "goto" in e)?.goto;
          noteError(`detour:${event.id}`, { kind: "detour", text: action?.title ?? (target ? `Ушли в «${titleOf(target)}»` : event.id), where: titleOf(event.scene) });
        }
        continue;
      }
      if (event.type === "blocked") {
        const action = actionOf(scenes.get(event.scene), event.id);
        noteError(`blocked:${event.id}`, { kind: "blocked", text: action?.title ?? event.id, where: titleOf(event.scene) });
        continue;
      }
      if (event.type === "value" && event.correct === false) {
        const value = normalizeValue(event.value);
        noteError(`wrong:${event.field}:${value}`, {
          kind: "wrong",
          text: `«${event.value.trim()}»`,
          where: `поле «${fieldTitle.get(event.field) ?? event.field}» · ${titleOf(event.scene)}`,
        });
      }
    }
    // Карта промахов: что было на экране в момент промаха, знает только движок — протокол
    // хранит щелчок, а не экран. Прогон переигрывается тем же движком, что у плеера.
    const statesHere = new Set<string>();
    replayRun(scenario, { outcome: run.outcome, counts: run.counts, events: run.events }, {
      onMiss: (miss) => {
        const key = `${miss.scene}|${miss.visible.join(",")}`;
        const state = missStates.get(key) ?? { scene: miss.scene, visible: miss.visible, points: [], runs: 0 };
        if (state.points.length < MISS_POINTS_MAX) state.points.push([miss.x, miss.y]);
        missStates.set(key, state);
        statesHere.add(key);
      },
    });
    for (const key of statesHere) missStates.get(key)!.runs += 1;
    const end = run.durationMs ?? run.events.reduce((max, e) => Math.max(max, e.t), 0);
    if (current !== null) time.set(current, (time.get(current) ?? 0) + Math.max(0, end - since));
    if (run.outcome === "exited" && current !== null) exitScenes.set(current, (exitScenes.get(current) ?? 0) + 1);
    for (const scene of seen) {
      reached.set(scene, (reached.get(scene) ?? 0) + 1);
      const list = sceneTimes.get(scene) ?? [];
      list.push(time.get(scene) ?? 0);
      sceneTimes.set(scene, list);
      if (hinted.has(scene)) sceneHintRuns.set(scene, (sceneHintRuns.get(scene) ?? 0) + 1);
    }
    if (missedHere.size > 0) runsWithMisses += 1;
  }

  // Порядок сцен: основной путь, затем побывавшие вне его.
  const path = mainPath(scenario).filter((id) => reached.has(id));
  const off = [...reached.keys()].filter((id) => !path.includes(id));
  const totalMisses = [...sceneMisses.values()].reduce((a, b) => a + b, 0);
  const bottleneck = [...sceneMisses.entries()].sort((a, b) => b[1] - a[1])[0];
  const abandon = [...exitScenes.entries()].sort((a, b) => b[1] - a[1])[0];

  const sceneRow = (id: string, onPath: boolean): SceneRow => {
    const r = reached.get(id) ?? 0;
    const misses = sceneMisses.get(id) ?? 0;
    const hintShare = r > 0 ? (sceneHintRuns.get(id) ?? 0) / r : null;
    let flag: SceneRow["flag"] = null;
    if (!onPath) flag = { kind: "detour" };
    else if (bottleneck && bottleneck[0] === id && totalMisses > 0 && bottleneck[1] / totalMisses >= 0.25) {
      flag = { kind: "bottleneck", note: `${Math.round((bottleneck[1] / totalMisses) * 100)} % промахов теста` };
    } else if (abandon && abandon[0] === id && withProtocol > 0 && abandon[1] / withProtocol >= 0.05) {
      flag = { kind: "abandon", note: `${Math.round((abandon[1] / withProtocol) * 100)} % вышли досрочно здесь` };
    } else if (hintShare !== null && hintShare > 0.2) flag = { kind: "hints" };
    return {
      id,
      title: titleOf(id),
      onPath,
      reached: r,
      medianMs: median(sceneTimes.get(id) ?? []),
      missesPerRun: r > 0 ? misses / r : null,
      hintShare,
      flag,
    };
  };

  const stage = scenario.settings?.stage ?? { w: 1920, h: 1080 };
  const mediaById = new Map(scenario.media.map((m) => [m.id, m]));
  // Подложка — у КАЖДОЙ сцены разбора, в его порядке: вид при входе есть всегда (рейл
  // переключает и на сцену без промахов — она показывается чистой), за ним — состояния с другими
  // открытыми слоями, где промахивались. Открывать первым — состояние с наибольшим числом
  // промахов (клиент).
  const sceneOrder = [...path, ...off];
  const layerName = (scene: Scene | undefined, id: string) => {
    const el = scene?.elements.find((e) => e.id === id);
    return (el && mediaById.get(el.media)?.title) || id;
  };
  const stateOf = (id: string, visible: string[], points: Array<[number, number]>, runsCount: number): MissMapScene => {
    const scene = scenes.get(id);
    const initial = (scene?.elements ?? []).filter((el) => !el.hidden).map((el) => el.id);
    const opened = visible.filter((v) => !initial.includes(v));
    const closed = initial.filter((v) => !visible.includes(v));
    const parts = [
      ...opened.map((v) => `+ «${layerName(scene, v)}»`),
      ...closed.map((v) => `без «${layerName(scene, v)}»`),
    ];
    return {
      sceneId: id,
      stateKey: `${id}|${visible.join(",")}`,
      title: titleOf(id),
      stateLabel: parts.length > 0 ? parts.join(" ") : null,
      stage: scene?.size ?? stage,
      layers: (scene?.elements ?? [])
        .filter((el) => visible.includes(el.id))
        .flatMap((el) => {
          const media = mediaById.get(el.media);
          return media ? [{ file: media.file, x: el.x, y: el.y, w: el.w ?? media.w, h: el.h ?? media.h }] : [];
        }),
      points,
      runs: runsCount,
    };
  };
  const missMap: MissMapScene[] = sceneOrder.flatMap((id) => {
    const scene = scenes.get(id);
    const initial = (scene?.elements ?? []).filter((el) => !el.hidden).map((el) => el.id);
    const initialKey = `${id}|${initial.join(",")}`;
    const own = [...missStates.entries()].filter(([, s]) => s.scene === id);
    const atEntry = missStates.get(initialKey);
    const others = own.filter(([key]) => key !== initialKey).sort((a, b) => b[1].points.length - a[1].points.length);
    return [
      stateOf(id, initial, atEntry?.points ?? [], atEntry?.runs ?? 0),
      ...others.map(([, s]) => stateOf(id, s.visible, s.points, s.runs)),
    ];
  });

  const sortedDurations = [...durations].sort((a, b) => a - b);
  const sceneOf = (counter: Map<string, number>) => {
    const top = [...counter.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? titleOf(top[0]) : null;
  };

  return {
    runs: runs.length,
    withProtocol,
    outcomes: OUTCOMES.map((outcome) => ({ outcome, label: OUTCOME_LABEL[outcome], runs: outcomeCount.get(outcome) ?? 0 })),
    meanShare: shares.length > 0 ? shares.reduce((a, b) => a + b, 0) / shares.length : null,
    duration: sortedDurations.length > 0
      ? { medianMs: quantile(sortedDurations, 0.5), q1Ms: quantile(sortedDurations, 0.25), q3Ms: quantile(sortedDurations, 0.75), measured: sortedDurations.length }
      : null,
    limitSeconds: scenario.settings?.limitSeconds ?? null,
    misses: {
      perRun: missCounts.length > 0 ? missCounts.reduce((a, b) => a + b, 0) / missCounts.length : 0,
      median: median(missCounts) ?? 0,
      topScene: sceneOf(sceneMisses),
    },
    hints: { runs: hintRuns, topScene: sceneOf(sceneHintRuns) },
    scenes: [...path.map((id) => sceneRow(id, true)), ...off.map((id) => sceneRow(id, false))],
    errors: [...errorRuns.values()].sort((a, b) => b.runs - a.runs).slice(0, ERRORS_MAX),
    missMap,
    missRuns: runsWithMisses,
  };
}

/**
 * Разброс исходов для «Что отвечали» таблицы вопросов: варианты — исходы, доля — доля прогонов.
 *
 * @returns разброс либо `null`, когда прогонов нет
 */
export function simulationSpread(answers: readonly unknown[]): { options: Array<{ label: string; share: number; key: Outcome }>; answered: number } | null {
  const counts = new Map<Outcome, number>();
  let total = 0;
  for (const answer of answers) {
    const run = readSimRun(answer);
    if (!run) continue;
    counts.set(run.outcome, (counts.get(run.outcome) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return null;
  return {
    options: OUTCOMES.map((outcome) => ({ label: OUTCOME_LABEL[outcome], share: ((counts.get(outcome) ?? 0) / total) * 100, key: outcome })),
    answered: total,
  };
}
