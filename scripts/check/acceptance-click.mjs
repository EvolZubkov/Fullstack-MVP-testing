#!/usr/bin/env node
/**
 * @module scripts/check/acceptance-click
 * @description Снимок живого экрана ПОСЛЕ действий: кликов и ожиданий.
 *
 * Продолжение `acceptance-shot`: часть состояний экрана открывается только руками — вкладка,
 * окно, применённый фильтр. Клики настоящие (события мыши), потому что синтетический
 * `element.click()` не открывает ни вкладку дизайн-системы, ни выпадающее меню.
 *
 * Использование:
 *   node scripts/check/acceptance-click.mjs <путь> <файл.png> <селектор клика>[|<селектор>…]
 * ACCEPT_BASE — origin дев-сервера, по умолчанию http://localhost:8135.
 *
 * ГОЧА Git Bash: путь-аргумент со слэша превращается в путь Windows — запускать с
 * `MSYS_NO_PATHCONV=1`.
 */
import { writeFileSync } from "node:fs";

import { launch, sessionCookie, splitCookie } from "./editor-conformance/cdp.mjs";

const BASE = process.env.ACCEPT_BASE ?? "http://localhost:8135";
const [path, out, clicks = "", waitFor] = process.argv.slice(2);

const pair = await sessionCookie(BASE);
const { name, value } = splitCookie(pair);
const driver = await launch({ port: 9335, width: 1440, height: 1000 });
try {
  const url = new URL(BASE);
  await driver.send("Network.setCookie", {
    name, value, domain: url.hostname, path: "/", httpOnly: true,
  });
  await driver.goto(`${BASE}${path}`, 2500);

  for (const selector of clicks.split("|").map(s => s.trim()).filter(Boolean)) {
    await driver.clickSelector(selector, 1500);
  }
  if (waitFor) {
    const found = await driver.waitForSelector(waitFor, 20000);
    if (!found) throw new Error(`не дождался селектора ${waitFor}`);
    await new Promise(r => setTimeout(r, 1200));
  }

  const shot = await driver.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("снимок:", out);
} finally {
  await driver.close();
}
