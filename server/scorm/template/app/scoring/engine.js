/**
 * PRD-10 scoring engine — runtime port of shared/scoring/engine.ts. Plain-JS
 * twin executed inside the SCORM package (joined before resultsPage.js). Kept in
 * golden parity with the TypeScript source by tests/scoring-engine-port.test.ts.
 *
 * Exposes `ScoringEngine.scoreAnswer({ type, correct, answer, scoring })`
 * returning `{ score, sMax, ratio }` (scoring-model §11; PRD-10 FR-01..FR-07).
 * Absent / `exact` scoring keeps the legacy 0/1 result (FR-02).
 */
var ScoringEngine = (function () {
  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function maxOf(nums) {
    return nums.reduce(function (m, v) { return v > m ? v : m; }, 0);
  }

  // Exact correctness (0 or 1) — the pre-PRD-10 checkAnswer logic.
  function exactCorrect(type, correct, answer) {
    if (answer === null || answer === undefined) return 0;

    // Single choice and a scale are both answered by ONE option index, so
    // correctness is the same comparison (mirrors shared/scoring/engine.ts).
    if (typeof TBQType !== 'undefined' ? TBQType.isSingleIndexChoice(type) : type === 'single') {
      return answer === correct.correctIndex ? 1 : 0;
    }
    if (type === 'multiple') {
      var want = Array.isArray(correct.correctIndices) ? correct.correctIndices.slice() : [];
      var got = Array.isArray(answer) ? answer.slice() : [];
      if (want.length === 0) return 0;
      if (got.length !== want.length) return 0;
      want.sort(function (a, b) { return a - b; });
      got.sort(function (a, b) { return a - b; });
      for (var i = 0; i < want.length; i++) if (want[i] !== got[i]) return 0;
      return 1;
    }
    if (type === 'matching') {
      var pairs = (answer && typeof answer === 'object' && !Array.isArray(answer)) ? answer : {};
      var wantP = Array.isArray(correct.pairs) ? correct.pairs : [];
      if (Object.keys(pairs).length !== wantP.length) return 0;
      for (var j = 0; j < wantP.length; j++) {
        if (pairs[wantP[j].left] !== wantP[j].right) return 0;
      }
      return 1;
    }
    if (type === 'ranking') {
      var order = Array.isArray(answer) ? answer : [];
      var wantO = Array.isArray(correct.correctOrder) ? correct.correctOrder : [];
      if (order.length !== wantO.length) return 0;
      for (var k = 0; k < wantO.length; k++) if (order[k] !== wantO[k]) return 0;
      return 1;
    }
    return 0;
  }

  // Compute the (c, x, total) tallies for a tiered question.
  function countTallies(type, correct, answer) {
    if (type === 'multiple') {
      var want = Array.isArray(correct.correctIndices) ? correct.correctIndices : [];
      var got = Array.isArray(answer) ? answer : [];
      var mc = 0;
      var mx = 0;
      for (var i = 0; i < got.length; i++) {
        if (want.indexOf(got[i]) !== -1) mc += 1; else mx += 1;
      }
      return { c: mc, x: mx, total: want.length };
    }
    if (type === 'matching') {
      var wantP = Array.isArray(correct.pairs) ? correct.pairs : [];
      var map = (answer && typeof answer === 'object' && !Array.isArray(answer)) ? answer : {};
      var pc = 0;
      var px = 0;
      for (var j = 0; j < wantP.length; j++) {
        var pg = map[wantP[j].left];
        if (pg === undefined || pg === null) continue;
        if (pg === wantP[j].right) pc += 1; else px += 1;
      }
      return { c: pc, x: px, total: wantP.length };
    }
    if (type === 'ranking') {
      var wantO = Array.isArray(correct.correctOrder) ? correct.correctOrder : [];
      var order = Array.isArray(answer) ? answer : [];
      var rc = 0;
      var rx = 0;
      for (var k = 0; k < wantO.length; k++) {
        var rg = order[k];
        if (rg === undefined || rg === null) continue;
        if (rg === wantO[k]) rc += 1; else rx += 1;
      }
      return { c: rc, x: rx, total: wantO.length };
    }
    // single: one correct option.
    var sc = exactCorrect('single', correct, answer);
    return { c: sc, x: (answer !== null && answer !== undefined) ? 1 - sc : 0, total: 1 };
  }

  // Evaluate a tier predicate (conjunction) against the counters.
  function evalPredicate(pred, t) {
    var all = pred.all || [];
    for (var i = 0; i < all.length; i++) {
      var cond = all[i];
      var lhs = cond.lhs === 'c' ? t.c : t.x;
      // Counter tokens (T/P/N) all resolve to the per-type total.
      var rhs = typeof cond.rhs === 'number' ? cond.rhs : t.total;
      var ok;
      switch (cond.op) {
        case '==': ok = lhs === rhs; break;
        case '>=': ok = lhs >= rhs; break;
        case '<=': ok = lhs <= rhs; break;
        case '<': ok = lhs < rhs; break;
        case '>': ok = lhs > rhs; break;
        default: ok = false;
      }
      if (!ok) return false;
    }
    return true;
  }

  function scoreAnswer(input) {
    var type = input.type;
    var correct = input.correct || {};
    var answer = input.answer;
    var scoring = input.scoring;
    var kind = (scoring && scoring.kind) || 'exact';

    if (kind === 'weighted') {
      var weights = (scoring && Array.isArray(scoring.weights)) ? scoring.weights : [];
      var wMax = (scoring && scoring.sMax) || maxOf(weights);
      var wScore = 0;
      if (typeof answer === 'number' && answer >= 0 && answer < weights.length) {
        wScore = weights[answer];
      }
      wScore = Math.max(0, wScore);
      return { score: wScore, sMax: wMax, ratio: wMax > 0 ? clamp01(wScore / wMax) : 0 };
    }

    if (kind === 'tiered') {
      var tiers = (scoring && Array.isArray(scoring.tiers)) ? scoring.tiers : [];
      var tMax = (scoring && scoring.sMax) || maxOf(tiers.map(function (t) { return t.score; }));
      var tScore = 0;
      if (answer !== null && answer !== undefined) {
        var counters = countTallies(type, correct, answer);
        for (var i = 0; i < tiers.length; i++) {
          if (evalPredicate(tiers[i].when, counters)) { tScore = tiers[i].score; break; }
        }
      }
      tScore = Math.max(0, tScore);
      return { score: tScore, sMax: tMax, ratio: tMax > 0 ? clamp01(tScore / tMax) : 0 };
    }

    // exact / absent.
    var score = exactCorrect(type, correct, answer);
    return { score: score, sMax: 1, ratio: score };
  }

  // True when `answer` carries a real selection (empty answer → 0).
  function isAnswered(type, answer) {
    if (answer === null || answer === undefined) return false;
    if (Array.isArray(answer)) return answer.length > 0;
    if (type === 'matching') return typeof answer === 'object' && Object.keys(answer).length > 0;
    return true;
  }

  // Score + the method/tallies behind it (PRD-18 «цена» note). Pure wrapper.
  function explainAnswer(input) {
    var kind = (input.scoring && input.scoring.kind) || 'exact';
    var res = scoreAnswer(input);
    var t = countTallies(input.type, input.correct || {}, input.answer);
    return {
      score: res.score, sMax: res.sMax, ratio: res.ratio, kind: kind,
      answered: isAnswered(input.type, input.answer), c: t.c, x: t.x, total: t.total,
    };
  }

  return { scoreAnswer: scoreAnswer, explainAnswer: explainAnswer, isAnswered: isAnswered };
})();
