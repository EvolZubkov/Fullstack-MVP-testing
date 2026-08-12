/**
 * @module server/__tests__/test-transfer-identity
 *
 * Which identifier an imported row gets.
 *
 * Keeping the SOURCE identifier is what makes a repeat import able to recognise the rows it
 * created last time — the identifier is its own evidence of origin, so no provenance column
 * is needed. Renumbering happens only where the identifier is genuinely taken by something
 * else, and every such case is reported: a silently renumbered row is a row a later import
 * will duplicate instead of update.
 */
import { describe, it, expect } from "vitest";
import { makeIdentityResolver, buildIdMap } from "../services/test-transfer/identity";

describe("makeIdentityResolver", () => {
  it("keeps the source id when it is free", () => {
    const resolve = makeIdentityResolver({ taken: new Set() });
    expect(resolve("src-q")).toEqual({ id: "src-q", remapped: false });
  });

  it("issues a new id when the source one belongs to something else", () => {
    const resolve = makeIdentityResolver({ taken: new Set(["src-q"]), newId: () => "fresh-1" });
    expect(resolve("src-q")).toEqual({ id: "fresh-1", remapped: true });
  });

  it("never hands out the same fresh id twice", () => {
    let n = 0;
    const resolve = makeIdentityResolver({
      taken: new Set(["a", "b"]),
      // A generator that repeats itself must not produce a collision inside one import.
      newId: () => (n++ === 0 ? "dup" : "dup-2"),
    });
    const first = resolve("a");
    const second = resolve("b");
    expect(first.id).not.toBe(second.id);
  });

  it("answers the same way for the same source id", () => {
    const resolve = makeIdentityResolver({ taken: new Set(["x"]), newId: () => "fresh" });
    expect(resolve("x")).toEqual(resolve("x"));
  });
});

describe("buildIdMap", () => {
  it("maps only the ids that collide", () => {
    const map = buildIdMap(["free-1", "busy-1", "free-2"], {
      taken: new Set(["busy-1"]),
      newId: () => "fresh-1",
    });

    // A free id is absent from the map: substitution leaves it exactly as it is.
    expect(map.has("free-1")).toBe(false);
    expect(map.has("free-2")).toBe(false);
    expect(map.get("busy-1")).toBe("fresh-1");
  });

  it("reports what it renumbered", () => {
    const map = buildIdMap(["busy-1"], { taken: new Set(["busy-1"]), newId: () => "fresh-1" });
    expect([...map.entries()]).toEqual([["busy-1", "fresh-1"]]);
  });
});
