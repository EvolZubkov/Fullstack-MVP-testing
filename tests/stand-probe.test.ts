/**
 * @module tests/stand-probe
 * @description Замерный модуль пакета-зонда (PRD-57, задача #51).
 *
 * Зонд пишет в LMS заведомо неверные значения и сообщает, что она ответила. Проверять его
 * приходится придирчиво: это ЕДИНСТВЕННЫЙ инструмент, которым снимаются решения трека, и
 * ошибка в нём выглядит как свойство платформы. Главное различие, ради которого модуль и
 * существует: «отвергнуто» и «принято и молча обрезано» — РАЗНЫЕ исходы, и по коду ошибки
 * их не отличить.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "scripts/scorm/probe/probe-runner.js"), "utf8");

/** Заглушка LMS: настраиваемые пределы, коды ошибок и журнал вызовов. */
function fakeLms(options: {
  /** Обрезать значение до этой длины (как это делает часть LMS). */
  truncateTo?: number;
  /** Элементы, запись в которые отвергается с этим кодом. */
  reject?: Record<string, string>;
} = {}) {
  const store: Record<string, string> = {
    "cmi.learner_id": "learner-1",
    "cmi.entry": "ab-initio",
    "cmi._version": "1.0",
  };
  const calls: Array<{ op: string; key: string; value?: string }> = [];
  let error = "0";

  return {
    calls,
    api: {
      Initialize: () => { calls.push({ op: "init", key: "" }); return "true"; },
      Terminate: () => { calls.push({ op: "term", key: "" }); return "true"; },
      Commit: () => "true",
      GetLastError: () => error,
      GetErrorString: (code: string) => `err ${code}`,
      GetDiagnostic: () => "",
      SetValue: (key: string, value: string) => {
        calls.push({ op: "set", key, value });
        const rejection = options.reject?.[key];
        if (rejection) { error = rejection; return "false"; }
        error = "0";
        store[key] = options.truncateTo !== undefined && value.length > options.truncateTo
          ? value.slice(0, options.truncateTo)
          : value;
        return "true";
      },
      GetValue: (key: string) => {
        calls.push({ op: "get", key });
        error = key in store ? "0" : "401";
        return store[key] ?? "";
      },
    },
  };
}

/** Модуль зонда, исполненный из того же файла, который попадает в пакет. */
function runner() {
  return new Function(`${source}\n;return TBProbe;`)() as {
    run: (api: unknown, env?: unknown) => {
      environment: Record<string, unknown>;
      measurements: Array<{
        id: string;
        title: string;
        rows: Array<Record<string, unknown>>;
        verdict: string;
      }>;
    };
  };
}

describe("замер длины ответа", () => {
  const lengths = (result: ReturnType<ReturnType<typeof runner>["run"]>) =>
    result.measurements.find((m) => m.id === "length");

  it("пробует обе записи взаимодействия и все заявленные длины", () => {
    const lms = fakeLms();
    const result = runner().run(lms.api);
    const rows = lengths(result)!.rows;
    const sent = rows.map((r) => `${r.interaction}:${r.requested}`);
    for (const type of ["fill-in", "long-fill-in"]) {
      for (const length of [250, 1000, 4000, 8000, 16000, 64000]) {
        expect(sent).toContain(`${type}:${length}`);
      }
    }
  });

  it("принятое и прочитанное целиком — «принято»", () => {
    const result = runner().run(fakeLms().api);
    const row = lengths(result)!.rows.find((r) => r.requested === 4000)!;
    expect(row.error).toBe("0");
    expect(row.stored).toBe(4000);
    expect(row.outcome).toBe("принято");
  });

  it("молчаливая обрезка отличается от отказа — ради неё замер и делается", () => {
    const result = runner().run(fakeLms({ truncateTo: 4000 }).api);
    const rows = lengths(result)!.rows;
    const cut = rows.find((r) => r.requested === 8000)!;
    expect(cut.error).toBe("0");
    expect(cut.stored).toBe(4000);
    expect(cut.outcome).toBe("обрезано");

    const kept = rows.find((r) => r.requested === 1000)!;
    expect(kept.outcome).toBe("принято");
  });

  it("отказ записи назван отказом, с кодом", () => {
    const lms = fakeLms({ reject: { "cmi.interactions.0.learner_response": "406" } });
    const result = runner().run(lms.api);
    const row = lengths(result)!.rows.find((r) => r.interaction === "fill-in" && r.requested === 250)!;
    expect(row.outcome).toBe("отказ");
    expect(row.error).toBe("406");
  });

  it("вывод называет ПРЕДЕЛ, а не перечисляет строки", () => {
    const result = runner().run(fakeLms({ truncateTo: 4000 }).api);
    expect(lengths(result)!.verdict).toContain("4000");
  });

  it("строка несёт маркер конца: подмену видно, а не только длину", () => {
    const lms = fakeLms();
    runner().run(lms.api);
    const written = lms.calls.find((c) => c.op === "set" && /learner_response/.test(c.key) && (c.value ?? "").length > 200);
    expect(written?.value?.endsWith("|КОНЕЦ")).toBe(true);
  });
});

describe("замер числового взаимодействия", () => {
  it("пробует и numeric, и fill-in с тем же числом — сравнение прямое", () => {
    const result = runner().run(fakeLms().api);
    const numeric = result.measurements.find((m) => m.id === "numeric")!;
    const patterns = numeric.rows.map((r) => `${r.interaction}:${r.pattern}`);
    expect(patterns).toContain("numeric:3.14");
    expect(patterns).toContain("numeric:3.0[:]4.0");
    expect(patterns).toContain("fill-in:3.14");
  });

  it("отказ типа записывается кодом, а не молчанием", () => {
    const lms = fakeLms({ reject: { "cmi.interactions.2.type": "406" } });
    const result = runner().run(lms.api);
    const numeric = result.measurements.find((m) => m.id === "numeric")!;
    expect(numeric.rows.some((r) => r.outcome === "отказ")).toBe(true);
  });
});

describe("замер числа в исходе", () => {
  it("пробует число, запятую и контрольное «correct»", () => {
    const result = runner().run(fakeLms().api);
    const rows = result.measurements.find((m) => m.id === "result")!.rows;
    expect(rows.map((r) => r.value)).toEqual(["correct", "0.6", "0,6", "1.0"]);
  });

  it("принятое число читается обратно тем же", () => {
    const result = runner().run(fakeLms().api);
    const row = result.measurements.find((m) => m.id === "result")!.rows.find((r) => r.value === "0.6")!;
    expect(row.outcome).toBe("принято");
    expect(row.stored).toBe("0.6");
  });
});

describe("замер рабочего потока", () => {
  it("без конструктора Worker отвечает «недоступен», а не падает", () => {
    const result = runner().run(fakeLms().api, { hasWorker: false });
    const worker = result.measurements.find((m) => m.id === "worker")!;
    expect(worker.verdict).toContain("недоступен");
  });

  it("запрет политики безопасности назван причиной", () => {
    const result = runner().run(fakeLms().api, {
      hasWorker: true,
      makeWorker: () => { throw new Error("SecurityError: blocked by CSP"); },
    });
    const worker = result.measurements.find((m) => m.id === "worker")!;
    expect(worker.verdict).toContain("SecurityError");
  });
});

describe("опознание среды и завершение", () => {
  it("сообщает, что вернула LMS о себе и об участнике", () => {
    const result = runner().run(fakeLms().api);
    expect(result.environment.learnerId).toBe("learner-1");
    expect(result.environment.entry).toBe("ab-initio");
    expect(result.environment.version).toBe("1.0");
  });

  it("сессия закрывается даже когда часть записей отвергнута", () => {
    const lms = fakeLms({ reject: { "cmi.interactions.0.learner_response": "406" } });
    runner().run(lms.api);
    expect(lms.calls[0].op).toBe("init");
    expect(lms.calls[lms.calls.length - 1].op).toBe("term");
  });
});
