/**
 * @module features/analytics/registry/use-dictionaries
 * @description Справочники тестов и групп для языка условий реестра (PRD-56 FR-02).
 *
 * Условия отбора хранятся идентификаторами — их пересылают ссылкой, и они переживают
 * переименование. Но показывать идентификатор человеку нельзя: по «6e10d1e6-0fc9…» он не может
 * ни проверить отбор, ни объяснить его коллеге. Поэтому и чипы применённых условий, и окно
 * отбора берут названия отсюда — из одного места, чтобы не разошлись.
 *
 * Справочники — подсказка, а не условие работы: не загрузились — экран остаётся годным, просто
 * условие называется своим идентификатором.
 */
import { useEffect, useState } from "react";
import type { OrgField, OrgValueCount } from "@shared/org-fields";

export interface RegistryDictionaries {
  tests: Array<{ id: string; title: string }>;
  groups: Array<{ id: string; name: string }>;
  /**
   * Оргзначения (FR-06b): какие организации, подразделения и должности вообще есть — в
   * профилях и в прохождениях, разные написания свёрнуты. Нужны только окну отбора: чипы
   * называют значение им самим.
   */
  orgValues?: Record<OrgField, OrgValueCount[]>;
}

const EMPTY: RegistryDictionaries = { tests: [], groups: [] };

/**
 * Прочитать справочники.
 *
 * @param enabled когда `false`, запросов нет: окно отбора спрашивает их только открытым.
 */
export function useRegistryDictionaries(enabled = true): RegistryDictionaries {
  const [dictionaries, setDictionaries] = useState<RegistryDictionaries>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    void (async () => {
      try {
        const [testsRes, groupsRes, orgRes] = await Promise.all([
          fetch("/api/tests", { credentials: "include" }),
          fetch("/api/groups", { credentials: "include" }),
          // Своя ручка аналитики, а не `/api/users/org-values`: у оценщика может не быть права
          // читать пользователей, а значения для отбора ему нужны.
          fetch("/api/analytics/org-values", { credentials: "include" }).catch(() => null),
        ]);
        if (!alive) return;

        const tests = testsRes.ok
          ? (await testsRes.json() as Array<{ id: string; title: string }>)
            .map(test => ({ id: test.id, title: test.title }))
          : [];
        const groups = groupsRes.ok
          ? (await groupsRes.json() as Array<{ id: string; name: string }>)
            .map(group => ({ id: group.id, name: group.name }))
          : [];
        const orgValues = orgRes?.ok
          ? await orgRes.json() as Record<OrgField, OrgValueCount[]>
          : undefined;
        if (alive) setDictionaries({ tests, groups, ...(orgValues ? { orgValues } : {}) });
      } catch {
        // Молча: без справочников условие называется идентификатором, и это лучше, чем
        // сообщение об ошибке на экране, где отбор всё равно работает.
      }
    })();

    return () => { alive = false; };
  }, [enabled]);

  return dictionaries;
}

/**
 * Варианты и версии ОДНОГО теста — справочник условий, осмысленных только внутри него.
 *
 * Читается отдельно и только когда тест выбран ровно один: у разных тестов варианты свои, и
 * общий список из них был бы перечнем несравнимого. Пустой ответ — обычное дело: у теста без
 * наборов форм вариантов нет вовсе, и условие тогда не предлагается.
 *
 * @param testId тест условий; `null` — спрашивать нечего
 * @param enabled окно отбора закрыто — запросов нет
 */
export function useTestDictionary(
  testId: string | null,
  enabled = true,
): { forms: Array<{ id: string; label: string }>; versions: Array<{ id: string; version: number }> } {
  const [dictionary, setDictionary] = useState<{
    forms: Array<{ id: string; label: string }>;
    versions: Array<{ id: string; version: number }>;
  }>({ forms: [], versions: [] });

  useEffect(() => {
    if (!enabled || !testId) {
      setDictionary({ forms: [], versions: [] });
      return;
    }
    let alive = true;

    void (async () => {
      try {
        const response = await fetch(`/api/analytics/tests/${testId}/dictionary`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as {
          forms?: Array<{ id: string; label: string }>;
          versions?: Array<{ id: string; version: number }>;
        };
        if (alive) setDictionary({ forms: data.forms ?? [], versions: data.versions ?? [] });
      } catch {
        // Справочник не доехал — условие просто не предлагается: выпадающий список с
        // идентификаторами вместо названий хуже, чем его отсутствие.
        if (alive) setDictionary({ forms: [], versions: [] });
      }
    })();

    return () => { alive = false; };
  }, [testId, enabled]);

  return dictionary;
}
