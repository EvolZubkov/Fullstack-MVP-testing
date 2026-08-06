/**
 * PRD-5 scale engine — runtime port of shared/scales/engine.ts. Plain-JS twin
 * executed inside the SCORM package (joined before resultsPage.js). Kept in
 * golden parity with the TypeScript source by tests/scale-engine-port.test.ts.
 *
 * Exposes `ScaleEngine.computeScales(scales, measurements, answers, questionTypes)`
 * returning `{ values: { [key]: ScaleResult }, errors: [] }`.
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
    return false;
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
  function rawRange(scaleMeasurements, agg, questionTypes, answers) {
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
      if (TBQType.isSingleIndexChoice(questionTypes[questionId])) {
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

  function computeScales(scales, measurements, answers, questionTypes) {
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
          if (isActive(m, answers[m.questionId], questionTypes[m.questionId])) {
            activeContribs.push(m.value * m.weight);
            activeWeights.push(m.weight);
          }
        }

        var raw = aggregate(activeContribs, scale.aggregation, activeWeights);

        var normalized = raw;
        var percent = 0;
        if (scale.normalization === 'percent') {
          var range = rawRange(scaleMeasurements, scale.aggregation, questionTypes, answers);
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
