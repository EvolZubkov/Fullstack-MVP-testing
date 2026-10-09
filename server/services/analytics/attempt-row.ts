/**
 * @module server/services/analytics/attempt-row
 * @description Reading one stored passage row: which test it belongs to and how its
 * participant is signed (PRD-54 section 12).
 *
 * Lives in the service layer because both the analytics routes and the observation
 * layer (PRD-56 FR-33) need it, and a service must not import from routes.
 */
import { participantLabel } from "@shared/participant-label";

/**
 * Пакет, которым выдано LMS-прохождение, — или `undefined`, если пакета нет.
 *
 * PRD-54: `scorm_attempts.package_id` стал необязательным, потому что импортированная строка
 * приехала книгой, а не рантаймом, и пакета за ней не стоит. Один помощник на все места чтения:
 * восемь разных `packageMap.get(a.packageId)` с восемью разными способами обойти `null` — это
 * восемь мест, где однажды забудут.
 *
 * @param attempt попытка с возможным пакетом
 * @param packages карта пакетов по идентификатору
 * @returns пакет или `undefined`
 */
export function attemptPackage<T>(
  attempt: { packageId: string | null },
  packages: ReadonlyMap<string, T>,
): T | undefined {
  return attempt.packageId ? packages.get(attempt.packageId) : undefined;
}

/**
 * Тест LMS-прохождения (PRD-54 раздел 12).
 *
 * `scorm_attempts.test_id` — источник истины: у импорта он единственный возможный, а телеметрии его
 * проставил backfill миграции 0029. Пакет остаётся ЗАПАСНЫМ путём и нужен ровно для тех старых
 * строк, чей тест уже удалён, — им backfill ничего не нашёл.
 *
 * @param attempt попытка
 * @param packages карта пакетов по идентификатору
 * @returns идентификатор теста или `null`, если его не знает ни попытка, ни пакет
 */
export function attemptTestId(
  attempt: { testId: string | null; packageId: string | null },
  packages: ReadonlyMap<string, { testId: string | null }>,
): string | null {
  return attempt.testId ?? attemptPackage(attempt, packages)?.testId ?? null;
}

/**
 * Подпись участника LMS-прохождения (PRD-54 раздел 12).
 *
 * Порядок именно такой. Связь с пользователем ЗАВОДИЛАСЬ ради того, чтобы видеть человека, поэтому
 * она перебивает всё остальное. Дальше идёт имя из LMS — оно есть у телеметрии и у импорта без
 * обезличивания. Последним — псевдоним, и печатается он ПРЕФИКСОМ: полные 64 знака в таблице
 * нечитаемы, а шести хватает, чтобы отличить участников друг от друга глазами.
 *
 * Связь на удалённого пользователя откатывается к псевдониму, а не оставляет строку без подписи.
 *
 * @param attempt попытка
 * @param users карта пользователей по идентификатору
 * @returns строка для колонки «Участник»
 */
export function attemptParticipant(
  attempt: { userId: string | null; participantKey: string | null; lmsUserName: string | null },
  users: ReadonlyMap<string, { name: string | null }>,
): string {
  if (attempt.userId) {
    const name = users.get(attempt.userId)?.name;
    if (name) return name;
  }
  if (attempt.lmsUserName) return attempt.lmsUserName;
  // PRD-54 BR-54-40: the same eight-character label an imported external account is named with.
  if (attempt.participantKey) return participantLabel(attempt.participantKey);
  return "Неизвестный участник";
}
