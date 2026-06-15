/**
 * @module pages/author/content
 *
 * Unified "Topics & Questions" author section (content axis): a single table-tree
 * `Folder ⊃ Topic ⊃ Question` that supersedes the separate Topics and Questions
 * pages (see docs/AUDIT_UX_AUTHOR_CONTENT.md UX-01/03/06/07 and the approved
 * wireframe docs/wireframes/approved/content-bank-explorer.html).
 *
 * Phase 0 scaffold: route + page shell only. The tree, filter panel, entity
 * drawers (topic/question), moves and bulk operations land in later phases —
 * see docs/PLAN_content_axis_implementation.md. Mounted under AuthorLayout via
 * the /author/content route (App.tsx); gated by `topics.manage`.
 */
import { Box, Stack, Text } from "@universityrt/ui-kit";
import { PageHeader } from "@/components/page-header";
import { t } from "@/lib/i18n";

export default function ContentPage() {
  return (
    <div>
      <PageHeader title={t.content.title} description={t.content.description} />
      <Box border radius="m" pad={6}>
        <Stack gap={2}>
          <Text tone="muted">{t.content.wip}</Text>
        </Stack>
      </Box>
    </div>
  );
}
