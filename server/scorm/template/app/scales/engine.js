/**
 * PRD-5 scale engine — runtime port of shared/scales/engine.ts. Plain-JS twin
 * executed inside the SCORM package (joined before resultsPage.js). Kept in
 * golden parity with the TypeScript source by tests/scale-engine-port.test.ts.
 *
 * Exposes `ScaleEngine.computeScales(scales, measurements, answers, questionTypes, budgets)`
 * returning `{ values: { [key]: ScaleResult }, errors: [] }`. `budgets` (PRD-44) maps a
 * question id to its allocation spec and is read only by percent normalization.
 */
var ScaleEngine = (function () {
  var EMPTY_RESULT = { raw: 0, normalized: 0, percent: 0, level: '', label: '', hasValue: false };

  function isActive(m, answer, qType) {
    if (m.sourceType === 'question') return answer !== null && answer !== undefined;
    if (answer === null || answer === undefined) return false;

    if (m.sourceType === 'option') {
      var i = Number(m.sourceKey);
      if (isNaN(i)) return false;
      // A scale is answered by ONE graduation index, so its per-option contribution
      // is read exactly like single choice (PRD-26 FR-11).
      if (TBQType.isSingleIndexChoice(qType)) return answer === i;
      if (qType === 'multiple') return Array.isArray(answer) && answer.indexOf(i) !== -1;
      return false;
    }
    if (m.sourceType === 'matching_pair') {
      var lr = String(m.sourceKey).split(':');
      var left = Number(lr[0]);
      var right = Number(lr[1]);
      return typeof answer === 'object' && !Array.isArray(answer) && answer[left] === right;
    }
    if (m.sourceType === 'ranking_position') {
      var ip = String(m.sourceKey).split(':');
      var item = Number(ip[0]);
      var pos = Number(ip[1]);
      return Array.isArray(answer) && answer[pos] === item;
    }
    if (m.sourceType === 'option_allocation') {
      // PRD-44 FR-12: a statement is measured when the learner actually put points on
      // it. Zero is «considered and rejected», not a contribution.
      if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return false;
      var assigned = answer[String(Number(m.sourceKey))];
      return typeof assigned === 'number' && isFinite(assigned) && assigned !== 0;
    }
    return false;
  }

  /**
   * What ONE unit contributes for this answer — 0 when it does not fire. Every source
   * except `option_allocation` contributes the value the AUTHOR fixed; an allocation
   * contributes the amount the LEARNER assigned, scaled by the same coefficients
   * (PRD-44 FR-12/FR-13). Twin of `unitContribution` in shared/scales/engine.ts.
   */
  function unitContribution(m, answer, qType) {
    if (!isActive(m, answer, qType)) return 0;
    if (m.sourceType === 'option_allocation') {
      var assigned = answer[String(Number(m.sourceKey))] || 0;
      return assigned * m.value * m.weight;
    }
    return m.value * m.weight;
  }

  /**
   * The { min, max } ONE allocation question can contribute to ONE scale (PRD-44 FR-15).
   * Twin of `allocationExtremes` in shared/scales/engine.ts — see the reasoning there:
   * statements share a single budget, so summing their ceilings overstates the domain,
   * and the domain decides the interpretation band, not just a number.
   */
  function allocationExtremes(spec, coeffs) {
    if (!spec || spec.budget <= 0 || coeffs.length === 0) return { min: 0, max: 0 };
    var n = coeffs.length;
    var total = Math.max((spec.options || []).length, n);
    var others = total - n;
    var lo = spec.minPerOption;
    var hi = spec.maxPerOption;

    var sumMin = Math.max(n * lo, spec.budget - others * hi);
    var sumMax = Math.min(n * hi, spec.budget - others * lo);
    if (sumMax < sumMin) return { min: 0, max: 0 };

    function extreme(maximise) {
      var ordered = coeffs.slice().sort(function (a, b) { return maximise ? b - a : a - b; });
      var best = ordered[0];
      var worthSpending = maximise ? best > 0 : best < 0;
      var target = worthSpending ? sumMax : sumMin;
      var pool = target - n * lo;
      var value = ordered.reduce(function (sum, c) { return sum + c * lo; }, 0);
      for (var i = 0; i < ordered.length && pool > 0; i++) {
        var c = ordered[i];
        if (maximise ? c <= 0 : c >= 0) break;
        var take = Math.min(pool, hi - lo);
        value += c * take;
        pool -= take;
      }
      if (pool > 0) {
        for (var k = ordered.length - 1; k >= 0 && pool > 0; k--) {
          var ck = ordered[k];
          if (maximise ? ck > 0 : ck < 0) continue;
          var takeK = Math.min(pool, hi - lo);
          value += ck * takeK;
          pool -= takeK;
        }
      }
      return value;
    }

    return { min: extreme(false), max: extreme(true) };
  }

  function aggregate(contribs, agg, weights) {
    if (contribs.length === 0) return 0;
    var total = contribs.reduce(function (s, v) { return s + v; }, 0);
    switch (agg) {
      case 'sum': return total;
      case 'avg': return total / contribs.length;
      case 'weighted_avg': {
        var sw = weights.reduce(function (s, w) { return s + w; }, 0);
        return sw === 0 ? 0 : total / sw;
      }
      case 'max': return Math.max.apply(null, contribs);
      case 'min': return Math.min.apply(null, contribs);
      default: return total;
    }
  }

  // PRD-5 §5.2 minPossible / maxPossible for THIS attempt. Only DELIVERED questions
  // (those present in `answers`) bound the range — a bank question the draw did not
  // deliver contributes 0 to `raw`, so counting its extremes would push raw outside
  // [min, max] and make percent negative / >100. single: one unit fires, other
  // option = 0 -> [min(0,vals), max(0,vals)]; multiple/matching/ranking: several
  // units fire together -> sum of negative / positive units (as `raw` sums actives).
  function rawRange(scaleMeasurements, agg, questionTypes, answers, budgets) {
    var byQuestion = {};
    for (var i = 0; i < scaleMeasurements.length; i++) {
      var m = scaleMeasurements[i];
      if (!Object.prototype.hasOwnProperty.call(answers, m.questionId)) continue;
      (byQuestion[m.questionId] = byQuestion[m.questionId] || []).push(m);
    }
    var mins = [];
    var maxes = [];
    var weights = [];
    Object.keys(byQuestion).forEach(function (questionId) {
      var ms = byQuestion[questionId];
      var vals = ms.map(function (m) { return m.value * m.weight; });
      // One-index answers (single choice, scale) activate at most ONE unit of the
      // question, so the range is the extremum, not the sum.
      if (TBQType.distributesBudget(questionTypes[questionId])) {
        var extremes = allocationExtremes((budgets || {})[questionId], vals);
        mins.push(extremes.min);
        maxes.push(extremes.max);
      } else if (TBQType.isSingleIndexChoice(questionTypes[questionId])) {
        mins.push(Math.min.apply(null, [0].concat(vals)));
        maxes.push(Math.max.apply(null, [0].concat(vals)));
      } else {
        mins.push(vals.filter(function (v) { return v < 0; }).reduce(function (s, v) { return s + v; }, 0));
        maxes.push(vals.filter(function (v) { return v > 0; }).reduce(function (s, v) { return s + v; }, 0));
      }
      weights.push(ms.reduce(function (s, m) { return s + m.weight; }, 0) / ms.length);
    });
    return { min: aggregate(mins, agg, weights), max: aggregate(maxes, agg, weights) };
  }

  function applyBands(raw, bands) {
    if (!bands || bands.length === 0) return { level: '', label: '' };
    var hit = null;
    for (var i = 0; i < bands.length; i++) {
      if (raw >= bands[i].min && raw <= bands[i].max) { hit = bands[i]; break; }
    }
    if (!hit) return { level: '', label: '' };
    return { level: hit.level, label: hit.label != null ? hit.label : hit.level };
  }

  function computeScales(scales, measurements, answers, questionTypes, budgets) {
    var values = {};
    var errors = [];

    for (var i = 0; i < scales.length; i++) {
      var scale = scales[i];
      try {
        var scaleMeasurements = measurements.filter(function (m) { return m.scaleKey === scale.key; });
        if (scaleMeasurements.length === 0) {
          values[scale.key] = { raw: 0, normalized: 0, percent: 0, level: '', label: '', hasValue: false };
          continue;
        }

        var activeContribs = [];
        var activeWeights = [];
        for (var j = 0; j < scaleMeasurements.length; j++) {
          var m = scaleMeasurements[j];
          var qType = questionTypes[m.questionId];
          var answer = answers[m.questionId];
          if (isActive(m, answer, qType)) {
            activeContribs.push(unitContribution(m, answer, qType));
            activeWeights.push(m.weight);
          }
        }

        var raw = aggregate(activeContribs, scale.aggregation, activeWeights);

        var normalized = raw;
        var percent = 0;
        if (scale.normalization === 'percent') {
          var range = rawRange(scaleMeasurements, scale.aggregation, questionTypes, answers, budgets);
          var span = range.max - range.min;
          if (span > 0) {
            percent = scale.direction === 'inverse'
              ? ((range.max - raw) / span) * 100
              : ((raw - range.min) / span) * 100;
          } else {
            // PRD-5 §5.2: impossible / zero range — diagnostic, not a meaningless number.
            errors.push({ key: scale.key, message: 'percent: диапазон нормализации невозможен или нулевой' });
          }
          normalized = percent;
        }

        var band = applyBands(raw, scale.bands);
        values[scale.key] = {
          raw: raw,
          normalized: normalized,
          percent: percent,
          level: band.level,
          label: band.label,
          hasValue: activeContribs.length > 0,
        };
      } catch (e) {
        errors.push({ key: scale.key, message: e && e.message ? e.message : String(e) });
        values[scale.key] = { raw: 0, normalized: 0, percent: 0, level: '', label: '', hasValue: false };
      }
    }

    return { values: values, errors: errors };
  }

  return { computeScales: computeScales };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScaleEngine;
}
