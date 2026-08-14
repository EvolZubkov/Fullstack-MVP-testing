/**
 * @module features/tests/transfer/__tests__/import-dialog.test
 *
 * The form of the selective import (PRD-48 task 6). What is proved here is the promise the
 * three steps exist for: the author sees WHAT will happen before anything is written, the
 * plan is recomputed on every change of an option, and the button that writes is out of
 * reach while the plan shown is stale.
 *
 * `fetch` is stubbed per URL, so the three steps resolve against fixtures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TransferImportDialog } from "../import-dialog";

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

const summary = {
  formatVersion: 1,
  exportedAt: "2026-08-12T09:00:00.000Z",
  appVersion: "2.13.0",
  test: { id: "src-test", title: "Опросник лидерства", exists: true },
  parts: {
    structure: { sections: 3, topics: 2, questions: 32 },
    scoring: { overrides: 3, hasPassRule: true },
    scales: { scales: 4, measurements: 56, resultVariables: 5 },
    results: { contentPages: 4 },
    media: { files: 3 },
  },
  topics: [
    { id: "topic-a", name: "Человекоцентричное лидерство", questions: 14, state: "existing" },
    { id: "topic-b", name: "Делегирование", questions: 18, state: "foreign" },
  ],
  missingMedia: ["/api/media/9f31"],
};

/** The plan answers with a deletion only when a `replace` mode was asked for. */
function planFor(body: Record<string, unknown>) {
  const modes = (body.modes ?? {}) as { scales?: string };
  const operations = [
    { kind: "update", entity: "test", id: "src-test", sourceId: "src-test", title: "Опросник лидерства" },
    { kind: "create", entity: "question", id: "q-2", sourceId: "q-2", title: "Второй вопрос" },
  ];
  if (modes.scales === "replace") {
    operations.push({
      kind: "delete",
      entity: "scale",
      id: "tgt-old",
      title: "Отменённая шкала",
    } as never);
  }
  return { operations, summary };
}

let fetchMock: ReturnType<typeof vi.fn>;
let planCalls = 0;

beforeEach(() => {
  planCalls = 0;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/transfer/inspect")) return jsonRes({ token: "tok-1", summary });
    if (url.endsWith("/transfer/plan")) {
      planCalls++;
      return jsonRes(planFor(JSON.parse(String(init?.body ?? "{}"))));
    }
    if (url.endsWith("/transfer/apply")) {
      return jsonRes({
        testId: "src-test",
        created: { question: 1 },
        updated: { test: 1 },
        deleted: {},
        renamedTopics: [],
        mediaCreated: 1,
        mediaReused: 2,
        missingMedia: [],
      });
    }
    return jsonRes({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderDialog() {
  return render(<TransferImportDialog open onClose={() => {}} onDone={() => {}} />);
}

function pkg(name = "test.tbtest"): File {
  return new File(["zip"], name, { type: "application/zip" });
}

/** The modal renders into a portal, so the file input is looked up in the document. */
function fileInput(): HTMLInputElement {
  const el = document.body.querySelector('input[type="file"]');
  if (!el) throw new Error("file input not found");
  return el as HTMLInputElement;
}

/** Walks the dialog to step 2 by choosing a package. */
async function toStepTwo() {
  const input = fileInput();
  fireEvent.change(input, { target: { files: [pkg()] } });
  await screen.findByText("Структура и вопросы");
}

describe("форма выборочного импорта", () => {
  it("на первом шаге просит файл и ничего не записывает", () => {
    renderDialog();

    expect(fileInput()).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("после выбора пакета показывает состав по пяти частям и заголовок теста", async () => {
    renderDialog();

    await toStepTwo();

    expect(screen.getByText(/Опросник лидерства/)).toBeInTheDocument();
    expect(screen.getByText("Шкалы и показатели")).toBeInTheDocument();
    expect(screen.getByText("Оценивание")).toBeInTheDocument();
    expect(screen.getByText("Итоги и оформление")).toBeInTheDocument();
    expect(screen.getByText("Медиа")).toBeInTheDocument();
    // Counters come from the package, not from a guess.
    expect(screen.getByText(/32 вопроса/)).toBeInTheDocument();
    expect(screen.getByText(/4 шкалы/)).toBeInTheDocument();
  });

  it("показывает состояние каждой темы пакета", async () => {
    renderDialog();

    await toStepTwo();

    expect(screen.getByText("Человекоцентричное лидерство")).toBeInTheDocument();
    expect(screen.getByText("Делегирование")).toBeInTheDocument();
    // A topic without manage rights offers ONE option, and says why.
    expect(screen.getByText(/нет прав управления/)).toBeInTheDocument();
  });

  it("предупреждает о медиа, которое не доехало из источника", async () => {
    renderDialog();

    await toStepTwo();

    expect(screen.getByText(/не доехал/i)).toBeInTheDocument();
  });

  it("пересчитывает план при смене режима и показывает удаляемое поимённо", async () => {
    renderDialog();
    await toStepTwo();
    await waitFor(() => expect(planCalls).toBe(1));

    const scalesMode = screen.getByTestId("transfer-mode-scales");
    fireEvent.click(within(scalesMode).getByRole("button", { name: "Заменить" }));

    await waitFor(() => expect(planCalls).toBe(2));
    expect(await screen.findByText(/Будет удалено/)).toBeInTheDocument();
    expect(screen.getByText(/Отменённая шкала/)).toBeInTheDocument();
  });

  it("не даёт применить план, которого автор ещё не видел", async () => {
    renderDialog();
    await toStepTwo();
    await waitFor(() => expect(planCalls).toBe(1));

    // While the recomputation is in flight the writing button must be unavailable.
    let release: (() => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(jsonRes(planFor({})));
        }),
    );
    fireEvent.click(screen.getByTestId("transfer-part-media"));

    await waitFor(() =>
      expect(screen.getByTestId("transfer-apply")).toBeDisabled(),
    );
    release?.();
    await waitFor(() => expect(screen.getByTestId("transfer-apply")).toBeEnabled());
  });

  it("применяет и показывает отчёт", async () => {
    renderDialog();
    await toStepTwo();
    await waitFor(() => expect(planCalls).toBe(1));

    fireEvent.click(screen.getByTestId("transfer-apply"));

    expect(await screen.findByText(/Импорт выполнен/)).toBeInTheDocument();
  });
});
