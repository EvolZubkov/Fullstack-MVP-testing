/**
 * @module shared/lms-export/duration
 * @description Время на задании в языке обмена с LMS: запись в `cmi.interactions.n.latency` и
 * чтение обратно из колонки «Продолжительность (сек.)» отчёта.
 *
 * Стороны РАЗНЫЕ намеренно. В `cmi` уезжает длительность ISO 8601 (`PT1M35S`) — этого требует
 * SCORM 2004; в выгрузке WebTutor та же величина возвращается целыми секундами. Обе живут в
 * одном модуле по той же причине, что кодирование и разбор строки ответа в `response-codec`:
 * копии такого знания в проекте расходились дважды, и оба раза молча.
 */

/** Миллисекунды, приведённые к неотрицательному целому; мусор становится нулём. */
function safeMs(ms: number): number {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Длительность ISO 8601 для `cmi.interactions.n.latency`.
 *
 * Нулевые разряды опускаются (`PT1H` вместо `PT1H0M0S`), но пустая строка «PT» стандартом не
 * допускается, поэтому нулевая длительность пишется как `PT0S`. Отрицательное время (часы
 * ученика прыгнули назад) и мусор дают тот же `PT0S`: битая строка испортила бы всю запись
 * взаимодействия, а не только длительность.
 *
 * @param ms длительность в миллисекундах
 * @returns строка вида `PT#H#M#S`
 */
export function formatScormDuration(ms: number): string {
  const total = Math.floor(safeMs(ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  let out = "PT";
  if (hours > 0) out += `${hours}H`;
  if (minutes > 0) out += `${minutes}M`;
  if (seconds > 0 || out === "PT") out += `${seconds}S`;
  return out;
}

/**
 * Секунды из колонки «Продолжительность (сек.)» выгрузки.
 *
 * @param raw значение ячейки
 * @returns целые секунды либо `null`, если измерения нет вовсе (пустая ячейка — это не ноль:
 *   ноль означал бы «ответил мгновенно», а пусто — «пакет не измерял»)
 */
export function parseExportSeconds(raw: string): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}
