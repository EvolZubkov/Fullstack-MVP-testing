/**
 * @module server/services/analytics/delivery-stats
 * @description PRD-56 FR-18 - FR-20: три расчёта вкладки «Выдача» — варианты, версии
 * публикации и профиль экспозиции банка.
 *
 * Все три считаются поверх ОДНОГО слоя наблюдений и одной сводки (`summariseObservations`):
 * своей формулы доли сдавших здесь не заводится, иначе число варианта однажды разойдётся с
 * числом плитки над ним (FR-25).
 *
 * Общее правило малой выборки (FR-27): ниже порога наблюдений строка сообщает только СЧЁТ, а
 * доли и расхождения отвечают `null` — «мало данных», а не ноль. Доверительный интервал доли
 * при восьми прохождениях около ±35 п.п.: такое число ничего не утверждает.
 */

import { summariseObservations } from "./test-summary";
import type { Observation } from "./observations";

/**
 * Насколько доля сдавших варианта должна отойти от доли по тесту, чтобы это назвали
 * расхождением, в процентных пунктах.
 *
 * Названная константа, а не число в коде: десять пунктов — это решение о том, что считать
 * заметным, и оно должно читаться. Меньший разброс на выборке в сотню прохождений объясняется
 * случайностью состава, а не устройством варианта.
 */
export const VARIANT_DELTA_POINTS = 10;

export interface DeliveryStatsOptions {
  /** Порог наблюдений (FR-06d), `analytics.minObservations`. */
  minObservations: number;
}

/** Набор форм одного раздела теста (PRD-17) — чем варианты и называются. */
export interface SectionForms {
  topicId: string;
  topicName: string;
  forms: Array<{ id: string; label: string }>;
}

export interface VariantRow {
  formId: string;
  label: string;
  /** Прохождений этого варианта — считая незавершённые: они тоже его получили. */
  attempts: number;
  passRate: number | null;
  avgPercent: number | null;
  /** Расхождение доли сдавших с долей ПО ТЕСТУ, в процентных пунктах. */
  deltaPoints: number | null;
  /** Расхождение, которое стоит назвать: см. {@link VARIANT_DELTA_POINTS}. */
  deviates: boolean;
  lowSample: boolean;
}

export interface VariantSectionStats {
  topicId: string;
  topicName: string;
  rows: VariantRow[];
}

/**
 * Проходимость по вариантам (FR-18), сгруппированная ПО РАЗДЕЛАМ.
 *
 * Вариант — свойство раздела, и у теста с двумя наборами форм плоский список смешал бы формы
 * разных тем. Раздел без набора форм в таблицу не попадает вовсе: вариантов у него нет.
 *
 * @param observations прохождения выборки
 * @param sections разделы теста с их наборами форм
 * @param opts порог наблюдений
 */
export function variantStats(
  observations: readonly Observation[],
  sections: readonly SectionForms[],
  opts: DeliveryStatsOptions,
): VariantSectionStats[] {
  // База сравнения — весь тест: вариант отвечает на «оценивают ли формы одинаково», а не на
  // «какая форма лучше соседней».
  const overall = summariseObservations(observations);

  return sections
    .filter(section => section.forms.length > 0)
    .map(section => ({
      topicId: section.topicId,
      topicName: section.topicName,
      rows: section.forms.map(form => {
        const runs = observations.filter(o => o.forms[section.topicId] === form.id);
        const stats = summariseObservations(runs);
        const enough = runs.length >= opts.minObservations;
        const delta = enough && stats.passRate !== null && overall.passRate !== null
          ? stats.passRate - overall.passRate
          : null;

        return {
          formId: form.id,
          label: form.label,
          attempts: runs.length,
          passRate: enough ? stats.passRate : null,
          avgPercent: enough ? stats.avgPercent : null,
          deltaPoints: delta === null ? null : Math.round(delta * 10) / 10,
          deviates: delta !== null && Math.abs(delta) >= VARIANT_DELTA_POINTS,
          lowSample: !enough && runs.length > 0,
        };
      }),
    }));
}

/** Снимок публикации в том виде, в каком его читает разрез. */
export interface SnapshotInfo {
  id: string;
  version: number;
  publishedAt: Date;
}

export interface VersionRow {
  /** `null` — строка «Версия не указана»: прохождения пакетов, собранных до FR-19a. */
  snapshotId: string | null;
  version: number | null;
  publishedAt: Date | null;
  /** Когда версия перестала действовать — публикация следующей; `null` у текущей. */
  effectiveTo: Date | null;
  current: boolean;
  attempts: number;
  passRate: number | null;
  avgPercent: number | null;
  lowSample: boolean;
}

/**
 * Разрез по версиям публикации (FR-19).
 *
 * Версии идут от новой к старой, а прохождения без версии — последней строкой. Версия, по
 * которой ещё никто не проходил, из таблицы НЕ убирается: пустая строка и есть ответ «после
 * правки ещё никто не проходил». Строка «версия не указана» появляется, только если такие
 * прохождения есть.
 *
 * @param observations прохождения выборки
 * @param snapshots снимки теста
 * @param opts порог наблюдений
 */
export function versionStats(
  observations: readonly Observation[],
  snapshots: readonly SnapshotInfo[],
  opts: DeliveryStatsOptions,
): VersionRow[] {
  const ordered = [...snapshots].sort((a, b) => b.version - a.version);
  const currentId = ordered[0]?.id ?? null;

  const row = (
    runs: readonly Observation[],
    base: Omit<VersionRow, "attempts" | "passRate" | "avgPercent" | "lowSample">,
  ): VersionRow => {
    const stats = summariseObservations(runs);
    const enough = runs.length >= opts.minObservations;
    return {
      ...base,
      attempts: runs.length,
      passRate: enough ? stats.passRate : null,
      avgPercent: enough ? stats.avgPercent : null,
      lowSample: !enough && runs.length > 0,
    };
  };

  const rows = ordered.map((snapshot, index) => row(
    observations.filter(o => o.snapshotId === snapshot.id),
    {
      snapshotId: snapshot.id,
      version: snapshot.version,
      publishedAt: snapshot.publishedAt,
      // Следующая по номеру версия — та, что стоит ВЫШЕ в списке: он отсортирован по убыванию.
      effectiveTo: index === 0 ? null : ordered[index - 1].publishedAt,
      current: snapshot.id === currentId,
    },
  ));

  const unknown = observations.filter(
    o => o.snapshotId === null || !ordered.some(s => s.id === o.snapshotId),
  );
  if (unknown.length > 0) {
    rows.push(row(unknown, {
      snapshotId: null,
      version: null,
      publishedAt: null,
      effectiveTo: null,
      current: false,
    }));
  }

  return rows;
}

/** Задание банка темы в том виде, в каком его читает профиль. */
export interface BankQuestion {
  id: string;
  prompt: string;
  type: string;
  tags: string[];
  /** PRD-56 FR-17a: задание исключено из выдачи этого теста. */
  excluded: boolean;
  /**
   * Входит ли задание в ПУЛ ВЫДАЧИ теста (`delivery-pool`): доступный банк, для раздела с
   * вариантами — вопросы вариантов, для адаптива — вопросы уровней. Без поля — «входит, если не
   * исключено».
   *
   * Строка профиля и пул — разные вещи: задание, выданное раньше и с тех пор исключённое или
   * выпавшее из вариантов, свою историю выдач сохраняет и строкой остаётся, но ни в размер банка,
   * ни в «не выдавалось ни разу» уже не входит — выдать его тест больше не может.
   */
  inPool?: boolean;
}

export interface ExposureRow {
  questionId: string;
  prompt: string;
  type: string;
  /** Подтемы задания (PRD-11) — ими строка и называет себя, кроме самого текста. */
  tags: string[];
  deliveredCount: number;
  /** Доля прохождений, где задание было выдано; `null` — прохождений не было вовсе. */
  sharePercent: number | null;
  excluded: boolean;
}

/**
 * Как раздел выдаёт вопросы — от этого зависит, что подзаголовок профиля называет «выдаётся
 * на прохождение»: квота, весь банк, вариант раздела или уровни адаптивного прогона. Поле
 * `draw_count` у варианта и у адаптива не применяется, и читать его там — значит печатать ноль.
 */
export type ExposureDrawMode = "quota" | "all" | "forms" | "adaptive";

export interface ExposureProfileInput {
  topicId: string;
  topicName: string;
  /** Способ выдачи раздела; без поля — по `drawCount`: число — квота, `null` — весь банк. */
  drawMode?: ExposureDrawMode;
  /** Сколько заданий темы выдаётся на прохождение; `null` — выдаётся весь банк. */
  drawCount: number | null;
  bank: readonly BankQuestion[];
  /** Накопленные выдачи за окно наблюдения (PRD-55). */
  deliveredCounts: ReadonlyMap<string, number>;
  /** Знаменатель доли: попытки теста за то же окно, считая брошенные. */
  attemptsInWindow: number;
}

export interface ExposureProfileResult {
  topicId: string;
  topicName: string;
  bankSize: number;
  drawMode: ExposureDrawMode;
  /** Квота раздела; есть только у `drawMode: "quota"`. */
  drawCount: number | null;
  attemptsInWindow: number;
  rows: ExposureRow[];
  /** Сколько заданий ПУЛА не выдавалось НИ РАЗУ — хвост, свёрнутый в одно число. */
  neverDelivered: number;
}

/**
 * Профиль экспозиции банка ОДНОЙ темы (FR-20).
 *
 * Одной, потому что у разных тем разные квоты выдачи: сложить их в один список значит сравнить
 * несравнимое. Невыданные задания в строки не разворачиваются — перечислять их поштучно
 * незачем, а их ЧИСЛО и есть ответ на «сколько банка простаивает».
 */
export function exposureProfile(input: ExposureProfileInput): ExposureProfileResult {
  const rows: ExposureRow[] = [];
  let neverDelivered = 0;
  let bankSize = 0;

  for (const question of input.bank) {
    const inPool = question.inPool ?? !question.excluded;
    if (inPool) bankSize += 1;
    const deliveredCount = input.deliveredCounts.get(question.id) ?? 0;
    if (deliveredCount === 0) {
      // Невыданное задание вне пула — не простой банка: выдать его тест и не может.
      if (inPool) neverDelivered += 1;
      continue;
    }
    rows.push({
      questionId: question.id,
      prompt: question.prompt,
      type: question.type,
      tags: question.tags,
      deliveredCount,
      // Ноль попыток означает «сравнивать не с чем»: доля тогда `null`, а не ноль.
      sharePercent: input.attemptsInWindow > 0
        ? (deliveredCount / input.attemptsInWindow) * 100
        : null,
      excluded: question.excluded,
    });
  }

  rows.sort((a, b) => b.deliveredCount - a.deliveredCount);

  return {
    topicId: input.topicId,
    topicName: input.topicName,
    // Размер банка — размер ПУЛА выдачи (решение владельца 2026-09-26): исключённое задание
    // банк не пополняет, хотя строкой с историей выдач и остаётся.
    bankSize,
    drawMode: input.drawMode ?? (input.drawCount === null ? "all" : "quota"),
    drawCount: (input.drawMode ?? "quota") === "quota" ? input.drawCount : null,
    attemptsInWindow: input.attemptsInWindow,
    rows,
    neverDelivered,
  };
}
