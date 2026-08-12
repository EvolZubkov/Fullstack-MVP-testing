/**
 * @module pages/author/groups
 * @description Author groups management page: a searchable groups table with
 * create/edit/delete dialogs, a members viewer and a member-add picker. Rendered
 * entirely with the UniversityRT design system — layout via Stack/Cluster/Box,
 * typography via Text, data via the DS Table/Tag/Input/Textarea/ModalDialog/
 * EmptyState primitives (no raw utility classes).
 */
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
} from "lucide-react";
import { formatRoles } from "@/lib/roles";
import type { Role } from "@shared/access";
import { LoadingState } from "@/components/loading-state";
import {
  Box,
  Button,
  Cluster,
  EmptyState,
  IconButton,
  Input,
  MenuItem,
  MenuTrigger,
  MenuDivider,
  ModalDialog,
  ScrollArea,
  Stack,
  Table,
  Tag,
  Text,
  Textarea,
  type TableColumn,
} from "@universityrt/ui-kit";
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

  // ── Table columns ──
  const groupColumns: TableColumn<Group>[] = [
    { key: "name", header: t.groups.name, render: (g) => <Text variant="body-s" weight="medium">{g.name}</Text> },
    {
      key: "description",
      header: t.groups.groupDescription,
      render: (g) => <Text variant="body-s" tone="muted">{g.description || "—"}</Text>,
    },
    {
      key: "members",
      header: t.groups.membersCount,
      render: (g) => (
        <Tag style={{ cursor: "pointer" }} onClick={() => openMembersDialog(g)}>{g.userCount} чел.</Tag>
      ),
    },
    {
      key: "createdAt",
      header: t.groups.createdAt,
      render: (g) => <Text variant="body-s" tone="muted">{formatDate(g.createdAt)}</Text>,
    },
    {
      key: "actions",
      header: t.groups.actions,
      width: "70px",
      render: (g) => (
        <MenuTrigger
          placement="bottom-end"
          trigger={
            <IconButton variant="ghost" size="s" aria-label={t.groups.actions} icon={<MoreHorizontal size={16} />} />
          }
        >
          <MenuItem icon={<UsersRound size={16} />} onClick={() => openMembersDialog(g)}>{t.groups.viewMembers}</MenuItem>
          <MenuItem icon={<UserPlus size={16} />} onClick={() => openAddMembersDialog(g)}>{t.groups.addMembers}</MenuItem>
          <MenuDivider />
          <MenuItem icon={<Pencil size={16} />} onClick={() => openEditDialog(g)}>{t.common.edit}</MenuItem>
          <MenuItem danger icon={<Trash2 size={16} />} onClick={() => openDeleteDialog(g)}>{t.common.delete}</MenuItem>
        </MenuTrigger>
      ),
    },
  ];

  const memberColumns: TableColumn<User>[] = [
    { key: "email", header: "Email", render: (u) => u.email },
    { key: "name", header: t.users.name, render: (u) => u.name || "—" },
    { key: "role", header: t.users.role, render: (u) => <Tag variant="outline">{formatRoles((u.roles ?? []) as Role[])}</Tag> },
    {
      key: "remove",
      header: "",
      width: "50px",
      render: (u) => (
        <IconButton
          variant="ghost"
          size="s"
          aria-label="Удалить участника"
          icon={<UserMinus size={16} color="var(--ou-error-600)" />}
          onClick={() =>
            selectedGroupDetails &&
            removeUserMutation.mutate({ groupId: selectedGroupDetails.id, userId: u.id })
          }
        />
      ),
    },
  ];

  const availableUserColumns: TableColumn<User>[] = [
    { key: "email", header: "Email", render: (u) => u.email },
    { key: "name", header: t.users.name, render: (u) => u.name || "—" },
    { key: "role", header: t.users.role, render: (u) => <Tag variant="outline">{formatRoles((u.roles ?? []) as Role[])}</Tag> },
  ];

  if (isLoading) {
    return <LoadingState message={t.common.loading} />;
  }

  return (
    <Stack gap={6}>
      <Cluster justify="between" align="start">
        <Stack gap={1}>
          <Text as="h1" variant="display-s" weight="bold">{t.groups.title}</Text>
          <Text as="p" tone="muted">{t.groups.description}</Text>
        </Stack>
        <Button leadingIcon={<Plus size={16} />} onClick={() => { resetForm(); setIsCreateOpen(true); }}>
          {t.groups.createGroup}
        </Button>
      </Cluster>

      {/* Search */}
      <Input
        iconLeft={<Search size={16} />}
        placeholder={t.groups.searchPlaceholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        fullWidth
      />

      {/* Groups Table */}
      {filteredGroups.length === 0 ? (
        <EmptyState
          art={<UsersRound size={48} color="var(--ou-fg-muted)" />}
          title={t.groups.noGroups}
          description={t.groups.noGroupsDescription}
        />
      ) : (
        <Table columns={groupColumns} rows={filteredGroups} rowKey={(g) => g.id} />
      )}

      {/* Create Group Dialog */}
      <ModalDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title={t.groups.createGroup}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleCreateGroup} disabled={!formData.name} loading={createGroupMutation.isPending}>
              {t.common.create}
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <Input
            label={t.groups.name}
            required
            fullWidth
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={t.groups.namePlaceholder}
          />
          <Textarea
            label={t.groups.groupDescription}
            fullWidth
            rows={3}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder={t.groups.descriptionPlaceholder}
          />
        </Stack>
      </ModalDialog>

      {/* Edit Group Dialog */}
      <ModalDialog
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title={t.groups.editGroup}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsEditOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleUpdateGroup} disabled={!formData.name} loading={updateGroupMutation.isPending}>
              {t.common.save}
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <Input
            label={t.groups.name}
            required
            fullWidth
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <Textarea
            label={t.groups.groupDescription}
            fullWidth
            rows={3}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
        </Stack>
      </ModalDialog>

      {/* Members Dialog */}
      <ModalDialog
        open={isMembersOpen}
        onClose={() => setIsMembersOpen(false)}
        size="l"
        title={`${selectedGroupDetails?.name ?? ""} — ${t.groups.members}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsMembersOpen(false)}>{t.common.cancel}</Button>
            <Button
              leadingIcon={<UserPlus size={16} />}
              onClick={() => {
                setIsMembersOpen(false);
                if (selectedGroupDetails) openAddMembersDialog(selectedGroupDetails);
              }}
            >
              {t.groups.addMembers}
            </Button>
          </>
        }
      >
        {selectedGroupDetails?.users.length === 0 ? (
          <Box pad={8}>
            <Text as="p" align="center" tone="muted">В группе пока нет участников</Text>
          </Box>
        ) : (
          <Box border radius="l">
            <ScrollArea maxH="md">
              <Table columns={memberColumns} rows={selectedGroupDetails?.users ?? []} rowKey={(u) => u.id} />
            </ScrollArea>
          </Box>
        )}
      </ModalDialog>

      {/* Add Members Dialog */}
      <ModalDialog
        open={isAddMembersOpen}
        onClose={() => setIsAddMembersOpen(false)}
        size="l"
        title={t.groups.addMembers}
        description={t.groups.selectUsers}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsAddMembersOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleAddMembers} disabled={selectedUserIds.length === 0} loading={addUserMutation.isPending}>
              {t.groups.addMembers} ({selectedUserIds.length})
            </Button>
          </>
        }
      >
        {availableUsers.length === 0 ? (
          <Box pad={8}>
            <Text as="p" align="center" tone="muted">{t.groups.noUsersToAdd}</Text>
          </Box>
        ) : (
          <Box border radius="l">
            <ScrollArea maxH="md">
              <Table
                selectable
                selected={selectedUserIds}
                onSelectChange={setSelectedUserIds}
                columns={availableUserColumns}
                rows={availableUsers}
                rowKey={(u) => u.id}
              />
            </ScrollArea>
          </Box>
        )}
      </ModalDialog>

      {/* Delete Confirmation Dialog */}
      <ModalDialog
        open={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        size="s"
        icon={<Trash2 size={20} />}
        iconTone="danger"
        title={t.groups.confirmDelete}
        description={t.groups.confirmDeleteDescription}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsDeleteOpen(false)}>{t.common.cancel}</Button>
            <Button
              variant="destructive"
              onClick={() => selectedGroup && deleteGroupMutation.mutate(selectedGroup.id)}
              loading={deleteGroupMutation.isPending}
            >
              {t.common.delete}
            </Button>
          </>
        }
      />
    </Stack>
  );
}
