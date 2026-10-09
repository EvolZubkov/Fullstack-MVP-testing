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
  FileSpreadsheet,
} from "lucide-react";
import {
  Banner,
  Box,
  Button,
  Cluster,
  IconButton,
  Input,
  ModalDialog,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Tag,
  Text,
  type TableColumn,
  useToast,
} from "@skillum/ui-kit";
import { t } from "@/lib/i18n";
import { BulkInviteTab } from "@/features/tests/assign/bulk-invite-tab";

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
  /** `null` — the account has no email (PRD-54 BR-54-42, an imported LMS participant). */
  email: string | null;
  name: string | null;
  status: string;
  tokenStatus: "active" | "revoked" | "none";
}

type AssignTab = "current" | "users" | "groups" | "bulk";

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
  const { push: toast } = useToast();

  const resendUser = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/assignments/${assignmentId}/resend-user/${user.id}`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/assignments/${assignmentId}/group-users`] });
      toast({ tone: "success", title: "Ссылка обновлена", description: `Письмо отправлено ${user.email}` });
    },
    onError: () => toast({ tone: "error", title: "Ошибка", description: "Не удалось обновить ссылку" }),
  });

  const revokeUser = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/assignments/${assignmentId}/revoke-user/${user.id}`, { method: "PATCH", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/assignments/${assignmentId}/group-users`] });
      toast({ tone: "success", title: "Ссылка отозвана" });
    },
    onError: () => toast({ tone: "error", title: "Ошибка", description: "Не удалось отозвать ссылку" }),
  });

  return (
    <Cluster justify="between" gap={0} wrap={false} padY={1} className="tb-row-sep">
      <Cluster gap={3} wrap={false}>
        <Users size={12} color="var(--ou-fg-muted)" />
        <Text weight="medium">{user.email ?? "—"}</Text>
        {user.name && <Text tone="muted">{user.name}</Text>}
      </Cluster>
      <Cluster gap={2} wrap={false}>
        <Tag size="s" tone={user.tokenStatus === "active" ? "success" : "neutral"}>
          {user.tokenStatus === "active" ? "Активна" : user.tokenStatus === "revoked" ? "Отозвана" : "Нет ссылки"}
        </Tag>
        {/* PRD-54 BR-54-42: без почты ссылку отправить некуда — пункт гаснет, а не прячется,
            и подсказка говорит почему; сервер такой запрос отклоняет и сам. */}
        <IconButton
          variant="ghost"
          size="s"
          title={user.email ? "Обновить ссылку и отправить письмо" : "У участника нет почты — ссылку отправить некуда"}
          aria-label="Обновить ссылку"
          // Цвет значка задан явно, поэтому погасшую кнопку приглушает и он: иначе она выглядит живой.
          icon={<RefreshCw size={12} color={user.email ? "var(--ou-info-600)" : "var(--ou-fg-muted)"} />}
          onClick={() => resendUser.mutate()}
          disabled={resendUser.isPending || !user.email}
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
    </Cluster>
  );
}

/** Expanded panel under a group assignment row: its members with link controls. */
function GroupUsersPanel({ assignmentId }: { assignmentId: string }) {
  const { data: groupUsers = [], isLoading } = useQuery<GroupUser[]>({
    queryKey: [`/api/assignments/${assignmentId}/group-users`],
  });

  if (isLoading) {
    return (
      <Cluster gap={2} wrap={false} padX={7} padY={3} surface="subtle" style={{ color: "var(--ou-fg-muted)" }}>
        <Loader2 size={16} className="ou-spin" /> Загрузка участников...
      </Cluster>
    );
  }
  if (groupUsers.length === 0) {
    return <Box padX={7} padY={3} surface="subtle" style={{ color: "var(--ou-fg-muted)" }}>Группа пуста</Box>;
  }
  return (
    <Stack gap={1} padX={7} padY={2} surface="subtle">
      {groupUsers.map((u) => (
        <GroupUserRow key={u.id} user={u} assignmentId={assignmentId} />
      ))}
    </Stack>
  );
}

/** PRD-52: строка списка приглашённых рецензентов. */
interface ReviewerRow {
  userId: string;
  name: string | null;
  email: string | null;
  external: boolean;
  comments: number;
}

interface AssignTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId: string;
  testTitle: string;
  /**
   * PRD-52: зачем открыт диалог. `assign` — назначить прохождение (PRD-28),
   * `review` — отправить тест на рецензирование.
   *
   * Раскладка у них общая, потому что задача общая: выбрать людей и разослать им
   * ссылки. Расходится только выдаваемое право — назначение против гранта
   * `review` — и подписи, которые об этом говорят.
   */
  mode?: "assign" | "review";
}

export function AssignTestDialog({
  open,
  onOpenChange,
  testId,
  testTitle,
  mode = "assign",
}: AssignTestDialogProps) {
  const isReview = mode === "review";
  const { push: toast } = useToast();
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
    enabled: open && !isReview,
  });

  /**
   * PRD-52: приглашённые рецензенты. В режиме рецензирования первая вкладка обязана
   * показывать ИХ, а не участников прохождения: это разные списки, и путать их —
   * значит предлагать отозвать доступ не у того человека.
   */
  const { data: reviewers = [], isLoading: reviewersLoading } = useQuery<ReviewerRow[]>({
    queryKey: [`/api/tests/${testId}/review/reviewers`],
    enabled: open && isReview,
  });

  const revokeReviewer = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/tests/${testId}/review/reviewers/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Не удалось отозвать доступ");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/review/reviewers`] });
      toast({ tone: "success", title: "Доступ отозван", description: "Ссылка рецензента больше не работает." });
    },
    onError: (e: Error) => toast({ tone: "error", title: t.common.error, description: e.message }),
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
      // Рецензенту выдаётся грант и ссылка на окно рецензирования; приглашение
      // идёт поимённо — у рецензирования нет группового назначения, к которому
      // можно было бы приписать группу целиком.
      const res = isReview
        ? await fetch(`/api/tests/${testId}/review/invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            rows: (data.userIds ?? []).map((id) => ({ userId: id })),
            linkExpiresAt: data.linkExpiresAt ?? null,
          }),
        })
        : await fetch(`/api/tests/${testId}/assignments/bulk`, {
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
      toast({ tone: "success", title: t.assignments.assigned, description: t.assignments.assignedDescription });
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: t.assignments.failedToAssign });
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
      toast({ tone: "success", title: t.assignments.removed, description: t.assignments.removedDescription });
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: t.assignments.failedToRemove });
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
      toast({ tone: "success", title: "Ссылка отозвана", description: "Токен доступа деактивирован." });
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: "Не удалось отозвать ссылку." });
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
      toast({ tone: "success", title: "Ссылки обновлены", description: `Отправлено ${data.sent} писем.` });
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: "Не удалось обновить ссылки." });
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
      toast({ tone: "success", title: "Письмо отправлено", description: "Новая ссылка отправлена пользователю." });
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: "Не удалось отправить письмо." });
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
  // PRD-54 BR-54-42: an account without email cannot receive the link, so it is not offered.
  const availableUsers = allUsers.filter(
    (u) => !assignedUserIds.has(u.id) && !groupMemberIds.has(u.id) && (u.roles ?? []).includes("learner")
      && Boolean(u.email)
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

  // Срок сдачи — свойство НАЗНАЧЕНИЯ, которого у рецензирования нет: приглашение
  // рецензента отправляет только срок жизни ссылки (`assignMutation`), и поле
  // сдачи обещало бы поведение, которого не будет. Срок ссылки остаётся: он
  // работает в обоих режимах.
  const dateFields = (
    <Stack direction="row" gap={4}>
      {!isReview && (
        <Box grow>
          <Input
            label={t.assignments.dueDate}
            type="date"
            fullWidth
            value={dueDate}
            onChange={(e) => handleDueDateChange(e.target.value)}
          />
        </Box>
      )}
      <Box grow>
        <Input
          label="Ссылка активна до"
          type="date"
          fullWidth
          value={linkExpiresAt}
          onChange={(e) => setLinkExpiresAt(e.target.value)}
          placeholder="По умолчанию: +30 дней"
        />
      </Box>
    </Stack>
  );

  // ── Table columns ──
  const assignmentColumns: TableColumn<Assignment>[] = [
    {
      key: "assignedTo",
      header: t.assignments.assignedTo,
      render: (a) =>
        a.user ? (
          <div>
            <Text as="p" weight="medium">{a.user.email}</Text>
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
              <Text as="p" weight="medium">{a.group.name}</Text>
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
          <Cluster as="span" gap={1} wrap={false}><Calendar size={12} />{formatDate(a.dueDate)}</Cluster>
        ) : (
          <Text tone="muted">{t.assignments.noDueDate}</Text>
        ),
    },
    {
      key: "linkExpires",
      header: "Ссылка до",
      render: (a) =>
        a.linkExpiresAt ? (
          <Cluster as="span" gap={1} wrap={false}><Link size={12} />{formatDate(a.linkExpiresAt)}</Cluster>
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
    { key: "name", header: t.groups.name, render: (g) => <Text weight="medium">{g.name}</Text> },
    {
      key: "description",
      header: t.groups.groupDescription,
      render: (g) => <Text tone="muted">{g.description || "—"}</Text>,
    },
    { key: "members", header: t.groups.membersCount, render: (g) => <Tag>{g.userCount} чел.</Tag> },
  ];

  // ── Tab panels ──
  const currentPanel = assignmentsLoading ? (
    <Cluster justify="center" wrap={false} padY={7}>
      <Loader2 size={24} className="ou-spin" />
    </Cluster>
  ) : assignments.length === 0 ? (
    <Box padY={7} style={{ textAlign: "center", color: "var(--ou-fg-muted)" }}>
      <Users size={48} style={{ marginInline: "auto", marginBottom: "var(--ou-space-4)", opacity: 0.5 }} />
      <p>{t.assignments.noAssignments}</p>
      <p>{t.assignments.noAssignmentsDescription}</p>
    </Box>
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

  const reviewersPanel = reviewersLoading ? (
    <Cluster justify="center" wrap={false} padY={7}>
      <Loader2 size={24} className="ou-spin" />
    </Cluster>
  ) : reviewers.length === 0 ? (
    <Box padY={7} style={{ textAlign: "center", color: "var(--ou-fg-muted)" }}>
      <Users size={48} style={{ marginInline: "auto", marginBottom: "var(--ou-space-4)", opacity: 0.5 }} />
      <p>Тест ещё никому не отправляли на рецензирование</p>
      <p>Выберите людей на соседних вкладках — каждый получит свою ссылку.</p>
    </Box>
  ) : (
    <Table
      columns={[
        {
          key: "who",
          header: "Рецензент",
          render: (r: ReviewerRow) => (
            <Stack gap={1}>
              <Text weight="medium">{r.name || r.email || r.userId}</Text>
              {r.name && r.email ? <Text variant="body-s" tone="muted">{r.email}</Text> : null}
            </Stack>
          ),
        },
        {
          key: "kind",
          header: "Доступ",
          width: "200px",
          render: (r: ReviewerRow) => (
            <Tag size="s" variant="outline">
              {r.external ? "по ссылке" : "по учётной записи"}
            </Tag>
          ),
        },
        {
          key: "comments",
          header: "Комментариев",
          width: "140px",
          render: (r: ReviewerRow) => (r.comments > 0 ? String(r.comments) : "—"),
        },
        {
          key: "actions",
          header: "",
          width: "120px",
          render: (r: ReviewerRow) => (
            <Button
              variant="ghost"
              size="s"
              onClick={() => revokeReviewer.mutate(r.userId)}
              disabled={revokeReviewer.isPending}
              data-testid={`revoke-reviewer-${r.userId}`}
            >
              Отозвать
            </Button>
          ),
        },
      ]}
      rows={reviewers}
      rowKey={(r: ReviewerRow) => r.userId}
    />
  );

  const usersPanel = (
    <Stack gap={4}>
      <Stack gap={3}>
        {dateFields}
        <Cluster justify="end" gap={0} wrap={false}>
          <Button
            onClick={handleAssignUsers}
            disabled={selectedUserIds.length === 0}
            loading={assignMutation.isPending}
          >
            {isReview ? "Пригласить" : t.assignments.assign} ({selectedUserIds.length})
          </Button>
        </Cluster>
      </Stack>
      {availableUsers.length === 0 ? (
        <Box padY={7} style={{ textAlign: "center", color: "var(--ou-fg-muted)" }}>
          <p>{isReview ? "Все пользователи уже приглашены" : "Все пользователи уже назначены"}</p>
        </Box>
      ) : (
        <ScrollArea maxH="lg">
          <Table
            selectable
            selected={selectedUserIds}
            onSelectChange={setSelectedUserIds}
            columns={userColumns}
            rows={availableUsers}
            rowKey={(u) => u.id}
          />
        </ScrollArea>
      )}
    </Stack>
  );

  const groupsPanel = (
    <Stack gap={4}>
      <Stack gap={3}>
        {dateFields}
        <Cluster justify="end" gap={0} wrap={false}>
          <Button
            onClick={handleAssignGroups}
            disabled={selectedGroupIds.length === 0}
            loading={assignMutation.isPending}
          >
            {isReview ? "Пригласить" : t.assignments.assign} ({selectedGroupIds.length})
          </Button>
        </Cluster>
      </Stack>
      {availableGroups.length === 0 ? (
        <Box padY={7} style={{ textAlign: "center", color: "var(--ou-fg-muted)" }}>
          <p>Все группы уже назначены</p>
        </Box>
      ) : (
        <ScrollArea maxH="lg">
          <Table
            selectable
            selected={selectedGroupIds}
            onSelectChange={setSelectedGroupIds}
            columns={groupColumns}
            rows={availableGroups}
            rowKey={(g) => g.id}
          />
        </ScrollArea>
      )}
    </Stack>
  );

  return (
    <ModalDialog
      open={open}
      onClose={() => onOpenChange(false)}
      size="xl"
      title={isReview ? "Отправить на рецензирование" : t.assignments.manageAssignments}
      description={testTitle}
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {t.common.cancel}
        </Button>
      }
    >
      {isReview ? (
        <Banner tone="info">
          Рецензенты видят комментарии друг друга и могут отвечать в чужих ветках. Прохождение теста по
          этой ссылке не записывается: попытка не создаётся, в аналитике следа нет.
        </Banner>
      ) : null}
      <Tabs<AssignTab>
        variant="segment"
        align="stretch"
        value={activeTab}
        onChange={setActiveTab}
        items={[
          isReview
            ? { id: "current", label: `Приглашены (${reviewers.length})`, content: reviewersPanel }
            : { id: "current", label: `${t.assignments.assignedTo} (${assignments.length})`, content: currentPanel },
          { id: "users", label: t.assignments.users, icon: <Users size={16} />, content: usersPanel },
          // Группы — только у назначения. Рецензентов приглашают ПОИМЁННО: грант
          // выдаётся человеку, ссылка персональная (иначе комментарий нечем
          // подписать), и группового приглашения не существует — вкладка лишь
          // предлагала выбор, который уходил на сервер пустым списком.
          ...(isReview
            ? []
            : [{
              id: "groups" as const,
              label: t.assignments.groups,
              icon: <UsersRound size={16} />,
              content: groupsPanel,
            }]),
          {
            id: "bulk",
            // Не «Списком из файла»: с PRD-28 раздела 16 список можно и набрать.
            label: "Списком",
            icon: <FileSpreadsheet size={16} />,
            content: (
              <BulkInviteTab
                testId={testId}
                testTitle={testTitle}
                onGoToAssignments={() => setActiveTab("current")}
                purpose={mode}
              />
            ),
          },
        ]}
      />
    </ModalDialog>
  );
}
