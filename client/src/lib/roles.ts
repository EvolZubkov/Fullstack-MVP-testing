/**
 * @module client/lib/roles
 *
 * Display labels and descriptions for access control roles (PRD-13), reused by
 * the sidebar, the user editor and anywhere roles are shown. Identifiers come
 * from the shared access layer; only the human-facing strings live here.
 */

import { ROLES, ROLE_PRIORITY, primaryRole, type Role } from "@shared/access";

/** Human-facing role names (Russian). */
export const ROLE_LABELS: Record<Role, string> = {
  [ROLES.SUPERADMIN]: "Суперадминистратор",
  [ROLES.ADMINISTRATOR]: "Администратор",
  [ROLES.DEVELOPER]: "Разработчик",
  [ROLES.AUTHOR]: "Автор",
  [ROLES.MANAGER]: "Менеджер по обучению",
  [ROLES.LEARNER]: "Обычный пользователь",
};

/** Short descriptions of what each role can do (used in the role picker). */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  [ROLES.SUPERADMIN]: "Полные права и системная конфигурация",
  [ROLES.ADMINISTRATOR]: "Пользователи, группы, назначения, шаблоны, тесты",
  [ROLES.DEVELOPER]: "Всё, что может Автор, плюс экспорт SCORM и шаблоны оформления",
  [ROLES.AUTHOR]: "Темы, вопросы, тесты: создание, редактирование, публикация",
  [ROLES.MANAGER]: "Группы, обычные пользователи, назначения, результаты",
  [ROLES.LEARNER]: "Прохождение назначенных тестов, свои результаты",
};

/** Comma-separated role labels in priority order (highest first). */
export function formatRoles(roles: readonly Role[] | undefined): string {
  if (!roles || roles.length === 0) return "";
  return ROLE_PRIORITY.filter((r) => roles.includes(r))
    .map((r) => ROLE_LABELS[r])
    .join(", ");
}

/**
 * The label of the single highest-privilege role in the set. Used where a whole
 * comma-separated list would not fit — notably the app shell header, whose user
 * entry has no width cap and would stretch on a multi-role account. Resolves via
 * the same `ROLE_PRIORITY` that picks the default landing area (PRD-13 FR-30), so
 * the caption always names the area the user is actually let into.
 */
export function formatPrimaryRole(roles: readonly Role[] | undefined): string {
  const role = primaryRole(roles ?? []);
  return role ? ROLE_LABELS[role] : "";
}
