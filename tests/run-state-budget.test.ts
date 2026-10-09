/**
 * @module tests/run-state-budget
 * @description PRD-36 §11 критерий 3: тест 60 вопросов / 10 тем / 5 шкал / 5 показателей /
 * 11 ключей разреза укладывается в 4096 символов С завершённой попыткой И прогоном в работе
 * одновременно. Порог проверяется ФАКТИЧЕСКИ, а не оценкой: состав задаёт автор, не разработчик,
 * и §6 спеки прямо требует мерить, а не прикидывать.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/runState.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${src}\nreturn TBRunState;`)() as any;

const SECTIONS = 10;
const PER_SECTION = 6; // 60 выданных вопросов
const KEYS = 11;

/** Позиции выдачи контрольного теста: по шесть вопросов из каждого из десяти разделов. */
const positions = Array.from({ length: SECTIONS * PER_SECTION }, (_, i) => ({
  s: Math.floor(i / PER_SECTION),
  q: i % PER_SECTION,
}));
const questions = positions.map(() => ({ type: "single" }));

function detail() {
  return {
    dl: RS.encodeDelivery(positions),
    an: RS.encodeAnswers(questions.map((_, i) => i % 4), questions),
    st: RS.encodeStatuses(questions.map(() => "answered")),
  };
}

function summary(withDetail = true): Record<string, unknown> {
  const s: Record<string, unknown> = {
    n: 3, at: "2026-08-15T10:22:03.000Z", src: "portal",
    pc: 78.5, c: 47, q: 60, e: 47, p: 60, ok: true,
    t: Array.from({ length: SECTIONS }, (_, i) => ({
      s: i, c: 5, q: 6, e: 5, p: 6, pc: 83.3, ok: true, f: "form-a", r: 70,
      bd: [{ k: i % KEYS, i: 6, a: 6, e: 4, p: 6, pp: 66.7, pu: 66.7 }],
    })),
    bd: Array.from({ length: KEYS }, (_, k) => ({ k, i: 6, a: 6, e: 4, p: 6, pp: 66.7, pu: 66.7 })),
    rv: { risk: 12, focus: 8, stress: 4, energy: 9, drive: 3 },
    sv: { E: 7, I: 5, S: 6, N: 4, T: 8 },
  };
  if (withDetail) s.d = detail();
  return s;
}

function fullState(): Record<string, unknown> {
  return {
    v: 2,
    fp: SECTIONS + ":" + Array.from({ length: SECTIONS }, () => 20).join(",") + ":" + KEYS,
    attemptsUsed: 3,
    best: summary(),
    last: 0,
    currentSession: {
      at: "2026-08-15T10:40:00.000Z", i: 27,
      dl: RS.encodeDelivery(positions),
      an: RS.encodeAnswers(questions.map((_, i) => i % 4), questions),
      st: RS.encodeStatuses(questions.map(() => "answered")),
      sh: RS.encodeShuffle(questions.map(() => [2, 0, 3, 1])),
      f: { t0: "form-a", t1: "form-b" }, fm: "linear_flat",
      rt: {}, sr: {}, rf: false, crt: null, cpi: 0, sc: {},
    },
    timer: { limitMinutes: 60, baselineTotalSec: 1800, sig: "1a2b3c" },
    retake: { lastCompletedDate: "2026-08-15" },
  };
}

describe("бюджет на контрольном тесте (§11 критерий 3)", () => {
  it("завершённая попытка и прогон в работе вместе умещаются в 4096", () => {
    const size = JSON.stringify(fullState()).length;
    // Размер печатается в сообщении, иначе падение теста говорит «не влезло», но не «насколько».
    expect({ size, budget: 4096, fits: size <= 4096 }).toEqual({ size, budget: 4096, fits: true });
  });

  it("состав контрольного состояния известен по частям, а не на глаз", () => {
    // Замер 2026-08-15. Числа зафиксированы как ХАРАКТЕРИСТИКА, а не как порог: они
    // показывают, где на самом деле лежит вес, и ловят его незаметный рост. Основной вес —
    // сводка (итоги по темам + записи разреза), ряды детализации стоят копейки.
    const d = detail();
    expect(d.dl.length).toBeLessThanOrEqual(260); // выдача 60 вопросов позициями
    expect(d.an.length).toBeLessThanOrEqual(140); // ответы
    expect(d.st.length).toBe(60); // статусы: ровно один символ на вопрос
    expect(JSON.stringify(summary(false)).length).toBeLessThanOrEqual(2200); // сводка
  });
});

describe("тест крупнее контрольного: порядок жертв (§6.2)", () => {
  /** 20 тем / 20 ключей / по 10 шкал и показателей — состояние заведомо больше бюджета. */
  function oversized(): Record<string, unknown> {
    const rv: Record<string, number> = {};
    const sv: Record<string, number> = {};
    for (let i = 0; i < 10; i++) { rv["v" + i] = 12; sv["s" + i] = 7; }
    const state = fullState();
    const best = state.best as Record<string, unknown>;
    best.t = Array.from({ length: 20 }, (_, i) => ({
      s: i, c: 5, q: 3, e: 5, p: 3, pc: 83.3, ok: true, f: "form-a", r: 70,
      bd: [{ k: i % 20, i: 3, a: 3, e: 2, p: 3, pp: 66.7, pu: 66.7 }],
    }));
    best.bd = Array.from({ length: 20 }, (_, k) => ({ k, i: 3, a: 3, e: 2, p: 3, pp: 66.7, pu: 66.7 }));
    best.rv = rv;
    best.sv = sv;
    return state;
  }

  it("состояние ужимается в бюджет, а не пишется как есть", () => {
    const before = JSON.stringify(oversized()).length;
    const fitted = RS.fitToBudget(oversized(), 4096);
    expect(before).toBeGreaterThan(4096);
    expect(JSON.stringify(fitted.state).length).toBeLessThanOrEqual(4096);
  });

  it("жертвы идут объявленным порядком и попадают в диагностику", () => {
    const fitted = RS.fitToBudget(oversized(), 4096);
    expect(fitted.sacrifices).toEqual(["best.detail", "session.shuffle", "best.summary"]);
  });

  it("прогон в работе, счётчик, таймер и кулдаун целы", () => {
    const fitted = RS.fitToBudget(oversized(), 4096);
    const session = fitted.state.currentSession;
    // Потеря этих рядов — потеря попытки прямо во время прохождения.
    expect(session.dl).toBeTruthy();
    expect(session.an).toBeTruthy();
    expect(session.st).toBeTruthy();
    expect(fitted.state.attemptsUsed).toBe(3);
    expect(fitted.state.timer.sig).toBe("1a2b3c");
    expect(fitted.state.retake.lastCompletedDate).toBe("2026-08-15");
  });

  it("от лучшей попытки остаются процент, вердикт и момент завершения", () => {
    const best = RS.fitToBudget(oversized(), 4096).state.best;
    expect(best).toEqual({ n: 3, at: "2026-08-15T10:22:03.000Z", src: "portal", pc: 78.5, ok: true });
  });
});

describe("размер не зависит от числа попыток (FR-11)", () => {
  it("состояние после 1, 5 и 50 попыток отличается только счётчиком", () => {
    const at = (n: number) => JSON.stringify({ v: 2, attemptsUsed: n, best: summary(), last: 0 }).length;
    const one = at(1), five = at(5), fifty = at(50);
    expect(five - one).toBe(0);
    expect(fifty - one).toBe(1); // «50» на один символ длиннее «1»
  });

  it("вторая сохранённая попытка не удваивает состояние", () => {
    const bestOnly = JSON.stringify({ v: 2, attemptsUsed: 1, best: summary(), last: 0 }).length;
    const bestAndLast = JSON.stringify({
      v: 2, attemptsUsed: 2, best: summary(), last: summary(false),
    }).length;
    // Последняя попытка стоит СВОДКИ без детализации, а не второго полного экземпляра.
    expect(bestAndLast - bestOnly).toBeLessThan(bestOnly);
  });
});

describe("в состоянии нет текстов пакета (§11 критерий 1)", () => {
  it("ни названия темы, ни ключа разреза, ни текста вопроса", () => {
    const raw = JSON.stringify(fullState());
    expect(raw).not.toContain("Тема");
    expect(raw).not.toContain("Ключ");
    expect(raw).not.toMatch(/[А-Яа-я]{4,}/); // кириллических слов в состоянии быть не должно
  });
});
