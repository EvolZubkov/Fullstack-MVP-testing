/**
 * @module shared/sim/cover
 *
 * «Сценарий в ИС» inside an ordinary section: the cover a question-scenario shows in the answer
 * area of the question screen, and the rules dialog «Пройти» opens (sim-scenario tech debt №5,
 * wireframe `docs/wireframes/sim-scenario-learner.html`, states section-*, approved 2026-10-08).
 *
 * One source for both hosts: the web renders the cover through the template screen, the package
 * gets these functions through the `TBTemplate` bundle. The markup is the approved wireframe's,
 * which was rendered from the ui-kit components themselves (IconBadge, Button).
 *
 * The CORE lays the cover out, with inline styles, like the protection mark: a scenario must look
 * the same under every design template, including those living in their own repositories, and a
 * template that never heard of scenarios must not draw a broken cover.
 */
import type { Scenario } from "./contract";
import type { SimPenalties } from "./scoring";

/** What the cover says about the run of this question. */
export type SimCoverState = "fresh" | "done" | "exited" | "timeout";

/**
 * The cover state from the answer — the full web result or the compact package cell alike: both
 * carry `outcome`. No answer, or no outcome, is a scenario not played yet.
 */
export function simCoverState(answer: unknown): SimCoverState {
  const outcome = answer && typeof answer === "object" ? (answer as { outcome?: unknown }).outcome : undefined;
  if (outcome === "exited") return "exited";
  if (outcome === "timeout") return "timeout";
  if (outcome === "success" || outcome === "partial" || outcome === "fail") return "done";
  return "fresh";
}

/** The image of the first scene — what the cover shows blurred; `null` when there is none. */
export function simCoverShot(scenario: Scenario | null | undefined): string | null {
  if (!scenario) return null;
  const scene = scenario.scenes?.find((s) => s.id === scenario.start) ?? scenario.scenes?.[0];
  const first = scene?.elements?.find((el) => !el.hidden) ?? scene?.elements?.[0];
  const media = first ? scenario.media?.find((m) => m.id === first.media) : undefined;
  return media?.file ?? null;
}

const esc = (text: string) =>
  String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] as string);

// lucide icons as the wireframe rendered them (lucide-react output).
const ICON_PLAY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>';
const ICON_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';
const ICON_LOG_OUT = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-log-out" aria-hidden="true"><path d="m16 17 5-5-5-5"></path><path d="M21 12H9"></path><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path></svg>';
const ICON_TIMER_OFF = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-timer-off" aria-hidden="true"><path d="M10 2h4"></path><path d="M4.6 11a8 8 0 0 0 1.7 8.7 8 8 0 0 0 8.7 1.7"></path><path d="M7.4 7.4a8 8 0 0 1 10.3 1 8 8 0 0 1 .9 10.2"></path><path d="m2 2 20 20"></path><path d="M12 12v-2"></path></svg>';
export const ICON_MAXIMIZE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" x2="14" y1="3" y2="10"></line><line x1="3" x2="10" y1="21" y2="14"></line></svg>';

/** The action the cover's buttons fire: the host opens the rules dialog on it. */
export const SIM_OPEN_ACTION = "sim-open";

const STYLE = {
  cover: "position:relative;width:100%;max-width:960px;border:1px solid var(--ou-border-soft);border-radius:var(--ou-radius-m);overflow:hidden;background:var(--ou-bg-surface-2)",
  shot: "display:block;width:100%;height:auto;filter:blur(2px);transform:scale(1.02)",
  blank: "display:block;width:100%;aspect-ratio:16/10",
  veil: "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--ou-space-4);padding:var(--ou-space-4);background:color-mix(in srgb, var(--ou-bg-page) 60%, transparent)",
  done: "display:flex;flex-direction:column;align-items:center;gap:var(--ou-space-4)",
  title: "margin:0;font:var(--ou-text-heading-l);color:var(--ou-fg-default);text-align:center",
  note: "font:var(--ou-text-body-s);color:var(--ou-fg-muted)",
};

/** Options of {@link renderSimCover}. */
export interface SimCoverOptions {
  /** Where the run stands. */
  state: SimCoverState;
  /** URL of the first scene's image; `null` — a plain surface instead. */
  shotUrl: string | null;
  /** The test lets the learner change the answer: a finished run offers «Пройти заново». */
  retake: boolean;
  /** Read-only screen (review, a locked section): no buttons at all. */
  readonly?: boolean;
}

/**
 * The cover markup for the `question-interaction` slot.
 *
 * Not started — «Пройти» and «Задание выполняется на весь экран»; finished — an IconBadge in the
 * outcome's tone and a heading. The cover tells WHETHER the run is over, not how it went: the
 * outcome and the points are in the player's result window, by the test's rules of showing
 * results.
 */
export function renderSimCover(options: SimCoverOptions): string {
  const { state, shotUrl, retake, readonly = false } = options;
  const shot = shotUrl
    ? `<img class="tb-sim-cover__shot" src="${esc(shotUrl)}" alt="" style="${STYLE.shot}">`
    : `<div class="tb-sim-cover__blank" style="${STYLE.blank}"></div>`;
  const button = (variant: "primary" | "secondary", size: "l" | "m", label: string, icon = "") =>
    `<button type="button" class="ou-btn ou-btn--${variant} ou-btn--${size}" data-action="${SIM_OPEN_ACTION}">${icon ? `<span class="ou-btn__ico">${icon}</span>` : ""}<span>${label}</span></button>`;
  const finished = (tone: "success" | "warning", icon: string, title: string, withRetake: boolean) =>
    `<div class="tb-sim-cover__done" style="${STYLE.done}"><span class="ou-iconbadge ou-iconbadge--${tone} ou-iconbadge--l">${icon}</span><h2 class="tb-sim-cover__title" style="${STYLE.title}">${title}</h2>${withRetake && !readonly ? button("secondary", "m", "Пройти заново") : ""}</div>`;

  let veil: string;
  if (state === "fresh") {
    veil = (readonly ? "" : button("primary", "l", "Пройти", ICON_PLAY))
      + `<span class="tb-sim-cover__note" style="${STYLE.note}">Задание выполняется на весь экран</span>`;
  } else if (state === "done") {
    veil = finished("success", ICON_CHECK, "Задание выполнено", retake);
  } else if (state === "exited") {
    veil = finished("warning", ICON_LOG_OUT, "Выход досрочно: задание не выполнено", retake);
  } else {
    veil = finished("warning", ICON_TIMER_OFF, "Время вышло: задание не выполнено", retake);
  }
  return `<div class="tb-sim-cover" data-testid="sim-cover" data-sim-state="${state}" style="${STYLE.cover}">${shot}<div class="tb-sim-cover__veil" style="${STYLE.veil}">${veil}</div></div>`;
}

/** The rules dialog, as text: the hosts put it into their own dialog markup. */
export interface SimRules {
  title: string;
  description: string;
  items: string[];
}

const PENALTY_WORDS: Array<[keyof SimPenalties, string]> = [
  ["miss", "щелчки мимо действий экрана"],
  ["blocked", "действия, которые система не даёт выполнить"],
  ["wrongValue", "неверные значения в полях"],
  ["detour", "лишние действия в стороне от задания"],
  ["trap", "ошибочные действия с последствиями"],
];

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function duration(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${plural(minutes, "минута", "минуты", "минут")}`;
  }
  if (seconds < 60) return `${seconds} ${plural(seconds, "секунда", "секунды", "секунд")}`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} мин ${rest} с`;
}

/**
 * The rules «Пройти» shows, built from the scenario's settings and the scoring of the question in
 * this test (path of the learner 5.2). Only what is true is said: no limit — no line about time,
 * no penalty for a kind of mistake — it is not named, hints off — no line about hints.
 *
 * @param scenario the scenario of the question
 * @param penalties the resolved penalties of the question in this test; `null` — unknown, the
 *   line about the score is left out rather than guessed
 */
export function simRules(scenario: Scenario, penalties: SimPenalties | null): SimRules {
  const settings = scenario.settings ?? {};
  const items = ["Задание откроется на весь экран. Выполните действия в окне системы так, как делаете это в работе."];
  const limit = typeof settings.limitSeconds === "number" && settings.limitSeconds > 0 ? settings.limitSeconds : null;
  if (limit !== null) {
    items.push(`На задание отводится ${duration(limit)}. Таймер — на панели над окном системы; когда время выйдет, задание завершится.`);
  }
  if (penalties) {
    const named = PENALTY_WORDS.filter(([key]) => penalties[key] > 0).map(([, words]) => words);
    if (named.length > 0) {
      // Через точку с запятой: у части названий своя запятая внутри («действия, которые …»).
      items.push(`Балл снижают: ${named.join("; ")}.`);
    }
  }
  if (settings.hints?.enabled) {
    const after = settings.hints.afterMisses ?? 3;
    const hintCosts = penalties ? penalties.hint > 0 : false;
    items.push(`После ${after} ${plural(after, "ошибки", "ошибок", "ошибок")} на одном шаге появится подсказка.${hintCosts ? " Подсказка тоже снижает балл." : ""}`);
  }
  items.push("Выйти досрочно можно кнопкой на панели. Задание тогда будет засчитано как невыполненное.");
  return { title: "Практическое задание", description: scenario.meta?.title ?? "", items };
}

/**
 * The rules dialog markup for a host without a component library (the SCORM package): the DS
 * modal, as in the wireframe. `data-action` marks the two buttons the host listens to.
 */
export function renderSimRulesDialog(rules: SimRules): string {
  const items = rules.items.map((item) => `<li>${esc(item)}</li>`).join("");
  return `<div class="ou-modal-root tb-sim-modal" role="dialog" aria-modal="true" aria-labelledby="tb-sim-rules-title" style="position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center">
  <div class="ou-modal__backdrop"></div>
  <div class="ou-modal ou-modal--m">
    <div class="ou-modal__head"><div class="ou-modal__head-text"><p class="ou-modal__title" id="tb-sim-rules-title">${esc(rules.title)}</p>${rules.description ? `<p class="ou-modal__desc">${esc(rules.description)}</p>` : ""}</div></div>
    <div class="ou-modal__body"><ul class="ou-list--bulleted tb-sim-rules" style="margin:0;display:flex;flex-direction:column;gap:var(--ou-space-2)">${items}</ul></div>
    <div class="ou-modal__foot"><button type="button" class="ou-btn ou-btn--secondary ou-btn--m" data-action="sim-cancel">Отмена</button><button type="button" class="ou-btn ou-btn--primary ou-btn--m" data-action="sim-start"><span class="ou-btn__ico">${ICON_MAXIMIZE}</span><span>Старт</span></button></div>
  </div>
</div>`;
}
