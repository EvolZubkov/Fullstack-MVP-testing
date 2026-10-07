/**
 * @module shared/analytics/attempt-pick
 * @description Какую попытку участника берёт психометрика: все, первую, лучшую или последнюю
 * (PRD-66 FR-51, дельта 2026-10-07).
 *
 * Это ОДНО правило с четырьмя значениями, а не независимые флажки: каждое значение, кроме «все»,
 * оставляет участнику ровно одну попытку и отличается только тем, какую. По «И» они противоречили
 * бы друг другу («первая И лучшая» молча выбросила бы всех, кто улучшил результат на пересдаче).
 *
 * Один источник на сервер и клиент: сервер отбирает по нему наблюдения, клиент называет условие
 * в окне фильтра, в чипе и в окне выгрузки. Разойдись подписи или разбор адреса — экран и файл
 * назвали бы одну выборку по-разному.
 */

/** Правило выбора попытки участника. */
export type AttemptPick = "all" | "first" | "best" | "last";

/** Все правила в порядке окна фильтра. */
export const ATTEMPT_PICKS: readonly AttemptPick[] = ["all", "first", "best", "last"];

/**
 * Умолчание — первая попытка: повторные попытки одного человека не независимы, он помнит
 * задания, а лучшая отобрана по самому результату и смещает статистику.
 */
export const DEFAULT_ATTEMPT_PICK: AttemptPick = "first";

/** Подпись правила в окне фильтра — заголовок группы уже говорит «Попытки». */
export const ATTEMPT_PICK_OPTION_LABEL: Record<AttemptPick, string> = {
  all: "Все",
  first: "Только первая",
  best: "Только лучшая",
  last: "Только последняя",
};

/**
 * Подпись правила в строке фильтра и в окне выгрузки; у «все» её нет — чип показывает только
 * условие, которое сужает выборку.
 */
export const ATTEMPT_PICK_CHIP_LABEL: Record<Exclude<AttemptPick, "all">, string> = {
  first: "Только первая попытка",
  best: "Только лучшая попытка",
  last: "Только последняя попытка",
};

/** Проверка значения из адреса или из сохранённого состояния. */
export function isAttemptPick(value: unknown): value is AttemptPick {
  return typeof value === "string" && (ATTEMPT_PICKS as readonly string[]).includes(value);
}

/**
 * Правило из параметров адреса.
 *
 * Основной параметр — `attempts`. Прежний `firstAttemptOnly` понимается как синоним, чтобы
 * старые ссылки и закладки давали то же, что давали: `false` — все попытки, иначе — первая.
 * Нераспознанное значение `attempts` не роняет запрос, а даёт умолчание вызывающего.
 *
 * @param query параметры адреса
 * @param fallback что означает отсутствие обоих параметров
 * @returns правило выбора попытки
 */
export function attemptPickFromQuery(
  query: { attempts?: unknown; firstAttemptOnly?: unknown },
  fallback: AttemptPick,
): AttemptPick {
  if (isAttemptPick(query.attempts)) return query.attempts;
  if (query.firstAttemptOnly !== undefined) {
    return String(query.firstAttemptOnly).toLowerCase() === "false" ? "all" : "first";
  }
  return fallback;
}

/** Прохождение-кандидат: всё, что нужно правилу, чтобы выбрать одно у участника. */
export interface AttemptCandidate {
  /** Идентификатор прохождения. */
  id: string;
  /** Кем опознан участник; `null` — опознать нечем, участник в отбор не входит. */
  participantId: string | null;
  /** Когда прохождение началось, мс от эпохи. */
  at: number;
  /** Процент результата; `null` — результата нет (не завершено, нечего оценивать). */
  percent: number | null;
}

/**
 * Выбрать прохождения по правилу.
 *
 * - `first` — самое раннее по началу; при равном времени — встреченное первым.
 * - `last` — самое позднее по началу; при равном времени — встреченное последним.
 * - `best` — наибольший процент; при равенстве — более раннее. Прохождения без результата в
 *   выбор не входят, и участник без единого оценённого прохождения из выборки выпадает:
 *   «лучшей» у него нет.
 *
 * Участник без опознания при любом правиле, кроме `all`, не входит: одной его попытки не выбрать.
 *
 * @param candidates прохождения выборки
 * @param pick правило
 * @returns идентификаторы оставленных прохождений; `null` — правило `all`, отбора нет
 */
export function pickAttemptIds(
  candidates: Iterable<AttemptCandidate>,
  pick: AttemptPick,
): Set<string> | null {
  if (pick === "all") return null;
  const chosen = new Map<string, AttemptCandidate>();
  for (const candidate of candidates) {
    if (!candidate.participantId) continue;
    if (pick === "best" && candidate.percent === null) continue;
    const seen = chosen.get(candidate.participantId);
    if (!seen || beats(candidate, seen, pick)) chosen.set(candidate.participantId, candidate);
  }
  return new Set([...chosen.values()].map(candidate => candidate.id));
}

/** Вытесняет ли новый кандидат уже выбранного. */
function beats(candidate: AttemptCandidate, seen: AttemptCandidate, pick: Exclude<AttemptPick, "all">): boolean {
  switch (pick) {
    case "first":
      return candidate.at < seen.at;
    case "last":
      return candidate.at >= seen.at;
    case "best": {
      const percent = candidate.percent ?? -Infinity;
      const seenPercent = seen.percent ?? -Infinity;
      return percent > seenPercent || (percent === seenPercent && candidate.at < seen.at);
    }
  }
}
