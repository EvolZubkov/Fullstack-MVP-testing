/**
 * @module server/services/analytics/attention
 * @description PRD-56 FR-10, FR-11: очередь «требует внимания».
 *
 * Единственный экран аналитики, который говорит «сделай», а не «посмотри». Отсюда правила
 * отбора: в очередь попадает только то, по чему есть действие, и только когда основание
 * настоящее, а не выведено из умолчания. Тревога без основания стоит дороже пропущенной
 * строки — на неё тратят время, а потом перестают смотреть на экран вовсе.
 *
 * Модуль чистый: назначения и наблюдения приходят снаружи, «сейчас» передаётся параметром —
 * иначе «просрочено» нельзя проверить, не подкручивая системные часы.
 */

import type { Observation } from "./observations";

/** Корзины очереди. Каждая отвечает на свой вопрос «что делать». */
export type AttentionKind =
  /** Срок истёк, а к тесту не приступали. */
  | "overdue"
  /** Не сдал, попытки ещё остались — довольно напоминания. */
  | "failed"
  /** Начал и бросил: попытка висит незавершённой. */
  | "abandoned"
  /** Попытки исчерпаны, тест не сдан — нужно решение человека. */
  | "exhausted";

/** Одна позиция очереди: кто, по какому тесту и почему здесь. */
export interface AttentionItem {
  kind: AttentionKind;
  participantId: string | null;
  participant: string;
  testId: string | null;
  /** Прохождение, из-за которого позиция появилась. У «срок истёк» его нет. */
  observationId?: string;
  /**
   * Источник этого прохождения.
   *
   * Нужен, чтобы позиция вела к разбору (FR-11): веб-попытка и запись из LMS читаются разными
   * ручками, и без источника читателю пришлось бы угадывать, какую звать.
   */
  source?: Observation["source"];
  /** Срок назначения — только у «срок истёк». */
  dueAt?: Date;
  /**
   * Когда человек проходил тест. Есть у каждого дела, у которого есть прохождение: колонка
   * «когда» пуста только там, где события ещё не было — у просроченного назначения.
   */
  startedAt?: Date;
  /**
   * Результат прохождения в процентах; `null`, когда оценивать было нечего.
   *
   * «Не сдал» с 68 % при пороге 70 и «не сдал» с 20 % — разные дела: первому хватит
   * пересдачи, второго надо учить заново. Без числа они выглядят одинаково.
   */
  percent?: number | null;
  /** Которая это попытка участника по счёту и сколько их разрешено (`null` — без лимита). */
  attemptNumber?: number;
  attemptLimit?: number | null;
}

export interface AttentionInput {
  /** Назначения со сроками. Назначения БЕЗ срока доходят сюда и отсеиваются здесь. */
  assignments: Array<{
    id: string;
    testId: string;
    userId: string | null;
    dueDate: Date | null;
  }>;
  /** Прохождения, попавшие в область видимости читателя. */
  observations: Observation[];
  /** Сколько попыток разрешает тест. Отсутствие в карте = лимита нет. */
  attemptLimits: ReadonlyMap<string, number | null>;
  /** Имя участника по идентификатору — для позиций, у которых прохождения ещё нет. */
  participantNames: ReadonlyMap<string, string>;
  now: Date;
  /**
   * Начало периода вкладки (за неделю, месяц, квартал). Каждая корзина режет по СВОЕЙ дате:
   * просроченное назначение — по сроку, остальные — по последней попытке. Нет — за всё время.
   */
  since?: Date;
}

/**
 * Сколько попытка может висеть незавершённой, прежде чем считаться брошенной.
 *
 * Двое суток: час — это обеденный перерыв и закрытая крышка ноутбука, неделя — срок, за
 * который о брошенной попытке уже никто не вспомнит. Величина решает, КОГДА позиция появится,
 * и ничего не говорит о самих числах, поэтому живёт константой, а не настройкой инстанса.
 */
const ABANDONED_AFTER_MS = 48 * 60 * 60 * 1000;

/** Прохождения одного участника по одному тесту, новые первыми. */
function byParticipantAndTest(observations: Observation[]): Map<string, Observation[]> {
  const groups = new Map<string, Observation[]>();
  for (const observation of observations) {
    const key = `${observation.testId ?? ""}:${observation.participantId ?? observation.id}`;
    const list = groups.get(key) ?? [];
    list.push(observation);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }
  return groups;
}

/**
 * Собрать очередь дел.
 *
 * Участник по одному тесту попадает в неё ОДИН раз и по ПОСЛЕДНЕМУ прохождению: человек,
 * бросивший очередную попытку после двух проваленных, — это одно дело, а не три строки в
 * разных корзинах.
 */
export function buildAttentionQueue(input: AttentionInput): AttentionItem[] {
  const { assignments, observations, attemptLimits, participantNames, now, since } = input;
  const items: AttentionItem[] = [];
  const groups = byParticipantAndTest(observations);

  for (const assignment of assignments) {
    // FR-10a: назначение без срока в очередь не попадает — без даты «просрочено» вывести
    // не из чего, а умолчание вроде «через месяц» показало бы человеку придуманную тревогу.
    if (!assignment.dueDate || assignment.dueDate > now) continue;
    // Период: срок истёк раньше начала периода — дело за его пределами.
    if (since && assignment.dueDate < since) continue;
    if (!assignment.userId) continue;
    if ((groups.get(`${assignment.testId}:${assignment.userId}`)?.length ?? 0) > 0) continue;

    items.push({
      kind: "overdue",
      participantId: assignment.userId,
      participant: participantNames.get(assignment.userId) ?? "Участник",
      testId: assignment.testId,
      dueAt: assignment.dueDate,
    });
  }

  for (const list of groups.values()) {
    const latest = list[0];
    // Период: последняя попытка раньше его начала — дело за его пределами. Режется именно
    // последняя: по ней участник и попадает в корзину.
    if (since && latest.startedAt < since) continue;
    const limit = latest.testId ? attemptLimits.get(latest.testId) ?? null : null;
    // Порядковый номер последней попытки: список отсортирован новыми вперёд, поэтому счёт
    // ведётся от его длины. Незавершённые считаются тоже — человек их потратил.
    const base = {
      participantId: latest.participantId,
      participant: latest.participant,
      testId: latest.testId,
      observationId: latest.id,
      source: latest.source,
      startedAt: latest.startedAt,
      percent: latest.percent,
      attemptNumber: list.length,
      attemptLimit: limit,
    };

    if (latest.outcome === "incomplete") {
      // Идущая сейчас попытка — работа, а не дело: человек мог отойти на обед.
      if (now.getTime() - latest.startedAt.getTime() >= ABANDONED_AFTER_MS) {
        items.push({ ...base, kind: "abandoned" });
      }
      continue;
    }

    // Сдавшие и прохождения без оценивания в очередь не попадают: делать по ним нечего.
    if (latest.outcome !== "failed") continue;

    const used = list.filter(observation => observation.outcome !== "incomplete").length;
    // Исчерпавший лимит и просто не сдавший — разные дела: первому нужно решение человека,
    // второму хватит напоминания.
    items.push({ ...base, kind: limit !== null && used >= limit ? "exhausted" : "failed" });
  }

  return items;
}

/** Сколько дел в каждой корзине — счётчики над очередью. */
export function countAttention(items: AttentionItem[]): Record<AttentionKind, number> {
  const counts: Record<AttentionKind, number> = {
    overdue: 0, failed: 0, abandoned: 0, exhausted: 0,
  };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}
