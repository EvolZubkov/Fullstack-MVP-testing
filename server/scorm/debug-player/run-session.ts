/**
 * @module server/scorm/debug-player/run-session
 * @description Общая механика ОДНОРАЗОВОГО прогона пакета: сборка из живого
 * состояния и раздача файлов same-origin.
 *
 * Два потребителя — отладчик автора (PRD-18) и окно рецензента (PRD-52) — отличаются
 * только гейтом доступа и составом инспектора. Сам прогон у них обязан быть ОДНИМ:
 * если рецензент увидит не то, что автор в отладчике, спор о содержании превратится
 * в спор о том, кто что видел. Поэтому сборка, распаковка, раздача и удаление живут
 * здесь, а роутеры остаются тонкими.
 */
import path from "node:path";
import type { Request, Response } from "express";
import { buildScormExportData, ScormBuildError } from "../build-export-data";
import { generateScormPackage } from "../../scorm-exporter";
import { createDebugSession, getDebugSession, dropDebugSession } from "./session-store";
import { assessTestPublish } from "../../services/draw-feasibility";
import { logger } from "../../logger";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
};

/** Content-Type файла пакета; неизвестное расширение отдаётся потоком байтов. */
export function contentTypeFor(p: string): string {
  return CONTENT_TYPES[path.extname(p).toLowerCase()] || "application/octet-stream";
}

/** Куда ведут ссылки прогона: `debug` — окно автора, `review` — окно рецензента. */
export type RunKind = "debug" | "review";

/**
 * Собирает пакет из ЖИВОГО состояния теста и открывает одноразовый прогон.
 *
 * Телеметрия выключена, попытка не создаётся: прогон существует, чтобы посмотреть
 * на тест, а не чтобы его пройти. Замечания о выдаче (`assessTestPublish`) не
 * блокируют запуск — в многотемном тесте сломанной может быть одна тема, а смотреть
 * остальные человек вправе; сбой самой проверки роняет замечание, а не прогон.
 */
export async function openRunSession(req: Request, res: Response, kind: RunKind) {
  try {
    const data = await buildScormExportData(req.params.id, { source: "debug" });
    const buffer = await generateScormPackage({ ...data, telemetry: null });
    const { token, launch } = await createDebugSession(req.params.id, req.session.userId!, buffer);
    logger.info(
      `${kind === "review" ? "Review" : "Debug"} session opened: test=${req.params.id} token=${token} by user=${req.session.userId}`,
      kind === "review" ? "review" : "debug-player",
    );
    const feasibility = await assessTestPublish(req.params.id).catch((error: unknown) => {
      logger.error("Feasibility check failed: " + (error as Error).message, "debug-player");
      return [];
    });
    res.json({
      token,
      launch,
      playUrl: `/api/tests/${req.params.id}/${kind}/play/${token}/${launch}`,
      title: data.test.title,
      template: data.designSettings?.templateId,
      feasibility,
    });
  } catch (error) {
    if (error instanceof ScormBuildError) {
      return res
        .status(error.status)
        .json(error.field ? { error: error.message, field: error.field } : { error: error.message });
    }
    logger.error("Run session error: " + (error as Error).message, "debug-player");
    res.status(500).json({ error: "Failed to build the run" });
  }
}

/**
 * Отдаёт файл пакета ВЕРБАТИМ. Шим сюда не инжектируется: он живёт в окне-родителе,
 * и SCO находит `API_1484_11` подъёмом по `window.parent` — как в настоящей LMS.
 */
export function servePackageFile(req: Request, res: Response) {
  const session = getDebugSession(req.params.token, req.session.userId!);
  if (session === "expired") return res.status(410).send("Run session expired");
  if (!session) return res.status(404).send("Unknown run session token");

  const splat = (req.params as Record<string, unknown>).splat;
  const rel = decodeURIComponent(Array.isArray(splat) ? splat.join("/") : String(splat || "")) || session.launch;

  const buf = session.files.get(rel);
  if (!buf) return res.status(404).send("Not found in package: " + rel);

  res.setHeader("Content-Type", contentTypeFor(rel));
  res.send(buf);
}

/** Закрывает прогон: в памяти не остаётся ни пакета, ни токена. */
export function closeRunSession(req: Request, res: Response) {
  res.json({ dropped: dropDebugSession(req.params.token, req.session.userId!) });
}
