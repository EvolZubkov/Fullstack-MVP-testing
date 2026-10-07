/**
 * @module server/services/sim/imported-run
 *
 * «Сценарий в ИС»: прогон, восстановленный из выгрузки отчёта LMS (PRD-54 + Э5б).
 *
 * Блок вопроса-сценария `q_<id>` несёт исход и счётчики шагами `performance`, а в `result` —
 * долю цены числом. Протокол прогона едет рядом блоками `sim_<id>_<n>` и содержит только входные
 * события (`shared/sim/protocol-codec`). Импорт повторяет их движком на сценарии вопроса
 * (`replayRun`) и получает полный результат — со сценами, подсказками и целью, — тот же, что дали
 * бы телеметрия и веб.
 *
 * Повтор принимается, только когда он приводит к тому, что сообщил пакет: тот же исход и те же
 * счётчики. Иначе сценарий в базе уже не тот, по которому шёл прогон (его правили после сборки
 * пакета), и сцены из повтора были бы чужими. Тогда сохраняются одни шаги — исход и счётчики, без
 * разбора по сценам.
 */
import { replayRun } from "@shared/sim/replay";
import { decodeProtocol } from "@shared/sim/protocol-codec";
import type { Scenario, SimResult } from "@shared/sim/contract";
import { readSimRun } from "../analytics/simulation-stats";

/** Что импорт пишет в ответ сценария. */
export interface ImportedSimAnswer {
  /** Ответ для `scorm_answers.user_answer_json`: полный результат либо строка шагов. */
  answer: SimResult | string | null;
  /** Протокол пришёл и повторился — у ответа есть сцены и карта промахов. */
  restored: boolean;
  /** Протокол пришёл, но не повторился: сценарий изменён после сборки пакета или протокол испорчен. */
  rejected: boolean;
}

/**
 * Восстановить ответ сценария из выгрузки.
 *
 * @param scenario сценарий вопроса, как он хранится сейчас; `null` — сценария нет
 * @param steps «Полученный ответ» блока вопроса — шаги `performance`
 * @param protocol закодированный протокол из блоков `sim_<id>_<n>`; `null` — не пришёл
 * @returns ответ к записи; `answer: null`, когда шаги не читаются
 */
export function importedSimAnswer(scenario: Scenario | null, steps: string, protocol: string | null): ImportedSimAnswer {
  const reported = readSimRun(steps);
  if (!reported) return { answer: null, restored: false, rejected: false };
  if (!protocol) return { answer: steps, restored: false, rejected: false };

  const decoded = scenario ? decodeProtocol(protocol) : null;
  if (!scenario || !decoded) return { answer: steps, restored: false, rejected: true };

  let replayed: SimResult;
  try {
    replayed = replayRun(scenario, { events: decoded.events }).result;
  } catch {
    return { answer: steps, restored: false, rejected: true };
  }
  // Повтор знает время последнего ввода; прогон кончается позже — длительность пишет пакет.
  if (decoded.durationMs !== null) replayed.durationMs = Math.max(replayed.durationMs, decoded.durationMs);
  const run = readSimRun(replayed);
  const same = run !== null
    && run.outcome === reported.outcome
    && (Object.keys(reported.counts) as Array<keyof typeof reported.counts>)
      .every((key) => run.counts[key] === reported.counts[key]);
  return same
    ? { answer: replayed, restored: true, rejected: false }
    : { answer: steps, restored: false, rejected: true };
}
