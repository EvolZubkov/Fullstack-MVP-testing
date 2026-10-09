/**
 * @module pages/author/users
 * @description Author/admin user-management page (PRD-13): a searchable/filterable
 * user table with create/edit drawers, reset-password / reset-attempts / deactivate
 * dialogs and a bulk CSV/Excel import wizard. Rendered entirely with the
 * Skillum design system — layout via Stack/Cluster/Grid/Box, typography via
 * Text, data via the DS Table/Tag/Select/Checkbox/Drawer/ModalDialog primitives
 * (no raw utility classes).
 */
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  MoreHorizontal,
  UserCheck,
  UserX,
  KeyRound,
  Pencil,
  Users,
  RotateCcw,
  Upload,
  Download,
  FileSpreadsheet,
  MailPlus,
} from "lucide-react";
import {
  Box,
  Button,
  Checkbox,
  Cluster,
  Drawer,
  EmptyState,
  FilterBar,
  FilterPanel,
  FilterPanelGroup,
  IconButton,
  Input,
  Label,
  MenuItem,
  MenuTrigger,
  MenuDivider,
  ModalDialog,
  ScrollArea,
  Select,
  Spinner,
  Stack,
  Table,
  Tag,
  Text,
  type TableColumn,
  type Tone,
  useToast,
} from "@skillum/ui-kit";
import { t } from "@/lib/i18n";
import { RolePicker } from "@/components/role-picker";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import { ROLE_PRIORITY, type Role } from "@shared/access";
import { foldOrgValues, orgValueKey, type OrgField, type OrgValueCount } from "@shared/org-fields";
import { OrgFieldControl } from "@/features/users/org-field-control";
import { importableCount, useUsersBulkImport } from "@/features/users/bulk-import/use-users-bulk-import";
import { UsersBulkPreview, UsersBulkResult } from "@/features/users/bulk-import/users-bulk-preview";
import { plural } from "@/features/import/file-meta";
import { mergeShape, stableKey, useListFilters } from "@/features/saved-filters/use-list-filters";

interface User {
  id: string;
  /** `null` — an external participant created by an LMS export import (PRD-54 BR-54-42). */
  email: string | null;
  name: string | null;
  /** Effective stored roles (PRD-13 multi-role). */
  roles?: string[];
  /**
   * PRD-28: an external participant — a FLAG on the account, never a role. Such
   * an account has no password at all, and the only way in is the assignment
   * link. Absent on legacy responses, which is the same as `false`.
   */
  isExternal?: boolean;
  /**
   * PRD-54: ключ, по которому импорт выгрузок LMS находит этого человека. Задаётся руками;
   * отсутствует у тех, кого через выгрузки не опознают.
   */
  externalKey?: string | null;
  /** PRD-54 BR-54-31: идентификатор в LMS (`cmi.learner_id`), по нему связывается телеметрия. */
  lmsLearnerId?: string | null;
  /** План оргструктуры: оргполя профиля — оси срезов аналитики. */
  organization?: string | null;
  unit?: string | null;
  position?: string | null;
  status: "pending" | "active" | "inactive";
  mustChangePassword: boolean;
  gdprConsent: boolean;
  lastLoginAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/**
 * A linking key another account already holds — the server's 409 with the
 * field it concerns. Carried as its own type so the drawer shows the message at
 * that field instead of a generic «failed to save» toast.
 */
class LinkingKeyConflict extends Error {
  constructor(readonly field: "lmsLearnerId" | "externalKey", message: string) {
    super(message);
    this.name = "LinkingKeyConflict";
  }
}

/** Throw the right error for a refused user save. */
async function refusalOf(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  if (res.status === 409 && (body.field === "lmsLearnerId" || body.field === "externalKey")) {
    return new LinkingKeyConflict(body.field, body.error ?? fallback);
  }
  return new Error(body.error || fallback);
}

/** Filter value meaning «the field is empty» (the «Не указано» option). */
const ORG_NONE = "__none__";

/** Conditions of the users list: `all` means the field does not narrow it. */
type UsersFilter = { role: string; status: string; kind: string } & Record<OrgField, string>;

const EMPTY_USERS_FILTER: UsersFilter = {
  role: "all", status: "all", kind: "all", organization: "all", unit: "all", position: "all",
};

/** Does `value` pass an org filter (`all`, {@link ORG_NONE} or a comparison key)? */
function matchesOrgFilter(filter: string, value: string | null | undefined): boolean {
  if (filter === "all") return true;
  const key = orgValueKey(value);
  return filter === ORG_NONE ? key === null : key === filter;
}

interface UserAttemptsSummary {
  testId: string;
  testTitle: string;
  maxAttempts: number | null;
  completedAttempts: number;
  inProgressAttempts: number;
}

export default function UsersPage() {
  const { push: toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  /** Acting user's effective roles, drives the role-assignment ceiling (WF-1). */
  const actorRoles = (currentUser?.roles ?? []) as Role[];

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  /** PRD-28: kind of account — `all` | `staff` | `external`. */
  const [kindFilter, setKindFilter] = useState<string>("all");
  /**
   * Org-structure filters: `all`, {@link ORG_NONE} or the comparison key of a
   * value — so «ОТДЕЛ ПРОДАЖ» and «Отдел продаж» are one choice (plan Р-4).
   */
  const [orgFilters, setOrgFilters] = useState<Record<OrgField, string>>({
    organization: "all", unit: "all", position: "all",
  });
  /**
   * PRD-70 FR-76: the six lists moved from the row into the filter panel. The panel edits a
   * draft and applies it on «Применить», like every filter form of the product.
   */
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const [filterDraft, setFilterDraft] = useState<UsersFilter>(EMPTY_USERS_FILTER);
  /** A linking key the server refused, shown at its field until it is edited. */
  const [keyConflict, setKeyConflict] = useState<LinkingKeyConflict | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isResetAttemptsOpen, setIsResetAttemptsOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedTestForReset, setSelectedTestForReset] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    password: "",
    roles: ["learner"] as string[],
    mustChangePassword: true,
    expiresAt: "",
    /**
     * PRD-54: внешний ключ для связывания импортированных прохождений. Заведение принимает его
     * наравне с правкой (BR-54-28), поэтому поле есть в обоих ящиках.
     */
    externalKey: "",
    /** PRD-54 BR-54-31: идентификатор в LMS. */
    lmsLearnerId: "",
    /** План оргструктуры: выбор из существующих значений или создание (Р-3). */
    organization: "",
    unit: "",
    position: "",
    /**
     * PRD-28 FR-08: create the account as an external participant. The three
     * things such an account cannot have — a password, a wider role set and an
     * invitation letter — are put out in the form and left out of the request:
     * the server refuses a body that asks for both (`POST /api/users`).
     */
    isExternal: false,
    /**
     * Ask the server for an invitation letter (password-setup link) once the
     * account is created. On by default, as in the bulk-import wizard: a person
     * being added normally has to be told they now have an account.
     */
    sendInvite: true,
  });
  const [newPassword, setNewPassword] = useState("");

  // Bulk import: the state is shared with the «Импорт» section (E6), the dialog only frames it.
  const bulk = useUsersBulkImport();
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch users
  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Org-structure values in use — the choices of the profile fields (plan Р-3).
  // Asked for only while a drawer is open: the list itself folds its own values.
  const { data: orgValues } = useQuery<Record<OrgField, OrgValueCount[]>>({
    queryKey: ["/api/users/org-values"],
    enabled: isCreateOpen || isEditOpen,
  });

  // Fetch user attempts summary for reset dialog
  const { data: userAttemptsSummary = [], refetch: refetchAttempts } = useQuery<UserAttemptsSummary[]>({
    queryKey: ["/api/users", selectedUser?.id, "attempts-summary"],
    enabled: isResetAttemptsOpen && !!selectedUser,
  });

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // An external participant is created by what the request LEAVES OUT: the
      // server refuses a body that asks for a password, a wider role set or an
      // invitation letter alongside the flag, rather than dropping them quietly.
      // The org fields and linking keys are allowed for both kinds: a contractor
      // also works in some unit, and may be found by an LMS export.
      const payload = data.isExternal
        ? {
          email: data.email,
          name: data.name,
          expiresAt: data.expiresAt,
          isExternal: true,
          organization: data.organization,
          unit: data.unit,
          position: data.position,
          lmsLearnerId: data.lmsLearnerId,
          externalKey: data.externalKey,
        }
        : data;
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await refusalOf(res, "Failed to create user");
      return res.json() as Promise<{ inviteSent?: boolean }>;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsCreateOpen(false);
      resetForm();
      toast({ tone: "success", title: t.users.userCreated, description: t.users.userCreatedDescription });
      // The account exists either way, so this is a second, weaker signal: the
      // letter that WAS asked for never left (SMTP off — the link is in the
      // server log, and the row menu can re-send it).
      if (variables.sendInvite && !data.inviteSent) {
        toast({
          tone: "warning",
          title: t.users.inviteNotSent,
          description: t.users.inviteNotSentDescription,
        });
      }
    },
    onError: (error: Error) => {
      // A taken key is shown at its field, where it is fixed, not in a toast.
      if (error instanceof LinkingKeyConflict) {
        setKeyConflict(error);
        return;
      }
      toast({
        tone: "error",
        title: t.common.error,
        description: error.message === "User with this email already exists"
          ? t.users.emailAlreadyExists
          : t.users.failedToCreate,
      });
    },
  });

  const handleBulkFile = (file: File) => bulk.preview(file);

  const handleBulkClose = () => {
    setIsBulkOpen(false);
    bulk.reset();
  };

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data, roles }: { id: string; data: Partial<typeof formData>; roles?: string[] }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw await refusalOf(res, "Failed to update user");
      // Roles are managed through a dedicated endpoint (PRD-13, ceiling-checked).
      if (roles) {
        const rolesRes = await fetch(`/api/users/${id}/roles`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ roles }),
        });
        if (!rolesRes.ok) {
          const error = await rolesRes.json();
          throw new Error(error.error || "Failed to update roles");
        }
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsEditOpen(false);
      setSelectedUser(null);
      resetForm();
      toast({ tone: "success", title: t.users.userUpdated, description: t.users.userUpdatedDescription });
    },
    onError: (error: Error) => {
      if (error instanceof LinkingKeyConflict) {
        setKeyConflict(error);
        return;
      }
      toast({
        tone: "error",
        title: t.common.error,
        description: error.message === "User with this email already exists"
          ? t.users.emailAlreadyExists
          : t.users.failedToUpdate,
      });
    },
  });

  // Deactivate user mutation
  const deactivateUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${id}/deactivate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to deactivate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsDeactivateOpen(false);
      setSelectedUser(null);
      toast({ tone: "success", title: t.users.userDeactivated, description: t.users.userDeactivatedDescription });
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: t.users.failedToDeactivate });
    },
  });

  // Activate user mutation
  const activateUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${id}/activate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to activate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ tone: "success", title: t.users.userActivated, description: t.users.userActivatedDescription });
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: t.users.failedToActivate });
    },
  });

  // Reset password mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, newPassword }: { id: string; newPassword: string }) => {
      const res = await fetch(`/api/users/${id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newPassword }),
      });
      if (!res.ok) throw new Error("Failed to reset password");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsResetPasswordOpen(false);
      setSelectedUser(null);
      setNewPassword("");
      toast({ tone: "success", title: t.users.passwordReset, description: t.users.passwordResetDescription });
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: t.users.failedToResetPassword });
    },
  });

  // Invite mutation — re-send the password-setup letter to a pending account.
  // `sent: false` is a success for the request but a failure for the person
  // waiting on the letter (SMTP off), so it gets its own warning toast.
  const inviteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${id}/invite`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to send invite");
      return res.json() as Promise<{ success: boolean; sent: boolean }>;
    },
    onSuccess: (data) => {
      if (data.sent) {
        toast({ tone: "success", title: t.users.inviteSent, description: t.users.inviteSentDescription });
      } else {
        toast({
          tone: "warning",
          title: t.users.inviteNotSent,
          description: t.users.inviteNotSentDescription,
        });
      }
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: t.users.failedToSendInvite });
    },
  });

  // Promote an external participant to an ordinary account (PRD-28 FR-05).
  // One direction only: the reverse would strip an employee of their password
  // and cabinet — a block dressed up as a change of kind.
  const promoteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${id}/promote`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to promote");
      return res.json() as Promise<{ success: boolean; sent: boolean }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      if (data.sent) {
        toast({ tone: "success", title: "Учётная запись штатная", description: "Приглашение задать пароль отправлено." });
      } else {
        // The account has changed kind either way; only the letter is missing.
        toast({
          tone: "warning",
          title: "Учётная запись штатная",
          description: t.users.inviteNotSentDescription,
        });
      }
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: "Не удалось перевести в штатные" });
    },
  });

  // Reset attempts mutation
  const resetAttemptsMutation = useMutation({
    mutationFn: async ({ userId, testId }: { userId: string; testId: string }) => {
      const res = await fetch(`/api/users/${userId}/reset-attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ testId }),
      });
      if (!res.ok) throw new Error("Failed to reset attempts");
      return res.json();
    },
    onSuccess: () => {
      refetchAttempts();
      setSelectedTestForReset(null);
      toast({ tone: "success", title: "Попытки сброшены", description: "Попытки пользователя успешно сброшены" });
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: "Не удалось сбросить попытки" });
    },
  });

  const resetForm = () => {
    setFormData({
      email: "",
      name: "",
      password: "",
      roles: ["learner"],
      mustChangePassword: true,
      expiresAt: "",
      externalKey: "",
      lmsLearnerId: "",
      organization: "",
      unit: "",
      position: "",
      isExternal: false,
      sendInvite: true,
    });
    setKeyConflict(null);
  };

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
    let password = "";
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const openEditDialog = (user: User) => {
    setSelectedUser(user);
    setFormData({
      email: user.email ?? "",
      name: user.name || "",
      password: "",
      roles: user.roles ?? [],
      mustChangePassword: user.mustChangePassword,
      expiresAt: user.expiresAt ? user.expiresAt.split("T")[0] : "",
      externalKey: user.externalKey ?? "",
      lmsLearnerId: user.lmsLearnerId ?? "",
      organization: user.organization ?? "",
      unit: user.unit ?? "",
      position: user.position ?? "",
      // Read-only here: the kind of an account is decided at creation, and the
      // only change of it is «Сделать штатным» in the row menu (PRD-28 FR-05).
      isExternal: user.isExternal ?? false,
      // Editing never mails anything: the invitation is a create-time choice,
      // and an existing pending account is re-invited from the row menu.
      sendInvite: false,
    });
    setKeyConflict(null);
    setIsEditOpen(true);
  };

  const openResetPasswordDialog = (user: User) => {
    setSelectedUser(user);
    setNewPassword(generatePassword());
    setIsResetPasswordOpen(true);
  };

  const openDeactivateDialog = (user: User) => {
    setSelectedUser(user);
    setIsDeactivateOpen(true);
  };

  const openResetAttemptsDialog = (user: User) => {
    setSelectedUser(user);
    setSelectedTestForReset(null);
    setIsResetAttemptsOpen(true);
  };

  // Filter users
  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      (user.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (user.name && user.name.toLowerCase().includes(search.toLowerCase()));
    const matchesRole = roleFilter === "all" || (user.roles ?? []).includes(roleFilter);
    const matchesStatus = statusFilter === "all" || user.status === statusFilter;
    const matchesKind =
      kindFilter === "all" || (kindFilter === "external") === Boolean(user.isExternal);
    const matchesOrg = matchesOrgFilter(orgFilters.organization, user.organization)
      && matchesOrgFilter(orgFilters.unit, user.unit)
      && matchesOrgFilter(orgFilters.position, user.position);
    return matchesSearch && matchesRole && matchesStatus && matchesKind && matchesOrg;
  });

  /**
   * Options of an org filter: the values the list holds, spellings folded
   * (plan Р-4), plus «Не указано» for the empty ones. Built from the list itself,
   * not the dictionary — a filter offering a value no one in the list has would
   * only ever produce an empty table.
   */
  const orgFilterOptions = (field: OrgField, allLabel: string, noneLabel: string) => [
    { value: "all", label: allLabel },
    ...foldOrgValues(users.map((u) => ({ value: u[field] ?? "", users: 1, attempts: 0 })))
      .map((entry) => ({ value: orgValueKey(entry.value) ?? "", label: entry.value, searchText: entry.value })),
    { value: ORG_NONE, label: noneLabel },
  ];

  /** The fields of the filter panel, in the order of the former row (composition unchanged). */
  const usersFilterFields: Array<{
    key: keyof UsersFilter;
    title: string;
    options: Array<{ value: string; label: string; searchText?: string }>;
    searchable?: boolean;
  }> = [
    {
      key: "role",
      title: t.users.filterByRole,
      options: [
        { value: "all", label: t.users.allRoles },
        ...ROLE_PRIORITY.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
      ],
    },
    {
      key: "status",
      title: t.users.filterByStatus,
      options: [
        { value: "all", label: t.users.allStatuses },
        { value: "active", label: t.users.active },
        { value: "inactive", label: t.users.inactive },
        { value: "pending", label: t.users.pending },
      ],
    },
    // PRD-28: kind of account.
    {
      key: "kind",
      title: "Вид учётной записи",
      options: [
        { value: "all", label: "Все виды" },
        { value: "staff", label: "Штатные" },
        { value: "external", label: "Внешние участники" },
      ],
    },
    // Org-structure plan: searchable — a company may have hundreds of units.
    { key: "organization", title: "Организация", options: orgFilterOptions("organization", "Все организации", "Не указана"), searchable: true },
    { key: "unit", title: "Подразделение", options: orgFilterOptions("unit", "Все подразделения", "Не указано"), searchable: true },
    { key: "position", title: "Должность", options: orgFilterOptions("position", "Все должности", "Не указана"), searchable: true },
  ];

  const appliedFilter: UsersFilter = {
    role: roleFilter, status: statusFilter, kind: kindFilter, ...orgFilters,
  };
  const applyUsersFilter = (next: UsersFilter) => {
    setRoleFilter(next.role);
    setStatusFilter(next.status);
    setKindFilter(next.kind);
    setOrgFilters({ organization: next.organization, unit: next.unit, position: next.position });
  };
  // Сохранённые фильтры «Пользователей» (решение владельца 2026-10-05): сохранить в ряду условий,
  // применить и удалить — из «Сохранённых». Значения полей — строки; незнакомое значение просто
  // ничего не отберёт, а чип назовёт его как есть.
  const savedFilters = useListFilters({
    scope: "users",
    current: appliedFilter,
    apply: applyUsersFilter,
    normalize: (conditions) => mergeShape(EMPTY_USERS_FILTER, conditions),
    keyOf: stableKey,
  });
  /** Chips of what is applied: «Поле: значение», one per field narrowed from «all». */
  const filterChips = usersFilterFields
    .filter((field) => appliedFilter[field.key] !== "all")
    .map((field) => ({
      key: field.key,
      label: `${field.title}: ${field.options.find((o) => o.value === appliedFilter[field.key])?.label ?? appliedFilter[field.key]}`,
    }));

  const getStatusBadge = (status: string) => {
    const tone: Tone =
      status === "active" ? "success" : status === "inactive" ? "error" : "neutral";
    const label =
      status === "active" ? t.users.active
        : status === "inactive" ? t.users.inactive
          : status === "pending" ? t.users.pending
            : status;
    if (status === "pending") return <Tag>{label}</Tag>;
    return <Tag tone={tone}>{label}</Tag>;
  };

  /** Render a user's effective roles as a wrapping list of tags (PRD-13). */
  const renderRoleBadges = (roles: string[] | undefined) => {
    const list = roles ?? [];
    if (list.length === 0) return <Text tone="muted">—</Text>;
    const ordered = ROLE_PRIORITY.filter((r) => list.includes(r));
    return (
      <Cluster gap={1}>
        {ordered.map((r) => (
          <Tag key={r} variant="outline">{ROLE_LABELS[r as Role] ?? r}</Tag>
        ))}
      </Cluster>
    );
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ── Table columns ──
  const userColumns: TableColumn<User>[] = [
    {
      key: "email",
      header: t.users.email,
      // PRD-28 FR-07: the mark rides next to the address instead of claiming a
      // column of its own — the flag belongs to a minority of the rows, and an
      // almost-empty column would eat width the list needs elsewhere.
      render: (u) => (
        <Cluster gap={2} wrap={false}>
          {/* PRD-54 BR-54-42: an imported external participant has no address at all. */}
          {u.email
            ? <Text variant="body-s" weight="medium">{u.email}</Text>
            : <Text variant="body-s" tone="muted">—</Text>}
          {u.isExternal && <Tag tone="info" size="s">Внешний</Tag>}
        </Cluster>
      ),
    },
    {
      key: "name",
      header: t.users.name,
      // Org-structure plan: unit and position ride under the name as a muted
      // line instead of columns of their own. Two more columns did not fit next to
      // the sidebar at 1440 px — the DS table clips, and «Создан» with the row menu
      // went past the edge (owner's decision 2026-09-28). The organisation is in
      // the filter and the profile; in most installations it is one for everyone.
      render: (u) => {
        const place = [u.unit, u.position].filter(Boolean).join(" · ");
        return (
          <Stack gap={1}>
            <Text variant="body-s">{u.name || "—"}</Text>
            {place && <Text variant="body-xs" tone="muted">{place}</Text>}
          </Stack>
        );
      },
    },
    { key: "roles", header: t.users.role, render: (u) => renderRoleBadges(u.roles) },
    { key: "status", header: t.users.status, render: (u) => getStatusBadge(u.status) },
    { key: "lastLogin", header: t.users.lastLogin, render: (u) => <Text variant="body-s" tone="muted">{formatDate(u.lastLoginAt)}</Text> },
    { key: "createdAt", header: t.users.createdAt, render: (u) => <Text variant="body-s" tone="muted">{formatDate(u.createdAt)}</Text> },
    {
      key: "actions",
      header: "",
      width: "48px",
      render: (u) => (
        <MenuTrigger
          placement="bottom-end"
          trigger={<IconButton variant="ghost" size="s" aria-label="Действия" icon={<MoreHorizontal size={16} />} />}
        >
          <MenuItem icon={<Pencil size={16} />} onClick={() => openEditDialog(u)}>{t.common.edit}</MenuItem>
          {/* PRD-28: an external participant has no password to reset. The item
              stays visible but dead, so the menu of the two kinds of account
              does not shift under the pointer from row to row. */}
          <MenuItem
            icon={<KeyRound size={16} />}
            title={t.users.resetPassword}
            meta={u.isExternal ? "У внешнего участника пароля нет" : undefined}
            disabled={u.isExternal}
            onClick={() => openResetPasswordDialog(u)}
          />
          {/* Only a never-signed-in account: the letter carries a password-setup
              link, and an external participant is never issued one (FR-04). */}
          {u.status === "pending" && !u.isExternal && (
            <MenuItem
              icon={<MailPlus size={16} />}
              onClick={() => inviteUserMutation.mutate(u.id)}
            >
              {t.users.sendInvite}
            </MenuItem>
          )}
          {(u.roles ?? []).includes("learner") && (
            <MenuItem icon={<RotateCcw size={16} />} onClick={() => openResetAttemptsDialog(u)}>Сбросить попытки</MenuItem>
          )}
          {/* PRD-28 FR-05: external rows only, and there is no item for the
              other direction — that would be a block dressed up as a change of
              kind, and «Заблокировать» already says it plainly. */}
          {u.isExternal && (
            <>
              <MenuDivider />
              {/* PRD-54 BR-54-42: the conversion mails a password-setup link, so an
                  account without email cannot take it until an address is set. */}
              <MenuItem
                icon={<UserCheck size={16} />}
                title="Сделать штатным"
                meta={u.email ? "Уйдёт приглашение задать пароль" : "Сначала задайте почту"}
                disabled={!u.email}
                onClick={() => promoteUserMutation.mutate(u.id)}
              />
            </>
          )}
          <MenuDivider />
          {u.status === "inactive" ? (
            <MenuItem icon={<UserCheck size={16} />} onClick={() => activateUserMutation.mutate(u.id)}>{t.users.activate}</MenuItem>
          ) : (
            <MenuItem danger icon={<UserX size={16} />} onClick={() => openDeactivateDialog(u)}>{t.users.deactivate}</MenuItem>
          )}
        </MenuTrigger>
      ),
    },
  ];

  if (isLoading) {
    return (
      <Stack align="center" justify="center" full>
        <Box pad={8}>
          <Spinner size="l" />
        </Box>
      </Stack>
    );
  }

  const bulkFooter =
    bulk.step === "upload" ? (
      <Cluster justify="between" full>
        <a href="/api/users/bulk-template" download>
          <Cluster gap={1}>
            <Download size={16} color="var(--ou-fg-muted)" />
            <Text variant="body-s" tone="muted">Скачать шаблон Excel</Text>
          </Cluster>
        </a>
        <Button variant="secondary" onClick={handleBulkClose}>Отмена</Button>
      </Cluster>
    ) : bulk.step === "preview" ? (
      <>
        <Button variant="secondary" onClick={() => bulk.setStep("upload")}>Назад</Button>
        <Button
          onClick={bulk.runImport}
          disabled={importableCount(bulk.rows) === 0}
          loading={bulk.importing}
        >
          Импортировать ({plural(importableCount(bulk.rows), ["строка", "строки", "строк"])})
        </Button>
      </>
    ) : (
      <Button onClick={handleBulkClose}>Закрыть</Button>
    );

  // ── Org-structure fields and linking keys: the same in both drawers ──
  // Org fields go right after the name (everyone has them); the linking keys
  // close the form, where «Внешний ключ» already stood — few people need them.
  const orgFieldControls = (
    <>
      <OrgFieldControl
        label="Организация"
        value={formData.organization}
        options={orgValues?.organization ?? []}
        onChange={(organization) => setFormData((d) => ({ ...d, organization }))}
        placeholder="Не указана"
      />
      <OrgFieldControl
        label="Подразделение"
        value={formData.unit}
        options={orgValues?.unit ?? []}
        onChange={(unit) => setFormData((d) => ({ ...d, unit }))}
      />
      <OrgFieldControl
        label="Должность"
        value={formData.position}
        options={orgValues?.position ?? []}
        onChange={(position) => setFormData((d) => ({ ...d, position }))}
        placeholder="Не указана"
      />
    </>
  );

  /** The refusal of a taken key, while the value that caused it is still in the field. */
  const conflictAt = (field: LinkingKeyConflict["field"]) =>
    keyConflict?.field === field ? keyConflict.message : undefined;

  const linkingKeyInputs = (
    <>
      <Input
        label="Идентификатор в LMS"
        hint="По нему прохождения из LMS находят этого человека. Пустое поле — связи нет."
        error={conflictAt("lmsLearnerId")}
        fullWidth
        value={formData.lmsLearnerId}
        onChange={(e) => {
          setFormData({ ...formData, lmsLearnerId: e.target.value });
          if (keyConflict?.field === "lmsLearnerId") setKeyConflict(null);
        }}
      />
      {/* PRD-54: связывание импортированных прохождений. */}
      <Input
        label="Внешний ключ"
        hint="По нему импорт выгрузок LMS находит этого человека. Пустое поле — связи нет."
        error={conflictAt("externalKey")}
        fullWidth
        value={formData.externalKey}
        onChange={(e) => {
          setFormData({ ...formData, externalKey: e.target.value });
          if (keyConflict?.field === "externalKey") setKeyConflict(null);
        }}
      />
    </>
  );

  return (
    <Stack gap={6}>
      <Cluster justify="between" align="start" gap={4}>
        <Stack gap={1}>
          <Text as="h1" variant="display-s" weight="bold">{t.users.title}</Text>
          <Text as="p" tone="muted">{t.users.description}</Text>
        </Stack>
        <Cluster gap={2}>
          <Button variant="secondary" leadingIcon={<Upload size={16} />} onClick={() => setIsBulkOpen(true)}>
            Загрузить CSV
          </Button>
          <Button leadingIcon={<Plus size={16} />} onClick={() => setIsCreateOpen(true)}>
            {t.users.createUser}
          </Button>
        </Cluster>
      </Cluster>

      {/* Filters — DS FilterBar and its FilterPanel (PRD-70 FR-70, FR-76). */}
      <FilterBar
        search={(
          <Input
            size="s"
            iconLeft={<Search size={16} />}
            placeholder={t.users.searchPlaceholder}
            aria-label={t.users.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
          />
        )}
        count={filterChips.length}
        applied={filterChips.map((chip) => ({ id: chip.key, label: chip.label }))}
        filterButtonRef={filterButtonRef}
        filterOpen={filterOpen}
        onOpenFilter={() => {
          if (!filterOpen) setFilterDraft(appliedFilter);
          setFilterOpen(!filterOpen);
        }}
        onRemove={(id) => applyUsersFilter({ ...appliedFilter, [id]: "all" })}
        onReset={() => applyUsersFilter(EMPTY_USERS_FILTER)}
        {...savedFilters}
      />
      <FilterPanel
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        anchorRef={filterButtonRef}
        onReset={() => setFilterDraft(EMPTY_USERS_FILTER)}
        onApply={() => { applyUsersFilter(filterDraft); setFilterOpen(false); }}
      >
        {usersFilterFields.map((field) => (
          <FilterPanelGroup key={field.key} title={field.title}>
            <Select
              value={filterDraft[field.key]}
              onChange={(value) => setFilterDraft((draft) => ({ ...draft, [field.key]: value }))}
              aria-label={field.title}
              searchable={field.searchable}
              options={field.options}
              fullWidth
            />
          </FilterPanelGroup>
        ))}
      </FilterPanel>

      {/* Users Table */}
      {filteredUsers.length === 0 ? (
        <Box border radius="l" pad={8}>
          <EmptyState
            art={<Users size={48} color="var(--ou-fg-subtle)" />}
            title={t.users.noUsers}
            description={t.users.noUsersDescription}
          />
        </Box>
      ) : (
        <Table columns={userColumns} rows={filteredUsers} rowKey={(u) => u.id} />
      )}

      {/* Create User Drawer (PRD-13, WF-1) */}
      <Drawer
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        size="narrow"
        title={t.users.createUser}
        description="Заполните данные для создания нового пользователя."
        footer={
          <Cluster justify="end" gap={2}>
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>{t.common.cancel}</Button>
            <Button
              onClick={() => createUserMutation.mutate(formData)}
              disabled={
                !formData.email ||
                // An external participant needs neither: no password exists and
                // the role set is fixed to `learner` by the server.
                (!formData.isExternal && (!formData.password || formData.roles.length === 0))
              }
              loading={createUserMutation.isPending}
            >
              {t.common.create}
            </Button>
          </Cluster>
        }
      >
        <Stack gap={4}>
          <Input
            label={t.users.email}
            required
            type="email"
            fullWidth
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="user@example.com"
          />
          <Input
            label={t.users.name}
            fullWidth
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Иван Иванов"
          />
          {orgFieldControls}
          {/* PRD-28 FR-08: the kind of the account. Ticking it puts out
              everything an account without a password cannot have — the DS has
              no group-disable, so each control carries its own `disabled`. */}
          <Checkbox
            label="Внешний участник"
            description="Без пароля и без кабинета: единственный путь внутрь — ссылка-приглашение на назначенный тест. Признак можно только снять позже, вернуть нельзя."
            checked={formData.isExternal}
            onChange={(e) =>
              setFormData({
                ...formData,
                isExternal: e.target.checked,
                // Anything the flag forbids is cleared, not merely greyed out:
                // a value left in the state would travel with the request the
                // moment the operator unticks and re-ticks the box.
                ...(e.target.checked
                  ? { password: "", roles: ["learner"], mustChangePassword: false, sendInvite: false }
                  : { mustChangePassword: true, sendInvite: true }),
              })
            }
          />
          <Stack gap={2}>
            <Label required>{t.users.password}</Label>
            <Cluster gap={2} align="stretch">
              <Stack grow>
                <Input
                  fullWidth
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder={formData.isExternal ? "У внешнего участника пароля нет" : "Минимум 8 символов"}
                  disabled={formData.isExternal}
                />
              </Stack>
              <Button
                variant="secondary"
                onClick={() => setFormData({ ...formData, password: generatePassword() })}
                disabled={formData.isExternal}
              >
                {t.users.generatePassword}
              </Button>
            </Cluster>
          </Stack>
          <Stack gap={2}>
            <Label required>Роли</Label>
            {/* FR-01: an external participant is always, and only, a learner. */}
            <RolePicker
              value={formData.roles}
              onChange={(roles) => setFormData({ ...formData, roles })}
              actorRoles={actorRoles}
              atCreation
              disabled={formData.isExternal}
            />
          </Stack>
          <Checkbox
            label={t.users.mustChangePassword}
            checked={formData.mustChangePassword}
            disabled={formData.isExternal}
            onChange={(e) => setFormData({ ...formData, mustChangePassword: e.target.checked })}
          />
          {/* Invitation letter with a password-setup link (valid 7 days), sent
              by the server right after the account is created. */}
          <Checkbox
            label={t.users.sendInvite}
            description={
              formData.isExternal
                ? "Письмо с ключом задания пароля внешнему участнику не выпускается."
                : undefined
            }
            checked={formData.sendInvite}
            disabled={formData.isExternal}
            onChange={(e) => setFormData({ ...formData, sendInvite: e.target.checked })}
          />
          <Input
            label={t.users.expiresAt}
            type="date"
            fullWidth
            value={formData.expiresAt}
            onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
          />
          {linkingKeyInputs}
        </Stack>
      </Drawer>

      {/* Edit User Drawer (PRD-13, WF-1) */}
      <Drawer
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        size="narrow"
        title={t.users.editUser}
        footer={
          <Cluster justify="end" gap={2}>
            <Button variant="secondary" onClick={() => setIsEditOpen(false)}>{t.common.cancel}</Button>
            <Button
              onClick={() =>
                selectedUser &&
                updateUserMutation.mutate({
                  id: selectedUser.id,
                  data: {
                    email: formData.email,
                    name: formData.name || undefined,
                    mustChangePassword: formData.mustChangePassword,
                    expiresAt: formData.expiresAt || undefined,
                    // Always sent, empty included: the server tells «not sent» (keep)
                    // from «sent empty» (clear), and the form edits them both ways.
                    externalKey: formData.externalKey,
                    lmsLearnerId: formData.lmsLearnerId,
                    organization: formData.organization,
                    unit: formData.unit,
                    position: formData.position,
                  },
                  roles: formData.roles,
                })
              }
              // An account without email (PRD-54 BR-54-42) may be saved without one.
              disabled={(!formData.email && Boolean(selectedUser?.email)) || formData.roles.length === 0}
              loading={updateUserMutation.isPending}
            >
              {t.common.save}
            </Button>
          </Cluster>
        }
      >
        <Stack gap={4}>
          <Input
            label={t.users.email}
            required={Boolean(selectedUser?.email)}
            type="email"
            fullWidth
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
          <Input
            label={t.users.name}
            fullWidth
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          {orgFieldControls}
          <Stack gap={2}>
            <Label required>Роли</Label>
            <RolePicker
              value={formData.roles}
              onChange={(roles) => setFormData({ ...formData, roles })}
              actorRoles={actorRoles}
              disabled={(selectedUser?.roles ?? []).includes("superadmin")}
            />
          </Stack>
          <Checkbox
            label={t.users.mustChangePassword}
            checked={formData.mustChangePassword}
            onChange={(e) => setFormData({ ...formData, mustChangePassword: e.target.checked })}
          />
          <Input
            label={t.users.expiresAt}
            type="date"
            fullWidth
            value={formData.expiresAt}
            onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
          />
          {linkingKeyInputs}
        </Stack>
      </Drawer>

      {/* Reset Password Dialog */}
      <ModalDialog
        open={isResetPasswordOpen}
        onClose={() => setIsResetPasswordOpen(false)}
        title={t.users.resetPassword}
        description={`Установите новый временный пароль для ${selectedUser?.email ?? ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsResetPasswordOpen(false)}>{t.common.cancel}</Button>
            <Button
              onClick={() => selectedUser && resetPasswordMutation.mutate({ id: selectedUser.id, newPassword })}
              disabled={!newPassword}
              loading={resetPasswordMutation.isPending}
            >
              {t.users.resetPassword}
            </Button>
          </>
        }
      >
        <Stack gap={2}>
          <Label>{t.users.newPassword}</Label>
          <Cluster gap={2} align="stretch">
            <Stack grow>
              <Input fullWidth value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </Stack>
            <Button variant="secondary" onClick={() => setNewPassword(generatePassword())}>
              {t.users.generatePassword}
            </Button>
          </Cluster>
          <Text as="p" variant="body-s" tone="muted">
            {t.users.temporaryPassword}:{" "}
            <Box as="code" surface="muted" radius="s" pad={1} style={{ display: "inline-block" }}>
              <Text variant="mono-s">{newPassword}</Text>
            </Box>
          </Text>
        </Stack>
      </ModalDialog>

      {/* Reset Attempts Dialog */}
      <ModalDialog
        open={isResetAttemptsOpen}
        onClose={() => setIsResetAttemptsOpen(false)}
        title="Сбросить попытки"
        description={`Выберите тест для сброса попыток пользователя ${selectedUser?.email ?? selectedUser?.name ?? ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsResetAttemptsOpen(false)}>{t.common.cancel}</Button>
            <Button
              variant="destructive"
              onClick={() =>
                selectedUser &&
                selectedTestForReset &&
                resetAttemptsMutation.mutate({ userId: selectedUser.id, testId: selectedTestForReset })
              }
              disabled={!selectedTestForReset}
              loading={resetAttemptsMutation.isPending}
            >
              Сбросить
            </Button>
          </>
        }
      >
        {userAttemptsSummary.length === 0 ? (
          <Box pad={4}>
            <Text as="p" variant="body-s" tone="muted" align="center">
              У пользователя нет попыток прохождения тестов
            </Text>
          </Box>
        ) : (
          <ScrollArea maxH="sm">
            <Stack gap={2}>
              {userAttemptsSummary.map((item) => (
                <Box
                  key={item.testId}
                  border
                  radius="l"
                  pad={3}
                  surface={selectedTestForReset === item.testId ? "muted" : undefined}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedTestForReset(item.testId)}
                >
                  <Stack gap={1}>
                    <Text weight="medium">{item.testTitle}</Text>
                    <Text variant="body-s" tone="muted">
                      Завершённых: {item.completedAttempts}
                      {item.maxAttempts !== null && ` / ${item.maxAttempts}`}
                      {item.inProgressAttempts > 0 && ` • В процессе: ${item.inProgressAttempts}`}
                    </Text>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </ScrollArea>
        )}
      </ModalDialog>

      {/* Deactivate User Confirmation */}
      <ModalDialog
        open={isDeactivateOpen}
        onClose={() => setIsDeactivateOpen(false)}
        size="s"
        icon={<UserX size={20} />}
        iconTone="danger"
        title={t.users.confirmDeactivate}
        description={t.users.confirmDeactivateDescription}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsDeactivateOpen(false)}>{t.common.cancel}</Button>
            <Button
              variant="destructive"
              onClick={() => selectedUser && deactivateUserMutation.mutate(selectedUser.id)}
              loading={deactivateUserMutation.isPending}
            >
              {t.users.deactivate}
            </Button>
          </>
        }
      />

      {/* Bulk Import Dialog */}
      <ModalDialog
        open={isBulkOpen}
        onClose={handleBulkClose}
        size="xl"
        title={
          bulk.step === "upload" ? "Массовая загрузка пользователей"
            : bulk.step === "preview" ? `Предпросмотр: ${plural(bulk.rows.length, ["строка", "строки", "строк"])}`
              : "Импорт завершён"
        }
        description={
          bulk.step === "upload" ? "Загрузите файл CSV или Excel. Обязательная колонка: email. Необязательные: name, role (learner/author), group, external_key, organization, unit, position, lms_learner_id."
            : bulk.step === "preview" ? "Проверьте данные перед импортом. Для дублей выберите действие."
              : undefined
        }
        footer={bulkFooter}
      >
        {/* Step: Upload */}
        {bulk.step === "upload" && (
          <Box
            border
            radius="l"
            pad={8}
            surface={isDragging ? "muted" : undefined}
            style={{ cursor: "pointer", borderStyle: "dashed", borderWidth: "2px" }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) handleBulkFile(file);
            }}
          >
            {bulk.previewing ? (
              <Stack align="center" gap={2}>
                <Spinner size="l" />
                <Text as="p" variant="body-s" tone="muted">Анализируем файл...</Text>
              </Stack>
            ) : (
              <Stack align="center" gap={2}>
                <FileSpreadsheet size={40} color="var(--ou-fg-muted)" />
                <Text as="p" weight="medium">Перетащите файл или нажмите для выбора</Text>
                <Text as="p" variant="body-s" tone="muted">CSV, XLSX — до 500 строк</Text>
              </Stack>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx"
              style={{ display: "none" }}
              aria-label="Файл для импорта пользователей"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBulkFile(f); }}
            />
          </Box>
        )}

        {bulk.step === "preview" && <UsersBulkPreview bulk={bulk} />}
        {bulk.step === "done" && bulk.result && <UsersBulkResult result={bulk.result} />}
      </ModalDialog>
    </Stack>
  );
}
