/**
 * @module server/services/regex-runner
 *
 * Исполнитель авторских регулярных выражений с бюджетом времени (PRD-57 FR-28q).
 *
 * Зачем он вообще: выражение пишет автор, а исполняется оно в НАШЕМ процессе. Node
 * однопоточен, и `^(\S+\s?)+ надзору$` на ответе из тридцати символов считается 27 секунд
 * (§6.4) — всё это время сервер не обслуживает никого. Прервать регулярное выражение в
 * JavaScript нельзя: единственная управа — исполнять его в потоке, который можно убить.
 *
 * Три решения, каждое со своей причиной:
 *
 *   1. **Поток ДОЛГОЖИВУЩИЙ.** Запуск потока стоит десятки миллисекунд, а попытка
 *      приносит правила пачкой. Сторож с таймером даёт ту же гарантию дешевле.
 *   2. **Задания идут ПО ОДНОМУ.** Отправив пачку, мы не узнаем, какое задание подвесило
 *      поток, и потеряли бы вердикты остальных вместе с ним.
 *   3. **Код потока — строка, а не файл.** Продакшен-сборка склеивается esbuild в один
 *      `dist/index.cjs`, и отдельного файла воркера там просто нет. `eval: true` избавляет
 *      от ветки «в разработке один путь, в сборке другой» — то есть от целого класса
 *      дефектов, которые видно только на проде.
 */
import { Worker } from "node:worker_threads";

/** Одно задание: выражение автора и ответ участника. */
export interface ExpressionJob {
  source: string;
  answer: string;
}

/** Вердикт по заданию: подошло, не подошло либо «не уложилось в бюджет». */
export type ExpressionVerdict = boolean | "budget";

/**
 * Код потока. Компилирует выражение и проверяет ответ — больше ничего, потому что всё
 * остальное можно сделать снаружи, а здесь каждая лишняя строка исполняется в месте,
 * которое мы намерены убивать.
 *
 * Флаги те же, что у общего модуля сравнения (`shared/answer-check/regex`): `i` и только
 * он. Держать их в двух местах приходится потому, что поток не видит модулей приложения;
 * расхождение поймает тест паритета.
 */
const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
parentPort.on("message", (job) => {
  let verdict = false;
  try {
    verdict = new RegExp(job.source, "i").test(job.answer);
  } catch {
    verdict = false;
  }
  parentPort.postMessage(verdict);
});
`;

let worker: Worker | null = null;

/** Поднять поток, если он ещё не поднят (или был убит по бюджету). */
function ensureWorker(): Worker {
  if (worker) return worker;
  const started = new Worker(WORKER_SOURCE, { eval: true });
  // Поток не должен держать процесс живым: он обслуживает запросы, а не наоборот.
  started.unref();
  started.on("error", () => {
    worker = null;
  });
  worker = started;
  return started;
}

/** Убить поток: он завис на выражении, и вернуть его к жизни нельзя. */
async function killWorker(): Promise<void> {
  const current = worker;
  worker = null;
  if (current) await current.terminate();
}

/**
 * Проверить ответы выражениями, уложившись в бюджет.
 *
 * @param jobs     Задания в том порядке, в каком идут правила.
 * @param budgetMs Сколько миллисекунд отводится ОДНОМУ сравнению.
 * @returns Вердикты в том же порядке; `"budget"` там, где сравнение не уложилось.
 */
export async function checkExpressions(
  jobs: readonly ExpressionJob[],
  budgetMs: number,
): Promise<ExpressionVerdict[]> {
  if (jobs.length === 0) return [];
  const verdicts: ExpressionVerdict[] = [];
  for (const job of jobs) {
    verdicts.push(await runOne(job, budgetMs));
  }
  return verdicts;
}

/** Одно задание со сторожем: не ответил вовремя — поток убит, вердикт «не уложилось». */
function runOne(job: ExpressionJob, budgetMs: number): Promise<ExpressionVerdict> {
  const current = ensureWorker();
  return new Promise<ExpressionVerdict>((resolve) => {
    let settled = false;
    const finish = (verdict: ExpressionVerdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      current.off("message", onMessage);
      current.off("error", onError);
      resolve(verdict);
    };
    const onMessage = (verdict: boolean) => finish(verdict === true);
    // Упавший поток — это не «неверно» и не «не уложилось»: сравнение не состоялось,
    // и ответ идёт тем же путём, что и превысивший бюджет.
    const onError = () => {
      worker = null;
      finish("budget");
    };
    const timer = setTimeout(() => {
      void killWorker();
      finish("budget");
    }, Math.max(1, budgetMs));

    current.on("message", onMessage);
    current.on("error", onError);
    current.postMessage(job);
  });
}

/** Погасить поток — для тестов и для остановки процесса. */
export async function shutdownRegexRunner(): Promise<void> {
  await killWorker();
}
