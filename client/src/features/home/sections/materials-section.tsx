/**
 * @module features/home/sections/materials-section
 * @description PRD-25 FR-13: the design templates currently in the `active`
 * lifecycle state (PRD-3 allows several at once) and the template documentation
 * downloads. The documents are served by the API, so their links are plain
 * anchors, not SPA routes — an in-app navigation would leave the page and never
 * come back.
 */
import { FileText, Palette } from "lucide-react";
import {
  Card,
  CardBody,
  CardDivider,
  CardHeader,
  Cluster,
  Stack,
  Tag,
  Text,
} from "@universityrt/ui-kit";

/**
 * The «Материалы» section.
 *
 * @param props.data - names of the active templates and the document links.
 * @returns the section card.
 */
export function MaterialsSection({
  data,
}: {
  data: { activeTemplates: string[]; docs: Array<{ id: string; label: string; href: string }> };
}) {
  return (
    <Card variant="outlined" data-testid="home-materials">
      <CardHeader title="Материалы" />
      <CardBody>
        {/* The card has no footer, so the body carries the bottom padding itself. */}
        <Stack gap={3} padBottom={5}>
          {data.activeTemplates.length === 0 ? (
            <Text variant="body-s" tone="muted">Активных шаблонов нет</Text>
          ) : (
            data.activeTemplates.map((name) => (
              <Stack direction="row" align="center" gap={3} key={name} data-testid={`home-material-template-${name}`}>
                <Text tone="muted" aria-hidden="true"><Palette size={16} /></Text>
                <Stack gap={1} grow>
                  <Text variant="body-s" weight="semibold">{name}</Text>
                  <Text variant="body-xs" tone="muted">Активный шаблон оформления</Text>
                </Stack>
                <Tag tone="success">Активен</Tag>
              </Stack>
            ))
          )}
          <CardDivider />
          <Stack gap={2}>
            {data.docs.map((doc) => (
              <a href={doc.href} key={doc.id} data-testid={`home-material-doc-${doc.id}`}>
                <Cluster as="span" gap={2}>
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
