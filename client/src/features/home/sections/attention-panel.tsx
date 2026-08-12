/**
 * @module features/home/sections/attention-panel
 * @description PRD-25 FR-05: the actionable rows of «Требует внимания». The
 * section renders nothing at all when there is nothing to act on — an
 * always-present empty «всё в порядке» box would train the user to ignore the
 * very spot where real problems appear. Wording, row order and the icon tone per
 * severity follow the approved wireframe
 * (`docs/wireframes/approved/prd25-home.html`).
 */
import { Fragment } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Clock, Copy, GitBranch, Users, type LucideIcon } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardDivider,
  CardHeader,
  Cluster,
  Stack,
  Text,
} from "@universityrt/ui-kit";
import type { AttentionItem, AttentionKind } from "@shared/home/contract";

/**
 * Icon per attention kind, exactly as the wireframe assigns them: the glyph is
 * the fastest way to tell a publication problem from a stalled assignment.
 */
const KIND_ICON: Record<AttentionKind, LucideIcon> = {
  "attempt-in-progress": Clock,
  "retake-available": Clock,
  "test-empty-draft": AlertTriangle,
  "test-edited-after-publish": AlertTriangle,
  "test-pool-drift": GitBranch,
  "topic-duplicates": Copy,
  "assignment-not-started": Users,
};

/**
 * The «Требует внимания» section.
 *
 * @param props.items - rows built by the server; an empty list hides the section.
 * @returns the card, or `null` when there is nothing to act on.
 */
export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const [, navigate] = useLocation();

  if (items.length === 0) return null;

  return (
    <Card variant="outlined" data-testid="home-attention">
      <CardHeader title="Требует внимания" />
      <CardBody>
        <Stack gap={0}>
          {items.map((item, index) => {
            const Icon = KIND_ICON[item.kind] ?? AlertTriangle;
            return (
              <Fragment key={item.id}>
                {index > 0 && <CardDivider />}
                <Stack direction="row" align="start" gap={3} padY={3}>
                  <Text tone={item.severity === "warning" ? "warning" : "info"} aria-hidden="true">
                    <Icon size={16} />
                  </Text>
                  <Stack gap={2} grow>
                    <Stack gap={1}>
                      <Text variant="body-s" weight="semibold">{item.title}</Text>
                      {item.subtitle ? (
                        <Text variant="body-xs" tone="muted">{item.subtitle}</Text>
                      ) : null}
                    </Stack>
                    <Cluster gap={2}>
                      <Button
                        variant="secondary"
                        size="s"
                        onClick={() => navigate(item.href)}
                        data-testid={`home-attention-action-${item.id}`}
                      >
                        {item.action}
                      </Button>
                    </Cluster>
                  </Stack>
                </Stack>
              </Fragment>
            );
          })}
        </Stack>
      </CardBody>
    </Card>
  );
}
