/**
 * @module features/tests/transfer/use-transfer-import
 *
 * State of the three-step import: which step the author is on, what the package holds, what
 * the current options would do, and what the run reported.
 *
 * Two rules the UI depends on:
 *
 * 1. **The plan is recomputed on EVERY change of an option.** The list of deletions depends
 *    on the mode, so a plan shown for other options is a plan the author has not seen.
 * 2. **While a recomputation is in flight the write is unavailable** (`planning`). Applying a
 *    stale plan is exactly the accident the three steps exist to prevent.
 *
 * The hook holds no markup, so the dialog stays a rendering of this state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyTransferImport,
  inspectTransferPackage,
  planTransferImport,
  type PartMode,
  type PartName,
  type TopicPolicy,
  type TransferApplyReport,
  type TransferInspection,
  type TransferOperation,
  type TransferOptions,
} from "./transfer-api";

export type TransferStep = "file" | "choose" | "done";

/** Safe defaults: every part taken, and the mode that cannot erase (PRD-48 §3). */
function defaultOptions(summary: TransferInspection): TransferOptions {
  const topics: Record<string, TopicPolicy> = {};
  for (const topic of summary.topics) {
    // A topic the importer may not manage can only be created anew — the server refuses
    // anything else, so the form must not start on an option that is already forbidden.
    topics[topic.id] = topic.state === "foreign" ? "new" : "merge";
  }
  return {
    parts: { structure: true, scoring: true, scales: true, results: true, media: true },
    modes: { scoring: "upsert", scales: "upsert" },
    topics,
  };
}

export function useTransferImport() {
  const [step, setStep] = useState<TransferStep>("file");
  const [token, setToken] = useState<string | null>(null);
  const [summary, setSummary] = useState<TransferInspection | null>(null);
  const [options, setOptions] = useState<TransferOptions | null>(null);
  const [operations, setOperations] = useState<TransferOperation[]>([]);
  const [report, setReport] = useState<TransferApplyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the LAST recomputation may land: options change faster than the network answers.
  const planRun = useRef(0);

  const choose = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const { token: fresh, summary: inspected } = await inspectTransferPackage(file);
      setToken(fresh);
      setSummary(inspected);
      setOptions(defaultOptions(inspected));
      setStep("choose");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!token || !options || step !== "choose") return;
    const run = ++planRun.current;
    setPlanning(true);
    planTransferImport(token, options)
      .then((result) => {
        if (run !== planRun.current) return;
        setOperations(result.operations);
        setError(null);
      })
      .catch((e: Error) => {
        if (run !== planRun.current) return;
        setOperations([]);
        setError(e.message);
      })
      .finally(() => {
        if (run === planRun.current) setPlanning(false);
      });
  }, [token, options, step]);

  const setPart = useCallback((part: PartName, on: boolean) => {
    setOptions((prev) => (prev ? { ...prev, parts: { ...prev.parts, [part]: on } } : prev));
  }, []);

  const setMode = useCallback((part: "scoring" | "scales", mode: PartMode) => {
    setOptions((prev) => (prev ? { ...prev, modes: { ...prev.modes, [part]: mode } } : prev));
  }, []);

  const setTopicPolicy = useCallback((topicId: string, policy: TopicPolicy) => {
    setOptions((prev) => (prev ? { ...prev, topics: { ...prev.topics, [topicId]: policy } } : prev));
  }, []);

  const apply = useCallback(async () => {
    if (!token || !options) return;
    setError(null);
    setBusy(true);
    try {
      setReport(await applyTransferImport(token, options));
      setStep("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [token, options]);

  return {
    step,
    summary,
    options,
    operations,
    report,
    busy,
    planning,
    error,
    choose,
    setPart,
    setMode,
    setTopicPolicy,
    apply,
  };
}
