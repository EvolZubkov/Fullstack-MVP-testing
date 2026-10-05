/**
 * @module features/saved-filters/use-list-filters
 * @description Сохранённые фильтры списков — «Темы и вопросы», «Тесты», «Пользователи» (решение
 * владельца 2026-10-05: сохранение — везде, где есть фильтр).
 *
 * Хук отдаёт ровно то, что нужно полосе `FilterBar`: наборы, применённый набор, изменён ли он, и
 * действия — применить, сохранить, обновить, удалить. Экран даёт свой текущий фильтр, функцию
 * применения и два правила своего словаря: как привести прочитанные условия к фильтру экрана
 * (`normalize` — сохранённое раньше могло не знать нового условия) и как сравнить два фильтра
 * (`keyOf` — обычно та же строка, что экран пишет в адрес).
 *
 * Наборы личные и хранятся на сервере (`/api/saved-filters`). Фильтры аналитики живут отдельно,
 * рядом со срезами (`features/analytics/registry/use-saved-filters`).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@skillum/ui-kit";
import { apiRequest } from "@/lib/queryClient";

/** Экран списка. */
export type ListFilterScope = "content" | "tests" | "users";

/** Сохранённый набор, как его отдаёт сервер. */
export interface ListSavedFilter {
  id: string;
  name: string;
  conditions: unknown;
}

/** Ключ списка наборов экрана. */
export function listFiltersKey(scope: ListFilterScope): readonly [string] {
  return [`/api/saved-filters?scope=${scope}`] as const;
}

/**
 * Условия набора в форме пустого фильтра экрана: берутся только известные поля и только того же
 * рода (список, число, флаг, строка), недостающие — из пустого фильтра. Набор, сохранённый до
 * появления нового условия, применяется без него, а не ломает экран.
 *
 * @param empty пустой фильтр экрана — образец формы
 * @param conditions условия из набора
 */
export function mergeShape<T extends object>(empty: T, conditions: unknown): T {
  const raw = conditions && typeof conditions === "object" && !Array.isArray(conditions)
    ? conditions as Record<string, unknown>
    : {};
  const out = { ...empty } as Record<string, unknown>;
  for (const [field, sample] of Object.entries(empty)) {
    const value = raw[field];
    if (Array.isArray(sample)) {
      if (Array.isArray(value)) out[field] = value.filter(item => typeof item === "string");
    } else if (typeof value === typeof sample) {
      out[field] = value;
    }
  }
  return out as T;
}

/**
 * Ключ фильтра для сравнения: поля по имени, списки — без учёта порядка. «Опубликован, черновик»
 * и «черновик, опубликован» — один и тот же отбор.
 *
 * @param value фильтр экрана
 */
export function stableKey(value: object): string {
  const entries = Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, item]) => [field, Array.isArray(item) ? [...item].map(String).sort() : item]);
  return JSON.stringify(entries);
}

/** Текст ошибки сервера: «409: {"error":"…"}» → «…». */
export function errorText(error: unknown): string {
  const message = (error as Error)?.message ?? "";
  const json = message.slice(message.indexOf(":") + 1).trim();
  try {
    const parsed = JSON.parse(json) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // не JSON — отдаём как есть
  }
  return message || "Не удалось выполнить действие";
}

/**
 * Применённый набор и изменён ли он.
 *
 * Применённым считается набор, который читатель выбрал или сохранил последним; если такого нет,
 * а текущий фильтр совпал с каким-то набором (набрали те же условия, пришли ссылкой), — этот
 * набор. Изменённым — выбранный набор, условия которого уже не совпадают с текущими.
 *
 * @param filters наборы экрана
 * @param appliedId набор, выбранный или сохранённый последним
 * @param currentKey ключ текущего фильтра
 * @param keyOfSaved ключ фильтра из набора
 */
export function listSetState(
  filters: readonly ListSavedFilter[],
  appliedId: string | null,
  currentKey: string,
  keyOfSaved: (saved: ListSavedFilter) => string,
): { activeSetId: string | null; dirty: boolean } {
  const applied = appliedId ? filters.find(f => f.id === appliedId) : undefined;
  if (applied) return { activeSetId: applied.id, dirty: keyOfSaved(applied) !== currentKey };
  const matching = filters.find(f => keyOfSaved(f) === currentKey);
  return { activeSetId: matching?.id ?? null, dirty: false };
}

/** Что экран даёт хуку. */
export interface UseListFiltersOptions<T> {
  scope: ListFilterScope;
  /** Применённый сейчас фильтр экрана. */
  current: T;
  /** Применить фильтр — тот же путь, что у «Применить» панели. */
  apply: (value: T) => void;
  /** Условия набора → фильтр экрана; незнакомое отбрасывается, недостающее — из пустого фильтра. */
  normalize: (conditions: unknown) => T;
  /** Ключ для сравнения двух фильтров экрана. */
  keyOf: (value: T) => string;
  /** Читать ли наборы — у экрана без фильтра или без прав незачем. */
  enabled?: boolean;
}

/**
 * Сохранённые фильтры экрана — свойства для `FilterBar`.
 *
 * @param options экран, текущий фильтр и правила его словаря
 * @returns `savedSets`, `activeSetId`, `dirty` и действия полосы
 */
export function useListFilters<T>({ scope, current, apply, normalize, keyOf, enabled = true }: UseListFiltersOptions<T>) {
  const queryClient = useQueryClient();
  const { push: toast } = useToast();
  const key = listFiltersKey(scope);
  const { data } = useQuery<{ filters: ListSavedFilter[] }>({ queryKey: key, enabled });
  const filters = data?.filters ?? [];
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const keyOfSaved = (saved: ListSavedFilter) => keyOf(normalize(saved.conditions));
  const fail = (title: string) => (error: unknown) => toast({ tone: "error", title, description: errorText(error) });

  return {
    savedSets: filters.map(item => ({ id: item.id, name: item.name })),
    ...listSetState(filters, appliedId, keyOf(current), keyOfSaved),
    onApplySet: (id: string) => {
      const item = filters.find(f => f.id === id);
      if (!item) return;
      setAppliedId(id);
      apply(normalize(item.conditions));
    },
    onSaveSet: (name: string) => {
      apiRequest("POST", "/api/saved-filters", { scope, name, conditions: current })
        .then(response => response.json() as Promise<{ filter: ListSavedFilter }>)
        .then(body => { setAppliedId(body.filter.id); return refresh(); })
        .catch(fail("Фильтр не сохранён"));
    },
    onUpdateSet: (id: string) => {
      apiRequest("PUT", `/api/saved-filters/${encodeURIComponent(id)}`, { conditions: current })
        .then(() => refresh())
        .catch(fail("Фильтр не обновлён"));
    },
    onDeleteSet: (id: string) => {
      if (appliedId === id) setAppliedId(null);
      apiRequest("DELETE", `/api/saved-filters/${encodeURIComponent(id)}`)
        .then(() => refresh())
        .catch(fail("Фильтр не удалён"));
    },
  };
}
