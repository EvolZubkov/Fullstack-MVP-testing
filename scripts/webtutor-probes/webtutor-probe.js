/**
 * WebTutor course-card probe (PRD-6 retake gate) — PASTE INTO THE BROWSER CONSOLE
 * on the live portal. Standalone on purpose: no bundle, no TEST_DATA, no republished
 * package. Run it from any course page or from inside a launched SCO.
 *
 * Why it exists: the gate needs the date of the LAST COMPLETED attempt, any outcome
 * (passed or failed). Today it reads `best_learn_step_success` — a marker that is
 * (a) success-only, so a failed attempt leaves no date at all, and (b) BEST-attempt,
 * not LAST: after "passed, then failed later" it still points at the older, better
 * attempt. Both make the cooldown mis-fire. Every fixture we own mirrors a PASSED
 * card, so what WebTutor exposes for a completed-but-failed attempt has never been
 * observed. This dumps the real card so we can pick a field that means "last
 * completion" (PRD-6 §3.3 `last_usage_date`) instead of guessing.
 *
 * Usage:
 *   await tbProbe()                        // resolve object_id from the page
 *   await tbProbe({ objectId: '1234567' }) // or pass it explicitly
 *   copy(window.__tbProbe.xaml)            // copy the raw card for sharing
 *
 * Reports: object_id + how it resolved, SECID, HTTP codes, every `XAML-block-*`
 * found, and every date mapped to its nearest block — the table that answers
 * "which block carries a LAST-completion date, and does it survive a failure?".
 */
(function (root) {
  "use strict";

  var CFG = {
    endpoint: "/services/ClientBridgeService",
    soapAction: "http://www.datex-soft.com/get_metadata",
    formUrl: "6691716539494374357",
    parentTemplateId: "6691717076983772556",
    coursePageUrlTemplate: "/view_doc.html?mode=course&object_id={{oid}}",
    secidPattern: "[A-F0-9]{32}",
    objectIdPatterns: ["object_id=(\\d{6,})", "_wt/course/(\\d{6,})", "cplayer2/(\\d{6,})"],
  };

  /** Same resolution order the runtime gate uses, but reports WHICH source matched. */
  function resolveObjectId(patterns) {
    function safe(get) { try { return get() || ""; } catch (e) { return "(blocked: " + e.name + ")"; } }
    var sources = [
      { name: "location.href", value: typeof location !== "undefined" ? location.href : "" },
      { name: "document.referrer", value: typeof document !== "undefined" ? document.referrer : "" },
      { name: "top.location.href", value: safe(function () { return root.top.location.href; }) },
      { name: "parent.location.href", value: safe(function () { return root.parent.location.href; }) },
    ];
    for (var i = 0; i < sources.length; i++) {
      for (var j = 0; j < patterns.length; j++) {
        var m = new RegExp(patterns[j]).exec(sources[i].value || "");
        if (m) return { oid: m[1], from: sources[i].name, pattern: patterns[j], sources: sources };
      }
    }
    return { oid: null, from: null, pattern: null, sources: sources };
  }

  function unescapeXml(s) {
    return String(s || "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&#10;/g, " ").replace(/&#9;/g, " ").replace(/&amp;/g, "&");
  }

  /** Every `XAML-block-<name>` in document order, with its offset. */
  function findBlocks(text) {
    var re = /XAML-block-([A-Za-z0-9_]+)/g, out = [], m;
    while ((m = re.exec(text)) !== null) out.push({ block: m[1], at: m.index });
    return out;
  }

  /**
   * Every date in the text, tagged with the nearest PRECEDING block and a context
   * slice. This is the payload: it shows which block owns which date, so a LAST-
   * completion field can be told apart from the best-attempt one (`best_learn_step`
   * is the BEST attempt — after "passed, then failed later" it still reports the
   * older date, which is why the marker cannot drive the cooldown).
   * Matches dd.mm.yyyy (WebTutor's usual) and ISO yyyy-mm-dd, with optional time.
   */
  function findDates(text, blocks) {
    var re = /(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{4}-\d{2}-\d{2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?)/g;
    var out = [], m;
    while ((m = re.exec(text)) !== null) {
      var owner = null;
      for (var i = 0; i < blocks.length; i++) {
        if (blocks[i].at <= m.index) owner = blocks[i]; else break;
      }
      out.push({
        date: m[1],
        nearestBlock: owner ? owner.block : "(none)",
        context: text.slice(Math.max(0, m.index - 140), m.index + 60).replace(/\s+/g, " ").trim(),
      });
    }
    return out;
  }

  /**
   * Hunt for the PRD-6 §3.3 triple — record state, progress and a last-usage date —
   * by keyword rather than by date, so a candidate field surfaces even when it holds
   * no date on this particular run. §3.3's filter needs all three: `last_usage_date`
   * alone means "last time the course was OPENED", so trusting it unguarded would
   * start a cooldown for someone who merely opened the course without attempting.
   */
  var KEYWORDS = [
    "последн", "обращен", "last_usage", "lastusage", "usage_date",
    "завершен", "завершён", "пройден", "не пройден", "провален",
    "попыт", "attempt", "статус", "state", "status", "прогресс", "progress",
    "learn_step", "дата", "date",
  ];

  function findKeywords(text) {
    var lower = text.toLowerCase(), out = [];
    KEYWORDS.forEach(function (kw) {
      var at = lower.indexOf(kw), hits = 0;
      while (at >= 0 && hits < 3) {
        out.push({
          keyword: kw,
          context: text.slice(Math.max(0, at - 100), at + 120).replace(/\s+/g, " ").trim(),
        });
        hits++;
        at = lower.indexOf(kw, at + kw.length);
      }
    });
    return out;
  }

  async function probe(opts) {
    opts = opts || {};
    var cfg = Object.assign({}, CFG, opts.config || {});
    console.group("%c[tbProbe] WebTutor course-card probe", "font-weight:bold");
    try {
      var res = resolveObjectId(cfg.objectIdPatterns);
      var oid = opts.objectId || res.oid;
      console.log("object_id:", oid || "(NOT RESOLVED)", oid && !opts.objectId ? "via " + res.from : opts.objectId ? "(passed in)" : "");
      if (!oid) {
        console.warn("object_id not resolved. Sources tried:");
        console.table(res.sources);
        console.warn('Re-run with it explicit:  await tbProbe({ objectId: "1234567" })');
        return null;
      }

      var origin = location.origin;
      var cardUrl = cfg.coursePageUrlTemplate.replace(/\{\{oid\}\}/g, oid);
      var cardRes = await fetch(cardUrl, { credentials: "include" });
      var html = await cardRes.text();
      console.log("course card:", cardUrl, "-> HTTP", cardRes.status, "(" + html.length + " bytes)");

      var secid = (new RegExp(cfg.secidPattern).exec(html) || [null])[0];
      console.log("SECID:", secid || "(NOT FOUND — cannot call get_metadata)");
      if (!secid) return { html: html };

      var ws = "PAGEURL=" + encodeURIComponent(origin + "/_wt/course/" + oid)
        + "&REQUESTURL=" + encodeURIComponent(origin + "/view_doc.html?mode=course&object_id=" + oid)
        + "&CLIENTWINDOWSIZE=1000,800&SECID=" + secid
        + "&sysparam=&parent_template_id=" + (cfg.parentTemplateId || "") + "&playerid=extjs5";
      var soap = '<?xml version="1.0" encoding="utf-8"?>'
        + '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
        + '<get_metadata xmlns="http://www.datex-soft.com/"><form_url>' + (cfg.formUrl || "") + "</form_url>"
        + "<wsparams>" + ws.replace(/&/g, "&amp;") + "</wsparams></get_metadata></soap:Body></soap:Envelope>";

      var mdRes = await fetch(cfg.endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: cfg.soapAction },
        body: soap,
      });
      var raw = await mdRes.text();
      console.log("get_metadata:", cfg.endpoint, "-> HTTP", mdRes.status, "(" + raw.length + " bytes)");

      var xaml = unescapeXml(raw);
      var blocks = findBlocks(xaml);
      var dates = findDates(xaml, blocks);

      console.log("%cBlocks found (" + blocks.length + "):", "font-weight:bold");
      console.table(blocks.map(function (b) { return { block: b.block }; }));

      console.log("%cDates found (" + dates.length + ") — which block owns which date:", "font-weight:bold");
      if (dates.length) console.table(dates);
      else console.warn("NO dates in the card. If this run was a COMPLETED-BUT-FAILED attempt, the card carries no completion date at all.");

      var keywords = findKeywords(xaml);
      console.log("%cState / progress / last-usage candidates (" + keywords.length + "):", "font-weight:bold");
      if (keywords.length) console.table(keywords);
      else console.warn("No state/progress/last-usage keywords in the card.");

      var hasSuccess = xaml.indexOf("best_learn_step_success") >= 0;
      console.log("best_learn_step_success (the marker in use today):", hasSuccess ? "present" : "ABSENT");
      console.log("%cThe question this run must answer:", "font-weight:bold",
        "is there a field meaning LAST completion (any outcome), as opposed to best_learn_step (BEST attempt)?");

      root.__tbProbe = {
        oid: oid, secid: secid, html: html, raw: raw, xaml: xaml,
        blocks: blocks, dates: dates, keywords: keywords,
      };
      console.log("%cShare this: copy(window.__tbProbe.xaml)", "font-weight:bold");
      return root.__tbProbe;
    } catch (e) {
      console.error("[tbProbe] failed:", e);
      throw e;
    } finally {
      console.groupEnd();
    }
  }

  root.tbProbe = probe;
  // Auto-run on paste. Pasting the IIFE only DEFINED tbProbe, and the extra
  // `await tbProbe()` step is easy to miss — the console then shows a cheerful
  // "ready" and nothing else, which reads like the probe ran and found nothing.
  console.log("%c[tbProbe] loaded — running now...", "font-weight:bold");
  probe().catch(function () { /* already reported by probe() */ });
})(window);
