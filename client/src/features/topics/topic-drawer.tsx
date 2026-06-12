/**
 * @module features/topics/topic-drawer
 *
 * Unified per-topic Drawer (PRD-15 block C, T-32) — replaces the old shadcn
 * edit dialog AND the standalone access panel. Two tabs:
 *   - «Свойства»: name (live same-name check, FR-27), folder, description and
 *     rich feedback edited via the SHARED feedback editor (FeedbackEditorModal /
 *     FeedbackPreview) over topics.feedback_json (TD-02 r.2).
 *   - «Доступ» (edit mode only): owner, visibility (private/shared) and the
 *     use/manage grant list with two-mode revoke. Grantees are USERS only.
 *
 * Save model (per prd15-topic-access wireframe): properties + visibility + owner
 * are batched and applied on «Сохранить» (PUT /topics/:id then PATCH /visibility,
 * /owner). Grant add / level change / revoke / return are immediate actions,
 * because a grant's state does not fit a batch-on-save draft.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Drawer, Button, IconButton, Avatar, Select, Combobox, EmptyState, Table,
  Switch, Tag, Banner, ModalDialog, Tabs, Input, Textarea,
} from "@universityrt/ui-kit";
import { Trash2, KeyRound, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { FeedbackEditorModal } from "@/features/tests/editor/sections/feedback-editor-modal";
import { FeedbackPreview } from "@/features/tests/editor/sections/feedback-preview";
import type { FeedbackContent, Folder as FolderType, Topic } from "@shared/schema";

type AccessLevel = "use" | "manage";
type GrantState = "active" | "revoked_in_use";
type TopicTab = "props" | "access";

interface GrantRow {
  id: string;
  granteeId: string;
  granteeName: string | null;
  accessLevel: AccessLevel;
  state: GrantState;
}
interface AccessUser { id: string; name: string | null; email: string }
interface AccessResponse {
  topicId: string;
  ownerId: string | null;
  visibility: "private" | "shared";
  grants: GrantRow[];
}
interface RevokeDependent { testId: string; title: string; status: string }

interface NameCheckResponse {
  normalized: string;
  sameOwner: { id: string; name: string } | null;
  duplicates: { id: string; name: string }[];
}

/** Open target: a fresh topic (create) or an existing one (edit). */
export type TopicDrawerTarget =
  | { mode: "create"; folderId?: string | null }
  | { mode: "edit"; topic: Topic };

const LEVEL_OPTIONS: { value: AccessLevel; label: string }[] = [
  { value: "use", label: "Просмотр" },
  { value: "manage", label: "Управление" },
];

const NONE_FOLDER = "__none__";

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

/** Normalize a topic's stored feedback into the editor's content shape. */
function feedbackOf(topic: Topic | null): FeedbackContent {
  const raw = (topic?.feedbackJson ?? null) as FeedbackContent | null;
  if (raw && typeof raw === "object") {
    return {
      format: raw.format ?? "plain",
      text: raw.text ?? "",
      links: raw.links ?? [],
      assets: raw.assets ?? [],
      events: raw.events ?? [],
    };
  }
  // Legacy fallback: plain `feedback` text, no structured items.
  return { format: "plain", text: topic?.feedback ?? "", links: [], assets: [], events: [] };
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function TopicDrawer({
  target,
  folders,
  isAdmin,
  initialTab = "props",
  onClose,
}: {
  target: TopicDrawerTarget | null;
  folders: FolderType[];
  /** Administrators may change the owner and use the hard-revoke mode. */
  isAdmin: boolean;
  initialTab?: TopicTab;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const open = target !== null;
  const isEdit = target?.mode === "edit";
  const topic = target?.mode === "edit" ? target.topic : null;
  const topicId = topic?.id ?? null;

  // ── Properties draft ──────────────────────────────────────────────────────
  const [tab, setTab] = useState<TopicTab>(initialTab);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackContent>(() => feedbackOf(null));
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // ── Access draft (edit only): owner + visibility batched, grants immediate ──
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [changingOwner, setChangingOwner] = useState(false);
  const [addUserId, setAddUserId] = useState<string | null>(null);
  const [addLevel, setAddLevel] = useState<AccessLevel>("use");
  const [revokeTarget, setRevokeTarget] = useState<GrantRow | null>(null);
  const [revokeDeps, setRevokeDeps] = useState<RevokeDependent[] | null>(null);

  // Reset the draft whenever a new target is opened.
  useEffect(() => {
    if (!target) return;
    setTab(target.mode === "create" ? "props" : initialTab);
    if (target.mode === "edit") {
      setName(target.topic.name ?? "");
      setDescription(target.topic.description ?? "");
      setFolderId(target.topic.folderId ?? null);
      setFeedback(feedbackOf(target.topic));
    } else {
      setName("");
      setDescription("");
      setFolderId(target.folderId ?? null);
      setFeedback(feedbackOf(null));
    }
    setChangingOwner(false);
    setAddUserId(null);
    setAddLevel("use");
    setRevokeTarget(null);
    setRevokeDeps(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // ── Users (for owner + grants) ──────────────────────────────────────────────
  const { data: users = [] } = useQuery<AccessUser[]>({
    queryKey: ["/api/users"],
    enabled: open && isEdit,
  });

  // ── Access state (edit only) ────────────────────────────────────────────────
  const { data: access } = useQuery<AccessResponse>({
    queryKey: ["/api/topics", topicId, "access"],
    queryFn: async () => {
      const res = await fetch(`/api/topics/${topicId}/access`, { credentials: "include" });
      if (!res.ok) throw new Error("Не удалось загрузить доступ");
      return res.json();
    },
    enabled: open && isEdit && !!topicId,
  });
  useEffect(() => {
    if (!access) return;
    setOwnerId(access.ownerId);
    setShared(access.visibility === "shared");
  }, [access]);

  // ── Live same-name check (FR-27) ─────────────────────────────────────────────
  const debouncedName = useDebouncedValue(name, 400);
  const { data: nameCheck } = useQuery<NameCheckResponse>({
    queryKey: ["/api/topics/name-check", debouncedName, topicId ?? ""],
    queryFn: async () => {
      const params = new URLSearchParams({ name: debouncedName });
      if (topicId) params.set("excludeId", topicId);
      const res = await fetch(`/api/topics/name-check?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("name-check failed");
      return res.json();
    },
    enabled: open && debouncedName.trim().length > 0,
  });
  const nameClash =
    nameCheck?.sameOwner && debouncedName.trim() === name.trim() ? nameCheck.sameOwner : null;
  const nameDuplicates =
    !nameClash && debouncedName.trim() === name.trim() ? nameCheck?.duplicates ?? [] : [];

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

  // ── Save: properties (PUT/POST) + visibility/owner (PATCH, edit only) ─────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        folderId,
        feedbackJson: feedback,
      };
      if (!isEdit) {
        await apiRequest("POST", "/api/topics", body);
        return;
      }
      await apiRequest("PUT", `/api/topics/${topicId}`, body);
      if (access && shared !== (access.visibility === "shared")) {
        const res = await fetch(`/api/topics/${topicId}/visibility`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ visibility: shared ? "shared" : "private" }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Не удалось изменить видимость");
      }
      if (isAdmin && access && ownerId !== access.ownerId) {
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
      toast({ title: isEdit ? "Тема обновлена" : "Тема создана" });
      onClose();
    },
    onError: (e: Error) => {
      const dup = e.message.includes("duplicate_topic_name");
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: dup
          ? (isEdit ? "У владельца уже есть тема с таким названием" : "У вас уже есть тема с таким названием")
          : e.message || "Не удалось сохранить тему",
      });
    },
  });

  // ── Immediate grant upsert (add / level change / return) ──────────────────────
  const upsertGrant = useMutation({
    mutationFn: async (vars: { granteeId: string; accessLevel: AccessLevel }) => {
      const res = await fetch(`/api/topics/${topicId}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(vars),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Не удалось выдать доступ");
    },
    onSuccess: () => { refetchAccess(); setAddUserId(null); setAddLevel("use"); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Ошибка", description: e.message }),
  });

  // ── Immediate revoke (soft default, hard admin-only, dependency-checked) ──────
  const revokeMutation = useMutation({
    mutationFn: async (vars: { grantId: string; mode: "soft" | "hard"; force?: boolean }) => {
      const q = vars.mode === "hard" ? `?mode=hard${vars.force ? "&force=true" : ""}` : "";
      const res = await fetch(`/api/topics/${topicId}/access/${vars.grantId}${q}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.status === 409) {
        const b = await res.json();
        return { blocked: true, dependents: (b.dependents ?? []) as RevokeDependent[] };
      }
      if (!res.ok) throw new Error((await res.json()).error || "Не удалось отозвать доступ");
      return { blocked: false, dependents: [] as RevokeDependent[] };
    },
    onSuccess: (r) => {
      if (r.blocked) { setRevokeDeps(r.dependents); return; }
      refetchAccess();
      setRevokeTarget(null);
      setRevokeDeps(null);
      toast({ title: "Доступ отозван" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Ошибка", description: e.message }),
  });

  const grants = access?.grants ?? [];
  const owner = ownerId ? usersById.get(ownerId) : undefined;
  const tabItems = isEdit
    ? [{ id: "props" as const, label: "Свойства" }, { id: "access" as const, label: "Доступ" }]
    : [{ id: "props" as const, label: "Свойства" }];

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        size="wide"
        title={isEdit ? "Тема" : "Новая тема"}
        description={isEdit ? topic?.name : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Отмена</Button>
            <Button
              variant="primary"
              loading={saveMutation.isPending}
              disabled={!name.trim() || !!nameClash}
              onClick={() => saveMutation.mutate()}
              data-testid="button-submit-topic"
            >
              Сохранить
            </Button>
          </div>
        }
      >
        <Tabs<TopicTab>
          variant="underline"
          size="m"
          items={tabItems}
          value={tab}
          onChange={setTab}
          aria-label="Разделы темы"
        />

        {tab === "props" && (
          <div className="flex flex-col gap-6 pt-4">
            <Input
              label="Название темы"
              fullWidth
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={nameClash ? `У вас уже есть тема «${nameClash.name}». Выберите другое название.` : undefined}
              data-testid="input-topic-name"
            />
            {nameDuplicates.length > 0 && (
              <Banner
                tone="warning"
                description="Тема с таким названием уже есть в доступной вам области (у других авторов). Создать можно — это не помешает."
                data-testid="topic-name-warning"
              />
            )}
            <Select
              label="Папка"
              fullWidth
              value={folderId ?? NONE_FOLDER}
              options={[
                { value: NONE_FOLDER, label: "Без папки" },
                ...folders.map((f) => ({ value: f.id, label: f.name })),
              ]}
              onChange={(v) => setFolderId(v === NONE_FOLDER ? null : v)}
              data-testid="select-topic-folder"
            />
            <Textarea
              label="Описание"
              fullWidth
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Необязательно"
              data-testid="input-topic-description"
            />
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Обратная связь по теме
              </span>
              <FeedbackPreview
                format={feedback.format}
                text={feedback.text}
                links={feedback.links}
                assets={feedback.assets}
                events={feedback.events}
                onEdit={() => setFeedbackOpen(true)}
                editAriaLabel="Редактировать обратную связь"
                testId="topic-feedback"
              />
            </div>
          </div>
        )}

        {tab === "access" && isEdit && (
          <div className="flex flex-col gap-6 pt-4">
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
        )}
      </Drawer>

      {/* Shared feedback editor (TD-02): rich text + documents + courses + events */}
      <FeedbackEditorModal
        open={feedbackOpen}
        title={isEdit ? `Обратная связь по теме «${topic?.name ?? ""}»` : "Обратная связь по теме"}
        value={{
          format: feedback.format,
          text: feedback.text,
          links: feedback.links,
          assets: feedback.assets,
          events: feedback.events,
        }}
        onCancel={() => setFeedbackOpen(false)}
        onSave={(v) => {
          setFeedback({
            format: v.format,
            text: v.text,
            links: v.links,
            assets: v.assets,
            events: v.events ?? [],
          });
          setFeedbackOpen(false);
        }}
        testId="topic-feedback-editor"
      />

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
