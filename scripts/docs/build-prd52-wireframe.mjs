/**
 * @module scripts/docs/build-prd52-wireframe
 * @description Собирает `docs/wireframes/approved/prd52-invite-dialog.html` из
 * снимков РЕАЛЬНОГО DOM диалога «Отправить на рецензирование».
 *
 * Эскиз не рисуется заново, а приводится к реальному виду: классы, подписи и
 * порядок блоков берутся из работающего приложения, поэтому расхождению взяться
 * неоткуда. Прежняя редакция эскиза разошлась с диалогом именно потому, что её
 * рисовали руками (PRD-52 раздел 14.6).
 *
 * КАК ПЕРЕСОБРАТЬ после изменений в диалоге:
 *
 * 1. Поднять dev и открыть диалог рецензирования на своём тесте.
 * 2. На каждом состоянии выполнить в консоли и сохранить результат в
 *    `.playwright-mcp/real-<состояние>.html` (JSON-строка, как её отдаёт
 *    `JSON.stringify`): `document.querySelector('.ou-modal').outerHTML`.
 *    Состояния перечислены в {@link STATES}. Для набранного списка перед снимком
 *    положить значение поля в атрибут: `ta.setAttribute('data-wf-value', ta.value)`
 *    — в `outerHTML` значение `textarea` не попадает.
 * 3. Снять правила, которые ДС вставляет на лету, в
 *    `.playwright-mcp/real-dynamic.css.json`: пройти по `document.styleSheets`
 *    без `href` и собрать `cssText` правил с селекторами вида `.ou-tbl-cell-1a2b3c`.
 * 4. `node scripts/docs/build-prd52-wireframe.mjs` из корня репозитория.
 */
import fs from "node:fs";

const STATES = [
  { id: "invited", nav: "приглашены", file: "real-invited.html" },
  { id: "users", nav: "пользователи", file: "real-users.html" },
  { id: "bulk", nav: "списком", file: "real-bulk.html" },
  { id: "bulk-typed", nav: "списком: набран", file: "real-bulk-typed.html" },
  { id: "preview", nav: "предпросмотр", file: "real-preview.html" },
  { id: "report", nav: "отчёт рассылки", file: "real-report.html" },
];

/** React раздаёт одинаковые id во всех снимках — разводим их по состояниям. */
function scopeIds(html, suffix) {
  const ids = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  let out = html;
  for (const id of ids) {
    const next = `${id}-${suffix}`;
    out = out.split(`"${id}"`).join(`"${next}"`);
  }
  return out;
}

/**
 * Данные прогона приёмки заменяются демонстрационными: эскиз показывает УСТРОЙСТВО
 * экрана, и адреса вида `prd52.expert.*` читались бы как забытый мусор фикстур.
 */
const DEMO = [
  ["Приёмка PRD-52: список рецензентов", "Сертификационный тест для руководителей"],
  ["prd52.expert.named@example.com", "i.petrova@example.com"],
  ["prd52.expert.plain@example.com", "s.kovalev@example.com"],
  ["prd52.book.one@example.com", "o.lebedev@example.com"],
  ["prd52.book.two@example.com", "e.rogova@example.com"],
  ["prd52.expert.quoted@example.com", "p.ivanov@example.com"],
  ["prd52.expert.semi@example.com", "m.sidorova@example.com"],
  ["prd52.wf.one@example.com", "i.petrova@example.com"],
  ["prd52.report.one@example.com", "a.sokolova@example.com"],
  ["prd52.report.two@example.com", "e.rogova@example.com"],
  ["prd52.wf.two@example.com", "s.kovalev@example.com"],
  ["broken.example.com", "ivanov.example.com"],
];

function demoData(html) {
  const named = DEMO.reduce((acc, [from, to]) => acc.split(from).join(to), html);
  // Идентификаторы строк тянутся из dev-базы; эскизу они не нужны и читаются
  // как мусор прогона.
  return named.replace(
    /data-testid="revoke-reviewer-[0-9a-f-]+"/g,
    'data-testid="revoke-reviewer"',
  );
}

/** Значение textarea в outerHTML не попадает — возвращаем его содержимым тега. */
function restoreTextarea(html) {
  return html.replace(
    /<textarea([^>]*?)data-wf-value="([^"]*)"([^>]*)><\/textarea>/g,
    (_all, before, value, after) =>
      `<textarea${before}${after}>${value.replace(/&quot;/g, '"')}</textarea>`,
  );
}

const stage = STATES.map((s, i) => {
  const html = demoData(
    restoreTextarea(
      scopeIds(JSON.parse(fs.readFileSync(`.playwright-mcp/${s.file}`, "utf8")), s.id),
    ),
  );
  return `      <div class="wf-state${i === 0 ? " active" : ""}" id="wf-${s.id}">
        <div class="ou-modal-root" role="dialog" aria-modal="true">
          <div class="ou-modal__backdrop"></div>
          ${html}
        </div>
      </div>`;
}).join("\n\n");

/**
 * Правила, которые ДС вставляет НА ЛЕТУ (ширины и выравнивание колонок таблицы —
 * `cssStyleClass`). В outerHTML остаются только их имена классов, поэтому без
 * этих строк эскиз потерял бы ширины колонок, хотя разметка была бы верной.
 */
const runtimeCss = JSON.parse(fs.readFileSync(".playwright-mcp/real-dynamic.css.json", "utf8"))
  .split("\n")
  .filter((rule) => {
    const cls = /^\.([^\s{]+)/.exec(rule)?.[1];
    return cls && /-(sx|cell)-/.test(cls) && stage.includes(cls);
  })
  .join("\n      ");

const nav = STATES.map(
  (s, i) =>
    `      <button type="button"${i === 0 ? ' class="active"' : ""} onclick="showState(this, '${s.id}')">${s.nav}</button>`,
).join("\n");

const page = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!--
    Wireframe: PRD-52 — диалог «Отправить на рецензирование» (приглашение рецензентов).
    Спека: docs/specs/prd-52/test-review.md (разделы 3.3 и 14), PRD-28 раздел 16.

    РЕДАКЦИЯ 2026-09-10. Холст собран из СНИМКОВ РЕАЛЬНОГО DOM работающего диалога
    (скрипт сборки — в отчёте приёмки), поэтому классы, подписи и порядок блоков
    совпадают с приложением дословно. Предыдущая редакция расходилась с ним: не
    показывала ни срока ссылки, ни кнопки «Проверить список», а действие держала в
    подвале, которого у диалога нет.

    Что изменилось в самом диалоге этой редакцией: вкладка «Списком из файла» стала
    «Списком» и приняла набранный вручную список; из режима рецензирования убраны
    поля назначения — «Срок выполнения» и «Создать группу из списка», — которых
    приглашение рецензента не отправляет.

    Состояния — кнопки навбара (адресуемы через ?state=<id>).
    -->
    <title>PRD-52 — Отправить на рецензирование</title>
    <!-- Дизайн-система берётся ОТТУДА ЖЕ, откуда её берёт приложение: копия в
         docs/wireframes/ds отстала (нет раскладочных правил ou-stack), и на ней
         снимок реального DOM разъезжается по отступам и выравниванию. -->
    <link rel="stylesheet" href="/docs/wireframes/prd7-shared.css" />
    <link rel="stylesheet" href="/client/src/styles/vendor/skillum-ds.css" />
    <link rel="stylesheet" href="/client/src/styles/tb-components.css" />
    <style data-wf-runtime>
      /* Ширины колонок таблиц: в приложении их вставляет сам компонент Table
         (cssStyleClass), и в снимке DOM остались бы одни имена классов. */
      ${runtimeCss}
    </style>
    <style data-wf-template-overrides>
      :root { --wf-nav-offset: 92px; }
      .wf-nav {
        position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
        display: flex; align-items: center; gap: var(--ou-space-2);
        padding: var(--ou-space-2) var(--ou-space-4);
        background: var(--ou-bg-elevated);
        border-bottom: var(--wf-border-w) solid var(--ou-border-soft);
        box-shadow: var(--ou-shadow-xs); color: var(--ou-fg-default); flex-wrap: wrap;
      }
      .wf-nav-title { font: var(--ou-text-body-s); font-weight: 600; color: var(--ou-fg-muted); margin-right: var(--ou-space-2); white-space: nowrap; }
      .wf-nav button {
        padding: var(--ou-space-1) var(--ou-space-3);
        border: var(--wf-border-w) solid var(--ou-border-default);
        border-radius: var(--ou-radius-s); background: transparent;
        color: var(--ou-fg-default); font: var(--ou-text-body-s); cursor: pointer;
      }
      .wf-nav button:hover { background: var(--ou-bg-hover); }
      .wf-nav button.active { background: var(--ou-accent-default); color: var(--ou-fg-on-accent); border-color: var(--ou-accent-default); }
      .wf-nav-sep { width: var(--wf-border-w); height: var(--ou-space-5); background: var(--ou-border-soft); margin: 0 var(--ou-space-2); }
      .wf-stage { padding: var(--wf-nav-offset) var(--ou-space-6) var(--ou-space-10); }
      .wf-state { display: none; }
      .wf-state.active { display: block; }
      .wf-doc { padding: 0 var(--ou-space-6) var(--ou-space-10); max-width: var(--wf-size-960, 960px); margin: 0 auto; }
      /* Модал в состоянии: под навбаром, скролл только в теле (канон prd18). */
      .wf-state > .ou-modal-root { top: var(--wf-nav-offset); place-items: start center; }
      .wf-state > .ou-modal-root .ou-modal { max-height: calc(100vh - var(--wf-nav-offset) - var(--ou-space-8)); }
    </style>
  </head>
  <body class="ou ou--light ou--normal">
    <nav class="wf-nav" aria-label="Переключатель состояний эскиза">
      <span class="wf-nav-title">Отправка на рецензирование:</span>
${nav}
      <span class="wf-nav-sep"></span>
      <button type="button" onclick="showState(this, 'docs')">Пояснения</button>
      <span class="wf-nav-sep"></span>
      <button type="button" onclick="toggleTheme(this)">Dark</button>
      <button type="button" onclick="toggleDensity(this)">Compact</button>
    </nav>

    <div class="wf-stage">
${stage}

      <!-- ░░░ ПОЯСНЕНИЯ ░░░ -->
      <div class="wf-state" id="wf-docs">
        <div class="wf-doc">
          <h2 class="wf-mapping-title">Пояснения к эскизу</h2>

          <h3 class="wf-notes-title">Откуда взят холст</h3>
          <ul>
            <li>Состояния — снимки реального DOM диалога, а не перерисовка. Если приложение изменится,
              эскиз надо пересобрать тем же способом, иначе он снова начнёт врать.</li>
            <li>Диалог тот же, что у назначения теста: модал <code>ou-modal--xl</code>, вкладки-сегменты,
              подвал с одной кнопкой «Отмена». Действие вкладки живёт ВНУТРИ панели.</li>
          </ul>

          <h3 class="wf-notes-title">Чем режим рецензирования отличается от назначения</h3>
          <ul>
            <li>Первая вкладка — «Приглашены (N)»: рецензент, вид доступа, число комментариев, «Отозвать».</li>
            <li>Полей назначения нет: ни «Срок выполнения», ни «Создать группу из списка» — приглашение
              рецензента отправляет только срок жизни ссылки. Остаётся «Ссылка активна до».</li>
            <li>Отчёт считает «Приглашено», а не «Назначено», и возвращает «К приглашённым».</li>
          </ul>

          <h3 class="wf-notes-title">Вкладка «Списком» (PRD-28 раздел 16)</h3>
          <ul>
            <li>Две половины — альтернативы: набранный список адресов и книга. Заполненная гасит вторую
              (состояние «списком: набран»), вместе с зоной книги гаснет и ссылка на шаблон.</li>
            <li>Запись «Имя &lt;адрес&gt;» задаёт имя рецензента — им и подписываются его комментарии;
              у голого адреса подписью служит сам адрес.</li>
            <li>Кнопка «Проверить список» мертва, пока не задан ни один источник. Разбор — по ней, а не по
              факту ввода: нераспознанная запись должна попасть в предпросмотр строкой с ошибкой.</li>
            <li>Счётчик предпросмотра называет источник: «N записей списка» либо «N строк файла».</li>
          </ul>

          <h3 class="wf-notes-title">Что этот эскиз НЕ показывает</h3>
          <ul>
            <li>Вкладки «Группы» в режиме рецензирования НЕТ и не будет: грант выдаётся человеку, ссылка
              персональная (иначе комментарий нечем подписать), группового приглашения не существует.
              У назначения теста вкладка на месте.</li>
            <li>Состояние «Выполнение»: отдельного экрана у него нет, кнопка переходит в состояние загрузки.</li>
          </ul>

          <h3 class="wf-notes-title">DS Mapping</h3>
          <table class="tb-table">
            <thead><tr><th>Элемент</th><th>Компонент</th></tr></thead>
            <tbody>
              <tr><td>Диалог</td><td><code>ModalDialog</code> (<code>ou-modal--xl</code>)</td></tr>
              <tr><td>Вкладки</td><td><code>Tabs</code> (<code>ou-tabs--segment ou-tabs--stretch</code>)</td></tr>
              <tr><td>Предупреждение о видимости</td><td><code>Banner</code> (<code>ou-banner--subtle</code>)</td></tr>
              <tr><td>Списки рецензентов, пользователей, строк</td><td><code>Table</code> (<code>ou-tbl</code>)</td></tr>
              <tr><td>Поле адресов</td><td><code>Textarea</code> (<code>ou-textarea</code>)</td></tr>
              <tr><td>Разделитель «или»</td><td><code>tb-orsep</code> — проектный слой <code>tb-components.css</code></td></tr>
              <tr><td>Зона книги</td><td><code>FileUploader</code> (<code>ou-uploader</code>, погашенная — <code>is-disabled</code>)</td></tr>
              <tr><td>Плитки отчёта</td><td><code>Box border radius=l</code> + <code>Text variant=display-s</code></td></tr>
              <tr><td>Предупреждение о ключах</td><td><code>Banner tone=warning</code> с действием</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <script>
      /* Тема и плотность: prd7-shared.js этих функций не даёт, а кнопки на них
         ссылались с первой редакции и молча падали. */
      function toggleTheme(btn) {
        var dark = document.body.classList.toggle('ou--dark');
        document.body.classList.toggle('ou--light', !dark);
        btn.textContent = dark ? 'Light' : 'Dark';
        btn.classList.toggle('active', dark);
      }
      function toggleDensity(btn) {
        var compact = document.body.classList.toggle('ou--compact');
        document.body.classList.toggle('ou--normal', !compact);
        btn.textContent = compact ? 'Normal' : 'Compact';
        btn.classList.toggle('active', compact);
      }
      function showState(btn, id) {
        document.querySelectorAll('.wf-state').forEach(function (s) { s.classList.remove('active'); });
        var el = document.getElementById('wf-' + id);
        if (el) el.classList.add('active');
        document.querySelectorAll('.wf-nav button[onclick*="showState"]').forEach(function (b) {
          b.classList.remove('active');
        });
        if (btn) btn.classList.add('active');
      }
      (function () {
        var want = new URLSearchParams(location.search).get('state');
        var btn = want && document.querySelector('.wf-nav button[onclick*="\\'' + want + '\\'"]');
        if (btn) showState(btn, want);
      })();
    </script>
  </body>
</html>
`;

fs.writeFileSync("docs/wireframes/approved/prd52-invite-dialog.html", page, "utf8");
console.log("written", page.length);
