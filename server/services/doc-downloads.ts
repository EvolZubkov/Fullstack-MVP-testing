/**
 * @module server/services/doc-downloads
 *
 * The single registry of the documentation PDFs the service hands out, plus the
 * plumbing that sends one.
 *
 * The artifacts are pre-built by `npm run docs:pdf` into `docs/dist` and are
 * committed, so a production container ships them without needing Chrome at
 * runtime (see `docker/Dockerfile`, which copies that directory).
 *
 * Every document declares the capability required to download it, so the
 * «Материалы» block on the home page and the download routes agree on who may
 * see what without repeating the rule. The section-local routes
 * (`/api/admin/templates/docs/:doc`, `/api/workbook/docs/:doc`) predate this
 * registry and keep their URLs — the buttons in «Шаблоны» and «Импорт» point at
 * them — but they read the file names and permissions from here.
 */
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Response } from "express";
import type { Capability } from "@shared/access";

/** One downloadable document. `id` is the URL segment of `/api/docs/:id`. */
export interface DocDownload {
  id: string;
  /** Basename inside `docs/dist`. */
  file: string;
  /** Name the browser saves the file under. */
  filename: string;
  /** Human label for the «Материалы» list. */
  label: string;
  /** Capability required to download it. */
  capability: Capability;
}

/**
 * Every document the service offers, in the order the «Материалы» block lists
 * them: from the widest audience to the narrowest.
 */
export const DOC_DOWNLOADS: readonly DocDownload[] = [
  {
    id: "test-authoring",
    file: "test-authoring-guide.pdf",
    filename: "Как создать тест. Руководство автора.pdf",
    label: "Как создать тест. Руководство автора",
    capability: "tests.read",
  },
  {
    id: "import-workbook",
    file: "import-workbook-guide.pdf",
    filename: "Как заполнить шаблон импорта.pdf",
    label: "Как заполнить шаблон импорта",
    capability: "questions.importExport",
  },
  {
    id: "template-development",
    file: "template-development.pdf",
    filename: "Руководство по разработке шаблонов.pdf",
    label: "Руководство по разработке шаблонов",
    capability: "adminTemplates.manage",
  },
  {
    id: "template-spec",
    file: "spec-template-platform.pdf",
    filename: "Спецификация платформы шаблонов.pdf",
    label: "Спецификация платформы шаблонов",
    capability: "adminTemplates.manage",
  },
];

/** Look a document up by its registry id. */
export function findDoc(id: string): DocDownload | undefined {
  return DOC_DOWNLOADS.find((doc) => doc.id === id);
}

/**
 * Absolute path to a generated doc PDF. Tried at the process CWD first (dev and
 * repo-rooted deploys), then relative to this module — the `__dirname` fallback
 * covers a launch from another working directory.
 *
 * @param file - basename inside `docs/dist`.
 * @returns the absolute path, or null when the artifact is missing.
 */
export function resolveDocPath(file: string): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "docs", "dist", file),
    path.resolve(here, "..", "..", "docs", "dist", file),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * What a caller answers when the artifact is absent. That is an operational
 * state — the build step was skipped — not a server fault, hence 404 with a
 * hint rather than a 500.
 */
export const DOC_NOT_BUILT_ERROR = "Документ не собран. Выполните `npm run docs:pdf`.";

/**
 * Stream a registry document as a PDF attachment.
 *
 * Resolving the path is the CALLER's job (see {@link resolveDocPath}): the HTTP
 * outcome of a missing artifact belongs to the route, and keeping the lookup out
 * of here also keeps it visible to tests — an intra-module call could not be
 * intercepted.
 *
 * @param res - the Express response to write to.
 * @param doc - the registry entry being sent (supplies the download name).
 * @param absPath - absolute path to the built PDF.
 */
export async function sendDocDownload(res: Response, doc: DocDownload, absPath: string): Promise<void> {
  const pdf = await fsp.readFile(absPath);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
  res.setHeader("Cache-Control", "no-cache");
  res.send(pdf);
}
