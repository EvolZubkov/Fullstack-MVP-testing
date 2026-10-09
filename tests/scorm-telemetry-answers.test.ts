/**
 * @module tests/scorm-telemetry-answers
 *
 * PA-12f BRD психометрики: телеметрия получает ОДНУ строку на каждый выданный вопрос стандартной
 * попытки — тем же исходом, что уходит в балл и в отчёт LMS.
 *
 * Раньше строку слал только `confirmAnswer`. Фиксация через «Далее» (строгий режим с быстрым
 * переходом, PRD-43) не слала ничего, а пропущенный и неотвеченный вопрос строки не имели вовсе:
 * трудность по телеметрии расходилась с вебом и импортом на долю пропусков.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUNTIME = "server/scorm/template/app";
const feedbackSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/feedback/feedback.js`), "utf8");
const answersSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/actions/answers.js`), "utf8");

function extractTopLevel(src: string, name: string): string {
  const m = src.match(new RegExp(`^function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, "m"));
  if (!m) throw new Error(`${name} не найдена среди функций верхнего уровня`);
  return m[0];
}

interface Sent { questionId: string; isCorrect: boolean; userAnswer: unknown }

const QUESTIONS = [
  { id: "q1", type: "single", correct: { correctIndex: 0 } },
  { id: "q2", type: "single", correct: { correctIndex: 0 } },
  { id: "q3", type: "scale", correct: {} },
];

/** Песочница: три функции рантайма поверх заглушек всего, что они зовут. */
function makeRuntime(opts: { mode?: string; allowReturnToUnanswered?: boolean } = {}) {
  const sent: Sent[] = [];
  const state = {
    phase: "question",
    currentIndex: 0,
    answers: {} as Record<string, unknown>,
    questionStatuses: {} as Record<string, string>,
    flatQuestions: QUESTIONS.map((question) => ({ question, topicId: "t1", topicName: "Тема" })),
  };
  const TEST_DATA = { mode: opts.mode ?? "standard", allowReturnToUnanswered: opts.allowReturnToUnanswered ?? false };
  const api = new Function(
    "state", "TEST_DATA", "Telemetry", "TBQType", "checkAnswer", "gradedAnswerFor",
    "requireAnswerOrToast", "advanceAfterCommit",
    `${extractTopLevel(feedbackSrc, "reportAnswerTelemetry")}
     ${extractTopLevel(feedbackSrc, "reportPendingAnswerTelemetry")}
     ${extractTopLevel(answersSrc, "next")}
     return { next: next, pending: reportPendingAnswerTelemetry };`,
  )(
    state,
    TEST_DATA,
    { answer: (data: Sent) => sent.push(data) },
    {
      hasOptionList: () => true,
      isMeasurementOnly: (q: { type: string }) => q.type === "scale",
    },
    (q: { correct: { correctIndex?: number } }, answer: unknown) => (answer === q.correct.correctIndex ? 1 : 0),
    // Как в `resultsPage.js`: гибкий режим засчитывает только зафиксированное.
    (q: { id: string }) =>
      TEST_DATA.allowReturnToUnanswered && state.questionStatuses[q.id] !== "answered"
        ? undefined
        : state.answers[q.id],
    () => true,
    () => { state.currentIndex += 1; },
  ) as { next: () => void; pending: () => void };
  return { ...api, state, sent };
}

describe("PA-12f: строка ответа на каждую фиксацию", () => {
  it("«Далее» фиксирует ответ и отправляет его — в строгом режиме другой точки нет", () => {
    const rt = makeRuntime();
    rt.state.answers.q1 = 0;

    rt.next();

    expect(rt.sent).toEqual([expect.objectContaining({ questionId: "q1", isCorrect: true, userAnswer: 0 })]);
    expect(rt.state.questionStatuses.q1).toBe("answered");
  });

  it("уже зафиксированный вопрос «Далее» повторно не отправляет", () => {
    // После «Отправить ответ» строка уже ушла; «Далее» только переводит дальше.
    const rt = makeRuntime();
    rt.state.answers.q1 = 0;
    rt.state.questionStatuses.q1 = "answered";

    rt.next();

    expect(rt.sent).toHaveLength(0);
  });
});

describe("PA-12f: досылка при завершении", () => {
  it("неотвеченный оцениваемый вопрос уходит нулём, зафиксированный — не повторяется", () => {
    const rt = makeRuntime();
    rt.state.answers.q1 = 0;
    rt.state.questionStatuses.q1 = "answered";

    rt.pending();

    expect(rt.sent).toEqual([expect.objectContaining({ questionId: "q2", isCorrect: false, userAnswer: undefined })]);
  });

  it("гибкий режим: пропуск с черновиком уходит нулём, как в балле", () => {
    // Пропуск очищает черновик, а незафиксированный ответ гибкий режим не засчитывает.
    const rt = makeRuntime({ allowReturnToUnanswered: true });
    rt.state.answers.q2 = 0;
    rt.state.questionStatuses.q2 = "skipped";

    rt.pending();

    expect(rt.sent.find((s) => s.questionId === "q2")).toMatchObject({ isCorrect: false, userAnswer: undefined });
  });

  it("строгий режим: черновик при завершении засчитывается так же, как в балле", () => {
    const rt = makeRuntime();
    rt.state.answers.q2 = 0;

    rt.pending();

    expect(rt.sent.find((s) => s.questionId === "q2")).toMatchObject({ isCorrect: true, userAnswer: 0 });
  });

  it("измерительный вопрос без ответа не досылается", () => {
    const rt = makeRuntime();
    rt.pending();
    expect(rt.sent.map((s) => s.questionId)).not.toContain("q3");
  });

  it("адаптивный прогон досылки не делает", () => {
    // Невыданное уровнем там неотличимо от пропущенного, и ноль был бы выдумкой.
    const rt = makeRuntime({ mode: "adaptive" });
    rt.pending();
    expect(rt.sent).toHaveLength(0);
  });
});
