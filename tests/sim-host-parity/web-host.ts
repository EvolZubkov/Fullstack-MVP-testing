/**
 * @module tests/sim-host-parity/web-host
 * @description «Сценарий в ИС», техдолг №4: веб как хост паритета — настоящая страница прохождения
 * (`TakeTestPage`) и НАСТОЯЩИЕ обработчики попытки на той же pglite, что читает пакет (записка
 * `docs/handoff/HANDOFF-2026-10-08-sim-host-parity.md`, 9.4).
 *
 * Веб оценивает пункт и попытку запросом к серверу. Поэтому `fetch` страницы не отвечает
 * заготовками: всё, что шлёт страница, кроме макетов шаблона, пересылается в `attemptsRouter`
 * через `supertest`. Ответ заготовкой превратил бы паритет в сравнение теста с самим собой.
 *
 * Экраны-обёртки шаблона заменены двойниками ({@link ScreenDoubles}): настоящие монтируют Shadow DOM
 * с макетом, а всё, что сравнивается, — тело хаба, кнопки подвала, данные экрана — видно в их
 * пропсах. Двойники кладут текущий экран в {@link WebHost.screen}, откуда его читает снимок.
 *
 * Двойники и маршрутизатор подключает файл теста через `vi.mock` (он поднимается выше импортов):
 * этот модуль только даёт их реализацию.
 */
import { createElement } from "react";
import express from "express";
import session from "express-session";
import request from "supertest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

/** What the web currently shows, as the doubles saw it. */
export interface WebScreen {
  kind: "start" | "content" | "question" | "section-results" | "review" | "results" | "other";
  props: any;
}

const current: { screen: WebScreen | null } = { screen: null };

const set = (kind: WebScreen["kind"], props: any) => {
  current.screen = { kind, props };
};

/** Doubles for the template wrappers — mounted by the test file via `vi.mock`. */
export const ScreenDoubles = {
  TemplateScreen: (props: any) => {
    // The layout stub names its screen (see `layoutFor`): the wrapper itself has no screen prop.
    const screen = /<!--screen:([\w-]+)-->/.exec(String(props.layout ?? ""))?.[1] ?? "other";
    set(screen === "start" || screen === "section-results" || screen === "review" ? screen : "other", props);
    return createElement("div", { "data-testid": "template-screen", "data-screen": screen });
  },
  TemplateContentScreen: (props: any) => {
    set("content", props);
    return createElement("div", { "data-testid": "content-screen" });
  },
  TemplateQuestionScreen: (props: any) => {
    set("question", props);
    return createElement("div", { "data-testid": "question-screen" });
  },
};

/** Screen templates are not compared; the layout only names its screen for the doubles. */
const layoutFor = (url: string) => ({
  layout: `<!--screen:${url.split("/screen-template/")[1]}--><div data-slot="page-content"></div>`,
  css: "",
  theme: { background: "#fff", foreground: "#111" },
  cssVars: {},
  design: {},
});

/**
 * The server side of the web host: the real attempts router behind a session whose user is the
 * fixture's learner. Access middleware is mocked away in the test file — access is not the subject.
 */
export function makeServer(attemptsRouter: express.Router, userId: string): express.Express {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use(session({ secret: "parity", resave: false, saveUninitialized: false }));
  app.use((req: any, _res, next) => {
    req.session.userId = userId;
    next();
  });
  app.use("/api", attemptsRouter);
  return app;
}

export class WebHost {
  /** Requests on their way to the server; a step is over only when this drops to zero. */
  private inFlight = 0;
  readonly requests: string[] = [];
  /** Where the page navigated (the test file's `wouter` mock pushes here). */
  readonly navigations: string[] = [];

  constructor(
    private readonly app: express.Express,
    private readonly Page: () => any,
  ) {}

  /**
   * The screen the page shows now. A double records itself when it renders, but the page may since
   * have moved to something no double stands for (a spinner, the scenario player, another route):
   * the record counts only while its double is still in the document. After the page navigated to
   * the result route the screen is `results` — that route is another page, not a screen of this one.
   */
  get screen(): WebScreen | null {
    if (this.navigations.some((to) => to.startsWith("/learner/result/"))) return { kind: "results", props: {} };
    const s = current.screen;
    if (!s) return null;
    const testId = s.kind === "content" ? "content-screen" : s.kind === "question" ? "question-screen" : "template-screen";
    return document.querySelector(`[data-testid="${testId}"]`) ? s : null;
  }

  /** Id of the question on screen, `null` outside a question. */
  get questionId(): string | null {
    const s = this.screen;
    return s?.kind === "question" ? (s.props.question?.id ?? null) : null;
  }

  /**
   * Answers `qid` with option `index` as a participant does: pick, «Отправить ответ», «Далее». The
   * twin of `PackageHost.answer`: when the page stands on an already answered question before
   * `qid` (a resume lands on one), «Далее» is pressed over answered questions only, up to a few
   * steps. Returns whether `qid` was reached and answered.
   */
  async answer(qid: string, index: number): Promise<boolean> {
    for (let k = 0; k < 6 && this.questionId !== qid; k++) {
      const nav = this.screen?.props.nav;
      if (this.questionId === null || !nav?.committed) return false;
      await this.act(() => this.screen!.props.onNavAction("answer-next"));
    }
    if (this.questionId !== qid) return false;
    await this.act(() => this.screen!.props.onAnswer(index));
    await this.act(() => this.screen!.props.onNavAction("answer-submit"));
    await this.act(() => this.screen?.props.onNavAction?.("answer-next"));
    return true;
  }

  private installFetch(): void {
    const app = this.app;
    const fetchImpl = async (input: string, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      this.requests.push(`${method} ${url}`);
      if (url.includes("/screen-template/")) return respond(200, layoutFor(url));
      this.inFlight += 1;
      try {
        let req = method === "POST" ? request(app).post(url) : request(app).get(url);
        if (init?.body) req = req.set("Content-Type", "application/json").send(init.body);
        const res = await req;
        return respond(res.status, res.body);
      } finally {
        this.inFlight -= 1;
      }
    };
    (globalThis as any).fetch = fetchImpl;
  }

  /** Mounts the page — a fresh browser tab on the test (the server keeps the attempt). */
  async open(): Promise<void> {
    this.installFetch();
    this.navigations.length = 0;
    current.screen = null;
    render(createElement(this.Page));
    await this.idle();
  }

  /** Reload: the tab is gone, the attempt lives on the server. */
  async reload(): Promise<void> {
    cleanup();
    await this.open();
  }

  close(): void {
    cleanup();
  }

  /** Waits until no request is in flight and React has flushed what they caused. */
  async idle(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      if (this.inFlight === 0) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
        if (this.inFlight === 0) return;
      }
    }
  }

  /** Runs `fn` (a prop callback of a double) inside `act` and waits for the page to settle. */
  async act(fn: () => unknown): Promise<void> {
    await act(async () => {
      await fn();
    });
    await this.idle();
  }

  /** Waits for a screen of `kind`. */
  async waitFor(kind: WebScreen["kind"]): Promise<void> {
    await waitFor(() => {
      if (current.screen?.kind !== kind) throw new Error(`web: waiting for ${kind}, on ${current.screen?.kind}`);
    });
  }
}

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
