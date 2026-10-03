/**
 * @module server/services/home/quick-actions
 *
 * PRD-25 FR-06: the quick-action buttons, filtered by capability. Every action
 * lands on a screen where the create form is reachable in one step — opening a
 * section and leaving the user to hunt for the button is explicitly not enough.
 * The list is deliberately short: five candidates is the cap the spec sets, and
 * a user sees only the subset their roles allow.
 */
import { canImportAny, hasPermission, type Capability, type Role } from "@shared/access";
import type { QuickAction } from "@shared/home/contract";

/**
 * Every possible action, in the order the wireframe shows them. `perm` is a capability or, where
 * one right is not enough to describe the screen, a predicate over the role set.
 */
const CANDIDATES: ReadonlyArray<QuickAction & { perm: Capability | ((roles: readonly Role[]) => boolean) }> = [
  { id: "test-create", label: "Создать тест", href: "/author/tests", perm: "tests.create" },
  { id: "content-add", label: "Добавить вопрос", href: "/author/content", perm: "topics.manage" },
  // Подпись — как у раздела: «Импорт из Excel» прятал выгрузку отчёта LMS (Э1 UX-аудита).
  // Э6: раздел открыт любым правом на импорт — так же, как его маршрут и пункт меню.
  { id: "import", label: "Импорт", href: "/author/import", perm: canImportAny },
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
  return CANDIDATES.filter((action) =>
    typeof action.perm === "function" ? action.perm(roles) : hasPermission(roles, action.perm),
  ).map(
    ({ perm: _perm, ...action }) => action,
  );
}
