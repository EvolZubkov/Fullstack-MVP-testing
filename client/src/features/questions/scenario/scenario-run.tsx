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
 */
import { useEffect, useRef } from "react";
import type { Scenario, SimResult } from "@shared/sim/contract";
import { mountPlayer, type MountedPlayer } from "@shared/sim/player";

/** Ask the browser for fullscreen on the whole document; call it from inside a click. */
export function requestScenarioFullscreen(): void {
  void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

/** Leave fullscreen if the document is in it. */
export function exitScenarioFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

export interface ScenarioRunProps {
  scenario: Scenario;
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

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const limit = startRemaining.current;
    const own = scenario.settings?.limitSeconds ?? null;
    const played: Scenario =
      typeof limit === "number" && limit > 0 && (own === null || limit < own)
        ? { ...scenario, settings: { ...scenario.settings, limitSeconds: Math.floor(limit) } }
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
