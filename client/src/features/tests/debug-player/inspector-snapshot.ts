/**
 * @module features/tests/debug-player/inspector-snapshot
 * @description PRD-18 Phase 4 — the pure adapter between the shared inspector
 * COMPUTE layer (`window.TBInspector`, loaded from the server as
 * `inspector-compute.js`) and the React debug-player UI. Every tick the player
 * reads the live package globals off the iframe window plus the RTE `window.__scorm`
 * mirror and turns them into ONE immutable {@link InspectorSnapshot} the DS panels
 * render. Keeping this side-effect-free (globals in, data out) lets it be unit
 * tested and keeps the React components thin (FR-13, R-1: the correctness-critical
 * logic stays single-sourced in `TBInspector`, never reimplemented here).
 */

/** The RTE mirror the shim publishes on the player window. */
export interface ScormBridge {
  getCmi(): Record<string, string>;
  getTraffic(): unknown[];
  subscribe(cb: () => void): void;
  restore(key: string): void;
  reset(): void;
}

export interface ProtocolRow {
  idx: number;
  topicName: string;
  prompt: string;
  type: string;
  typeLabel: string;
  answerStr: string;
  answered: boolean;
  verdict: "none" | "correct" | "partial" | "wrong";
  ratio: number;
  ratioPct: number;
  score: number | null;
  sMax: number | null;
  /** Pre-built «цена» note describing the pricing method + tallies (PRD-18). */
  priceNote: string | null;
  earned: number;
  points: number;
  difficulty: number | string | null;
  levelName: string | null;
  contribs: { scaleKey: string; delta: number }[];
}

export interface ScaleRow {
  key: string;
  raw: number | null;
  percent: number | null;
  level: string | null;
  levelLabel: string | null;
  pub: string | null;
}

export interface ResultRow { name: string; live: string | null; pub: string | null }
export interface LmsEvent { kind: string; text: string; sub: string }
/** One structured RTE-call row for the «LMS» table (Вызов · Ключ · Значение). */
export interface LmsRow { idx: number; call: string; key: string; value: string; marker: boolean }
export interface WatchRow { path: string; disp: string }
/** One node of the «Состояние» tree (DS ou-tree). `meta` is the leaf value / child count. */
export interface WatchNode { id: string; label: string; meta: string; leaf: boolean; children?: WatchNode[] }

export interface AdaptiveBar {
  visible: boolean;
  finished?: boolean;
  now?: {
    topicIndex: number; topicCount: number; topicName: string;
    levelName: string; minDifficulty: number; maxDifficulty: number;
  } | null;
  confirmed?: { kind: "ok" | "no"; topicName: string; levelName?: string; correctCount?: number; total?: number }[];
  /** Per-topic confirmed level + status — status-bar adaptive lane + «Результаты» adaptive table. */
  topicLevels?: { topicName: string; levelName: string | null; status: "confirmed" | "running" | "failed" | "pending" }[];
}

/** The methodologist's at-a-glance verdict shown in the status panel over the stage. */
export interface StatusVM {
  drawn: number;
  answered: number;
  percentDone: number;
  /** Published score, present only once the module has reported it to the LMS. */
  score: { raw: string; max: string; scaledPct: number | null } | null;
  verdict: "passed" | "failed" | "unknown" | null;
  /** True once the module reported completion to the LMS — only then is pass/fail meaningful (N2). */
  completed: boolean;
  /** Non-empty when a scale/indicator formula errored — the only status-level alarm. */
  alarm: string | null;
}

/** The subset of `window.TBInspector` the React host consumes. */
export interface TBInspectorApi {
  readPkg(win: Window | null): TBPkg | null;
  parseInteractions(cmi: Record<string, string>): unknown[];
  buildProtocolRows(pkg: TBPkg | null, cmi: Record<string, string>, mode: string): { rows: ProtocolRow[]; note: string; total?: number };
  buildScaleRows(pkg: TBPkg | null, ints: unknown[]): ScaleRow[];
  buildResultRows(pkg: TBPkg | null, ints: unknown[]): ResultRow[];
  buildAdaptiveBar(pkg: TBPkg | null): AdaptiveBar;
  buildScore(pkg: TBPkg | null): ScoreVM;
  buildDraw(pkg: TBPkg | null): DrawVM;
  /** «Эталон»: paint correct-answer markers onto the live question render in the iframe (§5.4). */
  applyReference(iframeWin: Window | null): void;
  /** Remove all «Эталон» markers from the iframe. */
  clearReference(iframeWin: Window | null): void;
  /** Disable the «Завершить тест» button after it's clicked (debug — no re-submit). */
  guardFinishButton(iframeWin: Window | null): void;
  humanizeTraffic(traffic: unknown[]): LmsEvent[];
  buildLmsTable(traffic: unknown[]): LmsRow[];
  buildLmsRawLog(traffic: unknown[]): string;
  flattenLimited(obj: unknown): WatchRow[];
  buildStateTree(obj: unknown): WatchNode[];
  safeJson(obj: unknown): string;
  getSuspendAttempts(cmi: Record<string, string>): { attemptNumber?: number; percent: number }[];
}

/** Loose shape of the live package read by `TBInspector.readPkg`. */
export interface TBPkg {
  hasData: boolean;
  mode: string;
  state: Record<string, unknown> | null;
  scaleErrors?: { key: string; message: string }[];
  resultErrors?: { name: string; message: string }[];
  engineError?: string;
}

export type WatchSource = "state" | "suspend" | "cmi";

/** «Результаты» — the package's own score aggregate, or confirmed levels (adaptive). */
export interface ScoreVM {
  available: boolean;
  adaptive: boolean;
  /** Sectioned flow (linear_by_topics / router) — drives the status-bar «разделы» lane. */
  sectioned?: boolean;
  bar?: AdaptiveBar;
  earnedPoints?: number;
  possiblePoints?: number;
  correct?: number;
  totalQuestions?: number;
  percent?: number;
  passed?: boolean;
  rule?: { type: string; value: number } | null;
  sections?: { topicName: string; earnedPoints: number; possiblePoints: number; percent: number; passed: boolean | null; correct: number; total: number; completed: boolean }[];
}

export interface DrawSectionVM {
  topicName: string;
  count: number;
  mode: "all" | "variants" | "quota" | "draw";
  formId: string | null;
  formIndex: number | null;
  formCount: number | null;
  /** Size of the topic's full question bank (the «из банка M» denominator). */
  bankSize: number;
  /** Composition of the drawn set by sub-topic tag (empty for untagged banks). */
  byTag: { tag: string; count: number }[];
  /** Composition of the drawn set by question type. */
  byType: { type: string; typeLabel: string; count: number }[];
  quotas: { tag: string; planned: number; actual: number; mode: string; short: boolean }[] | null;
  /** The drawn questions with their delivery status (N3 — «выдан»/«не выдан»). */
  questions: { id: string; idx: number; prompt: string; type: string; typeLabel: string; topicName: string; delivered: boolean }[];
  /** How many of this section's questions have been delivered so far. */
  delivered: number;
}

/** One step of an adaptive topic's level path (Шаг|Уровень|Ответ|Переход). */
export interface AdaptivePathStep {
  step: number;
  levelName: string;
  /** «верно» | «неверно» | «—» (the current unanswered question). */
  answer: string;
  /** «↑ повышение» | «↓ понижение» | «= закрепление» | «подтверждён: N ✓» | «идёт». */
  transition: string;
  current: boolean;
}

/** «Выдача» (adaptive) — one topic's level path + its confirmed/current level. */
export interface AdaptivePathTopic {
  topicId: string;
  topicName: string;
  status: "confirmed" | "running" | "failed" | "pending";
  confirmedLevelName: string | null;
  currentLevelName: string | null;
  currentArrow: string;
  steps: AdaptivePathStep[];
}

/** «Выдача» — what THIS run delivered per section (variant / quota / draw). */
export interface DrawVM {
  available: boolean;
  adaptive: boolean;
  bar?: AdaptiveBar;
  /** Adaptive level path per topic — the «Выдача» adaptive table source. */
  path?: AdaptivePathTopic[];
  /** Flat flow (linear_flat) → one combined «Вопросы» list; sectioned → per-topic. */
  flat?: boolean;
  sections?: DrawSectionVM[];
}

export interface InspectorSnapshot {
  hasData: boolean;
  score: ScoreVM;
  /** `total` = full drawn count for the progress denominator; `rows` are delivered-so-far (N1). */
  protocol: { rows: ProtocolRow[]; note: string; total?: number };
  draw: DrawVM;
  scales: ScaleRow[];
  results: ResultRow[];
  lms: LmsEvent[];
  lmsRows: LmsRow[];
  lmsRawLog: string;
  watch: { rows: WatchRow[]; json: string; count: number; tree: WatchNode[] };
  adaptive: AdaptiveBar;
  status: StatusVM;
  attempts: { value: string; label: string }[];
}

function num(s: string | undefined): boolean {
  return s != null && s !== "";
}

/**
 * Expand a flat dotted-key record (`cmi.score.scaled`, `cmi.interactions.0.id`, …)
 * into a nested object so the «Состояние» tree renders the `cmi` source the SAME
 * hierarchical way as `state`/`suspend_data` — every element is a uniform tree node.
 */
function nestDotted(flat: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const key of Object.keys(flat)) {
    const parts = key.split(".");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      // A leaf already sitting where a branch is needed yields to the branch
      // (SCORM never sets both a node and its children, so this is safe).
      if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
      cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = flat[key];
  }
  return root;
}

/** Resolve the watch object for the chosen source (mirrors the CLI inspector). */
function watchObject(pkg: TBPkg | null, cmi: Record<string, string>, src: WatchSource): unknown {
  if (src === "suspend") {
    try { return JSON.parse(cmi["cmi.suspend_data"] || "null"); } catch { return null; }
  }
  // The cmi store is a flat dotted-key map. Nest it so its tree matches the others,
  // dropping the redundant top-level «cmi» (we're already inside the cmi source).
  if (src === "cmi") {
    if (!Object.keys(cmi).length) return null;
    const stripped: Record<string, string> = {};
    for (const k of Object.keys(cmi)) stripped[k.replace(/^cmi\./, "")] = cmi[k];
    return nestDotted(stripped);
  }
  return pkg ? pkg.state : null;
}

/**
 * Build the immutable inspector snapshot for one tick.
 * @param iframeWin the package window (same-origin), or null before it loads
 * @param scorm the RTE mirror, or null before the shim is hosted
 * @param opts the protocol attempt selector + watch source
 */
export function buildSnapshot(
  iframeWin: Window | null,
  scorm: ScormBridge | null,
  opts: { protocolMode: string; watchSource: WatchSource },
): InspectorSnapshot {
  const TB = (typeof window !== "undefined" ? window.TBInspector : undefined) as TBInspectorApi | undefined;
  const cmi = (scorm && scorm.getCmi()) || {};
  const traffic = (scorm && scorm.getTraffic()) || [];

  const empty: InspectorSnapshot = {
    hasData: false,
    score: { available: false, adaptive: false },
    protocol: { rows: [], note: "" },
    draw: { available: false, adaptive: false },
    scales: [], results: [], lms: [], lmsRows: [], lmsRawLog: "—",
    watch: { rows: [], json: "—", count: 0, tree: [] },
    adaptive: { visible: false },
    status: { drawn: 0, answered: 0, percentDone: 0, score: null, verdict: null, completed: false, alarm: null },
    attempts: [{ value: "live", label: "Текущая (live)" }],
  };
  if (!TB) return empty;

  const pkg = TB.readPkg(iframeWin);
  const ints = TB.parseInteractions(cmi);

  const scoreVM = TB.buildScore(pkg);
  const protocol = TB.buildProtocolRows(pkg, cmi, opts.protocolMode);
  const draw = TB.buildDraw(pkg);
  const scales = TB.buildScaleRows(pkg, ints);
  const results = TB.buildResultRows(pkg, ints);
  const lms = TB.humanizeTraffic(traffic);
  const lmsRows = TB.buildLmsTable(traffic);
  const lmsRawLog = TB.buildLmsRawLog(traffic);
  const adaptive = TB.buildAdaptiveBar(pkg);

  const wObj = watchObject(pkg, cmi, opts.watchSource);
  const watchRows = wObj ? TB.flattenLimited(wObj) : [];
  const watchTree = wObj ? TB.buildStateTree(wObj) : [];
  const watchJson = wObj ? TB.safeJson(wObj) : "—";

  const drawn = protocol.total ?? protocol.rows.length;
  const answered = protocol.rows.filter((r) => r.answered).length;
  const scaled = cmi["cmi.score.scaled"];
  const score = num(cmi["cmi.score.raw"]) || num(scaled)
    ? { raw: cmi["cmi.score.raw"] || "—", max: cmi["cmi.score.max"] || "—", scaledPct: num(scaled) ? Math.round(Number(scaled) * 100) : null }
    : null;
  const ss = cmi["cmi.success_status"];
  const verdict = ss === "passed" || ss === "failed" || ss === "unknown" ? ss : null;
  // The run is "done" (verdict meaningful) once it reports completion to the LMS OR the
  // learner reached the end / results screen — standard: currentIndex past the last
  // question; adaptive: adaptiveState.isFinished. (cmi.completion_status alone is set only
  // on the final close, so the results screen would otherwise read «в процессе».)
  const pstate = (pkg && pkg.state) as Record<string, unknown> | null;
  let reachedEnd = false;
  if (pstate) {
    const as = pstate.adaptiveState as { isFinished?: boolean } | undefined;
    if (as && typeof as === "object") reachedEnd = !!as.isFinished;
    else if (typeof pstate.currentIndex === "number" && Array.isArray(pstate.flatQuestions)) {
      reachedEnd = pstate.flatQuestions.length > 0 && (pstate.currentIndex as number) >= pstate.flatQuestions.length;
    }
  }
  const completed = cmi["cmi.completion_status"] === "completed" || reachedEnd;
  const errs = ((pkg && pkg.scaleErrors) || []).length + ((pkg && pkg.resultErrors) || []).length;
  const alarm = pkg && pkg.engineError ? pkg.engineError : errs ? "Ошибка расчёта показателей или шкал" : null;

  const attempts: { value: string; label: string }[] = [{ value: "live", label: "Текущая (live)" }];
  (TB.getSuspendAttempts(cmi) || []).forEach((a, i) => {
    attempts.push({ value: "att:" + i, label: "#" + (a.attemptNumber || i + 1) + " — " + Math.round(a.percent) + "%" });
  });

  return {
    hasData: !!(pkg && pkg.hasData),
    score: scoreVM,
    protocol,
    draw,
    scales,
    results,
    lms,
    lmsRows,
    lmsRawLog,
    watch: { rows: watchRows, json: watchJson, count: watchRows.length, tree: watchTree },
    adaptive,
    status: { drawn, answered, percentDone: drawn ? Math.round((answered / drawn) * 100) : 0, score, verdict, completed, alarm },
    attempts,
  };
}

/** Serialize the live protocol rows to CSV (the debug run's only export; R-2). */
export function protocolToCsv(rows: ProtocolRow[]): string {
  const cell = (s: unknown): string => {
    const v = String(s == null ? "" : s);
    return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const lines = [
    ["#", "Тема", "Вопрос", "Тип", "Ответ", "Верность", "Ratio", "score", "sMax", "Балл", "ВозможныйБалл", "Сложность", "ВкладыВШкалы"].join(";"),
  ];
  rows.forEach((r, i) => {
    const contribs = r.contribs.map((c) => `${c.scaleKey} ${c.delta >= 0 ? "+" : ""}${c.delta}`).join(" | ");
    lines.push([
      i + 1, cell(r.topicName), cell(r.prompt), r.type, cell(r.answerStr), r.verdict, r.ratio,
      r.score == null ? "" : r.score, r.sMax == null ? "" : r.sMax, r.earned, r.points,
      r.difficulty == null ? "" : r.difficulty, cell(contribs),
    ].join(";"));
  });
  return lines.join("\n");
}

declare global {
  interface Window {
    API_1484_11?: unknown;
    __scorm?: ScormBridge;
    TBInspector?: TBInspectorApi;
  }
}
