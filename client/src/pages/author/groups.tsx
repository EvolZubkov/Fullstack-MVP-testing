import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  UsersRound,
  UserPlus,
  UserMinus,
  Loader2,
} from "lucide-react";
import { formatRoles } from "@/lib/roles";
import type { Role } from "@shared/access";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n";

interface Group {
  id: string;
  name: string;
  description: string | null;
  userCount: number;
  createdAt: string;
}

interface User {
  id: string;
  email: string;
  name: string | null;
  roles?: string[];
  status: "pending" | "active" | "inactive";
}

interface GroupWithUsers extends Group {
  users: User[];
}

export default function GroupsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [isAddMembersOpen, setIsAddMembersOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [selectedGroupDetails, setSelectedGroupDetails] = useState<GroupWithUsers | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
  });

  // Fetch groups
  const { data: groups = [], isLoading } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
  });

  // Fetch all users for adding to groups
  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Fetch group details with users
  const fetchGroupDetails = async (groupId: string) => {
    const res = await fetch(`/api/groups/${groupId}`, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to fetch group");
    return res.json();
  };

  // Create group mutation
  const createGroupMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create group");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setIsCreateOpen(false);
      resetForm();
      toast({ title: t.groups.groupCreated, description: t.groups.groupCreatedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.groups.failedToCreate });
    },
  });

  // Update group mutation
  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const res = await fetch(`/api/groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update group");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setIsEditOpen(false);
      setSelectedGroup(null);
      toast({ title: t.groups.groupUpdated, description: t.groups.groupUpdatedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.groups.failedToUpdate });
    },
  });

  // Delete group mutation
  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/groups/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete group");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setIsDeleteOpen(false);
      setSelectedGroup(null);
      toast({ title: t.groups.groupDeleted, description: t.groups.groupDeletedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.groups.failedToDelete });
    },
  });

  // Add user to group mutation
  const addUserMutation = useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: string; userId: string }) => {
      const res = await fetch(`/api/groups/${groupId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error("Failed to add user");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({ title: t.groups.memberAdded, description: t.groups.memberAddedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.groups.failedToAddMember });
    },
  });

  // Remove user from group mutation
  const removeUserMutation = useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: string; userId: string }) => {
      const res = await fetch(`/api/groups/${groupId}/users/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove user");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      if (selectedGroupDetails) {
        // Refresh group details
        fetchGroupDetails(selectedGroupDetails.id).then(setSelectedGroupDetails);
      }
      toast({ title: t.groups.memberRemoved, description: t.groups.memberRemovedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.groups.failedToRemoveMember });
    },
  });

  const resetForm = () => {
    setFormData({ name: "", description: "" });
  };

  const handleCreateGroup = () => {
    if (!formData.name) return;
    createGroupMutation.mutate(formData);
  };

  const handleUpdateGroup = () => {
    if (!selectedGroup || !formData.name) return;
    updateGroupMutation.mutate({ id: selectedGroup.id, data: formData });
  };

  const handleAddMembers = async () => {
    if (!selectedGroup || selectedUserIds.length === 0) return;
    
    for (const userId of selectedUserIds) {
      await addUserMutation.mutateAsync({ groupId: selectedGroup.id, userId });
    }
    
    setIsAddMembersOpen(false);
    setSelectedUserIds([]);
    
    // Refresh group details if members dialog is open
    if (selectedGroupDetails) {
      const details = await fetchGroupDetails(selectedGroup.id);
      setSelectedGroupDetails(details);
    }
  };

  const openEditDialog = (group: Group) => {
    setSelectedGroup(group);
    setFormData({ name: group.name, description: group.description || "" });
    setIsEditOpen(true);
  };

  const openDeleteDialog = (group: Group) => {
    setSelectedGroup(group);
    setIsDeleteOpen(true);
  };

  const openMembersDialog = async (group: Group) => {
    setSelectedGroup(group);
    const details = await fetchGroupDetails(group.id);
    setSelectedGroupDetails(details);
    setIsMembersOpen(true);
  };

  const openAddMembersDialog = (group: Group) => {
    setSelectedGroup(group);
    setSelectedUserIds([]);
    setIsAddMembersOpen(true);
  };

  // Filter groups
  const filteredGroups = groups.filter((group) =>
    group.name.toLowerCase().includes(search.toLowerCase())
  );

  // Get users not in the selected group
  const availableUsers = selectedGroupDetails
    ? allUsers.filter((user) => !selectedGroupDetails.users.some((u) => u.id === user.id))
    : allUsers;

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
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
          <h1 className="text-3xl font-bold">{t.groups.title}</h1>
          <p className="text-muted-foreground">{t.groups.description}</p>
        </div>
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          {t.groups.createGroup}
        </Button>
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t.groups.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Groups Table */}
      {filteredGroups.length === 0 ? (
        <div className="text-center py-12">
          <UsersRound className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">{t.groups.noGroups}</h3>
          <p className="text-muted-foreground">{t.groups.noGroupsDescription}</p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.groups.name}</TableHead>
                <TableHead>{t.groups.groupDescription}</TableHead>
                <TableHead>{t.groups.membersCount}</TableHead>
                <TableHead>{t.groups.createdAt}</TableHead>
                <TableHead className="w-[70px]">{t.groups.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGroups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {group.description || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="cursor-pointer" onClick={() => openMembersDialog(group)}>
                      {group.userCount} чел.
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(group.createdAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openMembersDialog(group)}>
                          <UsersRound className="h-4 w-4 mr-2" />
                          {t.groups.viewMembers}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openAddMembersDialog(group)}>
                          <UserPlus className="h-4 w-4 mr-2" />
                          {t.groups.addMembers}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => openEditDialog(group)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          {t.common.edit}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => openDeleteDialog(group)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t.common.delete}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Group Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.groups.createGroup}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t.groups.name} *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t.groups.namePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">{t.groups.groupDescription}</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t.groups.descriptionPlaceholder}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={handleCreateGroup}
              disabled={!formData.name || createGroupMutation.isPending}
            >
              {createGroupMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.common.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Group Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.groups.editGroup}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">{t.groups.name} *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">{t.groups.groupDescription}</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={handleUpdateGroup}
              disabled={!formData.name || updateGroupMutation.isPending}
            >
              {updateGroupMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members Dialog */}
      <Dialog open={isMembersOpen} onOpenChange={setIsMembersOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedGroupDetails?.name} — {t.groups.members}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selectedGroupDetails?.users.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                В группе пока нет участников
              </p>
            ) : (
              <div className="border rounded-lg max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>{t.users.name}</TableHead>
                      <TableHead>{t.users.role}</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedGroupDetails?.users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{user.name || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {formatRoles((user.roles ?? []) as Role[])}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeUserMutation.mutate({
                              groupId: selectedGroupDetails.id,
                              userId: user.id,
                            })}
                          >
                            <UserMinus className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMembersOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => {
              setIsMembersOpen(false);
              if (selectedGroupDetails) {
                openAddMembersDialog(selectedGroupDetails);
              }
            }}>
              <UserPlus className="h-4 w-4 mr-2" />
              {t.groups.addMembers}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Members Dialog */}
      <Dialog open={isAddMembersOpen} onOpenChange={setIsAddMembersOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.groups.addMembers}</DialogTitle>
            <DialogDescription>
              {t.groups.selectUsers}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {availableUsers.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {t.groups.noUsersToAdd}
              </p>
            ) : (
              <div className="border rounded-lg max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]"></TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>{t.users.name}</TableHead>
                      <TableHead>{t.users.role}</TableHead>
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
                          <Badge variant="outline">
                            {formatRoles((user.roles ?? []) as Role[])}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddMembersOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={handleAddMembers}
              disabled={selectedUserIds.length === 0 || addUserMutation.isPending}
            >
              {addUserMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.groups.addMembers} ({selectedUserIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.groups.confirmDelete}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.groups.confirmDeleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedGroup && deleteGroupMutation.mutate(selectedGroup.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}