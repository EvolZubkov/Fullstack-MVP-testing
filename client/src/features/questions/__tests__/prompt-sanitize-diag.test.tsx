// @vitest-environment jsdom
/**
 * @module features/questions/__tests__/prompt-sanitize-diag.test
 *
 * Диагностика вырезанного при сохранении текста задания (PRD-57, согласованный эскиз
 * `prd57-question-text.html`, состояние `s-diag`).
 *
 * Небезопасное снималось молча: ящик закрывался, и автор наблюдал только, что «текст
 * изменился сам». Проверяется вся цепочка этого молчания — что баннер появляется и называет
 * находки числами, что ящик ради него остаётся открытым, что в поле лежит СОХРАНЁННЫЙ текст,
 * и что задержка показа не стоила автору ни обновления списка, ни лишнего задания в банке.
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

/** Находки, которые вернул бы санитайзер на вставленном из редактора фрагменте. */
const REMOVED = [
  { kind: "tag" as const, label: "<script>", count: 1 },
  { kind: "attribute" as const, label: "onclick", count: 2 },
  { kind: "uri" as const, label: "external src/href", count: 1 },
];

const CLEAN_PROMPT = "<p>Что выведет запрос?</p>";

let fetchMock: ReturnType<typeof vi.fn>;

/** Ответ маршрута сохранения. */
function respondWith(body: Record<string, unknown>) {
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async (): Promise<string> => JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  respondWith({ id: "new-id", prompt: CLEAN_PROMPT });
  vi.stubGlobal("fetch", fetchMock);
  // Правка идёт через охрану содержимого: она зовёт `onDone` телом настоящего ответа.
  guardMock.mockImplementation(async (op: { url: string; body: unknown; onDone: (r?: unknown) => void }) => {
    const call = fetchMock as unknown as (url: string, init: unknown) => Promise<{ json: () => Promise<unknown> }>;
    const res = await call(op.url, { method: "PUT", body: JSON.stringify(op.body) });
    op.onDone(await res.json());
  });
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
  const view = render(
    <QueryClientProvider client={client}><ToastProvider>
      <QuestionEditorDrawer {...props} />
    </ToastProvider></QueryClientProvider>,
  );
  return { ...view, props };
}

/** Заполнить минимально валидное задание с одиночным выбором. */
function fillValid(prompt: string) {
  fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: prompt } });
  fireEvent.change(screen.getByTestId("input-option-0"), { target: { value: "Париж" } });
  fireEvent.change(screen.getByTestId("input-option-1"), { target: { value: "Лондон" } });
}

/** Нажать «Сохранить» и дождаться ухода запроса. */
async function save() {
  const submit = screen.getByTestId("button-submit-question");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}

describe("создание с находками", () => {
  beforeEach(() => {
    respondWith({ id: "new-id", prompt: CLEAN_PROMPT, promptSanitizeRemoved: REMOVED });
  });

  it("ящик остаётся открытым, а баннер называет находки словами и числами", async () => {
    const { props } = renderDrawer();
    fillValid("<p onclick='steal()'>Что выведет запрос?</p><script>x</script>");
    await save();

    const banner = await screen.findByTestId("banner-prompt-sanitized");
    expect(banner.textContent).toContain("Часть разметки удалена при сохранении");
    expect(banner.textContent).toContain("<script> — 1");
    expect(banner.textContent).toContain("обработчик onclick — 2");
    expect(banner.textContent).toContain("внешний src/href — 1");
    expect(banner.textContent).toContain("Остальная разметка сохранена без изменений");
    // Ящик не закрылся: иначе баннер некому показывать.
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("подводит находки к глазам: тело ящика прокручено туда, где автор работал", async () => {
    const scrollIntoView = vi.fn();
    // jsdom метода не имеет — приёмка 2026-09-20 показала, что без прокрутки баннер
    // оказывается выше видимой части и показ ничем не отличается от молчания.
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrollIntoView, writable: true, configurable: true,
    });
    renderDrawer();
    fillValid("<p onclick='steal()'>Что выведет запрос?</p><script>x</script>");
    await save();

    await screen.findByTestId("banner-prompt-sanitized");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("в поле лежит сохранённый текст, а не набранный", async () => {
    renderDrawer();
    fillValid("<p onclick='steal()'>Что выведет запрос?</p><script>x</script>");
    await save();

    await screen.findByTestId("banner-prompt-sanitized");
    expect((screen.getByTestId("input-question-prompt") as HTMLTextAreaElement).value).toBe(CLEAN_PROMPT);
  });

  it("второе сохранение правит созданное задание, а не заводит второе", async () => {
    renderDrawer();
    fillValid("<p onclick='steal()'>Что выведет запрос?</p><script>x</script>");
    await save();
    await screen.findByTestId("banner-prompt-sanitized");

    fireEvent.click(screen.getByTestId("button-submit-question"));
    await waitFor(() => expect(guardMock).toHaveBeenCalled());
    expect(guardMock.mock.calls[0][0].url).toBe("/api/questions/new-id");
  });

  it("закрытие ящика обновляет список: показ баннера только ОТЛОЖИЛ обновление", async () => {
    const { props } = renderDrawer();
    fillValid("<p onclick='steal()'>Что выведет запрос?</p><script>x</script>");
    await save();
    await screen.findByTestId("banner-prompt-sanitized");
    expect(props.onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Отмена" }).at(-1)!);
    expect(props.onSaved).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("правка текста гасит баннер: находки принадлежат тому сохранению", async () => {
    renderDrawer();
    fillValid("<p onclick='steal()'>Что выведет запрос?</p><script>x</script>");
    await save();
    await screen.findByTestId("banner-prompt-sanitized");

    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "<p>Другой текст</p>" } });
    await waitFor(() => expect(screen.queryByTestId("banner-prompt-sanitized")).toBeNull());
  });
});

describe("сохранение без находок", () => {
  it("закрывает ящик и обновляет список, как прежде", async () => {
    const { props } = renderDrawer();
    fillValid("Обычный вопрос");
    await save();

    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(props.onSaved).toHaveBeenCalled();
    expect(screen.queryByTestId("banner-prompt-sanitized")).toBeNull();
  });
});

describe("правка с находками", () => {
  const htmlQuestion = {
    id: "q1", topicId: "t1", type: "single",
    prompt: "<p>Текст</p>", promptFormat: "html",
    dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
    tags: [], feedbackMode: "general",
  } as unknown as Question;

  it("отчитывается тем же баннером, что и создание", async () => {
    respondWith({ ...htmlQuestion, prompt: CLEAN_PROMPT, promptSanitizeRemoved: REMOVED });
    const { props } = renderDrawer({ question: htmlQuestion });

    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "<p onclick='steal()'>Что выведет запрос?</p>" },
    });
    await save();

    expect((await screen.findByTestId("banner-prompt-sanitized")).textContent).toContain("обработчик onclick — 2");
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
