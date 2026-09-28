/**
 * @module server/services/analytics/slice-axis
 * @description PRD-56 FR-06a: ось разбиения — все срезы по одному признаку сразу.
 *
 * Срез отвечает на «покажи вот эту группу», ось — на «покажи мне все группы». Это разные
 * вопросы: первый задают, когда знают, кого искать, второй — когда ищут, где проблема.
 *
 * Оси оргструктуры — организация, подразделение, должность (FR-06b, отмена исключения
 * 2026-09-28). Значение у наблюдения уже выведено по правилу OQ-04 (своё, иначе профиль), здесь
 * оно только группируется: разные написания одного отдела — один срез (`shared/org-fields`).
 *
 * Модуль чистый: членство в группах, названия и признак внешнего участника приходят снаружи.
 */

import { orgValueKey } from "@shared/org-fields";

import type { Observation } from "./observations";

/** Признак, по которому выборка разбивается на срезы. */
export type SliceAxis =
  /** Кого учили: членство участника, у импорта — метка группы. */
  | "group"
  /** Поток: календарный месяц начала прохождения. */
  | "period"
  /** Первая попытка против повторных: эффект пересдачи и следы утечки. */
  | "attempt"
  /** Версия публикации теста (PRD-15). */
  | "version"
  /** Вариант выдачи (PRD-17/24). */
  | "variant"
  /** Веб, телеметрия, импорт — разные популяции. */
  | "source"
  /** Внутренние сотрудники против внешних участников (PRD-28). */
  | "external"
  /** Оргструктура (FR-06b): значение прохождения, иначе профиль (OQ-04). */
  | "organization"
  | "unit"
  | "position";

/** Оси оргструктуры и подпись их среза «нет значения». */
const ORG_AXES: Partial<Record<SliceAxis, string>> = {
  organization: "Не указана",
  unit: "Не указано",
  position: "Не указана",
};

function isOrgAxis(axis: SliceAxis): axis is "organization" | "unit" | "position" {
  return axis in ORG_AXES;
}

/** Справочники, без которых ось не назвать человеческим языком. */
export interface AxisContext {
  /** Группы участника по его идентификатору — членство (`user_groups`). */
  groupsOfParticipant: ReadonlyMap<string, string[]>;
  groupNames: ReadonlyMap<string, string>;
  /** Участники, отмеченные внешними (`users.is_external`). */
  externalParticipants: ReadonlySet<string>;
  /** Номер версии публикации по идентификатору снимка. */
  snapshotVersions: ReadonlyMap<string, number>;
  /**
   * Название варианта по его идентификатору (`form_set_json.forms[].label`).
   *
   * Без него срез подписывался бы сырым `formId`, а это uuid: подписать им строку значит не
   * подписать её вовсе.
   */
  formLabels: ReadonlyMap<string, string>;
}

/** Один срез, полученный разбиением. */
export interface AxisBucket {
  key: string;
  label: string;
  observations: Observation[];
}

/** Ключ «ничего не проставлено» — у каждой оси он свой по смыслу, но всегда существует. */
export const NONE = "none";

const SOURCE_LABEL: Record<string, string> = {
  web: "Веб",
  telemetry: "Телеметрия LMS",
  import: "Импорт",
};

/** Месяц начала в виде `ГГГГ-ММ` — по нему срезы сортируются как строки. */
function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Название месяца для человека: «сентябрь 2026». */
function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const names = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
  ];
  return `${names[Number(month) - 1] ?? month} ${year}`;
}

/**
 * Номер попытки участника: считается порядком по времени начала.
 *
 * `attempt_number` телеметрии тут не годится один: он нумерует попытки ВНУТРИ сессии пакета, а
 * ось спрашивает про человека — его первую попытку против повторных.
 */
function attemptNumbers(observations: readonly Observation[]): Map<string, number> {
  const byParticipant = new Map<string, Observation[]>();
  for (const observation of observations) {
    const key = observation.participantId ?? observation.id;
    const list = byParticipant.get(key) ?? [];
    list.push(observation);
    byParticipant.set(key, list);
  }

  const numbers = new Map<string, number>();
  for (const list of byParticipant.values()) {
    list
      .slice()
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .forEach((observation, index) => numbers.set(observation.id, index + 1));
  }
  return numbers;
}

/** Куда попадает прохождение по этой оси. Пусто — значит ни в один именованный срез. */
function keysOf(
  observation: Observation,
  axis: SliceAxis,
  context: AxisContext,
  attemptNumber: number,
): Array<{ key: string; label: string }> {
  switch (axis) {
    case "group": {
      // У импорта метка группы своя: участник там может быть не заведён вовсе (PRD-54).
      const ids = observation.groupId
        ? [observation.groupId]
        : context.groupsOfParticipant.get(observation.participantId ?? "") ?? [];
      if (ids.length === 0) return [{ key: NONE, label: "Без группы" }];
      return ids.map(id => ({ key: id, label: context.groupNames.get(id) ?? "Группа" }));
    }
    case "period": {
      const key = monthOf(observation.startedAt);
      return [{ key, label: monthLabel(key) }];
    }
    case "attempt": {
      if (attemptNumber === 1) return [{ key: "1", label: "Первая попытка" }];
      if (attemptNumber === 2) return [{ key: "2", label: "Вторая попытка" }];
      return [{ key: "3+", label: "Третья и далее" }];
    }
    case "version": {
      if (!observation.snapshotId) {
        // Прохождения из LMS версии пока не несут (FR-19a): молчать об этом нельзя — иначе
        // они слились бы с текущей версией и разрез начал бы врать.
        return [{ key: NONE, label: "Версия не указана" }];
      }
      const version = context.snapshotVersions.get(observation.snapshotId);
      return [{
        key: observation.snapshotId,
        label: version ? `Версия ${version}` : "Версия публикации",
      }];
    }
    case "variant": {
      // Вариантов у прохождения столько, сколько у теста разделов с наборами форм, — и оно
      // попадает в строку КАЖДОГО, как участник попадает в каждую свою группу.
      const formIds = Object.values(observation.forms);
      if (formIds.length === 0) return [{ key: NONE, label: "Без варианта" }];
      return formIds.map(formId => ({
        key: formId,
        // Названия нет — вариант удалён из теста после прохождения; печатать uuid незачем.
        label: context.formLabels.get(formId) ?? "Удалённый вариант",
      }));
    }
    case "source": {
      return [{ key: observation.source, label: SOURCE_LABEL[observation.source] ?? observation.source }];
    }
    case "external": {
      const isExternal = context.externalParticipants.has(observation.participantId ?? "");
      return [isExternal
        ? { key: "external", label: "Внешние участники" }
        : { key: "internal", label: "Внутренние сотрудники" }];
    }
    case "organization":
    case "unit":
    case "position": {
      // Ключ — сравнительный (без регистра и лишних пробелов); подпись и итоговый ключ среза
      // выбирает `splitByAxis` по самому частому написанию, когда соберёт весь срез.
      const value = observation[axis];
      const key = orgValueKey(value);
      return key === null
        ? [{ key: NONE, label: ORG_AXES[axis]! }]
        : [{ key, label: value! }];
    }
  }
}

/**
 * Условия среза оси на языке реестра — для перехода «из строки в прохождения» (FR-08).
 *
 * Перевод честный до отказа: там, где у реестра такого условия нет (номер попытки, внешний
 * участник), возвращается пусто, и переход открывает реестр по одной рамке — тесту и периоду.
 * Подменять невыразимое условие похожим значило бы показать ДРУГУЮ выборку под именем среза:
 * числа разошлись бы, и объяснить это было бы нечем.
 *
 * Вариант выдачи и версия публикации невыразимыми быть перестали: они заведены условиями
 * отбора наравне с группой, и срез по ним теперь переводится точно.
 */
export function registryConditions(
  axis: SliceAxis,
  key: string,
): {
  groupIds?: string[];
  sources?: string[];
  formIds?: string[];
  snapshotIds?: string[];
  organizations?: string[];
  units?: string[];
  positions?: string[];
  from?: string;
  to?: string;
} {
  // «Без группы», «без варианта», «версия не указана» — это ОТСУТСТВИЕ признака, а отбирать
  // по отсутствию реестр не умеет: условия у него перечисляют значения.
  if (key === NONE) return {};

  switch (axis) {
    // Ключ оргсреза — его подпись (самое частое написание); реестр отбирает по нему все
    // написания того же значения, поэтому перевод точен.
    case "organization":
      return { organizations: [key] };
    case "unit":
      return { units: [key] };
    case "position":
      return { positions: [key] };
    case "group":
      return { groupIds: [key] };
    case "source":
      return { sources: [key] };
    // Вариант выдачи и версия публикации стали условиями отбора наравне с группой: перевод
    // больше не теряется, и переход «из строки среза в прохождения» открывает ровно тот
    // состав, что в строке.
    case "variant":
      return { formIds: [key] };
    case "version":
      return { snapshotIds: [key] };
    case "period": {
      const [year, month] = key.split("-").map(Number);
      if (!year || !month) return {};
      // День ноль следующего месяца — последний день этого: февраль високосного года так
      // считается сам, без таблицы длин.
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
    }
    default:
      return {};
  }
}

/**
 * Разбить выборку на срезы по оси.
 *
 * Прохождение может попасть в НЕСКОЛЬКО срезов одной оси — участник состоит в двух группах, и
 * его результат честно виден в обеих. Сумма объёмов при этом больше выборки, и это правда о
 * данных, а не ошибка счёта.
 */
export function splitByAxis(
  observations: readonly Observation[],
  axis: SliceAxis,
  context: AxisContext,
): AxisBucket[] {
  const numbers = axis === "attempt" ? attemptNumbers(observations) : new Map<string, number>();
  const buckets = new Map<string, AxisBucket>();

  /** Написания значения в срезе оргоси — по ним выбирается подпись. */
  const spellings = new Map<string, Map<string, number>>();

  for (const observation of observations) {
    for (const { key, label } of keysOf(observation, axis, context, numbers.get(observation.id) ?? 1)) {
      const bucket = buckets.get(key) ?? { key, label, observations: [] };
      bucket.observations.push(observation);
      buckets.set(key, bucket);
      if (isOrgAxis(axis) && key !== NONE) {
        const counts = spellings.get(key) ?? new Map<string, number>();
        counts.set(label, (counts.get(label) ?? 0) + 1);
        spellings.set(key, counts);
      }
    }
  }

  // Оргсрез подписывается САМЫМ ЧАСТЫМ написанием (при равенстве — первым по алфавиту, чтобы
  // подпись не мигала между загрузками), и оно же становится ключом: ключ уходит в условия
  // реестра, и «перейти к прохождениям» должно читаться как имя, а не как нижний регистр.
  if (isOrgAxis(axis)) {
    for (const [key, counts] of spellings) {
      const [label] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))[0];
      const bucket = buckets.get(key)!;
      bucket.label = label;
      bucket.key = label;
    }
  }

  // Порядок устойчив и одинаков для всех осей — по ключу. У попыток он заодно осмысленный:
  // «1», «2», «3+» идут в том же порядке, в каком их читают.
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}
