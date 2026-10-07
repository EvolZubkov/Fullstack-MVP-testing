/**
 * @module tests/test-item-consumers
 * @description Архитектурная защита второго вида пункта теста (docs/specs/sim-scenario/plan-tests.md,
 * раздел 4, пункт 3): каждый модуль сервера, читающий разделы теста, обязан стоять в реестре
 * `server/test-item-consumers.ts` с решением о пункте-сценарии. Новое место без решения роняет
 * этот тест — оно не может молча пропустить сценарий. Заодно реестр не держит мёртвых записей.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ITEM_CONSUMERS } from "../server/test-item-consumers";

const ROOT = process.cwd();
const READS_SECTIONS = /getTestSections(ByTopic|ByTopicIds)?\(|\btestSections\b/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const readers = sourceFiles(join(ROOT, "server"))
  .filter((file) => READS_SECTIONS.test(readFileSync(file, "utf8")))
  .map((file) => relative(ROOT, file).split(sep).join("/"))
  .filter((file) => file !== "server/test-item-consumers.ts");

describe("реестр мест, читающих разделы теста", () => {
  it("каждый модуль, читающий разделы, принял решение о пункте-сценарии", () => {
    const missing = readers.filter((file) => !(file in ITEM_CONSUMERS));
    expect(missing, `Добавьте решение о пункте-сценарии в server/test-item-consumers.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("реестр не держит модулей, которых нет или которые разделов больше не читают", () => {
    const stale = Object.keys(ITEM_CONSUMERS).filter((file) => !existsSync(join(ROOT, file)) || !readers.includes(file));
    expect(stale).toEqual([]);
  });

  it("у каждого пробела назван этап, у неприменимости — причина", () => {
    for (const [file, entry] of Object.entries(ITEM_CONSUMERS)) {
      if (entry.decision === "gap") expect(entry.stage, file).toMatch(/^Э\d/);
      if (entry.decision === "not-applicable") expect(entry.why.length, file).toBeGreaterThan(10);
    }
  });
});
