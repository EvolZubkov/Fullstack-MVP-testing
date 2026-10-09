/**
 * @module server/services/analytics/assigned-count
 * @description PRD-56 FR-06: сколько людей среза получили назначение теста.
 *
 * Величина отвечает на «сколько позвали» и стоит рядом с «сколько начали»: без неё срез
 * рассказывает только про пришедших и молчит про тех, кого позвали, а они не явились.
 *
 * Считается НЕ у всякого среза, и это принципиально. Назначение существует до прохождения и
 * относится к ЧЕЛОВЕКУ, а срез бывает построен по свойству ПОПЫТКИ — номеру, варианту выдачи,
 * версии публикации, источнику. «Сколько назначено второй попытке» не значит ничего: назначают
 * не попытку. Там, где величина неприменима, читатель отвечает `null`, а экран рисует прочерк
 * (FR-27): выдумать для неё число значило бы показать величину, которую нельзя истолковать
 * (FR-29).
 */

import { orgValueKey, type OrgField } from "@shared/org-fields";

import { logger } from "../../logger";
import { storage } from "../../storage";

/** Готовый справочник назначений теста: счёт по срезам без новых запросов. */
export interface AssignedReader {
  /**
   * Сколько участников среза получили назначение.
   *
   * @param groupIds группы, которыми описан срез: пустой список — срез без условий («тест
   *   целиком»), и тогда считаются все назначенные. `null` — срез описан не группами, и
   *   величина к нему неприменима.
   */
  countFor(groupIds: readonly string[] | null): number | null;

  /**
   * Сколько назначенных — внешние участники, а сколько сотрудники.
   *
   * Отдельный счёт, потому что «внутренние и внешние» — ось про ЛЮДЕЙ, как и группа: у
   * назначенного, который так и не начал, источника и номера попытки не существует, а
   * признак внешнего есть всегда (PRD-28).
   *
   * @param external считать внешних (`true`) либо сотрудников (`false`)
   */
  countByKind(external: boolean): number;

  /**
   * Сколько назначенных несут в профиле это значение оргполя (план оргструктуры, Р-7).
   *
   * Оргструктура — свойство ЧЕЛОВЕКА, как группа, поэтому у назначенного, который не начинал,
   * ответ есть: его отдел известен из профиля. Значение сравнивается по правилу
   * `shared/org-fields` — разные написания одного отдела считаются вместе.
   *
   * @param field оргполе оси
   * @param value значение среза; `null` — срез «не указано», назначенные с пустым полем
   * @returns число назначенных; `null`, когда назначения прочитать не удалось
   */
  countByOrg(field: OrgField, value: string | null): number | null;
}

/**
 * Прочитать назначения теста и членство всех групп, которые в них участвуют.
 *
 * Членство групп СРЕЗОВ дочитывается тоже: срез может ссылаться на группу, которой тест не
 * назначали вовсе, и её участники должны дать честный ноль, а не остаться непосчитанными.
 *
 * @param testId тест — рамка расчёта
 * @param sliceGroupIds группы, встречающиеся в срезах этого запроса
 */
export async function readAssigned(
  testId: string,
  sliceGroupIds: readonly string[] = [],
): Promise<AssignedReader> {
  /**
   * Назначения — ДОПОЛНЕНИЕ к срезу, а не условие его существования: прохождения случились
   * независимо от того, прочиталось ли, кого звали. Сбой чтения уходит в лог, а величина
   * отвечает «неизвестно» прочерком — экран срезов от этого не перестаёт работать.
   */
  let assignments: Awaited<ReturnType<typeof storage.getTestAssignments>>;
  try {
    assignments = await storage.getTestAssignments(testId);
  } catch (error) {
    logger.warn("Назначения теста не прочитаны — " + (error as Error).message);
    return { countFor: () => null, countByKind: () => 0, countByOrg: () => null };
  }

  const needed = new Set<string>(sliceGroupIds);
  for (const assignment of assignments) {
    if (assignment.groupId) needed.add(assignment.groupId);
  }

  // Признак внешнего участника читается вместе с составом групп: список членов его уже несёт,
  // а поимённо назначенных дочитываем ниже — их единицы.
  const external = new Set<string>();
  /** Про кого признак уже известен: все, кто попался в составе прочитанных групп. */
  const knownKind = new Set<string>();
  /** Оргполя профиля — читаются вместе с признаком, тем же проходом (Р-7). */
  const profiles = new Map<string, Partial<Record<OrgField, string | null>>>();
  const membersOfGroup = new Map<string, string[]>(
    await Promise.all([...needed].map(async id => {
      const members = await storage.getGroupUsers(id);
      for (const member of members) {
        knownKind.add(member.id);
        if ((member as { isExternal?: boolean }).isExternal) external.add(member.id);
        profiles.set(member.id, member as Partial<Record<OrgField, string | null>>);
      }
      return [id, members.map(user => user.id)] as const;
    })),
  );

  // Назначение группе — это назначение каждому её участнику: человек, попавший в срез, должен
  // считаться назначенным независимо от того, позвали его поимённо или списком.
  const assignedUsers = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.userId) assignedUsers.add(assignment.userId);
    if (assignment.groupId) {
      for (const userId of membersOfGroup.get(assignment.groupId) ?? []) assignedUsers.add(userId);
    }
  }

  // Поимённо назначенный мог не состоять ни в одной группе — тогда его признак неизвестен и
  // дочитывается по одному. Иначе внешний участник, позванный ссылкой, считался бы
  // сотрудником. Дочитываются ТОЛЬКО такие: про членов групп всё уже прочитано выше.
  await Promise.all([...assignedUsers]
    .filter(id => !knownKind.has(id))
    .map(async id => {
      const user = await storage.getUser(id);
      if (user && (user as { isExternal?: boolean }).isExternal) external.add(id);
      if (user) profiles.set(id, user as Partial<Record<OrgField, string | null>>);
    }));

  return {
    countByOrg(field, value) {
      const wanted = orgValueKey(value);
      let count = 0;
      for (const userId of assignedUsers) {
        if (orgValueKey(profiles.get(userId)?.[field]) === wanted) count += 1;
      }
      return count;
    },

    countByKind(wantExternal) {
      let count = 0;
      for (const userId of assignedUsers) {
        if (external.has(userId) === wantExternal) count += 1;
      }
      return count;
    },

    countFor(groupIds) {
      if (groupIds === null) return null;
      if (groupIds.length === 0) return assignedUsers.size;

      const inSlice = new Set<string>();
      for (const groupId of groupIds) {
        for (const userId of membersOfGroup.get(groupId) ?? []) inSlice.add(userId);
      }
      let count = 0;
      for (const userId of inSlice) if (assignedUsers.has(userId)) count += 1;
      return count;
    },
  };
}
