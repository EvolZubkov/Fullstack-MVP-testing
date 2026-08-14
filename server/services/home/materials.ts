/**
 * @module server/services/home/materials
 *
 * PRD-25 FR-13: the «Материалы» block — the service's documentation shelf plus,
 * for whoever manages them, the design templates currently in the `active`
 * lifecycle state. The lowest-priority section: it exists so nobody has to
 * remember where the guides live.
 *
 * ALL guides are listed here, filtered by the reader's rights: the document
 * registry (`server/services/doc-downloads`) carries the capability next to the
 * file, so the list and the download route can never disagree about who may read
 * what. Links point at `/api/docs/:id` — plain downloads, not SPA routes.
 *
 * Templates are NOT part of `IStorage`: the template routers read the table
 * directly through `db`, and this module follows that established pattern rather
 * than adding a one-off DAL method.
 *
 * The table carries TWO flags: `is_active` is the author-facing visibility flag,
 * while `status` is the PRD-3 lifecycle FSM (`draft`/`active`/`inactive`/
 * `invalid`). The lifecycle state is the meaningful one here, and several
 * templates may sit in `active` at once — hence a list of names, not a single
 * «active template».
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { templates } from "@shared/schema";
import { hasPermission, type Capability, type Role } from "@shared/access";
import { DOC_DOWNLOADS } from "../doc-downloads";

/**
 * The capabilities that make the section worth building. Derived from the
 * registry so adding a document with a new capability cannot leave its intended
 * readers without the block.
 */
export const MATERIAL_CAPABILITIES: readonly Capability[] = [
  ...new Set<Capability>([...DOC_DOWNLOADS.map((doc) => doc.capability), "adminTemplates.manage"]),
];

/** Shape of the section payload (mirrors `shared/home/contract`). */
export interface MaterialsSection {
  /** Whether the reader manages templates — decides if the template list is shown at all. */
  showTemplates: boolean;
  activeTemplates: string[];
  docs: Array<{ id: string; label: string; href: string }>;
}

/**
 * The «Материалы» section.
 *
 * @param roles - the reader's effective roles; decides which documents are
 *   listed and whether the active-template list is built at all.
 * @returns the documents the reader may download and, for a template manager,
 *   the names of every template in the `active` lifecycle state.
 */
export async function buildMaterials(roles: readonly Role[] = []): Promise<MaterialsSection> {
  const showTemplates = hasPermission(roles, "adminTemplates.manage");

  // A reader who does not manage templates never sees the list, so do not pay
  // for the query either.
  const rows = showTemplates
    ? await db.select({ name: templates.name }).from(templates).where(eq(templates.status, "active"))
    : [];

  return {
    showTemplates,
    activeTemplates: rows.map((r) => r.name),
    docs: DOC_DOWNLOADS.filter((doc) => hasPermission(roles, doc.capability)).map((doc) => ({
      id: doc.id,
      label: doc.label,
      href: `/api/docs/${doc.id}`,
    })),
  };
}
