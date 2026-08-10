(async () => {
  // Вариант B: достижим ли object_id курса из контекста ЗАПУЩЕННОГО SCO?
  const here = location.href;
  const isLaunched = /aicc_sid=/.test(here) || /\/webtutor\/.*\/index/i.test(here) || /aicc_sid=/.test(document.referrer);
  console.log('%cURL здесь:', 'font-weight:bold', here);
  if (!isLaunched) {
    console.warn('ВНИМАНИЕ: похоже, это НЕ фрейм запущенного курса (нет aicc_sid). Переключи контекст консоли на фрейм курса (index.html?...aicc_sid=...) и запусти снова. Инструкция ниже.');
  }

  // 1) контекст запуска: фреймы (вверх), window.name, Performance
  const frames = [], names = [];
  try {
    let w = window, i = 0;
    while (w && i < 8) {
      let u = ''; try { u = w.location.href; } catch (e) { u = '(cross-origin)'; }
      let n = ''; try { n = String(w.name || ''); } catch (e) {}
      frames.push(u); if (n) names.push('frame' + i + '.name=' + n.slice(0, 400));
      if (w === w.parent) break; w = w.parent; i++;
    }
  } catch (e) {}
  const perf = []; try { performance.getEntriesByType('resource').forEach(e => perf.push(e.name)); } catch (e) {}
  const blob = [here, document.referrer, ...frames, ...names, ...perf].join('\n');
  const aicc_sid = (blob.match(/aicc_sid=(\d+)/) || [])[1] || '';
  const launchId = (here.match(/[?&]id=([0-9a-f-]{8,})/i) || [])[1] || '';
  const ids = [...new Set((blob.match(/\d{15,20}/g) || []))];
  console.log('aicc_sid:', aicc_sid || '(нет)', '| launch id:', launchId || '(нет)');
  console.log('ФРЕЙМЫ (вверх по дереву):'); frames.forEach(f => console.log('   ', f.slice(0, 160)));
  if (names.length) { console.log('window.name:'); names.forEach(n => console.log('   ', n)); }
  console.log('все ид-кандидаты (15-20 цифр):', ids);

  // 2) коллекция (secid самораскрытием) — чтобы сопоставить ид с object_id курса
  let bag = ''; try { bag += document.documentElement.outerHTML; } catch (e) {}
  for (const u of ['/', '/home']) { try { bag += '\n' + await (await fetch(u, { credentials: 'include' })).text(); } catch (e) {} }
  const secid = (bag.match(/[A-F0-9]{32}/) || [])[0] || '';
  let recs = [];
  try {
    const body = Object.entries({ secid, limit: 500, collection_code: 'rostelecom_catalog_data_grid', parameters: 'cur_person_id=;sSearchWord=;sRoles=all;iCount=;sCatalogName=learning', referer_url: location.href, page: 1, start: 0 })
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const j = await (await fetch('/pp/Ext5/extjs_json_collection_data.html?_dc=' + Date.now(), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body })).json();
    recs = (j && j.results) || [];
  } catch (e) {}
  console.log('secid:', secid ? 'ok' : 'НЕТ', '| записей коллекции:', recs.length);

  // 3) сопоставление: какой ид из контекста запуска = object_id/id записи курса?
  const byId = {}; recs.forEach(x => { byId[String(x.object_id)] = x; byId[String(x.id)] = x; });
  const hits = ids.filter(id => byId[id]).map(id => ({ ид: id, курс: byId[id].name, статус: byId[id].state, дата: byId[id].last_usage_date }));
  console.log('%c=== ПРИВЯЗКА КОНТЕКСТА ЗАПУСКА К КУРСУ ===', 'font-weight:bold');
  if (hits.length) { console.table(hits); console.log('%c>>> ЕСТЬ: object_id курса достижим при запуске -> вариант B реализуем.', 'font-weight:bold'); }
  else console.warn('object_id курса НЕ найден среди ид контекста. Если ты ТОЧНО внутри фрейма курса — прямой привязки через URL/фреймы/window.name нет; следующий шаг — AICC-handler.');

  window.__b = { here, isLaunched, aicc_sid, launchId, frames, names, ids, recsCount: recs.length, hits };
  console.log('%c>>> copy(window.__b)', 'font-weight:bold');
})();
