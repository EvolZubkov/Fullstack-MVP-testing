/**
 * @module server/services/analytics/slice-axis
 * @description PRD-56 FR-06a: ось разбиения — все срезы по одному признаку сразу.
 *
 * Срез отвечает на «покажи вот эту группу», ось — на «покажи мне все группы». Это разные
 * вопросы: первый задают, когда знают, кого искать, второй — когда ищут, где проблема.
 *
 * Осей оргструктуры (организация, подразделение, должность) здесь пока нет. Исключение их из
 * объёма отменено (FR-06b, 2026-09-28): значение берётся у прохождения, иначе из профиля
 * связанного пользователя (OQ-04). Предусловие — поля профиля в интерфейсе пользователей.
 *
 * Модуль чистый: членство в группах, названия и признак внешнего участника приходят снаружи.
 */

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
  | "external";

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
  from?: string;
  to?: string;
} {
  // «Без группы», «без варианта», «версия не указана» — это ОТСУТСТВИЕ признака, а отбирать
  // по отсутствию реестр не умеет: условия у него перечисляют значения.
  if (key === NONE) return {};

  switch (axis) {
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

  for (const observation of observations) {
    for (const { key, label } of keysOf(observation, axis, context, numbers.get(observation.id) ?? 1)) {
      const bucket = buckets.get(key) ?? { key, label, observations: [] };
      bucket.observations.push(observation);
      buckets.set(key, bucket);
    }
  }

  // Порядок устойчив и одинаков для всех осей — по ключу. У попыток он заодно осмысленный:
  // «1», «2», «3+» идут в том же порядке, в каком их читают.
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}
