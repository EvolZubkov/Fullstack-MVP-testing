/**
 * @module tests/workbook-outcomes
 *
 * The «Исходы показателей» sheet: the one piece of a result variable the book was missing.
 *
 * An indicator's outcomes — the texts a learner actually READS on the results screen — live
 * in `config_json.outcomes` and had no column anywhere, so a test carried between
 * installations by the book arrived printing the raw scale key instead of the name of a
 * leadership style (PRD-48 §1).
 *
 * The rule under test is the one «Шкалы» already obeys: **the book defines, in full, the
 * fields it has a column for, and does not touch the fields it has none for.** An absent
 * sheet changes nothing; an emptied «Текст» cell CLEARS the text, because that cell is the
 * author's only way to clear it; and the outcome's feedback — attachments and links the book
 * cannot express — survives untouched.
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
    createResultVariable: vi.fn(),
    updateResultVariable: vi.fn(),
    validateResultVariableFormula: vi.fn(),
    getTest: vi.fn(),
    replaceMediaUsages: vi.fn(),
    getMediaAssetByStorageKey: vi.fn(),
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
import { serializeOutcomeRows } from "../server/utils/workbook-sheets";

/** An indicator whose outcomes carry everything the book cannot express. */
const STORED_VARIABLE = {
  id: "rv-style",
  testId: "test-1",
  name: "lead_style",
  label: "Ведущий стиль",
  type: "string",
  formula: "topScale(['vdo'],1).key",
  controlsStatus: "none",
  sortOrder: 0,
  configJson: {
    valence: "none",
    outcomes: [
      {
        code: "vdo",
        label: "Вдохновляющий",
        text: "Ведёт за собой смыслом",
        tone: "favorable",
        feedback: {
          text: "Разберите практику",
          links: [{ title: "Памятка", url: "https://example.test/memo" }],
        },
      },
      { code: "adm", label: "Административный", text: "Опирается на процедуры", tone: "neutral" },
    ],
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

function book(rows: Record<string, unknown>[] | null): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  if (rows) addJsonSheet(wb, "Исходы показателей", rows);
  return wb;
}

const run = (rows: Record<string, unknown>[] | null) =>
  importWorkbook("test-1", book(rows), { dryRun: false });

/** The outcomes as they reached the store on the single update of the run. */
function writtenOutcomes(): Array<Record<string, unknown>> {
  expect(storageMock.updateResultVariable).toHaveBeenCalledTimes(1);
  const config = storageMock.updateResultVariable.mock.calls[0][1].configJson;
  return config.outcomes as Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getScales.mockResolvedValue([]);
  storageMock.getResultVariables.mockResolvedValue([STORED_VARIABLE]);
  storageMock.updateResultVariable.mockResolvedValue(STORED_VARIABLE);
  storageMock.validateResultVariableFormula.mockResolvedValue({ valid: true });
  storageMock.getTest.mockResolvedValue({ id: "test-1", title: "Тест" });
  storageMock.replaceMediaUsages.mockResolvedValue(undefined);
});

describe("лист «Исходы показателей»", () => {
  it("переживает круг «выгрузил — загрузил» без потерь", async () => {
    const rows = serializeOutcomeRows(STORED_VARIABLE);
    expect(rows).toHaveLength(2);

    await run(rows);

    const outcomes = writtenOutcomes();
    expect(outcomes.map((o) => o.code)).toEqual(["vdo", "adm"]);
    expect(outcomes[0]).toMatchObject({
      code: "vdo",
      label: "Вдохновляющий",
      text: "Ведёт за собой смыслом",
      tone: "favorable",
    });
  });

  it("не трогает сохранённые исходы, когда листа нет", async () => {
    await run(null);

    expect(storageMock.updateResultVariable).not.toHaveBeenCalled();
  });

  it("пустая ячейка «Текст» очищает текст исхода", async () => {
    const rows = serializeOutcomeRows(STORED_VARIABLE);
    rows[0]["Текст"] = "";

    await run(rows);

    expect(writtenOutcomes()[0].text).toBeUndefined();
  });

  it("отсутствие колонки «Тональность» оставляет сохранённую тональность", async () => {
    const rows = serializeOutcomeRows(STORED_VARIABLE).map((row) => {
      const { ["Тональность"]: _tone, ...rest } = row;
      return rest;
    });

    await run(rows);

    expect(writtenOutcomes()[0].tone).toBe("favorable");
  });

  it("сохраняет обратную связь исхода: книга её не несёт", async () => {
    await run(serializeOutcomeRows(STORED_VARIABLE));

    expect(writtenOutcomes()[0].feedback).toEqual({
      text: "Разберите практику",
      links: [{ title: "Памятка", url: "https://example.test/memo" }],
    });
  });

  it("не трогает показатель, о котором лист молчит", async () => {
    storageMock.getResultVariables.mockResolvedValue([
      STORED_VARIABLE,
      { ...STORED_VARIABLE, id: "rv-other", name: "other_var" },
    ]);

    await run(serializeOutcomeRows(STORED_VARIABLE));

    expect(storageMock.updateResultVariable).toHaveBeenCalledTimes(1);
    expect(storageMock.updateResultVariable.mock.calls[0][0]).toBe("rv-style");
  });
});
