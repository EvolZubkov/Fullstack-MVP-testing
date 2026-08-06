// @vitest-environment jsdom
/**
 * @module shared/template/scene-timers.test
 * @description Отрисовка таймеров шапки — общая для веб-хоста и SCORM-пакета
 * (PRD-12). Проверяется контракт, на который опираются оба: элементы макета
 * `#timer-display` / `#section-timer-display`, снятие `q-timer--hidden`, формат
 * `M:SS` в `.ou-timer__num` и признак `is-critical`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { paintSceneTimers, formatTimerValue, TIMER_WARN_AT } from "./scene-timers";

function scene(): HTMLElement {
  document.body.innerHTML = `
    <div class="tb-scene__timers">
      <div class="ou-timer q-timer--hidden" id="timer-display">
        <span class="ou-timer__lbl">тест</span><span class="ou-timer__num"></span>
      </div>
      <div class="ou-timer q-timer--hidden" id="section-timer-display">
        <span class="ou-timer__lbl">раздел</span><span class="ou-timer__num"></span>
      </div>
    </div>`;
  return document.body;
}

const testTimer = () => document.getElementById("timer-display")!;
const sectionTimer = () => document.getElementById("section-timer-display")!;
const num = (el: HTMLElement) => el.querySelector(".ou-timer__num")!.textContent;

beforeEach(() => { scene(); });

describe("formatTimerValue", () => {
  it("печатает M:SS и не уходит в минус", () => {
    expect(formatTimerValue(591)).toBe("9:51");
    expect(formatTimerValue(60)).toBe("1:00");
    expect(formatTimerValue(5)).toBe("0:05");
    expect(formatTimerValue(-3)).toBe("0:00");
  });
});

describe("paintSceneTimers", () => {
  it("показывает и заполняет идущий отсчёт", () => {
    paintSceneTimers(document.body, { sectionSeconds: 591 });
    expect(sectionTimer().classList.contains("q-timer--hidden")).toBe(false);
    expect(num(sectionTimer())).toBe("9:51");
  });

  it("оставляет скрытым отсчёт, который не идёт", () => {
    paintSceneTimers(document.body, { sectionSeconds: 591 });
    expect(testTimer().classList.contains("q-timer--hidden")).toBe(true);
  });

  it("помечает критическим последнюю минуту и снимает пометку выше порога", () => {
    paintSceneTimers(document.body, { testSeconds: TIMER_WARN_AT });
    expect(testTimer().classList.contains("is-critical")).toBe(true);
    paintSceneTimers(document.body, { testSeconds: TIMER_WARN_AT + 1 });
    expect(testTimer().classList.contains("is-critical")).toBe(false);
  });

  it("прячет отсчёт обратно, когда он выключается", () => {
    paintSceneTimers(document.body, { sectionSeconds: 30 });
    paintSceneTimers(document.body, { sectionSeconds: null });
    expect(sectionTimer().classList.contains("q-timer--hidden")).toBe(true);
  });

  it("без разметки таймеров ничего не делает", () => {
    document.body.innerHTML = "<div></div>";
    expect(() => paintSceneTimers(document.body, { testSeconds: 10 })).not.toThrow();
  });
});
