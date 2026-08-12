/**
 * @module client/components/role-picker
 *
 * Multi-role selector for the user editor (PRD-13, WF-1). Renders the stored
 * roles as a checkbox list with descriptions; roles above the actor's ceiling
 * are disabled. Uses the design-system `ou-check` markup (styled by the ui-kit
 * CSS bundle), matching the approved wireframe.
 */

import { Stack } from "@universityrt/ui-kit";

import { ROLE_PRIORITY, STORED_ROLES, assignableRoles, type Role, type StoredRole } from "@shared/access";
import { ROLE_LABELS, ROLE_DESCRIPTIONS } from "@/lib/roles";

interface RolePickerProps {
  /** Currently selected stored roles. */
  value: string[];
  /** Called with the new role set when a checkbox toggles. */
  onChange: (roles: string[]) => void;
  /** Effective roles of the acting user (drives the assignment ceiling). */
  actorRoles: readonly Role[];
  /** Whether the change happens while creating a user (manager → learner only). */
  atCreation?: boolean;
  /** Render read-only (e.g. for a configuration superadmin account). */
  disabled?: boolean;
}

/** Stored roles in display priority order (highest first); excludes superadmin. */
const ORDERED_ROLES: StoredRole[] = ROLE_PRIORITY.filter((r): r is StoredRole =>
  (STORED_ROLES as readonly string[]).includes(r),
);

export function RolePicker({ value, onChange, actorRoles, atCreation, disabled }: RolePickerProps) {
  const allowed = new Set<string>(assignableRoles(actorRoles, { atCreation }));

  const toggle = (role: StoredRole, checked: boolean) => {
    if (checked) onChange(Array.from(new Set([...value, role])));
    else onChange(value.filter((r) => r !== role));
  };

  return (
    <Stack gap={3} role="group" aria-label="Роли пользователя">
      {ORDERED_ROLES.map((role) => {
        const checked = value.includes(role);
        const isDisabled = disabled || !allowed.has(role);
        return (
          <label key={role} className={`ou-check${isDisabled ? " is-disabled" : ""}`}>
            <input
              className="ou-check__input"
              type="checkbox"
              checked={checked}
              disabled={isDisabled}
              onChange={(e) => toggle(role, e.target.checked)}
            />
            <span className="ou-check__box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span className="ou-check__text">
              <span className="ou-check__lbl">{ROLE_LABELS[role]}</span>
              <span className="ou-check__desc">{ROLE_DESCRIPTIONS[role]}</span>
            </span>
          </label>
        );
      })}
    </Stack>
  );
}
