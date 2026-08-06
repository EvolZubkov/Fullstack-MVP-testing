function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

function createShuffleMapping(length) {
  var indices = [];
  for (var i = 0; i < length; i++) indices.push(i);
  return shuffle(indices.slice());
}

function __sameSequence(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Ranking delivery order that is guaranteed NOT to already equal the correct
// order, so an untouched arrangement can never score correct by luck (otherwise
// P = 1/N! — 50% for two items, ~17% for three). Reshuffles until it differs;
// falls back to a forced first-pair swap if the RNG is pathological. When
// correctOrder is absent/mismatched or N < 2 any shuffle is acceptable.
function createRankingOrder(length, correctOrder) {
  var order = createShuffleMapping(length);
  if (length < 2 || !Array.isArray(correctOrder) || correctOrder.length !== length) {
    return order;
  }
  var tries = 0;
  while (__sameSequence(order, correctOrder) && tries < 20) {
    order = createShuffleMapping(length);
    tries++;
  }
  if (__sameSequence(order, correctOrder)) {
    var t = order[0]; order[0] = order[1]; order[1] = t;
  }
  return order;
}

// The delivery mapping of ONE question, honouring the author's «Случайный
// порядок вариантов» switch (PRD-16 FR-41, baked as `q.shuffleAnswers`; absent
// = on, the historical default). Returns null when the question must be
// delivered in the authored order — the renderers read a missing mapping as
// identity, so «no mapping» is exactly «no shuffle».
//
// Ranking is the documented exception (FR-42): its authored order IS the answer
// key, so it is always shuffled and carries no switch in the editor.
//
// The scale is the opposite exception (PRD-26 FR-04): the order of its graduations
// runs from one pole to the other, so it is NEVER shuffled — not even when the baked
// question carries `shuffleAnswers === true` (a legacy import, or a type switched in
// the editor). Mirrors `deliversShuffledOrder` on the web host.
//
// Single seam for both seeds — generateVariant (assets/app.js) and the adaptive
// renderer — so the two can never drift apart.
function shuffleMappingFor(q) {
  var data = (q && q.data) || {};
  if (typeof TBQType !== 'undefined' && TBQType.hasFixedOptionOrder(q && q.type)) return null;
  if (q.type === 'ranking') {
    var itemCount = data.items ? data.items.length : 0;
    if (itemCount === 0) return null;
    // Guaranteed non-correct delivery order (see createRankingOrder).
    return createRankingOrder(itemCount, q.correct && q.correct.correctOrder);
  }
  if (q.shuffleAnswers === false) return null;
  if (q.type === 'single' || q.type === 'multiple') {
    var optCount = data.options ? data.options.length : 0;
    return optCount > 0 ? createShuffleMapping(optCount) : null;
  }
  if (q.type === 'matching') {
    var leftCount = data.left ? data.left.length : 0;
    var rightCount = data.right ? data.right.length : 0;
    if (leftCount > 0 && rightCount > 0) {
      return { left: createShuffleMapping(leftCount), right: createShuffleMapping(rightCount) };
    }
  }
  return null;
}
