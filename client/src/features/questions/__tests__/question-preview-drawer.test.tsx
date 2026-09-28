// @vitest-environment jsdom
/**
 * @module features/questions/__tests__/question-preview-drawer.test
 *
 * PRD-57 FR-24g: предпросмотр задания — окно по кнопке подвала.
 *
 * Проверяется то, ради чего требование заведено: окно показывает ТЕКУЩИЙ черновик (а не
 * сохранённое задание), разметку для него считает сервер, и ввод в демонстрационные поля
 * никуда не уходит.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { chooseQuestionType } from "./helpers/question-type";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Topic } from "@shared/schema";

const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

/**
 * Сцена участника подменена: она монтирует Shadow DOM и тянет разметку шаблона, а здесь
 * проверяется НЕ она, а то, что окно передаёт ей. Подмена печатает полученное — так видно
 * и текст, и то, что он пришёл уже размеченным.
 */
vi.mock("@/pages/learner/template-question-screen", () => ({
  TemplateQuestionScreen: (props: { question: { promptHtml?: string; type: string } }) => (
    <div data-testid="preview-screen" data-type={props.question.type}>
      <div data-testid="preview-prompt" dangerouslySetInnerHTML={{ __html: props.question.promptHtml ?? "" }} />
    </div>
  ),
}));

import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";
import { ToastProvider } from "@skillum/ui-kit";

const topics = [{ id: "t1", name: "Охрана труда" }] as unknown as Topic[];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/api/questions/preview")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ promptHtml: '<pre class="tb-code"><code>SELECT 1;</code></pre>' }),
        text: async (): Promise<string> => "{}",
      };
    }
    // Файлы шаблона предпросмотра.
    return {
      ok: true,
      status: 200,
      json: async () => ({ manifest: {}, demo: null, layouts: { question: "<div data-slot=\"question-text\"></div>" }, css: "" }),
      text: async (): Promise<string> => "{}",
    };
  });
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

describe("предпросмотр задания", () => {
  it("кнопка стоит в подвале ящика", () => {
    renderDrawer();
    expect(screen.getByTestId("button-preview-question")).toBeTruthy();
  });

  it("окно открывается кнопкой и рисует задание сценой участника", async () => {
    renderDrawer();
    const prompt = screen.getByTestId("input-question-prompt");
    fireEvent.change(prompt, { target: { value: "Что выведет код?" } });

    fireEvent.click(screen.getByTestId("button-preview-question"));
    // Окно опознаётся по заголовку: `ModalDialog` не пробрасывает `data-testid` на корень.
    expect(await screen.findByText("Предпросмотр вопроса")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("preview-screen")).toBeTruthy());
  });

  it("разметку считает СЕРВЕР: в окно приходит подсвеченный листинг", async () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "Что выведет код?\n\n```sql\nSELECT 1;\n```" },
    });
    fireEvent.click(screen.getByTestId("button-preview-question"));

    await waitFor(() => expect(screen.getByTestId("preview-prompt").innerHTML).toContain("tb-code"));
    const asked = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/questions/preview"));
    expect(asked).toBeTruthy();
    expect(JSON.parse(String((asked![1] as { body: string }).body)).prompt).toContain("```sql");
  });

  it("показывает ТЕКУЩИЙ черновик, а не сохранённое задание", async () => {
    renderDrawer();
    chooseQuestionType("Развёрнутый ответ");
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Опишите порядок." } });
    fireEvent.click(screen.getByTestId("button-preview-question"));

    await waitFor(() => expect(screen.getByTestId("preview-screen").getAttribute("data-type")).toBe("long"));
  });

  it("окно закрывается и ничего не сохраняет", async () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Текст" } });
    fireEvent.click(screen.getByTestId("button-preview-question"));
    await screen.findByText("Предпросмотр вопроса");

    // Кнопка подвала окна, а не крестик ящика: «Закрыть» в разметке две.
    fireEvent.click(screen.getAllByRole("button", { name: "Закрыть" }).at(-1)!);
    await waitFor(() => expect(screen.queryByTestId("preview-screen")).toBeNull());
    // Ни одного обращения к сохранению задания: предпросмотр читает и только.
    const saved = fetchMock.mock.calls.filter((call) => {
      const method = (call[1] as { method?: string } | undefined)?.method ?? "GET";
      return String(call[0]).endsWith("/api/questions") && method !== "GET";
    });
    expect(saved).toHaveLength(0);
  });
});
