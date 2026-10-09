#!/usr/bin/env node
/**
 * @module scripts/check/acceptance-shot
 * @description Снимок живого экрана под сессией пользователя — приёмка в браузере без MCP.
 *
 * Нужен, когда MCP-браузер недоступен: опирается на ту же CDP-обвязку, которой принимается
 * редактор, и входит уже существующей учёткой приёмки.
 *
 * Использование: `node scripts/check/acceptance-shot.mjs <путь> <файл.png> [селектор]`
 * ACCEPT_BASE — origin дев-сервера, по умолчанию http://localhost:8135.
 *
 * ГОЧА Git Bash: путь-аргумент, начинающийся со слэша, превращается в путь Windows
 * (`/author` -> `C:/Program Files/Git/author`). Запускать с `MSYS_NO_PATHCONV=1`.
 */
import { writeFileSync } from "node:fs";

import { launch, sessionCookie, splitCookie } from "./editor-conformance/cdp.mjs";

const BASE = process.env.ACCEPT_BASE ?? "http://localhost:8135";
const [path, out, waitFor] = process.argv.slice(2);

const pair = await sessionCookie(BASE);
const { name, value } = splitCookie(pair);
const driver = await launch({ port: 9334, width: 1440, height: 1000 });
try {
  const url = new URL(BASE);
  await driver.send("Network.setCookie", {
    name, value, domain: url.hostname, path: "/", httpOnly: true,
  });
  await driver.goto(`${BASE}${path}`, 2500);
  if (waitFor) {
    const found = await driver.waitForSelector(waitFor, 25000);
    if (!found) throw new Error(`не дождался селектора ${waitFor}`);
    await new Promise(r => setTimeout(r, 1500));
  }
  const shot = await driver.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("снимок:", out);
} finally {
  await driver.close();
}
