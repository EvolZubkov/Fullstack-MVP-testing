/**
 * Time spent on each question — the package's handle on the SHARED counter.
 *
 * The counting itself lives in `shared/questions/question-time` and reaches the package
 * through the `TBTemplate` bundle (PRD-66 FR-37), so the package and the web host measure
 * «time on question» by one implementation. A per-host copy would drift, and the psychometric
 * layer puts the two sources side by side — incomparable numbers there are worse than none.
 *
 * SUM across visits, one SCO session, deliberately NOT in `cmi.suspend_data` — the reasons
 * live with the implementation.
 */
var TBQuestionTime = (typeof TBTemplate !== 'undefined' && TBTemplate.createQuestionTime)
    ? TBTemplate.createQuestionTime()
    /* The bundle is always prepended before this file; the fallback keeps a package whose
       shared runtime failed to load from throwing on every render — it then reports no
       measurement, which is what «не измерялось» already means downstream. */
    : { show: function () {}, leave: function () {}, totalMsFor: function () { return 0; },
        totals: function () { return {}; }, reset: function () {} };

if (typeof window !== 'undefined') window.TBQuestionTime = TBQuestionTime;
