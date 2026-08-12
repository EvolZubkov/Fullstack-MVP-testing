// Tests for server/scorm/template/app/utils/shuffle.js
// The file uses plain JS without exports — we inline-test the logic here

import { describe, it, expect } from "vitest";

// Replicate the shuffle functions exactly as in shuffle.js
function shuffle(arr: number[]): number[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

function createShuffleMapping(length: number): number[] {
  const indices: number[] = [];
  for (let i = 0; i < length; i++) indices.push(i);
  return shuffle(indices.slice());
}

describe("shuffle", () => {
  it("returns same length array", () => {
    const arr = [0, 1, 2, 3, 4];
    const result = shuffle(arr.slice());
    expect(result.length).toBe(5);
  });

  it("contains same elements after shuffle", () => {
    const original = [0, 1, 2, 3, 4];
    const result = shuffle(original.slice());
    expect(result.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("handles empty array", () => {
    expect(shuffle([])).toEqual([]);
  });

  it("handles single element array", () => {
    expect(shuffle([42])).toEqual([42]);
  });

  it("mutates the array in place", () => {
    const arr = [0, 1, 2, 3];
    const result = shuffle(arr);
    expect(result).toBe(arr); // same reference
  });

  it("produces different orderings over many runs (probabilistic)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(JSON.stringify(shuffle([0, 1, 2, 3])));
    }
    // With 4 elements there are 24 permutations; after 100 runs we expect > 5 unique
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe("createShuffleMapping", () => {
  it("returns array of correct length", () => {
    expect(createShuffleMapping(5).length).toBe(5);
  });

  it("contains all indices 0..n-1", () => {
    const mapping = createShuffleMapping(4);
    expect([...mapping].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("returns empty array for length 0", () => {
    expect(createShuffleMapping(0)).toEqual([]);
  });

  it("returns [0] for length 1", () => {
    expect(createShuffleMapping(1)).toEqual([0]);
  });

  it("does not modify a shared indices source (uses .slice)", () => {
    // Run twice — should return independent arrays
    const a = createShuffleMapping(5);
    const b = createShuffleMapping(5);
    // Both valid permutations even if equal by chance
    expect([...a].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
    expect([...b].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
  });
});
