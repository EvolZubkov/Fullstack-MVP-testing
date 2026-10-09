import { describe, it, expect } from "vitest";
import { checkRuleSet, hasRules, type AnswerRuleSet } from "../shared/answer-check/rules";

const textSet = (join: "any" | "all", values: string[]): AnswerRuleSet => ({
  answerKind: "text",
  join,
  rules: values.map((value) => ({ kind: "text", match: "wildcard", value })),
});

describe("checkRuleSet — текст", () => {
  it("связка «любое» зачитывает по одному выполненному правилу", () => {
    const set = textSet("any", ["Ростехнадзор", "РТН"]);
    expect(checkRuleSet(set, "ртн")).toEqual({ passed: true, perRule: [false, true] });
  });

  it("связка «все» требует каждого", () => {
    const set = textSet("all", ["*надзор*", "*ростех*"]);
    expect(checkRuleSet(set, "ростехнадзор")).toEqual({ passed: true, perRule: [true, true] });
    expect(checkRuleSet(set, "госнадзор")).toEqual({ passed: false, perRule: [true, false] });
  });

  it("нормализует обе стороны", () => {
    const set = textSet("any", ["  Приём  "]);
    expect(checkRuleSet(set, "прием").passed).toBe(true);
  });

  it("подстановочный знак работает после нормализации", () => {
    const set = textSet("any", ["Федеральная служба по * надзору"]);
    const answer = "федеральная служба по экологическому, технологическому и атомному надзору";
    expect(checkRuleSet(set, answer).passed).toBe(true);
  });

  it("режим regex зачитывается с Э7", () => {
    const set: AnswerRuleSet = {
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "regex", value: "^рос" }],
    };
    expect(checkRuleSet(set, "ростехнадзор")).toEqual({ passed: true, perRule: [true] });
    expect(checkRuleSet(set, "надзор")).toEqual({ passed: false, perRule: [false] });
  });
});

describe("checkRuleSet — число", () => {
  const set: AnswerRuleSet = {
    answerKind: "number",
    join: "any",
    rules: [{ kind: "number", op: "eq", value: 3.14, tolerance: { unit: "abs", value: 0.01 } }],
  };

  it("зачитывает по допуску, а не по написанию", () => {
    expect(checkRuleSet(set, "3,14").passed).toBe(true);
    expect(checkRuleSet(set, "3.1416").passed).toBe(true);
    expect(checkRuleSet(set, "3,2").passed).toBe(false);
  });

  it("нечисловой ответ не выполняет ни одного правила", () => {
    expect(checkRuleSet(set, "около трёх")).toEqual({ passed: false, perRule: [false] });
  });
});

describe("пустой набор", () => {
  const empty: AnswerRuleSet = { answerKind: "text", join: "any", rules: [] };

  it("не зачитывает ничего", () => {
    expect(checkRuleSet(empty, "что угодно")).toEqual({ passed: false, perRule: [] });
  });

  it("распознаётся как отсутствие правил", () => {
    expect(hasRules(empty)).toBe(false);
    expect(hasRules(textSet("any", ["РТН"]))).toBe(true);
    expect(hasRules(null)).toBe(false);
    expect(hasRules({} as AnswerRuleSet)).toBe(false);
  });
});

describe("пустой ответ", () => {
  it("не зачитывается даже образцом из звезды", () => {
    expect(checkRuleSet(textSet("any", ["*"]), "").passed).toBe(false);
    expect(checkRuleSet(textSet("any", ["*"]), "   ").passed).toBe(false);
  });
});

describe("checkRuleSet — готовые вердикты выражений (Э7)", () => {
  const SET: AnswerRuleSet = {
    answerKind: "text",
    join: "any",
    rules: [
      { kind: "text", match: "regex", value: "^ростехнадзор$" },
      { kind: "text", match: "wildcard", value: "РТН" },
    ],
  };

  it("берёт готовый вердикт вместо того, чтобы исполнять выражение", () => {
    // Выражение НЕ подходит к ответу, но сервер уже посчитал его в рабочем потоке и
    // сказал «подошло» — набор обязан верить предпроходу, иначе бюджет ничего не значит.
    const outcome = checkRuleSet(SET, "совсем другое", [true, false]);
    expect(outcome.passed).toBe(true);
    expect(outcome.perRule).toEqual([true, false]);
  });

  it("без вердиктов считает выражение на месте", () => {
    expect(checkRuleSet(SET, "Ростехнадзор").passed).toBe(true);
    expect(checkRuleSet(SET, "Роспотребнадзор").passed).toBe(false);
  });

  it("превышенный бюджет — это «не проверено», а не «неверно»", () => {
    const outcome = checkRuleSet(SET, "что-то длинное", ["budget", false]);
    expect(outcome.passed).toBe(false);
    expect(outcome.pending).toBe(true);
  });

  it("другое сработавшее правило снимает неопределённость", () => {
    // Ответ подошёл обычному сравнению — исход известен, и ждать нечего.
    const outcome = checkRuleSet(SET, "РТН", ["budget", true]);
    expect(outcome.passed).toBe(true);
    expect(outcome.pending).toBeFalsy();
  });

  it("при связке «все» неудача другого правила тоже снимает неопределённость", () => {
    const all: AnswerRuleSet = { ...SET, join: "all" };
    const outcome = checkRuleSet(all, "РТН", ["budget", false]);
    expect(outcome.passed).toBe(false);
    expect(outcome.pending).toBeFalsy();
  });

  it("при связке «все» и остальных выполненных ответ ждёт проверки", () => {
    const all: AnswerRuleSet = { ...SET, join: "all" };
    const outcome = checkRuleSet(all, "РТН", ["budget", true]);
    expect(outcome.passed).toBe(false);
    expect(outcome.pending).toBe(true);
  });
});

describe("checkRuleSet — правило, помеченное медленным (Э7, защита пакета)", () => {
  const SLOW_SET: AnswerRuleSet = {
    answerKind: "text",
    join: "any",
    rules: [{ kind: "text", match: "regex", value: String.raw`^(\S+\s?)+ надзору$`, slow: true }],
  };

  it("там, где бюджета нет, медленное правило не исполняется вовсе", () => {
    // Пакет считает в основном потоке: прервать выражение там нечем, поэтому правило,
    // которое замер при сохранении уже назвал долгим, не запускается.
    const outcome = checkRuleSet(SLOW_SET, "федеральная служба по атомному надзору", undefined, {
      skipSlow: true,
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.pending).toBe(true);
  });

  it("там, где бюджет есть, правило считается как обычное", () => {
    const outcome = checkRuleSet(SLOW_SET, "федеральная служба по атомному надзору");
    expect(outcome.passed).toBe(true);
    expect(outcome.pending).toBeFalsy();
  });

  it("другое сработавшее правило важнее пропущенного", () => {
    const mixed: AnswerRuleSet = {
      answerKind: "text",
      join: "any",
      rules: [
        { kind: "text", match: "regex", value: String.raw`^(\S+\s?)+ надзору$`, slow: true },
        { kind: "text", match: "wildcard", value: "Ростехнадзор" },
      ],
    };
    const outcome = checkRuleSet(mixed, "ростехнадзор", undefined, { skipSlow: true });
    expect(outcome.passed).toBe(true);
    expect(outcome.pending).toBeFalsy();
  });
});
