/**
 * @module tests/sim-cover
 * @description «Сценарий в ИС» в обычном разделе (техдолг №5): обложка вопроса-сценария и окно
 * правил (`shared/sim/cover.ts`) — по согласованному эскизу sim-scenario-learner.html.
 */
import { describe, it, expect } from "vitest";
import type { Scenario } from "@shared/sim/contract";
import { DEFAULT_SIM_PENALTIES } from "@shared/sim/scoring";
import { renderSimCover, renderSimRulesDialog, simCoverShot, simCoverState, simRules, simRunReplaces } from "@shared/sim/cover";
import example from "../docs/specs/sim-scenario/example/scenario.json";

const scenario = example as unknown as Scenario;

describe("состояние обложки", () => {
  it("читает исход и полного результата веба, и компактной ячейки пакета", () => {
    expect(simCoverState(undefined)).toBe("fresh");
    expect(simCoverState({ outcome: "success", events: [] })).toBe("done");
    expect(simCoverState({ outcome: "partial" })).toBe("done");
    expect(simCoverState({ outcome: "fail" })).toBe("done");
    expect(simCoverState({ outcome: "exited" })).toBe("exited");
    expect(simCoverState({ outcome: "timeout" })).toBe("timeout");
    expect(simCoverState("ответ")).toBe("fresh");
  });

  it("берёт изображение первой сцены", () => {
    expect(simCoverShot(scenario)).toBe("media/home.png");
    expect(simCoverShot(null)).toBeNull();
  });
});

describe("разметка обложки", () => {
  it("не начат — «Пройти» и подпись", () => {
    const html = renderSimCover({ state: "fresh", shotUrl: "media/home.png", retake: false });
    expect(html).toContain('data-action="sim-open"');
    expect(html).toContain("Пройти");
    expect(html).toContain("Задание выполняется на весь экран");
    expect(html).toContain('src="media/home.png"');
  });

  it("завершён — значок в тоне исхода и заголовок; «Пройти заново» только по праву менять ответ", () => {
    const done = renderSimCover({ state: "done", shotUrl: null, retake: false });
    expect(done).toContain("ou-iconbadge--success");
    expect(done).toContain("Задание выполнено");
    expect(done).not.toContain("sim-open");
    expect(renderSimCover({ state: "done", shotUrl: null, retake: true })).toContain("Пройти заново");
    expect(renderSimCover({ state: "exited", shotUrl: null, retake: false })).toContain("Выход досрочно: задание не выполнено");
    expect(renderSimCover({ state: "timeout", shotUrl: null, retake: false })).toContain("ou-iconbadge--warning");
  });

  it("только чтение — без кнопок", () => {
    expect(renderSimCover({ state: "fresh", shotUrl: null, retake: true, readonly: true })).not.toContain("<button");
    expect(renderSimCover({ state: "done", shotUrl: null, retake: true, readonly: true })).not.toContain("<button");
  });

  it("экранирует адрес изображения", () => {
    expect(renderSimCover({ state: "fresh", shotUrl: 'a"b', retake: false })).toContain('src="a&quot;b"');
  });
});

describe("окно правил", () => {
  it("говорит только правду: лимит, ненулевые штрафы, подсказки", () => {
    const rules = simRules(
      { ...scenario, settings: { limitSeconds: 300, hints: { enabled: true, afterMisses: 3 } } },
      { ...DEFAULT_SIM_PENALTIES, miss: 0.02, wrongValue: 0.1, blocked: 0, detour: 0, trap: 0, hint: 0.05 },
    );
    expect(rules.title).toBe("Практическое задание");
    expect(rules.items).toContain("На задание отводится 5 минут. Таймер — на панели над окном системы; когда время выйдет, задание завершится.");
    expect(rules.items).toContain("Балл снижают: щелчки мимо действий экрана; неверные значения в полях.");
    expect(rules.items).toContain("После 3 ошибок на одном шаге появится подсказка. Подсказка тоже снижает балл.");
    expect(rules.items.at(-1)).toContain("Выйти досрочно");
  });

  it("без лимита, без штрафов и без подсказок — этих строк нет", () => {
    const zero = { miss: 0, blocked: 0, wrongValue: 0, detour: 0, trap: 0, hint: 0 };
    const rules = simRules({ ...scenario, settings: {} }, zero);
    expect(rules.items).toHaveLength(2);
    expect(simRules({ ...scenario, settings: {} }, null).items).toHaveLength(2);
  });

  it("диалог пакета — модальное окно ДС с «Отмена» и «Старт»", () => {
    const html = renderSimRulesDialog(simRules(scenario, null));
    expect(html).toContain("ou-modal");
    expect(html).toContain('data-action="sim-cancel"');
    expect(html).toContain('data-action="sim-start"');
  });
});

describe("какой прогон остаётся (техдолг №7)", () => {
  it("досрочный выход из повтора не затирает завершённый прогон; время вышло — затирает", () => {
    expect(simRunReplaces({ outcome: "success" }, { outcome: "exited" })).toBe(false);
    expect(simRunReplaces({ outcome: "fail" }, { outcome: "exited" })).toBe(false);
    expect(simRunReplaces({ outcome: "timeout" }, { outcome: "exited" })).toBe(false);
    expect(simRunReplaces({ outcome: "success" }, { outcome: "timeout" })).toBe(true);
    expect(simRunReplaces({ outcome: "success" }, { outcome: "partial" })).toBe(true);
  });

  it("если завершённого не было, записывается любой прогон", () => {
    expect(simRunReplaces(undefined, { outcome: "exited" })).toBe(true);
    expect(simRunReplaces({ outcome: "exited" }, { outcome: "exited" })).toBe(true);
  });
});
