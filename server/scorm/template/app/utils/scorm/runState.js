/**
 * @module utils/scorm/runState
 * @description PRD-36: the run-state model of the SCORM package — the codec that keeps
 * `cmi.suspend_data` inside its budget, the attempt summary builder and the migration of the
 * legacy format. Pure functions only: nothing here touches the SCORM data model, so the whole
 * module is testable from the sources (port-pattern) without a package build.
 *
 * A ROW is a homogeneous run of values whose length equals the number of delivered questions.
 * A row is stored as ONE string and its elements are addressed by POSITION — names and ids cost
 * more than the values themselves, and a UUID key alone would eat a quarter of the budget.
 *
 * Exposes the global `TBRunState`.
 */
var TBRunState = (function () {
  var STATUS_CODES = { answered: 'a', skipped: 's', unanswered: 'u' };
  var STATUS_BY_CODE = { a: 'answered', s: 'skipped', u: 'unanswered' };

  /** Base36 keeps an index one character wide up to 35 — the common case for options. */
  function b36(n) { return Number(n).toString(36); }
  function unb36(s) { return parseInt(s, 36); }

  // ── Delivery: «section.question» pairs in delivery order ──────────────────
  function encodeDelivery(positions) {
    var out = [];
    for (var i = 0; i < (positions || []).length; i++) {
      out.push(b36(positions[i].s) + '.' + b36(positions[i].q));
    }
    return out.join(',');
  }

  function decodeDelivery(row) {
    if (!row) return [];
    var parts = String(row).split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].split('.');
      if (pair.length !== 2) continue;
      var s = unb36(pair[0]);
      var q = unb36(pair[1]);
      // FR-23: a corrupted cell is an ABSENT one. Letting NaN through would address
      // `sections[NaN]` and blank the question instead of the slot.
      if (isNaN(s) || isNaN(q)) continue;
      out.push({ s: s, q: q });
    }
    return out;
  }

  // ── Answers: one element per delivered question, shape decided by its type ──
  function encodeAnswer(answer, question) {
    var type = (question && question.type) || 'single';
    if (answer === undefined || answer === null) return '';
    if (type === 'allocation') {
      // Amounts are unbounded, so they stay decimal with an explicit separator.
      var keys = Object.keys(answer).sort(function (a, b) { return Number(a) - Number(b); });
      var amounts = [];
      for (var i = 0; i < keys.length; i++) amounts.push(String(answer[keys[i]]));
      return amounts.join('.');
    }
    if (type === 'matching') {
      // Position = left item index, value = the right index it was matched to.
      var lefts = Object.keys(answer).sort(function (a, b) { return Number(a) - Number(b); });
      var pairs = [];
      for (var j = 0; j < lefts.length; j++) pairs.push(b36(lefts[j]) + b36(answer[lefts[j]]));
      return pairs.join('');
    }
    if (Object.prototype.toString.call(answer) === '[object Array]') {
      var idx = [];
      for (var k = 0; k < answer.length; k++) idx.push(b36(answer[k]));
      return idx.join('');
    }
    return b36(answer);
  }

  function decodeAnswer(cell, question) {
    var type = (question && question.type) || 'single';
    if (cell === '' || cell === undefined) return undefined;
    if (type === 'allocation') {
      var amounts = cell.split('.');
      var alloc = {};
      for (var i = 0; i < amounts.length; i++) alloc[i] = parseInt(amounts[i], 10);
      return alloc;
    }
    if (type === 'matching') {
      var map = {};
      for (var j = 0; j + 1 < cell.length; j += 2) map[unb36(cell[j])] = unb36(cell[j + 1]);
      return map;
    }
    if (type === 'multiple' || type === 'ranking') {
      var list = [];
      for (var k = 0; k < cell.length; k++) list.push(unb36(cell[k]));
      return list;
    }
    return unb36(cell);
  }

  function encodeAnswers(answers, questions) {
    var out = [];
    for (var i = 0; i < (questions || []).length; i++) {
      out.push(encodeAnswer((answers || [])[i], questions[i]));
    }
    return out.join(',');
  }

  function decodeAnswers(row, questions) {
    var cells = row === '' || row === undefined || row === null ? [] : String(row).split(',');
    var out = [];
    for (var i = 0; i < (questions || []).length; i++) {
      out.push(decodeAnswer(cells[i] === undefined ? '' : cells[i], questions[i]));
    }
    return out;
  }

  // ── Statuses (PRD-19) and option shuffling (PRD-16) ───────────────────────
  function encodeStatuses(statuses) {
    var out = '';
    for (var i = 0; i < (statuses || []).length; i++) {
      out += STATUS_CODES[statuses[i]] || 'u';
    }
    return out;
  }

  function decodeStatuses(row) {
    var out = [];
    for (var i = 0; i < (row || '').length; i++) out.push(STATUS_BY_CODE[row[i]] || 'unanswered');
    return out;
  }

  /** One permutation as a string of base36 positions. */
  function permToString(list) {
    var cell = '';
    for (var i = 0; i < (list || []).length; i++) cell += b36(list[i]);
    return cell;
  }

  function permFromString(cell) {
    var out = [];
    for (var i = 0; i < (cell || '').length; i++) out.push(unb36(cell[i]));
    return out;
  }

  /**
   * The option order the learner actually saw. Two shapes travel here: a plain permutation
   * (single / multiple / ranking) and the matching pair `{ left, right }` — the matching
   * question shuffles its two columns independently. A `~` separates the two columns; a cell
   * without it is a plain permutation, so packages that never had matching stay unchanged.
   */
  function encodeShuffle(maps) {
    var out = [];
    for (var i = 0; i < (maps || []).length; i++) {
      var m = maps[i];
      if (!m) { out.push(''); continue; }
      if (Object.prototype.toString.call(m) !== '[object Array]') {
        out.push(permToString(m.left) + '~' + permToString(m.right));
        continue;
      }
      out.push(permToString(m));
    }
    return out.join(',');
  }

  function decodeShuffle(row) {
    var cells = row === '' || row === undefined || row === null ? [] : String(row).split(',');
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i]) { out.push(null); continue; }
      if (cells[i].indexOf('~') !== -1) {
        var halves = cells[i].split('~');
        out.push({ left: permFromString(halves[0]), right: permFromString(halves[1]) });
        continue;
      }
      out.push(permFromString(cells[i]));
    }
    return out;
  }

  // ── Package fingerprint: positions are valid only inside THIS package ─────

  /** djb2 over a string (ES5-safe: no Math.imul / SubtleCrypto), as the timer anchor uses. */
  function digest(text) {
    var hash = 5381;
    for (var i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  /**
   * The fingerprint answers ONE question: does a delivery position still address the same
   * question it addressed when the state was written?
   *
   * Counting sections and questions is not enough for that. An author who REPLACES a question
   * — or reorders the bank — keeps every count intact, so a count-only fingerprint would match
   * and the stored positions would quietly point at other questions: the LMS report of a saved
   * attempt would show questions the learner never saw. So the identity of the bank goes in
   * too, as a digest over the question ids in their baked order.
   */
  function fingerprint(testData) {
    var sections = (testData && testData.sections) || [];
    var counts = [];
    var ids = [];
    for (var i = 0; i < sections.length; i++) {
      var questions = sections[i].questions || [];
      counts.push(questions.length);
      ids.push(sections[i].topicId || '');
      for (var j = 0; j < questions.length; j++) ids.push(questions[j].id || '');
    }
    var keys = ((testData && testData.breakdownKeys) || []).length;
    return sections.length + ':' + counts.join(',') + ':' + keys + ':' + digest(ids.join('|'));
  }

  function sameFingerprint(fp, testData) {
    return !!fp && fp === fingerprint(testData);
  }

  // ── Attempt summary: the ONE shape a finished attempt is stored in ────────

  /** FR-04: higher percent wins; on a tie the LATER attempt does. */
  function pickBest(current, candidate) {
    if (!current) return candidate;
    if (!candidate) return current;
    if (candidate.pc !== current.pc) return candidate.pc > current.pc ? candidate : current;
    return new Date(candidate.at) >= new Date(current.at) ? candidate : current;
  }

  function sectionIndexOf(testData, topicId) {
    var sections = (testData && testData.sections) || [];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].topicId === topicId) return i;
    }
    return -1;
  }

  function keyIndexOf(testData, key) {
    var keys = (testData && testData.breakdownKeys) || [];
    for (var i = 0; i < keys.length; i++) if (keys[i] === key) return i;
    return -1;
  }

  /** FR-18: a breakdown row shrinks to its numbers; the key text lives in TEST_DATA. */
  function packBreakdown(entries, testData) {
    var out = [];
    for (var i = 0; i < (entries || []).length; i++) {
      var e = entries[i];
      var ki = keyIndexOf(testData, e.key);
      if (ki < 0) continue;
      out.push({
        k: ki, i: e.items, a: e.answered, e: e.earned, p: e.possible,
        pp: e.percentPoints, pu: e.percentUnits,
      });
    }
    return out.length ? out : undefined;
  }

  /**
   * FR-22: the ONE place a finished attempt becomes a stored summary. Everything derivable
   * from TEST_DATA (topic name, recommendations, pass-rule text, breakdown key) is dropped:
   * the package already ships it, and a second copy is exactly what overflows the budget.
   */
  function buildSummary(results, testData, meta) {
    var topics = [];
    var trs = (results && results.topicResults) || [];
    for (var i = 0; i < trs.length; i++) {
      var t = trs[i];
      topics.push({
        s: sectionIndexOf(testData, t.topicId),
        c: t.correct, q: t.total, e: t.earnedPoints, p: t.possiblePoints,
        pc: t.percent, ok: t.passed,
        // PRD-24: the variant that gated this topic, and the threshold it resolved to —
        // the «Требуется…» label reads the latter, so dropping it would blank the label
        // of every saved attempt.
        f: (meta.deliveredForms || {})[t.topicId] || undefined,
        r: (t.resolvedPassRule && t.resolvedPassRule.value != null) ? t.resolvedPassRule.value : undefined,
        bd: packBreakdown(t.breakdown, testData),
      });
    }
    var testScope = [];
    var all = (results && results.breakdowns) || [];
    for (var j = 0; j < all.length; j++) if (all[j].scope === 'test') testScope.push(all[j]);
    return {
      n: meta.attemptNumber,
      at: meta.completedAt,
      src: meta.source,
      pc: results.percent, c: results.correct, q: results.totalQuestions,
      e: parseFloat(results.earnedPoints) || 0, p: parseFloat(results.possiblePoints) || 0,
      ok: !!results.passed,
      t: topics,
      bd: packBreakdown(testScope, testData),
      rv: (results.resultComputation && results.resultComputation.values) || {},
      sv: (results.scaleComputation && results.scaleComputation.values) || {},
    };
  }

  /** The stored best summary, whatever format version the state came in. */
  function bestOf(stateObj) {
    return (stateObj && stateObj.best) || null;
  }

  /**
   * FR-09: a stored summary as the RESULT shape every screen, the report and the LMS builder
   * already speak. Everything the summary dropped — topic name, recommendations, the pass rule,
   * the breakdown key — comes back from TEST_DATA by position. That is the whole trade: the
   * package ships the content once, the state addresses it.
   */
  function expandSummary(summary, testData) {
    if (!summary) return null;
    var keys = (testData && testData.breakdownKeys) || [];
    var sections = (testData && testData.sections) || [];
    var unpackBd = function (rows, scope) {
      var out = [];
      for (var i = 0; i < (rows || []).length; i++) {
        var r = rows[i];
        out.push({
          scope: scope, axis: 'tag', key: keys[r.k],
          items: r.i, answered: r.a, earned: r.e, possible: r.p,
          unitEarned: r.e, unitPossible: r.p,
          percentPoints: r.pp, percentUnits: r.pu,
        });
      }
      return out;
    };
    var topics = [];
    for (var i = 0; i < (summary.t || []).length; i++) {
      var t = summary.t[i];
      var section = sections[t.s] || {};
      topics.push({
        topicId: section.topicId, topicName: section.topicName,
        correct: t.c, total: t.q, earnedPoints: t.e, possiblePoints: t.p,
        percent: t.pc, passed: (t.ok === null || t.ok === undefined) ? null : !!t.ok,
        // PRD-24: the threshold that actually gated this topic back then. The rule TYPE is
        // always a percentage here: that is the only shape the «Требуется…» label prints.
        resolvedPassRule: (t.r != null) ? { type: 'percent', value: t.r } : null,
        passRule: section.topicPassRule || null,
        formId: t.f || null,
        recommendedCourses: section.recommendedCourses || [],
        recommendedEvents: section.recommendedEvents || [],
        breakdown: unpackBd(t.bd, 'section:' + section.topicId),
        groupKey: section.groupKey || null,
      });
    }
    return {
      attemptNumber: summary.n, completedAt: summary.at, completedAtSource: summary.src,
      percent: summary.pc, correct: summary.c, totalCorrect: summary.c,
      totalQuestions: summary.q,
      earnedPoints: summary.e, possiblePoints: summary.p, passed: !!summary.ok,
      topicResults: topics,
      breakdowns: unpackBd(summary.bd, 'test'),
      resultValues: summary.rv || {}, scaleValues: summary.sv || {},
      formulaErrors: summary.fe || [], scaleErrors: summary.se || [],
      // The rows travel unexpanded: only the LMS interactions builder reads them, and it
      // needs the questions themselves, not this result shape.
      d: summary.d,
    };
  }

  /** FR-06/FR-07: rows of the attempt being stored — delivery, answers, statuses. */
  function buildDetail(runtimeState) {
    if (!runtimeState || !runtimeState.flatQuestions || !runtimeState.flatQuestions.length) {
      return undefined;
    }
    var questions = [], answers = [], statuses = [];
    for (var i = 0; i < runtimeState.flatQuestions.length; i++) {
      var q = runtimeState.flatQuestions[i].question;
      questions.push(q);
      answers.push((runtimeState.answers || {})[q.id]);
      statuses.push((runtimeState.questionStatuses || {})[q.id] || 'unanswered');
    }
    return {
      dl: encodeDelivery(runtimeState.deliveryPositions || []),
      an: encodeAnswers(answers, questions),
      st: encodeStatuses(statuses),
    };
  }

  // ── Migration: format 1 (a growing attempts[] array) -> format 2 ──────────

  /** A legacy (format 1) attempt record as a format-2 summary; content is dropped. */
  function summaryFromLegacy(record, testData) {
    var topics = [];
    var trs = (record && record.topicResults) || [];
    for (var i = 0; i < trs.length; i++) {
      topics.push({
        s: sectionIndexOf(testData, trs[i].topicId),
        c: trs[i].correct, q: trs[i].total,
        e: trs[i].earnedPoints, p: trs[i].possiblePoints,
        pc: trs[i].percent, ok: trs[i].passed,
      });
    }
    return {
      n: record.attemptNumber, at: record.completedAt, src: record.completedAtSource,
      pc: record.percent, c: record.totalCorrect, q: record.totalQuestions,
      e: record.earnedPoints, p: record.possiblePoints, ok: !!record.passed,
      t: topics, rv: record.resultValues || {}, sv: record.scaleValues || {},
    };
  }

  /**
   * FR-12/FR-13: bring whatever the LMS hands back to format 2. Three inputs are possible —
   * format 2 of THIS package (pass through), format 2 of ANOTHER package (its positions
   * address other questions: keep the counter and both barriers, drop the addressed parts),
   * and format 1 (fold the attempt array into counter + best + last).
   */
  function migrate(stateObj, testData) {
    var s = stateObj || {};
    if (s.v === 2) {
      if (s.fp && !sameFingerprint(s.fp, testData)) {
        if (s.best) delete s.best.d;
        if (s.currentSession) s.currentSession = null;
        s.fp = fingerprint(testData);
      }
      return s;
    }
    var attempts = s.attempts || [];
    var best = null;
    for (var i = 0; i < attempts.length; i++) {
      best = pickBest(best, summaryFromLegacy(attempts[i], testData));
    }
    var last = attempts.length ? summaryFromLegacy(attempts[attempts.length - 1], testData) : null;
    var out = {
      v: 2,
      fp: fingerprint(testData),
      attemptsUsed: typeof s.attemptsUsed === 'number' ? s.attemptsUsed : 0,
      best: best,
      last: (best && last && best.n === last.n) ? 0 : last,
    };
    // FR-16: the barriers' own fields travel unchanged, shape and meaning both.
    if (s.timer) out.timer = s.timer;
    if (s.retake) out.retake = s.retake;
    // PRD-4: остаток времени по разделам живёт в том же состоянии, но пишется таймером,
    // а не учётом попыток. Потерять его при приведении формата значило бы подарить
    // ученику полный лимит раздела заново — молча, ровно там, где идёт секционный тест.
    if (s.sectionBudgets) out.sectionBudgets = s.sectionBudgets;
    // PRD-67: закрытые выходом разделы — тот же случай: потеря при приведении формата
    // открыла бы раздел, из которого ученик уже ушёл.
    if (s.sectionGate) out.sectionGate = s.sectionGate;
    // PRD-54 BR-54-35: метка регистрации — одна на строку отчёта LMS. Потеря при приведении
    // формата развела бы одну строку отчёта на две записи импорта.
    if (s.rk) out.rk = s.rk;
    return out;
  }

  // ── Budget: a limit that is CHECKED, not hoped for ────────────────────────

  // FR-15: 4096 is the DESIGN budget — the SCORM 1.2 limit the state is shaped to fit, and
  // what the acceptance test measures against. The budget actually ENFORCED at write time is
  // the running profile's own limit: in 2004 the LMS takes 64000, and cutting a 20-topic
  // summary down to a bare percentage there would throw away data the LMS was ready to keep.
  // A package built for the 1.2 profile (PRD-37) bakes `TEST_DATA.stateBudget` and gets the
  // tighter one.
  var DESIGN_BUDGET = 4096;
  var BUDGET = 64000;

  /** The limit enforced for THIS package: baked profile budget, else the 2004 one. */
  function budgetFor(testData) {
    var baked = testData && testData.stateBudget;
    return (typeof baked === 'number' && baked > 0) ? baked : BUDGET;
  }

  /**
   * FR-14 / §6.2: fit the state into the budget by a DECLARED order of sacrifices, never by
   * silently truncating the string. What goes first is what a learner loses least by: the LMS
   * report's per-question interactions. What never goes is what the attempt limit and both
   * eligibility barriers stand on — losing those reopens the limit and both barriers at once,
   * which is exactly the failure this whole work exists to end.
   */
  function fitToBudget(stateObj, budget) {
    var limit = budget || BUDGET;
    var s = JSON.parse(JSON.stringify(stateObj || {}));
    var sacrifices = [];
    var fits = function () { return JSON.stringify(s).length <= limit; };
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (s.best && s.best.d) { delete s.best.d; sacrifices.push('best.detail'); }
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (s.currentSession && s.currentSession.sh) {
      delete s.currentSession.sh; sacrifices.push('session.shuffle');
    }
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (s.best) {
      s.best = { n: s.best.n, at: s.best.at, src: s.best.src, pc: s.best.pc, ok: s.best.ok };
      sacrifices.push('best.summary');
    }
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (typeof s.last === 'object' && s.last) {
      s.last = { n: s.last.n, at: s.last.at, src: s.last.src, pc: s.last.pc, ok: s.last.ok };
      sacrifices.push('last.summary');
    }
    return { state: s, sacrifices: sacrifices };
  }

  /**
   * FR-24: an unreadable state is NOT an empty one. Before this the two were indistinguishable
   * — a string the LMS had truncated came back as «no state», silently reopening the attempt
   * limit, the timer anchor and both barriers.
   */
  function parseState(raw) {
    if (!raw) return { outcome: 'empty', state: { v: 2, attemptsUsed: 0 } };
    try {
      return { outcome: 'parsed', state: JSON.parse(raw) };
    } catch (e) {
      return { outcome: 'corrupt', state: { v: 2, attemptsUsed: 0 } };
    }
  }

  return {
    encodeDelivery: encodeDelivery,
    decodeDelivery: decodeDelivery,
    encodeAnswers: encodeAnswers,
    decodeAnswers: decodeAnswers,
    encodeStatuses: encodeStatuses,
    decodeStatuses: decodeStatuses,
    encodeShuffle: encodeShuffle,
    decodeShuffle: decodeShuffle,
    fingerprint: fingerprint,
    sameFingerprint: sameFingerprint,
    pickBest: pickBest,
    buildSummary: buildSummary,
    buildDetail: buildDetail,
    bestOf: bestOf,
    expandSummary: expandSummary,
    sectionIndexOf: sectionIndexOf,
    keyIndexOf: keyIndexOf,
    fitToBudget: fitToBudget,
    parseState: parseState,
    migrate: migrate,
    budgetFor: budgetFor,
    BUDGET: BUDGET,
    DESIGN_BUDGET: DESIGN_BUDGET,
  };
})();
