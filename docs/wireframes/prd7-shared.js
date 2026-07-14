/**
 * @fileoverview Wireframe link resolver.
 *
 * Intercepts clicks on inter-wireframe links and navigates to the correct
 * location regardless of whether the target file lives in
 * /docs/wireframes/ or /docs/wireframes/approved/.
 *
 * @module prd7-shared
 */

(function () {
  var BASE = '/docs/wireframes/';
  var ALT  = '/docs/wireframes/approved/';

  /**
   * Extracts a bare filename from any inter-wireframe href variant:
   *   "prd7-tests-list.html"
   *   "/docs/wireframes/prd7-tests-list.html"
   *   "/docs/wireframes/approved/prd7-tests-list.html"
   *
   * @param {string} href - Raw href attribute value.
   * @returns {string|null} Bare filename, or null if not an inter-wireframe link.
   */
  function filenameFromHref(href) {
    var s = href
      .replace(/^\/docs\/wireframes\/approved\//, '')
      .replace(/^\/docs\/wireframes\//, '');
    if (!s || s.indexOf('/') !== -1 || !/\.html$/.test(s)) return null;
    return s;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var raw = a.getAttribute('href');
    if (!raw || raw.charAt(0) === '#') return;

    var filename = filenameFromHref(raw);
    if (!filename) return;

    e.preventDefault();
    var primary   = BASE + filename;
    var secondary = ALT  + filename;

    fetch(primary, { method: 'HEAD' })
      .then(function (r) {
        window.location.href = r.ok ? primary : secondary;
      })
      .catch(function () {
        window.location.href = secondary;
      });
  }, true);
}());

/**
 * Lightweight ou-select initializer for wireframes.
 *
 * Reads options from data-ou-options="A|B|C", builds the ou-select__menu,
 * and wires toggle / selection behaviour using DS classes (is-open, is-selected).
 */
(function () {
  function initSelect(root) {
    root.querySelectorAll('.ou-select[data-ou-options]').forEach(function (sel) {
      if (sel.dataset.ouSelectInit) return;
      sel.dataset.ouSelectInit = '1';

      var opts   = sel.dataset.ouOptions.split('|');
      var trigger = sel.querySelector('.ou-select__trigger');
      var valueEl = sel.querySelector('.ou-select__value');
      var current = valueEl ? valueEl.textContent.trim() : opts[0];

      var menu = document.createElement('ul');
      menu.className = 'ou-select__menu';
      menu.setAttribute('role', 'listbox');

      opts.forEach(function (label) {
        // Non-selectable group header: a label prefixed with "## " renders as a
        // muted heading (used to group options, e.g. Темы / Шкалы). Backward
        // compatible — option sets without the prefix are unaffected.
        if (label.indexOf('## ') === 0) {
          var hdr = document.createElement('li');
          hdr.className = 'wf-opt-group';
          hdr.setAttribute('role', 'presentation');
          hdr.textContent = label.slice(3);
          menu.appendChild(hdr);
          return;
        }
        var li = document.createElement('li');
        li.className = 'ou-select__opt' + (label === current ? ' is-selected' : '');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(label === current));
        li.textContent = label;
        li.addEventListener('click', function (e) {
          e.stopPropagation();
          menu.querySelectorAll('.ou-select__opt').forEach(function (o) {
            o.classList.remove('is-selected');
            o.setAttribute('aria-selected', 'false');
          });
          li.classList.add('is-selected');
          li.setAttribute('aria-selected', 'true');
          if (valueEl) valueEl.textContent = label;
          sel.classList.remove('is-open');
        });
        menu.appendChild(li);
      });

      sel.appendChild(menu);

      trigger && trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var opening = !sel.classList.contains('is-open');
        document.querySelectorAll('.ou-select.is-open').forEach(function (s) {
          s.classList.remove('is-open');
        });
        sel.classList.toggle('is-open', opening);
      });
    });

    document.addEventListener('click', function () {
      document.querySelectorAll('.ou-select.is-open').forEach(function (s) {
        s.classList.remove('is-open');
      });
    }, { capture: false });
  }

  /* Run on initial load and after state switches (showState re-renders). */
  document.addEventListener('DOMContentLoaded', function () { initSelect(document); });
  var _orig = window.showState;
  if (typeof _orig === 'function') {
    window.showState = function () {
      _orig.apply(this, arguments);
      initSelect(document);
    };
  } else {
    /* showState defined after this script — patch via MutationObserver */
    var patchAttempts = 0;
    var patchTimer = setInterval(function () {
      if (typeof window.showState === 'function') {
        var fn = window.showState;
        window.showState = function () { fn.apply(this, arguments); initSelect(document); };
        clearInterval(patchTimer);
      } else if (++patchAttempts > 20) {
        clearInterval(patchTimer);
      }
    }, 100);
  }

  window.initOuSelects = initSelect;
}());
