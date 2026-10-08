/**
 * @module tests/sim-host-parity/passages
 * @description «Сценарий в ИС», техдолг №4: набор прохождений паритета (записка
 * `docs/handoff/HANDOFF-2026-10-08-sim-host-parity.md`, раздел 4) и язык их шагов (9.6).
 *
 * Шаг — ровно одно действие участника; заставки и страницы адаптер сам не пролистывает. Опорные
 * проверки (`check`) смотрят на снимок ПАКЕТА: паритет утверждает «одинаково», а они — «верно»,
 * иначе хосты, сломанные одинаково, дали бы зелёный тест.
 */
import type { FixtureOptions } from "./fixture";
import { T_A, T_B } from "./fixture";
import type { SimRunKind } from "../helpers/sim-runs";
import type { StepSnapshot, FinalSnapshot } from "./snapshot";
import type { KnownId } from "./known-divergences";

export type Step =
  | { do: "start" }
  | { do: "pick"; item: "A" | "B" | "SC1" | "SC2" }
  | { do: "next" }
  | { do: "answer"; qid: string; correct: boolean }
  | { do: "finishReview" }
  | { do: "sectionContinue" }
  | { do: "sim"; run: SimRunKind }
  | { do: "finish" }
  | { do: "reload" }
  | { do: "resume" }
  | { do: "check"; what: string; test: (pkg: StepSnapshot) => boolean }
  /** Meaning check on the PACKAGE's reported result; placed after the `finish` step. */
  | { do: "checkFinal"; what: string; test: (pkg: FinalSnapshot) => boolean };

export interface Passage {
  name: string;
  options: FixtureOptions;
  steps: Step[];
  /**
   * Divergences awaiting the owner's decision that this passage is expected to show
   * (`known-divergences.ts`). Every passage with a reload shows Г6; a reload inside a scenario run
   * shows N1.
   */
  known?: KnownId[];
}

/** A topic answered through: pick, both questions, the section-results screen when shown. */
function topic(item: "A" | "B", correct: boolean, sectionResults = true, review = false): Step[] {
  const [q1, q2] = item === "A" ? ["qa1", "qa2"] : ["qb1", "qb2"];
  return [
    { do: "pick", item },
    { do: "answer", qid: q1, correct },
    { do: "answer", qid: q2, correct },
    // «Менять ответ» opens the review screen before the section ends (PRD-19 block D).
    ...(review ? [{ do: "finishReview" } as Step] : []),
    ...(sectionResults ? [{ do: "sectionContinue" } as Step] : []),
  ];
}

const scenario = (run: SimRunKind, item: "SC1" | "SC2" = "SC1"): Step[] => [
  { do: "pick", item },
  { do: "sim", run },
];

/** Anchor on the package's report: the first scenario item (`scenario:scenario-1-N`). */
const scenarioResult = (what: string, test: (item: FinalSnapshot["items"][number]) => boolean): Step => ({
  do: "checkFinal",
  what,
  test: (f) => {
    const item = f.items.find((i) => i.key.startsWith("scenario:scenario-1"));
    return !!item && test(item);
  },
});

export function passages(): Passage[] {
  return [
    {
      name: "1. тема пройдена — зависимый сценарий открылся; перезагрузки в хабе и внутри темы",
      options: {},
      known: ["Г6"],
      steps: [
        { do: "start" },
        { do: "check", what: "сценарий 1 заперт до темы А", test: (p) => p.screen === "hub" && /scenario-1[^"]*"[^>]*data-router-locked="true"/.test(p.hub ?? "") },
        ...topic("A", true),
        { do: "check", what: "сценарий 1 открыт после успешной темы А", test: (p) => p.screen === "hub" && !/scenario-1[^"]*"[^>]*data-router-locked/.test(p.hub ?? "") },
        { do: "reload" },
        { do: "resume" },
        ...scenario("success"),
        { do: "pick", item: "B" },
        { do: "answer", qid: "qb1", correct: true },
        { do: "reload" },
        { do: "resume" },
        { do: "answer", qid: "qb2", correct: true },
        { do: "sectionContinue" },
        { do: "check", what: "«Завершить» доступна", test: (p) => p.footer?.finishEnabled === true },
        { do: "finish" },
      ],
    },
    {
      name: "2. тема провалена — сценарий «Недоступен», «Завершить» доступна",
      options: {},
      steps: [
        { do: "start" },
        ...topic("A", false),
        { do: "check", what: "сценарий 1 заперт после провала темы А", test: (p) => /scenario-1[^"]*"[^>]*data-router-locked="true"/.test(p.hub ?? "") },
        ...topic("B", true),
        { do: "check", what: "недостижимое не ждут: «Завершить» доступна", test: (p) => p.footer?.finishEnabled === true },
        { do: "finish" },
        { do: "checkFinal", what: "тема А провалена, тема Б пройдена", test: (f) => f.items[0]?.passed === false && f.items[2]?.passed === true },
      ],
    },
    ...(["success", "partial", "fail", "exited", "timeout"] as SimRunKind[]).map((run) => ({
      name: `3. сценарий: ${run}`,
      options: {},
      steps: [
        { do: "start" },
        ...topic("A", true),
        ...scenario(run),
        ...topic("B", true),
        { do: "finish" },
        run === "success"
          ? scenarioResult("полное выполнение засчитано целиком", (s) => s.earned === 1 && s.passed === true)
          : run === "partial"
            ? scenarioResult("частичное засчитано долей и ниже порога 80%", (s) => s.earned > 0 && s.earned < 1 && s.passed === false)
            : scenarioResult(`исход «${run}» не даёт баллов и не проходит порог`, (s) => s.earned === 0 && s.passed === false),
      ] as Step[],
    })),
    {
      name: "3. сценарий: partial при выключенном «Засчитывать частичное»",
      options: { countPartial: false },
      steps: [
        { do: "start" },
        ...topic("A", true),
        ...scenario("partial"),
        ...topic("B", true),
        { do: "finish" },
        scenarioResult("частичное не засчитано: ноль баллов", (s) => s.earned === 0 && s.passed === false),
      ],
    },
    {
      name: "4. повторный прогон: досрочный выход не затирает завершённый прогон",
      options: { allowAnswerChange: true },
      known: ["Г6"],
      steps: [
        { do: "start" },
        ...topic("A", true, true, true),
        ...scenario("success"),
        { do: "check", what: "завершённый сценарий отмечен в хабе", test: (p) => /scenario-1[^"]*"[^>]*data-router-status="completed"/.test(p.hub ?? "") },
        ...scenario("exited"),
        { do: "reload" },
        { do: "resume" },
        ...topic("B", true, true, true),
        { do: "finish" },
        scenarioResult("после досрочного выхода остался прежний успех", (s) => s.earned === 1 && s.passed === true),
      ],
    },
    {
      name: "4. повторный прогон: истечение времени затирает завершённый прогон",
      options: { allowAnswerChange: true },
      steps: [
        { do: "start" },
        ...topic("A", true, true, true),
        ...scenario("success"),
        ...scenario("timeout"),
        ...topic("B", true, true, true),
        { do: "finish" },
        scenarioResult("истечение времени затёрло прежний успех", (s) => s.earned === 0 && s.passed === false),
      ],
    },
    {
      name: "5. «все обязательные пройдены»: провал сценария окончательный",
      options: { completionPolicy: "all_required_passed" },
      steps: [
        { do: "start" },
        ...topic("A", true),
        ...scenario("fail"),
        ...topic("B", true),
        { do: "check", what: "окончательный провал не держит «Завершить»", test: (p) => p.footer?.finishEnabled === true },
        { do: "finish" },
      ],
    },
    {
      name: "5. «все обязательные пройдены»: провал сценария повторяемый",
      options: { completionPolicy: "all_required_passed", allowAnswerChange: true },
      known: ["Г6"],
      steps: [
        { do: "start" },
        ...topic("A", true, true, true),
        ...scenario("fail"),
        ...topic("B", true, true, true),
        { do: "check", what: "повторяемый провал держит «Завершить»", test: (p) => p.footer?.finishEnabled === false },
        { do: "reload" },
        { do: "resume" },
        ...scenario("success"),
        { do: "check", what: "после успешного повтора «Завершить» доступна", test: (p) => p.footer?.finishEnabled === true },
        { do: "finish" },
        scenarioResult("повтор исправил провал", (s) => s.earned === 1 && s.passed === true),
      ],
    },
    {
      name: "6. перезагрузка внутри сценария: прогон не засчитан, пункт запускается заново",
      options: {},
      known: ["Г6", "N1"],
      steps: [
        { do: "start" },
        ...topic("A", true),
        { do: "pick", item: "SC1" },
        { do: "reload" },
        { do: "resume" },
        { do: "check", what: "после перезагрузки внутри сценария пункт не завершён", test: (p) => !/scenario-1[^"]*"[^>]*data-router-status="completed"/.test(p.hub ?? "") },
        ...scenario("success"),
        ...topic("B", true),
        { do: "finish" },
        scenarioResult("после повторного запуска сценарий засчитан", (s) => s.earned === 1 && s.passed === true),
      ],
    },
    {
      name: "7. без экрана итогов раздела: исход пункта всё равно фиксируется",
      options: { showSectionResults: false },
      known: ["Г6"],
      steps: [
        { do: "start" },
        ...topic("A", false, false),
        { do: "check", what: "сценарий 1 заперт после провала темы А без экрана итогов", test: (p) => /scenario-1[^"]*"[^>]*data-router-locked="true"/.test(p.hub ?? "") },
        { do: "reload" },
        { do: "resume" },
        ...topic("B", true, false),
        { do: "finish" },
        { do: "checkFinal", what: "тема А провалена, тема Б пройдена", test: (f) => f.items[0]?.passed === false && f.items[2]?.passed === true },
      ],
    },
    {
      // The 2026-10-08 acceptance found «the last section» counted by DELIVERY order: the web promised
      // «Завершить тест» on the section-results screen of the topic last in delivery, though in a
      // router the hub always comes next. Only a TOPIC last in delivery, closed through its review
      // screen («Завершить раздел» — «менять ответ» puts it there), takes that path.
      name: "8. тема последняя в выдаче: после её итогов — хаб, а не завершение теста",
      options: { topicLast: true, allowAnswerChange: true },
      steps: [
        { do: "start" },
        ...topic("A", true, true, true),
        ...scenario("success"),
        { do: "pick", item: "B" },
        { do: "answer", qid: "qb1", correct: true },
        { do: "answer", qid: "qb2", correct: true },
        { do: "finishReview" },
        {
          do: "check",
          what: "итоги последней в выдаче темы ведут в хаб («Продолжить»), не завершают тест",
          test: (p) => p.screen === "section-results" && (p.sectionResult as { continueLabel?: string } | null)?.continueLabel === "Продолжить",
        },
        { do: "sectionContinue" },
        { do: "check", what: "после итогов темы — хаб", test: (p) => p.screen === "hub" },
        { do: "finish" },
      ],
    },
  ];
}

/** Key of an item in one fixture instance. */
export function keyOf(item: "A" | "B" | "SC1" | "SC2", sc1: string, sc2: string): string {
  return item === "A" ? T_A : item === "B" ? T_B : item === "SC1" ? sc1 : sc2;
}
