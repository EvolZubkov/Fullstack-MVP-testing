/**
 * @module features/questions/answer-rules/measure-expression
 *
 * Замер выражения в ящике вопроса (PRD-57 FR-28o).
 *
 * Меряется В РАБОЧЕМ ПОТОКЕ браузера, и причина ровно та же, по которой поток заведён на
 * сервере: прервать регулярное выражение нельзя, а `^(\S+\s?)+ надзору$` на строке из
 * восьмидесяти символов считается секундами. Замер в основном потоке подвесил бы ящик
 * автора ровно на то время, которое он и пытается измерить.
 *
 * Поток создаётся из Blob: отдельного файла воркера у клиентской сборки нет, а один и тот
 * же путь в разработке и в сборке избавляет от целого класса дефектов, которые видны
 * только на проде.
 *
 * Без `Worker` (jsdom в тестах, старый браузер) замер идёт на месте и на УКОРОЧЕННОМ
 * наборе: это честнее, чем молча не мерить, и безопаснее, чем подвесить вкладку.
 */
import { DEFAULT_BUDGET_MS, provocations } from "@shared/answer-check";

/** Что показал замер. */
export interface Measurement {
  /** Самый долгий прогон, мс. `Infinity` — не уложился в бюджет и был убит. */
  worstMs: number;
  /** Правда, если прогон пришлось убить: выражение считается неприемлемо долго. */
  killed: boolean;
}

/** Код потока: компилирует выражение и прогоняет его по строкам, отдавая худшее время. */
const WORKER_SOURCE = `
self.onmessage = function (event) {
  var job = event.data;
  var worst = 0;
  var re;
  try {
    re = new RegExp(job.source, "i");
  } catch (e) {
    self.postMessage(0);
    return;
  }
  for (var i = 0; i < job.samples.length; i += 1) {
    var started = Date.now();
    try { re.test(job.samples[i]); } catch (e) { /* пропускаем */ }
    var spent = Date.now() - started;
    if (spent > worst) worst = spent;
  }
  self.postMessage(worst);
};
`;

/**
 * Замерить выражение на строках-провокациях.
 *
 * @param source   Выражение автора.
 * @param samples  Что прогонять; по умолчанию — набор провокаций общего модуля.
 * @param budgetMs Сколько ждать, прежде чем убить поток.
 */
export function measureExpression(
  source: string,
  samples: string[] = provocations(),
  budgetMs: number = DEFAULT_BUDGET_MS,
): Promise<Measurement> {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") {
    return Promise.resolve(measureInline(source, samples));
  }

  return new Promise<Measurement>((resolve) => {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    const worker = new Worker(url);
    let settled = false;
    const finish = (measurement: Measurement) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(measurement);
    };
    const timer = window.setTimeout(() => finish({ worstMs: Infinity, killed: true }), Math.max(1, budgetMs));
    worker.onmessage = (event: MessageEvent<number>) => finish({ worstMs: Number(event.data) || 0, killed: false });
    worker.onerror = () => finish({ worstMs: 0, killed: false });
    worker.postMessage({ source, samples });
  });
}

/**
 * Запасной замер без потока.
 *
 * Берутся только КОРОТКИЕ строки набора: длинные существуют именно затем, чтобы вскрыть
 * откат, и прогонять их там, где прогон нечем прервать, значит подвесить ящик.
 */
function measureInline(source: string, samples: string[]): Measurement {
  let compiled: RegExp;
  try {
    compiled = new RegExp(source, "i");
  } catch {
    return { worstMs: 0, killed: false };
  }
  let worst = 0;
  for (const sample of samples.slice(0, 2)) {
    const started = Date.now();
    try {
      compiled.test(sample);
    } catch {
      /* выражение не наше дело — его разбирает сам редактор */
    }
    worst = Math.max(worst, Date.now() - started);
  }
  return { worstMs: worst, killed: false };
}
