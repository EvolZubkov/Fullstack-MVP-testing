/**
 * @module scripts/webtutor-probes/wt-assignment-boundary-probe
 *
 * PRD-31 probe: can the retake gate tell a NEW assignment from a NEW attempt
 * inside the current one?
 *
 * The gate (`server/scorm/template/app/eligibility/gate.js`) runs BEFORE
 * `Initialize`, where `suspend_data` is unreadable, so its only knowledge is the
 * WebTutor learning-records grid — which is keyed by course `name`, not by the
 * launch (refuted 2026-07-16, see `docs/references/webtutor-learning-records-api.md`).
 * The open question is therefore whether that limitation actually bites:
 *
 *   1. does a record flip to a FINISHED state after the FIRST attempt of a
 *      multi-attempt assignment (if so, barrier A blocks re-entry into an
 *      assignment the learner has attempts left in);
 *   2. can the learner re-enter a finished assignment at all;
 *   3. do the grid records carry any field that identifies the CURRENT
 *      assignment (a full key dump, in case the documented field list is partial);
 *   4. is the launched course frame same-origin with the portal (open risk §8 of
 *      `docs/specs/prd-6/cooldown-trusted-date.md`).
 *
 * Usage (Chrome DevTools console, learner session, same origin as the portal):
 *
 *   1. paste this file; it prints a snapshot and REMEMBERS it in localStorage;
 *   2. take one attempt of the course and finish it;
 *   3. paste the file again — the second run DIFFS against the first and shows
 *      exactly how the record changed.
 *
 * Course selection: set `window.__WT_COURSE = 'Точное название курса'` before
 * pasting. Without it the probe falls back to `TEST_DATA.title` (when run inside
 * the course frame) and otherwise reports every record.
 *
 * Read-only: GET of the portal chrome + the same POST the gate already makes. It
 * writes nothing to the LMS and does not touch the SCORM API.
 */
(async () => {
  const STORE_KEY = '__wt_boundary_probe';
  const b = (s) => ['%c' + s, 'font-weight:bold'];

  // ── 1. Launch context and frame origins (open risk §8 of the trusted-date spec)
  const frames = [];
  try {
    let w = window, i = 0;
    while (w && i < 8) {
      let href = '', origin = '';
      try { href = w.location.href; origin = w.location.origin; } catch (e) { href = '(cross-origin)'; origin = '(cross-origin)'; }
      frames.push({ уровень: i, origin, url: href.slice(0, 140) });
      if (w === w.parent) break;
      w = w.parent; i++;
    }
  } catch (e) { /* frame walk is best-effort */ }

  const childFrames = [];
  try {
    document.querySelectorAll('iframe').forEach((f) => {
      const src = f.src ? new URL(f.src, location.href) : null;
      childFrames.push({ origin: src ? src.origin : '(about:blank)', url: (f.src || '').slice(0, 140) });
    });
  } catch (e) { /* ignore */ }

  const sameOrigin = frames.concat(childFrames).every((f) => f.origin === location.origin || f.origin === '(about:blank)');

  console.log(...b('=== 1. КОНТЕКСТ ЗАПУСКА ==='));
  console.log('origin страницы:', location.origin);
  console.table(frames);
  if (childFrames.length) { console.log('вложенные фреймы:'); console.table(childFrames); }
  console.log('все фреймы того же origin:', sameOrigin ? 'ДА' : 'НЕТ — доверенная дата и весь webtutor_cooldown под вопросом');

  // ── 2. Learning records, via the SAME contract the gate uses
  let course = '';
  try { course = window.__WT_COURSE || (typeof TEST_DATA !== 'undefined' && TEST_DATA && TEST_DATA.title) || ''; } catch (e) { course = ''; }

  let chrome = '';
  try { chrome = document.documentElement.outerHTML; } catch (e) { /* ignore */ }
  if (!/[A-F0-9]{32}/.test(chrome)) {
    try { chrome += '\n' + await (await fetch('/', { credentials: 'include', cache: 'no-store' })).text(); } catch (e) { /* ignore */ }
  }
  const secid = (chrome.match(/[A-F0-9]{32}/) || [])[0] || '';

  let records = [], total = 0, httpError = '';
  if (secid) {
    const body = Object.entries({
      secid,
      limit: 500,
      collection_code: 'rostelecom_catalog_data_grid',
      parameters: 'cur_person_id=;sSearchWord=' + course + ';sRoles=all;iCount=;sCatalogName=learning',
      referer_url: location.href,
      page: 1,
      start: 0,
    }).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    try {
      const res = await fetch('/pp/Ext5/extjs_json_collection_data.html?_dc=' + Date.now(), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
        },
        body,
      });
      if (!res.ok) httpError = 'HTTP ' + res.status;
      const json = await res.json();
      records = (json && json.results) || [];
      total = (json && json.total) || records.length;
    } catch (e) { httpError = (e && e.message) || String(e); }
  }

  const mine = course ? records.filter((r) => String(r.name || '') === course) : records;

  console.log(...b('=== 2. УЧЕБНЫЕ ЗАПИСИ ==='));
  console.log('secid:', secid ? 'найден' : 'НЕ НАЙДЕН', '| курс:', course || '(все)', '| всего:', total,
    '| по курсу:', mine.length, httpError ? '| ошибка: ' + httpError : '');
  if (mine.length) {
    console.table(mine.map((r) => ({
      object_id: r.object_id || r.id,
      state: r.state,
      last_usage_date: r.last_usage_date,
      start_usage_date: r.start_usage_date,
      progress: r.progress,
    })));
    console.log(...b('--- ВСЕ поля первой записи (ищем признак текущего назначения) ---'));
    console.log(mine[0]);
    console.log('список ключей:', Object.keys(mine[0]).join(', '));
  } else {
    console.warn('Записей по курсу нет. Проверьте точное название: оно должно совпадать с заголовком теста.');
  }

  // ── 3. Diff against the previous run — the actual answer to "does the record
  //      flip to finished after the FIRST attempt".
  const snapshot = mine.map((r) => ({
    object_id: String(r.object_id || r.id || ''),
    state: r.state || '',
    last_usage_date: r.last_usage_date || '',
    progress: r.progress || '',
  }));

  let previous = null;
  try { previous = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { previous = null; }

  console.log(...b('=== 3. СРАВНЕНИЕ С ПРЕДЫДУЩИМ ПРОГОНОМ ==='));
  if (!previous) {
    console.log('Первый прогон, сравнивать не с чем. Снимок сохранён.');
    console.log('Дальше: пройдите ОДНУ попытку курса до конца, вернитесь и вставьте этот скрипт снова.');
  } else {
    const was = new Map(previous.records.map((r) => [r.object_id, r]));
    const rows = snapshot.map((r) => {
      const old = was.get(r.object_id);
      return {
        object_id: r.object_id,
        state: old ? (old.state === r.state ? r.state : old.state + ' -> ' + r.state) : '(новая запись) ' + r.state,
        дата: old ? (old.last_usage_date === r.last_usage_date ? r.last_usage_date : old.last_usage_date + ' -> ' + r.last_usage_date) : r.last_usage_date,
        прогресс: old ? (old.progress === r.progress ? r.progress : old.progress + ' -> ' + r.progress) : r.progress,
      };
    });
    console.log('предыдущий прогон:', previous.at);
    console.table(rows);
    const finished = ['Пройден', 'Не пройден'];
    const flipped = snapshot.some((r) => {
      const old = was.get(r.object_id);
      return old && !finished.includes(old.state) && finished.includes(r.state);
    });
    if (flipped) {
      console.warn('ЗАПИСЬ СТАЛА ЗАВЕРШЁННОЙ после попытки. Значит гейт (барьер A) при следующем входе ' +
        'в ЭТО ЖЕ назначение увидит завершённую запись со свежей датой и заблокирует повтор, даже если ' +
        'у учащегося остались попытки. Дефект подтверждён.');
    } else {
      console.log('Запись не перешла в завершённое состояние. Дефект в этом сценарии не воспроизводится.');
    }
  }

  try { localStorage.setItem(STORE_KEY, JSON.stringify({ at: new Date().toISOString(), records: snapshot })); } catch (e) { /* ignore */ }

  // ── 4. What the console cannot answer: manual steps.
  console.log(...b('=== 4. ПРОВЕРИТЬ РУКАМИ ==='));
  console.log('a) После завершённой попытки вернитесь в каталог: открывается ли курс повторно ' +
    '(кнопка запуска активна) или назначение закрыто?');
  console.log('b) Если открывается — запустите его и посмотрите, что показал гейт: строки [PRD-6 gate] в консоли.');
  console.log('c) Сообщите: назначено ли этому курсу более одной попытки в самой LMS.');

  window.__wtBoundary = { frames, childFrames, sameOrigin, secid: !!secid, course, total, records: mine, snapshot, previous };
  console.log(...b('>>> copy(window.__wtBoundary) — выгрузить весь результат'));
})();
