/**
 * @module tests/sim-engine
 * @description The scenario player's engine against the reference scenario of the contract
 * (`docs/specs/sim-scenario/example/scenario.json`): every outcome, trap, refusal, hint and
 * key the example demonstrates is played here exactly as a participant would.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRun, type SimRun } from "@shared/sim/engine";
import { appearSchedule, diffScenes } from "@shared/sim/diff";
import { boundsOf } from "@shared/sim/geometry";
import type { Scenario, Zone } from "@shared/sim/contract";

const scenario = JSON.parse(
  readFileSync(resolve(process.cwd(), "docs/specs/sim-scenario/example/scenario.json"), "utf8"),
) as Scenario;

function zone(id: string): Zone {
  for (const s of scenario.scenes) {
    const z = (s.zones ?? []).find((x) => x.id === id);
    if (z) return z;
  }
  throw new Error(`no zone ${id}`);
}

/** Click the centre of a zone the way the host would. */
function hit(run: SimRun, id: string, kind: "click" | "dblclick" = "click") {
  const b = boundsOf(zone(id));
  return run.click(b.x + b.w / 2, b.y + b.h / 2, kind);
}

function clock() {
  let now = 1000;
  return { now: () => now, tick: (ms: number) => { now += ms; } };
}

/** Walk the main path up to the filled card. */
function fillCard(run: SimRun, opts: { corr?: string; exec?: string } = {}) {
  hit(run, "home-inbox");
  hit(run, "list-create");
  hit(run, "form-corr");
  const corr = opts.corr ?? "dir-2";
  hit(run, corr);
  hit(run, `sel${corr.slice(4)}-choose`);
  run.commitField("num", "ВХ-1183");
  run.commitField("topic", "Запрос коммерческого предложения");
  hit(run, "form-exec");
  hit(run, opts.exec ?? "exec-1");
}

describe("основной путь", () => {
  it("доходит до цели с исходом success и всеми проверками", () => {
    const c = clock();
    const run = createRun(scenario, { now: c.now });
    fillCard(run);
    expect(run.scene().id).toBe("form");
    hit(run, "form-save-close");
    expect(run.scene().id).toBe("form-confirm");
    c.tick(90_000);
    hit(run, "confirm-ok");
    const r = run.result();
    expect(r.outcome).toBe("success");
    expect(r.goal?.share).toBe(1);
    expect(r.counts).toMatchObject({ misses: 0, blocked: 0, wrongValues: 0, detours: 0, traps: 0 });
    expect(r.durationMs).toBe(90_000);
    expect(r.fields).toMatchObject({ corr: "ООО «Ромашка»", exec: "Петрова А. В." });
  });
});

describe("исходы по проверкам цели", () => {
  it("неверный исполнитель — некритичная проверка: partial с долей по весам", () => {
    const run = createRun(scenario);
    fillCard(run, { exec: "exec-0" });
    hit(run, "form-save-close");
    hit(run, "confirm-ok");
    const r = run.result();
    expect(r.outcome).toBe("partial");
    expect(r.goal?.share).toBeCloseTo(4 / 5);
    expect(r.goal?.checks.find((c) => c.field === "exec")?.passed).toBe(false);
  });

  it("неверный корреспондент — критичная проверка: fail", () => {
    const run = createRun(scenario);
    fillCard(run, { corr: "dir-0" });
    hit(run, "form-save-close");
    hit(run, "confirm-ok");
    expect(run.result().outcome).toBe("fail");
  });
});

describe("ловушки", () => {
  it("«Удалить → Да» ведёт на сцену-провал и называет ошибку", () => {
    const run = createRun(scenario);
    hit(run, "home-inbox");
    hit(run, "list-delete");
    expect(run.scene().id).toBe("list-delete");
    const r1 = hit(run, "delete-yes");
    expect(r1).toEqual({ kind: "done", outcome: "fail" });
    const r = run.result();
    expect(r.goal?.scene).toBe("deleted");
    expect(r.traps).toHaveLength(1);
    expect(r.traps[0].error).toMatch(/Удалил/);
    expect(r.counts.traps).toBe(1);
    expect(run.done()).toBe(true);
  });

  it("«Отмена» в карточке — некритичная ловушка: данные теряются, сценарий идёт дальше", () => {
    const run = createRun(scenario);
    fillCard(run);
    hit(run, "form-cancel");
    expect(run.scene().id).toBe("list");
    expect(run.value("num")).toBe("");
    expect(run.done()).toBe(false);
    expect(run.result().counts.traps).toBe(1);
  });
});

describe("отказ системы и ошибки", () => {
  it("«Сохранить» с пустыми полями показывает сообщение и считается блокировкой", () => {
    const run = createRun(scenario);
    hit(run, "home-inbox");
    hit(run, "list-create");
    expect(run.isVisible("save-error")).toBe(false);
    const r = hit(run, "form-save-close");
    expect(r.kind).toBe("blocked");
    expect(run.isVisible("save-error")).toBe(true);
    expect(run.scene().id).toBe("form");
    run.expire("save-error");
    expect(run.isVisible("save-error")).toBe(false);
    expect(run.result().counts.blocked).toBe(1);
  });

  it("клик мимо открытого меню — ошибка и меню закрывается", () => {
    const run = createRun(scenario);
    hit(run, "home-inbox");
    hit(run, "list-file");
    expect(run.scene().id).toBe("list-menu");
    const r = run.click(1500, 1100);
    expect(r).toMatchObject({ kind: "miss", sceneChanged: true });
    expect(run.scene().id).toBe("list");
    expect(run.result().counts.misses).toBe(1);
  });

  it("неверный номер — ошибка значения, исправленный — верный", () => {
    const run = createRun(scenario);
    hit(run, "home-inbox");
    hit(run, "list-create");
    expect(run.commitField("num", "1183")).toEqual({ kind: "value", field: "num", correct: false });
    expect(run.isWrong("num")).toBe(true);
    expect(run.commitField("num", "вх 1183")).toEqual({ kind: "value", field: "num", correct: true });
    expect(run.result().counts.wrongValues).toBe(1);
  });

  it("щелчок выделяет строку справочника, «Выбрать» без выделения ничего не делает", () => {
    const run = createRun(scenario);
    hit(run, "home-inbox");
    hit(run, "list-create");
    hit(run, "form-corr");
    expect(hit(run, "dir-choose")).toEqual({ kind: "none" });
    hit(run, "dir-0");
    expect(run.scene().id).toBe("form-dir-sel-0");
    hit(run, "sel0-row-2");
    expect(run.scene().id).toBe("form-dir-sel-2");
    expect(run.value("corr")).toBe("");
    hit(run, "sel2-choose");
    expect(run.scene().id).toBe("form");
    expect(run.value("corr")).toBe("ООО «Ромашка»");
    expect(run.result().counts.misses).toBe(0);
  });

  it("двойной щелчок по строке выбирает её сразу: первый щелчок выделяет, второй не ошибка", () => {
    const run = createRun(scenario);
    hit(run, "home-inbox");
    hit(run, "list-create");
    hit(run, "form-corr");
    hit(run, "dir-2", "click");
    expect(hit(run, "sel2-pick", "click")).toEqual({ kind: "none" });
    hit(run, "sel2-pick", "dblclick");
    expect(run.scene().id).toBe("form");
    expect(run.value("corr")).toBe("ООО «Ромашка»");
    expect(run.result().counts.misses).toBe(0);
  });
});

describe("подсказка", () => {
  it("после трёх ошибок подряд на сцене указывает на зону основного пути", () => {
    const run = createRun(scenario);
    run.click(1800, 1150);
    run.click(1800, 1150);
    expect(run.hint()).toBeNull();
    run.click(1800, 1150);
    expect(run.hint()).toMatchObject({ target: "home-inbox" });
    hit(run, "home-inbox");
    expect(run.hint()).toBeNull();
    expect(run.result().counts.hints).toBe(1);
  });

  it("в карточке сначала указывает на незаполненное поле ввода", () => {
    const run = createRun(scenario);
    hit(run, "home-inbox");
    hit(run, "list-create");
    hit(run, "form-corr");
    hit(run, "dir-2");
  hit(run, "sel2-choose");
    for (let i = 0; i < 3; i += 1) run.click(1800, 1150);
    expect(run.hint()?.target).toBe("num");
  });
});

describe("клавиши и копирование", () => {
  it("Esc закрывает меню как действие в сторону, Ctrl+S в заполненной карточке сохраняет", () => {
    const run = createRun(scenario);
    hit(run, "home-inbox");
    hit(run, "list-file");
    expect(run.key("Escape")).toMatchObject({ kind: "action", role: "detour" });
    expect(run.scene().id).toBe("list");
    hit(run, "list-create");
    expect(run.key("Ctrl+S").kind).toBe("blocked");
    hit(run, "form-corr");
    hit(run, "dir-2");
  hit(run, "sel2-choose");
    run.commitField("num", "ВХ-1183");
    run.commitField("topic", "Запрос коммерческого предложения");
    hit(run, "form-exec");
    hit(run, "exec-1");
    run.key("Ctrl+S");
    expect(run.scene().id).toBe("form-confirm");
  });

  it("неописанное сочетание ничего не делает и ошибкой не считается", () => {
    const run = createRun(scenario);
    expect(run.key("Ctrl+P")).toEqual({ kind: "none" });
    expect(run.result().counts.misses).toBe(0);
  });

  it("копируемая зона: двойной щелчок выделяет, Ctrl+C отдаёт текст", () => {
    const run = createRun(scenario);
    hit(run, "home-inbox");
    expect(hit(run, "list-copy-number", "dblclick")).toEqual({ kind: "select", id: "list-copy-number", text: "ВХ-1182" });
    expect(run.key("Ctrl+C")).toEqual({ kind: "copy", text: "ВХ-1182" });
    expect(run.result().events.some((e) => e.type === "copy")).toBe(true);
  });
});

describe("досрочный выход и время", () => {
  it("выход и истечение лимита завершают прохождение без цели", () => {
    const a = createRun(scenario);
    expect(a.exit()).toEqual({ kind: "done", outcome: "exited" });
    expect(a.result().goal).toBeNull();
    const b = createRun(scenario);
    expect(b.timeout()).toEqual({ kind: "done", outcome: "timeout" });
    expect(b.click(10, 10)).toEqual({ kind: "none" });
  });
});

describe("результат", () => {
  it("носит формат и версию контракта и пишет вход на каждую сцену", () => {
    const run = createRun(scenario);
    hit(run, "home-inbox");
    const r = run.result();
    expect(r.format).toBe("skillum.sim-result");
    expect(r.version).toBe(1);
    expect(r.events.filter((e) => e.type === "enter").map((e) => (e as { scene: string }).scene)).toEqual(["home", "list"]);
  });
});

describe("разница сцен", () => {
  const media = new Map(scenario.media.map((m) => [m.id, m]));
  const scene = (id: string) => scenario.scenes.find((s) => s.id === id)!;

  it("открытие меню добавляет только меню, фон остаётся", () => {
    expect(diffScenes(scene("list"), scene("list-menu"), media)).toEqual({
      keep: ["bg"],
      add: [expect.objectContaining({ id: "menu" })],
      remove: [],
    });
  });

  it("переход на другой фон заменяет фон", () => {
    const d = diffScenes(scene("list"), scene("form"), media);
    expect(d.keep).toEqual([]);
    expect(d.remove).toEqual(["bg"]);
  });

  it("план появления: «после предыдущего» ждёт окончания проявления", () => {
    const plan = appearSchedule([
      { id: "a", media: "m", x: 0, y: 0, appear: { effect: "fade", durationMs: 150 } },
      { id: "b", media: "m", x: 0, y: 0, appear: { mode: "after-previous", effect: "fade", durationMs: 100 } },
      { id: "c", media: "m", x: 0, y: 0, appear: { mode: "with-previous", delayMs: 50 } },
    ]);
    expect(plan.get("a")).toEqual({ delayMs: 0, durationMs: 150, fade: true });
    expect(plan.get("b")).toEqual({ delayMs: 150, durationMs: 100, fade: true });
    expect(plan.get("c")).toEqual({ delayMs: 200, durationMs: 0, fade: false });
  });
});
