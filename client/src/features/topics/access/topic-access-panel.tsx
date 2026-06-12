/**
 * @module features/topics/access/topic-access-panel
 *
 * Per-topic access management panel (PRD-15 block C, T-32). Mirrors the test
 * access panel (PRD-13) but for topics: shows the owner, the visibility toggle
 * (private/shared) and the list of `use`/`manage` grants, lets the owner (and
 * admin) add/retune grants and revoke them in two modes — soft (default,
 * `revoked_in_use`) and hard (admin-only, dependency-checked). Owner change is
 * admin-only.
 *
 * Interaction model (per prd15-topic-access wireframe): owner + visibility are
 * batched and applied on «Сохранить»; grant add / level change / revoke / return
 * are immediate actions, because a grant's `state` (active vs revoked_in_use)
 * does not fit a batch-on-save draft. Grantees are USERS only — groups are for
 * test assignment, not topic access (TD-01).
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Drawer, Button, IconButton, Avatar, Select, Combobox, EmptyState, Table,
  Switch, Tag, Banner, ModalDialog,
} from "@universityrt/ui-kit";
import { Trash2, KeyRound, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type AccessLevel = "use" | "manage";
type GrantState = "active" | "revoked_in_use";

interface GrantRow {
  id: string;
  granteeId: string;
  granteeName: string | null;
  accessLevel: AccessLevel;
  state: GrantState;
}

interface AccessUser {
  id: string;
  name: string | null;
  email: string;
}

interface AccessResponse {
  topicId: string;
  ownerId: string | null;
  visibility: "private" | "shared";
  grants: GrantRow[];
}

interface RevokeDependent {
  testId: string;
  title: string;
  status: string;
}

const LEVEL_OPTIONS: { value: AccessLevel; label: string }[] = [
  { value: "use", label: "Просмотр" },
  { value: "manage", label: "Управление" },
];

function displayName(u?: AccessUser): string {
  return u?.name?.trim() || u?.email || "—";
}
function initials(name: string | null | undefined, email?: string): string {
  const n = name?.trim();
  if (n) {
    const parts = n.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

export function TopicAccessPanel({
  topic,
  isAdmin,
  onClose,
}: {
  topic: { id: string; name: string } | null;
  /** Administrators may change the owner and use the hard-revoke mode. */
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const open = topic !== null;
  const topicId = topic?.id ?? null;

  const { data: users = [] } = useQuery<AccessUser[]>({
    queryKey: ["/api/users"],
    enabled: open,
  });

  const { data: access } = useQuery<AccessResponse>({
    queryKey: ["/api/topics", topicId, "access"],
    queryFn: async () => {
      const res = await fetch(`/api/topics/${topicId}/access`, { credentials: "include" });
      if (!res.ok) throw new Error("Не удалось загрузить доступ");
      return res.json();
    },
    enabled: open && !!topicId,
  });

  // Batched draft: owner + visibility (applied on «Сохранить»).
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [changingOwner, setChangingOwner] = useState(false);
  // Add-grant row (immediate POST on «Добавить»).
  const [addUserId, setAddUserId] = useState<string | null>(null);
  const [addLevel, setAddLevel] = useState<AccessLevel>("use");
  // Revoke flow.
  const [revokeTarget, setRevokeTarget] = useState<GrantRow | null>(null);
  const [revokeDeps, setRevokeDeps] = useState<RevokeDependent[] | null>(null);

  useEffect(() => {
    if (!access) return;
    setOwnerId(access.ownerId);
    setShared(access.visibility === "shared");
    setChangingOwner(false);
    setAddUserId(null);
    setAddLevel("use");
    setRevokeTarget(null);
    setRevokeDeps(null);
  }, [access]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const grantedIds = useMemo(
    () => new Set((access?.grants ?? []).map((g) => g.granteeId)),
    [access],
  );
  const addableUsers = useMemo(
    () => users.filter((u) => u.id !== ownerId && !grantedIds.has(u.id)),
    [users, ownerId, grantedIds],
  );

  const refetchAccess = () => {
    if (topicId) queryClient.invalidateQueries({ queryKey: ["/api/topics", topicId, "access"] });
  };

  // Batched owner + visibility.
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!topicId || !access) return;
      if (shared !== (access.visibility === "shared")) {
        const res = await fetch(`/api/topics/${topicId}/visibility`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ visibility: shared ? "shared" : "private" }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Не удалось изменить видимость");
      }
      if (isAdmin && ownerId !== access.ownerId) {
        const res = await fetch(`/api/topics/${topicId}/owner`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ownerId }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Не удалось сменить владельца");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      refetchAccess();
      toast({ title: "Сохранено" });
      onClose();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Ошибка", description: e.message }),
  });

  // Immediate grant upsert (add / level change / return).
  const upsertGrant = useMutation({
    mutationFn: async (vars: { granteeId: string; accessLevel: AccessLevel }) => {
      const res = await fetch(`/api/topics/${topicId}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ granteeType: "user", ...vars }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Не удалось выдать доступ");
    },
    onSuccess: () => { refetchAccess(); setAddUserId(null); setAddLevel("use"); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Ошибка", description: e.message }),
  });

  // Immediate revoke (soft default, hard admin-only with dependency check).
  const revokeMutation = useMutation({
    mutationFn: async (vars: { grantId: string; mode: "soft" | "hard"; force?: boolean }) => {
      const q = vars.mode === "hard" ? `?mode=hard${vars.force ? "&force=true" : ""}` : "";
      const res = await fetch(`/api/topics/${topicId}/access/${vars.grantId}${q}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.status === 409) {
        const body = await res.json();
        return { blocked: true, dependents: (body.dependents ?? []) as RevokeDependent[] };
      }
      if (!res.ok) throw new Error((await res.json()).error || "Не удалось отозвать доступ");
      return { blocked: false, dependents: [] as RevokeDependent[] };
    },
    onSuccess: (r) => {
      if (r.blocked) {
        setRevokeDeps(r.dependents);
        return; // keep the modal open showing the dependency list
      }
      refetchAccess();
      setRevokeTarget(null);
      setRevokeDeps(null);
      toast({ title: "Доступ отозван" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Ошибка", description: e.message }),
  });

  const grants = access?.grants ?? [];
  const owner = ownerId ? usersById.get(ownerId) : undefined;

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        size="wide"
        title="Доступ к теме"
        description={topic?.name}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Отмена</Button>
            <Button variant="primary" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              Сохранить
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-6">
          {/* Owner */}
          <section className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Владелец</span>
            {changingOwner && isAdmin ? (
              <Select
                aria-label="Владелец темы"
                fullWidth
                placeholder="Выберите владельца…"
                value={ownerId ?? ""}
                options={users.map((u) => ({ value: u.id, label: displayName(u) }))}
                onChange={(v) => setOwnerId(v || null)}
              />
            ) : (
              <div className="flex items-center gap-3">
                {owner ? (
                  <>
                    <Avatar initials={initials(owner.name, owner.email)} size="s" />
                    <span>{displayName(owner)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Владелец не назначен</span>
                )}
                <span className="flex-1" />
                {isAdmin && (
                  <Button variant="secondary" size="s" onClick={() => setChangingOwner(true)}>
                    Сменить владельца
                  </Button>
                )}
              </div>
            )}
          </section>

          {/* Visibility */}
          <section className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Видимость</span>
            <Switch
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              label="Общая тема"
              description={
                shared
                  ? "Тему могут использовать все авторы."
                  : "Сейчас приватная — видят только владелец, получатели грантов и администратор."
              }
            />
          </section>

          {/* Grants */}
          <section className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Гранты доступа</span>
            <div className="flex items-end gap-3 flex-wrap">
              <Combobox
                aria-label="Выбрать пользователя"
                placeholder="Выберите пользователя…"
                value={addUserId}
                onChange={(v) => setAddUserId(v)}
                options={addableUsers.map((u) => ({
                  value: u.id,
                  label: displayName(u),
                  searchText: `${u.name ?? ""} ${u.email}`,
                }))}
              />
              <Select<AccessLevel>
                aria-label="Уровень доступа"
                value={addLevel}
                options={LEVEL_OPTIONS}
                onChange={(v) => setAddLevel(v)}
              />
              <Button
                variant="primary"
                disabled={!addUserId}
                loading={upsertGrant.isPending}
                onClick={() => addUserId && upsertGrant.mutate({ granteeId: addUserId, accessLevel: addLevel })}
              >
                Добавить
              </Button>
            </div>

            {grants.length === 0 ? (
              <EmptyState
                well
                art={<KeyRound width={24} height={24} aria-hidden="true" />}
                title="Доступ ещё никому не выдан"
              />
            ) : (
              <Table<GrantRow>
                style={{ overflow: "visible" }}
                rowKey={(g) => g.id}
                rows={grants}
                columns={[
                  {
                    key: "user",
                    header: "Пользователь",
                    render: (g) => (
                      <span className="flex items-center gap-2">
                        <Avatar initials={initials(g.granteeName)} size="xs" />
                        <span>{g.granteeName ?? "—"}</span>
                      </span>
                    ),
                  },
                  {
                    key: "level",
                    header: "Уровень",
                    width: 220,
                    render: (g) =>
                      g.state === "revoked_in_use" ? (
                        <Tag tone="warning">Отозван (используется)</Tag>
                      ) : (
                        <Select<AccessLevel>
                          aria-label="Уровень доступа"
                          value={g.accessLevel}
                          options={LEVEL_OPTIONS}
                          onChange={(v) => upsertGrant.mutate({ granteeId: g.granteeId, accessLevel: v })}
                        />
                      ),
                  },
                  {
                    key: "actions",
                    header: "Действия",
                    width: 120,
                    align: "right",
                    render: (g) =>
                      g.state === "revoked_in_use" ? (
                        <Button
                          variant="ghost"
                          size="s"
                          leadingIcon={<RotateCcw width={14} height={14} />}
                          onClick={() => upsertGrant.mutate({ granteeId: g.granteeId, accessLevel: g.accessLevel })}
                        >
                          Вернуть
                        </Button>
                      ) : (
                        <IconButton
                          variant="ghost"
                          size="s"
                          aria-label="Отозвать доступ"
                          icon={<Trash2 width={14} height={14} />}
                          onClick={() => { setRevokeTarget(g); setRevokeDeps(null); }}
                        />
                      ),
                  },
                ]}
              />
            )}
          </section>
        </div>
      </Drawer>

      {/* Revoke mode choice / hard-revoke dependency dialog */}
      <ModalDialog
        open={revokeTarget !== null}
        onClose={() => { setRevokeTarget(null); setRevokeDeps(null); }}
        size="m"
        title="Отозвать доступ"
        description={revokeTarget?.granteeName ?? undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setRevokeTarget(null); setRevokeDeps(null); }}>Отмена</Button>
            {revokeDeps === null ? (
              <>
                <Button
                  variant="primary"
                  loading={revokeMutation.isPending}
                  onClick={() => revokeTarget && revokeMutation.mutate({ grantId: revokeTarget.id, mode: "soft" })}
                >
                  Мягкий отзыв
                </Button>
                {isAdmin && (
                  <Button
                    variant="destructive"
                    loading={revokeMutation.isPending}
                    onClick={() => revokeTarget && revokeMutation.mutate({ grantId: revokeTarget.id, mode: "hard" })}
                  >
                    Жёсткий отзыв
                  </Button>
                )}
              </>
            ) : (
              <Button
                variant="destructive"
                loading={revokeMutation.isPending}
                onClick={() => revokeTarget && revokeMutation.mutate({ grantId: revokeTarget.id, mode: "hard", force: true })}
              >
                Отозвать принудительно
              </Button>
            )}
          </div>
        }
      >
        {revokeDeps === null ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              <strong>Мягкий отзыв</strong> (по умолчанию): тема уходит из банка получателя, но он
              сохраняет чтение её содержимого в контексте уже собранных тестов. Не блокируется.
            </p>
            {isAdmin && (
              <p>
                <strong>Жёсткий отзыв</strong>: полностью убирает доступ; проверяет зависимые
                опубликованные тесты получателя.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Banner
              tone="error"
              title="Отзыв затрагивает опубликованные тесты получателя"
              description="Жёсткий отзыв уберёт доступ полностью. Затронутые тесты получателя:"
            />
            <ul className="list-disc pl-5 text-sm">
              {revokeDeps.map((d) => (
                <li key={d.testId}>{d.title}</li>
              ))}
            </ul>
          </div>
        )}
      </ModalDialog>
    </>
  );
}
