/**
 * @module pages/author/content
 *
 * Unified "Topics & Questions" author section (content axis): a single table-tree
 * `Folder ⊃ Topic ⊃ Question` that supersedes the separate Topics and Questions
 * pages (see docs/AUDIT_UX_AUTHOR_CONTENT.md UX-01/03/06/07 and the approved
 * wireframe docs/wireframes/approved/content-bank-explorer.html).
 *
 * Phase 1: read-only tree + toolbar (search, expand/collapse). The facet filter
 * panel, entity drawers (topic/question), moves, bulk operations and the FAB land
 * in later phases — see docs/PLAN_content_axis_implementation.md. Mounted under
 * AuthorLayout via the /author/content route (App.tsx); gated by `topics.manage`.
 */
import { PageHeader } from "@/components/page-header";
import { ContentTree } from "@/features/content/content-tree";
import { t } from "@/lib/i18n";

export default function ContentPage() {
  return (
    <div className="tb-content-page">
      <PageHeader title={t.content.title} description={t.content.description} />
      <ContentTree />
    </div>
  );
}
