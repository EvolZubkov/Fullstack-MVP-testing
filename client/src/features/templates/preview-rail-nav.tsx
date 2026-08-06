/**
 * @module features/templates/preview-rail-nav
 * @description The screen rail of a template preview: Раздел → Вариант →
 * демонстрации, built by {@link module:features/templates/preview-rail buildRail}.
 *
 * ONE component for both previews — the template registry's «Предпросмотр и
 * проверка» and the test editor's «Оформление» preview. They used to render their
 * own rails: the registry the grouped tree, the editor a flat list of every demo
 * screen, which becomes unreadable as soon as a template ships a dozen learning-page
 * variants. Same rail markup, same classes, same grouping — the only difference is
 * the health-check status dot, which exists in the registry and not in the editor,
 * so it comes in as an optional slot.
 *
 * A variant with a SINGLE demonstration is rendered as the screen itself (a leaf
 * named after the variant): a middle level with one child says nothing. Two or more
 * demonstrations become a collapsible branch.
 */
import type * as React from "react";
import { ChevronRight } from "lucide-react";
import type { RailSection, RailVariant } from "./preview-rail";

export interface TemplatePreviewRailProps {
  /** Grouped rail (see `buildRail`). */
  rail: RailSection[];
  /** Currently shown screen id. */
  selectedId: string | null;
  onSelect: (screenId: string) => void;
  /** Keys of the expanded branches. */
  openVariants: Set<string>;
  onToggleVariant: (key: string) => void;
  /** `aria-label` of the rail's `<nav>`. */
  ariaLabel: string;
  /** Status dot of a screen leaf. Omitted ⇒ the rail carries no dots. */
  screenDot?: (screenId: string) => React.ReactNode;
  /** Status dot of a collapsible branch (the worst status of its screens). */
  variantDot?: (variant: RailVariant) => React.ReactNode;
  /** `data-testid` of a screen leaf, when the host labels them. */
  screenTestId?: (screenId: string) => string | undefined;
}

export function TemplatePreviewRail({
  rail,
  selectedId,
  onSelect,
  openVariants,
  onToggleVariant,
  ariaLabel,
  screenDot,
  variantDot,
  screenTestId,
}: TemplatePreviewRailProps) {
  return (
    <nav className="tpl-check-rail" aria-label={ariaLabel}>
      {rail.map((section) => (
        <div key={section.key}>
          <div className="tpl-check-rail__section">{section.label}</div>
          {section.variants.map((variant) => {
            if (variant.screens.length === 1) {
              const screen = variant.screens[0];
              return (
                <button
                  key={screen.id}
                  type="button"
                  className={
                    "tpl-check-rail__var tpl-check-rail__var--top" +
                    (screen.id === selectedId ? " is-active" : "")
                  }
                  aria-current={screen.id === selectedId ? "page" : undefined}
                  onClick={() => onSelect(screen.id)}
                  data-testid={screenTestId?.(screen.id)}
                >
                  <span>{variant.label}</span>
                  {screenDot?.(screen.id)}
                </button>
              );
            }
            const isOpen = openVariants.has(variant.key);
            return (
              <div key={variant.key}>
                <button
                  type="button"
                  className={"tpl-check-rail__type" + (isOpen ? " is-open" : "")}
                  onClick={() => onToggleVariant(variant.key)}
                  aria-expanded={isOpen ? "true" : "false"}
                >
                  <ChevronRight size={14} className="tpl-check-rail__chevron" aria-hidden="true" />
                  <span className="tpl-check-rail__type-label">{variant.label}</span>
                  {variantDot?.(variant)}
                  <span
                    className="tpl-check-rail__type-n"
                    aria-label={`демонстраций: ${variant.screens.length}`}
                  >
                    {variant.screens.length}
                  </span>
                </button>
                {isOpen &&
                  variant.screens.map((screen) => (
                    <button
                      key={screen.id}
                      type="button"
                      className={"tpl-check-rail__var" + (screen.id === selectedId ? " is-active" : "")}
                      aria-current={screen.id === selectedId ? "page" : undefined}
                      onClick={() => onSelect(screen.id)}
                      data-testid={screenTestId?.(screen.id)}
                    >
                      <span>{screen.label}</span>
                      {screenDot?.(screen.id)}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
