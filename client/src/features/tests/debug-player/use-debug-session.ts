/**
 * @module features/tests/debug-player/use-debug-session
 * @description PRD-18 Phase 4 — opens an in-service debug run for a test. It hosts
 * the SCORM 2004 RTE shim and the inspector compute layer in THIS (player) window
 * (so the SCO discovers `API_1484_11` by walking up to the parent and the inspector
 * can read `window.__scorm`), then asks the server to build a throwaway package
 * from LIVE state (telemetry off) and returns the same-origin `playUrl` for the
 * stage iframe. A 403 (no edit scope) surfaces as a distinct `forbidden` state so
 * the page can show the «недоступно» screen (D-2/FR-01).
 */
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

export type DebugSessionStatus = "loading" | "ready" | "forbidden" | "error";

export interface DebugSessionState {
  status: DebugSessionStatus;
  error?: string;
  token?: string;
  launch?: string;
  playUrl?: string;
  /** Test title, for the toolbar subtitle. */
  title?: string;
  /** Applied design-template id, for the stage ribbon. */
  template?: string;
}

/** Inject a server-served script into the player window and resolve once it ran. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Не удалось загрузить " + src));
    document.head.appendChild(s);
  });
}

export function useDebugSession(testId: string) {
  const [state, setState] = useState<DebugSessionState>({ status: "loading" });
  // Bumping `runKey` reloads the stage iframe for a fresh run (Сброс).
  const [runKey, setRunKey] = useState(0);
  // Bumping `buildKey` re-runs the whole build: a new package from LIVE state (Пересобрать).
  const [buildKey, setBuildKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        // Inject the RTE shim + inspector compute ONCE per window. On «Пересобрать»
        // (buildKey bump) they already exist — re-injecting would duplicate the
        // <script> tags and reset window.__scorm, dropping the token-keyed store.
        if (!window.__scorm) await loadScript(`/api/tests/${testId}/debug/shim.js`);
        if (!window.TBInspector) await loadScript(`/api/tests/${testId}/debug/inspector-compute.js`);
        const res = await apiRequest("POST", `/api/tests/${testId}/debug/session`);
        const data = (await res.json()) as {
          token: string; launch: string; playUrl: string; title?: string; template?: string;
        };
        if (cancelled) return;
        // Key the throwaway run's localStorage by token so reruns don't collide.
        window.__scorm?.restore(`debug:${data.token}`);
        setState({
          status: "ready", token: data.token, launch: data.launch, playUrl: data.playUrl,
          title: data.title, template: data.template,
        });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ status: /^403/.test(msg) ? "forbidden" : "error", error: msg });
      }
    })();
    return () => { cancelled = true; };
  }, [testId, buildKey]);

  /** Reset the current run: clear the RTE store and reload the stage iframe. */
  function reset() {
    window.__scorm?.reset();
    setRunKey((k) => k + 1);
  }

  /** Rebuild: assemble a fresh package from the current LIVE test state. */
  function rebuild() {
    setBuildKey((k) => k + 1);
  }

  return { state, runKey, reset, rebuild };
}
