import React, { useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: "author" | "learner";
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

function GroupUserRow({ user, assignmentId, testId }: { user: GroupUser; assignmentId: string; testId: string }) {
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
      <div className="flex items-center gap-3">
        <Users className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium">{user.email}</span>
        {user.name && <span className="text-muted-foreground">{user.name}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={user.tokenStatus === "active" ? "default" : "secondary"} className={user.tokenStatus === "active" ? "bg-green-600 text-white text-xs" : "text-xs"}>
          {user.tokenStatus === "active" ? "Активна" : user.tokenStatus === "revoked" ? "Отозвана" : "Нет ссылки"}
        </Badge>
        <Button variant="ghost" size="icon" className="h-6 w-6" title="Обновить ссылку и отправить письмо" onClick={() => resendUser.mutate()} disabled={resendUser.isPending}>
          <RefreshCw className="h-3 w-3 text-blue-500" />
        </Button>
        {user.tokenStatus === "active" && (
          <Button variant="ghost" size="icon" className="h-6 w-6" title="Отозвать ссылку" onClick={() => revokeUser.mutate()} disabled={revokeUser.isPending}>
            <Ban className="h-3 w-3 text-orange-500" />
          </Button>
        )}
      </div>
    </div>
  );
}

function AssignmentRow({
  assignment, expanded, onToggleExpand, formatDate, tokenStatusBadge,
  onResend, onResendGroup, onRevoke, onRemove,
  resendPending, resendGroupPending, revokePending, removePending, testId,
}: {
  assignment: Assignment;
  expanded: boolean;
  onToggleExpand: () => void;
  formatDate: (d: string | null) => string;
  tokenStatusBadge: (s?: string) => React.ReactNode;
  onResend: () => void;
  onResendGroup: () => void;
  onRevoke: () => void;
  onRemove: () => void;
  resendPending: boolean;
  resendGroupPending: boolean;
  testId: string;
  revokePending: boolean;
  removePending: boolean;
}) {
  const isGroup = !!assignment.groupId;

  const { data: groupUsers = [], isLoading: groupUsersLoading } = useQuery<GroupUser[]>({
    queryKey: [`/api/assignments/${assignment.id}/group-users`],
    enabled: isGroup && expanded,
  });

  return (
    <>
      <TableRow className={isGroup ? "cursor-pointer hover:bg-muted/50" : ""} onClick={isGroup ? onToggleExpand : undefined}>
        <TableCell>
          {assignment.user ? (
            <div>
              <p className="font-medium">{assignment.user.email}</p>
              {assignment.user.name && <p className="text-sm text-muted-foreground">{assignment.user.name}</p>}
            </div>
          ) : assignment.group ? (
            <div className="flex items-center gap-2">
              {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              <div>
                <p className="font-medium">{assignment.group.name}</p>
                <p className="text-sm text-muted-foreground">{assignment.group.userCount} чел.</p>
              </div>
            </div>
          ) : "—"}
        </TableCell>
        <TableCell>
          <Badge variant="outline">
            {assignment.user ? <><Users className="h-3 w-3 mr-1" /> Пользователь</> : <><UsersRound className="h-3 w-3 mr-1" /> Группа</>}
          </Badge>
        </TableCell>
        <TableCell>
          {assignment.dueDate ? (
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDate(assignment.dueDate)}</span>
          ) : (
            <span className="text-muted-foreground">{t.assignments.noDueDate}</span>
          )}
        </TableCell>
        <TableCell>
          {assignment.linkExpiresAt ? (
            <span className="flex items-center gap-1 text-sm"><Link className="h-3 w-3" />{formatDate(assignment.linkExpiresAt)}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          )}
        </TableCell>
        <TableCell>
          {isGroup ? <Badge variant="outline"><UsersRound className="h-3 w-3 mr-1" />{assignment.group?.userCount ?? 0} ссылок</Badge> : tokenStatusBadge(assignment.tokenStatus)}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            {assignment.userId && (
              <Button variant="ghost" size="icon" title="Отправить письмо повторно" onClick={onResend} disabled={resendPending}>
                <RefreshCw className="h-4 w-4 text-blue-500" />
              </Button>
            )}
            {isGroup && (
              <Button variant="ghost" size="icon" title="Обновить ссылки для всей группы" onClick={onResendGroup} disabled={resendGroupPending}>
                <RefreshCw className="h-4 w-4 text-blue-500" />
              </Button>
            )}
            {assignment.tokenId && assignment.tokenStatus === "active" && (
              <Button variant="ghost" size="icon" title="Отозвать ссылку" onClick={onRevoke} disabled={revokePending}>
                <Ban className="h-4 w-4 text-orange-500" />
              </Button>
            )}
            <Button variant="ghost" size="icon" title="Удалить назначение" onClick={onRemove} disabled={removePending}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded group users */}
      {isGroup && expanded && (
        <TableRow>
          <TableCell colSpan={6} className="p-0 bg-muted/30">
            {groupUsersLoading ? (
              <div className="flex items-center gap-2 px-8 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Загрузка участников...
              </div>
            ) : groupUsers.length === 0 ? (
              <div className="px-8 py-3 text-sm text-muted-foreground">Группа пуста</div>
            ) : (
              <div className="px-8 py-2 space-y-1">
                {groupUsers.map(u => (
                  <GroupUserRow
                    key={u.id}
                    user={u}
                    assignmentId={assignment.id}
                    testId={testId}
                  />
                ))}
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
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

  const [activeTab, setActiveTab] = useState<"current" | "users" | "groups">("current");
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
    (u) => !assignedUserIds.has(u.id) && !groupMemberIds.has(u.id) && u.role === "learner"
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

  const tokenStatusBadge = (status?: string) => {
    switch (status) {
      case "active":
        return <Badge variant="default" className="bg-green-600 text-white">Активна</Badge>;
      case "expired":
        return <Badge variant="secondary">Истекла</Badge>;
      case "revoked":
        return <Badge variant="destructive">Отозвана</Badge>;
      default:
        return <Badge variant="outline">Нет</Badge>;
    }
  };

  const dateFields = (tabId: string) => (
    <div className="flex items-end gap-4">
      <div className="flex-1">
        <Label htmlFor={`due-date-${tabId}`}>{t.assignments.dueDate}</Label>
        <Input
          id={`due-date-${tabId}`}
          type="date"
          value={dueDate}
          onChange={(e) => handleDueDateChange(e.target.value)}
          className="mt-1"
        />
      </div>
      <div className="flex-1">
        <Label htmlFor={`link-expires-${tabId}`}>Ссылка активна до</Label>
        <Input
          id={`link-expires-${tabId}`}
          type="date"
          value={linkExpiresAt}
          onChange={(e) => setLinkExpiresAt(e.target.value)}
          className="mt-1"
          placeholder="По умолчанию: +30 дней"
        />
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t.assignments.manageAssignments}</DialogTitle>
          <DialogDescription>{testTitle}</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="current">
              {t.assignments.assignedTo} ({assignments.length})
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="h-4 w-4 mr-2" />
              {t.assignments.users}
            </TabsTrigger>
            <TabsTrigger value="groups">
              <UsersRound className="h-4 w-4 mr-2" />
              {t.assignments.groups}
            </TabsTrigger>
          </TabsList>

          {/* Current Assignments Tab */}
          <TabsContent value="current" className="flex-1 overflow-auto mt-4">
            {assignmentsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : assignments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t.assignments.noAssignments}</p>
                <p className="text-sm">{t.assignments.noAssignmentsDescription}</p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.assignments.assignedTo}</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>{t.assignments.dueDate}</TableHead>
                      <TableHead>Ссылка до</TableHead>
                      <TableHead>Статус ссылки</TableHead>
                      <TableHead className="w-[110px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((assignment) => (
                      <AssignmentRow
                        key={assignment.id}
                        assignment={assignment}
                        expanded={expandedGroupIds.has(assignment.id)}
                        onToggleExpand={() => setExpandedGroupIds(prev => {
                          const next = new Set(prev);
                          next.has(assignment.id) ? next.delete(assignment.id) : next.add(assignment.id);
                          return next;
                        })}
                        formatDate={formatDate}
                        tokenStatusBadge={tokenStatusBadge}
                        onResend={() => resendMutation.mutate(assignment.id)}
                        onResendGroup={() => resendGroupMutation.mutate(assignment.id)}
                        onRevoke={() => revokeTokenMutation.mutate(assignment.tokenId!)}
                        onRemove={() => removeMutation.mutate(assignment.id)}
                        resendPending={resendMutation.isPending}
                        resendGroupPending={resendGroupMutation.isPending}
                        revokePending={revokeTokenMutation.isPending}
                        removePending={removeMutation.isPending}
                        testId={testId}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Assign to Users Tab */}
          <TabsContent value="users" className="flex-1 overflow-auto mt-4 space-y-4">
            <div className="space-y-3">
              {dateFields("users")}
              <div className="flex justify-end">
                <Button
                  onClick={handleAssignUsers}
                  disabled={selectedUserIds.length === 0 || assignMutation.isPending}
                >
                  {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t.assignments.assign} ({selectedUserIds.length})
                </Button>
              </div>
            </div>

            {availableUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Все пользователи уже назначены</p>
              </div>
            ) : (
              <div className="border rounded-lg max-h-[300px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={selectedUserIds.length === availableUsers.length && availableUsers.length > 0}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedUserIds(availableUsers.map((u) => u.id));
                            } else {
                              setSelectedUserIds([]);
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>{t.users.name}</TableHead>
                      <TableHead>{t.users.status}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {availableUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedUserIds.includes(user.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedUserIds([...selectedUserIds, user.id]);
                              } else {
                                setSelectedUserIds(selectedUserIds.filter((id) => id !== user.id));
                              }
                            }}
                          />
                        </TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{user.name || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={user.status === "active" ? "default" : "secondary"}>
                            {user.status === "active" ? t.users.active : t.users.pending}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Assign to Groups Tab */}
          <TabsContent value="groups" className="flex-1 overflow-auto mt-4 space-y-4">
            <div className="space-y-3">
              {dateFields("groups")}
              <div className="flex justify-end">
                <Button
                  onClick={handleAssignGroups}
                  disabled={selectedGroupIds.length === 0 || assignMutation.isPending}
                >
                  {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t.assignments.assign} ({selectedGroupIds.length})
                </Button>
              </div>
            </div>

            {availableGroups.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Все группы уже назначены</p>
              </div>
            ) : (
              <div className="border rounded-lg max-h-[300px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={selectedGroupIds.length === availableGroups.length && availableGroups.length > 0}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedGroupIds(availableGroups.map((g) => g.id));
                            } else {
                              setSelectedGroupIds([]);
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead>{t.groups.name}</TableHead>
                      <TableHead>{t.groups.groupDescription}</TableHead>
                      <TableHead>{t.groups.membersCount}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {availableGroups.map((group) => (
                      <TableRow key={group.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedGroupIds.includes(group.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedGroupIds([...selectedGroupIds, group.id]);
                              } else {
                                setSelectedGroupIds(selectedGroupIds.filter((id) => id !== group.id));
                              }
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{group.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {group.description || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{group.userCount} чел.</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
