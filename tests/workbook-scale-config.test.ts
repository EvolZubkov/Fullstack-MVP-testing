/**
 * @module tests/workbook-scale-config
 *
 * The book must not destroy a scale's interpretation.
 *
 * The rule under test: **the book defines, in full, the fields it has a column for,
 * and does not touch the fields it has no column for.** A «Шкалы» row carries the
 * bands and nothing else of `config_json`, so the domain, the valence, the display
 * limit and every level's text/tone/feedback have to survive a round trip through
 * the book — while an emptied «Диапазоны» cell still REMOVES the levels, because
 * that cell is the only way an author can clear them.
 *
 * Regression: import used to write `configJson: { bands }` wholesale, so «export →
 * import» with nothing edited erased the domain, the valence, `displayMax` (PRD-46)
 * and all PRD-29/PRD-32 level feedback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://fake/test";
});

const { storageMock, testSettingsMock } = vi.hoisted(() => ({
  storageMock: {
    getTopics: vi.fn(),
    getScales: vi.fn(),
    createScale: vi.fn(),
    updateScale: vi.fn(),
    getResultVariables: vi.fn(),
    validateResultVariableFormula: vi.fn(),
    getTest: vi.fn(),
  },
  testSettingsMock: { create: vi.fn(), save: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/test-settings", () => ({
  testSettingsService: testSettingsMock,
  __esModule: true,
}));

import ExcelJS from "exceljs";
import { addJsonSheet } from "../server/utils/excel";
import { importWorkbook } from "../server/services/workbook-import";
import { serializeScaleRow } from "../server/utils/workbook-sheets";

/** Everything a scale carries beyond the columns of the «Шкалы» sheet. */
const RICH_CONFIG = {
  domainMin: 0,
  domainMax: 60,
  displayMax: 35,
  valence: "lower_is_better",
  bands: [
    {
      min: 0,
      max: 29,
      level: "low",
      label: "Низкий",
      text: "Ресурс в норме",
      tone: "favorable",
      feedback: {
        text: "Поддерживайте режим",
        links: [{ title: "Памятка", url: "https://example.test/memo" }],
      },
    },
    {
      min: 30,
      max: 60,
      level: "high",
      label: "Высокий",
      text: "Признаки истощения",
      tone: "critical",
      feedback: {
        text: "Обсудите нагрузку с руководителем",
        assets: [{ title: "Буклет", url: "/uploads/media/burnout.pdf" }],
      },
    },
  ],
};

const STORED_SCALE = {
  id: "scale-ee",
  testId: "test-1",
  key: "ee",
  label: "Эмоциональное истощение",
  description: null,
  type: "number",
  aggregation: "sum",
  normalization: "none",
  direction: "positive",
  configJson: RICH_CONFIG,
  learnerVisibility: "level" as const,
  scormTarget: "none",
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function book(rows: Record<string, unknown>[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  addJsonSheet(wb, "Шкалы", rows);
  return wb;
}

const run = (rows: Record<string, unknown>[], dryRun = false) =>
  importWorkbook("test-1", book(rows), { dryRun });

/** `config_json` as it reached the store on the single update of the run. */
function writtenConfig(): Record<string, unknown> {
  expect(storageMock.updateScale).toHaveBeenCalledTimes(1);
  return storageMock.updateScale.mock.calls[0][1].configJson;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getScales.mockResolvedValue([STORED_SCALE]);
  storageMock.createScale.mockImplementation(async (s: any) => ({ id: "scale-new", ...s }));
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.validateResultVariableFormula.mockResolvedValue({ valid: true });
  storageMock.getTest.mockResolvedValue({ id: "test-1", title: "Опросник", status: "draft" });
});

describe("«Шкалы»: export → import keeps the interpretation", () => {
  it("survives a round trip with nothing edited", async () => {
    const res = await run([serializeScaleRow(STORED_SCALE)]);

    expect(res.errors).toEqual([]);
    expect(res.scales).toEqual({ created: 0, updated: 1 });
    // Byte-for-byte the interpretation the author authored in the editor.
    expect(writtenConfig()).toEqual(RICH_CONFIG);
  });

  it("keeps the domain, the valence and the display limit of a legacy book", async () => {
    // A book written before those columns existed carries the bands only.
    const res = await run([
      {
        "Ключ": "ee",
        "Название": "Эмоциональное истощение",
        "Тип": "number",
        "Диапазоны": "0..29 low «Низкий»; 30..60 high «Высокий»",
      },
    ]);

    expect(res.errors).toEqual([]);
    const config = writtenConfig();
    expect(config.domainMin).toBe(0);
    expect(config.domainMax).toBe(60);
    expect(config.displayMax).toBe(35);
    expect(config.valence).toBe("lower_is_better");
  });
});

describe("«Диапазоны»: the cell owns the levels", () => {
  it("removes the levels when the cell is emptied", async () => {
    const res = await run([{ ...serializeScaleRow(STORED_SCALE), "Диапазоны": "" }]);

    expect(res.errors).toEqual([]);
    const config = writtenConfig();
    // Emptying the cell is the author's only way to clear the levels — it must work.
    expect(config.bands).toEqual([]);
    // …and it must not take the rest of the interpretation with it.
    expect(config.domainMin).toBe(0);
    expect(config.valence).toBe("lower_is_better");
  });

  it("carries a level's text and feedback across an edit of its bounds", async () => {
    const res = await run([
      { ...serializeScaleRow(STORED_SCALE), "Диапазоны": "0..24 low «Низкий»; 25..60 high «Высокий»" },
    ]);

    expect(res.errors).toEqual([]);
    const bands = writtenConfig().bands as any[];
    expect(bands.map((b) => [b.min, b.max])).toEqual([[0, 24], [25, 60]]);
    // The book has no column for these — the level keeps what the editor gave it.
    expect(bands[0].text).toBe("Ресурс в норме");
    expect(bands[0].feedback).toEqual(RICH_CONFIG.bands[0].feedback);
    expect(bands[1].tone).toBe("critical");
  });

  it("drops the content of a level the book no longer names", async () => {
    const res = await run([
      { ...serializeScaleRow(STORED_SCALE), "Диапазоны": "0..60 mid «Средний»" },
    ]);

    expect(res.errors).toEqual([]);
    const bands = writtenConfig().bands as any[];
    expect(bands).toEqual([{ min: 0, max: 60, level: "mid", label: "Средний" }]);
  });
});

describe("the three columns the book gained", () => {
  it("sets the domain, the display limit and the favourable direction", async () => {
    const res = await run([
      {
        ...serializeScaleRow(STORED_SCALE),
        "Границы шкалы": "-10..40",
        "Предел показа": 25,
        "Благоприятное направление": "Чем больше, тем лучше",
      },
    ]);

    expect(res.errors).toEqual([]);
    const config = writtenConfig();
    expect(config.domainMin).toBe(-10);
    expect(config.domainMax).toBe(40);
    expect(config.displayMax).toBe(25);
    expect(config.valence).toBe("higher_is_better");
  });

  it("clears a field when the cell of a column the book HAS is empty", async () => {
    const res = await run([
      {
        ...serializeScaleRow(STORED_SCALE),
        "Границы шкалы": "",
        "Предел показа": "",
        "Благоприятное направление": "",
      },
    ]);

    expect(res.errors).toEqual([]);
    const config = writtenConfig();
    // The distinction that carries the meaning: an empty CELL is «clear it», an
    // absent COLUMN is «the book does not set this» (asserted on the legacy book above).
    expect(config.domainMin).toBeNull();
    expect(config.domainMax).toBeNull();
    expect(config.displayMax).toBeNull();
    expect(config.valence).toBe("none");
  });

  it("refuses half a domain with a readable reason", async () => {
    const res = await run([{ ...serializeScaleRow(STORED_SCALE), "Границы шкалы": "0.." }]);

    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("Границы шкалы");
    expect(storageMock.updateScale).not.toHaveBeenCalled();
  });

  it("exports what it imports", () => {
    const row = serializeScaleRow(STORED_SCALE);
    expect(row["Границы шкалы"]).toBe("0..60");
    expect(row["Предел показа"]).toBe(35);
    expect(row["Благоприятное направление"]).toBe("Чем больше, тем хуже");
  });
});

describe("a scale the book creates", () => {
  it("gets exactly what the book says, with nothing merged into it", async () => {
    storageMock.getScales.mockResolvedValue([]);

    const res = await run([
      { "Ключ": "de", "Название": "Деперсонализация", "Тип": "number", "Диапазоны": "0..10 low" },
    ]);

    expect(res.errors).toEqual([]);
    expect(res.scales).toEqual({ created: 1, updated: 0 });
    expect(storageMock.createScale.mock.calls[0][0].configJson).toEqual({
      bands: [{ min: 0, max: 10, level: "low" }],
    });
  });
});

describe("предпросмотр", () => {
  it("writes nothing while reporting the same plan", async () => {
    const res = await run([serializeScaleRow(STORED_SCALE)], true);

    expect(res.errors).toEqual([]);
    expect(res.scales).toEqual({ created: 0, updated: 1 });
    expect(storageMock.updateScale).not.toHaveBeenCalled();
  });
});
