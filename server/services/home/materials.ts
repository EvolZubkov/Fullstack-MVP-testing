/**
 * @module server/services/home/materials
 *
 * PRD-25 FR-13: the active design templates plus the documentation downloads. The
 * lowest-priority section — it exists so an administrator does not have to
 * remember where the guide lives.
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

/**
 * Template-authoring documents offered on the home page. The ids are exactly the
 * ones `/api/admin/templates/docs/:doc` accepts (`server/routes/admin-templates.ts`).
 */
const DOCS: ReadonlyArray<{ id: string; label: string; href: string }> = [
  { id: "guide", label: "Руководство по разработке шаблонов", href: "/api/admin/templates/docs/guide" },
  { id: "spec", label: "Спецификация платформы шаблонов", href: "/api/admin/templates/docs/spec" },
];

/**
 * The «Материалы» section.
 *
 * @returns the names of every template in the `active` lifecycle state and the
 *   document download links.
 */
export async function buildMaterials(): Promise<{
  activeTemplates: string[];
  docs: Array<{ id: string; label: string; href: string }>;
}> {
  const rows = await db
    .select({ name: templates.name })
    .from(templates)
    .where(eq(templates.status, "active"));

  return {
    activeTemplates: rows.map((r) => r.name),
    docs: DOCS.map((doc) => ({ ...doc })),
  };
}
