/**
 * @module tests/sim-host-parity/snapshot
 * @description «Сценарий в ИС», техдолг №4: снимок хоста после шага прохождения и его сравнение
 * (записка `docs/handoff/HANDOFF-2026-10-08-sim-host-parity.md`, 9.7 и 9.8).
 *
 * Снимок собирается из НАБЛЮДАЕМОГО: что видит участник и что уходит наружу (тело хаба, кнопки
 * подвала, контекст экрана итогов раздела, параметры запуска плеера, ответ попытки, итог). Внутреннее
 * состояние веба живёт в React и снаружи недоступно, а сравнивать внутренности одного пакета —
 * несимметрично.
 *
 * Уровни:
 * - L0 выдача — вопросы по пунктам в порядке выдачи;
 * - L1 экран — `start` / `hub` / `content` / `question` / `section-results` / `scenario` / `other`;
 * - L2 тело хаба, байт в байт (оба хоста строят его одной функцией `buildRouterHubHtml`);
 * - L3 подвал хаба — подпись и доступность «Завершить», есть ли «Назад»;
 * - L4 итоги раздела — `sectionResult` контекста экрана (оба хоста строят его одной функцией);
 * - L5 запуск плеера — см. `player-double.ts`;
 * - L6 ответ на сценарий — сжатый прогон без протокола;
 * - L7 итог попытки — балл, вердикт и вердикты пунктов.
 */
import type { PackageHost } from "./package-host";
import type { WebHost } from "./web-host";
import type { PlayerDouble, PlayerMount } from "./player-double";

export type ScreenKind = "start" | "hub" | "content" | "question" | "section-results" | "review" | "scenario" | "results" | "other";

/** L1 – L4: what the participant sees after a step. */
export interface StepSnapshot {
  screen: ScreenKind;
  /** L1: the question on a question screen. */
  question: string | null;
  /** L2 */
  hub: string | null;
  /** L3 */
  footer: { finishLabel: string | null; finishEnabled: boolean; back: boolean } | null;
  /** L4 */
  sectionResult: unknown;
  /** The open player's mount (L5 is compared per mount elsewhere; anchors read it here). */
  mount: PlayerMount | null;
}

/**
 * L7: the attempt's outcome, in the units both hosts report. The overall score is a PERCENT: the
 * package sends the LMS `cmi.score.raw` of `cmi.score.max` = 100, the web stores points. Per-item
 * results stay in points (`cmi.objectives.n.score.*` carry them).
 */
export interface FinalSnapshot {
  percent: number;
  passed: boolean | null;
  items: Array<{ key: string; earned: number; possible: number; passed: boolean | null }>;
}

const PHASES: Record<string, ScreenKind> = {
  start: "start",
  content: "content",
  question: "question",
  sectionResults: "section-results",
  review: "review",
  router: "hub",
  results: "results",
};

const round = (n: number) => Math.round(n * 10000) / 10000;

export function packageStep(host: PackageHost, player: PlayerDouble): StepSnapshot {
  const doc = host.doc;
  const hubEl = doc.querySelector(".router-hub");
  const phase = String(host.state.phase);
  // `results` on both hosts means «the attempt is finished and reported»: the web leaves for the
  // result route after `/finish`, the package stays on its page but has sent the LMS its result
  // (`finishAndClose` sets `scormFinished`), whatever phase it is left in.
  const screen: ScreenKind = host.window.scormFinished === true
    ? "results"
    : player.active ? "scenario" : hubEl ? "hub" : PHASES[phase] ?? "other";
  let footer: StepSnapshot["footer"] = null;
  if (screen === "hub") {
    const buttons = [...doc.querySelectorAll("#app button")].filter((b) => !b.closest(".router-hub")) as HTMLButtonElement[];
    const finish = buttons.find((b) => /Завершить/.test(b.textContent || ""));
    const back = buttons.find((b) => /Назад/.test(b.textContent || ""));
    footer = {
      finishLabel: finish ? (finish.textContent || "").trim() : null,
      finishEnabled: !!finish && !finish.disabled,
      back: !!back && !back.disabled,
    };
  }
  const lastSection = [...host.rendered].reverse().find((c) => c && c.sectionResult);
  const fq = host.state.flatQuestions?.[host.state.currentIndex];
  return {
    screen,
    question: screen === "question" ? (fq?.question?.id ?? null) : null,
    hub: screen === "hub" ? normalizeHtml(hubEl!.innerHTML) : null,
    footer,
    sectionResult: screen === "section-results" ? (lastSection?.sectionResult ?? null) : null,
    mount: player.active ? (player.mounts[player.mounts.length - 1] ?? null) : null,
  };
}

export function webStep(web: WebHost, player: PlayerDouble): StepSnapshot {
  const s = web.screen;
  let screen: ScreenKind;
  // The page navigated to the result route: the scenario player of the page is gone with it,
  // though its double was never told (the test keeps the page mounted).
  if (s?.kind === "results") screen = "results";
  else if (player.active) screen = "scenario";
  else if (!s) screen = "other";
  else if (s.kind === "content") screen = s.props.bodyHtml ? "hub" : "content";
  else screen = s.kind as ScreenKind;
  return {
    screen,
    question: screen === "question" ? (s!.props.question?.id ?? null) : null,
    hub: screen === "hub" ? normalizeHtml(String(s!.props.bodyHtml)) : null,
    footer:
      screen === "hub"
        ? {
            finishLabel: s!.props.nextLabel ?? null,
            finishEnabled: !s!.props.nextDisabled,
            back: typeof s!.props.onBack === "function",
          }
        : null,
    sectionResult: screen === "section-results" ? (s!.props.context?.sectionResult ?? null) : null,
    mount: player.active ? (player.mounts[player.mounts.length - 1] ?? null) : null,
  };
}

/** L0 from the package: the delivered questions, item by item. */
export function packageDelivery(host: PackageHost): Array<[string, string]> {
  return (host.state.flatQuestions as Array<{ topicId: string; question: { id: string } }>).map((fq) => [fq.topicId, fq.question.id]);
}

/** L0 from the web: the variant the start route persisted. */
export function webDelivery(variant: { sections: Array<{ topicId: string; questionIds: string[] }> }): Array<[string, string]> {
  return variant.sections.flatMap((s) => s.questionIds.map((id) => [s.topicId, id] as [string, string]));
}

/** L6: a scenario answer, compacted by the PACKAGE's own `TBSimRun.compact`, protocol dropped. */
export function compactRun(host: PackageHost, answer: unknown): unknown {
  if (answer == null) return null;
  const c = host.window.TBSimRun.compact(answer);
  return JSON.parse(JSON.stringify(c));
}

/** L7 from the package: what it reported to the LMS. */
export function packageFinal(cmi: Record<string, string>): FinalSnapshot {
  const n = Number(cmi["cmi.objectives._count"] ?? 0) || Object.keys(cmi).filter((k) => /^cmi\.objectives\.\d+\.id$/.test(k)).length;
  const items: FinalSnapshot["items"] = [];
  for (let i = 0; i < n; i++) {
    const id = cmi[`cmi.objectives.${i}.id`] ?? "";
    if (!id.startsWith("topic_")) continue;
    const status = cmi[`cmi.objectives.${i}.success_status`];
    items.push({
      key: id.slice("topic_".length),
      earned: round(Number(cmi[`cmi.objectives.${i}.score.raw`] ?? 0)),
      possible: round(Number(cmi[`cmi.objectives.${i}.score.max`] ?? 0)),
      passed: status === "passed" ? true : status === "failed" ? false : null,
    });
  }
  const status = cmi["cmi.success_status"];
  return {
    percent: round(Number(cmi["cmi.score.raw"] ?? 0)),
    passed: status === "passed" ? true : status === "failed" ? false : null,
    items,
  };
}

/** L7 from the web: the result the server stored with the attempt. */
export function webFinal(result: any): FinalSnapshot {
  return {
    percent: result.totalPossiblePoints > 0 ? Math.round((result.totalEarnedPoints / result.totalPossiblePoints) * 100) : 0,
    passed: typeof result.overallPassed === "boolean" ? result.overallPassed : null,
    items: (result.topicResults as any[]).map((t) => ({
      key: t.topicId,
      earned: round(t.earnedPoints),
      possible: round(t.possiblePoints),
      passed: typeof t.passed === "boolean" ? t.passed : null,
    })),
  };
}

/**
 * Serialises a markup string the way a live DOM does (`innerHTML`): the package's hub is read back
 * from its DOM, the web's arrives as the raw string, and `disabled` vs `disabled=""` is not a
 * difference between hosts.
 */
export function normalizeHtml(html: string): string {
  const box = new DOMParser().parseFromString("<body></body>", "text/html").createElement("div");
  box.innerHTML = html;
  return box.innerHTML;
}

/** Per-card view of a hub body — what a failing L2 prints instead of two 3 KB strings. */
export function hubCards(html: string | null): string[] {
  if (!html) return [];
  const out: string[] = [];
  const re = /<button[^>]*data-topic-id="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = /^<button[^>]*>/.exec(m[0])![0];
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
    // The card's chips (question count, time limit, «Сценарий») — markup that attributes miss.
    const chips = [...m[2].matchAll(/router-topic-card__chip">([^<]*)</g)].map((c) => c[1]);
    out.push(
      `${m[1]} status=${attr("data-router-status")} locked=${attr("data-router-locked") || "false"} ` +
        `action=${attr("data-action") || "-"} disabled=${/\sdisabled(=|\s|>|$)/.test(tag)} chips=[${chips.join(", ")}]`,
    );
  }
  return out;
}
