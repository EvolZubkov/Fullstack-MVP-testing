/**
 * @module shared/sim/player
 *
 * The DOM player of a scenario: draws the run of `shared/sim/engine` and feeds it what the
 * participant does. Framework-free, so the same file serves the dev player page, the web
 * host and the SCORM package.
 *
 * Layout: a bar on top (task, optional counters, the task timer, «Выйти досрочно») and the
 * stage under it, scaled to fit the remaining area. The bar never overlaps the stage — nothing
 * on the screenshot can be hidden by the player's own controls.
 *
 * Drawing follows `shared/sim/diff`: moving between scenes keeps the DOM nodes of elements that
 * stay, removes the gone ones and adds the new ones with their `appear`. Field inputs persist
 * per field across scenes, so typing is never interrupted by a redraw.
 *
 * Fullscreen is the host's business: the host requests it on the element it mounts the player
 * into (it needs the participant's click), the player only fills its container.
 */
import { createRun, type Reaction, type SimRun } from "./engine";
import { appearSchedule, diffScenes, elementBox } from "./diff";
import { boundsOf, radiusOf, svgPoints, type ZoneShape } from "./geometry";
import type { FieldPlacement, MediaItem, Outcome, Scenario, Scene, SimResult } from "./contract";

/** Options of a mounted player. */
export interface PlayerOptions {
  scenario: Scenario;
  /** URL of a media file given its path inside the archive (`media/x.png`). */
  mediaUrl: (file: string) => string;
  /** Called once when the run ends, before the result dialog shows. */
  onFinish?: (result: SimResult) => void;
  /** Called when the participant closes the result dialog. */
  onClose?: (result: SimResult) => void;
  /** Show time, errors and hints in the result dialog (the test's result policy decides). */
  showDetails?: boolean;
  /** Caption above the task text, e.g. «Задание · вопрос 4 из 12». */
  caption?: string;
}

/** A mounted player. */
export interface MountedPlayer {
  run: SimRun;
  destroy(): void;
}

const CSS = `
.tbsim{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--tbsim-bg,#eef0f3);color:var(--tbsim-fg,#16181d);font:14px/1.4 var(--tbsim-font,-apple-system,"Segoe UI",Roboto,Arial,sans-serif);user-select:none}
.tbsim__bar{flex:none;display:flex;align-items:center;gap:16px;padding:12px 24px;background:var(--tbsim-bar,#fff);border-bottom:1px solid #dfe3e8}
.tbsim__task{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.tbsim__cap{font-size:12px;color:#5b6270}
.tbsim__counters{display:flex;gap:16px;color:#5b6270;white-space:nowrap}
.tbsim__counters b{color:#16181d;font-variant-numeric:tabular-nums}
.tbsim__timer{display:flex;flex-direction:column;align-items:flex-end;font-size:12px;color:#5b6270}
.tbsim__timer b{font-size:22px;line-height:1;color:var(--tbsim-accent,#6b2bd9);font-variant-numeric:tabular-nums}
.tbsim__timer.is-warning b{color:#b3261e}
.tbsim__btn{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #c9ced6;background:#fff;color:#16181d;cursor:pointer;white-space:nowrap}
.tbsim__btn--primary{background:var(--tbsim-accent,#6b2bd9);border-color:var(--tbsim-accent,#6b2bd9);color:#fff}
.tbsim__btn--danger{background:#b3261e;border-color:#b3261e;color:#fff}
.tbsim__wrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px;overflow:hidden}
.tbsim__frame{position:relative;flex:none;box-shadow:0 2px 12px rgba(0,0,0,.12)}
.tbsim__canvas{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;background:#fff}
.tbsim__el{position:absolute;display:block;pointer-events:none;-webkit-user-drag:none}
.tbsim__val{position:absolute;box-sizing:border-box;display:flex;align-items:center;padding:0 12px;pointer-events:none;color:#16181d;white-space:nowrap;overflow:hidden}
.tbsim__input{position:absolute;box-sizing:border-box;margin:0;padding:0 12px;border:3px solid var(--tbsim-accent,#6b2bd9);border-radius:6px;background:#fff;color:#16181d;outline:none;user-select:text}
.tbsim__input.is-wrong{border-color:#b3261e;box-shadow:0 0 0 6px rgba(179,38,30,.2)}
.tbsim__miss{position:absolute;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;border:4px solid #b3261e;background:rgba(179,38,30,.18);pointer-events:none;animation:tbsim-miss .6s ease-out forwards}
@keyframes tbsim-miss{from{opacity:1;transform:scale(.6)}to{opacity:0;transform:scale(1.4)}}
.tbsim__hintbox{position:absolute;box-sizing:border-box;border:4px solid #d99a00;border-radius:8px;background:rgba(217,154,0,.18);box-shadow:0 0 0 8px rgba(217,154,0,.25);pointer-events:none}
.tbsim__hint{position:absolute;max-width:520px;padding:16px 20px;border-radius:12px;background:#fff;box-shadow:0 8px 28px rgba(0,0,0,.2);pointer-events:none}
.tbsim__hint b{display:block;margin-bottom:6px}
.tbsim__sel{position:absolute;background:rgba(40,110,255,.28);pointer-events:none}
.tbsim__shape{position:absolute;inset:0;overflow:visible}
.tbsim__hintbox.is-poly,.tbsim__sel.is-poly{border:0;border-radius:0;background:none;box-shadow:none}
.tbsim__hintbox polygon{fill:rgba(217,154,0,.18);stroke:#d99a00;stroke-width:4;stroke-linejoin:round;filter:drop-shadow(0 0 6px rgba(217,154,0,.55))}
.tbsim__sel polygon{fill:rgba(40,110,255,.28)}
.tbsim__veil{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(22,24,29,.45);z-index:10}
.tbsim__dialog{width:min(480px,calc(100% - 32px));padding:24px;border-radius:14px;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:16px}
.tbsim__dialog h2{margin:0;font-size:20px}
.tbsim__dialog p{margin:0;color:#5b6270}
.tbsim__kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.tbsim__kpi{padding:12px;border:1px solid #dfe3e8;border-radius:10px;display:flex;flex-direction:column;gap:4px;color:#5b6270;font-size:12px}
.tbsim__kpi b{font-size:22px;color:#16181d;font-variant-numeric:tabular-nums}
.tbsim__actions{display:flex;justify-content:flex-end;gap:8px}
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById("tbsim-css")) return;
  const s = doc.createElement("style");
  s.id = "tbsim-css";
  s.textContent = CSS;
  doc.head.appendChild(s);
}

function h<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function place(el: HTMLElement, b: { x: number; y: number; w: number; h: number }): void {
  el.style.left = `${b.x}px`;
  el.style.top = `${b.y}px`;
  el.style.width = `${b.w}px`;
  el.style.height = `${b.h}px`;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * An overlay outlining a zone in its own shape: a rectangle (rounded when the zone is), an
 * ellipse via `border-radius: 50%`, a polygon via an SVG drawn in stage coordinates.
 */
function outline(doc: Document, cls: string, shape: ZoneShape): HTMLElement {
  const b = boundsOf(shape);
  const el = h(doc, "div", cls);
  place(el, b);
  if (shape.shape === "polygon") {
    el.classList.add("is-poly");
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "tbsim__shape");
    svg.setAttribute("viewBox", `${b.x} ${b.y} ${Math.max(b.w, 1)} ${Math.max(b.h, 1)}`);
    svg.setAttribute("width", String(b.w));
    svg.setAttribute("height", String(b.h));
    const poly = doc.createElementNS(SVG_NS, "polygon");
    poly.setAttribute("points", svgPoints(shape.points));
    svg.appendChild(poly);
    el.appendChild(svg);
  } else if (shape.shape === "ellipse") {
    el.style.borderRadius = "50%";
  } else if (radiusOf(shape) > 0) {
    el.style.borderRadius = `${radiusOf(shape)}px`;
  }
  return el;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Normalised key combination of a keyboard event: `Ctrl+S`, `Escape`, `Shift+F10`. */
export function comboOf(e: KeyboardEvent): string | null {
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^(F([1-9]|1[0-2])|Enter|Escape|Tab|Delete|Backspace|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown)$/.test(e.code)) key = e.code;
  else if (e.key === "Escape" || e.key === "Enter" || e.key === "Tab") key = e.key;
  if (!key) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta"].filter(Boolean);
  return [...mods, key].join("+");
}

const TITLES: Record<Outcome, string> = {
  success: "Цель достигнута",
  partial: "Цель достигнута частично",
  fail: "Цель не достигнута",
  exited: "Задание прервано",
  timeout: "Время вышло",
};

/**
 * Mount a player into a container and start the run.
 *
 * @param root    Container to fill (position: relative or fixed); usually the fullscreen element.
 * @param options Scenario, media resolver and callbacks.
 * @returns The run and a destroy function.
 */
export function mountPlayer(root: HTMLElement, options: PlayerOptions): MountedPlayer {
  const doc = root.ownerDocument;
  ensureStyle(doc);
  const { scenario } = options;
  const media = new Map<string, MediaItem>(scenario.media.map((m) => [m.id, m]));
  const fieldDefs = new Map((scenario.fields ?? []).map((f) => [f.id, f]));
  const run = createRun(scenario);
  const counters = scenario.settings?.counters ?? {};
  const limitMs = scenario.settings?.limitSeconds ? scenario.settings.limitSeconds * 1000 : null;
  const startedAt = Date.now();

  // ── Skeleton ──
  const shell = h(doc, "div", "tbsim");
  const bar = h(doc, "div", "tbsim__bar");
  const task = h(doc, "div", "tbsim__task");
  task.append(h(doc, "span", "tbsim__cap", options.caption ?? "Задание"), h(doc, "span", "", scenario.meta.task));
  const counterBox = h(doc, "div", "tbsim__counters");
  const timerBox = h(doc, "div", "tbsim__timer");
  const timerNum = h(doc, "b");
  if (limitMs) timerBox.append(h(doc, "span", "", "осталось"), timerNum);
  const exitBtn = h(doc, "button", "tbsim__btn", "Выйти досрочно");
  exitBtn.type = "button";
  bar.append(task, counterBox, timerBox, exitBtn);
  const wrap = h(doc, "div", "tbsim__wrap");
  const frame = h(doc, "div", "tbsim__frame");
  const canvas = h(doc, "div", "tbsim__canvas");
  frame.append(canvas);
  wrap.append(frame);
  shell.append(bar, wrap);
  root.append(shell);

  const overlay = h(doc, "div");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:5";
  canvas.append(overlay);

  // ── Scale ──
  let scale = 1;
  function fit(): void {
    const stage = run.stage();
    const r = wrap.getBoundingClientRect();
    const availW = Math.max(1, r.width - 48);
    const availH = Math.max(1, r.height - 48);
    scale = Math.min(availW / stage.w, availH / stage.h);
    frame.style.width = `${stage.w * scale}px`;
    frame.style.height = `${stage.h * scale}px`;
    canvas.style.width = `${stage.w}px`;
    canvas.style.height = `${stage.h}px`;
    canvas.style.transform = `scale(${scale})`;
  }
  const onResize = () => fit();
  doc.defaultView?.addEventListener("resize", onResize);

  // ── Elements ──
  const nodes = new Map<string, HTMLImageElement>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const shownAt = new Map<string, boolean>();
  let drawn: Scene | null = null;

  function later(fn: () => void, ms: number): void {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  }

  function drawScene(): void {
    const scene = run.scene();
    const d = diffScenes(drawn, scene, media);
    for (const id of d.remove) { nodes.get(id)?.remove(); nodes.delete(id); shownAt.delete(id); }
    const plan = appearSchedule(d.add);
    for (const el of d.add) {
      const m = media.get(el.media);
      const img = h(doc, "img", "tbsim__el");
      img.alt = "";
      img.draggable = false;
      img.src = options.mediaUrl(m?.file ?? "");
      place(img, elementBox(el, media));
      const p = plan.get(el.id)!;
      if (p.fade || p.delayMs) {
        img.style.opacity = "0";
        if (p.fade) img.style.transition = `opacity ${p.durationMs}ms ease-out`;
        later(() => { img.style.opacity = "1"; }, p.delayMs + 16);
      }
      nodes.set(el.id, img);
    }
    // Re-append in the scene's z-order; moving a kept node does not reload its image.
    for (const el of scene.elements) {
      const n = nodes.get(el.id);
      if (n) canvas.insertBefore(n, overlay);
    }
    drawn = scene;
    fit();
  }

  function drawVisibility(): void {
    for (const el of run.scene().elements) {
      const n = nodes.get(el.id);
      if (!n) continue;
      const on = run.isVisible(el.id);
      n.style.visibility = on ? "visible" : "hidden";
      if (on && !shownAt.get(el.id) && el.autoHideMs) {
        later(() => { run.expire(el.id); render(); }, el.autoHideMs);
      }
      shownAt.set(el.id, on);
    }
  }

  // ── Fields ──
  const inputs = new Map<string, HTMLInputElement>();
  const labels = new Map<string, HTMLDivElement>();
  const committed = new Map<string, string>();
  let clipboard = "";

  function commit(id: string, input: HTMLInputElement): void {
    if (committed.get(id) === input.value) return;
    committed.set(id, input.value);
    react(run.commitField(id, input.value));
  }

  function focusNext(from: string): void {
    const editable = (run.scene().fields ?? []).filter((p) => p.editable)
      .sort((a, b) => (fieldDefs.get(a.field)?.tabIndex ?? 0) - (fieldDefs.get(b.field)?.tabIndex ?? 0));
    const i = editable.findIndex((p) => p.field === from);
    const next = editable[i + 1];
    if (next) inputs.get(next.field)?.focus();
  }

  function makeInput(p: FieldPlacement): HTMLInputElement {
    const input = h(doc, "input", "tbsim__input");
    input.type = "text";
    input.setAttribute("aria-label", fieldDefs.get(p.field)?.title ?? p.field);
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("dblclick", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        commit(p.field, input);
        if (e.key === "Tab") focusNext(p.field);
      }
    });
    input.addEventListener("blur", () => commit(p.field, input));
    input.addEventListener("paste", (e) => {
      if (fieldDefs.get(p.field)?.allowPaste === false) { e.preventDefault(); return; }
      const text = e.clipboardData?.getData("text") ?? "";
      if (!text && clipboard) {
        e.preventDefault();
        input.setRangeText(clipboard, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, "end");
      }
    });
    return input;
  }

  function drawFields(): void {
    const placed = new Set<string>();
    for (const p of run.scene().fields ?? []) {
      placed.add(p.field);
      const fontPx = Math.round(p.h * 0.34);
      if (p.editable) {
        labels.get(p.field)?.remove();
        labels.delete(p.field);
        let input = inputs.get(p.field);
        if (!input) {
          input = makeInput(p);
          inputs.set(p.field, input);
          input.value = run.value(p.field);
          committed.set(p.field, input.value);
        }
        if (doc.activeElement !== input) input.value = run.value(p.field);
        input.classList.toggle("is-wrong", run.isWrong(p.field));
        place(input, p);
        input.style.fontSize = `${fontPx}px`;
        canvas.insertBefore(input, overlay);
      } else {
        inputs.get(p.field)?.remove();
        inputs.delete(p.field);
        let label = labels.get(p.field);
        if (!label) { label = h(doc, "div", "tbsim__val"); labels.set(p.field, label); }
        label.textContent = run.value(p.field);
        place(label, p);
        label.style.fontSize = `${fontPx}px`;
        canvas.insertBefore(label, overlay);
      }
    }
    for (const [id, n] of inputs) if (!placed.has(id)) { n.remove(); inputs.delete(id); }
    for (const [id, n] of labels) if (!placed.has(id)) { n.remove(); labels.delete(id); }
  }

  // ── Overlay: hint, selection ──
  function drawOverlay(): void {
    overlay.querySelectorAll(".tbsim__hintbox,.tbsim__hint,.tbsim__sel").forEach((n) => n.remove());
    const hint = run.hint();
    if (hint) {
      const box = outline(doc, "tbsim__hintbox", hint.shape);
      const bubble = h(doc, "div", "tbsim__hint");
      bubble.append(h(doc, "b", "", "Подсказка"), h(doc, "span", "", hint.text));
      const stage = run.stage();
      const below = hint.box.y + hint.box.h + 16;
      bubble.style.left = `${Math.min(hint.box.x, stage.w - 540)}px`;
      bubble.style.fontSize = `${Math.round(stage.h / 45)}px`;
      if (below + 160 < stage.h) bubble.style.top = `${below}px`;
      else bubble.style.bottom = `${stage.h - hint.box.y + 16}px`;
      overlay.append(box, bubble);
    }
    const sel = run.selection();
    if (sel) {
      const z = (run.scene().zones ?? []).find((x) => x.id === sel);
      if (z) overlay.append(outline(doc, "tbsim__sel", z));
    }
  }

  function drawBar(): void {
    const r = run.result();
    counterBox.replaceChildren();
    const add = (label: string, n: number) => { const s = h(doc, "span", "", `${label} `); s.append(h(doc, "b", "", String(n))); counterBox.append(s); };
    if (counters.actions) add("Действий", r.counts.actions);
    if (counters.misses) add("Ошибок", r.counts.misses + r.counts.blocked + r.counts.wrongValues);
    if (counters.detours) add("В сторону", r.counts.detours);
    exitBtn.hidden = run.done();
  }

  function render(): void {
    if (drawn !== run.scene()) drawScene();
    drawVisibility();
    drawFields();
    drawOverlay();
    drawBar();
  }

  // ── Feedback ──
  function ring(x: number, y: number): void {
    const r = h(doc, "span", "tbsim__miss");
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    overlay.append(r);
    later(() => r.remove(), 700);
  }

  let finishedShown = false;
  function react(reaction: Reaction): void {
    if (reaction.kind === "miss") ring(reaction.x, reaction.y);
    if (reaction.kind === "copy") {
      clipboard = reaction.text;
      doc.defaultView?.navigator.clipboard?.writeText(reaction.text).catch(() => undefined);
    }
    render();
    if (run.done() && !finishedShown) {
      finishedShown = true;
      const result = run.result();
      options.onFinish?.(result);
      showResult(result);
    }
  }

  // ── Dialogs ──
  function dialog(): { veil: HTMLDivElement; box: HTMLDivElement } {
    const veil = h(doc, "div", "tbsim__veil");
    const box = h(doc, "div", "tbsim__dialog");
    veil.append(box);
    shell.append(veil);
    return { veil, box };
  }

  function showResult(result: SimResult): void {
    const { box } = dialog();
    box.append(h(doc, "h2", "", TITLES[result.outcome]));
    let text = "";
    if (result.outcome === "success") text = "Задание выполнено.";
    else if (result.outcome === "partial") text = `Выполнено не полностью: ошибки в полях ${result.goal?.checks.filter((c) => !c.passed).map((c) => fieldDefs.get(c.field)?.title ?? c.field).join(", ")}.`;
    else if (result.outcome === "fail") {
      const trap = result.traps[result.traps.length - 1];
      text = result.goal?.message
        ? `${result.goal.message}.${trap ? ` Ошибка: ${trap.error}.` : ""}`
        : `Документ оформлен с ошибками: ${result.goal?.checks.filter((c) => !c.passed).map((c) => fieldDefs.get(c.field)?.title ?? c.field).join(", ")}.`;
    } else if (result.outcome === "timeout") text = "Задание завершено по времени и засчитано как невыполненное.";
    else text = "Задание засчитано как невыполненное.";
    box.append(h(doc, "p", "", text));
    if (options.showDetails !== false) {
      const k = h(doc, "div", "tbsim__kpis");
      const kpi = (label: string, v: string) => { const d = h(doc, "div", "tbsim__kpi", label); d.append(h(doc, "b", "", v)); k.append(d); };
      kpi("время", mmss(result.durationMs));
      kpi("ошибок", String(result.counts.misses + result.counts.blocked + result.counts.wrongValues + result.counts.traps));
      kpi("подсказок", String(result.counts.hints));
      box.append(k);
    }
    const actions = h(doc, "div", "tbsim__actions");
    const back = h(doc, "button", "tbsim__btn tbsim__btn--primary", "Вернуться к вопросу");
    back.type = "button";
    back.addEventListener("click", () => options.onClose?.(result));
    actions.append(back);
    box.append(actions);
    back.focus();
  }

  exitBtn.addEventListener("click", () => {
    const { veil, box } = dialog();
    box.append(h(doc, "h2", "", "Выйти досрочно?"), h(doc, "p", "", "Задание будет засчитано как невыполненное. Прогресс не сохранится."));
    const actions = h(doc, "div", "tbsim__actions");
    const stay = h(doc, "button", "tbsim__btn", "Продолжить выполнение");
    const leave = h(doc, "button", "tbsim__btn tbsim__btn--danger", "Выйти");
    stay.type = leave.type = "button";
    stay.addEventListener("click", () => veil.remove());
    leave.addEventListener("click", () => { veil.remove(); react(run.exit()); });
    actions.append(stay, leave);
    box.append(actions);
    stay.focus();
  });

  // ── Input ──
  function stagePoint(e: MouseEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }
  canvas.addEventListener("click", (e) => { const p = stagePoint(e); react(run.click(p.x, p.y, "click")); });
  canvas.addEventListener("dblclick", (e) => { const p = stagePoint(e); react(run.click(p.x, p.y, "dblclick")); });
  canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); const p = stagePoint(e); react(run.click(p.x, p.y, "rightclick")); });

  const onKey = (e: KeyboardEvent) => {
    if (run.done() || shell.querySelector(".tbsim__veil")) return;
    const combo = comboOf(e);
    if (!combo) return;
    const inInput = (e.target as HTMLElement)?.classList?.contains("tbsim__input");
    // Inside a field only shortcuts reach the scenario; plain typing stays in the field.
    if (inInput && !/^(Ctrl|Alt|Meta)\+/.test(combo) && combo !== "Escape") return;
    if (inInput && /^(Ctrl|Meta)\+[CVXAZ]$/.test(combo)) return;
    if (/^(Ctrl|Meta)\+S$/.test(combo)) e.preventDefault();
    const reaction = run.key(combo);
    if (reaction.kind !== "none") { e.preventDefault(); react(reaction); }
  };
  doc.addEventListener("keydown", onKey);

  // ── Timer ──
  const tick = setInterval(() => {
    if (!limitMs || run.done()) return;
    const left = limitMs - (Date.now() - startedAt);
    timerNum.textContent = mmss(left);
    timerBox.classList.toggle("is-warning", left <= 60_000);
    if (left <= 0) react(run.timeout());
  }, 250);
  if (limitMs) timerNum.textContent = mmss(limitMs);

  render();
  // The first layout pass needs the container's final size.
  later(fit, 0);

  return {
    run,
    destroy() {
      clearInterval(tick);
      timers.forEach((id) => clearTimeout(id));
      doc.removeEventListener("keydown", onKey);
      doc.defaultView?.removeEventListener("resize", onResize);
      shell.remove();
    },
  };
}
