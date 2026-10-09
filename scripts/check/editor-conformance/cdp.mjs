/**
 * @module scripts/check/editor-conformance/cdp
 * @description Minimal Chrome DevTools Protocol client: launch, evaluate, real mouse input.
 *
 * Why this exists. The project has no playwright package and this task does not introduce
 * dependencies, but `chrome-headless-shell` is already installed and Node 24 ships global
 * `fetch` and `WebSocket`. Two traps are baked in here so callers cannot hit them:
 *
 *   1. `element.click()` does NOT open the editor drawer or switch a design-system tab —
 *      those handlers want real pointer events. {@link clickSelector} dispatches them.
 *   2. The dev login is rate limited to ten attempts per fifteen minutes per IP, and the
 *      window does not slide. A checker that logs in on every run locks itself out for a
 *      quarter of an hour, so the session cookie is cached on disk and revalidated.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const BROWSER_ROOT = join(homedir(), "AppData", "Local", "ms-playwright");
const COOKIE_CACHE = join(tmpdir(), "editor-conformance-sid.txt");
const COOKIE_NAME = "connect.sid";

/**
 * Finds the newest installed chrome-headless-shell binary.
 * @returns {string} Absolute path to the executable.
 */
export function findBrowser() {
  let dirs;
  try {
    dirs = readdirSync(BROWSER_ROOT).filter((d) => d.startsWith("chromium_headless_shell-")).sort();
  } catch {
    throw new Error(`Каталог браузеров не найден: ${BROWSER_ROOT}`);
  }
  for (const dir of dirs.reverse()) {
    const exe = join(BROWSER_ROOT, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe");
    if (existsSync(exe)) return exe;
  }
  throw new Error(`chrome-headless-shell не найден в ${BROWSER_ROOT}`);
}

/**
 * Launches a headless browser and attaches to its page target.
 *
 * @param {{port?: number, width?: number, height?: number}} [options]
 * @returns {Promise<object>} Driver with goto / evaluate / clickSelector / send / close.
 */
export async function launch({ port = 9222, width = 1600, height = 1000 } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), "editor-conformance-"));
  const proc = spawn(findBrowser(), [
    "--headless",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    "--disable-gpu",
    "--hide-scrollbars",
    // A starting URL is required: without one chrome-headless-shell opens no page target at
    // all and `/json/list` stays empty, which reads exactly like "the browser failed to start".
    "about:blank",
  ]);

  let targets = null;
  for (let attempt = 0; attempt < 50 && !targets?.length; attempt += 1) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
      targets = null;
    }
  }
  const page = targets?.find((t) => t.type === "page");
  if (!page) {
    proc.kill();
    throw new Error(`Браузер не поднялся за 10 секунд на порту ${port}`);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    const settle = msg.id && pending.get(msg.id);
    if (settle) {
      pending.delete(msg.id);
      settle(msg);
    }
  });

  /**
   * Sends one protocol command. The timeout is not decoration: a reply that never arrives
   * (a navigation that ate the context, a page stuck on a modal) would otherwise hang the
   * guard forever, and a guard that hangs is indistinguishable from a slow one until someone
   * kills it ten minutes later.
   */
  const send = (method, params = {}, timeoutMs = 30000) =>
    new Promise((resolve, reject) => {
      const id = (nextId += 1);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: ответ не пришёл за ${timeoutMs} мс`));
      }, timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  const driver = {
    send,

    /** Navigates and waits for the page to settle; the app is a SPA, so there is no load event to trust. */
    async goto(url, settleMs = 3000) {
      await send("Page.navigate", { url });
      await new Promise((r) => setTimeout(r, settleMs));
    },

    /**
     * Evaluates a function SOURCE (as text) in the page and returns its JSON value.
     * @param {string} fnSource Source of a zero-argument function.
     */
    async evaluate(fnSource, settleMs = 0) {
      const res = await send("Runtime.evaluate", {
        expression: `(${fnSource})()`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (res.exceptionDetails) {
        throw new Error(`Ошибка в странице: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ""}`);
      }
      if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
      return res.result.value;
    },

    /**
     * Waits until a selector matches. Fixed sleeps after navigation are a lie on a cold Vite
     * server: the first compile can take longer than any number that looks reasonable, and the
     * failure then reads as "the element does not exist" rather than "the page was not ready".
     *
     * @param {string} selector CSS selector to wait for.
     * @param {number} timeoutMs How long to keep trying.
     * @returns {Promise<boolean>} True once it matches; false if it never did.
     */
    async waitForSelector(selector, timeoutMs = 30000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = await driver.evaluate(
          `() => !!document.querySelector(${JSON.stringify(selector)})`,
        );
        if (found) return true;
        await new Promise((r) => setTimeout(r, 400));
      }
      return false;
    },

    /**
     * Clicks an element by REAL mouse events. `element.click()` does not open the drawer or
     * switch a design-system tab — do not "simplify" this back into a synthetic click.
     */
    async clickSelector(selector, settleMs = 1200) {
      await driver.waitForSelector(selector);
      const box = await driver.evaluate(`() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }`);
      if (!box) throw new Error(`Не найден селектор ${selector}`);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
      }
      await new Promise((r) => setTimeout(r, settleMs));
    },

    async close() {
      try {
        ws.close();
      } finally {
        proc.kill();
      }
    },
  };

  return driver;
}

/**
 * Returns a valid dev session cookie pair, reusing the cached one while it still
 * authenticates. See the rate-limit note in the module description.
 *
 * @param {string} [base] Dev server origin.
 * @returns {Promise<string>} Cookie pair, `connect.sid=<value>`.
 */
export async function sessionCookie(base = "http://localhost:8081") {
  if (existsSync(COOKIE_CACHE)) {
    const cached = readFileSync(COOKIE_CACHE, "utf8").trim();
    try {
      const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cached } });
      if (me.ok) return cached;
    } catch {
      /* dev down or cookie stale — fall through to a fresh login */
    }
  }
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "acceptance@local.test", password: "Acceptance!2026" }),
  });
  if (!res.ok) {
    throw new Error(
      `Вход не удался: ${res.status}. Если это 429, сработал лимит в десять попыток на пятнадцать ` +
        `минут по IP — окно не продлевается, надо просто подождать.`,
    );
  }
  const pair = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`))?.split(";")[0];
  if (!pair) throw new Error(`Сервер не вернул ${COOKIE_NAME}`);
  writeFileSync(COOKIE_CACHE, pair, "utf8");
  return pair;
}

/**
 * Splits `connect.sid=<value>` into its parts. The signed value is percent-encoded and can
 * carry `=` padding, so splitting on every `=` truncates the cookie and the checker silently
 * runs as an anonymous visitor — take the name off the front instead.
 *
 * @param {string} pair Cookie pair as returned by {@link sessionCookie}.
 * @returns {{name: string, value: string}}
 */
export function splitCookie(pair) {
  return { name: COOKIE_NAME, value: pair.slice(`${COOKIE_NAME}=`.length) };
}
