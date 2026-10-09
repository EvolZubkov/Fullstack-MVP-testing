/**
 * @module scripts/deps/repo-auth
 * @description Gets a Bearer token for the corporate system.
 *
 * The system has no machine credentials we can use: project tokens are not available to us, so
 * a human logging in through the browser is the ONLY way in. That shapes everything here — the
 * browser window is visible (corporate SSO may ask for a password and a second factor), the
 * profile directory persists (so the next run is silent), and no password is ever asked for or
 * stored by us.
 *
 * The access token lives about five minutes and the refresh token about thirty, so the order is:
 * cached access token, then refresh, then the browser (spec `docs/specs/tooling/deps-check.md`
 * section 6).
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome } from "../docs/chrome.mjs";

const BASE = "https://repository.rt.ru";
const TOKEN_URL = `${BASE}/accounting/auth/user/token`;

/**
 * The token pair is a short-lived secret (access ~5 min, refresh ~30 min); the spec (section 6)
 * puts it in the system temp directory precisely so it has nothing to do next to the sources,
 * not even under `.gitignore`. Losing it to a temp sweep just means one more silent refresh or,
 * worst case, one more browser round trip — cheap either way.
 */
const TOKEN_FILE = join(tmpdir(), "rt-repo-tokens.json");

/**
 * The Chrome profile is the expensive thing to lose: it is what makes every run after the first
 * SILENT (a live Keycloak session, no password, no window lingering on screen). Unlike the token
 * file this is deliberately NOT under `os.tmpdir()` — on Windows that is `%LOCALAPPDATA%\Temp`,
 * a location disk-cleanup tools and IT policies are explicitly allowed to sweep, and this profile
 * needs to survive for as long as the SSO session does (days), not for the run of one script. A
 * persistent per-app cache directory under the home folder is the same kind of place the
 * project's own `scripts/docs/chrome.mjs` looks for a cached Chrome download.
 */
const PROFILE_DIR = join(homedir(), ".cache", "rt-repo-chrome-profile");

const SKEW_MS = 30000;
/**
 * Spec section 6: "вход не завершён за три минуты — прогон прекращается сразу". This number is
 * a documented contract, not a knob to widen on a hunch — whether three minutes is actually
 * enough for a password plus a second factor is an open question the spec itself only a live
 * run can answer (section 11 lists it as unverified). Until that run says otherwise, this stays
 * at what the spec says.
 */
const LOGIN_TIMEOUT_MS = 180000;
const DEBUG_PORT = 9333;

/**
 * Expiry of a JWT, in milliseconds since the epoch.
 * @param {string} token
 * @returns {number|null} Null when the string is not a JWT or carries no `exp`.
 */
export function decodeExpiry(token) {
  const payload = String(token ?? "").split(".")[1];
  if (!payload) return null;
  try {
    const exp = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} token
 * @param {number} now Milliseconds since the epoch.
 * @param {number} [skewMs] How much life a token must have left to be worth using.
 */
export function tokenIsUsable(token, now, skewMs = SKEW_MS) {
  const expiry = decodeExpiry(token);
  return expiry !== null && expiry - now > skewMs;
}

/** Reads the token pair saved by an earlier run. */
function readTokens() {
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Saves the token pair.
 *
 * `mode: 0o600` restricts the file at CREATION time on POSIX (owner read/write only) — real
 * protection against another account on a shared Linux/macOS box reading it out of a
 * world-readable `/tmp`. It does nothing on Windows: NTFS has no POSIX mode bits, it has ACLs,
 * and Node does not translate one into the other. What actually keeps other accounts out on
 * Windows is that `os.tmpdir()` already resolves to a PER-USER directory
 * (`%LOCALAPPDATA%\Temp`, not a machine-wide `/tmp`), and default NTFS ACL inheritance keeps
 * other accounts off it. That is an OS property this module leans on, not one it enforces — a
 * machine deliberately configured with a shared temp directory would not get it. Also note
 * `mode` only applies when the file is newly created; it does not retroactively tighten an
 * existing file left over with looser permissions from some earlier version of this script.
 */
function writeTokens(tokens) {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens), { encoding: "utf8", mode: 0o600 });
}

/** Exchanges a refresh token for a fresh pair; returns null when it is no longer accepted. */
async function refresh(refreshToken) {
  if (!refreshToken) return null;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!response.ok) return null;
  const tokens = await response.json();
  return tokens.access_token ? tokens : null;
}

/** Opens a CDP session against a freshly launched browser. */
async function connect(port) {
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
    throw new Error(
      `Не удалось подключиться к браузеру на порту ${port}. Обычная причина — Chrome уже запущен ` +
        `с этим же профилем: закройте его окно и повторите.`,
    );
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return ws;
}

/**
 * Launches a visible browser, lets the person log in and picks the token pair out of the
 * response the application itself receives.
 *
 * Reading the tokens off the wire rather than out of page storage keeps us independent of how
 * the Flutter client chooses to keep them.
 *
 * @returns {Promise<{access_token: string, refresh_token: string}>}
 */
async function loginThroughBrowser() {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome не найден. Укажите путь в переменной CHROME_BIN.");
  mkdirSync(PROFILE_DIR, { recursive: true });

  const proc = spawn(chrome, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Deliberately NOT the target URL — see the Network.enable-before-navigate comment below.
    // Chrome refusing to open at all (bad path, profile locked by another window) fails the
    // same way for "about:blank" as it would for a real address: connect() below never sees a
    // page target and reports it.
    "about:blank",
  ]);

  // A spawn() that cannot even start the binary (bad path, no exec permission) emits an 'error'
  // event; without a listener that is an unhandled error and crashes the process instead of
  // surfacing as a normal rejection. Race it against the connection attempt so a launch failure
  // is reported immediately rather than waiting out the /json/list polling loop in connect().
  const launchFailure = new Promise((_resolve, reject) => {
    proc.once("error", (err) => reject(new Error(`Не удалось запустить Chrome (${chrome}): ${err.message}`)));
  });

  let ws;
  try {
    ws = await Promise.race([connect(DEBUG_PORT), launchFailure]);
  } catch (err) {
    proc.kill();
    throw err;
  }

  let nextId = 0;
  const pending = new Map();
  const bodies = new Map();

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const tokens = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => fail(new Error("Вход не завершён за три минуты — прогон остановлен.")),
      LOGIN_TIMEOUT_MS,
    );

    /** Settles the promise with a failure and stops the timer; safe to call more than once. */
    function fail(err) {
      clearTimeout(timer);
      reject(err);
    }

    // A socket that drops (browser crash, profile wiped mid-run, network blip on 127.0.0.1)
    // must not sit silently until the three-minute timeout fires for an unrelated reason — that
    // reads as "the person is slow" when the actual story is "the connection is gone".
    ws.addEventListener("error", () => fail(new Error("Соединение с браузером оборвалось до завершения входа.")));
    ws.addEventListener("close", () => fail(new Error("Браузер закрыл соединение до завершения входа.")));
    // Covers a crash AFTER the initial connect succeeded; launchFailure above only covers the
    // window before it.
    proc.once("error", (err) => fail(new Error(`Chrome завершился с ошибкой: ${err.message}`)));

    ws.addEventListener("message", async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: no } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) no(new Error(msg.error.message));
        else ok(msg.result);
        return;
      }
      if (msg.method === "Network.responseReceived" && msg.params.response.url.startsWith(TOKEN_URL)) {
        bodies.set(msg.params.requestId, true);
      }
      if (msg.method === "Network.loadingFinished" && bodies.has(msg.params.requestId)) {
        bodies.delete(msg.params.requestId);
        try {
          const { body } = await send("Network.getResponseBody", { requestId: msg.params.requestId });
          const parsed = JSON.parse(body);
          if (parsed.access_token) {
            clearTimeout(timer);
            resolve(parsed);
          }
        } catch {
          /* the body may be gone already; the application asks again on its own */
        }
      }
    });

    // Network.enable MUST finish before we navigate to the real page, not after. The browser
    // was launched on "about:blank" specifically to make that possible: an earlier draft passed
    // the target URL straight on the Chrome command line, so the token exchange could complete
    // before this listener was even attached — with a live Keycloak session the whole
    // authorization_code round trip is fast enough that it really does race ahead of a
    // Network.enable sent from here. Enabling first and only then issuing Page.navigate over CDP
    // closes that window.
    send("Network.enable")
      .then(() => send("Page.navigate", { url: `${BASE}/` }))
      .catch(fail);
  }).finally(() => {
    try {
      ws.close();
    } finally {
      proc.kill();
    }
  });

  return tokens;
}

/**
 * Returns a token getter for the client.
 *
 * @returns {(options?: {force?: boolean}) => Promise<string>} `force` skips the cached access
 *   token — the client passes it after a 401.
 */
export function createTokenSource() {
  let cached = readTokens();

  return async function getToken({ force = false } = {}) {
    if (!force && cached.access_token && tokenIsUsable(cached.access_token, Date.now())) {
      return cached.access_token;
    }
    const refreshed = await refresh(cached.refresh_token);
    if (refreshed) {
      cached = refreshed;
      writeTokens(cached);
      return cached.access_token;
    }
    process.stdout.write("Открываю браузер: нужно войти в repository.rt.ru через корпоративный вход.\n");
    try {
      cached = await loginThroughBrowser();
    } catch (error) {
      // Without this tag, a failed login (Chrome missing, the three-minute timeout, a dropped
      // CDP socket) looked to the CLI's package loop like an ordinary "could not ask about THIS
      // package" — recorded, skipped, `continue`. The next package called getToken() again,
      // which opened another browser window for the same doomed login, forever: on ~690
      // packages at a 3-minute timeout that is roughly 34 hours of Chrome windows, with the
      // actual reason never printed to the console (see asLoginFailure's own doc).
      throw asLoginFailure(error);
    }
    writeTokens(cached);
    return cached.access_token;
  };
}

/**
 * Tags an error thrown by a failed browser login as one that must stop the WHOLE run, not just
 * this one call. Every failure `loginThroughBrowser()` can throw — Chrome missing, the debug
 * port already taken, the three-minute timeout, a dropped CDP socket — happens before a single
 * package has even been asked about, so retrying the next package would only repeat the exact
 * same failure up to ~690 times (spec `docs/specs/tooling/deps-check.md` section 6: all three
 * named login failures "прекращают прогон").
 *
 * This is the one seam `getToken()` funnels every login error through, so a new failure mode
 * added inside `loginThroughBrowser()` later is covered automatically instead of needing its own
 * throw site updated. The flag is a PROPERTY (`stopRun`), matching the one repo-client.mjs sets
 * on its own fatal errors — never a substring of the message — because a caller (`check-allowed
 * .mjs`) that sniffed text would silently turn a required stop into "skip this package and carry
 * on" the moment either message got reworded.
 *
 * Idempotent: an error that already carries `stopRun` (there is no such case today, since nothing
 * upstream of `getToken()` sets it, but nothing here assumes that stays true) is simply
 * re-tagged, not double-wrapped.
 *
 * @param {Error} error
 * @returns {Error & {stopRun: true}}
 */
export function asLoginFailure(error) {
  return Object.assign(error, { stopRun: true });
}

/** Path of the persistent profile, for the CLI to name in its messages. */
export const profileDir = PROFILE_DIR;
