/**
 * @module client/features/questions/__tests__/question-editor-scenario
 *
 * «Сценарий в ИС» в ящике вопроса — согласованный эскиз `docs/wireframes/sim-scenario-question.html`.
 *
 * Проверяется то, что отличает тип: вместо вариантов ответа — загрузка архива; принятый
 * сценарий называется по `meta.title`, а не по имени файла; отказ показывает перечень ошибок
 * и имя файла; пустой текст задания берётся из сценария; без сценария сохранить нельзя.
 *
 * Обвязка (мок охраны содержимого, заглушка fetch) повторяет соседние файлы ящика.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { chooseQuestionType, questionTypeOptions } from "./helpers/question-type";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Question, Topic } from "@shared/schema";

const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";
import { ToastProvider } from "@skillum/ui-kit";

const topics = [{ id: "t1", name: "Работа в СЭД" }] as unknown as Topic[];

const scenario = {
  format: "skillum.sim-scenario",
  version: 1,
  meta: { title: "Регистрация входящего письма", task: "Зарегистрируйте письмо", system: "СЭД" },
  settings: { stage: { w: 1920, h: 1200 }, limitSeconds: 300 },
  media: [{ id: "home", file: "/api/media/a1", w: 1920, h: 1200 }],
  fields: [],
  start: "home",
  scenes: [
    { id: "home", title: "Главная", elements: [{ id: "bg", media: "home", x: 0, y: 0 }], zones: [{ id: "go", x: 0, y: 0, w: 10, h: 10, role: "path", effects: [{ goto: "done" }] }] },
    { id: "done", title: "Готово", elements: [], goal: { outcome: "success" } },
  ],
};

const accepted = { ok: true, errors: [], warnings: ["Сцена «Сирота» недостижима от старта"], summary: null, mediaBytes: 1153433, dataJson: { scenario } };
const rejected = { ok: false, errors: ["Зона delete-yes: у ловушки не задано название ошибки"], warnings: [], summary: null };

let fetchMock: ReturnType<typeof vi.fn>;
function stubFetch(archiveAnswer: unknown) {
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes("scenario-archive") ? archiveAnswer : { id: "new-id" }),
    text: async () => "{}",
  }));
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  guardMock.mockReset();
  stubFetch(accepted);
});
afterEach(() => vi.unstubAllGlobals());

function renderDrawer(overrides: Partial<QuestionEditorDrawerProps> = {}) {
  const props: QuestionEditorDrawerProps = { open: true, question: null, topics, defaultTopicId: "t1", onClose: vi.fn(), onSaved: vi.fn(), ...overrides };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><ToastProvider>
      <QuestionEditorDrawer {...props} />
    </ToastProvider></QueryClientProvider>,
  );
}

function uploadArchive(name = "registraciya.scenario.zip") {
  // The DS uploader keeps its file input as the next sibling of the drop zone.
  const input = screen.getByTestId("scenario-uploader").nextElementSibling as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["zip"], name, { type: "application/zip" })] } });
}

describe("ящик вопроса «Сценарий»", () => {
  it("тип объявлен в списке типов", () => {
    renderDrawer();
    expect(questionTypeOptions()).toContain("Сценарий");
  });

  it("вместо вариантов, порядка вариантов и медиа — загрузка архива; предпросмотра нет", () => {
    renderDrawer();
    chooseQuestionType("Сценарий");
    expect(screen.getByTestId("scenario-uploader")).toBeInTheDocument();
    expect(screen.queryByTestId("switch-shuffle-answers")).not.toBeInTheDocument();
    expect(screen.queryByTestId("uploader-question-media")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-preview-question")).not.toBeInTheDocument();
    expect(screen.getByText("Загрузите архив сценария")).toBeInTheDocument();
  });

  it("принятый архив показывает сценарий по названию, сводку и «Сыграть»; текст задания берётся из сценария", async () => {
    renderDrawer();
    chooseQuestionType("Сценарий");
    uploadArchive();
    const card = await screen.findByTestId("scenario-accepted");
    expect(within(card).getByText("Регистрация входящего письма")).toBeInTheDocument();
    expect(within(card).queryByText(/registraciya/)).not.toBeInTheDocument();
    expect(within(card).getByText("Сценарий · СЭД · сцена 1920 × 1200 · 1,1 МБ")).toBeInTheDocument();
    expect(screen.getByText("2 сцены")).toBeInTheDocument();
    expect(screen.getByText("лимит 5:00")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-warnings")).toHaveTextContent("Сирота");
    expect(screen.getByTestId("scenario-play")).toBeInTheDocument();
    expect((screen.getByTestId("input-question-prompt") as HTMLTextAreaElement).value).toBe("Зарегистрируйте письмо");
    expect(screen.queryByText("Загрузите архив сценария")).not.toBeInTheDocument();
  });

  it("отказ показывает имя файла и перечень ошибок, сохранить нельзя", async () => {
    stubFetch(rejected);
    renderDrawer();
    chooseQuestionType("Сценарий");
    uploadArchive("broken.scenario.zip");
    const card = await screen.findByTestId("scenario-rejected");
    expect(within(card).getByText("broken.scenario.zip")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-errors")).toHaveTextContent("Архив не принят: 1 ошибка");
    expect(screen.getByTestId("scenario-errors")).toHaveTextContent("у ловушки не задано название ошибки");
    expect(screen.getByTestId("button-submit-question")).toBeDisabled();
  });

  it("сохранение отправляет сценарий как содержимое вопроса, без медиа и без эталона", async () => {
    renderDrawer();
    chooseQuestionType("Сценарий");
    uploadArchive();
    await screen.findByTestId("scenario-accepted");
    fireEvent.click(screen.getByTestId("button-submit-question"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/questions" && init?.method === "POST")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url, i]) => url === "/api/questions" && i?.method === "POST")!;
    const body = JSON.parse(init.body);
    expect(body.type).toBe("simulation");
    expect(body.dataJson).toEqual({ scenario });
    expect(body.correctJson).toEqual({});
    expect(body.mediaUrl).toBeNull();
  });

  it("сохранённый вопрос открывается со сценарием и кнопкой «Скачать архив»", () => {
    const question = {
      id: "q-sim", topicId: "t1", type: "simulation", prompt: "Задание", dataJson: { scenario }, correctJson: {},
      mediaUrl: null, mediaType: null, shuffleAnswers: true, difficulty: null, feedbackMode: "general",
      feedback: null, feedbackCorrect: null, feedbackIncorrect: null, tags: [],
    } as unknown as Question;
    renderDrawer({ question });
    const card = screen.getByTestId("scenario-accepted");
    expect(within(card).getByText("Регистрация входящего письма")).toBeInTheDocument();
    expect(within(card).getByLabelText("Скачать архив")).toBeInTheDocument();
  });
});
