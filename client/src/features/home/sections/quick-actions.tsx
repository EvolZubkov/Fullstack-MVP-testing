/**
 * @module features/home/sections/quick-actions
 * @description PRD-25 FR-06: capability-filtered shortcuts. The server already
 * removed the actions the user may not perform, so this component never re-checks
 * rights. Every action lands straight on the screen that creates the object — the
 * spec forbids dropping the user into a list to hunt for the button.
 */
import { useLocation } from "wouter";
import {
  ClipboardList,
  FilePlus,
  Plus,
  Table as TableIcon,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Button, Card, CardBody, CardHeader, Stack } from "@universityrt/ui-kit";
import type { QuickAction } from "@shared/home/contract";

/** Icon per action id (`server/services/home/quick-actions.ts`), as in the wireframe. */
const ACTION_ICON: Record<string, LucideIcon> = {
  "test-create": FilePlus,
  "content-add": Plus,
  import: TableIcon,
  assign: ClipboardList,
  "user-create": UserPlus,
};

/**
 * The «Быстрые действия» section.
 *
 * @param props.actions - actions the server resolved for this user, in order.
 * @returns the card, or `null` when the user may perform none of them.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const [, navigate] = useLocation();

  if (actions.length === 0) return null;

  return (
    <Card variant="outlined" data-testid="home-quick-actions">
      <CardHeader title="Быстрые действия" />
      <CardBody>
        {/* The card has no footer, so the body carries the bottom padding itself. */}
        <Stack gap={2} padBottom={5}>
          {actions.map((action, index) => {
            const Icon = ACTION_ICON[action.id];
            return (
              <Button
                key={action.id}
                // The first action is the primary one, as in the wireframe: the
                // list is ordered by importance, not by right.
                variant={index === 0 ? "primary" : "secondary"}
                size="s"
                fullWidth
                leadingIcon={Icon ? <Icon size={14} /> : undefined}
                onClick={() => navigate(action.href)}
                data-testid={`home-quick-action-${action.id}`}
              >
                {action.label}
              </Button>
            );
          })}
        </Stack>
      </CardBody>
    </Card>
  );
}
