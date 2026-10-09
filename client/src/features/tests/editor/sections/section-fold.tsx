/**
 * @module features/tests/editor/sections/section-fold
 * @description Shared per-section folding for the editor's section-grouped lists
 * («Оценка» and «Шкалы» → «Вклады вопросов»). `useSectionFold` keeps the ephemeral
 * collapsed set (all expanded on open) and the collapse-all / expand-all helpers;
 * `FoldAllButtons` renders the matching «Свернуть все / Развернуть все» toolbar, and
 * `FoldSection` renders one collapsible section with the header, counter tag and body the
 * approved wireframe draws. The three live together on purpose: a second copy of any of them
 * drifts from the drawing — the button pair already did once and lost its icons.
 */

import { useMemo, useState } from "react";
import type * as React from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@skillum/ui-kit";

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

/**
 * Ephemeral folding state over the given section ids; everything is expanded on open unless
 * `startCollapsed` says otherwise.
 *
 * The flag exists for registries that list whole question banks: a test with a dozen topics of
 * a dozen questions each opens as a wall of text in which nothing can be found, so those start
 * folded down to topic headers. Everywhere else expanded is right — the author came to read
 * what is there, not to click it open.
 */
export function useSectionFold(sectionIds: string[], startCollapsed = false): SectionFold {
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    startCollapsed ? new Set(sectionIds) : new Set(),
  );
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

/**
 * Одна сворачиваемая секция списка: шапка с шевроном, именем и тегом-счётчиком, тело.
 *
 * Разметка (`tb-fold-sec` / `tb-fold-sec-head` / `tb-fold-trigger` / `tb-fold-sec__body`)
 * задана утверждённым эскизом `docs/wireframes/editor-settings-target.html`. Она была
 * вкопана в `scales-section.tsx`, и вторая её копия в другом файле разошлась бы с рисунком
 * так же, как разошлась пара «Развернуть все / Свернуть все» — та потеряла иконки.
 */
export function FoldSection({
  open,
  onToggle,
  name,
  tag,
  testId,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  name: string;
  /** Счётчик справа от имени: «3 подтемы», «14 вопросов». Без него тег не рисуется. */
  tag?: string;
  testId?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="tb-fold-sec" data-testid={testId}>
      <div className="tb-fold-sec-head">
        <button
          type="button"
          className="tb-fold-trigger"
          aria-expanded={open ? "true" : "false"}
          aria-label={open ? `Свернуть секцию ${name}` : `Развернуть секцию ${name}`}
          onClick={onToggle}
          data-testid={testId ? `${testId}-toggle` : undefined}
        >
          {open ? (
            <ChevronDown className="tb-fold-chev" width={16} height={16} aria-hidden="true" />
          ) : (
            <ChevronRight className="tb-fold-chev" width={16} height={16} aria-hidden="true" />
          )}
          <span className="tb-fold-sec-name">{name}</span>
        </button>
        {tag && <span className="ou-tag ou-tag--neutral ou-tag--outline">{tag}</span>}
      </div>
      {open && <div className="tb-fold-sec__body">{children}</div>}
    </div>
  );
}
