/*
 * Runtime port of shared/formula — the result-variable formula DSL (PRD-2 §4.2).
 *
 * The SCORM package ships raw, un-bundled JS (concatenated by joinJsParts in
 * server/scorm/index.ts), so this is a hand-maintained plain-JS twin of the
 * authoritative TypeScript implementation in shared/formula/. The golden corpus
 * tests/fixtures/formula-cases.json keeps the two in parity (PRD-2 §12). No eval /
 * Function: source is tokenized, parsed by recursive descent, then tree-walked.
 *
 * Exposes a global `FormulaDSL`:
 *   FormulaDSL.parse(src)            -> AST
 *   FormulaDSL.evaluate(src, ctx)    -> value (parse + walk)
 *   FormulaDSL.evaluateAst(ast, ctx) -> value (walk a cached AST)
 */
var FormulaDSL = (function () {
  "use strict";

  var ACCESSOR_PROPS = {
    topicById: ["percent", "passed", "score"],
    tag: ["percent", "score", "maxScore", "count"],
    scaleById: ["raw", "normalized", "percent", "level", "label", "hasValue"],
    sectionById: ["percent", "passed", "completed"],
  };
  var ACCESSOR_FNS = { topicById: 1, tag: 1, scaleById: 1, sectionById: 1 };
  var NULLARY_FNS = { countPassed: 1, countTopics: 1, avgPercent: 1 };
  var COUNT_FNS = { countVars: 1, countScales: 1 };
  var COMPARISONS = { "=": 1, "!=": 1, ">": 1, ">=": 1, "<": 1, "<=": 1 };
  var OPERATORS = ["!=", ">=", "<=", "=", ">", "<", "+", "-", "*", "/"];
  var PUNCT = { "(": 1, ")": 1, ",": 1, "[": 1, "]": 1, ".": 1 };

  // ─── Tokenizer ────────────────────────────────────────────────────────────
  function isDigit(ch) { return ch >= "0" && ch <= "9"; }
  function isIdentStart(ch) { return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_"; }
  function isIdentPart(ch) { return isIdentStart(ch) || isDigit(ch); }

  function tokenize(src) {
    var tokens = [], i = 0, n = src.length;
    while (i < n) {
      var ch = src[i];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
      if (isDigit(ch)) {
        var s = i;
        while (i < n && isDigit(src[i])) i++;
        if (i < n && src[i] === "." && isDigit(src[i + 1] || "")) { i++; while (i < n && isDigit(src[i])) i++; }
        tokens.push({ type: "number", value: src.slice(s, i), pos: s });
        continue;
      }
      if (ch === '"') {
        var st = i; i++; var value = "";
        while (i < n && src[i] !== '"') {
          if (src[i] === "\\" && i + 1 < n) { var nx = src[i + 1]; value += nx === "n" ? "\n" : nx; i += 2; }
          else { value += src[i]; i++; }
        }
        if (i >= n) throw new Error("Незакрытая строка");
        i++;
        tokens.push({ type: "string", value: value, pos: st });
        continue;
      }
      if (isIdentStart(ch)) {
        var s2 = i;
        while (i < n && isIdentPart(src[i])) i++;
        tokens.push({ type: "ident", value: src.slice(s2, i), pos: s2 });
        continue;
      }
      if (PUNCT[ch]) { tokens.push({ type: "punct", value: ch, pos: i }); i++; continue; }
      var op = null;
      for (var k = 0; k < OPERATORS.length; k++) {
        var o = OPERATORS[k];
        if (src.slice(i, i + o.length) === o) { op = o; break; }
      }
      if (op) { tokens.push({ type: "op", value: op, pos: i }); i += op.length; continue; }
      throw new Error("Неожиданный символ «" + ch + "»");
    }
    tokens.push({ type: "eof", value: "", pos: n });
    return tokens;
  }

  // ─── Parser (recursive descent; same precedence as shared/formula) ──────────
  function parse(src) {
    var tokens = tokenize(src);
    var pos = 0;

    function peek() { return tokens[pos]; }
    function nextTok() { return tokens[pos++]; }
    function isIdent(v) { var t = tokens[pos]; return t.type === "ident" && t.value === v; }
    function expectPunct(v) { var t = nextTok(); if (t.type !== "punct" || t.value !== v) throw new Error("Ожидалось «" + v + "»"); }
    function parseStr() { var t = nextTok(); if (t.type !== "string") throw new Error("Ожидалась строка-аргумент"); return t.value; }

    function parseOr() {
      var left = parseAnd();
      while (isIdent("OR")) { nextTok(); left = { type: "binary", op: "OR", left: left, right: parseAnd() }; }
      return left;
    }
    function parseAnd() {
      var left = parseComparison();
      while (isIdent("AND")) { nextTok(); left = { type: "binary", op: "AND", left: left, right: parseComparison() }; }
      return left;
    }
    function parseComparison() {
      var left = parseAddSub();
      var t = peek();
      if (t.type === "op" && COMPARISONS[t.value]) { nextTok(); return { type: "binary", op: t.value, left: left, right: parseAddSub() }; }
      return left;
    }
    function parseAddSub() {
      var left = parseMulDiv();
      while (peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
        var op = nextTok().value; left = { type: "binary", op: op, left: left, right: parseMulDiv() };
      }
      return left;
    }
    function parseMulDiv() {
      var left = parseUnary();
      while (peek().type === "op" && (peek().value === "*" || peek().value === "/")) {
        var op = nextTok().value; left = { type: "binary", op: op, left: left, right: parseUnary() };
      }
      return left;
    }
    function parseUnary() {
      if (isIdent("NOT")) { nextTok(); return { type: "unary", op: "NOT", operand: parseUnary() }; }
      if (peek().type === "op" && peek().value === "-") { nextTok(); return { type: "unary", op: "neg", operand: parseUnary() }; }
      return parsePrimary();
    }
    function parsePrimary() {
      var t = peek();
      if (t.type === "number") { nextTok(); return { type: "number", value: Number(t.value) }; }
      if (t.type === "string") { nextTok(); return { type: "string", value: t.value }; }
      if (t.type === "punct" && t.value === "(") { nextTok(); var e = parseOr(); expectPunct(")"); return e; }
      if (t.type === "ident") { return parseIdent(t); }
      throw new Error("Неожиданный токен «" + (t.value || "конец") + "»");
    }
    function parseIdent(t) {
      var name = t.value;
      if (name === "true" || name === "false") { nextTok(); return { type: "boolean", value: name === "true" }; }
      if (name === "IF") {
        nextTok(); expectPunct("(");
        var cond = parseOr(); expectPunct(",");
        var then = parseOr(); expectPunct(",");
        var otherwise = parseOr(); expectPunct(")");
        return { type: "if", cond: cond, then: then, otherwise: otherwise };
      }
      if (name === "percent") { nextTok(); return { type: "percent" }; }
      if (ACCESSOR_FNS[name]) {
        nextTok(); expectPunct("(");
        var arg = parseStr(); expectPunct(")"); expectPunct(".");
        var pt = nextTok();
        if (pt.type !== "ident") throw new Error("Ожидалось свойство");
        if (ACCESSOR_PROPS[name].indexOf(pt.value) < 0) throw new Error("У «" + name + "» нет свойства «" + pt.value + "»");
        return { type: "accessor", fn: name, arg: arg, prop: pt.value };
      }
      if (name === "var") { nextTok(); expectPunct("("); var vn = parseStr(); expectPunct(")"); return { type: "var", name: vn }; }
      if (NULLARY_FNS[name]) { nextTok(); expectPunct("("); expectPunct(")"); return { type: "nullary", fn: name }; }
      if (COUNT_FNS[name]) {
        nextTok(); expectPunct("("); expectPunct("[");
        var keys = [];
        if (!(peek().type === "punct" && peek().value === "]")) {
          keys.push(parseStr());
          while (peek().type === "punct" && peek().value === ",") { nextTok(); keys.push(parseStr()); }
        }
        expectPunct("]"); expectPunct(","); var level = parseStr(); expectPunct(")");
        return { type: "count", fn: name, keys: keys, level: level };
      }
      throw new Error("Неизвестный источник «" + name + "»");
    }

    var ast = parseOr();
    var end = peek();
    if (end.type !== "eof") throw new Error("Лишний токен «" + end.value + "»");
    return ast;
  }

  // ─── Evaluator ──────────────────────────────────────────────────────────────
  var DEFAULT_TOPIC = { percent: 0, passed: false, score: 0 };
  var DEFAULT_TAG = { percent: 0, score: 0, maxScore: 0, count: 0 };
  var DEFAULT_SCALE = { raw: 0, normalized: 0, percent: 0, level: "", label: "", hasValue: false };
  var DEFAULT_SECTION = { percent: 0, passed: false, completed: false };

  function toNum(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") { var x = parseFloat(v); return isNaN(x) ? 0 : x; }
    return 0;
  }
  function toBool(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v.length > 0;
    return false;
  }
  function looseEquals(a, b) {
    if (typeof a === typeof b) return a === b;
    return toNum(a) === toNum(b);
  }

  function evaluateAst(node, ctx) {
    switch (node.type) {
      case "number": case "string": case "boolean": return node.value;
      case "percent": return ctx.percent;
      case "accessor": {
        var src;
        if (node.fn === "topicById") src = ctx.topics[node.arg] || DEFAULT_TOPIC;
        else if (node.fn === "tag") src = ctx.tags[node.arg] || DEFAULT_TAG;
        else if (node.fn === "scaleById") src = ctx.scales[node.arg] || DEFAULT_SCALE;
        else src = ctx.sections[node.arg] || DEFAULT_SECTION;
        return src[node.prop];
      }
      case "var": return Object.prototype.hasOwnProperty.call(ctx.vars, node.name) ? ctx.vars[node.name] : null;
      case "nullary": {
        var topics = [];
        for (var key in ctx.topics) { if (Object.prototype.hasOwnProperty.call(ctx.topics, key)) topics.push(ctx.topics[key]); }
        if (node.fn === "countTopics") return topics.length;
        if (node.fn === "countPassed") { var c = 0; for (var j = 0; j < topics.length; j++) if (topics[j].passed) c++; return c; }
        if (!topics.length) return 0;
        var sum = 0; for (var m = 0; m < topics.length; m++) sum += topics[m].percent; return sum / topics.length;
      }
      case "count": {
        var n = 0, kk;
        if (node.fn === "countVars") {
          for (kk = 0; kk < node.keys.length; kk++) {
            var key2 = node.keys[kk];
            if (Object.prototype.hasOwnProperty.call(ctx.vars, key2) && String(ctx.vars[key2]) === node.level) n++;
          }
          return n;
        }
        for (kk = 0; kk < node.keys.length; kk++) {
          var sc = ctx.scales[node.keys[kk]];
          if (((sc && sc.level) || "") === node.level) n++;
        }
        return n;
      }
      case "if": return toBool(evaluateAst(node.cond, ctx)) ? evaluateAst(node.then, ctx) : evaluateAst(node.otherwise, ctx);
      case "unary": return node.op === "NOT" ? !toBool(evaluateAst(node.operand, ctx)) : -toNum(evaluateAst(node.operand, ctx));
      case "binary": {
        var op = node.op;
        if (op === "AND") return toBool(evaluateAst(node.left, ctx)) && toBool(evaluateAst(node.right, ctx));
        if (op === "OR") return toBool(evaluateAst(node.left, ctx)) || toBool(evaluateAst(node.right, ctx));
        var l = evaluateAst(node.left, ctx), r = evaluateAst(node.right, ctx);
        switch (op) {
          case "=": return looseEquals(l, r);
          case "!=": return !looseEquals(l, r);
          case ">": return toNum(l) > toNum(r);
          case ">=": return toNum(l) >= toNum(r);
          case "<": return toNum(l) < toNum(r);
          case "<=": return toNum(l) <= toNum(r);
          case "+": return toNum(l) + toNum(r);
          case "-": return toNum(l) - toNum(r);
          case "*": return toNum(l) * toNum(r);
          case "/": { var d = toNum(r); return d === 0 ? 0 : toNum(l) / d; }
        }
        return null;
      }
    }
    return null;
  }

  // ─── Result-variable computation (PRD-2 §5.1; A7 core) ──────────────────────
  // Twin of shared/formula computeResultVariables. Evaluates variables in
  // sort_order so a later var("earlier") resolves; collects per-variable errors
  // without aborting; derives the controls_status override. Deterministic.
  function computeResultVariables(vars, base) {
    var ordered = vars.slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
    var computed = {}, values = {}, errors = [], status = {};
    for (var i = 0; i < ordered.length; i++) {
      var v = ordered[i], value = null;
      try {
        var ctx = {};
        for (var k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) ctx[k] = base[k]; }
        ctx.vars = computed;
        value = evaluateAst(parse(v.formula), ctx);
      } catch (e) {
        errors.push({ name: v.name, message: (e && e.message) || String(e) });
        value = null;
      }
      values[v.name] = value;
      computed[v.name] = value;
      if ((v.controlsStatus === "success" || v.controlsStatus === "completion") && typeof value === "boolean") {
        status[v.controlsStatus] = value;
      }
    }
    return { values: values, errors: errors, status: status };
  }

  return {
    parse: parse,
    evaluateAst: evaluateAst,
    evaluate: function (src, ctx) { return evaluateAst(parse(src), ctx); },
    computeResultVariables: computeResultVariables,
  };
})();
