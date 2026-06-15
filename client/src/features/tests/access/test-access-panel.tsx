/**
 * @module features/tests/access/test-access-panel
 *
 * Per-test access management panel (PRD-13, WF-2). Shows the test owner and the
 * list of edit/assign grants, lets an administrator change the owner, add, retune
 * or revoke grants, and applies every change at once on an explicit "Сохранить".
 * The panel is admin/superadmin only — the caller gates the trigger by the
 * `tests.access.grant` capability; the server enforces it on every endpoint.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Drawer, Button, IconButton, Avatar, Select, Combobox, EmptyState, Table, Box, Stack, Cluster, Text } from "@universityrt/ui-kit";
import { Trash2, KeyRound } from "lucide-react";
import { formatRoles } from "@/lib/roles";
import type { Role } from "@shared/access";
import { useToast } from "@/hooks/use-toast";

type AccessLevel = "edit" | "assign";

interface GrantRow {
  userId: string;
  accessLevel: AccessLevel;
}

interface AccessUser {
  id: string;
  name: string | null;
  email: string;
  roles?: string[];
}

interface AccessResponse {
  testId: string;
  ownerId: string | null;
  grants: GrantRow[];
}

/** Access level options for both the add-row and the per-grant selects. */
const LEVEL_OPTIONS: { value: AccessLevel; label: string }[] = [
  { value: "edit", label: "Редактирование" },
  { value: "assign", label: "Назначение" },
];

function displayName(u?: AccessUser): string {
  if (!u) return "—";
  return u.name?.trim() || u.email;
}

function initials(u?: AccessUser): string {
  const name = u?.name?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (u?.email?.[0] ?? "?").toUpperCase();
}

export function TestAccessPanel({
  test,
  onClose,
}: {
  test: { id: string; title: string } | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const open = test !== null;
  const testId = test?.id ?? null;

  // Users feed the owner select, the add-user combobox and the userId -> name map.
  const { data: users = [] } = useQuery<AccessUser[]>({
    queryKey: ["/api/users"],
    enabled: open,
  });

  const { data: access } = useQuery<AccessResponse>({
    queryKey: ["/api/tests", testId, "access"],
    queryFn: async () => {
      const res = await fetch(`/api/tests/${testId}/access`, { credentials: "include" });
      if (!res.ok) throw new Error("Не удалось загрузить доступ");
      return res.json();
    },
    enabled: open && !!testId,
  });

  // Local draft, accumulated until "Сохранить" (WF-2 explicit save) ------------
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [changingOwner, setChangingOwner] = useState(false);
  const [addUserId, setAddUserId] = useState<string | null>(null);
  const [addLevel, setAddLevel] = useState<AccessLevel>("edit");

  // Reseed the draft whenever the loaded access changes (i.e. per opened test).
  useEffect(() => {
    if (!access) return;
    setOwnerId(access.ownerId);
    setGrants(access.grants.map((g) => ({ userId: g.userId, accessLevel: g.accessLevel })));
    setChangingOwner(false);
    setAddUserId(null);
    setAddLevel("edit");
  }, [access]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const grantedIds = useMemo(() => new Set(grants.map((g) => g.userId)), [grants]);
  const addableUsers = useMemo(
    () => users.filter((u) => u.id !== ownerId && !grantedIds.has(u.id)),
    [users, ownerId, grantedIds],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!testId || !access) return;
      // Owner change.
      if (ownerId !== access.ownerId) {
        const res = await fetch(`/api/tests/${testId}/owner`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ownerId }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Не удалось сменить владельца");
      }
      // Additions and level changes (upsert).
      const initial = new Map(access.grants.map((g) => [g.userId, g.accessLevel]));
      for (const g of grants) {
        if (initial.get(g.userId) !== g.accessLevel) {
          const res = await fetch(`/api/tests/${testId}/access`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ userId: g.userId, accessLevel: g.accessLevel }),
          });
          if (!res.ok) throw new Error((await res.json()).error || "Не удалось выдать доступ");
        }
      }
      // Revocations.
      const keep = new Set(grants.map((g) => g.userId));
      for (const g of access.grants) {
        if (!keep.has(g.userId)) {
          const res = await fetch(`/api/tests/${testId}/access/${g.userId}`, {
            method: "DELETE",
            credentials: "include",
          });
          if (!res.ok) throw new Error((await res.json()).error || "Не удалось отозвать доступ");
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tests"] });
      if (testId) queryClient.invalidateQueries({ queryKey: ["/api/tests", testId, "access"] });
      toast({ title: "Доступ сохранён" });
      onClose();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Ошибка", description: e.message }),
  });

  const addGrant = () => {
    if (!addUserId) return;
    setGrants((prev) => [...prev, { userId: addUserId, accessLevel: addLevel }]);
    setAddUserId(null);
    setAddLevel("edit");
  };
  const setGrantLevel = (userId: string, level: AccessLevel) =>
    setGrants((prev) => prev.map((g) => (g.userId === userId ? { ...g, accessLevel: level } : g)));
  const removeGrant = (userId: string) => setGrants((prev) => prev.filter((g) => g.userId !== userId));

  const owner = ownerId ? usersById.get(ownerId) : undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="wide"
      title="Общий доступ"
      description={test?.title}
      footer={
        <Cluster justify="end" gap={2} wrap={false}>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button variant="primary" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            Сохранить
          </Button>
        </Cluster>
      }
    >
      <Stack gap={6}>
        {/* Owner */}
        <Stack as="section" gap={3}>
          <Text variant="body-s" weight="semibold" tone="muted" className="tb-caps">Владелец</Text>
          {changingOwner ? (
            <Select
              aria-label="Владелец теста"
              fullWidth
              placeholder="Выберите владельца…"
              value={ownerId ?? ""}
              options={users.map((u) => ({ value: u.id, label: displayName(u) }))}
              onChange={(v) => setOwnerId(v || null)}
            />
          ) : (
            <Cluster gap={3} wrap={false}>
              {owner ? (
                <>
                  <Avatar initials={initials(owner)} size="s" />
                  <span>{displayName(owner)}</span>
                </>
              ) : (
                <Text tone="muted">Владелец не назначен</Text>
              )}
              <Box as="span" grow />
              <Button variant="secondary" size="s" onClick={() => setChangingOwner(true)}>
                Сменить владельца
              </Button>
            </Cluster>
          )}
        </Stack>

        {/* Grants */}
        <Stack as="section" gap={3}>
          <Cluster align="end" gap={3}>
            <Combobox
              aria-label="Выбрать пользователя"
              placeholder="Выберите пользователя…"
              value={addUserId}
              onChange={(v) => setAddUserId(v)}
              options={addableUsers.map((u) => ({
                value: u.id,
                label: displayName(u),
                searchText: `${u.name ?? ""} ${u.email}`,
                meta: formatRoles(u.roles as Role[] | undefined) || undefined,
              }))}
            />
            <Select<AccessLevel>
              aria-label="Уровень доступа"
              value={addLevel}
              options={LEVEL_OPTIONS}
              onChange={(v) => setAddLevel(v)}
            />
            <Button variant="primary" disabled={!addUserId} onClick={addGrant}>
              Добавить
            </Button>
          </Cluster>

          {grants.length === 0 ? (
            <EmptyState
              well
              art={<KeyRound width={24} height={24} aria-hidden="true" />}
              title="Доступ ещё никому не выдан"
            />
          ) : (
            <Table<GrantRow>
              // The per-row level Select renders its menu inline (position:
              // absolute), and the DS Table root (.ou-tbl) sets overflow:hidden
              // to clip its rounded corners — which also clips the open menu.
              // Relax it here so the dropdown can extend past the table edge.
              style={{ overflow: "visible" }}
              rowKey={(g) => g.userId}
              rows={grants}
              columns={[
                {
                  key: "user",
                  header: "Пользователь",
                  render: (g) => {
                    const u = usersById.get(g.userId);
                    return (
                      <Cluster as="span" gap={2} wrap={false}>
                        <Avatar initials={initials(u)} size="xs" />
                        <span>{displayName(u)}</span>
                      </Cluster>
                    );
                  },
                },
                {
                  key: "level",
                  header: "Уровень",
                  width: 200,
                  render: (g) => (
                    <Select<AccessLevel>
                      aria-label="Уровень доступа"
                      value={g.accessLevel}
                      options={LEVEL_OPTIONS}
                      onChange={(v) => setGrantLevel(g.userId, v)}
                    />
                  ),
                },
                {
                  key: "actions",
                  header: "Действия",
                  width: 90,
                  align: "right",
                  render: (g) => (
                    <IconButton
                      variant="ghost"
                      size="s"
                      aria-label="Отозвать доступ"
                      icon={<Trash2 width={14} height={14} />}
                      onClick={() => removeGrant(g.userId)}
                    />
                  ),
                },
              ]}
            />
          )}
        </Stack>
      </Stack>
    </Drawer>
  );
}
