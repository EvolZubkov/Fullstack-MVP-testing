/**
 * @module tests/debug-player-reference
 * @description PRD-18 Phase 4 — the «Эталон» overlay (§5.4). Loads the REAL shared
 * compute IIFE (`inspector-compute.js`) into jsdom so `window.TBInspector` is the
 * production object, builds the revised «Стандартный» question DOM (the SAME markup
 * the SCORM render emits — `.ou-radio-card[data-index]`, `.ou-rank__item[data-item]`,
 * `.ou-match__card--fixed[data-drop]` / `--drag[data-drag]`) for the CURRENT question
 * (state.currentIndex) and asserts the
 * correct-answer markers land on the right elements: ✓ on correct options, the
 * correct ordinal on ranking items, paired letters on matching.
 *
 * Ranking and matching are also asserted against the REAL renderer output (imported
 * from `@shared/template/question-interaction`) with wording the typography pass
 * rewrites: hand-written fixtures of clean ASCII text are exactly what hid the
 * text-matching defect these two markers used to have.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderMatching, renderRanking } from "@shared/template/question-interaction";

interface ProtocolStatusRow { idx: number; status: string; answered: boolean }
interface ScoreSection { topicName: string; percent: number; passed: boolean | null; completed: boolean }
interface RefApi {
  applyReference(win: { document: Document; state: unknown } | null): void;
  clearReference(win: { document: Document } | null): void;
  readPkg(win: unknown): unknown;
  buildProtocolRows(pkg: unknown, cmi: Record<string, string>, mode: string): { rows: ProtocolStatusRow[] };
  buildScore(pkg: unknown): { available: boolean; sections?: ScoreSection[] };
}

beforeAll(() => {
  // Run the production IIFE — it installs window.TBInspector on the jsdom window.
  const src = fs.readFileSync(path.resolve("server/scorm/debug-player/assets/inspector-compute.js"), "utf8");
  new Function(src)();
});

function ref(): RefApi {
  return (window as unknown as { TBInspector: RefApi }).TBInspector;
}

beforeEach(() => { document.body.innerHTML = ""; });

function fakeWin(state: unknown) {
  return { document, state };
}

const marks = () => document.querySelectorAll('[data-tb-ref="1"]');

describe("Эталон overlay — applyReference", () => {
  it("marks the correct single/multiple options with ✓ (by data-index)", () => {
    document.body.innerHTML =
      '<label class="ou-radio-card" data-index="0"></label>' +
      '<label class="ou-radio-card" data-index="1"></label>' +
      '<label class="ou-radio-card" data-index="2"></label>';
    ref().applyReference(fakeWin({
      currentIndex: 0,
      flatQuestions: [{ question: { id: "q1", type: "single", correct: { correctIndex: 1 } } }],
    }));
    const all = marks();
    expect(all).toHaveLength(1);
    expect(all[0].textContent).toBe("✓");
    expect(all[0].closest(".ou-radio-card")?.getAttribute("data-index")).toBe("1");
  });

  it("marks every correct option for multiple choice", () => {
    document.body.innerHTML =
      '<label class="ou-radio-card" data-index="0"></label>' +
      '<label class="ou-radio-card" data-index="1"></label>' +
      '<label class="ou-radio-card" data-index="2"></label>';
    ref().applyReference(fakeWin({
      currentIndex: 0,
      flatQuestions: [{ question: { id: "q2", type: "multiple", correct: { correctIndices: [0, 2] } } }],
    }));
    expect(marks()).toHaveLength(2);
  });

  it("marks ranking items with their correct 1-based position (by data-item)", () => {
    // Rows displayed A,B,C; correct order is items [2,0,1] → A(0)→pos2, B(1)→pos3, C(2)→pos1.
    document.body.innerHTML =
      '<div class="ou-rank">' +
      '<div class="ou-rank__item" data-drag="0" data-item="0"><span class="ou-rank__title">A</span></div>' +
      '<div class="ou-rank__item" data-drag="1" data-item="1"><span class="ou-rank__title">B</span></div>' +
      '<div class="ou-rank__item" data-drag="2" data-item="2"><span class="ou-rank__title">C</span></div>' +
      "</div>";
    ref().applyReference(fakeWin({
      currentIndex: 0,
      flatQuestions: [{ question: { id: "q3", type: "ranking", data: { items: ["A", "B", "C"] }, correct: { correctOrder: [2, 0, 1] } } }],
    }));
    const m = Array.from(marks()).map((n) => [n.closest(".ou-rank__item")?.querySelector(".ou-rank__title")?.textContent, n.textContent]);
    expect(m).toEqual([["A", "2"], ["B", "3"], ["C", "1"]]);
  });

  it("marks ranking items on the REAL render, whose text went through the typography pass", () => {
    const items = [
      "Подключение абонента к сети",
      "Проверка качества связи на линии",
      "Передача заявки в отдел монтажа",
    ];
    document.body.innerHTML = renderRanking({ type: "ranking", dataJson: { items } }, null);
    ref().applyReference(fakeWin({
      currentIndex: 0,
      flatQuestions: [{ question: { id: "q6", type: "ranking", data: { items }, correct: { correctOrder: [2, 0, 1] } } }],
    }));
    expect(marks()).toHaveLength(3);
    // correctOrder [2,0,1] → item 0 goes 2nd, item 1 goes 3rd, item 2 goes 1st.
    const ordinals = Array.from(document.querySelectorAll<HTMLElement>(".ou-rank__item"))
      .map((row) => [row.getAttribute("data-item"), row.querySelector("[data-tb-ref]")?.textContent]);
    expect(ordinals).toEqual([["0", "2"], ["1", "3"], ["2", "1"]]);
  });

  it("marks matching pairs with the same letter on the fixed prompt and the chip", () => {
    // Both sides carry their index the way the render emits it: `data-drop="r<right>"`
    // on the prompt, `data-drag="<left>"` on the chip. The chips sit in a shuffled
    // order (1, 0), so a row-position match would pass by accident — the letters must
    // follow the indices.
    document.body.innerHTML =
      '<div class="ou-match">' +
      '<div class="ou-match__row"><div class="ou-match__card ou-match__card--fixed" data-drop="r0"><span class="ou-match__card-title">R0</span></div>' +
      '<div class="ou-match__card ou-match__card--drag" data-drag="1" data-drop="r0"><span class="ou-match__card-title">L1</span></div></div>' +
      '<div class="ou-match__row"><div class="ou-match__card ou-match__card--fixed" data-drop="r1"><span class="ou-match__card-title">R1</span></div>' +
      '<div class="ou-match__card ou-match__card--drag" data-drag="0" data-drop="r1"><span class="ou-match__card-title">L0</span></div></div>' +
      "</div>";
    // Correct: left 0 ↔ right 0 (letter A), left 1 ↔ right 1 (letter B).
    ref().applyReference(fakeWin({
      currentIndex: 0,
      flatQuestions: [{ question: { id: "q4", type: "matching", data: { left: ["L0", "L1"], right: ["R0", "R1"] }, correct: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] } } }],
    }));
    expect(marks()).toHaveLength(4); // 2 pairs × (fixed prompt + chip)
    const fixedR0 = Array.from(document.querySelectorAll<HTMLElement>(".ou-match__card--fixed"))
      .find((el) => el.querySelector(".ou-match__card-title")?.textContent === "R0");
    const chipL0 = Array.from(document.querySelectorAll<HTMLElement>(".ou-match__card--drag"))
      .find((el) => el.querySelector(".ou-match__card-title")?.textContent === "L0");
    expect(fixedR0?.querySelector("[data-tb-ref]")?.textContent).toBe("A");
    expect(chipL0?.querySelector("[data-tb-ref]")?.textContent).toBe("A");
  });

  it("marks matching pairs on the REAL render, whose text went through the typography pass", () => {
    // The render pipes every answer text through renderInlineMarkdown (markdown +
    // Russian typography): «в сеть» comes out with U+00A0, quotes become guillemets,
    // a newline becomes <br>. Matching the overlay by raw TEST_DATA text therefore
    // missed exactly the long prompts — the wording that carries short prepositions.
    const left = ["xDSL (Digital Subscriber Line)", "БШПД (Беспроводной широкополосный доступ)"];
    const right = [
      "Доступ в сеть Интернет через медную телефонную абонентскую линию связи",
      "Предоставление пользователям доступа в сеть без использования проводов",
    ];
    document.body.innerHTML = renderMatching({ type: "matching", dataJson: { left, right } }, {});
    ref().applyReference(fakeWin({
      currentIndex: 0,
      flatQuestions: [{
        question: {
          id: "q5",
          type: "matching",
          data: { left, right },
          correct: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] },
        },
      }],
    }));
    expect(marks()).toHaveLength(4); // 2 pairs × (fixed prompt + chip)
    const letterOf = (sel: string) =>
      document.querySelector<HTMLElement>(sel)?.querySelector("[data-tb-ref]")?.textContent;
    expect(letterOf('.ou-match__card--fixed[data-drop="r0"]')).toBe("A");
    expect(letterOf('.ou-match__card--drag[data-drag="0"]')).toBe("A");
    expect(letterOf('.ou-match__card--fixed[data-drop="r1"]')).toBe("B");
    expect(letterOf('.ou-match__card--drag[data-drag="1"]')).toBe("B");
  });

  it("is idempotent — re-applying does not stack markers", () => {
    document.body.innerHTML = '<label class="ou-radio-card" data-index="0"></label>';
    const win = fakeWin({ currentIndex: 0, flatQuestions: [{ question: { id: "q1", type: "single", correct: { correctIndex: 0 } } }] });
    ref().applyReference(win);
    ref().applyReference(win);
    expect(marks()).toHaveLength(1);
  });

  it("clearReference removes every marker", () => {
    document.body.innerHTML = '<label class="ou-radio-card" data-index="0"></label>';
    const win = fakeWin({ currentIndex: 0, flatQuestions: [{ question: { id: "q1", type: "single", correct: { correctIndex: 0 } } }] });
    ref().applyReference(win);
    expect(marks()).toHaveLength(1);
    ref().clearReference(win);
    expect(marks()).toHaveLength(0);
  });

  it("in adaptive mode keys off the question ON SCREEN, not flatQuestions[currentIndex]", () => {
    // Adaptive delivery drives the screen from adaptiveState (getCurrentAdaptiveQuestion);
    // the flat draw is a DIFFERENT question set. Keying the overlay off
    // flatQuestions[currentIndex] painted another question's answer key — a single-choice
    // key on a multiple-choice screen and vice versa.
    document.body.innerHTML =
      '<label class="ou-radio-card" data-index="0"></label>' +
      '<label class="ou-radio-card" data-index="1"></label>' +
      '<label class="ou-radio-card" data-index="2"></label>' +
      '<label class="ou-radio-card" data-index="3"></label>';
    const onScreen = { id: "qm", type: "multiple", correct: { correctIndices: [0, 3] } };
    const win = {
      document,
      // The package's own resolver — the same one the adaptive render calls.
      getCurrentAdaptiveQuestion: () => ({ id: "qm", question: onScreen }),
      state: {
        currentIndex: 0,
        adaptiveState: { isFinished: false, currentQuestionId: "qm" },
        // The flat draw holds an unrelated single-choice question at currentIndex.
        flatQuestions: [{ question: { id: "qs", type: "single", correct: { correctIndex: 1 } } }],
      },
    };
    ref().applyReference(win);
    const hit = Array.from(marks()).map((n) => n.closest(".ou-radio-card")?.getAttribute("data-index"));
    expect(hit).toEqual(["0", "3"]);
  });

  it("adaptive: resolves the on-screen question from TEST_DATA when the package resolver is unavailable", () => {
    document.body.innerHTML =
      '<label class="ou-radio-card" data-index="0"></label>' +
      '<label class="ou-radio-card" data-index="1"></label>';
    const win = {
      document,
      TEST_DATA: {
        mode: "adaptive",
        adaptiveTopics: [{ topicId: "T", questions: [{ id: "qm", type: "single", correct: { correctIndex: 1 } }] }],
      },
      state: {
        currentIndex: 0,
        adaptiveState: { isFinished: false, currentQuestionId: "qm" },
        flatQuestions: [{ question: { id: "qs", type: "multiple", correct: { correctIndices: [0, 1] } } }],
      },
    };
    ref().applyReference(win);
    const hit = Array.from(marks()).map((n) => n.closest(".ou-radio-card")?.getAttribute("data-index"));
    expect(hit).toEqual(["1"]);
  });

  it("adaptive: paints nothing when the on-screen question cannot be resolved (never a foreign key)", () => {
    document.body.innerHTML =
      '<label class="ou-radio-card" data-index="0"></label>' +
      '<label class="ou-radio-card" data-index="1"></label>';
    const win = {
      document,
      TEST_DATA: { mode: "adaptive", adaptiveTopics: [] },
      state: {
        currentIndex: 0,
        adaptiveState: { isFinished: false, currentQuestionId: "unknown" },
        flatQuestions: [{ question: { id: "qs", type: "multiple", correct: { correctIndices: [0, 1] } } }],
      },
    };
    ref().applyReference(win);
    expect(marks()).toHaveLength(0);
  });

  it("does NOT touch the DOM while a drag gesture is in flight (leaves the captured chip stable)", () => {
    // The shared DnD engine appends a `[data-drag-ghost]` card for the whole gesture.
    // Repainting the overlay then mutates the captured chip's subtree and Chromium
    // fires pointercancel, aborting the drag. So applyReference/clearReference must be
    // a no-op while the ghost exists.
    document.body.innerHTML =
      '<div class="ou-match__card ou-match__card--drag" data-drag="0" data-drag-ghost=""></div>';
    const win = fakeWin({
      currentIndex: 0,
      flatQuestions: [{ question: { id: "q4", type: "matching", data: { left: ["L0"], right: ["R0"] }, correct: { pairs: [{ left: 0, right: 0 }] } } }],
    });
    ref().applyReference(win);
    expect(marks()).toHaveLength(0); // overlay not painted during the drag

    // Once the gesture ends (ghost gone) the next tick paints normally.
    document.body.innerHTML =
      '<div class="ou-match"><div class="ou-match__row">' +
      '<div class="ou-match__card ou-match__card--fixed"><span class="ou-match__card-title">R0</span></div>' +
      '<div class="ou-match__card ou-match__card--drag" data-drag="0"><span class="ou-match__card-title">L0</span></div>' +
      "</div></div>";
    ref().applyReference(win);
    expect(marks().length).toBeGreaterThan(0);
  });
});

describe("Протокол — skip/return commit status (PRD-19 FR-24)", () => {
  // The live runtime status map drives the «Статус» column. It is distinct from
  // raw answer presence: q2 carries a draft (answers.q2) yet is 'skipped'.
  const win = {
    TEST_DATA: { mode: "standard" },
    state: {
      phase: "question",
      currentIndex: 3,
      flatQuestions: [
        { question: { id: "q1", type: "single", prompt: "A" }, topicName: "T" },
        { question: { id: "q2", type: "single", prompt: "B" }, topicName: "T" },
        { question: { id: "q3", type: "single", prompt: "C" }, topicName: "T" },
      ],
      answers: { q1: 0, q2: 1 },
      questionStatuses: { q1: "answered", q2: "skipped", q3: "unanswered" },
    },
  };

  it("reads each row's status from state.questionStatuses (skipped distinct from a draft)", () => {
    const pkg = ref().readPkg(win);
    const { rows } = ref().buildProtocolRows(pkg, {}, "live");
    expect(rows.map((r) => r.status)).toEqual(["answered", "skipped", "unanswered"]);
    // q2 has a draft answer (answered=true) but its commit status is 'skipped'.
    expect(rows[1].answered).toBe(true);
    expect(rows[1].status).toBe("skipped");
  });

  it("derives status from answer presence when no status map exists (past attempts / legacy)", () => {
    const legacy = { TEST_DATA: { mode: "standard" }, state: { ...win.state, questionStatuses: undefined } };
    const pkg = ref().readPkg(legacy);
    const { rows } = ref().buildProtocolRows(pkg, {}, "live");
    // q1/q2 carry an answer → 'answered'; q3 has none → 'unanswered'.
    expect(rows.map((r) => r.status)).toEqual(["answered", "answered", "unanswered"]);
  });
});

describe("Результаты по разделам — per-section completion (router_by_topics, N9)", () => {
  // calculateResults stub: topic A fully answered/passed, topic B untouched.
  const calculateResults = () => ({
    earnedPoints: 2, possiblePoints: 4, correct: 2, totalQuestions: 4, percent: 50, passed: false,
    topicResults: [
      { topicId: "A", topicName: "О компании", percent: 100, passed: true, correct: 2, total: 2, earnedPoints: 2, possiblePoints: 2 },
      { topicId: "B", topicName: "Право", percent: 0, passed: null, correct: 0, total: 2, earnedPoints: 0, possiblePoints: 2 },
    ],
  });
  // The bug scenario: learner finished topic A and returned to the router hub, so
  // currentIndex is FROZEN on A's last question (index 1) — the flat-index heuristic
  // would misread A as still «в процессе». routerTopicStates is the truth.
  const routerWin = {
    TEST_DATA: { mode: "standard", flowPolicy: { mode: "router_by_topics" } },
    calculateResults,
    state: {
      phase: "router",
      currentIndex: 1,
      flatQuestions: [
        { topicId: "A", question: { id: "a1" } },
        { topicId: "A", question: { id: "a2" } },
        { topicId: "B", question: { id: "b1" } },
        { topicId: "B", question: { id: "b2" } },
      ],
      routerTopicStates: { A: "completed" },
    },
  };

  it("marks a topic completed from routerTopicStates even when currentIndex sits on its last question", () => {
    const pkg = ref().readPkg(routerWin);
    const score = ref().buildScore(pkg);
    const a = score.sections!.find((s) => s.topicName === "О компании")!;
    const b = score.sections!.find((s) => s.topicName === "Право")!;
    expect(a.completed).toBe(true); // hub shows «Пройдена» → inspector must agree
    expect(a.passed).toBe(true);
    expect(b.completed).toBe(false); // not yet visited
  });

  it("linear flow keeps the flat-index heuristic (no routerTopicStates)", () => {
    const linearWin = {
      TEST_DATA: { mode: "standard", flowPolicy: { mode: "linear_by_topics" } },
      calculateResults,
      state: {
        phase: "question",
        currentIndex: 2, // moved past topic A into topic B
        flatQuestions: routerWin.state.flatQuestions,
      },
    };
    const score = ref().buildScore(ref().readPkg(linearWin));
    const a = score.sections!.find((s) => s.topicName === "О компании")!;
    const b = score.sections!.find((s) => s.topicName === "Право")!;
    expect(a.completed).toBe(true); // all of A's questions are behind currentIndex
    expect(b.completed).toBe(false); // still inside B
  });
});

// ─── PRD-24: выданный вариант и применённый порог в инспекторе ────────────────

describe("Инспектор: выданный вариант и порог, которым тема гейтилась", () => {
  const forms = [
    { id: "fA", label: "Вариант A", questionIds: ["a1", "a2"] },
    { id: "fB", label: "Вариант B", questionIds: ["a1", "a2"] }, // same questions on purpose
  ];
  const TEST_DATA = {
    mode: "standard",
    flowPolicy: { mode: "linear_by_topics" },
    sections: [{ topicId: "A", topicName: "О компании", questions: [{ id: "a1" }, { id: "a2" }], formSet: { forms } }],
  };
  const calculateResults = () => ({
    earnedPoints: 1, possiblePoints: 2, correct: 1, totalQuestions: 2, percent: 50, passed: false,
    topicResults: [{
      topicId: "A", topicName: "О компании", percent: 50, passed: false,
      correct: 1, total: 2, earnedPoints: 1, possiblePoints: 2,
      resolvedPassRule: { type: "percent", value: 100 },
    }],
  });
  const win = (formId?: string) => ({
    TEST_DATA,
    calculateResults,
    state: {
      phase: "test",
      currentIndex: 2,
      flatQuestions: [
        { topicId: "A", topicName: "О компании", question: { id: "a1", type: "single" } },
        { topicId: "A", topicName: "О компании", question: { id: "a2", type: "single" } },
      ],
      variant: { sections: [{ topicId: "A", topicName: "О компании", questionIds: ["a1", "a2"], ...(formId ? { formId } : {}) }] },
    },
  });

  it("берёт выданный вариант из пина, а не угадывает по набору вопросов", () => {
    // Both variants hold the same questions, so inference cannot tell them apart —
    // only the pin can. That is exactly the case PRD-24 has to get right.
    const draw = (ref() as unknown as { buildDraw(pkg: unknown): { sections: Array<{ formId: string | null; formIndex: number | null }> } })
      .buildDraw(ref().readPkg(win("fB")));
    expect(draw.sections[0].formId).toBe("fB");
    expect(draw.sections[0].formIndex).toBe(2);
  });

  it("для состояния без пина остаётся запасной путь — вывод по набору вопросов", () => {
    const draw = (ref() as unknown as { buildDraw(pkg: unknown): { sections: Array<{ formId: string | null }> } })
      .buildDraw(ref().readPkg(win()));
    expect(draw.sections[0].formId).toBe("fA"); // first matching set
  });

  it("показывает применённый порог и метку выданного варианта в результатах", () => {
    const score = ref().buildScore(ref().readPkg(win("fB"))) as unknown as {
      sections: Array<{ ruleLabel?: string; variantLabel?: string | null }>;
    };
    expect(score.sections[0].ruleLabel).toBe("≥ 100%");
    expect(score.sections[0].variantLabel).toBe("Вариант B");
  });
});
