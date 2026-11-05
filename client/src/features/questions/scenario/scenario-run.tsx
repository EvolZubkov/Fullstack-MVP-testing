/**
 * @module features/questions/scenario/scenario-run
 * @description One full-screen run of a «Сценарий в ИС» scenario: the `shared/sim` player mounted
 * on a fixed layer over the page. The same component serves the author's «Сыграть» in the question
 * drawer and the learner's task in a «Сценарий» test, so both see the same player.
 *
 * Fullscreen itself is requested by the caller, synchronously inside the click that starts the run
 * (`requestScenarioFullscreen`): a browser grants it only to a user gesture, and a request made
 * after React has rendered may come too late. A browser that refuses still gets the player over
 * the whole window.
 *
 * The design template's skin. In the SCORM package the player is mounted into the package
 * document, whose head already carries the template stylesheet, so a template restyles the player
 * with `.tbsim …` rules (the «Терминал» template does). On the web the template stylesheet lives
 * only inside the scene's shadow root, and the scene is not even mounted during a run — so the
 * player here gets its OWN shadow root with the same template stylesheet, remapped by the same
 * {@link templateCssForShadow} the scene uses, plus the test's palette on the host. Without a
 * skin the player keeps its built-in look.
 */
import { useEffect, useRef } from "react";
import type { SimResult } from "@shared/sim/contract";
import { mountPlayer, type MountedPlayer } from "@shared/sim/player";
import type { ScenarioInput } from "@shared/sim/upgrade";
import { resolveSceneTheme } from "@shared/template/themes";
import { DS_SHADOW_CSS, hoistFontFaces, templateCssForShadow } from "@/components/template-screen";

/** Ask the browser for fullscreen on the whole document; call it from inside a click. */
export function requestScenarioFullscreen(): void {
  void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

/** Leave fullscreen if the document is in it. */
export function exitScenarioFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

/**
 * The design template's stylesheet and the test's palette, as the screen-template endpoint ships
 * them for the question screen (the player stands in for that screen).
 */
export interface ScenarioSkin {
  /** Template CSS (`base.css` + `theme.css`). */
  css: string;
  /** Design-param overrides as CSS custom properties, set on the host. */
  cssVars?: Record<string, string>;
  /** Design params the template selects on, set as attributes on the host. */
  dataAttrs?: Record<string, string>;
  /** PRD-23: per-theme colour overrides, injected after the template stylesheet. */
  themeCss?: string;
  /** PRD-23: the palette pinned by the author; absent means «Авто». */
  dataTheme?: "light" | "dark";
  /** PRD-23: the template declares a choice of palettes. */
  themed?: boolean;
}

/**
 * Dress a shadow root as the template's scene: the design system, the template stylesheet, the
 * per-theme colours, and on the host the palette class, the pinned theme and the param overrides —
 * the same pieces, in the same order, as {@link module:client/components/template-screen}.
 *
 * @param host   The shadow host.
 * @param shadow Its (emptied) shadow root.
 * @param skin   What to apply.
 */
function applySkin(host: HTMLElement, shadow: ShadowRoot, skin: ScenarioSkin): void {
  const ds = document.createElement("style");
  ds.textContent = DS_SHADOW_CSS;
  shadow.appendChild(ds);
  hoistFontFaces(skin.css);
  const style = document.createElement("style");
  style.textContent = templateCssForShadow(skin.css);
  shadow.appendChild(style);
  if (skin.themeCss) {
    const theme = document.createElement("style");
    theme.textContent = skin.themeCss;
    shadow.appendChild(theme);
  }
  if (skin.dataTheme) host.setAttribute("data-theme", skin.dataTheme);
  const prefersDark = !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const resolved = resolveSceneTheme({ pinned: skin.dataTheme, themed: !!skin.themed, systemPrefersDark: prefersDark });
  host.classList.add("ou", resolved === "dark" ? "ou--dark" : "ou--light");
  for (const [name, value] of Object.entries(skin.cssVars ?? {})) host.style.setProperty(name, value);
  for (const [name, value] of Object.entries(skin.dataAttrs ?? {})) host.setAttribute(name, value);
}

export interface ScenarioRunProps {
  scenario: ScenarioInput;
  /**
   * The design template the test is played in. Absent (the author's check in the question
   * drawer, where no test and so no template is chosen) — the player's built-in look.
   */
  skin?: ScenarioSkin | null;
  /** Caption above the task, e.g. «Проверка сценария · результат не сохраняется». */
  caption?: string;
  /** Show time, errors and hints in the result dialog. */
  showDetails?: boolean;
  /** Label of the button closing the result dialog (see `PlayerOptions.closeLabel`). */
  closeLabel?: string;
  /**
   * The test's remaining time, seconds: the run then stops at whichever comes first — this or the
   * scenario's own limit. Absent — the scenario's limit alone.
   */
  remainingSeconds?: number | null;
  /** The run ended (before the result dialog shows). */
  onFinish?: (result: SimResult) => void;
  /** The participant closed the result dialog. */
  onClose: (result: SimResult | null) => void;
  /**
   * Leaving fullscreen (Esc) ends an author's check. A learner's run must not end on a stray
   * Esc, so the learner host leaves this off.
   */
  closeOnFullscreenExit?: boolean;
  "data-testid"?: string;
}

/** The run: mounts once per scenario and tears the player down on unmount. */
export function ScenarioRun({
  scenario,
  skin,
  caption,
  showDetails = true,
  closeLabel,
  remainingSeconds,
  onFinish,
  onClose,
  closeOnFullscreenExit = false,
  "data-testid": testId,
}: ScenarioRunProps) {
  const host = useRef<HTMLDivElement | null>(null);
  // The owner passes fresh callbacks on every render; the player must not remount for that.
  const handlers = useRef({ onFinish, onClose });
  handlers.current = { onFinish, onClose };
  // The limit is fixed when the run starts; later ticks of the test timer must not remount it.
  const startRemaining = useRef(remainingSeconds);
  // Read at mount: the skin is fixed for the run, and a refetch must not restart the scenario.
  const startSkin = useRef(skin);

  useEffect(() => {
    const hostEl = host.current;
    if (!hostEl) return;
    // With a skin the player lives in a shadow root next to the template stylesheet; a host
    // element takes a shadow root only once, so a remount (a new scenario) reuses it.
    let root: HTMLElement = hostEl;
    const skinNow = startSkin.current;
    if (skinNow?.css) {
      const shadow = hostEl.shadowRoot ?? hostEl.attachShadow({ mode: "open" });
      shadow.replaceChildren();
      applySkin(hostEl, shadow, skinNow);
      root = document.createElement("div");
      root.style.cssText = "position:absolute;inset:0";
      shadow.appendChild(root);
    }
    const limit = startRemaining.current;
    const own = scenario.settings?.limitSeconds ?? null;
    const played: ScenarioInput =
      typeof limit === "number" && limit > 0 && (own === null || limit < own)
        ? ({ ...scenario, settings: { ...scenario.settings, limitSeconds: Math.floor(limit) } } as ScenarioInput)
        : scenario;
    let result: SimResult | null = null;
    const player: MountedPlayer = mountPlayer(root, {
      scenario: played,
      // Stored scenarios carry media-library addresses already.
      mediaUrl: (file) => file,
      showDetails,
      caption,
      closeLabel,
      onFinish: (r) => {
        result = r;
        handlers.current.onFinish?.(r);
      },
      onClose: (r) => {
        exitScenarioFullscreen();
        handlers.current.onClose(r ?? result);
      },
    });
    const onFullscreen = () => {
      if (closeOnFullscreenExit && !document.fullscreenElement) handlers.current.onClose(result);
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      player.destroy();
    };
  }, [scenario, caption, showDetails, closeLabel, closeOnFullscreenExit]);

  return <div ref={host} className="tb-sim-host" data-testid={testId ?? "scenario-player"} />;
}
