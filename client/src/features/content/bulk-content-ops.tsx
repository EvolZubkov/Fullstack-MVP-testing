/**
 * @module features/content/bulk-content-ops
 *
 * Group (bulk) operations over the «Папки и темы» selection of the content tree
 * (PRD-15 block C + block D content-axis, requirements Р-1..Р-8). The unit of
 * operation is the TOPIC; a selected folder contributes its topics transitively.
 * Components here are the modals the tree opens for the selection:
 *
 *   - {@link BulkImpactDialog}   — presentational partial-batch summary (applied
 *     vs skipped + admin force), shared by group delete, folder cascade and hard
 *     revoke (matches the s-content-impact / s-revoke-impact wireframe states).
 *   - {@link GroupMoveModal}     — move topics (folderId) and reparent folders
 *     (parentId, container) to one destination; cycle-guarded server-side.
 *   - {@link GroupAccessModal}   — grant / revoke / visibility / owner across the
 *     resolved topics (folders fall through to their topics; folders have no
 *     access model of their own).
 *   - {@link FolderDeleteDialog} — two-mode folder delete (reparent contents /
 *     cascade through the content guard), for the ⋯-menu and for a selection
 *     that contains folders.
 *   - {@link GroupDeleteFlow}    — group topic delete through the content guard
 *     (dry-run → impact → execute), when the selection has no folders.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Banner, Button, Cluster, Combobox, Input, Label, ModalDialog,
  RadioGroup, SegmentedControl, Select, Stack, Switch, Text,
} from "@universityrt/ui-kit";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { FolderTreeSelect } from "@/components/folder-tree-select";
import { useToast } from "@/hooks/use-toast";
import { t, pluralize } from "@/lib/i18n";
import type { Folder } from "@shared/schema";

export interface UserLite { id: string; name?: string | null; email?: string | null }

const c = () => t.content;
/** «тему / темы / тем» (accusative) for a topic count. */
const topicsAcc = (n: number) => pluralize(n, "тему", "темы", "тем");
/** «темы / тем / тем» (genitive, after «у N…») for a topic count. */
const topicsGen = (n: number) => pluralize(n, "темы", "тем", "тем");

/** Fire a JSON request; never throws — returns status + parsed body. */
async function send(method: string, url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function userLabel(u: UserLite): string {
  return u.name ? `${u.name} — ${u.email ?? ""}`.trim() : (u.email ?? u.id);
}

// ─── BulkImpactDialog: partial-batch summary (applied / skipped + force) ───────

export interface ImpactEntry { id: string; name: string; detail?: string }

export interface BulkImpactDialogProps {
  open: boolean;
  title: string;
  bannerTone?: "warning" | "error";
  bannerText?: string;
  appliedLabel: string;
  applied: ImpactEntry[];
  skippedLabel: string;
  skipped: ImpactEntry[];
  confirmLabel: string;
  canForce?: boolean;
  forced?: boolean;
  onForceChange?: (v: boolean) => void;
  forceLabel?: string;
  forceHint?: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Two-list impact preview: what the operation will affect vs. what it skips. */
export function BulkImpactDialog(props: BulkImpactDialogProps) {
  const {
    open, title, bannerTone = "warning", bannerText, appliedLabel, applied,
    skippedLabel, skipped, confirmLabel, canForce, forced, onForceChange,
    forceLabel, forceHint, pending, onConfirm, onClose,
  } = props;
  const nothing = applied.length === 0 && !forced;
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="m"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="destructive" loading={pending} disabled={nothing} onClick={onConfirm} data-testid="ct-impact-confirm">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        {bannerText && <Banner variant="subtle" tone={bannerTone} description={bannerText} />}
        {applied.length > 0 && (
          <Stack gap={2}>
            <Label>{appliedLabel} ({applied.length})</Label>
            {applied.map((e) => (
              <Cluster key={e.id} gap={2} align="start" wrap={false}>
                <Text as="span" tone="success"><CheckCircle2 size={16} /></Text>
                <Stack gap={0}>
                  <Text weight="semibold">{e.name}</Text>
                  {e.detail && <Text variant="caption" tone="muted">{e.detail}</Text>}
                </Stack>
              </Cluster>
            ))}
          </Stack>
        )}
        {skipped.length > 0 && (
          <Stack gap={2}>
            <Label>{skippedLabel} ({skipped.length})</Label>
            {skipped.map((e) => (
              <Cluster key={e.id} gap={2} align="start" wrap={false}>
                <Text as="span" tone="error"><AlertTriangle size={16} /></Text>
                <Stack gap={0}>
                  <Text weight="semibold">{e.name}</Text>
                  {e.detail && <Text variant="caption" tone="muted">{e.detail}</Text>}
                </Stack>
              </Cluster>
            ))}
          </Stack>
        )}
        {canForce && skipped.length > 0 && onForceChange && (
          <Switch
            checked={!!forced}
            onChange={(e) => onForceChange(e.target.checked)}
            label={forceLabel}
            description={forceHint}
          />
        )}
      </Stack>
    </ModalDialog>
  );
}

/** First affected test title from a server `blocking` entry list, for a hint. */
function firstBlockingHint(blocking: Array<{ title?: string }> | undefined): string | undefined {
  const b = blocking?.[0];
  return b?.title ? `${c().usedInTest}: «${b.title}»` : c().usedInPublishedTests;
}

// ─── GroupMoveModal: move topics + reparent folders to one destination ─────────

export interface GroupMoveModalProps {
  open: boolean;
  directTopicIds: string[];
  folderIds: string[];
  folders: Folder[];
  onClose: () => void;
  onDone: () => void;
}

export function GroupMoveModal({ open, directTopicIds, folderIds, folders, onClose, onDone }: GroupMoveModalProps) {
  const { toast } = useToast();
  const [target, setTarget] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => { if (open) { setTarget(null); setPending(false); } }, [open]);

  async function apply() {
    setPending(true);
    try {
      if (directTopicIds.length > 0) {
        const r = await send("POST", "/api/topics/bulk-move", { ids: directTopicIds, folderId: target });
        if (!r.ok) throw new Error(r.data?.error ?? "move");
      }
      if (folderIds.length > 0) {
        const r = await send("POST", "/api/folders/bulk-reparent", { ids: folderIds, parentId: target });
        if (!r.ok) {
          throw new Error(r.data?.error === "invalid_parent" ? c().cyclePrevented : (r.data?.error ?? "reparent"));
        }
      }
      toast({ title: c().moved });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "destructive", title: t.common.error, description: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="m"
      title={c().groupMoveTitle}
      description={c().groupMoveDesc}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" loading={pending} onClick={apply} data-testid="ct-group-move-confirm">{c().move}</Button>
        </>
      }
    >
      <Stack gap={3}>
        <Stack gap={1}>
          <Label>{c().targetFolder}</Label>
          <FolderTreeSelect folders={folders} value={target} onChange={setTarget} rootLabel={c().rootFolder} />
        </Stack>
        <Text variant="caption" tone="muted">{c().groupMoveHint}</Text>
      </Stack>
    </ModalDialog>
  );
}

// ─── GroupAccessModal: grant / revoke / visibility / owner over topics ─────────

type AccessOp = "grant" | "revoke" | "vis" | "owner";
type Level = "use" | "manage";

export interface GroupAccessModalProps {
  open: boolean;
  topicIds: string[];
  topicCount: number;
  folderCount: number;
  users: UserLite[];
  isAdmin: boolean;
  canForce: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function GroupAccessModal(props: GroupAccessModalProps) {
  const { open, topicIds, topicCount, folderCount, users, isAdmin, canForce, onClose, onDone } = props;
  const { toast } = useToast();
  const [op, setOp] = useState<AccessOp>("grant");
  const [granteeId, setGranteeId] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("use");
  const [visibility, setVisibility] = useState<"private" | "shared">("private");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [revokeMode, setRevokeMode] = useState<"soft" | "hard">("soft");
  const [pending, setPending] = useState(false);
  // Hard-revoke impact preview state.
  const [impact, setImpact] = useState<{ revocable: ImpactEntry[]; blocked: ImpactEntry[] } | null>(null);
  const [forced, setForced] = useState(false);

  useEffect(() => {
    if (open) {
      setOp("grant"); setGranteeId(null); setLevel("use"); setVisibility("private");
      setOwnerId(null); setRevokeMode("soft"); setPending(false); setImpact(null); setForced(false);
    }
  }, [open]);

  const userOpts = users.map((u) => ({ value: u.id, label: userLabel(u), searchText: `${u.name ?? ""} ${u.email ?? ""}` }));
  const applyDisabled =
    ((op === "grant" || op === "revoke") && !granteeId) || (op === "owner" && !ownerId) || topicIds.length === 0;

  async function apply() {
    setPending(true);
    try {
      if (op === "grant") {
        const r = await send("POST", "/api/topics/bulk-grant", { ids: topicIds, granteeId, accessLevel: level });
        if (!r.ok) throw new Error(r.data?.error ?? "grant");
        toast({ title: c().accessGranted.replace("{n}", String(r.data.grantedCount ?? 0)) });
      } else if (op === "vis") {
        const r = await send("POST", "/api/topics/bulk-visibility", { ids: topicIds, visibility });
        if (!r.ok) throw new Error(r.data?.error ?? "visibility");
        toast({ title: c().visibilityUpdated.replace("{n}", String(r.data.updatedCount ?? 0)) });
      } else if (op === "owner") {
        const r = await send("POST", "/api/topics/bulk-owner", { ids: topicIds, ownerId });
        if (!r.ok) throw new Error(r.data?.error ?? "owner");
        toast({ title: c().ownerUpdated.replace("{n}", String(r.data.updatedCount ?? 0)) });
      } else if (op === "revoke" && revokeMode === "soft") {
        const r = await send("POST", "/api/topics/bulk-revoke", { ids: topicIds, granteeId });
        if (!r.ok) throw new Error(r.data?.error ?? "revoke");
        toast({ title: c().accessRevoked.replace("{n}", String(r.data.revokedCount ?? 0)) });
      } else {
        // Hard revoke: preview dependents first (dry-run), then execute.
        const r = await send("POST", "/api/topics/bulk-revoke?mode=hard&dryRun=true", { ids: topicIds, granteeId });
        if (!r.ok) throw new Error(r.data?.error ?? "revoke");
        setImpact({
          revocable: (r.data.revocable ?? []).map((x: any) => ({ id: x.topicId, name: x.name })),
          blocked: (r.data.blocked ?? []).map((x: any) => ({ id: x.topicId, name: x.name, detail: firstBlockingHint(x.dependents) })),
        });
        setPending(false);
        return;
      }
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "destructive", title: t.common.error, description: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  async function executeHardRevoke() {
    setPending(true);
    try {
      const q = forced ? "?mode=hard&force=true" : "?mode=hard";
      const r = await send("POST", `/api/topics/bulk-revoke${q}`, { ids: topicIds, granteeId });
      if (!r.ok) throw new Error(r.data?.error ?? "revoke");
      toast({ title: c().accessRevoked.replace("{n}", String(r.data.revokedCount ?? 0)) });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "destructive", title: t.common.error, description: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  const scopeText = folderCount > 0
    ? c().accessScopeFolders.replace("{n}", String(topicCount)).replace("{f}", String(folderCount))
    : c().accessScope.replace("{n}", String(topicCount));

  if (impact) {
    const applied = forced ? [...impact.revocable, ...impact.blocked] : impact.revocable;
    const skipped = forced ? [] : impact.blocked;
    return (
      <BulkImpactDialog
        open={open}
        title={c().hardRevokeTitle}
        bannerText={c().hardRevokeBanner}
        appliedLabel={c().revokedLabel}
        applied={applied}
        skippedLabel={c().skippedRevokeLabel}
        skipped={skipped}
        confirmLabel={`${c().opRevoke} у ${applied.length} ${topicsGen(applied.length)}`}
        canForce={canForce}
        forced={forced}
        onForceChange={setForced}
        forceLabel={c().revokeForceLabel}
        forceHint={c().revokeForceHint}
        pending={pending}
        onConfirm={executeHardRevoke}
        onClose={() => setImpact(null)}
      />
    );
  }

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="m"
      title={c().groupAccessTitle}
      description={c().groupAccessDesc}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" loading={pending} disabled={applyDisabled} onClick={apply} data-testid="ct-group-access-apply">{c().apply}</Button>
        </>
      }
    >
      <Stack gap={4}>
        <Banner variant="subtle" tone="info" description={scopeText} />
        <Stack gap={1}>
          <Label>{c().operation}</Label>
          <SegmentedControl<AccessOp>
            value={op}
            onChange={setOp}
            items={[
              { value: "grant", label: c().opGrant },
              { value: "revoke", label: c().opRevoke },
              { value: "vis", label: c().opVisibility },
              ...(isAdmin ? [{ value: "owner" as AccessOp, label: c().opOwner }] : []),
            ]}
          />
        </Stack>

        {op === "grant" && (
          <>
            <Stack gap={1}>
              <Label>{c().user}</Label>
              <Combobox aria-label={c().user} placeholder={c().pickUser} value={granteeId} onChange={setGranteeId} options={userOpts} />
            </Stack>
            <Stack gap={1}>
              <Label>{c().accessLevel}</Label>
              <SegmentedControl<Level>
                value={level}
                onChange={setLevel}
                items={[{ value: "use", label: c().levelUse }, { value: "manage", label: c().levelManage }]}
              />
              <Text variant="caption" tone="muted">{c().grantUpsertHint}</Text>
            </Stack>
          </>
        )}

        {op === "revoke" && (
          <>
            <Stack gap={1}>
              <Label>{c().user}</Label>
              <Combobox aria-label={c().user} placeholder={c().pickUser} value={granteeId} onChange={setGranteeId} options={userOpts} />
            </Stack>
            <RadioGroup<"soft" | "hard">
              legend={c().revokeType}
              value={revokeMode}
              onChange={setRevokeMode}
              options={[
                { value: "soft", label: c().revokeSoft, description: c().revokeSoftHint },
                ...(isAdmin ? [{ value: "hard" as const, label: c().revokeHard, description: c().revokeHardHint }] : []),
              ]}
            />
          </>
        )}

        {op === "vis" && (
          <Stack gap={1}>
            <Label>{c().visibility}</Label>
            <SegmentedControl<"private" | "shared">
              value={visibility}
              onChange={setVisibility}
              items={[{ value: "private", label: c().visPrivate }, { value: "shared", label: c().visShared }]}
            />
            <Text variant="caption" tone="muted">{c().visibilityHint}</Text>
          </Stack>
        )}

        {op === "owner" && (
          <Stack gap={1}>
            <Label>{c().newOwner}</Label>
            <Combobox aria-label={c().newOwner} placeholder={c().pickUser} value={ownerId} onChange={setOwnerId} options={userOpts} />
            <Text variant="caption" tone="muted">{c().ownerHint}</Text>
          </Stack>
        )}
      </Stack>
    </ModalDialog>
  );
}

// ─── FolderDeleteDialog: two-mode folder delete (reparent / cascade) ───────────

export interface FolderDeleteDialogProps {
  open: boolean;
  /** Folders to delete (⋯-menu: one; group: the selected folders). */
  folderIds: string[];
  /** Primary folder name shown / required for the cascade confirmation. */
  folderName: string;
  /** Standalone selected topics (delivered alongside folders in a group delete). */
  standaloneTopicIds: string[];
  folders: Folder[];
  canForce: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function FolderDeleteDialog(props: FolderDeleteDialogProps) {
  const { open, folderIds, folderName, standaloneTopicIds, folders, canForce, onClose, onDone } = props;
  const { toast } = useToast();
  const [mode, setMode] = useState<"move" | "cascade">("move");
  const [target, setTarget] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [pending, setPending] = useState(false);
  const [impact, setImpact] = useState<{ deletable: ImpactEntry[]; blocked: ImpactEntry[]; forbidden: ImpactEntry[] } | null>(null);
  const [forced, setForced] = useState(false);

  useEffect(() => {
    if (open) { setMode("move"); setTarget(null); setConfirmName(""); setPending(false); setImpact(null); setForced(false); }
  }, [open]);

  // "Reparent contents" — folder-only per folder + move standalone topics out.
  async function applyMove() {
    setPending(true);
    try {
      for (const id of folderIds) {
        const r = await send("DELETE", `/api/folders/${id}`, { mode: "folder-only", moveContentsTo: target });
        if (!r.ok) throw new Error(r.data?.error ?? "delete");
      }
      if (standaloneTopicIds.length > 0) {
        await send("POST", "/api/topics/bulk-move", { ids: standaloneTopicIds, folderId: target });
      }
      toast({ title: c().folderDeleted });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "destructive", title: t.common.error, description: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  // "Delete everything" — dry-run each folder cascade + standalone topics, merge.
  async function previewCascade() {
    setPending(true);
    try {
      const deletable: ImpactEntry[] = [];
      const blocked: ImpactEntry[] = [];
      const forbidden: ImpactEntry[] = [];
      const seen = new Set<string>();
      const add = (list: ImpactEntry[], e: ImpactEntry) => { if (!seen.has(e.id)) { seen.add(e.id); list.push(e); } };
      for (const id of folderIds) {
        const r = await send("DELETE", `/api/folders/${id}?dryRun=true`, { mode: "folder-and-content", confirmName: folderName });
        if (!r.ok) throw new Error(r.data?.error ?? "dryrun");
        for (const x of r.data.deletable ?? []) add(deletable, { id: x.topicId, name: x.name });
        for (const x of r.data.blocked ?? []) add(blocked, { id: x.topicId, name: x.name, detail: firstBlockingHint(x.blocking) });
        for (const x of r.data.forbidden ?? []) add(forbidden, { id: x.topicId, name: x.name, detail: c().noPermission });
      }
      if (standaloneTopicIds.length > 0) {
        const r = await send("POST", "/api/topics/bulk-delete?dryRun=true", { ids: standaloneTopicIds });
        if (r.ok) {
          for (const x of r.data.deletable ?? []) add(deletable, { id: x.topicId, name: x.name });
          for (const x of r.data.blocked ?? []) add(blocked, { id: x.topicId, name: x.name, detail: firstBlockingHint(x.blocking) });
          for (const x of r.data.forbidden ?? []) add(forbidden, { id: x.topicId, name: x.name, detail: c().noPermission });
        }
      }
      setImpact({ deletable, blocked, forbidden });
    } catch (e) {
      toast({ variant: "destructive", title: t.common.error, description: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  async function executeCascade() {
    setPending(true);
    try {
      const q = forced ? "?force=true" : "";
      for (const id of folderIds) {
        const r = await send("DELETE", `/api/folders/${id}${q}`, { mode: "folder-and-content", confirmName: folderName });
        if (!r.ok) throw new Error(r.data?.error ?? "delete");
      }
      if (standaloneTopicIds.length > 0) {
        await send("POST", `/api/topics/bulk-delete${q}`, { ids: standaloneTopicIds });
      }
      toast({ title: c().folderDeleted });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "destructive", title: t.common.error, description: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  if (impact) {
    const applied = forced ? [...impact.deletable, ...impact.blocked] : impact.deletable;
    const skipped = forced ? impact.forbidden : [...impact.blocked, ...impact.forbidden];
    return (
      <BulkImpactDialog
        open={open}
        title={c().deleteCheckTitle}
        bannerText={c().deleteCheckBanner}
        appliedLabel={c().willDeleteLabel}
        applied={applied}
        skippedLabel={c().skippedDeleteLabel}
        skipped={skipped}
        confirmLabel={`${c().deleteSelected} ${applied.length} ${topicsAcc(applied.length)}`}
        canForce={canForce}
        forced={forced}
        onForceChange={setForced}
        forceLabel={c().deleteForceLabel}
        forceHint={c().deleteForceHint}
        pending={pending}
        onConfirm={executeCascade}
        onClose={() => setImpact(null)}
      />
    );
  }

  const cascadeReady = confirmName.trim() === folderName.trim();
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="m"
      title={c().deleteFolderTitle.replace("{name}", folderName)}
      description={c().deleteFolderDesc}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
          {mode === "move" ? (
            <Button variant="destructive" loading={pending} onClick={applyMove} data-testid="ct-folder-delete-move">{c().deleteSelected}</Button>
          ) : (
            <Button variant="destructive" loading={pending} disabled={!cascadeReady} onClick={previewCascade} data-testid="ct-folder-delete-cascade">{c().deleteSelected}</Button>
          )}
        </>
      }
    >
      <Stack gap={4}>
        <RadioGroup<"move" | "cascade">
          value={mode}
          onChange={setMode}
          options={[
            { value: "move", label: c().fdMoveLabel, description: c().fdMoveHint },
            { value: "cascade", label: c().fdCascadeLabel, description: c().fdCascadeHint },
          ]}
        />
        {mode === "move" ? (
          <Stack gap={1}>
            <Label>{c().fdMoveTo}</Label>
            <FolderTreeSelect folders={folders} value={target} onChange={setTarget} rootLabel={c().rootFolder} excludeId={folderIds[0]} />
          </Stack>
        ) : (
          <Stack gap={3}>
            <Banner variant="subtle" tone="warning" description={c().fdCascadeBanner} />
            <Stack gap={1}>
              <Label>{c().fdConfirmName}</Label>
              <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={folderName} aria-label={c().fdConfirmName} fullWidth />
            </Stack>
          </Stack>
        )}
      </Stack>
    </ModalDialog>
  );
}

// ─── GroupDeleteFlow: group topic delete through the content guard ─────────────

export interface GroupDeleteFlowProps {
  open: boolean;
  topicIds: string[];
  canForce: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function GroupDeleteFlow({ open, topicIds, canForce, onClose, onDone }: GroupDeleteFlowProps) {
  const { toast } = useToast();
  const [impact, setImpact] = useState<{ deletable: ImpactEntry[]; blocked: ImpactEntry[]; forbidden: ImpactEntry[] } | null>(null);
  const [forced, setForced] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) { setImpact(null); setForced(false); setPending(false); return; }
    let alive = true;
    (async () => {
      const r = await send("POST", "/api/topics/bulk-delete?dryRun=true", { ids: topicIds });
      if (!alive) return;
      if (!r.ok) { toast({ variant: "destructive", title: t.common.error }); onClose(); return; }
      setImpact({
        deletable: (r.data.deletable ?? []).map((x: any) => ({ id: x.topicId, name: x.name })),
        blocked: (r.data.blocked ?? []).map((x: any) => ({ id: x.topicId, name: x.name, detail: firstBlockingHint(x.blocking) })),
        forbidden: (r.data.forbidden ?? []).map((x: any) => ({ id: x.topicId, name: x.name, detail: c().noPermission })),
      });
    })();
    return () => { alive = false; };
  }, [open, topicIds, onClose, toast]);

  async function execute() {
    setPending(true);
    try {
      const r = await send("POST", `/api/topics/bulk-delete${forced ? "?force=true" : ""}`, { ids: topicIds });
      if (!r.ok) throw new Error(r.data?.error ?? "delete");
      toast({ title: c().deletedN.replace("{n}", String(r.data.deletedCount ?? 0)) });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "destructive", title: t.common.error, description: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  if (!impact) return null;
  const applied = forced ? [...impact.deletable, ...impact.blocked] : impact.deletable;
  const skipped = forced ? impact.forbidden : [...impact.blocked, ...impact.forbidden];
  const clean = impact.blocked.length === 0 && impact.forbidden.length === 0;
  return (
    <BulkImpactDialog
      open={open}
      title={clean ? (applied.length === 1 ? `${c().deleteTopic}?` : c().deleteConfirmTitle) : c().deleteCheckTitle}
      bannerText={clean ? c().deleteCleanBanner : c().deleteCheckBanner}
      appliedLabel={c().willDeleteLabel}
      applied={applied}
      skippedLabel={c().skippedDeleteLabel}
      skipped={skipped}
      confirmLabel={`${c().deleteSelected} ${applied.length} ${topicsAcc(applied.length)}`}
      canForce={canForce}
      forced={forced}
      onForceChange={setForced}
      forceLabel={c().deleteForceLabel}
      forceHint={c().deleteForceHint}
      pending={pending}
      onConfirm={execute}
      onClose={onClose}
    />
  );
}
