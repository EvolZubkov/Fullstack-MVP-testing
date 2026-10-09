/**
 * @module tests/sim-lms-protocol
 * @description «Сценарий в ИС», Э5б: протокол прогона через отчёт LMS (требование владельца
 * 2026-10-08 — всё, что аналитика берёт из телеметрии и веба, приходит и выгрузкой).
 *
 * Цепочка целиком: пакет пишет входные события протокола кусками `sim_<id>_<n>`
 * (`resultsPage.js` + `shared/sim/protocol-codec`), разбор листа выгрузки склеивает их
 * (`shared/lms-export/parse.ts`), импорт повторяет протокол движком и получает тот же прогон, что
 * дала бы телеметрия (`server/services/sim/imported-run.ts`) — с теми же сценами и промахами.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { createRun } from "@shared/sim/engine";
import type { Scenario, SimResult } from "@shared/sim/contract";
import {
  CHUNK_SIZE,
  MAX_CHUNKS,
  decodeProtocol,
  encodeProtocol,
  joinProtocolChunks,
  parseProtocolInteractionId,
  protocolChunks,
} from "@shared/sim/protocol-codec";
import { parseLmsExport } from "@shared/lms-export/parse";
import example from "../docs/specs/sim-scenario/example/scenario.json";
import { importedSimAnswer } from "../server/services/sim/imported-run";
import { decodeResultShare } from "@shared/lms-export/response-codec";
import { buildSimulationStats } from "../server/services/analytics/simulation-stats";

const scenario = example as unknown as Scenario;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Успех с промахами, одним из них — при открытом сообщении об ошибке. */
function successRun(): SimResult {
  let clock = 0;
  const run = createRun(scenario, { now: () => (clock += 1234) });
  run.click(170, 366);
  run.click(130, 180);
  run.click(900, 276);
  run.key("Ctrl+S");
  run.click(900, 276);
  run.click(1430, 276);
  run.click(900, 624);
  run.click(1094, 984);
  run.commitField("num", "ВХ-1183");
  run.commitField("topic", "Запрос коммерческого предложения");
  run.click(1430, 708);
  run.click(900, 852);
  run.click(190, 126);
  run.click(970, 690);
  return run.result();
}

/** Шаги `performance`, как их пишет пакет. */
function stepsOf(result: SimResult): string {
  const c = result.counts;
  return [
    ["outcome", result.outcome], ["goal", Math.round((result.goal?.share ?? 0) * 100)],
    ["misses", c.misses], ["blocked", c.blocked], ["wrong", c.wrongValues],
    ["detours", c.detours], ["traps", c.traps], ["hints", c.hints],
  ].map(([k, v]) => `${k}[.]${v}`).join("[,]");
}

describe("кодек протокола", () => {
  it("пишет только входные события и повторяется в тот же прогон", () => {
    const original = successRun();
    const encoded = encodeProtocol(original.events, original.durationMs);
    expect(encoded.startsWith("1;")).toBe(true);
    // Значения с пробелами и кириллицей не рвут разбор: пробел экранирован.
    expect(encoded).not.toMatch(/\s/);
    expect(encoded).toContain("ВХ-1183");

    const inputs = decodeProtocol(encoded)!.events;
    expect(inputs.map((e) => e.type)).not.toContain("enter");
    expect(inputs.find((e) => e.type === "value" && e.field === "topic")).toMatchObject({ value: "Запрос коммерческого предложения" });

    const restored = importedSimAnswer(scenario, stepsOf(original), encoded);
    expect(restored).toMatchObject({ restored: true, rejected: false });
    const back = restored.answer as SimResult;
    expect(back.outcome).toBe(original.outcome);
    expect(back.counts).toEqual(original.counts);
    expect(back.durationMs).toBe(original.durationMs);
    // Сцены восстановлены движком — тот же путь, что у исходного прогона.
    const scenes = (r: SimResult) => r.events.filter((e) => e.type === "enter").map((e) => (e as { scene: string }).scene);
    expect(scenes(back)).toEqual(scenes(original));
  });

  it("испорченная строка и чужая версия не читаются", () => {
    expect(decodeProtocol("2;a1@0")).toBeNull();
    expect(decodeProtocol("1;q1@0")).toBeNull();
    expect(decodeProtocol("1;m10@0")).toBeNull();
    expect(decodeProtocol("")).toBeNull();
    expect(encodeProtocol([])).toBe("");
  });

  it("экранирует разделители и пробелы Юникода", () => {
    const encoded = encodeProtocol([{ t: 5, type: "value", scene: "s", field: "f;=", value: "a b c d%~,@", correct: null }]);
    expect(decodeProtocol(encoded)).toEqual({
      events: [{ t: 5, type: "value", scene: "", field: "f;=", value: "a b c d%~,@", correct: null }],
      durationMs: null,
    });
    // Маркер конца — последний: после него событий быть не может.
    expect(decodeProtocol("1;x@a;z@5")).toEqual({ events: [{ t: 10, type: "exit" }], durationMs: 15 });
    expect(decodeProtocol("1;z@5;x@0")).toBeNull();
  });

  it("куски: метка в начале, порядок по номеру, дыра — нет протокола", () => {
    const encoded = `1;${"a".repeat(CHUNK_SIZE * 2)}@0`;
    const chunks = protocolChunks(encoded);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.startsWith("~"))).toBe(true);
    expect(joinProtocolChunks({ 3: chunks[2], 1: chunks[0], 2: chunks[1] })).toBe(encoded);
    expect(joinProtocolChunks({ 1: chunks[0], 3: chunks[2] })).toBeNull();
    expect(joinProtocolChunks({ 1: "без метки" })).toBeNull();
    // Протокол длиннее предела не пишется вовсе: обрезанный повторить нельзя.
    expect(protocolChunks("x".repeat(CHUNK_SIZE * MAX_CHUNKS))).toHaveLength(MAX_CHUNKS);
    expect(protocolChunks("x".repeat(CHUNK_SIZE * MAX_CHUNKS + 1))).toEqual([]);
    // Кусок с меткой укладывается в SPM ответа взаимодействия SCORM 2004 — 4000 знаков.
    expect(chunks[0].length).toBe(4000);
    expect(parseProtocolInteractionId("sim_abc-1_12")).toEqual({ questionId: "abc-1", n: 12 });
    expect(parseProtocolInteractionId("scale_x")).toBeNull();
  });
});

describe("пакет пишет протокол в отчёт LMS", () => {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const build = (state: unknown) => new Function(
    "TBTemplate", "state",
    `${read("server/scorm/template/app/utils/qtype.js")}\n${read("server/scorm/template/app/render/resultsPage.js")}\nreturn buildSimProtocolInteractions();`,
  )({ simProtocolChunks: protocolChunks }, state) as Array<{ id: string; type: string; result: string; response: string }>;

  it("куски `sim_<id>_<n>` только у сценария, сыгранного в этой сессии", () => {
    const encoded = encodeProtocol(successRun().events, 1000);
    const interactions = build({
      flatQuestions: [
        { question: { id: "q1", type: "simulation" } },
        { question: { id: "q2", type: "simulation" } },
        { question: { id: "q3", type: "single" } },
      ],
      // q2 — ответ лучшей попытки из suspend_data: протокола у него нет.
      answers: { q1: { outcome: "success", protocol: encoded }, q2: { outcome: "fail" }, q3: 1 },
    });
    expect(interactions.map((i) => i.id)).toEqual(protocolChunks(encoded).map((_, i) => `sim_q1_${i + 1}`));
    expect(interactions[0]).toMatchObject({ type: "other", result: "neutral" });
    expect(interactions.map((i) => i.response).join("")).toBe(protocolChunks(encoded).join(""));
  });
});

describe("выгрузка отчёта LMS", () => {
  const original = successRun();
  const encoded = encodeProtocol(original.events, original.durationMs);
  const chunks = protocolChunks(encoded);
  const ids = ["q_Q1", ...chunks.map((_, i) => `sim_Q1_${i + 1}`)].reverse();
  const head = [...Array(9).fill(""), ...ids.flatMap((id) => [id, "", "", ""])];
  const sub = [...Array(9).fill(""), ...ids.flatMap(() => ["Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ"])];
  const cells = ids.flatMap((id) => (id === "q_Q1"
    ? ["performance", "40", "0.9", stepsOf(original)]
    : ["other", "", "neutral", chunks[Number(id.split("_")[2]) - 1]]));
  const row = ["Иванов", "", "Орг", "", "", "01.10.2026", "01.10.2026", "Пройден", "90", ...cells];
  const book = parseLmsExport([head, sub, row]);

  it("разбор склеивает куски протокола; неизвестными они не считаются", () => {
    expect(book.unknownColumns).toEqual([]);
    expect(book.questionIds).toEqual(["Q1"]);
    expect(book.rows[0].simProtocols).toEqual({ Q1: encoded });
    expect(book.rows[0].results.Q1).toBe("0.9");
  });

  it("импорт восстанавливает прогон, и аналитика видит сцены и карту промахов", () => {
    const r = book.rows[0];
    const run = importedSimAnswer(scenario, r.answers.Q1, r.simProtocols.Q1);
    expect(run.restored).toBe(true);
    const stats = buildSimulationStats(scenario, [{ answer: run.answer, earnedPoints: 0.9, possiblePoints: 1, latencyMs: 40000 }]);
    expect(stats.withProtocol).toBe(1);
    expect(stats.missMap.filter((s) => s.sceneId === "form").map((s) => s.stateLabel)).toEqual([null, "+ «save-error»"]);
    expect(decodeResultShare(r.results.Q1)).toBe(0.9);
  });

  it("без протокола и при изменённом сценарии остаются шаги — исход без разбора", () => {
    expect(importedSimAnswer(scenario, stepsOf(original), null)).toEqual({ answer: stepsOf(original), restored: false, rejected: false });
    // Сценарий правили после сборки пакета: действия «Создать» больше нет — повтор расходится.
    const edited = JSON.parse(JSON.stringify(scenario)) as Scenario;
    for (const scene of edited.scenes) scene.zones = (scene.zones ?? []).filter((z) => z.id !== "list-create");
    const rejected = importedSimAnswer(edited, stepsOf(original), encoded);
    expect(rejected).toMatchObject({ answer: stepsOf(original), restored: false, rejected: true });
    expect(importedSimAnswer(scenario, "не шаги", encoded).answer).toBeNull();
    expect(decodeResultShare("")).toBeNull();
    expect(decodeResultShare("1,0")).toBe(1);
    expect(decodeResultShare("correct")).toBeNull();
    expect(decodeResultShare("1.5")).toBeNull();
  });
});
