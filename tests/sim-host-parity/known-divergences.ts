/**
 * @module tests/sim-host-parity/known-divergences
 * @description «Сценарий в ИС», техдолг №4: расхождения веба и пакета, которые ЖДУТ РЕШЕНИЯ
 * ВЛАДЕЛЬЦА, — единственное место, где они перечислены.
 *
 * Здесь только то, на что нет ответа ни в плане трека, ни в спецификациях, ни в записанных решениях
 * владельца: какой хост прав, решает он. Расхождения, на которые ответ был, исправлены в коде
 * (C, Г4, B, A — см. историю ветки), а не записаны сюда.
 *
 * Как это работает. Строку расхождения, которую узнаёт правило записи, тест паритета не считает
 * провалом, но и не теряет: каждое прохождение перечисляет, какие известные расхождения в нём
 * ожидаются (`Passage.known`), и тест требует, чтобы набор совпал ТОЧНО. Новое расхождение — красный
 * тест; известное, которое исчезло (решение владельца реализовано), — тоже красный, и запись
 * отсюда надо убрать вместе с пометкой в прохождениях. Тихо спрятать расхождение так нельзя.
 */
import type { Step } from "./passages";

export type KnownId = "Г6" | "N1";

export interface KnownDivergence {
  id: KnownId;
  /** The question put to the owner, as sent (2026-10-08). */
  question: string;
  /**
   * Whether `diff` (one line of a step's differences) is this divergence. `seen` — the known
   * divergences already met earlier in the same passage: a consequence counts only after its cause.
   */
  matches(step: Step, diff: string, stepDiffs: string[], seen: ReadonlySet<KnownId>): boolean;
}

export const KNOWN_DIVERGENCES: KnownDivergence[] = [
  {
    id: "Г6",
    question:
      "После перезагрузки страницы веб показывает стартовый экран с «Продолжить», пакет сразу " +
      "открывает место, где участник остановился (хаб или вопрос). Должен ли веб тоже сразу " +
      "продолжать прогон, или пакет — показывать стартовый экран?",
    // Right after the reload: the web stands on its start screen, the package is already inside the
    // run — so the screen, the hub body and its footer all differ on that one step.
    matches: (step, diff) =>
      step.do === "reload" &&
      (/^L1 экран: веб start, /.test(diff) || diff === "L2 хаб есть только у пакета" || /^L3 подвал хаба: веб null, /.test(diff)),
  },
  {
    id: "N1",
    question:
      "Участник перезагрузил страницу посреди прогона сценария. Веб после «Продолжить» сразу " +
      "запускает сценарий заново, пакет возвращает в хаб с пунктом «Не начат». Как должно быть?",
    // Resuming after a reload that cut a scenario run: the web is back in the player, the package on
    // the hub — the screen, the hub body and its footer differ. Then, when the participant picks the
    // scenario on the package's hub, the web mounts nothing: it has been in the player since
    // «Продолжить». That last line counts as N1 only after N1 itself was seen in the passage.
    matches: (step, diff, stepDiffs, seen) =>
      (step.do === "resume" &&
        stepDiffs.includes("L1 экран: веб scenario, пакет hub") &&
        (diff === "L1 экран: веб scenario, пакет hub" ||
          diff === "L2 хаб есть только у пакета" ||
          /^L3 подвал хаба: веб null, /.test(diff))) ||
      (seen.has("N1") && step.do === "pick" && /^L5 запуск плеера: веб \[\], /.test(diff)),
  },
];

/** The known divergence a diff line belongs to, if any. */
export function knownOf(step: Step, diff: string, stepDiffs: string[], seen: ReadonlySet<KnownId>): KnownId | null {
  return KNOWN_DIVERGENCES.find((k) => k.matches(step, diff, stepDiffs, seen))?.id ?? null;
}
