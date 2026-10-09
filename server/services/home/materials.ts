/**
 * @module server/services/home/materials
 *
 * PRD-25 FR-13: the «Материалы» block — the service's documentation shelf. The
 * lowest-priority section: it exists so nobody has to remember where the guides
 * live.
 *
 * ALL guides are listed here, filtered by the reader's rights: the document
 * registry (`server/services/doc-downloads`) carries the capability next to the
 * file, so the list and the download route can never disagree about who may read
 * what. Links point at `/api/docs/:id` — plain downloads, not SPA routes.
 *
 * The block also used to list the design templates in the `active` lifecycle
 * state. That was a mirror of the «Шаблоны» screen and was removed, together with
 * the direct `templates` query this module carried for it.
 */
import { hasPermission, type Capability, type Role } from "@shared/access";
import { DOC_DOWNLOADS } from "../doc-downloads";

/**
 * The capabilities that make the section worth building. Derived from the
 * registry so adding a document with a new capability cannot leave its intended
 * readers without the block.
 */
export const MATERIAL_CAPABILITIES: readonly Capability[] = [
  ...new Set<Capability>(DOC_DOWNLOADS.map((doc) => doc.capability)),
];

/** Shape of the section payload (mirrors `shared/home/contract`). */
export interface MaterialsSection {
  docs: Array<{ id: string; label: string; href: string }>;
}

/**
 * The «Материалы» section.
 *
 * @param roles - the reader's effective roles; decides which documents are listed.
 * @returns the documents the reader may download.
 */
export async function buildMaterials(roles: readonly Role[] = []): Promise<MaterialsSection> {
  return {
    docs: DOC_DOWNLOADS.filter((doc) => hasPermission(roles, doc.capability)).map((doc) => ({
      id: doc.id,
      label: doc.label,
      href: `/api/docs/${doc.id}`,
    })),
  };
}
