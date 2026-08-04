// PRD-6 retake gate — reference probe. Paste into the console of a running SCORM
// module (same session, same-origin) to read the learner's last-attempt dates.
// Confirmed WebTutor contract + field meanings: docs/references/webtutor-learning-records-api.md
(async () => {
  // Самораскрывающийся зонд: secid и cur_person_id добываются из портала на лету.
  // Ничего не хардкодим кроме конфига портала (это не сессионные id).
  const COLLECTION = '/pp/Ext5/extjs_json_collection_data.html';
  const COLLECTION_CODE = 'rostelecom_catalog_data_grid';
  const CATALOG = 'learning';

  const fetchText = async (u) => { try { const r = await fetch(u, { credentials: 'include' }); return await r.text(); } catch (e) { return ''; } };

  // Собираем HTML из доступных источников: текущий документ + типовые страницы портала.
  let bag = '';
  try { bag += document.documentElement.outerHTML || ''; } catch (e) {}
  for (const u of ['/', '/home', '/_wt/my_learnings']) bag += '\n' + await fetchText(u);

  // 1) secid — 32-hex, самораскрытие
  const secid = (bag.match(/[A-F0-9]{32}/) || [])[0] || '';
  console.log('secid:', secid || 'НЕ НАЙДЕН');

  // 2) cur_person_id — самораскрытие из HTML/Performance/фреймов
  const pids = new Set();
  let m; const re = /(?:cur_person_id|person_id)["'=:\s\/]+(\d{15,})/gi;
  while ((m = re.exec(bag)) !== null) pids.add(m[1]);
  try { performance.getEntriesByType('resource').forEach(e => { const x = e.name.match(/person_id[=:/](\d{15,})/i); if (x) pids.add(x[1]); }); } catch (e) {}
  try { let w = window, i = 0; while (w && i < 6) { const h = (() => { try { return w.location.href; } catch (e) { return ''; } })(); const x = h.match(/person_id[=:/](\d{15,})/i); if (x) pids.add(x[1]); if (w === w.parent) break; w = w.parent; i++; } } catch (e) {}
  const pidList = [...pids];
  console.log('кандидаты cur_person_id:', pidList.length ? pidList : '(не найдено — пробую и без него)');

  // 3) POST коллекции для каждого кандидата (+ вариант без person_id)
  const form = (o) => Object.keys(o).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
  const pick = (j) => !j ? [] : (j.results || j.data || j.rows || j.records || []);
  const dt = (d) => { const x = /(\d{2})\.(\d{2})\.(\d{4})/.exec(String(d || '')); return x ? +(x[3] + x[2] + x[1]) : 0; };
  const variants = pidList.length ? pidList : [''];
  const summary = [];
  let best = null;
  for (const pid of variants) {
    const parameters = 'cur_person_id=' + pid + ';sSearchWord=;sRoles=all;iCount=;sCatalogName=' + CATALOG
      + (pid ? ';query_qual= $elem/person_id = ' + pid : '');
    const body = form({ secid, limit: 500, collection_code: COLLECTION_CODE, parameters, referer_url: location.href, page: 1, start: 0 });
    try {
      const r = await fetch(COLLECTION + '?_dc=' + Date.now(), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
        body
      });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
      const recs = pick(j);
      summary.push({ person_id: pid || '(нет)', HTTP: r.status, success: j && j.success, total: j && j.total, записей: recs.length });
      if (recs.length && (!best || recs.length > best.recs.length)) best = { pid, recs, text: t, json: j };
    } catch (e) { summary.push({ person_id: pid || '(нет)', HTTP: 'ERR', ошибка: String(e).slice(0, 40) }); }
  }
  console.table(summary);

  if (!best) { console.warn('Записей не получено. secid:', secid || 'нет', '| pids:', pidList); return; }
  window.__records = best.recs;
  window.__raw = best.text;

  // 4) дата последней попытки по каждому курсу (любой исход, назначения = один курс)
  const finished = best.recs.filter(r => ['Пройден', 'Не пройден'].indexOf(String(r.state)) !== -1 && String(r.last_usage_date || '').indexOf('9999') === -1);
  const byCourse = {};
  for (const r of finished) {
    const k = String(r.name || '').replace(/\s+/g, ' ').trim();
    if (!byCourse[k] || dt(r.last_usage_date) > dt(byCourse[k].last_usage_date)) byCourse[k] = r;
  }
  const rows = Object.keys(byCourse).map(k => ({
    курс: k.slice(0, 55), статус: byCourse[k].state, последняя_попытка: byCourse[k].last_usage_date
  })).sort((a, b) => b.последняя_попытка.slice(6).localeCompare(a.последняя_попытка.slice(6)));
  console.log('%c=== ДАТА ПОСЛЕДНЕЙ ПОПЫТКИ ПО КУРСУ (любой исход) ===', 'font-weight:bold');
  console.table(rows);
  console.log('курсов с попытками:', rows.length, '| сырых записей:', best.recs.length, '| использован person_id:', best.pid || '(без)');
  console.log('%c>>> copy(window.__records) — все записи  |  copy(window.__raw) — сырой ответ', 'font-weight:bold');
})();
