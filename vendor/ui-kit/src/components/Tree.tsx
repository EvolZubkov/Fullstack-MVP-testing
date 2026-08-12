import React, { useCallback, useId, useState } from 'react';
import { cn } from '../utils';

export interface TreeNodeData<T = unknown> {
  id: string;
  label: React.ReactNode;
  /** Доп. правый текст. */
  meta?: React.ReactNode;
  /** Иконка слева (есть `folderIcon` для папок, `leafIcon` для листьев — иначе кастом). */
  icon?: React.ReactNode;
  /** Использовать дефолтную иконку папки. */
  folder?: boolean;
  /** Дети. Если массив пуст или undefined и `folder=false` — лист. */
  children?: TreeNodeData<T>[];
  /** Свернут по умолчанию (если не контролируется). */
  defaultExpanded?: boolean;
  /** Произвольные данные. */
  data?: T;
  disabled?: boolean;
}

export type TreeDensity = 'compact' | 'normal' | 'comfy';

export interface TreeProps<T = unknown> extends React.HTMLAttributes<HTMLUListElement> {
  nodes: TreeNodeData<T>[];
  density?: TreeDensity;
  /** Показывать вертикальные направляющие. */
  guides?: boolean;
  /** Рамка-контейнер вокруг дерева. */
  bordered?: boolean;
  /** Контролируемый набор раскрытых id. */
  expandedKeys?: string[];
  defaultExpandedKeys?: string[];
  onExpandChange?: (keys: string[]) => void;
  /** Контролируемый набор выделенных id (single или multi). */
  selectedKey?: string | null;
  defaultSelectedKey?: string | null;
  onSelectChange?: (key: string | null, node: TreeNodeData<T>) => void;
  /** Включает чек-боксы с каскадом по детям + indeterminate. */
  checkable?: boolean;
  checkedKeys?: string[];
  defaultCheckedKeys?: string[];
  onCheckChange?: (keys: string[]) => void;
  /** Кастомный рендер строки (override). Передаются default-классы. */
  renderRow?: (node: TreeNodeData<T>, ctx: TreeRowContext) => React.ReactNode;
}

export interface TreeRowContext {
  isExpanded: boolean;
  isSelected: boolean;
  isChecked: boolean;
  isIndeterminate: boolean;
  hasChildren: boolean;
  level: number;
  toggleExpand: () => void;
  toggleSelect: () => void;
  toggleCheck: () => void;
}

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

// Get all descendant ids (inclusive).
function collectIds<T>(node: TreeNodeData<T>, acc: string[] = []): string[] {
  acc.push(node.id);
  (node.children ?? []).forEach(c => collectIds(c, acc));
  return acc;
}

function toDomIdPart(value: string): string {
  return encodeURIComponent(value).replace(/[^A-Za-z0-9_-]/g, '_');
}

export function Tree<T = unknown>(props: TreeProps<T>) {
  const {
    nodes, density = 'normal', guides, bordered,
    expandedKeys: expandedProp, defaultExpandedKeys, onExpandChange,
    selectedKey: selectedProp, defaultSelectedKey, onSelectChange,
    checkable, checkedKeys: checkedProp, defaultCheckedKeys, onCheckChange,
    renderRow, className, ...rest
  } = props;
  const autoId = useId();
  const treeId = `ou-tree-${autoId}`;

  const expandedCtrl = expandedProp !== undefined;
  const selectedCtrl = selectedProp !== undefined;
  const checkedCtrl = checkedProp !== undefined;

  const [expandedState, setExpandedState] = useState<string[]>(
    defaultExpandedKeys
      ?? nodes.flatMap(n => collectIds(n).filter(id => {
        // expand nodes that explicitly defaultExpanded
        const find = (cur: TreeNodeData<T>): TreeNodeData<T> | null => {
          if (cur.id === id) return cur;
          for (const c of cur.children ?? []) { const r = find(c); if (r) return r; }
          return null;
        };
        return find(n)?.defaultExpanded;
      })),
  );
  const expanded = expandedCtrl ? expandedProp! : expandedState;

  const [selectedState, setSelectedState] = useState<string | null>(defaultSelectedKey ?? null);
  const selected = selectedCtrl ? (selectedProp ?? null) : selectedState;

  const [checkedState, setCheckedState] = useState<string[]>(defaultCheckedKeys ?? []);
  const checked = checkedCtrl ? checkedProp! : checkedState;

  const setExpanded = useCallback((next: string[]) => {
    if (!expandedCtrl) setExpandedState(next);
    onExpandChange?.(next);
  }, [expandedCtrl, onExpandChange]);

  const setSelected = useCallback((next: string | null, node: TreeNodeData<T>) => {
    if (!selectedCtrl) setSelectedState(next);
    onSelectChange?.(next, node);
  }, [selectedCtrl, onSelectChange]);

  const setChecked = useCallback((next: string[]) => {
    if (!checkedCtrl) setCheckedState(next);
    onCheckChange?.(next);
  }, [checkedCtrl, onCheckChange]);

  // Determine indeterminate state for a node — at least one descendant checked but not all.
  const isAllChecked = (node: TreeNodeData<T>, set: Set<string>): boolean => {
    const ids = collectIds(node);
    return ids.every(id => set.has(id));
  };
  const isPartiallyChecked = (node: TreeNodeData<T>, set: Set<string>): boolean => {
    const ids = collectIds(node);
    const some = ids.some(id => set.has(id));
    const all = ids.every(id => set.has(id));
    return some && !all;
  };

  const toggleCheckNode = (node: TreeNodeData<T>) => {
    const set = new Set(checked);
    const ids = collectIds(node);
    if (isAllChecked(node, set)) ids.forEach(id => set.delete(id));
    else ids.forEach(id => set.add(id));
    setChecked(Array.from(set));
  };

  const toggleExpandNode = (id: string) => {
    const set = new Set(expanded);
    set.has(id) ? set.delete(id) : set.add(id);
    setExpanded(Array.from(set));
  };

  const renderNode = (node: TreeNodeData<T>, level: number): React.ReactNode => {
    const hasChildren = !!(node.children && node.children.length);
    const isLeaf = !hasChildren && !node.folder;
    const isExpanded = expanded.includes(node.id);
    const isSelected = selected === node.id;
    const checkedSet = new Set(checked);
    const isCheckedNode = checkable && isAllChecked(node, checkedSet);
    const isIndet = checkable && isPartiallyChecked(node, checkedSet);
    const labelId = `${treeId}-label-${toDomIdPart(node.id)}`;

    const ctx: TreeRowContext = {
      isExpanded, isSelected, isChecked: !!isCheckedNode, isIndeterminate: !!isIndet,
      hasChildren, level,
      toggleExpand: () => toggleExpandNode(node.id),
      toggleSelect: () => setSelected(isSelected ? null : node.id, node),
      toggleCheck: () => toggleCheckNode(node),
    };

    const defaultRow = (
      <div
        className="ou-tree__row"
        onClick={(e) => {
          if (node.disabled) return;
          if ((e.target as HTMLElement).closest('.ou-tree__toggle, .ou-tree__check')) return;
          ctx.toggleSelect();
          if (hasChildren) ctx.toggleExpand();
        }}
      >
        <button
          type="button" className="ou-tree__toggle"
          aria-label={isExpanded ? 'Свернуть' : 'Развернуть'}
          {...(hasChildren
            ? isExpanded
              ? { 'aria-expanded': 'true' as const }
              : { 'aria-expanded': 'false' as const }
            : {}
          )}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) ctx.toggleExpand(); }}
          tabIndex={hasChildren ? 0 : -1}
        ><ChevronIcon /></button>
        {checkable && (
          <span
            className="ou-tree__check"
            role="checkbox"
            aria-checked="false"
            {...(isCheckedNode ? { 'aria-checked': 'true' as const } : isIndet ? { 'aria-checked': 'mixed' as const } : {})}
            aria-labelledby={labelId}
            {...(node.disabled ? { 'aria-disabled': 'true' as const } : {})}
            tabIndex={node.disabled ? -1 : 0}
            onClick={(e) => {
              e.stopPropagation();
              if (!node.disabled) ctx.toggleCheck();
            }}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                if (!node.disabled) ctx.toggleCheck();
              }
            }}
          >
            <CheckIcon />
          </span>
        )}
        {(node.icon || node.folder) && (
          <span className={cn('ou-tree__ico', node.folder && 'ou-tree__ico--folder')}>
            {node.icon ?? <FolderIcon />}
          </span>
        )}
        <span id={labelId} className="ou-tree__label">{node.label}</span>
        {node.meta !== undefined && <span className="ou-tree__meta">{node.meta}</span>}
      </div>
    );

    return (
      <li
        key={node.id}
        className={cn(
          'ou-tree__node',
          isLeaf && 'is-leaf',
          isExpanded && 'is-open',
          isSelected && 'is-selected',
          checkable && isCheckedNode && 'is-checked',
          checkable && isIndet && 'is-indeterminate',
          node.disabled && 'is-disabled',
        )}
        {...{ role: 'treeitem' as const }}
        {...{ 'aria-selected': (isSelected ? 'true' : 'false') as 'true' | 'false' }}
        {...(hasChildren
          ? isExpanded
            ? { 'aria-expanded': 'true' as const }
            : { 'aria-expanded': 'false' as const }
          : {}
        )}
        {...(node.disabled ? { 'aria-disabled': 'true' as const } : {})}
      >
        {renderRow ? renderRow(node, ctx) : defaultRow}
        {hasChildren && (
          <ul className="ou-tree__children" role="group">
            {node.children!.map(c => renderNode(c, level + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ul
      className={cn(
        'ou-tree',
        density === 'compact' && 'ou-tree--compact',
        density === 'comfy' && 'ou-tree--comfy',
        guides && 'ou-tree--guides',
        bordered && 'ou-tree--bordered',
        className,
      )}
      role="tree"
      {...rest}
    >
      {nodes.map(n => renderNode(n, 0))}
    </ul>
  );
}
Tree.displayName = 'Tree';
