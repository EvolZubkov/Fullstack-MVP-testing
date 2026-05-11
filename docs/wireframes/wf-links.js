/**
 * @fileoverview Cross-link resolver for prd7 wireframes.
 *
 * Intercepts clicks on relative .html links and rewrites the href so that
 * navigation works correctly regardless of whether the current file lives in
 * `wireframes/` or `wireframes/approved/`.
 *
 * APPROVED list must include every filename (without extension) that has been
 * moved to the `approved/` sub-folder. Files not in the list are assumed to
 * reside in the parent `wireframes/` directory.
 *
 * @module wf-links
 */
(function () {
  /** @type {string[]} Basenames (no extension) of files in wireframes/approved/ */
  var APPROVED = [
    'prd7-tests-list',
    'prd7-tests-archive',
    'prd7-tests-delete-confirm',
    'prd7-editor-close-confirm',
    'prd7-editor-conflict'
  ];

  var inApproved = location.pathname.replace(/\\/g, '/').indexOf('/approved/') !== -1;

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href$=".html"]');
    if (!a) return;

    var href = a.getAttribute('href');
    // Ignore absolute URLs, root-relative paths, fragment-only, and paths
    // that already contain a directory separator.
    if (!href || /^(https?:|file:|\/|#)/.test(href) || href.indexOf('/') !== -1) return;

    e.preventDefault();

    var base = href.replace(/\.html$/, '');
    var isApproved = APPROVED.indexOf(base) !== -1;

    var target = href;
    if (inApproved && !isApproved) {
      target = '../' + href;
    } else if (!inApproved && isApproved) {
      target = 'approved/' + href;
    }

    location.href = target;
  });
})();
