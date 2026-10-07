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
  /** Пакет считает без бюджета — медленные выражения не запускаются (PRD-57 FR-28q). */
  var SKIP_SLOW = { skipSlow: true };


  // PRD-57 FR-24c, FR-26: исходы пропусков. Пропуск БЕЗ правил в счёт не идёт вовсе —
  // это несделанная работа автора, и участник за неё не отвечает. Незаполненный пропуск
  // не «лишний»: x считает ошибки, а не пробелы.
  function blankTallies(correct, answer) {
    var sets = (correct && Array.isArray(correct.blanks)) ? correct.blanks : [];
    var written = (answer && typeof answer === 'object' && !Array.isArray(answer)) ? answer : {};
    var c = 0;
    var x = 0;
    var total = 0;
    for (var i = 0; i < sets.length; i++) {
      var set = sets[i];
      if (!set || !Array.isArray(set.rules) || set.rules.length === 0) continue;
      total += 1;
      var value = written[set.id];
      if (typeof value !== 'string' || value.replace(/^\s+|\s+$/g, '') === '') continue;
      if (typeof TBTemplate === 'undefined' || !TBTemplate.checkRuleSet) continue;
      if (TBTemplate.checkRuleSet(set, value, undefined, SKIP_SLOW).passed) c += 1; else x += 1;
    }
    return { c: c, x: x, total: total };
  }

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
    // PRD-57 §6.5. The comparison itself is NOT reimplemented here: it arrives with the
    // shared runtime bundle (`TBTemplate`), which `server/scorm/index.ts` prepends before
    // this file, the same way `TBQType` does. A second copy would mean the author saved a
    // rule the learner was never checked against (FR-28s).
    if (typeof TBQType !== 'undefined' && TBQType.isTextEntry(type)) {
      if (typeof answer !== 'string') return 0;
      if (typeof TBTemplate === 'undefined' || !TBTemplate.checkRuleSet) return 0;
      // PRD-57 FR-28q: в пакете сравнение идёт в ОСНОВНОМ потоке, и прервать зависшее
      // выражение там нечем. Поэтому правило, которое замер при сохранении уже назвал
      // долгим, здесь не исполняется вовсе: ответ выйдет непроверенным, а не подвесит
      // вкладку участника. У веб-хоста есть настоящий бюджет, и он этот признак не читает.
      return TBTemplate.checkRuleSet(correct, answer, undefined, SKIP_SLOW).passed ? 1 : 0;
    }
    // PRD-57 FR-24: задание с пропусками верно, когда верны ВСЕ проверяемые пропуски.
    if (typeof TBQType !== 'undefined' && TBQType.hasBlanks(type)) {
      var bt = blankTallies(correct, answer);
      return (bt.total > 0 && bt.c === bt.total) ? 1 : 0;
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
    // PRD-57 FR-28aa4: единица счёта у написанного ответа — ПРАВИЛО. `c` — сколько
    // правил выполнено, поэтому ступенчатая таблица над `c` платит по точности.
    // Сравнение, как и везде, делегируется общему движку, а не повторяется здесь.
    if (typeof TBQType !== 'undefined' && TBQType.hasBlanks(type)) return blankTallies(correct, answer);
    if (typeof TBQType !== 'undefined' && TBQType.isTextEntry(type)) {
      var tRules = (correct && Array.isArray(correct.rules)) ? correct.rules : [];
      var tHits = 0;
      if (typeof answer === 'string' && typeof TBTemplate !== 'undefined' && TBTemplate.checkRuleSet) {
        var perRule = TBTemplate.checkRuleSet(correct, answer, undefined, SKIP_SLOW).perRule || [];
        for (var ti = 0; ti < perRule.length; ti++) if (perRule[ti]) tHits += 1;
      }
      var tMiss = (typeof answer === 'string' && answer !== '' && tHits === 0) ? 1 : 0;
      return { c: tHits, x: tMiss, total: tRules.length || 1 };
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

  // Index of the first tier whose predicate holds — the row that pays, since the
  // step table is priority-ordered. null when no row applies (non-tiered method,
  // unanswered question, implicit «иначе → 0»). Mirrors firstMatchingTier in the
  // TS source; the golden port test keeps the two bit-identical.
  function firstMatchingTier(input) {
    var scoring = input.scoring;
    var answer = input.answer;
    if (!scoring || scoring.kind !== 'tiered') return null;
    if (answer === null || answer === undefined) return null;
    var tiers = Array.isArray(scoring.tiers) ? scoring.tiers : [];
    var counters = countTallies(input.type, input.correct || {}, answer);
    for (var i = 0; i < tiers.length; i++) {
      if (evalPredicate(tiers[i].when, counters)) return i;
    }
    return null;
  }

  function scoreAnswer(input) {
    var type = input.type;
    var correct = input.correct || {};
    var answer = input.answer;
    var scoring = input.scoring;
    var kind = (scoring && scoring.kind) || 'exact';

    // «Сценарий в ИС»: эталона нет — долю цены даёт исход прогона за вычетом штрафов. Счёт НЕ
    // повторяется здесь: он приходит из общего бандла (`TBTemplate.simulationRatio`,
    // `shared/sim/scoring`), как сравнение текстовых ответов, — вторая копия разошлась бы.
    if (typeof TBQType !== 'undefined' && TBQType.isSimulation(type)) {
      var simRatio = (typeof TBTemplate !== 'undefined' && TBTemplate.simulationRatio)
        ? TBTemplate.simulationRatio(answer)
        : 0;
      return { score: simRatio, sMax: 1, ratio: simRatio };
    }

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
      var hit = firstMatchingTier(input);
      var tScore = hit !== null ? tiers[hit].score : 0;
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
      tierIndex: firstMatchingTier(input),
    };
  }

  return { scoreAnswer: scoreAnswer, explainAnswer: explainAnswer, isAnswered: isAnswered };
})();
