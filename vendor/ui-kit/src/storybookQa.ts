export type QaStatus =
  | 'unvalidated'
  | 'draft'
  | 'review'
  | 'blocked'
  | 'visual-ok'
  | 'functional-ok'
  | 'stable';

export type QaCheck = 'todo' | 'ok' | 'blocked' | 'skip';

export interface QaEntry {
  status?: QaStatus;
  visual?: QaCheck;
  functional?: QaCheck;
  a11y?: QaCheck;
  notes?: string;
  hideBadge?: boolean;
}

export type QaRegistry = Record<string, QaEntry>;

export const QA_STATUSES: QaStatus[] = [
  'unvalidated',
  'draft',
  'review',
  'blocked',
  'visual-ok',
  'functional-ok',
  'stable',
];

export const QA_CHECKS: QaCheck[] = ['todo', 'ok', 'blocked', 'skip'];

export function normalizeQaEntry(entry: QaEntry | undefined): Required<Pick<QaEntry, 'status' | 'visual' | 'functional' | 'a11y'>> & QaEntry {
  const status = entry?.status ?? 'unvalidated';
  const stableDefaults = status === 'stable';

  return {
    ...entry,
    status,
    visual: entry?.visual ?? (stableDefaults ? 'ok' : 'todo'),
    functional: entry?.functional ?? (stableDefaults ? 'ok' : 'todo'),
    a11y: entry?.a11y ?? (stableDefaults ? 'ok' : 'todo'),
  };
}

export function isQaReady(entry: QaEntry | undefined): boolean {
  const normalized = normalizeQaEntry(entry);
  return normalized.status === 'stable'
    && normalized.visual === 'ok'
    && normalized.functional === 'ok'
    && normalized.a11y === 'ok';
}
