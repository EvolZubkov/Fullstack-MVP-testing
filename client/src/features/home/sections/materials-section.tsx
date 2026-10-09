/**
 * @module features/home/sections/materials-section
 * @description PRD-25 FR-13: the service's documentation shelf — every guide the
 * reader is allowed to download. The documents are served by the API, so their
 * links are plain anchors, not SPA routes — an in-app navigation would leave the
 * page and never come back.
 *
 * The server filters `docs` by capability, so this component renders whatever it
 * is given. The list of active design templates used to sit above the documents;
 * it was removed as noise — the template registry has its own screen («Шаблоны»),
 * and the home page is not a mirror of it.
 */
import { FileText } from "lucide-react";
import { Card, CardBody, CardHeader, Cluster, Stack, Text } from "@skillum/ui-kit";

/**
 * The «Материалы» section.
 *
 * @param props.data - the document links the reader may download.
 * @returns the section card.
 */
export function MaterialsSection({
  data,
}: {
  data: {
    docs: Array<{ id: string; label: string; href: string }>;
  };
}) {
  return (
    <Card variant="outlined" data-testid="home-materials">
      <CardHeader title="Материалы" />
      <CardBody>
        {/* The card has no footer, so the body carries the bottom padding itself. */}
        <Stack gap={3} padBottom={5}>
          <Stack gap={2}>
            {data.docs.map((doc) => (
              <a href={doc.href} key={doc.id} data-testid={`home-material-doc-${doc.id}`}>
                {/* `wrap={false}`: a long title must wrap INSIDE its own line, not
                    break away from the icon onto the next row. */}
                <Cluster as="span" gap={2} align="start" wrap={false}>
                  <Text tone="accent" aria-hidden="true"><FileText size={14} /></Text>
                  <Text variant="body-s" tone="accent">{doc.label}</Text>
                </Cluster>
              </a>
            ))}
          </Stack>
        </Stack>
      </CardBody>
    </Card>
  );
}
