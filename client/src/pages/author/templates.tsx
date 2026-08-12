/**
 * @module pages/author/templates
 * @description Author route host for the PRD-3 admin template registry. Thin
 * wrapper around the {@link module:features/templates/templates-page} feature,
 * mounted at `/author/templates` inside the AuthorLayout.
 */
import { TemplatesPage } from "@/features/templates/templates-page";

export default function AuthorTemplatesPage() {
  return <TemplatesPage />;
}
