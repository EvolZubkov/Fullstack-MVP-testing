# PRD-45: план реализации — редактор уровней шкалы

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Спецификация:** [scale-levels-editor.md](scale-levels-editor.md)

**Цель:** заменить таблицу диапазонов в редакторе шкал списком карточек уровней с вводом границ
по точкам-разрезам, не меняя модель хранения `bands`.

**Архитектура:** арифметика «пары `min`/`max` ↔ (начало, пороги, конец)» выносится в чистый модуль
`levels-model.ts` без React, поэтому проверяется юнит-тестами без DOM. Компонент
`levels-editor.tsx` собственного состояния не держит: на каждый рендер он получает `bands`,
разворачивает их в черновик `LevelsDraft`, а любое изменение сворачивает обратно в `bands` и
отдаёт наверх через `onChange`. Порог хранится в двух местах (`bands[i].max` и `bands[i+1].min`)
одной и той же строкой, поэтому круговой обход «строка → bands → строка» не теряет ввод.

**Технологии:** React 19, TypeScript, Vitest + Testing Library, `@universityrt/ui-kit` (DS),
CSS-слой `client/src/styles/tb-components.css`.

**Прогон тестов:** только `npm test -- <путь>`. `npx vitest run` в этом репозитории падает.
Полный прогон не запускать без явного разрешения пользователя.

---

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `client/src/features/tests/editor/sections/levels-model.ts` | Создать. Чистая арифметика: типы черновика, свёртка/развёртка в `bands`, ошибки, сегменты покрытия, добавление/удаление/перестановка уровня |
| `client/src/features/tests/editor/sections/__tests__/levels-model.test.ts` | Создать. Юнит-тесты чистого модуля |
| `client/src/features/tests/editor/sections/tone-chips.tsx` | Создать. Ряд чипов оценки поверх DS `SegmentedControl` |
| `client/src/features/tests/editor/sections/__tests__/tone-chips.test.tsx` | Создать. Синхронность списка с `TONE_OPTIONS` и выбор значения |
| `client/src/features/tests/editor/sections/levels-editor.tsx` | Создать. Компонент `LevelsEditor` — лента покрытия, карточки уровней, разделители-пороги, баннеры |
| `client/src/features/tests/editor/sections/__tests__/levels-editor.test.tsx` | Создать. Поведение компонента |
| `client/src/features/tests/editor/sections/scales-section.tsx` | Изменить. Удалить `BandsEditor` (строки 927-1112), подключить `LevelsEditor`, переписать `bandErrorOf` |
| `client/src/features/tests/editor/sections/result-variables-section.tsx` | Изменить. Импорт и вызов `LevelsEditor` вместо `BandsEditor` |
| `client/src/features/tests/editor/test-editor.validation.ts` | Изменить. Строка 701: смежные границы перестают быть пересечением |
| `client/src/styles/tb-components.css` | Изменить. Добавить слой `.tb-levels*` и `.tb-tone-dot` |
| `client/src/features/tests/editor/sections/__tests__/scales-section.coverage.test.tsx` | Изменить. Тесты, обращавшиеся к таблице по `aria-label` вида «min диапазона 1» |

Почему отдельные файлы, а не правка на месте: `scales-section.tsx` уже 1724 строки, а редактор
уровней вырастет примерно вдвое против нынешнего `BandsEditor`. Модуль арифметики отделён от
компонента, потому что именно арифметика несёт риск (совместимость с легаси, порядок границ), и её
надо проверять без рендера.

---

## Задача 1: чистый модуль — свёртка и развёртка границ

**Файлы:**

- Создать: `client/src/features/tests/editor/sections/levels-model.ts`
- Тест: `client/src/features/tests/editor/sections/__tests__/levels-model.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Создать `client/src/features/tests/editor/sections/__tests__/levels-model.test.ts`:

```ts
/**
 * @module features/tests/editor/sections/__tests__/levels-model
 * @description PRD-45. The band ↔ draft arithmetic: the load-bearing part of the
 * levels editor, checked without a DOM.
 */

import { describe, expect, it } from "vitest";

import { bandsToDraft, draftToBands } from "../levels-model";
import type { ScaleBandModel } from "../../test-editor.types";

function band(min: string, max: string, level: string): ScaleBandModel {
  return { clientKey: `b-${level}`, min, max, label: `Метка ${level}`, level, text: "", tone: "" };
}

describe("bandsToDraft", () => {
  it("splits contiguous bands into start, cuts and end", () => {
    const draft = bandsToDraft([band("0", "15", "low"), band("15", "29", "mid"), band("29", "98", "high")]);
    expect(draft.start).toBe("0");
    expect(draft.cuts).toEqual(["15", "29"]);
    expect(draft.end).toBe("98");
    expect(draft.levels.map((l) => l.level)).toEqual(["low", "mid", "high"]);
  });

  it("takes the cut from the LOWER band's max, so a legacy gap closes downwards", () => {
    // Legacy pair 0-15 / 16-29: the gap (15, 16) had no level at all. Closing it
    // downwards means no score that already had a level changes level.
    const draft = bandsToDraft([band("0", "15", "low"), band("16", "29", "mid")]);
    expect(draft.cuts).toEqual(["15"]);
  });

  it("returns an empty draft for no bands", () => {
    expect(bandsToDraft([])).toEqual({ start: "", cuts: [], end: "", levels: [] });
  });
});

describe("draftToBands", () => {
  it("writes the cut into both neighbours", () => {
    const bands = draftToBands(bandsToDraft([band("0", "15", "low"), band("16", "29", "mid")]));
    expect(bands.map((b) => [b.min, b.max])).toEqual([["0", "15"], ["15", "29"]]);
  });

  it("keeps a single level spanning start to end", () => {
    const bands = draftToBands(bandsToDraft([band("0", "10", "only")]));
    expect(bands.map((b) => [b.min, b.max])).toEqual([["0", "10"]]);
  });

  it("round-trips a contiguous set unchanged", () => {
    const input = [band("0", "15", "low"), band("15", "29", "mid")];
    expect(draftToBands(bandsToDraft(input))).toEqual(input);
  });

  it("keeps half-typed input as the author typed it", () => {
    const draft = { start: "0", cuts: ["1,"], end: "10", levels: bandsToDraft([band("0", "5", "a"), band("5", "10", "b")]).levels };
    expect(draftToBands(draft).map((b) => [b.min, b.max])).toEqual([["0", "1,"], ["1,", "10"]]);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/levels-model.test.ts`

Ожидается: FAIL — `Failed to resolve import "../levels-model"`.

- [ ] **Шаг 3: написать модуль**

Создать `client/src/features/tests/editor/sections/levels-model.ts`:

```ts
/**
 * @module features/tests/editor/sections/levels-model
 * @description PRD-45. The pure conversion between the stored interpretation
 * (`bands` — pairs of min/max) and what the author actually edits: a start value,
 * N-1 cut points and an end value. Framework-free on purpose — the arithmetic is
 * the risky part (legacy compatibility, ordering) and is unit tested without a DOM.
 *
 * The editor component holds NO state of its own: it derives the draft from
 * `bands` on every render and folds it back on every edit. That works because a
 * cut is written to BOTH neighbours as the same raw string, so the round trip
 * «string → bands → string» is lossless and half-typed input survives a render.
 */

import type { LevelTone } from "@shared/scales/interpretation";

import { formatAuthorNumber, parseAuthorNumber } from "../numeric-input";
import type { ScaleBandModel } from "../test-editor.types";
import type { FeedbackEditorValue } from "./feedback-editor-modal";

/** One level's content — everything a band carries except its boundaries. */
export type LevelDraft = {
  clientKey: string;
  label: string;
  level: string;
  text: string;
  tone: LevelTone | "";
  feedback?: FeedbackEditorValue;
};

/**
 * What the author edits. `cuts[i]` separates `levels[i]` from `levels[i + 1]`,
 * so `cuts.length === levels.length - 1` whenever there is at least one level.
 * Values stay strings: a half-typed «1,» must survive until it parses.
 */
export type LevelsDraft = {
  start: string;
  cuts: string[];
  end: string;
  levels: LevelDraft[];
};

let localKeyCounter = 0;

function nextKey(): string {
  localKeyCounter += 1;
  return `level-${localKeyCounter}`;
}

/** A level with no content yet. @public */
export function emptyLevel(): LevelDraft {
  return { clientKey: nextKey(), label: "", level: "", text: "", tone: "" };
}

/** Unfold stored bands into the draft the author edits. @public */
export function bandsToDraft(bands: ScaleBandModel[]): LevelsDraft {
  if (bands.length === 0) return { start: "", cuts: [], end: "", levels: [] };
  return {
    start: bands[0].min,
    // The cut comes from the LOWER band's max, never the upper band's min: a
    // legacy gap («0-15» / «16-29») then closes downwards, so no score that
    // already had a level changes level — only scores from the gap gain one.
    cuts: bands.slice(0, -1).map((b) => b.max),
    end: bands[bands.length - 1].max,
    levels: bands.map((b, i) => ({
      clientKey: b.clientKey ?? `band-${i}`,
      label: b.label,
      level: b.level,
      text: b.text,
      tone: b.tone,
      feedback: b.feedback,
    })),
  };
}

/** Fold the draft back into stored bands. @public */
export function draftToBands(draft: LevelsDraft): ScaleBandModel[] {
  const last = draft.levels.length - 1;
  return draft.levels.map((l, i) => ({
    clientKey: l.clientKey,
    min: i === 0 ? draft.start : draft.cuts[i - 1],
    max: i === last ? draft.end : draft.cuts[i],
    label: l.label,
    level: l.level,
    text: l.text,
    tone: l.tone,
    feedback: l.feedback,
  }));
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/levels-model.test.ts`

Ожидается: PASS, 7 тестов.

- [ ] **Шаг 5: закоммитить**

```bash
git add client/src/features/tests/editor/sections/levels-model.ts \
        client/src/features/tests/editor/sections/__tests__/levels-model.test.ts
git commit -m "feat(prd-45): свёртка и развёртка границ уровней шкалы"
```

---

## Задача 2: ошибки ввода, дыры в легаси, сегменты покрытия

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/levels-model.ts`
- Тест: `client/src/features/tests/editor/sections/__tests__/levels-model.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Дописать в конец `__tests__/levels-model.test.ts`:

```ts
import { coverageSegments, draftErrors, hasStoredGap } from "../levels-model";

const THREE = bandsToDraft([band("0", "15", "low"), band("15", "29", "mid"), band("29", "98", "high")]);

describe("draftErrors", () => {
  it("passes a well-ordered draft", () => {
    const e = draftErrors(THREE);
    expect(e.blocking).toBeNull();
    expect(e.cuts).toEqual([null, null]);
  });

  it("allows a zero-width level, because a single band 0..0 is legal today", () => {
    expect(draftErrors({ ...THREE, cuts: ["0", "29"] }).blocking).toBeNull();
  });

  it("marks BOTH fields of a descending pair", () => {
    const e = draftErrors({ ...THREE, cuts: ["42", "29"] });
    expect(e.cuts[0]).toBe("Больше следующего порога 29");
    expect(e.cuts[1]).toBe("Меньше предыдущего порога 42");
    expect(e.blocking).toBe("Числа в ряду «Начало — пороги — Конец» должны идти по возрастанию.");
  });

  it("names the neighbour by its role, not always «порог»", () => {
    const e = draftErrors({ ...THREE, start: "50" });
    expect(e.start).toBe("Больше следующего порога 15");
    expect(e.cuts[0]).toBe("Меньше предыдущего начала 50");
  });

  it("reports a non-numeric field and blocks", () => {
    const e = draftErrors({ ...THREE, end: "x" });
    expect(e.end).toBe("Укажите число");
    expect(e.blocking).toBe("Границы уровней заданы не полностью: укажите числа во всех полях.");
  });

  it("says nothing when there are no levels", () => {
    expect(draftErrors({ start: "", cuts: [], end: "", levels: [] }).blocking).toBeNull();
  });
});

describe("hasStoredGap", () => {
  it("detects a legacy gap", () => {
    expect(hasStoredGap([band("0", "15", "low"), band("16", "29", "mid")])).toBe(true);
  });

  it("ignores contiguous bands", () => {
    expect(hasStoredGap([band("0", "15", "low"), band("15", "29", "mid")])).toBe(false);
  });

  it("ignores unparseable boundaries", () => {
    expect(hasStoredGap([band("0", "x", "low"), band("16", "29", "mid")])).toBe(false);
  });
});

describe("coverageSegments", () => {
  it("returns one segment per level when the domain matches", () => {
    expect(coverageSegments(THREE, { min: 0, max: 98 })).toEqual([
      { kind: "level", index: 0, from: 0, to: 15 },
      { kind: "level", index: 1, from: 15, to: 29 },
      { kind: "level", index: 2, from: 29, to: 98 },
    ]);
  });

  it("adds gap segments when the domain is wider than the levels", () => {
    const segments = coverageSegments({ ...THREE, start: "10", end: "69" }, { min: 0, max: 98 });
    expect(segments?.[0]).toEqual({ kind: "gap", from: 0, to: 10 });
    expect(segments?.[segments.length - 1]).toEqual({ kind: "gap", from: 69, to: 98 });
  });

  it("omits gaps when the domain is unknown", () => {
    const segments = coverageSegments({ ...THREE, start: "10", end: "69" }, null);
    expect(segments?.every((s) => s.kind === "level")).toBe(true);
  });

  it("returns null while the numbers do not parse or do not ascend", () => {
    expect(coverageSegments({ ...THREE, end: "x" }, null)).toBeNull();
    expect(coverageSegments({ ...THREE, cuts: ["42", "29"] }, null)).toBeNull();
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/levels-model.test.ts`

Ожидается: FAIL — `"coverageSegments" is not exported`.

- [ ] **Шаг 3: дописать модуль**

Дописать в `levels-model.ts` после `draftToBands`:

```ts
/** Per-field messages plus the blocking one that stops saving. */
export type LevelsErrors = {
  start: string | null;
  cuts: Array<string | null>;
  end: string | null;
  blocking: string | null;
};

type Slot = { raw: string; name: string };

/** The boundary row the author sees, left to right, each with its role name. */
function slots(draft: LevelsDraft): Slot[] {
  return [
    { raw: draft.start, name: "начала" },
    ...draft.cuts.map((c) => ({ raw: c, name: "порога" })),
    { raw: draft.end, name: "конца" },
  ];
}

/**
 * The only two things that can go wrong once boundaries are cut points: a field
 * that is not a number, and a row that stops ascending. Overlaps and gaps are
 * unrepresentable by construction.
 *
 * @public
 */
export function draftErrors(draft: LevelsDraft): LevelsErrors {
  const out: LevelsErrors = { start: null, cuts: draft.cuts.map(() => null), end: null, blocking: null };
  if (draft.levels.length === 0) return out;

  const row = slots(draft);
  const values = row.map((slot) => parseAuthorNumber(slot.raw.trim()));
  // First message wins: the author fixes one field at a time, and a field
  // carrying two complaints at once reads as noise.
  const set = (i: number, message: string) => {
    if (i === 0) out.start = out.start ?? message;
    else if (i === row.length - 1) out.end = out.end ?? message;
    else out.cuts[i - 1] = out.cuts[i - 1] ?? message;
  };

  values.forEach((v, i) => {
    if (v === null) set(i, "Укажите число");
  });
  if (values.some((v) => v === null)) {
    out.blocking = "Границы уровней заданы не полностью: укажите числа во всех полях.";
    return out;
  }

  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1] as number;
    const cur = values[i] as number;
    // Non-strict: a zero-width level is legal, exactly as a single band 0..0 is today.
    if (cur >= prev) continue;
    set(i - 1, `Больше следующего ${row[i].name} ${formatAuthorNumber(cur)}`);
    set(i, `Меньше предыдущего ${row[i - 1].name} ${formatAuthorNumber(prev)}`);
    out.blocking = "Числа в ряду «Начало — пороги — Конец» должны идти по возрастанию.";
  }
  return out;
}

/**
 * True when the STORED bands leave a hole between neighbours — a legacy pair
 * («0-15» / «16-29»). Drives the notice that opening the card closed the hole.
 *
 * @public
 */
export function hasStoredGap(bands: ScaleBandModel[]): boolean {
  for (let i = 0; i < bands.length - 1; i++) {
    const upper = parseAuthorNumber(bands[i].max.trim());
    const lower = parseAuthorNumber(bands[i + 1].min.trim());
    if (upper === null || lower === null) continue;
    if (upper !== lower) return true;
  }
  return false;
}

/** One stripe of the coverage ribbon. */
export type CoverageSegment =
  | { kind: "level"; index: number; from: number; to: number }
  | { kind: "gap"; from: number; to: number };

/**
 * The ribbon above the level list. Null while the row does not parse or does not
 * ascend — a ribbon drawn from broken numbers would lie about the coverage.
 *
 * @public
 */
export function coverageSegments(
  draft: LevelsDraft,
  domain: { min: number; max: number } | null,
): CoverageSegment[] | null {
  if (draft.levels.length === 0) return null;

  const bounds: number[] = [];
  for (const raw of [draft.start, ...draft.cuts, draft.end]) {
    const v = parseAuthorNumber(raw.trim());
    if (v === null) return null;
    bounds.push(v);
  }
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i] < bounds[i - 1]) return null;
  }

  const levels: CoverageSegment[] = draft.levels.map((_, i) => ({
    kind: "level",
    index: i,
    from: bounds[i],
    to: bounds[i + 1],
  }));
  if (domain === null) return levels;

  const from = bounds[0];
  const to = bounds[bounds.length - 1];
  const head: CoverageSegment[] = domain.min < from ? [{ kind: "gap", from: domain.min, to: from }] : [];
  const tail: CoverageSegment[] = domain.max > to ? [{ kind: "gap", from: to, to: domain.max }] : [];
  return [...head, ...levels, ...tail];
}
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/levels-model.test.ts`

Ожидается: PASS, 20 тестов.

- [ ] **Шаг 5: закоммитить**

```bash
git add client/src/features/tests/editor/sections/levels-model.ts \
        client/src/features/tests/editor/sections/__tests__/levels-model.test.ts
git commit -m "feat(prd-45): проверки порядка границ, дыры легаси и сегменты покрытия"
```

---

## Задача 3: добавление, удаление и перестановка уровня

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/levels-model.ts`
- Тест: `client/src/features/tests/editor/sections/__tests__/levels-model.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Дописать в конец `__tests__/levels-model.test.ts`:

```ts
import { addLevel, moveLevel, removeLevel } from "../levels-model";

describe("addLevel", () => {
  it("seeds the first level from the domain", () => {
    const draft = addLevel({ start: "", cuts: [], end: "", levels: [] }, { min: 0, max: 98 });
    expect(draft.start).toBe("0");
    expect(draft.end).toBe("98");
    expect(draft.cuts).toEqual([]);
    expect(draft.levels).toHaveLength(1);
  });

  it("seeds the first level with zeroes when the domain is unknown", () => {
    const draft = addLevel({ start: "", cuts: [], end: "", levels: [] }, null);
    expect([draft.start, draft.end]).toEqual(["0", "0"]);
  });

  it("cuts the last level in half", () => {
    const draft = addLevel(bandsToDraft([band("0", "98", "only")]), null);
    expect(draft.cuts).toEqual(["49"]);
    expect(draft.levels).toHaveLength(2);
  });

  it("leaves the new cut empty when the last level does not parse", () => {
    const draft = addLevel(bandsToDraft([band("0", "x", "only")]), null);
    expect(draft.cuts).toEqual([""]);
  });
});

describe("removeLevel", () => {
  it("drops the cut below the level, so coverage stays continuous", () => {
    const draft = removeLevel(THREE, 1);
    expect(draft.cuts).toEqual(["29"]);
    expect(draft.levels.map((l) => l.level)).toEqual(["low", "high"]);
  });

  it("drops the cut ABOVE the first level", () => {
    const draft = removeLevel(THREE, 0);
    expect(draft.cuts).toEqual(["29"]);
    expect(draft.levels.map((l) => l.level)).toEqual(["mid", "high"]);
  });

  it("keeps the outer bounds when the last level goes", () => {
    const draft = removeLevel(THREE, 2);
    expect([draft.start, draft.end]).toEqual(["0", "98"]);
    expect(draft.cuts).toEqual(["15"]);
  });

  it("empties the whole draft when the only level goes", () => {
    expect(removeLevel(bandsToDraft([band("0", "10", "only")]), 0)).toEqual({
      start: "", cuts: [], end: "", levels: [],
    });
  });
});

describe("moveLevel", () => {
  it("moves the level CONTENT and leaves the boundaries alone", () => {
    const draft = moveLevel(THREE, 2, 0);
    expect(draft.levels.map((l) => l.level)).toEqual(["high", "low", "mid"]);
    expect(draft.cuts).toEqual(["15", "29"]);
    expect([draft.start, draft.end]).toEqual(["0", "98"]);
  });

  it("ignores an out-of-range target", () => {
    expect(moveLevel(THREE, 0, 3)).toBe(THREE);
    expect(moveLevel(THREE, 0, -1)).toBe(THREE);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/levels-model.test.ts`

Ожидается: FAIL — `"addLevel" is not exported`.

- [ ] **Шаг 3: дописать модуль**

Дописать в `levels-model.ts`:

```ts
/**
 * Append a level. The first one spans the whole known domain; every next one is
 * cut off the last level at its midpoint, so the author never starts from an
 * invalid row.
 *
 * @public
 */
export function addLevel(draft: LevelsDraft, domain: { min: number; max: number } | null): LevelsDraft {
  if (draft.levels.length === 0) {
    return {
      start: formatAuthorNumber(domain?.min ?? 0),
      cuts: [],
      end: formatAuthorNumber(domain?.max ?? 0),
      levels: [emptyLevel()],
    };
  }
  const lowerRaw = draft.cuts.length > 0 ? draft.cuts[draft.cuts.length - 1] : draft.start;
  const lower = parseAuthorNumber(lowerRaw.trim());
  const upper = parseAuthorNumber(draft.end.trim());
  const cut = lower === null || upper === null ? "" : formatAuthorNumber((lower + upper) / 2);
  return { ...draft, cuts: [...draft.cuts, cut], levels: [...draft.levels, emptyLevel()] };
}

/**
 * Remove a level together with ONE adjacent cut — the one below it, or the one
 * above it for the first level. Whichever goes, the neighbours close ranks and
 * the covered span stays exactly as it was.
 *
 * @public
 */
export function removeLevel(draft: LevelsDraft, index: number): LevelsDraft {
  const levels = draft.levels.filter((_, i) => i !== index);
  if (levels.length === 0) return { start: "", cuts: [], end: "", levels: [] };
  const cutToDrop = index === 0 ? 0 : index - 1;
  return { ...draft, cuts: draft.cuts.filter((_, i) => i !== cutToDrop), levels };
}

/**
 * Reorder level CONTENT. Boundaries are positional and stay put: the author is
 * saying «these texts belong to the other end of the scale», not «move the
 * threshold».
 *
 * @public
 */
export function moveLevel(draft: LevelsDraft, from: number, to: number): LevelsDraft {
  if (from === to || to < 0 || to >= draft.levels.length) return draft;
  const levels = [...draft.levels];
  const [moved] = levels.splice(from, 1);
  levels.splice(to, 0, moved);
  return { ...draft, levels };
}
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/levels-model.test.ts`

Ожидается: PASS, 30 тестов.

- [ ] **Шаг 5: закоммитить**

```bash
git add client/src/features/tests/editor/sections/levels-model.ts \
        client/src/features/tests/editor/sections/__tests__/levels-model.test.ts
git commit -m "feat(prd-45): добавление, удаление и перестановка уровня"
```

---

## Задача 4: ряд чипов оценки

**Файлы:**

- Создать: `client/src/features/tests/editor/sections/tone-chips.tsx`
- Изменить: `client/src/styles/tb-components.css`
- Тест: `client/src/features/tests/editor/sections/__tests__/tone-chips.test.tsx`

- [ ] **Шаг 1: написать падающий тест**

Создать `client/src/features/tests/editor/sections/__tests__/tone-chips.test.tsx`:

```tsx
/**
 * @module features/tests/editor/sections/__tests__/tone-chips
 * @description PRD-45. The tone row replaces a Select that wrapped to three lines
 * in a 120px column. The list must stay the SAME closed list as TONE_OPTIONS.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TONE_OPTIONS } from "../outcomes-editor";
import { TONE_CHIPS, ToneChips } from "../tone-chips";

describe("ToneChips", () => {
  it("covers exactly the tones TONE_OPTIONS declares", () => {
    expect(TONE_CHIPS.map((c) => c.value)).toEqual(TONE_OPTIONS.map((o) => o.value));
  });

  it("shortens only the empty tone's wording", () => {
    expect(TONE_CHIPS[0].label).toBe("Авто");
    expect(TONE_CHIPS.slice(1).map((c) => c.label)).toEqual(TONE_OPTIONS.slice(1).map((o) => o.label));
  });

  it("reports the picked tone", () => {
    const onChange = vi.fn();
    render(<ToneChips value="" ariaLabel="оценка" onChange={onChange} />);
    fireEvent.click(screen.getByText("Внимание"));
    expect(onChange).toHaveBeenCalledWith("attention");
  });

  it("reports the empty tone for «Авто», not the sentinel", () => {
    const onChange = vi.fn();
    render(<ToneChips value="critical" ariaLabel="оценка" onChange={onChange} />);
    fireEvent.click(screen.getByText("Авто"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/tone-chips.test.tsx`

Ожидается: FAIL — `Failed to resolve import "../tone-chips"`.

- [ ] **Шаг 3: написать компонент**

Создать `client/src/features/tests/editor/sections/tone-chips.tsx`:

```tsx
/**
 * @module features/tests/editor/sections/tone-chips
 * @description PRD-45. The level's tone as a row of DS SegmentedControl items with
 * a colour dot each. It replaces a `Select` that wrapped «По направлению шкалы»
 * onto three lines inside a 120px table column; a segmented row cannot wrap.
 *
 * A separate module rather than a chunk of the levels editor, so `OutcomesEditor`
 * — which still shows the same closed list as a Select — can adopt it later
 * without moving markup around (see PRD-45 §7).
 */

import { SegmentedControl } from "@universityrt/ui-kit";

import type { LevelTone } from "@shared/scales/interpretation";

/**
 * SegmentedControl keys items by a non-empty string, but the «derive it» tone IS
 * the empty string in the model. The sentinel lives only inside this component.
 */
const AUTO = "auto";

/**
 * The same closed list as `TONE_OPTIONS`, plus a colour token per state. Only the
 * empty tone is reworded: «По направлению шкалы» eats half the row, so the full
 * wording moves to the field description (PRD-45 FR-06).
 */
export const TONE_CHIPS: Array<{ value: LevelTone | ""; label: string; colour: string }> = [
  { value: "", label: "Авто", colour: "var(--ou-fg-muted)" },
  { value: "favorable", label: "Благоприятный", colour: "var(--ou-success-default)" },
  { value: "neutral", label: "Нейтральный", colour: "var(--ou-neutral-400)" },
  { value: "attention", label: "Внимание", colour: "var(--ou-warning-default)" },
  { value: "critical", label: "Критический", colour: "var(--ou-error-default)" },
];

export type ToneChipsProps = {
  value: LevelTone | "";
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: LevelTone | "") => void;
  testId?: string;
};

export function ToneChips({ value, ariaLabel, disabled = false, onChange, testId }: ToneChipsProps) {
  return (
    <SegmentedControl<string>
      size="s"
      value={value === "" ? AUTO : value}
      aria-label={ariaLabel}
      data-testid={testId}
      items={TONE_CHIPS.map((c) => ({
        value: c.value === "" ? AUTO : c.value,
        label: c.label,
        disabled,
        icon: <span className="tb-tone-dot" style={{ background: c.colour }} aria-hidden="true" />,
      }))}
      onChange={(v) => onChange(v === AUTO ? "" : (v as LevelTone))}
    />
  );
}
```

- [ ] **Шаг 4: добавить стиль точки**

Дописать в конец `client/src/styles/tb-components.css`:

```css
/* ─── PRD-45: tone dot inside the level's SegmentedControl ──────────────────── */
.tb-tone-dot {
  width: 9px; height: 9px; border-radius: 50%;
  display: inline-block; flex: 0 0 auto;
}
```

- [ ] **Шаг 5: убедиться, что тесты проходят**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/tone-chips.test.tsx`

Ожидается: PASS, 4 теста.

- [ ] **Шаг 6: закоммитить**

```bash
git add client/src/features/tests/editor/sections/tone-chips.tsx \
        client/src/features/tests/editor/sections/__tests__/tone-chips.test.tsx \
        client/src/styles/tb-components.css
git commit -m "feat(prd-45): оценка уровня рядом чипов вместо селекта"
```

---

## Задача 5: компонент редактора — лента покрытия и карточки уровней

**Файлы:**

- Создать: `client/src/features/tests/editor/sections/levels-editor.tsx`
- Изменить: `client/src/styles/tb-components.css`
- Тест: `client/src/features/tests/editor/sections/__tests__/levels-editor.test.tsx`

- [ ] **Шаг 1: написать падающий тест**

Создать `client/src/features/tests/editor/sections/__tests__/levels-editor.test.tsx`:

```tsx
/**
 * @module features/tests/editor/sections/__tests__/levels-editor
 * @description PRD-45. The levels editor is stateless: it derives its draft from
 * `bands` and folds every edit back. These tests drive it exactly the way the
 * author does — through the visible fields — and assert on the bands it emits.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { LevelsEditor } from "../levels-editor";
import type { ScaleBandModel } from "../../test-editor.types";

function band(min: string, max: string, level: string, label = ""): ScaleBandModel {
  return { clientKey: `b-${level}`, min, max, label, level, text: "", tone: "" };
}

const THREE = [band("0", "15", "low", "Слабо"), band("15", "29", "mid", "Средне"), band("29", "98", "high", "Ярко")];

/** Stateful host: the component is controlled, so the test owns the bands. */
function Host({ initial, onBands }: { initial: ScaleBandModel[]; onBands?: (b: ScaleBandModel[]) => void }) {
  const [bands, setBands] = useState(initial);
  return (
    <LevelsEditor
      bands={bands}
      index={0}
      readOnly={false}
      domain={{ min: 0, max: 98 }}
      onChange={(next) => {
        setBands(next);
        onBands?.(next);
      }}
    />
  );
}

describe("LevelsEditor", () => {
  it("shows one start, one end and N-1 cuts — not a min/max pair per level", () => {
    render(<Host initial={THREE} />);
    expect((screen.getByLabelText("Начало") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Конец") as HTMLInputElement).value).toBe("98");
    expect((screen.getByLabelText("Порог между уровнями 1 и 2") as HTMLInputElement).value).toBe("15");
    expect((screen.getByLabelText("Порог между уровнями 2 и 3") as HTMLInputElement).value).toBe("29");
    expect(screen.queryByLabelText(/^min /)).toBeNull();
    expect(screen.queryByLabelText(/^max /)).toBeNull();
  });

  it("writes an edited cut into both neighbouring bands", () => {
    const onBands = vi.fn();
    render(<Host initial={THREE} onBands={onBands} />);
    fireEvent.change(screen.getByLabelText("Порог между уровнями 1 и 2"), { target: { value: "20" } });
    const emitted = onBands.mock.calls[0][0] as ScaleBandModel[];
    expect([emitted[0].max, emitted[1].min]).toEqual(["20", "20"]);
  });

  it("labels every field next to itself, with no table header", () => {
    const { container } = render(<Host initial={THREE} />);
    expect(container.querySelector("table")).toBeNull();
    expect(screen.getAllByLabelText("Название уровня 1")).toHaveLength(1);
    expect(screen.getAllByLabelText("Код уровня 1")).toHaveLength(1);
  });

  it("shows the computed range in each card header", () => {
    render(<Host initial={THREE} />);
    expect(screen.getByTestId("scales-level-range-0-0")).toHaveTextContent("0 … 15");
    expect(screen.getByTestId("scales-level-range-0-2")).toHaveTextContent("29 … 98");
  });

  it("draws one ribbon stripe per level", () => {
    render(<Host initial={THREE} />);
    expect(screen.getAllByTestId(/^scales-level-seg-0-/)).toHaveLength(3);
  });

  it("adds a level by halving the last one", () => {
    const onBands = vi.fn();
    render(<Host initial={[band("0", "98", "only")]} onBands={onBands} />);
    fireEvent.click(screen.getByTestId("scales-level-add-0"));
    const emitted = onBands.mock.calls[0][0] as ScaleBandModel[];
    expect(emitted.map((b) => [b.min, b.max])).toEqual([["0", "49"], ["49", "98"]]);
  });

  it("removes a level and closes the gap it left", () => {
    const onBands = vi.fn();
    render(<Host initial={THREE} onBands={onBands} />);
    fireEvent.click(screen.getByLabelText("Удалить уровень 2"));
    const emitted = onBands.mock.calls[0][0] as ScaleBandModel[];
    expect(emitted.map((b) => [b.min, b.max])).toEqual([["0", "29"], ["29", "98"]]);
  });

  it("offers the empty state instead of an empty table", () => {
    render(<Host initial={[]} />);
    expect(screen.getByTestId("scales-levels-empty-0")).toHaveTextContent("обучающийся увидит только числовой балл");
  });

  it("hides every control in read-only mode", () => {
    render(<LevelsEditor bands={THREE} index={0} readOnly domain={null} onChange={vi.fn()} />);
    expect(screen.queryByTestId("scales-level-add-0")).toBeNull();
    expect(screen.queryByLabelText("Удалить уровень 1")).toBeNull();
    expect((screen.getByLabelText("Начало") as HTMLInputElement).disabled).toBe(true);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/levels-editor.test.tsx`

Ожидается: FAIL — `Failed to resolve import "../levels-editor"`.

- [ ] **Шаг 3: написать компонент**

Создать `client/src/features/tests/editor/sections/levels-editor.tsx`:

```tsx
/**
 * @module features/tests/editor/sections/levels-editor
 * @description PRD-45. The numeric interpretation editor: a coverage ribbon over a
 * list of level cards separated by single threshold fields. Replaces the six-column
 * `tb-bands-table`, whose header — the only carrier of field labels — scrolled away,
 * whose columns clipped their content, and whose min/max pairs allowed silent gaps.
 *
 * Stateless by design: the draft is derived from `bands` on every render and folded
 * back on every edit (see `levels-model`). Shared with the «Показатели» tab's
 * numeric indicator, exactly as its predecessor was — one notion, one editor.
 */

import { useState } from "react";
import {
  Banner,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  IconButton,
  Input,
  Textarea,
} from "@universityrt/ui-kit";
import { ChevronRight, GripVertical, Plus, Trash2 } from "lucide-react";

import { hasFeedbackContent } from "../scales-api";
import { formatAuthorNumber } from "../numeric-input";
import type { ScaleBandModel } from "../test-editor.types";
import { FeedbackEditorModal } from "./feedback-editor-modal";
import { emptyFeedbackValue } from "./outcomes-editor";
import { ToneChips, TONE_CHIPS } from "./tone-chips";
import {
  addLevel,
  bandsToDraft,
  coverageSegments,
  draftErrors,
  draftToBands,
  hasStoredGap,
  removeLevel,
  type LevelsDraft,
} from "./levels-model";

export type LevelsEditorProps = {
  bands: ScaleBandModel[];
  /** Index of the owning card — only used to build stable test ids. */
  index: number;
  readOnly: boolean;
  onChange: (bands: ScaleBandModel[]) => void;
  /** Distinguishes the scale card's editor from the indicator card's one. */
  testIdPrefix?: string;
  /** Effective scale domain for the ribbon; null when nothing declares one. */
  domain?: { min: number; max: number } | null;
};

/** Colour of a ribbon stripe: the level's tone, or the neutral «auto» dot. */
function segColour(tone: string): string {
  return TONE_CHIPS.find((c) => c.value === tone)?.colour ?? "var(--ou-fg-muted)";
}

export function LevelsEditor({
  bands,
  index,
  readOnly,
  onChange,
  testIdPrefix = "scales",
  domain = null,
}: LevelsEditorProps) {
  // Which level's recommendations modal is open (level index, not the level).
  const [feedbackFor, setFeedbackFor] = useState<number | null>(null);

  const draft = bandsToDraft(bands);
  const errors = draftErrors(draft);
  const segments = coverageSegments(draft, domain);
  const total = draft.levels.length;

  const emit = (next: LevelsDraft) => onChange(draftToBands(next));
  const setBound = (patch: Partial<Pick<LevelsDraft, "start" | "end">>) => emit({ ...draft, ...patch });
  const setCut = (i: number, raw: string) =>
    emit({ ...draft, cuts: draft.cuts.map((c, j) => (j === i ? raw : c)) });
  const setLevel = (i: number, patch: Partial<LevelsDraft["levels"][number]>) =>
    emit({ ...draft, levels: draft.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const open = feedbackFor !== null ? draft.levels[feedbackFor] : undefined;

  if (total === 0) {
    return (
      <div className="tb-levels">
        <div className="tb-levels__empty" data-testid={`${testIdPrefix}-levels-empty-${index}`}>
          Уровни не заданы — обучающийся увидит только числовой балл
          {!readOnly && (
            <div className="tb-levels__empty-act">
              <Button
                size="s"
                leadingIcon={<Plus size={16} aria-hidden="true" />}
                onClick={() => emit(addLevel(draft, domain))}
                data-testid={`${testIdPrefix}-level-add-${index}`}
              >
                Добавить уровень
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="tb-levels" data-testid={`${testIdPrefix}-levels-${index}`}>
      <div className="tb-levels__cover">
        <span className="tb-levels__caplbl">Начало</span>
        <span className="tb-levels__caplbl">Покрытие шкалы</span>
        <span className="tb-levels__caplbl tb-levels__caplbl--end">Конец</span>

        <Input
          size="s"
          fullWidth
          aria-label="Начало"
          value={draft.start}
          disabled={readOnly}
          error={errors.start ?? undefined}
          onChange={(e) => setBound({ start: e.target.value })}
          data-testid={`${testIdPrefix}-levels-start-${index}`}
        />
        <div className="tb-levels__ribbon">
          {segments === null ? (
            <div className="tb-levels__seg tb-levels__seg--unknown">Границы заданы не полностью</div>
          ) : (
            segments.map((s, i) =>
              s.kind === "gap" ? (
                <div key={`gap-${i}`} className="tb-levels__seg tb-levels__seg--gap" style={{ flexGrow: Math.max(s.to - s.from, 0.001) }}>
                  не разобрано
                </div>
              ) : (
                <div
                  key={`seg-${s.index}`}
                  className="tb-levels__seg"
                  style={{ flexGrow: Math.max(s.to - s.from, 0.001), background: segColour(draft.levels[s.index].tone) }}
                  data-testid={`${testIdPrefix}-level-seg-${index}-${s.index}`}
                >
                  {draft.levels[s.index].label.trim() || draft.levels[s.index].level.trim() || `Уровень ${s.index + 1}`}
                </div>
              ),
            )
          )}
        </div>
        <Input
          size="s"
          fullWidth
          aria-label="Конец"
          value={draft.end}
          disabled={readOnly}
          error={errors.end ?? undefined}
          onChange={(e) => setBound({ end: e.target.value })}
          data-testid={`${testIdPrefix}-levels-end-${index}`}
        />
      </div>

      {draft.levels.map((l, i) => (
        <div key={l.clientKey}>
          {i > 0 && (
            <div className="tb-levels__cut">
              <div className="tb-levels__cutfield">
                <Input
                  size="s"
                  fullWidth
                  aria-label={`Порог между уровнями ${i} и ${i + 1}`}
                  value={draft.cuts[i - 1]}
                  disabled={readOnly}
                  error={errors.cuts[i - 1] ?? undefined}
                  onChange={(e) => setCut(i - 1, e.target.value)}
                  data-testid={`${testIdPrefix}-level-cut-${index}-${i - 1}`}
                />
              </div>
              <div className="tb-levels__cutrule">
                <span className="tb-levels__cutline" />
                <span className="tb-levels__cutlbl">
                  {`порог: ${draft.cuts[i - 1] || "?"} и ниже — «${draft.levels[i - 1].label.trim() || `уровень ${i}`}», выше — «${l.label.trim() || `уровень ${i + 1}`}»`}
                </span>
                <span className="tb-levels__cutline" />
              </div>
            </div>
          )}

          <section className="tb-levels__card" style={{ borderLeftColor: segColour(l.tone) }}>
            <header className="tb-levels__head">
              <GripVertical className="tb-levels__grip" width={16} height={16} aria-hidden="true" />
              <span className="tb-levels__title">{l.label.trim() || l.level.trim() || `Уровень ${i + 1}`}</span>
              <span className="tb-levels__spacer" />
              <span className="tb-levels__range" data-testid={`${testIdPrefix}-level-range-${index}-${i}`}>
                {rangeOf(draft, i)}
              </span>
              {!readOnly && (
                <IconButton
                  icon={<Trash2 width={14} height={14} aria-hidden="true" />}
                  aria-label={`Удалить уровень ${i + 1}`}
                  variant="ghost"
                  size="s"
                  onClick={() => emit(removeLevel(draft, i))}
                />
              )}
            </header>

            <div className="tb-levels__grid">
              <Input
                size="s"
                fullWidth
                label="Название для обучающегося"
                aria-label={`Название уровня ${i + 1}`}
                value={l.label}
                disabled={readOnly}
                onChange={(e) => setLevel(i, { label: e.target.value })}
              />
              <Input
                size="s"
                fullWidth
                label="Код уровня"
                aria-label={`Код уровня ${i + 1}`}
                placeholder="напр. high"
                value={l.level}
                disabled={readOnly}
                onChange={(e) => setLevel(i, { level: e.target.value })}
              />
            </div>

            <div className="tb-levels__tone">
              <span className="tb-levels__tonelbl">Как трактовать</span>
              <ToneChips
                value={l.tone}
                disabled={readOnly}
                ariaLabel={`Оценка уровня ${i + 1}`}
                onChange={(tone) => setLevel(i, { tone })}
                testId={`${testIdPrefix}-level-tone-${index}-${i}`}
              />
            </div>

            <Collapsible>
              <CollapsibleTrigger className="tb-levels__fold">
                <ChevronRight className="tb-levels__chev" width={14} height={14} aria-hidden="true" />
                Толкование для обучающегося
                <span className="tb-levels__spacer" />
                <span className="tb-levels__badge">{l.text.trim() === "" ? "не задано" : "задано"}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Textarea
                  size="s"
                  fullWidth
                  rows={3}
                  value={l.text}
                  disabled={readOnly}
                  placeholder="Что означает этот уровень — текст для обучающегося"
                  aria-label={`Толкование уровня ${i + 1}`}
                  onChange={(e) => setLevel(i, { text: e.target.value })}
                />
              </CollapsibleContent>
            </Collapsible>

            {!readOnly && (
              <button type="button" className="tb-levels__fold" onClick={() => setFeedbackFor(i)}>
                <ChevronRight className="tb-levels__chev" width={14} height={14} aria-hidden="true" />
                Рекомендации
                <span className="tb-levels__spacer" />
                <span className="tb-levels__badge">
                  {hasFeedbackContent(l.feedback) ? "заданы" : "не заданы"}
                </span>
              </button>
            )}
          </section>
        </div>
      ))}

      {!readOnly && (
        <Button
          variant="ghost"
          size="s"
          leadingIcon={<Plus size={16} aria-hidden="true" />}
          onClick={() => emit(addLevel(draft, domain))}
          data-testid={`${testIdPrefix}-level-add-${index}`}
        >
          Добавить уровень
        </Button>
      )}

      {errors.blocking && (
        <Banner tone="error" size="sm" description={errors.blocking} data-testid={`${testIdPrefix}-levels-error-${index}`} />
      )}
      {!errors.blocking && segments !== null && segments.some((s) => s.kind === "gap") && (
        <Banner
          tone="warning"
          size="sm"
          description={`Баллы вне ${draft.start} … ${draft.end} останутся без уровня. Растяните крайние поля до границ шкалы или сузьте границы.`}
          data-testid={`${testIdPrefix}-levels-uncovered-${index}`}
        />
      )}
      {hasStoredGap(bands) && (
        <Banner
          tone="info"
          size="sm"
          description={
            "Границы уровней сомкнуты — баллы, прежде не попадавшие ни в один уровень, теперь " +
            "относятся к нижнему из соседних. Запишется при сохранении."
          }
          data-testid={`${testIdPrefix}-levels-closed-gap-${index}`}
        />
      )}

      {open && feedbackFor !== null && (
        <FeedbackEditorModal
          open
          title={`Рекомендации для уровня «${open.label.trim() || open.level.trim() || `уровень ${feedbackFor + 1}`}»`}
          description="Текст и подборка материалов, которые увидит обучающийся с этим уровнем"
          value={open.feedback ?? emptyFeedbackValue()}
          hideAssets={false}
          onCancel={() => setFeedbackFor(null)}
          onSave={(value) => {
            setLevel(feedbackFor, { feedback: value });
            setFeedbackFor(null);
          }}
          testId={`${testIdPrefix}-level-feedback-${index}`}
        />
      )}
    </div>
  );
}

/** The computed «from … to» caption in a card header — text, never a field. */
function rangeOf(draft: LevelsDraft, i: number): string {
  const from = i === 0 ? draft.start : draft.cuts[i - 1];
  const to = i === draft.levels.length - 1 ? draft.end : draft.cuts[i];
  return `${from || "?"} … ${to || "?"}`;
}
```

- [ ] **Шаг 4: добавить стили**

Дописать в конец `client/src/styles/tb-components.css`:

```css
/* ─── PRD-45: levels editor ─────────────────────────────────────────────────── */
/* The predecessor was a six-column table whose header carried every field label —
   scrolling the drawer left the fields anonymous. Here each field owns its label,
   and the only shared grid is the coverage strip: one 88 / 1fr / 88 track set on
   two rows, so the labels share a baseline and the ribbon shares the control
   baseline with both number fields. */
.tb-levels { display: flex; flex-direction: column; gap: var(--ou-space-2); }

.tb-levels__cover {
  display: grid; grid-template-columns: 88px 1fr 88px;
  column-gap: var(--ou-space-2); align-items: center;
  margin-bottom: var(--ou-space-3);
}
.tb-levels__caplbl { font: var(--ou-text-caption); color: var(--ou-fg-muted); }
.tb-levels__caplbl--end { text-align: right; }
.tb-levels__ribbon { display: flex; height: 34px; border-radius: var(--ou-radius-s); overflow: hidden; }
.tb-levels__seg {
  display: flex; align-items: center; justify-content: center;
  min-width: 0; padding: 0 var(--ou-space-1);
  font: var(--ou-text-body-xs); font-weight: 600; color: var(--ou-neutral-0);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tb-levels__seg--gap {
  background: repeating-linear-gradient(45deg,
    var(--ou-bg-muted), var(--ou-bg-muted) 5px,
    var(--ou-bg-subtle) 5px, var(--ou-bg-subtle) 10px);
  color: var(--ou-fg-muted); font-weight: 400;
}
.tb-levels__seg--unknown { flex: 1; background: var(--ou-bg-muted); color: var(--ou-fg-muted); font-weight: 400; }

.tb-levels__card {
  border: var(--wf-border-w) solid var(--ou-border-soft);
  border-left-width: 4px; border-radius: var(--ou-radius-m);
  background: var(--ou-bg-surface-1);
  padding: var(--ou-space-3) var(--ou-space-4);
}
.tb-levels__head { display: flex; align-items: center; gap: var(--ou-space-2); margin-bottom: var(--ou-space-3); }
.tb-levels__grip { color: var(--ou-fg-muted); cursor: grab; flex: 0 0 auto; }
.tb-levels__title { font: var(--ou-text-body-m); font-weight: 600; }
.tb-levels__spacer { flex: 1; }
.tb-levels__range { font: var(--ou-text-body-s); color: var(--ou-fg-muted); font-variant-numeric: tabular-nums; }

.tb-levels__grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: var(--ou-space-3); }
.tb-levels__tone { margin-top: var(--ou-space-3); }
.tb-levels__tonelbl { display: block; font: var(--ou-text-caption); color: var(--ou-fg-muted); margin-bottom: var(--ou-space-1); }

.tb-levels__fold {
  display: flex; align-items: center; gap: var(--ou-space-2); width: 100%;
  margin-top: var(--ou-space-3); padding-top: var(--ou-space-2);
  border: none; border-top: var(--wf-border-w) solid var(--ou-border-soft);
  background: none; color: var(--ou-fg-default);
  font: var(--ou-text-body-s); text-align: left; cursor: pointer;
}
.tb-levels__chev { color: var(--ou-fg-muted); flex: 0 0 auto; }
.tb-levels__badge { font: var(--ou-text-caption); color: var(--ou-fg-muted); }

.tb-levels__cut { display: grid; grid-template-columns: 88px 1fr 88px; column-gap: var(--ou-space-2); align-items: center; padding: var(--ou-space-2) 0; }
.tb-levels__cutrule { display: flex; align-items: center; gap: var(--ou-space-2); min-width: 0; }
.tb-levels__cutline { flex: 1; height: 1px; background: var(--ou-border-soft); }
.tb-levels__cutlbl { font: var(--ou-text-caption); color: var(--ou-fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.tb-levels__empty {
  border: var(--wf-border-w) dashed var(--ou-border-default); border-radius: var(--ou-radius-m);
  padding: var(--ou-space-6); text-align: center; color: var(--ou-fg-muted);
}
.tb-levels__empty-act { margin-top: var(--ou-space-3); }
```

- [ ] **Шаг 5: убедиться, что тесты проходят**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/levels-editor.test.tsx`

Ожидается: PASS, 9 тестов.

- [ ] **Шаг 6: закоммитить**

```bash
git add client/src/features/tests/editor/sections/levels-editor.tsx \
        client/src/features/tests/editor/sections/__tests__/levels-editor.test.tsx \
        client/src/styles/tb-components.css
git commit -m "feat(prd-45): карточки уровней и лента покрытия вместо таблицы диапазонов"
```

---

## Задача 6: подключение к обеим вкладкам и снятие таблицы

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/scales-section.tsx` (удалить 927-1112, править 739)
- Изменить: `client/src/features/tests/editor/sections/result-variables-section.tsx:85,581-587`
- Изменить: `client/src/styles/tb-components.css`

- [ ] **Шаг 1: удалить `BandsEditor` из `scales-section.tsx`**

Удалить блок от комментария `// ─── Bands editor ───` (строка 927) до закрывающей скобки функции
`BandsEditor` включительно (строка 1112). Удалить из импортов ставшие ненужными `Fragment`,
`FeedbackEditorModal`, `emptyFeedbackValue`, `hasFeedbackContent`, `TONE_OPTIONS`, `Trash2`,
`Textarea` — но только те, что после удаления больше нигде в файле не встречаются: проверить
поиском по файлу перед удалением каждого.

- [ ] **Шаг 2: подключить новый редактор в карточке шкалы**

В `scales-section.tsx` заменить строку 739:

```tsx
      <BandsEditor bands={s.bands} index={index} readOnly={readOnly} onChange={setBands} />
```

на:

```tsx
      <LevelsEditor
        bands={s.bands}
        index={index}
        readOnly={readOnly}
        domain={s.domainMin !== null && s.domainMax !== null
          ? { min: s.domainMin, max: s.domainMax }
          : suggestedDomain}
        onChange={setBands}
      />
```

и добавить импорт рядом с остальными импортами секций:

```tsx
import { LevelsEditor } from "./levels-editor";
```

- [ ] **Шаг 3: подключить новый редактор во вкладке «Показатели»**

В `result-variables-section.tsx` заменить импорт на строке 85:

```tsx
import { bandSpan, DomainFields, VALENCE_OPTIONS, VISIBILITY_OPTIONS } from "./scales-section";
import { LevelsEditor } from "./levels-editor";
```

и вызов на строках 581-587:

```tsx
          <LevelsEditor
            bands={v.bands}
            index={index}
            readOnly={readOnly}
            testIdPrefix="metrics"
            domain={v.domainMin !== null && v.domainMax !== null
              ? { min: v.domainMin, max: v.domainMax }
              : null}
            onChange={(bands) => onChange({ bands })}
          />
```

- [ ] **Шаг 4: сузить область старого CSS**

В `client/src/styles/tb-components.css` заменить комментарий над `.tb-bands-table` (строки 197-201)
на:

```css
/* PRD-29 «Исходы» editor (OutcomesEditor): a row of DS Inputs must FIT the drawer
   pane (it scrolls only vertically) instead of overflowing to the right. Fixed
   layout + full-width, shrinkable inputs make the columns share the available
   width; the actions column is a fixed narrow track for the delete button.
   PRD-45 moved the NUMERIC twin off this table — see .tb-levels below. */
```

- [ ] **Шаг 5: проверить типы**

Запустить: `npm run check`

Ожидается: 0 ошибок. Любая ошибка «`BandsEditor` is not exported» означает пропущенное место
вызова — найти его `grep -rn "BandsEditor" client/src` и заменить.

- [ ] **Шаг 6: прогнать тесты новых модулей**

Запустить:
`npm test -- client/src/features/tests/editor/sections/__tests__/levels-editor.test.tsx client/src/features/tests/editor/sections/__tests__/levels-model.test.ts`

Ожидается: PASS.

- [ ] **Шаг 7: закоммитить**

```bash
git add client/src/features/tests/editor/sections/scales-section.tsx \
        client/src/features/tests/editor/sections/result-variables-section.tsx \
        client/src/styles/tb-components.css
git commit -m "feat(prd-45): обе вкладки переведены на редактор уровней"
```

---

## Задача 7: смежные границы перестают быть пересечением

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/scales-section.tsx:262-281`
- Изменить: `client/src/features/tests/editor/test-editor.validation.ts:675-710`
- Тест: `client/src/features/tests/editor/sections/__tests__/scales-section.coverage.test.tsx`

Без этого шага редактор блокирует сохранение всегда: он теперь ВСЕГДА пишет `min === prevMax`,
а обе проверки считают это пересечением.

- [ ] **Шаг 1: написать падающий тест**

В `__tests__/scales-section.coverage.test.tsx` заменить набор случаев на строках 271-278 на:

```tsx
    ["non-numeric band", [{ min: "x", max: "1", label: "", level: "hi", text: "", tone: "" as const }], /Укажите число/],
    [
      "descending thresholds",
      [
        { min: "0", max: "42", label: "", level: "a", text: "", tone: "" as const },
        { min: "42", max: "29", label: "", level: "b", text: "", tone: "" as const },
      ],
      /должны идти по возрастанию/,
    ],
```

и дописать отдельный тест после этого блока:

```tsx
  it("accepts touching boundaries — that is what the levels editor writes", () => {
    renderStateful(baseModel({ scales: [makeScale({ bands: [
      { min: "0", max: "15", label: "", level: "low", text: "", tone: "" },
      { min: "15", max: "29", label: "", level: "mid", text: "", tone: "" },
    ] })] }));
    expect(screen.queryByTestId("scales-levels-error-0")).toBeNull();
  });
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- client/src/features/tests/editor/sections/__tests__/scales-section.coverage.test.tsx`

Ожидается: FAIL — смежные границы всё ещё дают «пересекается с предыдущим».

- [ ] **Шаг 3: переписать `bandErrorOf`**

В `scales-section.tsx` заменить функцию `bandErrorOf` (строки 261-281) на:

```ts
/**
 * Blocking band error for one scale, delegated to the levels model so the card
 * header, the save gate and the editor itself never disagree about what is wrong.
 */
function bandErrorOf(s: ScaleModel): string | null {
  return draftErrors(bandsToDraft(s.bands)).blocking;
}
```

и добавить импорт:

```ts
import { bandsToDraft, draftErrors } from "./levels-model";
```

- [ ] **Шаг 4: ослабить проверку в `test-editor.validation.ts`**

Заменить строку 701:

```ts
      if (prevMax !== null && min <= prevMax) {
```

на:

```ts
      // PRD-45: the levels editor writes touching boundaries by construction
      // (`bands[i].max === bands[i + 1].min`), and `findBand` resolves the shared
      // point to the LOWER band. Only a real overlap is an error now.
      if (prevMax !== null && min < prevMax) {
```

и текст сообщения на строке 705:

```ts
          message: `Диапазон ${j + 1}: перекрывает предыдущий. Границы уровней должны идти по возрастанию.`,
```

- [ ] **Шаг 5: убедиться, что тесты проходят**

Запустить:
`npm test -- client/src/features/tests/editor/sections/__tests__/scales-section.coverage.test.tsx client/src/features/tests/editor/__tests__/test-editor.validation.test.ts`

Ожидается: PASS. Если в `test-editor.validation` есть случай, ожидающий старый текст
«пересекается с предыдущим», — обновить его на новый.

- [ ] **Шаг 6: закоммитить**

```bash
git add client/src/features/tests/editor/sections/scales-section.tsx \
        client/src/features/tests/editor/test-editor.validation.ts \
        client/src/features/tests/editor/sections/__tests__/scales-section.coverage.test.tsx
git commit -m "fix(prd-45): смежные границы уровней больше не считаются пересечением"
```

---

## Задача 8: перестановка уровней — СНЯТА

**Статус:** снята из охвата 2026-08-07 решением пользователя, переведена в технический долг
(см. §7 спецификации). Не выполнять.

Чистые функции `moveLevel` в `levels-model.ts` и их тесты сохранены и остаются зелёными — они
готовы к подключению, когда до долга дойдёт очередь. Интерфейсной части нет: ручка
перетаскивания удалена из шапки карточки Задачей 7, потому что иконка с курсором «схватить»,
за которой ничего не происходит, обещает автору недоступное действие.

При возврате к задаче учесть: `feedbackFor` в `LevelsEditor` хранится индексом, а не
`clientKey`, поэтому переупорядочивание с открытой модалкой рекомендаций запишет их не тому
уровню — это надо чинить одновременно с подключением перестановки.

---

## Задача 9: починить оставшиеся тесты, обращавшиеся к таблице

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/__tests__/scales-section.coverage.test.tsx`

- [ ] **Шаг 1: увидеть, что именно падает**

Запустить:

```bash
npm test -- \
  client/src/features/tests/editor/sections/__tests__/scales-section.coverage.test.tsx \
  client/src/features/tests/editor/sections/__tests__/result-variables-domain-valence.test.tsx \
  client/src/features/tests/editor/sections/__tests__/interpretation-editor.test.tsx
```

Ожидается: FAIL в `scales-section.coverage.test.tsx` — тест «bands editor: add, edit, and remove
rows» (строки 234-252) ищет `min диапазона 1`, `max диапазона 1`, `метка диапазона 1`,
`уровень диапазона 1` и `scales-band-add-0`, которых больше нет. Тесты `interpretation-editor` и
`result-variables-domain-valence` работают с моделью, а не с разметкой таблицы, и падать не должны.

- [ ] **Шаг 2: переписать тест CRUD под новую разметку**

Заменить тест на строках 234-252 на:

```tsx
  it("levels editor: add, edit, and remove levels (from the empty state)", () => {
    renderStateful(baseModel({ scales: [makeScale({ bands: [] })] }));

    fireEvent.click(screen.getByTestId("scales-level-add-0"));
    const label = screen.getByLabelText("Название уровня 1") as HTMLInputElement;
    fireEvent.change(label, { target: { value: "Низкий" } });
    fireEvent.change(screen.getByLabelText("Код уровня 1"), { target: { value: "low" } });
    expect(label.value).toBe("Низкий");

    fireEvent.click(screen.getByTestId("scales-level-add-0"));
    expect(screen.getByLabelText("Порог между уровнями 1 и 2")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Удалить уровень 2"));
    // One level left → no threshold field, because a threshold needs two levels.
    expect(screen.queryByLabelText("Порог между уровнями 1 и 2")).toBeNull();
  });
```

- [ ] **Шаг 3: проверить оставшиеся обращения к разметке**

Прогнать по файлу поиск `диапазона` и `band-`. Каждое найденное место либо перевести на новые
подписи (`Название уровня N`, `Код уровня N`, `Порог между уровнями N и M`, `Начало`, `Конец`), либо
удалить, если оно проверяло исчезнувшую колонку. Проверку на строке 336
(`expect(table).toHaveTextContent("Высокий")`) заменить на:

```tsx
    expect(screen.getByTestId("scales-levels-0")).toHaveTextContent("Высокий");
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Запустить:
`npm test -- client/src/features/tests/editor/sections/__tests__/`

Ожидается: PASS по всем файлам каталога.

- [ ] **Шаг 5: проверить типы и сборку**

Запустить: `npm run check`

Ожидается: 0 ошибок.

- [ ] **Шаг 6: закоммитить**

```bash
git add client/src/features/tests/editor/sections/__tests__/scales-section.coverage.test.tsx
git commit -m "test(prd-45): тесты редактора уровней вместо таблицы диапазонов"
```

---

## Задача 10: приёмка в браузере

**Файлы:** изменений кода нет; правки по итогам — в затронутый файл.

Модульные тесты не заменяют приёмку: обрезание полей, перенос подписей и уползающая шапка — то,
что видно только в живом окне.

- [ ] **Шаг 1: поднять отдельный экземпляр приложения**

```bash
PORT=8099 npm run dev
```

Отдельный порт, потому что серверные правки не подхватываются уже запущенным dev-сервером, а
чужой запущенный экземпляр останавливать нельзя.

- [ ] **Шаг 2: пройти критерии приёмки спецификации**

Через Playwright (`mcp__playwright__browser_*`) войти под учётной записью приёмки, открыть тест со
шкалой и проверить по списку `docs/specs/prd-45/scale-levels-editor.md` §8: A-01 … A-09. Для A-07
взять шкалу с легаси-парами: если такой нет — временно записать `config_json` с парами `0-15` /
`16-29` напрямую в БД.

- [ ] **Шаг 3: снять скриншоты**

Складывать в `.playwright-mcp/`, не в корень репозитория. Сверять КАЖДУЮ деталь против эскиза
`.superpowers/brainstorm/*/content/wireframe-a-v3.html`: выравнивание торцевых полей с лентой,
отсутствие переносов в ряду чипов, пиктограммы в баннерах, подписи у всех полей.

- [ ] **Шаг 4: зафиксировать результат**

Дописать в `docs/specs/prd-45/scale-levels-editor.md` строку статуса с датой приёмки и списком
пунктов, которые проверены на живом стенде. Закоммитить:

```bash
git add docs/specs/prd-45/scale-levels-editor.md
git commit -m "docs(prd-45): результат приёмки редактора уровней"
```

---

## Покрытие требований спецификации

| Требование | Задача |
| --- | --- |
| FR-01 список карточек, подписи у полей | 5 |
| FR-02 ввод N+1 числом | 1, 5 |
| FR-03 порог достаётся нижнему уровню | 1 |
| FR-04 лента покрытия и торцевые поля | 2, 5 |
| FR-05 вычисляемая подпись диапазона | 5 |
| FR-06 чипы оценки | 4 |
| FR-07 сворачиваемые толкование и рекомендации | 5 |
| FR-08 пустое состояние | 5 |
| FR-09 ошибка порядка на поле и в баннере | 2, 5 |
| FR-10 предупреждение о непокрытом домене | 2, 5, 6 |
| FR-11 ослабление проверки перекрытия | 7 |
| ~~FR-12 перестановка уровней~~ | снята в техдолг 2026-08-07; `moveLevel` в модели готов (задача 3), интерфейса нет |
| FR-13 пиктограммы в баннерах, текст под полями | 5 |
| FR-14 один редактор на обе вкладки | 6 |
| FR-15 уведомление о сомкнутых границах легаси | 2, 5 |
| §5 запись только при обычном сохранении | 5 (компонент не пишет в БД, только в черновик) |
| §8 критерии приёмки A-01 … A-09 | 10 |
