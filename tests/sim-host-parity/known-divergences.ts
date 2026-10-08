/**
 * @module tests/sim-host-parity/known-divergences
 * @description «Сценарий в ИС», техдолг №4: различия веба и пакета, которые тест паритета знает
 * заранее, — единственное место, где они перечислены.
 *
 * Два статуса:
 * - `pending` — ждёт решения владельца: какой хост прав, решает он;
 * - `accepted` — принятое различие хостов: владелец решил, что хосты ведут себя по-разному
 *   намеренно, с датой и основанием.
 *
 * Расхождения, на которые ответ был в плане, спецификациях или решениях владельца, исправлены в коде
 * (A, Г4, C, B, N1 — см. историю ветки), а не записаны сюда.
 *
 * Как это работает. Строку расхождения, которую узнаёт правило записи, тест паритета не считает
 * провалом, но и не теряет: каждое прохождение перечисляет, какие известные различия в нём
 * ожидаются (`Passage.known`), и тест требует, чтобы набор совпал ТОЧНО. Новое расхождение — красный
 * тест; известное, которое исчезло, — тоже красный, и запись отсюда надо убрать вместе с пометкой в
 * прохождениях. Тихо спрятать расхождение так нельзя.
 */
import type { Step } from "./passages";

export type KnownId = "Г6" | "Г1";

export interface KnownDivergence {
  id: KnownId;
  status: "pending" | "accepted";
  /** What differs, in the owner's words of the decision. */
  summary: string;
  /** For `accepted`: when and why the owner kept the hosts different. */
  decision?: string;
  /**
   * Whether `diff` (one line of a step's differences) is this divergence. `seen` — the known
   * divergences already met earlier in the same passage: a consequence counts only after its cause.
   */
  matches(step: Step, diff: string, stepDiffs: string[], seen: ReadonlySet<KnownId>): boolean;
}

export const KNOWN_DIVERGENCES: KnownDivergence[] = [
  {
    id: "Г6",
    status: "accepted",
    summary:
      "После перезагрузки страницы веб показывает стартовый экран с «Продолжить», пакет сразу " +
      "открывает место, где участник остановился (хаб или вопрос).",
    decision:
      "Решение владельца 2026-10-08: оставить как есть. Запуск курса в LMS — уже осознанное действие " +
      "участника; стартовый экран веба несёт ещё «Начать заново» и «Мой результат».",
    // Right after the reload: the web stands on its start screen, the package is already inside the
    // run — so the screen, the hub body and its footer all differ on that one step.
    matches: (step, diff) =>
      step.do === "reload" &&
      (/^L1 экран: веб start, /.test(diff) || diff === "L2 хаб есть только у пакета" || /^L3 подвал хаба: веб null, /.test(diff)),
  },
  {
    id: "Г1",
    status: "pending",
    summary:
      "Число вопросов на карточке хаба: веб показывает, сколько вопросов темы ВЫДАНО участнику, пакет — " +
      "сколько задано в настройке раздела. Расходятся, когда банк темы меньше заданного числа (или у " +
      "темы набор вариантов разного размера). Что показывать?",
    // The hub bodies differ only in a card's question-count chip: every other part of every card —
    // status, lock, action, other chips — is the same on both hosts.
    matches: (_step, diff) => {
      if (!diff.startsWith("L2 хаб различается:")) return false;
      const lines = diff.split(/\r?\n/).slice(1).map((l) => l.trim());
      const web = lines.filter((l) => l.startsWith("веб ")).map((l) => l.slice(4));
      const pkg = lines.filter((l) => l.startsWith("пакет ")).map((l) => l.slice(6));
      const strip = (l: string) => l.replace(/\d+ вопрос[а-я]*/g, "N вопросов").trim();
      return web.length > 0 && web.length === pkg.length && web.every((w, i) => strip(w) === strip(pkg[i]));
    },
  },
];

/** The known divergence a diff line belongs to, if any. */
export function knownOf(step: Step, diff: string, stepDiffs: string[], seen: ReadonlySet<KnownId>): KnownId | null {
  return KNOWN_DIVERGENCES.find((k) => k.matches(step, diff, stepDiffs, seen))?.id ?? null;
}
