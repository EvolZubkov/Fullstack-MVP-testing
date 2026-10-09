/**
 * Замерный модуль пакета-зонда PRD-57 (задача #51). Plain ES5, без импортов и без DOM:
 * файл кладётся в SCO как есть и исполняется браузером LMS, а тестом — как текст.
 *
 * Зонд пишет в LMS заведомо неверные значения (строку в шестьдесят тысяч знаков, число в
 * поле исхода, эталон-диапазон) и сообщает, ЧТО ОНА ОТВЕТИЛА. Никаких выводов о продукте он
 * не делает: его дело — факты, решения принимаются в PRD-57.
 *
 * Главное различие, ради которого модуль и написан: «отвергнуто» и «принято и молча
 * обрезано» — разные исходы, и по коду ошибки их не отличить. Поэтому после каждой записи
 * идёт ЧТЕНИЕ того же элемента, а записанная строка несёт маркер конца — так видно и
 * обрезку, и подмену значения целиком.
 */
var TBProbe = (function () {
  "use strict";

  /** Длины строк ответа: рекомендованные стандартом пределы и заведомо избыточные. */
  var LENGTHS = [250, 1000, 4000, 8000, 16000, 64000];

  /** Маркер конца строки: по нему видно подмену значения, а не только его обрезку. */
  var TAIL = "|КОНЕЦ";

  /**
   * Строка ровно заданной длины, из которой видно, где её обрезали: позиция повторяется
   * каждые десять знаков, а последние символы — маркер конца.
   */
  function payload(length) {
    var body = "";
    while (body.length < length - TAIL.length) {
      body += String(body.length) + "..........".slice(0, 10);
    }
    return body.slice(0, length - TAIL.length) + TAIL;
  }

  /** Обёртка над API: каждая запись сопровождается кодом ошибки и чтением обратно. */
  function lms(api) {
    return {
      set: function (key, value) {
        var ok = String(api.SetValue(key, value));
        var error = String(api.GetLastError());
        return { ok: ok === "true" && error === "0", error: error };
      },
      get: function (key) {
        var value = String(api.GetValue(key));
        return { value: value, error: String(api.GetLastError()) };
      },
    };
  }

  /**
   * Исход одной записи словами.
   *
   * @param written Что писали.
   * @param stored Что прочитали обратно.
   * @param accepted Приняла ли LMS запись.
   */
  function outcomeOf(written, stored, accepted) {
    if (!accepted) return "отказ";
    if (stored === written) return "принято";
    if (stored.length < written.length && written.indexOf(stored.slice(0, 50)) === 0) return "обрезано";
    return "подменено";
  }

  /** Замер 1: сколько символов ответа доезжает до LMS и не режет ли она молча. */
  function measureLength(io) {
    var rows = [];
    var limits = {};
    var kinds = ["fill-in", "long-fill-in"];

    for (var k = 0; k < kinds.length; k += 1) {
      var base = "cmi.interactions." + k;
      io.set(base + ".id", "probe_len_" + k);
      io.set(base + ".type", kinds[k]);

      for (var i = 0; i < LENGTHS.length; i += 1) {
        var value = payload(LENGTHS[i]);
        var written = io.set(base + ".learner_response", value);
        var back = io.get(base + ".learner_response");
        var outcome = outcomeOf(value, back.value, written.ok);
        if (outcome === "принято") limits[kinds[k]] = LENGTHS[i];
        rows.push({
          interaction: kinds[k],
          requested: LENGTHS[i],
          error: written.error,
          stored: back.value.length,
          tail: back.value.slice(-TAIL.length) === TAIL,
          outcome: outcome,
        });
      }
    }

    var said = [];
    for (var j = 0; j < kinds.length; j += 1) {
      said.push(kinds[j] + ": " + (limits[kinds[j]] === undefined ? "ни одна длина не прошла" : "целиком принято до " + limits[kinds[j]] + " символов"));
    }
    return { id: "length", title: "Предел длины learner_response", rows: rows, verdict: said.join("; ") };
  }

  /** Замер 2: принимает ли LMS взаимодействие `numeric` и как хранит эталон-диапазон. */
  function measureNumeric(io) {
    var cases = [
      { interaction: "numeric", pattern: "3.14" },
      { interaction: "numeric", pattern: "3.0[:]4.0" },
      { interaction: "numeric", pattern: "[:]4.0" },
      { interaction: "numeric", pattern: "3.0[:]" },
      { interaction: "fill-in", pattern: "3.14" },
    ];
    var rows = [];

    for (var i = 0; i < cases.length; i += 1) {
      var base = "cmi.interactions." + (i + 2);
      io.set(base + ".id", "probe_num_" + i);
      var typed = io.set(base + ".type", cases[i].interaction);
      var written = io.set(base + ".correct_responses.0.pattern", cases[i].pattern);
      var back = io.get(base + ".correct_responses.0.pattern");
      rows.push({
        interaction: cases[i].interaction,
        pattern: cases[i].pattern,
        typeError: typed.error,
        error: written.error,
        stored: back.value,
        outcome: !typed.ok || !written.ok ? "отказ" : outcomeOf(cases[i].pattern, back.value, true),
      });
    }

    var numericOk = false;
    var rangeOk = false;
    for (var j = 0; j < rows.length; j += 1) {
      if (rows[j].interaction === "numeric" && rows[j].outcome === "принято") {
        numericOk = true;
        if (rows[j].pattern.indexOf("[:]") >= 0) rangeOk = true;
      }
    }
    return {
      id: "numeric",
      title: "Тип numeric и эталон-диапазон",
      rows: rows,
      verdict: numericOk
        ? (rangeOk ? "numeric принят, диапазон сохранён" : "numeric принят, но диапазон не сохранён")
        : "numeric не принят",
    };
  }

  /** Замер 3: принимает ли поле исхода ЧИСЛО — от этого зависит частичный балл в отчёте. */
  function measureResult(io) {
    var values = ["correct", "0.6", "0,6", "1.0"];
    var rows = [];
    var base = "cmi.interactions.7";
    io.set(base + ".id", "probe_result");
    io.set(base + ".type", "choice");

    for (var i = 0; i < values.length; i += 1) {
      var written = io.set(base + ".result", values[i]);
      var back = io.get(base + ".result");
      rows.push({
        value: values[i],
        error: written.error,
        stored: back.value,
        outcome: outcomeOf(values[i], back.value, written.ok),
      });
    }

    var numbers = 0;
    for (var j = 1; j < rows.length; j += 1) if (rows[j].outcome === "принято") numbers += 1;
    return {
      id: "result",
      title: "Число в cmi.interactions.n.result",
      rows: rows,
      verdict: numbers > 0 ? "число в исходе принимается" : "число в исходе не принимается",
    };
  }

  /**
   * Замер 4: доступен ли рабочий поток внутри SCO — от него зависит бюджет времени
   * регулярного выражения в рантайме пакета (FR-28q).
   */
  function measureWorker(env) {
    var rows = [];
    var verdict;

    if (!env.hasWorker) {
      verdict = "рабочий поток недоступен: конструктора Worker в среде нет";
      rows.push({ step: "конструктор", outcome: "нет" });
    } else {
      rows.push({ step: "конструктор", outcome: "есть" });
      try {
        var worker = env.makeWorker();
        rows.push({ step: "создание из blob-URL", outcome: "получилось" });
        if (worker && typeof worker.terminate === "function") worker.terminate();
        verdict = "рабочий поток создаётся; ответ потока проверяется на странице";
      } catch (e) {
        rows.push({ step: "создание из blob-URL", outcome: "ошибка: " + (e && e.message ? e.message : String(e)) });
        verdict = "рабочий поток запрещён: " + (e && e.message ? e.message : String(e));
      }
    }
    return { id: "worker", title: "Рабочий поток внутри SCO", rows: rows, verdict: verdict };
  }

  /**
   * Снять все замеры.
   *
   * @param api SCORM 2004 API (`API_1484_11`) — настоящий или заглушка теста.
   * @param env Среда: доступность рабочего потока и способ его создать.
   * @returns Опознание среды и по замеру на каждый вопрос задачи #51.
   */
  function run(api, env) {
    var io = lms(api);
    api.Initialize("");

    var environment = {
      initialize: String(api.GetLastError()),
      learnerId: io.get("cmi.learner_id").value,
      entry: io.get("cmi.entry").value,
      version: io.get("cmi._version").value,
      mode: io.get("cmi.mode").value,
      userAgent: env && env.userAgent ? env.userAgent : "",
      at: env && env.now ? env.now : "",
    };

    var measurements = [];
    try {
      measurements.push(measureLength(io));
      measurements.push(measureNumeric(io));
      measurements.push(measureResult(io));
      measurements.push(measureWorker(env || { hasWorker: false }));
    } finally {
      // Сессия закрывается всегда: оставленная открытой, она портит следующий запуск на
      // том же стенде — а запусков у замера ровно столько, сколько раз его согласуют.
      if (typeof api.Commit === "function") api.Commit("");
      api.Terminate("");
    }

    return { environment: environment, measurements: measurements };
  }

  return { run: run, payload: payload, LENGTHS: LENGTHS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = TBProbe;
