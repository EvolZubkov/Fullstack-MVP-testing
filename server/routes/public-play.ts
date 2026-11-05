/**
 * @module server/routes/public-play
 * @description Anonymous play of a test through its public link (stage 1). Nothing is
 * stored: no user, no attempt, no telemetry — the package is built with `telemetry: null`
 * and the visitor's progress lives in their browser (shim + localStorage).
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { storage } from "../storage";
import { publishedSnapshotOf } from "../services/test-snapshot";
import { getPublicPackage, LIVE_PACKAGE_TTL_MS, type PublicPackage } from "../scorm/debug-player/public-package-cache";
import { readShimJs } from "../scorm/debug-player/assets";
import { contentTypeFor } from "../scorm/debug-player/run-session";
import { logger } from "../logger";

const router = Router();

/** Tokens are 32 random bytes in hex; anything else is rejected without a DB lookup. */
const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Name the package shows for an anonymous visitor (the shim's default is the preview's). */
const LEARNER_NAME = "Участник";

function noIndex(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
}

function notFoundPage(res: Response) {
  res.status(404).type("html").send(
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Ссылка недействительна</title></head>' +
    '<body style="font-family:sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">' +
    "<p>Ссылка недействительна или тест больше не доступен.</p></body></html>",
  );
}

/**
 * Resolve a token to the package of the test as learners get it, or null. A published test
 * serves its snapshot; one published before snapshots existed serves live content, cached
 * for a few minutes (bank edits do not touch the test row, so the key alone cannot see them).
 */
async function resolve(token: string): Promise<{ testId: string; pkg: PublicPackage } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const link = await storage.getTestPublicLinkByToken(token);
  if (!link) return null;
  const test = await storage.getTest(link.testId);
  if (test?.status !== "published") return null;
  const snapshot = await publishedSnapshotOf(link.testId);
  const pkg = snapshot
    ? await getPublicPackage(link.testId, `snap:${snapshot.id}`)
    : await getPublicPackage(link.testId, `live:${new Date(test.updatedAt).getTime()}`, { ttlMs: LIVE_PACKAGE_TTL_MS });
  return { testId: link.testId, pkg };
}

router.use(noIndex);

router.get("/:token", async (req, res) => {
  try {
    const found = await resolve(req.params.token);
    if (!found) return notFoundPage(res);
    const base = `/p/${req.params.token}`;
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Тест</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style>
<script src="${base}/shim.js"></script>
<script>
  window.__scorm.restore("tb-public-${req.params.token}");
  var cmi = window.__scorm.getCmi();
  cmi["cmi.learner_name"] = cmi["cmi.core.student_name"] = ${JSON.stringify(LEARNER_NAME)};
  cmi["cmi.learner_id"] = cmi["cmi.core.student_id"] = "public";
</script>
</head><body><iframe src="${base}/play/${found.pkg.launch}" title="Тест" allow="fullscreen"></iframe></body></html>`);
  } catch (error) {
    logger.error("Public link page error: " + (error as Error).message, "public-link");
    res.status(500).type("html").send("Ошибка. Попробуйте позже.");
  }
});

router.get("/:token/shim.js", (_req, res) => {
  res.type("text/javascript; charset=utf-8").send(readShimJs());
});

router.get("/:token/play{/*splat}", async (req, res) => {
  try {
    const found = await resolve(req.params.token);
    if (!found) return res.status(404).send("Not found");
    const splat = (req.params as Record<string, unknown>).splat;
    const rel = decodeURIComponent(Array.isArray(splat) ? splat.join("/") : String(splat || "")) || found.pkg.launch;
    const buf = found.pkg.files.get(rel);
    if (!buf) return res.status(404).send("Not found");
    res.setHeader("Content-Type", contentTypeFor(rel));
    res.send(buf);
  } catch (error) {
    logger.error("Public link file error: " + (error as Error).message, "public-link");
    res.status(500).send("Error");
  }
});

export default router;
