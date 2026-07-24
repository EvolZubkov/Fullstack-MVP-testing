/**
 * @module features/tests/editor/sections/sanitize-banner
 * @description Post-save diagnostics banner for a content page (PRD-7 S13.4-G18 /
 * FR-25 sanitize). Shows the author what the server changed in their markup.
 *
 * Two outcomes, deliberately worded apart: markup REMOVED as unsafe (script tags,
 * event handlers, external references) and author CSS CONFINED to the page block.
 * The second is not a removal — the styles still work, they just cannot reach the
 * player around the page — and reporting it as one would read like data loss.
 */
import { AlertTriangle, X } from "lucide-react";
import type { SanitizeDiagnostics, SanitizeRemoval } from "../use-content-pages";

export type SanitizeBannerProps = {
  /** Diagnostics of the last successful save, keyed by placeholder key. */
  diagnostics: SanitizeDiagnostics;
  /** Resolves a placeholder key to its author-facing label. */
  fieldLabel: (placeholderKey: string) => string;
  /** Dismisses the banner (it also clears on the next clean save). */
  onDismiss: () => void;
  testId?: string;
  dismissTestId?: string;
};

/** One diagnostic paired with the field it came from. */
type Entry = { key: string; removal: SanitizeRemoval };

function collect(diagnostics: SanitizeDiagnostics, styleKind: boolean): Entry[] {
  return Object.entries(diagnostics).flatMap(([key, removals]) =>
    removals.filter((r) => (r.kind === "style") === styleKind).map((removal) => ({ key, removal })),
  );
}

export function SanitizeBanner({
  diagnostics,
  fieldLabel,
  onDismiss,
  testId,
  dismissTestId,
}: SanitizeBannerProps) {
  const removed = collect(diagnostics, false);
  const scoped = collect(diagnostics, true);
  if (removed.length === 0 && scoped.length === 0) return null;

  return (
    <div className="validation-banner validation-banner--warning" role="alert" data-testid={testId}>
      <span className="validation-banner__ico" aria-hidden="true">
        <AlertTriangle size={14} />
      </span>
      <div className="validation-banner__body">
        <div className="validation-banner__title">
          {removed.length > 0 ? "HTML санитизирован" : "Стили страницы ограничены"}
        </div>
        <div className="validation-banner__desc">
          {removed.length > 0 && (
            <>
              Следующие элементы были удалены как небезопасные:
              <ul className="validation-banner__list">
                {removed.map(({ key, removal }) => (
                  <li key={`${key}-${removal.label}`}>
                    <code>{removal.label}</code> в поле «{fieldLabel(key)}»
                    {removal.count > 1 ? ` (×${removal.count})` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          {scoped.length > 0 && (
            <>
              Стили вставки ограничены блоком страницы — иначе они меняют оформление плеера:
              <ul className="validation-banner__list">
                {scoped.map(({ key, removal }) => (
                  <li key={`${key}-${removal.label}-scoped`}>
                    <code>{removal.label}</code> в поле «{fieldLabel(key)}» (правил: {removal.count})
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
        aria-label="Скрыть предупреждение о санитизации"
        onClick={onDismiss}
        data-testid={dismissTestId}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
