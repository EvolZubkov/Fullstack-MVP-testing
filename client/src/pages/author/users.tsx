import { useState } from "react";
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
  Loader2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: "author" | "learner";
  status: "pending" | "active" | "inactive";
  mustChangePassword: boolean;
  gdprConsent: boolean;
  lastLoginAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface UserAttemptsSummary {
  testId: string;
  testTitle: string;
  maxAttempts: number | null;
  completedAttempts: number;
  inProgressAttempts: number;
}

export default function UsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
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
    role: "learner" as "author" | "learner",
    mustChangePassword: true,
    expiresAt: "",
  });
  const [newPassword, setNewPassword] = useState("");

  // Fetch users
  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Fetch user attempts summary for reset dialog
  const { data: userAttemptsSummary = [], refetch: refetchAttempts } = useQuery<UserAttemptsSummary[]>({
    queryKey: ["/api/users", selectedUser?.id, "attempts-summary"],
    enabled: isResetAttemptsOpen && !!selectedUser,
  });

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsCreateOpen(false);
      resetForm();
      toast({ title: t.users.userCreated, description: t.users.userCreatedDescription });
    },
    onError: (error: Error) => {
      toast({ 
        variant: "destructive", 
        title: t.common.error, 
        description: error.message === "User with this email already exists" 
          ? t.users.emailAlreadyExists 
          : t.users.failedToCreate 
      });
    },
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsEditOpen(false);
      setSelectedUser(null);
      resetForm();
      toast({ title: t.users.userUpdated, description: t.users.userUpdatedDescription });
    },
    onError: (error: Error) => {
      toast({ 
        variant: "destructive", 
        title: t.common.error, 
        description: error.message === "User with this email already exists" 
          ? t.users.emailAlreadyExists 
          : t.users.failedToUpdate 
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
      toast({ title: t.users.userDeactivated, description: t.users.userDeactivatedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.users.failedToDeactivate });
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
      toast({ title: t.users.userActivated, description: t.users.userActivatedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.users.failedToActivate });
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
      toast({ title: t.users.passwordReset, description: t.users.passwordResetDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.users.failedToResetPassword });
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
      toast({ title: "Попытки сброшены", description: "Попытки пользователя успешно сброшены" });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: "Не удалось сбросить попытки" });
    },
  });

  const resetForm = () => {
    setFormData({
      email: "",
      name: "",
      password: "",
      role: "learner",
      mustChangePassword: true,
      expiresAt: "",
    });
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
      email: user.email,
      name: user.name || "",
      password: "",
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      expiresAt: user.expiresAt ? user.expiresAt.split("T")[0] : "",
    });
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
      user.email.toLowerCase().includes(search.toLowerCase()) ||
      (user.name && user.name.toLowerCase().includes(search.toLowerCase()));
    const matchesRole = roleFilter === "all" || user.role === roleFilter;
    const matchesStatus = statusFilter === "all" || user.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="default" className="bg-green-600">{t.users.active}</Badge>;
      case "inactive":
        return <Badge variant="destructive">{t.users.inactive}</Badge>;
      case "pending":
        return <Badge variant="secondary">{t.users.pending}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "author":
        return <Badge variant="default">{t.users.author}</Badge>;
      case "learner":
        return <Badge variant="outline">{t.users.learner}</Badge>;
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t.users.title}</h1>
          <p className="text-muted-foreground">{t.users.description}</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t.users.createUser}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t.users.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t.users.filterByRole} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.users.allRoles}</SelectItem>
            <SelectItem value="author">{t.users.author}</SelectItem>
            <SelectItem value="learner">{t.users.learner}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t.users.filterByStatus} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.users.allStatuses}</SelectItem>
            <SelectItem value="active">{t.users.active}</SelectItem>
            <SelectItem value="inactive">{t.users.inactive}</SelectItem>
            <SelectItem value="pending">{t.users.pending}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Users Table */}
      {filteredUsers.length === 0 ? (
        <div className="text-center py-12 border rounded-lg">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">{t.users.noUsers}</h3>
          <p className="text-muted-foreground">{t.users.noUsersDescription}</p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.users.email}</TableHead>
                <TableHead>{t.users.name}</TableHead>
                <TableHead>{t.users.role}</TableHead>
                <TableHead>{t.users.status}</TableHead>
                <TableHead>{t.users.lastLogin}</TableHead>
                <TableHead>{t.users.createdAt}</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>{user.name || "—"}</TableCell>
                  <TableCell>{getRoleBadge(user.role)}</TableCell>
                  <TableCell>{getStatusBadge(user.status)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(user.lastLoginAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(user.createdAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditDialog(user)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          {t.common.edit}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openResetPasswordDialog(user)}>
                          <KeyRound className="h-4 w-4 mr-2" />
                          {t.users.resetPassword}
                        </DropdownMenuItem>
                        {user.role === "learner" && (
                          <DropdownMenuItem onClick={() => openResetAttemptsDialog(user)}>
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Сбросить попытки
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {user.status === "inactive" ? (
                          <DropdownMenuItem onClick={() => activateUserMutation.mutate(user.id)}>
                            <UserCheck className="h-4 w-4 mr-2" />
                            {t.users.activate}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => openDeactivateDialog(user)}
                            className="text-destructive"
                          >
                            <UserX className="h-4 w-4 mr-2" />
                            {t.users.deactivate}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create User Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.users.createUser}</DialogTitle>
            <DialogDescription>
              Заполните данные для создания нового пользователя.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t.users.email} *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">{t.users.name}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Иван Иванов"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t.users.password} *</Label>
              <div className="flex gap-2">
                <Input
                  id="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Минимум 8 символов"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFormData({ ...formData, password: generatePassword() })}
                >
                  {t.users.generatePassword}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">{t.users.role}</Label>
              <Select
                value={formData.role}
                onValueChange={(value: "author" | "learner") =>
                  setFormData({ ...formData, role: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="learner">{t.users.learner}</SelectItem>
                  <SelectItem value="author">{t.users.author}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="mustChangePassword"
                checked={formData.mustChangePassword}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, mustChangePassword: !!checked })
                }
              />
              <Label htmlFor="mustChangePassword" className="text-sm font-normal">
                {t.users.mustChangePassword}
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiresAt">{t.users.expiresAt}</Label>
              <Input
                id="expiresAt"
                type="date"
                value={formData.expiresAt}
                onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => createUserMutation.mutate(formData)}
              disabled={!formData.email || !formData.password || createUserMutation.isPending}
            >
              {createUserMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.common.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.users.editUser}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-email">{t.users.email} *</Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">{t.users.name}</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">{t.users.role}</Label>
              <Select
                value={formData.role}
                onValueChange={(value: "author" | "learner") =>
                  setFormData({ ...formData, role: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="learner">{t.users.learner}</SelectItem>
                  <SelectItem value="author">{t.users.author}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-mustChangePassword"
                checked={formData.mustChangePassword}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, mustChangePassword: !!checked })
                }
              />
              <Label htmlFor="edit-mustChangePassword" className="text-sm font-normal">
                {t.users.mustChangePassword}
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-expiresAt">{t.users.expiresAt}</Label>
              <Input
                id="edit-expiresAt"
                type="date"
                value={formData.expiresAt}
                onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() =>
                selectedUser &&
                updateUserMutation.mutate({
                  id: selectedUser.id,
                  data: {
                    email: formData.email,
                    name: formData.name || undefined,
                    role: formData.role,
                    mustChangePassword: formData.mustChangePassword,
                    expiresAt: formData.expiresAt || undefined,
                  },
                })
              }
              disabled={!formData.email || updateUserMutation.isPending}
            >
              {updateUserMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={isResetPasswordOpen} onOpenChange={setIsResetPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.users.resetPassword}</DialogTitle>
            <DialogDescription>
              Установите новый временный пароль для {selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">{t.users.newPassword}</Label>
              <div className="flex gap-2">
                <Input
                  id="newPassword"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNewPassword(generatePassword())}
                >
                  {t.users.generatePassword}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {t.users.temporaryPassword}: <code className="bg-muted px-2 py-1 rounded">{newPassword}</code>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetPasswordOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() =>
                selectedUser &&
                resetPasswordMutation.mutate({ id: selectedUser.id, newPassword })
              }
              disabled={!newPassword || resetPasswordMutation.isPending}
            >
              {resetPasswordMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.users.resetPassword}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Attempts Dialog */}
      <Dialog open={isResetAttemptsOpen} onOpenChange={setIsResetAttemptsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Сбросить попытки</DialogTitle>
            <DialogDescription>
              Выберите тест для сброса попыток пользователя {selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {userAttemptsSummary.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                У пользователя нет попыток прохождения тестов
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {userAttemptsSummary.map((item) => (
                  <div
                    key={item.testId}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedTestForReset === item.testId
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                    onClick={() => setSelectedTestForReset(item.testId)}
                  >
                    <div className="font-medium">{item.testTitle}</div>
                    <div className="text-sm text-muted-foreground mt-1">
                      Завершённых: {item.completedAttempts}
                      {item.maxAttempts !== null && ` / ${item.maxAttempts}`}
                      {item.inProgressAttempts > 0 && (
                        <span className="ml-2">• В процессе: {item.inProgressAttempts}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetAttemptsOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                selectedUser &&
                selectedTestForReset &&
                resetAttemptsMutation.mutate({
                  userId: selectedUser.id,
                  testId: selectedTestForReset,
                })
              }
              disabled={!selectedTestForReset || resetAttemptsMutation.isPending}
            >
              {resetAttemptsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Сбросить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate User Dialog */}
      <AlertDialog open={isDeactivateOpen} onOpenChange={setIsDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.users.confirmDeactivate}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.users.confirmDeactivateDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedUser && deactivateUserMutation.mutate(selectedUser.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.users.deactivate}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}