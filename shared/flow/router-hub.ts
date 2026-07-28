/**
 * @module shared/flow/router-hub
 *
 * The `router_by_topics` hub: which sections are open, when the run may finish,
 * and the hub's markup — shared by both learner hosts.
 *
 * The hub is a navigation screen, not a content page: it renders through the
 * design template's content wrapper, but its body is a set of section cards built
 * here. Keeping the RULES (unlock, completion policy) and the MARKUP in one place
 * is what stops the two hosts from disagreeing about whether a section is open —
 * a disagreement a learner would experience as a card that works in the LMS and
 * is dead on the web, or the reverse.
 *
 * Framework-free and browser-safe: bundled verbatim into the SCORM package.
 */

/** Per-section state as the run progresses. */
export type RouterTopicStatus = "notStarted" | "inProgress" | "completed";

export interface RouterSection {
  topicId: string;
  topicName?: string | null;
  /** `false` marks an optional section — it never blocks completion. */
  required?: boolean;
  drawCount?: number | null;
  timeLimitMinutes?: number | null;
  image?: string | { url?: string } | null;
}

/** A frozen section result, as far as the hub cares about it. */
export interface RouterSectionResult {
  passed?: boolean | null;
}

export interface SectionUnlockRule {
  mode?: "always" | "after_sections_completed" | "after_sections_passed" | string;
  sectionIds?: string[];
}

export interface RouterHubState {
  topicStates: Record<string, RouterTopicStatus | undefined>;
  sectionResults?: Record<string, RouterSectionResult | undefined>;
  unlockRules?: Record<string, SectionUnlockRule | undefined>;
  /** `all_required_completed` (default) | `all_required_passed`. */
  completionPolicy?: string | null;
}

function escHtml(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Russian plural for «вопрос». */
export function pluralQuestions(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "вопрос";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "вопроса";
  return "вопросов";
}

/**
 * Whether `section` is open given what the learner has completed.
 *
 * Unknown rule modes fail OPEN: a malformed or newer rule must not lock a learner
 * out of a section they are entitled to take.
 */
export function isSectionUnlocked(section: RouterSection, state: RouterHubState): boolean {
  const rule = (state.unlockRules || {})[section.topicId];
  if (!rule || !rule.mode || rule.mode === "always") return true;
  const ids = rule.sectionIds || [];
  if (rule.mode === "after_sections_completed") {
    return ids.every((id) => state.topicStates[id] === "completed");
  }
  if (rule.mode === "after_sections_passed") {
    return ids.every((id) => {
      if (state.topicStates[id] !== "completed") return false;
      const result = (state.sectionResults || {})[id];
      // A section with no pass rule reports `passed: null`; treat that as passed
      // for navigation — it cannot be failed, so it cannot block.
      return !result || result.passed !== false;
    });
  }
  return true;
}

/** Whether «Завершить» may be offered. Optional sections never block. */
export function isRouterReadyToFinish(
  sections: RouterSection[] | null | undefined,
  state: RouterHubState,
): boolean {
  const policy = state.completionPolicy || "all_required_completed";
  const required = (sections || []).filter((s) => s.required !== false);
  if (required.length === 0) return true;
  return required.every((s) => {
    if (state.topicStates[s.topicId] !== "completed") return false;
    if (policy === "all_required_passed") {
      const result = (state.sectionResults || {})[s.topicId];
      // No result under the strict policy means «not demonstrably passed».
      if (!result) return false;
      return result.passed === true;
    }
    return true;
  });
}

export function statusLabel(status: RouterTopicStatus): string {
  if (status === "completed") return "Пройдена";
  if (status === "inProgress") return "В процессе";
  return "Не начата";
}

/**
 * Builds the hub body: optional deadline stats, the required-sections progress
 * bar, and the section cards.
 *
 * Card actions are emitted as `data-action="router-select:<topicId>"` so either
 * host binds them by delegation. «Завершить» is NOT part of this body: it lives in
 * the layout's standard footer (nav slot), gated by `page.nextDisabled` until the
 * completion policy is met — see {@link isRouterReadyToFinish} and the hosts' wiring.
 */
export function buildRouterHubHtml(
  sections: RouterSection[] | null | undefined,
  state: RouterHubState,
  options?: { deadline?: { date?: string | null; time?: string | null } | null },
): string {
  const list = sections || [];
  let html = "";

  const deadline = options?.deadline;
  if (deadline && (deadline.date || deadline.time)) {
    let stats = "";
    if (deadline.date) {
      stats +=
        '<div class="router-stat"><span class="router-stat__label">Дата завершения теста</span>' +
        '<span class="router-stat__value">' + escHtml(deadline.date) + "</span></div>";
    }
    if (deadline.time) {
      stats +=
        '<div class="router-stat"><span class="router-stat__label">Время завершения теста</span>' +
        '<span class="router-stat__value">' + escHtml(deadline.time) + "</span></div>";
    }
    html += '<div class="router-stats">' + stats + "</div>";
  }

  // Progress counts REQUIRED sections only — they are what gates «Завершить».
  const required = list.filter((s) => s.required !== false);
  if (required.length > 0) {
    const done = required.filter((s) => state.topicStates[s.topicId] === "completed").length;
    const pct = Math.round((done / required.length) * 100);
    html +=
      '<div class="router-progress" role="group" aria-label="Прогресс по разделам">' +
      '<div class="router-progress__head">' +
      '<span class="router-progress__label">Разделы</span>' +
      '<span class="router-progress__count">' + done + " / " + required.length + "</span>" +
      "</div>" +
      '<div class="router-progress__bar"><div class="router-progress__fill" style="width:' + pct + '%"></div></div>' +
      "</div>";
  }

  let cards = "";
  for (const section of list) {
    const status: RouterTopicStatus = state.topicStates[section.topicId] || "notStarted";
    const unlocked = isSectionUnlocked(section, state);
    const locked = !unlocked && status !== "completed";
    // Completed cards stay disabled to prevent re-entry; locked ones because their
    // prerequisites are not met yet.
    const disabled = status === "completed" || !unlocked;

    const meta: string[] = [];
    if (section.drawCount) meta.push(section.drawCount + " " + pluralQuestions(section.drawCount));
    if (section.timeLimitMinutes) meta.push(section.timeLimitMinutes + " мин");
    const metaHtml = meta.length
      ? '<span class="router-topic-card__meta">' +
        meta.map((m) => '<span class="router-topic-card__chip">' + escHtml(m) + "</span>").join("") +
        "</span>"
      : "";

    const imgUrl =
      section.image && typeof section.image === "object"
        ? section.image.url || ""
        : (section.image as string) || "";
    const imgHtml = imgUrl
      ? '<span class="router-topic-card__img"><img src="' + escHtml(imgUrl) + '" alt=""></span>'
      : "";
    const goHtml =
      unlocked && status !== "completed" ? '<span class="router-topic-card__go">начать</span>' : "";

    cards +=
      '<button type="button" role="listitem"' +
      ' class="router-topic-card router-topic-card--' + status + (locked ? " router-topic-card--locked" : "") + '"' +
      ' data-topic-id="' + escHtml(section.topicId) + '"' +
      ' data-router-status="' + status + '"' +
      (locked ? ' data-router-locked="true"' : "") +
      (disabled ? " disabled" : ' data-action="router-select:' + escHtml(section.topicId) + '"') +
      ">" +
      '<span class="router-topic-card__top">' +
      '<span class="router-topic-card__name">' +
      escHtml(section.topicName || section.topicId) +
      (section.required === false
        ? ' <span class="router-topic-card__optional">(необязательная)</span>'
        : "") +
      "</span>" +
      imgHtml +
      "</span>" +
      metaHtml +
      '<span class="router-topic-card__foot">' +
      '<span class="router-topic-card__status">' +
      escHtml(unlocked ? statusLabel(status) : "Недоступна") +
      "</span>" +
      goHtml +
      "</span>" +
      "</button>";
  }
  html +=
    '<div class="router-topic-cards" role="list" aria-label="Доступные темы">' + cards + "</div>";

  // «Завершить» is NOT emitted here: it lives in the layout's standard footer, in
  // the usual navigation slot (bottom-right primary), gated by `page.nextDisabled`
  // until the completion policy is met — see the hosts' hub wiring.
  return html;
}
