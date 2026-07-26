/**
 * @module features/templates/issue-list
 * @description One structural-validation finding per line, with a tone icon
 * (PRD-3 §4.1–4.2). Shared by the upload dialog, which reports the findings of
 * the archive being accepted, and the details modal, which reports the stored
 * ones — the card's «Комплектность» badge stays yellow for the life of the
 * template, so its reasons have to be readable long after the upload closed.
 */
import { AlertCircle } from "lucide-react";
import type { ValidationIssue } from "./use-admin-templates";

export function IssueList({ issues, tone }: { issues: ValidationIssue[]; tone: "error" | "warning" }) {
  return (
    <ul className="tpl-upload-result-list">
      {issues.map((it, i) => (
        <li className="tpl-upload-result-item" key={`${it.code}-${i}`}>
          <AlertCircle size={16} style={{ color: `var(--ou-${tone}-default)`, flex: "0 0 auto" }} aria-hidden="true" />
          <span>{it.message ?? it.detail ?? it.code}</span>
        </li>
      ))}
    </ul>
  );
}
