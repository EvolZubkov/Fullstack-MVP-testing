/**
 * @module features/tests/editor/sections/section-fold
 * @description Shared per-section folding for the editor's section-grouped lists
 * («Оценка» and «Шкалы» → «Вклады вопросов»). `useSectionFold` keeps the ephemeral
 * collapsed set (all expanded on open) and the collapse-all / expand-all helpers;
 * `FoldAllButtons` renders the matching «Свернуть все / Развернуть все» toolbar.
 * The per-section disclosure itself stays in each tab (it wraps tab-specific
 * content) via the shadcn `Collapsible`, same pattern as the topics folders.
 */

import { useMemo, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@universityrt/ui-kit";

export interface SectionFold {
  /** True when the section is expanded (not collapsed). */
  isOpen: (sectionId: string) => boolean;
  /** Toggle one section's collapsed state. */
  toggle: (sectionId: string) => void;
  collapseAll: () => void;
  expandAll: () => void;
  /** Every section is collapsed (disables «Свернуть все»). */
  allCollapsed: boolean;
  /** At least one section is collapsed (enables «Развернуть все»). */
  anyCollapsed: boolean;
}

/** Ephemeral folding state over the given section ids (all expanded on open). */
export function useSectionFold(sectionIds: string[]): SectionFold {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const allCollapsed = sectionIds.length > 0 && sectionIds.every((id) => collapsed.has(id));
  const anyCollapsed = useMemo(() => sectionIds.some((id) => collapsed.has(id)), [sectionIds, collapsed]);
  return {
    isOpen: (id) => !collapsed.has(id),
    toggle: (id) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    collapseAll: () => setCollapsed(new Set(sectionIds)),
    expandAll: () => setCollapsed(new Set()),
    allCollapsed,
    anyCollapsed,
  };
}

/** «Развернуть все» / «Свернуть все» pair; `testIdPrefix` namespaces the testids. */
export function FoldAllButtons({
  fold,
  testIdPrefix,
}: {
  fold: SectionFold;
  testIdPrefix: string;
}) {
  return (
    <span className="tb-fold-actions">
      <Button
        variant="ghost"
        size="s"
        leadingIcon={<ChevronsUpDown width={14} height={14} aria-hidden="true" />}
        onClick={fold.expandAll}
        disabled={!fold.anyCollapsed}
        data-testid={`${testIdPrefix}-expand-all`}
      >
        Развернуть все
      </Button>
      <Button
        variant="ghost"
        size="s"
        leadingIcon={<ChevronsDownUp width={14} height={14} aria-hidden="true" />}
        onClick={fold.collapseAll}
        disabled={fold.allCollapsed}
        data-testid={`${testIdPrefix}-collapse-all`}
      >
        Свернуть все
      </Button>
    </span>
  );
}
