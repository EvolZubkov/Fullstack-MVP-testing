import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  UsersRound,
  Trash2,
  Loader2,
  Calendar,
  Link,
  RefreshCw,
  Ban,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Button,
  Cluster,
  IconButton,
  Input,
  ModalDialog,
  Stack,
  Table,
  Tabs,
  Tag,
  Text,
  type TableColumn,
} from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n";

interface User {
  id: string;
  email: string;
  name: string | null;
  roles?: string[];
  status: string;
}

interface Group {
  id: string;
  name: string;
  description: string | null;
  userCount: number;
}

interface Assignment {
  id: string;
  testId: string;
  userId: string | null;
  groupId: string | null;
  dueDate: string | null;
  linkExpiresAt: string | null;
  assignedAt: string;
  user?: User | null;
  group?: Group | null;
  groupMemberIds?: string[];
  tokenStatus?: "active" | "expired" | "revoked" | "none";
  tokenId?: string | null;
}

interface GroupUser {
  id: string;
  email: string;
  name: string | null;
  status: string;
  tokenStatus: "active" | "revoked" | "none";
}

type AssignTab = "current" | "users" | "groups";

/** Status badge for an access-link token (DS Tag tones). */
function tokenStatusTag(status?: string) {
  switch (status) {
    case "active":
      return <Tag tone="success">Активна</Tag>;
    case "expired":
      return <Tag tone="warning">Истекла</Tag>;
    case "revoked":
      return <Tag tone="error">Отозвана</Tag>;
    default:
      return <Tag variant="outline">Нет</Tag>;
  }
}

/** One member row inside an expanded group assignment (resend / revoke link). */
function GroupUserRow({ user, assignmentId }: { user: GroupUser; assignmentId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const resendUser = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/assignments/${assignmentId}/resend-user/${user.id}`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/assignments/${assignmentId}/group-users`] });
      toast({ title: "Ссылка обновлена", description: `Письмо отправлено ${user.email}` });
    },
    onError: () => toast({ variant: "destructive", title: "Ошибка", description: "Не удалось обновить ссылку" }),
  });

  const revokeUser = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/assignments/${assignmentId}/revoke-user/${user.id}`, { method: "PATCH", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/assignments/${assignmentId}/group-users`] });
      toast({ title: "Ссылка отозвана" });
    },
    onError: () => toast({ variant: "destructive", title: "Ошибка", description: "Не удалось отозвать ссылку" }),
  });

  return (
    <div className="flex items-center justify-between py-1 text-sm border-b border-border/50 last:border-0">
      <Cluster gap={3} wrap={false}>
        <Users size={12} color="var(--ou-fg-muted)" />
        <span className="font-medium">{user.email}</span>
        {user.name && <Text tone="muted">{user.name}</Text>}
      </Cluster>
      <Cluster gap={2} wrap={false}>
        <Tag size="s" tone={user.tokenStatus === "active" ? "success" : "neutral"}>
          {user.tokenStatus === "active" ? "Активна" : user.tokenStatus === "revoked" ? "Отозвана" : "Нет ссылки"}
        </Tag>
        <IconButton
          variant="ghost"
          size="s"
          title="Обновить ссылку и отправить письмо"
          aria-label="Обновить ссылку"
          icon={<RefreshCw size={12} color="var(--ou-info-600)" />}
          onClick={() => resendUser.mutate()}
          disabled={resendUser.isPending}
        />
        {user.tokenStatus === "active" && (
          <IconButton
            variant="ghost"
            size="s"
            title="Отозвать ссылку"
            aria-label="Отозвать ссылку"
            icon={<Ban size={12} color="var(--ou-warning-600)" />}
            onClick={() => revokeUser.mutate()}
            disabled={revokeUser.isPending}
          />
        )}
      </Cluster>
    </div>
  );
}

/** Expanded panel under a group assignment row: its members with link controls. */
function GroupUsersPanel({ assignmentId }: { assignmentId: string }) {
  const { data: groupUsers = [], isLoading } = useQuery<GroupUser[]>({
    queryKey: [`/api/assignments/${assignmentId}/group-users`],
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-8 py-3 text-sm text-muted-foreground bg-muted/30">
        <Loader2 size={16} className="animate-spin" /> Загрузка участников...
      </div>
    );
  }
  if (groupUsers.length === 0) {
    return <div className="px-8 py-3 text-sm text-muted-foreground bg-muted/30">Группа пуста</div>;
  }
  return (
    <div className="px-8 py-2 space-y-1 bg-muted/30">
      {groupUsers.map((u) => (
        <GroupUserRow key={u.id} user={u} assignmentId={assignmentId} />
      ))}
    </div>
  );
}

interface AssignTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId: string;
  testTitle: string;
}

export function AssignTestDialog({
  open,
  onOpenChange,
  testId,
  testTitle,
}: AssignTestDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<AssignTab>("current");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string>("");
  const [linkExpiresAt, setLinkExpiresAt] = useState<string>("");
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  // Sync linkExpiresAt with dueDate unless manually overridden
  const handleDueDateChange = (value: string) => {
    setDueDate(value);
    // Auto-fill link expiry from due date if not manually set yet
    if (!linkExpiresAt || linkExpiresAt === dueDate) {
      setLinkExpiresAt(value);
    }
  };

  // Fetch current assignments
  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<Assignment[]>({
    queryKey: [`/api/tests/${testId}/assignments`],
    enabled: open,
  });

  // Fetch all users
  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: open,
  });

  // Fetch all groups
  const { data: allGroups = [] } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
    enabled: open,
  });

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: async (data: { userIds?: string[]; groupIds?: string[]; dueDate?: string; linkExpiresAt?: string }) => {
      const res = await fetch(`/api/tests/${testId}/assignments/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to assign");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/assignments`] });
      setSelectedUserIds([]);
      setSelectedGroupIds([]);
      setDueDate("");
      setLinkExpiresAt("");
      setActiveTab("current");
      toast({ title: t.assignments.assigned, description: t.assignments.assignedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.assignments.failedToAssign });
    },
  });

  // Remove assignment mutation
  const removeMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const res = await fetch(`/api/assignments/${assignmentId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/assignments`] });
      toast({ title: t.assignments.removed, description: t.assignments.removedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.assignments.failedToRemove });
    },
  });

  // Revoke token mutation
  const revokeTokenMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      const res = await fetch(`/api/assignment-tokens/${tokenId}/revoke`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to revoke");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/assignments`] });
      toast({ title: "Ссылка отозвана", description: "Токен доступа деактивирован." });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: "Не удалось отозвать ссылку." });
    },
  });

  // Resend group mutation
  const resendGroupMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const res = await fetch(`/api/assignments/${assignmentId}/resend-group`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to resend group");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/assignments`] });
      toast({ title: "Ссылки обновлены", description: `Отправлено ${data.sent} писем.` });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: "Не удалось обновить ссылки." });
    },
  });

  // Resend email mutation
  const resendMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const res = await fetch(`/api/assignments/${assignmentId}/resend`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to resend");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/assignments`] });
      toast({ title: "Письмо отправлено", description: "Новая ссылка отправлена пользователю." });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: "Не удалось отправить письмо." });
    },
  });

  const handleAssignUsers = () => {
    if (selectedUserIds.length === 0) return;
    assignMutation.mutate({
      userIds: selectedUserIds,
      dueDate: dueDate || undefined,
      linkExpiresAt: linkExpiresAt || undefined,
    });
  };

  const handleAssignGroups = () => {
    if (selectedGroupIds.length === 0) return;
    assignMutation.mutate({
      groupIds: selectedGroupIds,
      dueDate: dueDate || undefined,
      linkExpiresAt: linkExpiresAt || undefined,
    });
  };

  // Filter out already assigned users (directly or via group membership)
  const assignedUserIds = new Set(assignments.filter((a) => a.userId).map((a) => a.userId!));
  const groupMemberIds = new Set(assignments.flatMap((a) => a.groupMemberIds ?? []));
  const availableUsers = allUsers.filter(
    (u) => !assignedUserIds.has(u.id) && !groupMemberIds.has(u.id) && (u.roles ?? []).includes("learner")
  );

  // Filter out already assigned groups
  const assignedGroupIds = assignments
    .filter((a) => a.groupId)
    .map((a) => a.groupId!);
  const availableGroups = allGroups.filter(
    (g) => !assignedGroupIds.includes(g.id)
  );

  const formatDate = (date: string | null) => {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const toggleExpand = (id: string) =>
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const dateFields = (
    <div className="flex gap-4">
      <div className="flex-1">
        <Input
          label={t.assignments.dueDate}
          type="date"
          fullWidth
          value={dueDate}
          onChange={(e) => handleDueDateChange(e.target.value)}
        />
      </div>
      <div className="flex-1">
        <Input
          label="Ссылка активна до"
          type="date"
          fullWidth
          value={linkExpiresAt}
          onChange={(e) => setLinkExpiresAt(e.target.value)}
          placeholder="По умолчанию: +30 дней"
        />
      </div>
    </div>
  );

  // ── Table columns ──
  const assignmentColumns: TableColumn<Assignment>[] = [
    {
      key: "assignedTo",
      header: t.assignments.assignedTo,
      render: (a) =>
        a.user ? (
          <div>
            <p className="font-medium">{a.user.email}</p>
            {a.user.name && <Text as="p" tone="muted">{a.user.name}</Text>}
          </div>
        ) : a.group ? (
          <Cluster gap={2} wrap={false}>
            {expandedGroupIds.has(a.id) ? (
              <ChevronDown size={16} color="var(--ou-fg-muted)" />
            ) : (
              <ChevronRight size={16} color="var(--ou-fg-muted)" />
            )}
            <div>
              <p className="font-medium">{a.group.name}</p>
              <Text as="p" tone="muted">{a.group.userCount} чел.</Text>
            </div>
          </Cluster>
        ) : (
          "—"
        ),
    },
    {
      key: "type",
      header: "Тип",
      render: (a) =>
        a.user ? (
          <Tag variant="outline" icon={<Users size={12} />}>Пользователь</Tag>
        ) : (
          <Tag variant="outline" icon={<UsersRound size={12} />}>Группа</Tag>
        ),
    },
    {
      key: "dueDate",
      header: t.assignments.dueDate,
      render: (a) =>
        a.dueDate ? (
          <span className="flex items-center gap-1"><Calendar size={12} />{formatDate(a.dueDate)}</span>
        ) : (
          <Text tone="muted">{t.assignments.noDueDate}</Text>
        ),
    },
    {
      key: "linkExpires",
      header: "Ссылка до",
      render: (a) =>
        a.linkExpiresAt ? (
          <span className="flex items-center gap-1 text-sm"><Link size={12} />{formatDate(a.linkExpiresAt)}</span>
        ) : (
          <Text tone="muted">—</Text>
        ),
    },
    {
      key: "linkStatus",
      header: "Статус ссылки",
      render: (a) =>
        a.groupId ? (
          <Tag variant="outline" icon={<UsersRound size={12} />}>{a.group?.userCount ?? 0} ссылок</Tag>
        ) : (
          tokenStatusTag(a.tokenStatus)
        ),
    },
    {
      key: "actions",
      header: "",
      width: "120px",
      render: (a) => (
        <Cluster gap={1} wrap={false} onClick={(e) => e.stopPropagation()}>
          {a.userId && (
            <IconButton
              variant="ghost"
              size="s"
              title="Отправить письмо повторно"
              aria-label="Отправить письмо повторно"
              icon={<RefreshCw size={16} color="var(--ou-info-600)" />}
              onClick={() => resendMutation.mutate(a.id)}
              disabled={resendMutation.isPending}
            />
          )}
          {a.groupId && (
            <IconButton
              variant="ghost"
              size="s"
              title="Обновить ссылки для всей группы"
              aria-label="Обновить ссылки для всей группы"
              icon={<RefreshCw size={16} color="var(--ou-info-600)" />}
              onClick={() => resendGroupMutation.mutate(a.id)}
              disabled={resendGroupMutation.isPending}
            />
          )}
          {a.tokenId && a.tokenStatus === "active" && (
            <IconButton
              variant="ghost"
              size="s"
              title="Отозвать ссылку"
              aria-label="Отозвать ссылку"
              icon={<Ban size={16} color="var(--ou-warning-600)" />}
              onClick={() => revokeTokenMutation.mutate(a.tokenId!)}
              disabled={revokeTokenMutation.isPending}
            />
          )}
          <IconButton
            variant="ghost"
            size="s"
            title="Удалить назначение"
            aria-label="Удалить назначение"
            icon={<Trash2 size={16} color="var(--ou-error-600)" />}
            onClick={() => removeMutation.mutate(a.id)}
            disabled={removeMutation.isPending}
          />
        </Cluster>
      ),
    },
  ];

  const userColumns: TableColumn<User>[] = [
    { key: "email", header: "Email", render: (u) => u.email },
    { key: "name", header: t.users.name, render: (u) => u.name || "—" },
    {
      key: "status",
      header: t.users.status,
      render: (u) => (
        <Tag tone={u.status === "active" ? "success" : "neutral"}>
          {u.status === "active" ? t.users.active : t.users.pending}
        </Tag>
      ),
    },
  ];

  const groupColumns: TableColumn<Group>[] = [
    { key: "name", header: t.groups.name, render: (g) => <span className="font-medium">{g.name}</span> },
    {
      key: "description",
      header: t.groups.groupDescription,
      render: (g) => <Text tone="muted">{g.description || "—"}</Text>,
    },
    { key: "members", header: t.groups.membersCount, render: (g) => <Tag>{g.userCount} чел.</Tag> },
  ];

  // ── Tab panels ──
  const currentPanel = assignmentsLoading ? (
    <div className="flex items-center justify-center py-8">
      <Loader2 size={24} className="animate-spin" />
    </div>
  ) : assignments.length === 0 ? (
    <div className="text-center py-8 text-muted-foreground">
      <Users size={48} className="mx-auto mb-4 opacity-50" />
      <p>{t.assignments.noAssignments}</p>
      <p className="text-sm">{t.assignments.noAssignmentsDescription}</p>
    </div>
  ) : (
    <Table
      columns={assignmentColumns}
      rows={assignments}
      rowKey={(a) => a.id}
      onRowClick={(a) => { if (a.groupId) toggleExpand(a.id); }}
      expandedKeys={Array.from(expandedGroupIds)}
      renderExpanded={(a) => (a.groupId ? <GroupUsersPanel assignmentId={a.id} /> : null)}
    />
  );

  const usersPanel = (
    <Stack gap={4}>
      <Stack gap={3}>
        {dateFields}
        <div className="flex justify-end">
          <Button
            onClick={handleAssignUsers}
            disabled={selectedUserIds.length === 0}
            loading={assignMutation.isPending}
          >
            {t.assignments.assign} ({selectedUserIds.length})
          </Button>
        </div>
      </Stack>
      {availableUsers.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>Все пользователи уже назначены</p>
        </div>
      ) : (
        <div className="max-h-[300px] overflow-y-auto">
          <Table
            selectable
            selected={selectedUserIds}
            onSelectChange={setSelectedUserIds}
            columns={userColumns}
            rows={availableUsers}
            rowKey={(u) => u.id}
          />
        </div>
      )}
    </Stack>
  );

  const groupsPanel = (
    <Stack gap={4}>
      <Stack gap={3}>
        {dateFields}
        <div className="flex justify-end">
          <Button
            onClick={handleAssignGroups}
            disabled={selectedGroupIds.length === 0}
            loading={assignMutation.isPending}
          >
            {t.assignments.assign} ({selectedGroupIds.length})
          </Button>
        </div>
      </Stack>
      {availableGroups.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>Все группы уже назначены</p>
        </div>
      ) : (
        <div className="max-h-[300px] overflow-y-auto">
          <Table
            selectable
            selected={selectedGroupIds}
            onSelectChange={setSelectedGroupIds}
            columns={groupColumns}
            rows={availableGroups}
            rowKey={(g) => g.id}
          />
        </div>
      )}
    </Stack>
  );

  return (
    <ModalDialog
      open={open}
      onClose={() => onOpenChange(false)}
      size="xl"
      title={t.assignments.manageAssignments}
      description={testTitle}
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {t.common.cancel}
        </Button>
      }
    >
      <Tabs<AssignTab>
        variant="segment"
        align="stretch"
        value={activeTab}
        onChange={setActiveTab}
        items={[
          { id: "current", label: `${t.assignments.assignedTo} (${assignments.length})`, content: currentPanel },
          { id: "users", label: t.assignments.users, icon: <Users size={16} />, content: usersPanel },
          { id: "groups", label: t.assignments.groups, icon: <UsersRound size={16} />, content: groupsPanel },
        ]}
      />
    </ModalDialog>
  );
}
