// @vitest-environment jsdom
/**
 * @module features/questions/__tests__/prompt-format-drawer.test
 *
 * PRD-57 §4.3: режим ввода текста задания переключается над полем, и переключение не
 * теряет содержимого молча (FR-09c).
 *
 * Проверяется то, что автор увидит первым: переключатель на месте, перевод спрашивает
 * согласия, и формат уезжает на сервер вместе с текстом — без него набранное тегами
 * прочиталось бы как разметка.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Question, Topic } from "@shared/schema";

const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";
import { ToastProvider } from "@skillum/ui-kit";

const topics = [{ id: "t1", name: "Охрана труда" }] as unknown as Topic[];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "new-id" }),
    text: async (): Promise<string> => JSON.stringify({ id: "new-id" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderDrawer(overrides: Partial<QuestionEditorDrawerProps> = {}) {
  const props: QuestionEditorDrawerProps = {
    open: true,
    question: null,
    topics,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    defaultTopicId: "t1",
    ...overrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><ToastProvider>
      <QuestionEditorDrawer {...props} />
    </ToastProvider></QueryClientProvider>,
  );
}

/** Тело последнего сохранения задания. */
function savedBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/questions"));
  return JSON.parse(String((call![1] as { body: string }).body));
}

describe("переключатель режимов", () => {
  it("стоит над полем текста", () => {
    renderDrawer();
    expect(screen.getByTestId("seg-prompt-format")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Разметка" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "HTML" })).toBeTruthy();
  });

  it("новое задание открывается в разметке: так написаны все прежние", () => {
    renderDrawer();
    expect(screen.getByRole("button", { name: "Разметка" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("сохранённое задание открывается в своём режиме", () => {
    const htmlQuestion = {
      id: "q1", topicId: "t1", type: "single",
      prompt: "<p>Текст</p>", promptFormat: "html",
      dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
      tags: [], feedbackMode: "general",
    } as unknown as Question;
    renderDrawer({ question: htmlQuestion });
    expect(screen.getByRole("button", { name: "HTML" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("переключение с переводом", () => {
  it("спрашивает согласия и называет, что произойдёт", async () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "Текст **жирный**" },
    });
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));

    expect(await screen.findByText("Перевести текст в HTML?")).toBeTruthy();
    expect(screen.getByText(/станут тегами/)).toBeTruthy();
    // До согласия текст не тронут.
    expect((screen.getByTestId("input-question-prompt") as HTMLTextAreaElement).value)
      .toBe("Текст **жирный**");
  });

  it("после согласия текст переведён", async () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "Текст **жирный**" },
    });
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));
    fireEvent.click(await screen.findByTestId("confirm-mode-switch"));

    await waitFor(() => expect((screen.getByTestId("input-question-prompt") as HTMLTextAreaElement).value)
      .toContain("<strong>жирный</strong>"));
  });

  it("отмена оставляет и текст, и режим прежними", async () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Текст" } });
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));
    // «Отмена» две: в подвале ящика и в окне перехода — нужна вторая.
    fireEvent.click(screen.getAllByRole("button", { name: "Отмена" }).at(-1)!);

    await waitFor(() => expect(screen.queryByText("Перевести текст в HTML?")).toBeNull());
    expect((screen.getByTestId("input-question-prompt") as HTMLTextAreaElement).value).toBe("Текст");
    expect(screen.getByRole("button", { name: "Разметка" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("обратный перевод называет непредставимое числами (FR-09c)", async () => {
    const htmlQuestion = {
      id: "q1", topicId: "t1", type: "single",
      prompt: '<table><tr><td>1</td></tr></table><p class="lead">Текст</p>',
      promptFormat: "html",
      dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
      tags: [], feedbackMode: "general",
    } as unknown as Question;
    renderDrawer({ question: htmlQuestion });

    fireEvent.click(screen.getByRole("button", { name: "Разметка" }));
    expect(await screen.findByTestId("mode-switch-losses")).toBeTruthy();
    expect(screen.getByText(/Таблица — 1/)).toBeTruthy();
  });
});

describe("сохранение", () => {
  /** Заполнить минимально валидное задание с одиночным выбором. */
  const fillValid = (prompt: string) => {
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: prompt } });
    fireEvent.change(screen.getByTestId("input-option-0"), { target: { value: "Париж" } });
    fireEvent.change(screen.getByTestId("input-option-1"), { target: { value: "Лондон" } });
  };

  it("формат уезжает вместе с текстом", async () => {
    renderDrawer();
    fillValid("Текст");
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));
    fireEvent.click(await screen.findByTestId("confirm-mode-switch"));

    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(savedBody().promptFormat).toBe("html");
  });

  it("у обычного задания формат — разметка", async () => {
    renderDrawer();
    fillValid("Текст");
    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(savedBody().promptFormat).toBe("markdown");
  });
});

/**
 * PRD-57 FR-09b: визуальный режим. Проверяется не «редактор нарисовался», а то, ради чего
 * требование написано: механики в поле живут едиными объектами и переживают правку.
 */
describe("режим «Форматированный»", () => {
  it("предлагается третьим в переключателе", () => {
    renderDrawer();
    expect(screen.getByRole("button", { name: "Форматированный" })).toBeTruthy();
  });

  it("открывает поле визуального ввода с панелью форматирования", async () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Текст" } });
    fireEvent.click(screen.getByRole("button", { name: "Форматированный" }));
    fireEvent.click(await screen.findByTestId("confirm-mode-switch"));

    expect(await screen.findByTestId("input-question-prompt-rich")).toBeTruthy();
    expect(screen.getByTestId("rich-bold")).toBeTruthy();
    expect(screen.getByTestId("rich-link")).toBeTruthy();
  });

  it("механики показаны атомарными узлами (FR-09b)", async () => {
    const richQuestion = {
      id: "q1", topicId: "t1", type: "single",
      prompt: "<p>Столица — {{city}}, доля $$E = mc^2$$.</p>",
      promptFormat: "richText",
      dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
      tags: [], feedbackMode: "general",
    } as unknown as Question;
    renderDrawer({ question: richQuestion });

    const area = await screen.findByTestId("input-question-prompt-rich");
    const atoms = area.querySelectorAll("[data-atom]");
    expect(atoms.length).toBe(2);
    for (const atom of Array.from(atoms)) {
      expect(atom.getAttribute("contenteditable")).toBe("false");
    }
  });

  it("сохраняет текст без служебных узлов: в базу уезжает разметка", async () => {
    const richQuestion = {
      id: "q1", topicId: "t1", type: "single",
      prompt: "<p>Столица — {{city}}.</p>",
      promptFormat: "richText",
      dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
      tags: [], feedbackMode: "general",
    } as unknown as Question;
    renderDrawer({ question: richQuestion });

    const area = await screen.findByTestId("input-question-prompt-rich");
    fireEvent.blur(area);

    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(guardMock).toHaveBeenCalled());
    const body = guardMock.mock.calls.at(-1)![0].body as { prompt: string; promptFormat: string };
    expect(body.promptFormat).toBe("richText");
    expect(body.prompt).toContain("{{city}}");
    expect(body.prompt).not.toContain("data-atom");
  });
});

/**
 * Вид механик в визуальном поле — как у участника (согласованный эскиз).
 *
 * Подсветка и картинка формулы считаются только на сервере, поэтому поле берёт их оттуда.
 * Проверяется и то, что при этом НЕ ломается: сохранение возвращает исходник, а не
 * показанный вид.
 */
describe("вид механик в визуальном поле", () => {
  const richQuestion = {
    id: "q1", topicId: "t1", type: "single",
    prompt: '<p>Код:</p><pre><code class="language-sql">SELECT 1;</code></pre>',
    promptFormat: "richText",
    dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
    tags: [], feedbackMode: "general",
  } as unknown as Question;

  /** Ответ выдачи: тот самый подсвеченный листинг. */
  const rendered = '<p>Код:</p><pre class="tb-code" data-lang="sql"><code>'
    + '<span class="tb-code__kw">SELECT</span> 1;</code></pre>';

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes("/api/questions/preview")
        ? { promptHtml: rendered }
        : { id: "new-id" }),
      text: async (): Promise<string> => JSON.stringify({ id: "new-id" }),
    }));
  });

  it("поле спрашивает вид у сервера", async () => {
    renderDrawer({ question: richQuestion });
    await screen.findByTestId("input-question-prompt-rich");
    await waitFor(() => expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/questions/preview")),
    ).toBe(true));
  });

  it("листинг показан подсвеченным", async () => {
    renderDrawer({ question: richQuestion });
    const area = await screen.findByTestId("input-question-prompt-rich");
    await waitFor(() => expect(area.querySelector(".tb-code__kw")).toBeTruthy());
  });

  it("сохраняется ИСХОДНИК, а не показанный вид", async () => {
    renderDrawer({ question: richQuestion });
    const area = await screen.findByTestId("input-question-prompt-rich");
    await waitFor(() => expect(area.querySelector(".tb-code__kw")).toBeTruthy());

    fireEvent.blur(area);
    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(guardMock).toHaveBeenCalled());
    const body = guardMock.mock.calls.at(-1)![0].body as { prompt: string };
    expect(body.prompt).toBe('<p>Код:</p><pre><code class="language-sql">SELECT 1;</code></pre>');
    expect(body.prompt).not.toContain("tb-code__kw");
  });

  it("сервер не ответил — поле остаётся рабочим с записями", async () => {
    fetchMock.mockImplementation(async (url: string) => (
      String(url).includes("/api/questions/preview")
        ? { ok: false, status: 500, json: async () => ({}), text: async (): Promise<string> => "{}" }
        : { ok: true, status: 200, json: async () => ({ id: "new-id" }), text: async (): Promise<string> => "{}" }
    ));
    renderDrawer({ question: richQuestion });
    const area = await screen.findByTestId("input-question-prompt-rich");
    expect(area.querySelector("[data-atom]")).toBeTruthy();
    expect(area.textContent).toContain("SELECT 1;");
  });
});
