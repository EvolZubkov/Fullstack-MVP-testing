/**
 * @module components/folder-tree-select
 * @description Single-select folder picker rendered as a COMBOBOX that opens a
 * DS `Tree` of folders in a popover (a compact trigger showing the current
 * choice, not a full-height inline tree) — used wherever the author chooses
 * WHERE to place content: the parent of a new folder and the folder of a topic.
 * A synthetic root node represents «без папки (корень)». `value` is a folder id,
 * or `null` for the root. Reuses the @universityrt/ui-kit `Tree` (no bespoke
 * tree rendering).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Folder as FolderIcon } from "lucide-react";
import { Tree, type TreeNodeData } from "@universityrt/ui-kit";

/** Sentinel id for the synthetic root («без папки») node. */
export const FOLDER_ROOT = "__root__";

/** Minimal folder shape — works for both topic folders (PRD-15) and test folders. */
export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
}

interface FolderTreeSelectProps {
  folders: FolderNode[];
  /** Selected folder id, or `null` for the root. */
  value: string | null;
  onChange: (folderId: string | null) => void;
  /** Label of the root node + the trigger when root is selected. */
  rootLabel?: string;
  /** Folder id (with its whole subtree) to omit — e.g. when moving a folder. */
  excludeId?: string;
}

/** Build DS Tree nodes: the folder hierarchy under one synthetic root. */
function buildNodes(folders: FolderNode[], rootLabel: string, excludeId?: string): TreeNodeData[] {
  const byParent = new Map<string | null, FolderNode[]>();
  for (const f of folders) {
    if (excludeId && f.id === excludeId) continue;
    const key = f.parentId ?? null;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(f);
  }
  const build = (parentId: string | null): TreeNodeData[] =>
    (byParent.get(parentId) ?? []).map((f) => ({ id: f.id, label: f.name, folder: true, children: build(f.id) }));
  return [{ id: FOLDER_ROOT, label: rootLabel, folder: true, defaultExpanded: true, children: build(null) }];
}

export function FolderTreeSelect({ folders, value, onChange, rootLabel = "Без папки (корень)", excludeId }: FolderTreeSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Popover is portaled to <body> (fixed) so it is never clipped by a modal/drawer.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const nodes = useMemo(() => buildNodes(folders, rootLabel, excludeId), [folders, rootLabel, excludeId]);
  const expandedKeys = useMemo(() => [FOLDER_ROOT, ...folders.map((f) => f.id)], [folders]);
  const triggerLabel = value === null ? rootLabel : (folders.find((f) => f.id === value)?.name ?? rootLabel);

  return (
    <div className={"tb-foldercombo" + (open ? " is-open" : "")}>
      <button
        ref={triggerRef}
        type="button"
        className="tb-foldercombo__trigger"
        aria-haspopup="tree"
        {...(open ? { "aria-expanded": "true" as const } : { "aria-expanded": "false" as const })}
        onClick={() => setOpen((o) => !o)}
      >
        <FolderIcon size={16} className="tb-foldercombo__ico" aria-hidden="true" />
        <span className="tb-foldercombo__label">{triggerLabel}</span>
        <ChevronDown size={16} className="tb-foldercombo__chev" aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div ref={popRef} className="tb-foldercombo__pop" style={{ top: pos.top, left: pos.left, width: pos.width }}>
          <Tree
            className="tb-foldertree"
            nodes={nodes}
            guides
            density="compact"
            defaultExpandedKeys={expandedKeys}
            selectedKey={value === null ? FOLDER_ROOT : value}
            onSelectChange={(key) => { onChange(key === null || key === FOLDER_ROOT ? null : key); setOpen(false); }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
