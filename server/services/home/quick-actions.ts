/**
 * @module server/services/home/quick-actions
 *
 * PRD-25 FR-06: the quick-action buttons, filtered by capability. Every action
 * lands on a screen where the create form is reachable in one step — opening a
 * section and leaving the user to hunt for the button is explicitly not enough.
 * The list is deliberately short: five candidates is the cap the spec sets, and
 * a user sees only the subset their roles allow.
 */
import { hasPermission, type Capability, type Role } from "@shared/access";
import type { QuickAction } from "@shared/home/contract";

/** Every possible action, in the order the wireframe shows them. */
const CANDIDATES: ReadonlyArray<QuickAction & { perm: Capability }> = [
  { id: "test-create", label: "Создать тест", href: "/author/tests", perm: "tests.create" },
  { id: "content-add", label: "Добавить вопрос", href: "/author/content", perm: "topics.manage" },
  { id: "import", label: "Импорт из Excel", href: "/author/import", perm: "questions.importExport" },
  { id: "assign", label: "Назначить тест", href: "/author/tests", perm: "assignments.manage" },
  { id: "user-create", label: "Добавить пользователя", href: "/author/users", perm: "users.create" },
];

/**
 * The actions the given role set may perform.
 *
 * @param roles - the user's effective role set.
 * @returns the allowed actions; an empty array means the section is not shown.
 */
export function buildQuickActions(roles: readonly Role[]): QuickAction[] {
  return CANDIDATES.filter((action) => hasPermission(roles, action.perm)).map(
    ({ perm: _perm, ...action }) => action,
  );
}
