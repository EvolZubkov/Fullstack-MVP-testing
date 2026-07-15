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
