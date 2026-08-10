# PRD-38: медиа вопроса как часть вопроса — план реализации

> **Для агентов:** обязательный под-скилл — `superpowers:subagent-driven-development`
> (рекомендуется) либо `superpowers:executing-plans`. Шаги помечены чекбоксами `- [ ]`.

**Цель:** медиа вопроса становится частью блока вопроса (изображение и видео слева от текста,
аудио строкой над текстом), блок ответов всегда получает полную ширину, а разметку медиа на
обоих хостах печатает один общий рендерер.

**Требования:** [PRD-38](../specs/prd-38/question-media-placement.md).

**Подход:** слот `question-media` переезжает внутрь `.tb-scene__q` в макетах обоих шаблонов;
ветвление по типу медиа делается только CSS через `:has([data-media-type="audio"])`, потому что
макеты обязаны остаться побайтово одинаковыми, а DSL не имеет выражений. Печать разметки и
полноэкранный оверлей переезжают в `shared/template/question-media.ts` и раздаются вебу импортом,
пакету — через глобал `TBTemplate`.

**Стек:** TypeScript, Vitest (jsdom), React 19 (веб-хост), framework-free рантайм пакета,
CSS с контейнерными запросами, шаблоны `default` и `certification`.

**Порядок:** эскиз согласуется до первой строки кода (правило проекта). Задачи 2-9 идут строго
по порядку: задача 6 (перенос слота) без задачи 2 (общий рендерер с `data-media-type`) даёт
нерабочее ветвление CSS.

---

## Задача 1: эскиз и согласование

Правило проекта: UI не реализуется без сверки с утверждённым эскизом. Эскиз показывает четыре
состояния сцены вопроса и заменяет собой устаревшее состояние `s-question-media` в
`docs/wireframes/tpl-standard-scene-ds.html` (там медиа стоит рядом с ответами).

**Файлы:**

- Создать: `docs/wireframes/prd38-question-media.html`

- [ ] **Шаг 1: собрать эскиз**

Взять за основу разметку состояния `s-question-media` из
`docs/wireframes/tpl-standard-scene-ds.html:526-600` и эскизный фрейм оттуда же (классы `wf-*`).
В холсте — только реальный UI на классах `ou-*` и `tb-*`; пояснения выносятся в `wf-notes` и
`wf-mapping`. Локальные render-классы запрещены.

Четыре состояния в одном файле, переключаются кнопками `wf-btn`, как в файле-основе:

| Идентификатор | Что показывает |
| --- | --- |
| `s-media-image-wide` | Шкальный вопрос PRD-26 с изображением, сцена 1280px: медиа 5 из 12 слева от текста, степпер на шесть градаций во всю ширину |
| `s-media-choice-wide` | Вопрос с вариантами-карточками и изображением, сцена 1280px: медиа слева от текста, карточки во всю ширину |
| `s-media-audio` | Аудио-вопрос: плашка плеера строкой над текстом, по ширине плашек вариантов |
| `s-media-narrow` | Сцена 700px: медиа над текстом, всё в одну колонку |

- [ ] **Шаг 2: снять скриншоты**

По рецепту приёмки эскизов: `chrome-headless-shell.exe` поверх `http.server`, запущенного из
КОРНЯ репозитория, копии скриншотов — в `.playwright-mcp/`. Временные файлы в корне репозитория
запрещены.

- [ ] **Шаг 3: остановиться и показать эскиз пользователю**

СТОП. Код не начинается, пока эскиз не согласован. После согласования перенести файл в
`docs/wireframes/approved/` и закоммитить.

```bash
git add docs/wireframes/approved/prd38-question-media.html
git commit -m "docs(prd-38): эскиз композиции медиа вопроса"
```

---

## Задача 2: общий рендерер медиа

**Файлы:**

- Создать: `shared/template/question-media.ts`
- Создать: `tests/question-media-renderer.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Создать `tests/question-media-renderer.test.ts`:

```ts
// @vitest-environment jsdom
/**
 * @module tests/question-media-renderer
 * @description PRD-38: the question-media markup is printed by ONE renderer shared by the
 * web host and the SCORM runtime. The type attribute is the hook the template CSS branches
 * on (audio stacks above the prompt, image and video sit beside it), so it is asserted here
 * rather than left to the hosts.
 */
import { describe, expect, it } from "vitest";
import { renderQuestionMedia } from "../shared/template/question-media";

describe("renderQuestionMedia", () => {
  it("returns an empty string when the url or the type is missing", () => {
    expect(renderQuestionMedia(undefined)).toBe("");
    expect(renderQuestionMedia({})).toBe("");
    expect(renderQuestionMedia({ mediaUrl: "/api/media/7" })).toBe("");
    expect(renderQuestionMedia({ mediaType: "image" })).toBe("");
    expect(renderQuestionMedia({ mediaUrl: "/api/media/7", mediaType: "pdf" })).toBe("");
  });

  it("wraps every type in .question-media carrying data-media-type", () => {
    for (const mediaType of ["image", "audio", "video"]) {
      const html = renderQuestionMedia({ mediaUrl: "/api/media/7", mediaType });
      expect(html.startsWith(`<div class="question-media" data-media-type="${mediaType}">`)).toBe(true);
      expect(html.endsWith("</div>")).toBe(true);
    }
  });

  it("gives image and video a fullscreen button and audio none", () => {
    expect(renderQuestionMedia({ mediaUrl: "/a.png", mediaType: "image" })).toContain("data-media-fullscreen");
    expect(renderQuestionMedia({ mediaUrl: "/a.mp4", mediaType: "video" })).toContain("data-media-fullscreen");
    expect(renderQuestionMedia({ mediaUrl: "/a.mp3", mediaType: "audio" })).not.toContain("data-media-fullscreen");
  });

  it("prints no inline event handlers and no inline sizing", () => {
    for (const mediaType of ["image", "audio", "video"]) {
      const html = renderQuestionMedia({ mediaUrl: "/api/media/7", mediaType });
      expect(html).not.toContain("onclick");
      expect(html).not.toContain("style=");
    }
  });

  it("loads metadata only, so the asset is not fetched before playback", () => {
    expect(renderQuestionMedia({ mediaUrl: "/a.mp3", mediaType: "audio" })).toContain('preload="metadata"');
    expect(renderQuestionMedia({ mediaUrl: "/a.mp4", mediaType: "video" })).toContain('preload="metadata"');
  });

  it("escapes the url so a crafted asset name cannot inject markup", () => {
    const html = renderQuestionMedia({ mediaUrl: '/a.png" onerror="alert(1)', mediaType: "image" });
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&quot;");
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запуск: `npm test -- tests/question-media-renderer.test.ts`

Ожидание: FAIL, модуль `shared/template/question-media` не найден.

Важно: `npx vitest run` в этом репозитории падает на `initConfig()`. Точечный прогон делается
только через `npm test -- <путь>`. Полный прогон набора без явного разрешения не запускать —
в одной рабочей копии работает несколько сессий.

- [ ] **Шаг 3: написать модуль**

Создать `shared/template/question-media.ts`:

```ts
/**
 * @module shared/template/question-media
 * @description PRD-38. Single source of the question-media markup and of its fullscreen
 * overlay, shared by BOTH hosts: the web screen imports it, the SCORM runtime reaches it
 * through the `TBTemplate` global. Before this module the two hosts printed different
 * wrappers and different inline sizes, which is why the template CSS could not control the
 * media at all — inline styles from the runtime outrank `theme.css`.
 *
 * The wrapper carries `data-media-type` because the question layout must stay byte-identical
 * across templates (tests/template-layout-parity) and the template DSL has no expressions:
 * the «audio stacks above the prompt, image sits beside it» rule can therefore only be
 * expressed in CSS, and CSS needs an attribute to branch on.
 */
import { escapeHtml } from "../text/escape";

/** Media kinds a question can carry. Anything else renders nothing. */
export type QuestionMediaType = "image" | "audio" | "video";

/** The two question fields this module reads; both hosts pass the question object itself. */
export interface QuestionMediaInput {
  mediaUrl?: string | null;
  mediaType?: string | null;
}

/** Marks the fullscreen affordance for the delegated handler below. */
const FULLSCREEN_ATTR = "data-media-fullscreen";

/** Fullscreen is offered for what has a picture; audio has none. */
function isZoomable(type: string): type is "image" | "video" {
  return type === "image" || type === "video";
}

/**
 * Markup of the question media slot. Sizing and spacing are deliberately absent: they belong
 * to the template's `theme.css`, which cannot outrank an inline style.
 *
 * @param media Question (or any object carrying `mediaUrl` / `mediaType`).
 * @returns HTML string; empty when there is nothing to show.
 */
export function renderQuestionMedia(media: QuestionMediaInput | null | undefined): string {
  const url = media?.mediaUrl;
  const type = media?.mediaType;
  if (!url || !type) return "";

  const src = escapeHtml(url);
  const kind = escapeHtml(type);
  const open = `<div class="question-media" data-media-type="${kind}">`;
  const zoom = isZoomable(type)
    ? `<button type="button" class="qm-fs-btn" ${FULLSCREEN_ATTR}` +
      ` data-media-url="${src}" data-media-type="${kind}"` +
      ` aria-label="Открыть во весь экран">⛶</button>`
    : "";

  if (type === "image") {
    return open + zoom + `<img class="qm-preview" src="${src}" alt=""></div>`;
  }
  if (type === "video") {
    return (
      open + zoom +
      `<video class="qm-preview" controls preload="metadata">` +
      `<source src="${src}">Ваш браузер не воспроизводит видео.</video></div>`
    );
  }
  if (type === "audio") {
    return (
      open +
      `<audio class="qm-audio" controls preload="metadata">` +
      `<source src="${src}">Ваш браузер не воспроизводит аудио.</audio></div>`
    );
  }
  return "";
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Запуск: `npm test -- tests/question-media-renderer.test.ts`

Ожидание: PASS, 6 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add shared/template/question-media.ts tests/question-media-renderer.test.ts
git commit -m "feat(prd-38): общий рендерер медиа вопроса для обоих хостов"
```

---

## Задача 3: общий полноэкранный оверлей

Оверлей переезжает из рантайма пакета в общий код, потому что общая разметка иначе даёт в вебе
кнопку без обработчика. Инлайновый `onclick` заменяется делегированием.

> **Черновой код ниже устарел — источник истины `shared/template/question-media.ts`.** Ревью
> нашло в нём дефект: оверлей монтировался в `document.body`, а `theme.css` в вебе инжектится
> ВНУТРЬ теневого корня, то есть правила `.qm-overlay` до оверлея не дошли бы. В реализации
> (`f4ddf16`) оверлей монтируется в ТОТ корень, что передали в `attachQuestionMediaFullscreen`:
> `Document` — в `document.body`, `ShadowRoot` или `Element` — в них самих. Сигнатура стала
> `openQuestionMediaOverlay(root, url, type)`. Проверено, что `container: tbscene / inline-size`
> на `.tb-scene` (`theme.css:120`) не мешает: оверлей в теневом корне — сосед сцены, а не её
> потомок, поэтому `position: fixed` считается от вьюпорта. Вызовы в задачах 4 и 5 остаются
> верными без правок.

**Файлы:**

- Изменить: `shared/template/question-media.ts`
- Изменить: `tests/question-media-renderer.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Дописать в конец `tests/question-media-renderer.test.ts`:

Файл уже объявлен как jsdom первой строкой (задача 2, шаг 3), отдельная директива не нужна —
`@vitest-environment` действует только в самом начале файла.

```ts
describe("attachQuestionMediaFullscreen", () => {
  function mount(): { root: HTMLElement; detach: () => void } {
    const root = document.createElement("div");
    root.innerHTML = renderQuestionMedia({ mediaUrl: "/a.png", mediaType: "image" });
    document.body.appendChild(root);
    return { root, detach: attachQuestionMediaFullscreen(root) };
  }

  it("opens the overlay with the clicked asset and closes it on Escape", () => {
    const { root, detach } = mount();
    root.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();

    const overlay = document.getElementById("qm-overlay")!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.querySelector("img")?.getAttribute("src")).toBe("/a.png");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlay.hidden).toBe(true);
    expect(overlay.querySelector("img")).toBeNull();
    detach();
  });

  it("is idempotent: two attachments open one overlay, and detaching stops the handler", () => {
    const { root, detach } = mount();
    const second = attachQuestionMediaFullscreen(root);
    root.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();
    expect(document.querySelectorAll("#qm-overlay").length).toBe(1);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    detach();
    second();
    root.querySelector<HTMLElement>("[data-media-fullscreen]")!.click();
    expect(document.getElementById("qm-overlay")!.hidden).toBe(true);
  });
});
```

Импорт в шапке файла заменить на:

```ts
import { attachQuestionMediaFullscreen, renderQuestionMedia } from "../shared/template/question-media";
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запуск: `npm test -- tests/question-media-renderer.test.ts`

Ожидание: FAIL, `attachQuestionMediaFullscreen` не экспортируется.

- [ ] **Шаг 3: дописать оверлей в модуль**

Добавить в `shared/template/question-media.ts`:

```ts
/** Single overlay per document, reused by every screen and both hosts. */
const OVERLAY_ID = "qm-overlay";

/** Builds the overlay lazily; a package screen without media never pays for it. */
function ensureOverlay(doc: Document): HTMLElement {
  const existing = doc.getElementById(OVERLAY_ID);
  if (existing) return existing;

  const overlay = doc.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "qm-overlay";
  overlay.hidden = true;
  overlay.innerHTML =
    '<button type="button" class="qm-overlay__close" aria-label="Закрыть">✕</button>' +
    '<div class="qm-overlay__stage"></div>';
  doc.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    // Background and the close button dismiss; a click on the asset itself does not.
    const target = e.target as HTMLElement;
    if (target === overlay || target.closest(".qm-overlay__close")) closeOverlay(doc);
  });
  doc.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") closeOverlay(doc);
  });
  return overlay;
}

/** Empties the stage — that also stops a playing video — and hides the overlay. */
function closeOverlay(doc: Document): void {
  const overlay = doc.getElementById(OVERLAY_ID);
  if (!overlay) return;
  const stage = overlay.querySelector(".qm-overlay__stage");
  if (stage) stage.innerHTML = "";
  overlay.hidden = true;
}

/**
 * Shows one asset full screen.
 *
 * @param doc  Owner document (the web host lives in a shadow root, whose document this is).
 * @param url  Asset address, already resolved by the host.
 * @param type Media kind; anything but image and video is ignored.
 */
export function openQuestionMediaOverlay(doc: Document, url: string, type: string): void {
  if (!isZoomable(type)) return;
  const overlay = ensureOverlay(doc);
  const stage = overlay.querySelector(".qm-overlay__stage")!;
  stage.innerHTML =
    type === "image"
      ? `<img src="${escapeHtml(url)}" alt="">`
      : `<video controls autoplay><source src="${escapeHtml(url)}"></video>`;
  overlay.hidden = false;
}

/**
 * Wires the fullscreen affordance by delegation, so it survives the re-render both hosts do
 * on every question. Idempotent: attaching twice adds one listener per call but still yields
 * a single overlay.
 *
 * @param root Shadow root (web) or document (package).
 * @returns Detach function.
 */
export function attachQuestionMediaFullscreen(root: Document | ShadowRoot | Element): () => void {
  const onClick = (e: Event) => {
    const el = (e.target as HTMLElement | null)?.closest?.(`[${FULLSCREEN_ATTR}]`);
    if (!el) return;
    const url = el.getAttribute("data-media-url");
    const type = el.getAttribute("data-media-type");
    if (!url || !type) return;
    openQuestionMediaOverlay(el.ownerDocument, url, type);
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Запуск: `npm test -- tests/question-media-renderer.test.ts`

Ожидание: PASS, 8 тестов.

- [ ] **Шаг 5: экспортировать из рантайм-входа**

В `shared/template/runtime-entry.ts` рядом с соседними экспортами (например, после строки
`export { attachPointerDnd } from "./dnd/pointer-dnd";`) добавить:

```ts
export { renderQuestionMedia, attachQuestionMediaFullscreen, openQuestionMediaOverlay } from "./question-media";
```

- [ ] **Шаг 6: проверить типы**

Запуск: `npm run check`

Ожидание: ошибок нет.

- [ ] **Шаг 7: коммит**

```bash
git add shared/template/question-media.ts shared/template/runtime-entry.ts tests/question-media-renderer.test.ts
git commit -m "feat(prd-38): полноэкранный просмотр медиа переехал в общий код"
```

---

## Задача 4: веб-хост на общем рендерере

**Файлы:**

- Изменить: `client/src/pages/learner/template-question-screen.tsx:123-133` (удаление `mediaHtml`)
  и `:217` (заполнение слота)
- Изменить: `client/src/components/template-screen.tsx:438` (привязка оверлея)

- [ ] **Шаг 1: заменить локальный рендерер**

Удалить функцию `mediaHtml` целиком (строки 123-133). В шапке файла добавить импорт:

```ts
import { renderQuestionMedia } from "@shared/template/question-media";
```

В объекте `slots` заменить строку 217:

```ts
    "question-media": renderQuestionMedia(question),
```

- [ ] **Шаг 2: привязать оверлей к теневому корню**

В `client/src/components/template-screen.tsx` добавить импорт рядом с импортом `attachPointerDnd`
(строка 16):

```ts
import { attachQuestionMediaFullscreen } from "@shared/template/question-media";
```

Эффект с `attachPointerDnd` (строки 434-441) возвращает функцию отцепления напрямую, поэтому
дописывать в него ничего не нужно — добавить рядом отдельный эффект того же вида:

```ts
  // PRD-38: полноэкранный просмотр медиа вопроса — тот же общий обработчик, который
  // SCORM-хост цепляет на `document`. Отдельный эффект, а не довесок к dnd: у привязок
  // разные причины существовать, и складывать их в один эффект незачем.
  useEffect(() => {
    const shadow = shadowRef.current;
    if (!shadow) return;
    return attachQuestionMediaFullscreen(shadow);
  }, []);
```

- [ ] **Шаг 3: прогнать тесты веб-экрана**

Запуск: `npm test -- client/src/pages/learner/__tests__/template-question-screen.test.tsx client/src/pages/learner/__tests__/template-question-screen-extra.coverage.test.tsx`

Ожидание: PASS. Если падает проверка на строке 452 второго файла (она ищет содержимое внутри
`[data-slot="question-media"]`), поправить ожидаемый селектор под новую обёртку
`.question-media` — сам факт заполнения слота проверяется по-прежнему.

- [ ] **Шаг 4: проверить типы**

Запуск: `npm run check`

Ожидание: ошибок нет.

- [ ] **Шаг 5: коммит**

```bash
git add client/src/pages/learner/template-question-screen.tsx client/src/components/template-screen.tsx client/src/pages/learner/__tests__
git commit -m "feat(prd-38): веб-хост печатает медиа общим рендерером"
```

---

## Задача 5: рантайм пакета на общем рендерере

**Файлы:**

- Изменить: `server/scorm/template/app/render/questionMedia.js` (заменяется целиком)

- [ ] **Шаг 1: заменить файл**

Содержимое `server/scorm/template/app/render/questionMedia.js` полностью заменить на:

```js
/**
 * PRD-38: печать разметки медиа и полноэкранный оверлей живут в общем коде
 * (`shared/template/question-media`), который приезжает в пакет глобалом `TBTemplate`.
 * Здесь остаются только имена, на которые ссылается остальной рантайм, и одна привязка
 * оверлея к документу.
 */
function renderQuestionMedia(q) {
  return TBTemplate.renderQuestionMedia(q);
}

/** Совместимость: внешние шаблоны могли ссылаться на этот глобал напрямую. */
window.qmOpenFromEl = function (el) {
  var url = el.getAttribute('data-media-url');
  var type = el.getAttribute('data-media-type');
  if (url && type) TBTemplate.openQuestionMediaOverlay(document, url, type);
};

TBTemplate.attachQuestionMediaFullscreen(document);
```

Проверить, что имя `renderQuestionMedia` не переопределяется ниже по склейке рантайма: части
склеиваются плоско в порядке массива `appJs` (`server/scorm/index.ts:423-470`), и файл,
идущий позже, перекрывает объявления предыдущих. `questionMediaJs` стоит на позиции 459, после
него идут `pdfExportJs`, `adaptiveJs`, `adaptiveRenderJs`, `adaptiveSessionJs`, `contentPageJs`,
`mainRenderJs`, `appMain`, `feedbackJs` и далее. Команда проверки:

```bash
grep -rn "function renderQuestionMedia\|qmOpenFromEl" server/scorm/template server/scorm/assets
```

Ожидание: объявления только в `questionMedia.js`.

- [ ] **Шаг 2: прогнать сборочные тесты пакета**

Запуск: `npm test -- tests/scorm-builders.test.ts tests/scorm-package-acceptance.test.ts`

Ожидание: PASS.

- [ ] **Шаг 3: коммит**

```bash
git add server/scorm/template/app/render/questionMedia.js
git commit -m "feat(prd-38): рантайм пакета делегирует медиа общему рендереру"
```

---

## Задача 6: перенос слота в макетах

**Файлы:**

- Изменить: `server/scorm/templates/default/layouts/question.html:44-59`
- Изменить: `templates/certification/layouts/question.html:44-59`
- Изменить: `tests/question-scene-layout.test.ts`

- [ ] **Шаг 1: написать падающий тест**

В `tests/question-scene-layout.test.ts` заполнить слот медиа непустым значением и добавить
проверку места. Заменить строку 44 (`"question-media": "",`) на:

```ts
      "question-media": '<div class="question-media" data-media-type="image"><img src="/a.png" alt=""></div>',
```

и добавить новый блок после блока «fills the question text slot»:

```ts
describe("question.html — media belongs to the question block (PRD-38)", () => {
  it("puts the media slot inside .tb-scene__q, ahead of the prompt", () => {
    const root = render();
    const q = root.querySelector(".tb-scene__q")!;
    const slot = q.querySelector('[data-slot="question-media"]');
    expect(slot).toBeTruthy();
    expect(q.firstElementChild).toBe(slot);
  });

  it("leaves no media column in the answers body", () => {
    const root = render();
    expect(root.querySelector(".tb-qbody__media")).toBeNull();
    expect(root.querySelector('.tb-qbody [data-slot="question-media"]')).toBeNull();
    expect(root.querySelector('.tb-qbody [data-slot="question-interaction"]')).toBeTruthy();
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запуск: `npm test -- tests/question-scene-layout.test.ts`

Ожидание: FAIL — слот пока лежит в `.tb-qbody`.

- [ ] **Шаг 3: править макет стандартного шаблона**

В `server/scorm/templates/default/layouts/question.html` заменить блок строк 44-59 на:

```html
      <div class="tb-scene__q">
        <div data-slot="question-media"></div>
        <h2 class="tb-scene__qtitle" data-slot="question-text"></h2>
        <!-- PRD-34 (FR-16): строка подсказки — она же место водяного знака. Якорь пустой:
             разметку, кегль и контраст знака даёт ЯДРО, шаблон отвечает только за место. -->
        <div class="tb-scene__qmeta">
          {{#if state.questionHint}}<span class="tb-scene__qhint" data-path="state.questionHint"></span>{{/if}}
          <div data-slot="protection-mark"></div>
        </div>
      </div>
      <div class="tb-qbody">
        <div class="tb-qbody__answers">
          <div data-slot="question-feedback"></div>
          <div data-slot="question-interaction"></div>
        </div>
      </div>
```

- [ ] **Шаг 4: скопировать макет в шаблон «Сертификация»**

Макеты обязаны совпадать побайтово, кроме перечисленных в `INTENDED_DELTAS` отличий, а
`question.html` в этот перечень не входит:

```bash
cp server/scorm/templates/default/layouts/question.html templates/certification/layouts/question.html
```

- [ ] **Шаг 5: прогнать тесты раскладки и паритета**

Запуск:

```bash
npm test -- tests/question-scene-layout.test.ts tests/template-layout-parity.test.ts \
  tests/template-dsl-layouts.test.ts tests/protection-apply.test.ts
```

Ожидание: PASS во всех четырёх. Тест защиты PRD-34 подтверждает, что переезд слота не вывел
область медиа из-под защиты.

- [ ] **Шаг 6: обновить набор слотов предпросмотра**

В `shared/template/preview-context.ts:574-583` слот `question-media` заполняется пустой строкой,
из-за чего предпросмотр никогда не показывает медиа. Заменить обе ветки на печать общим
рендерером:

```ts
    const slots = q
      ? {
          // The preview renders what the learner will see, so the prompt goes through
          // the SAME author-text pipeline as the two runtime hosts — otherwise the
          // author would approve a screen the players do not produce.
          "question-text": renderInlineMarkdown(String(q.prompt ?? "")),
          "question-media": renderQuestionMedia(q as { mediaUrl?: string | null; mediaType?: string | null }),
          "question-interaction": buildInteraction(q),
        }
      : { "question-text": "", "question-media": "", "question-interaction": "" };
```

и добавить импорт в шапку файла:

```ts
import { renderQuestionMedia } from "./question-media";
```

- [ ] **Шаг 7: проверить типы и прогнать тесты предпросмотра**

Запуск: `npm run check`

Ожидание: ошибок нет.

Запуск: `npm test -- tests/smoke-runner.test.ts tests/results-report-action.test.ts`

Ожидание: PASS. Это два набора, которые ходят через `preview-context`; отдельного теста у
самого модуля нет.

- [ ] **Шаг 8: коммит**

```bash
git add server/scorm/templates/default/layouts/question.html templates/certification/layouts/question.html tests/question-scene-layout.test.ts shared/template/preview-context.ts
git commit -m "feat(prd-38): слот медиа переехал в блок вопроса в обоих шаблонах"
```

---

## Задача 7: композиция сцены в CSS

Правки делаются в двух файлах: `server/scorm/templates/default/styles/theme.css` и
`templates/certification/styles/theme.css`. Побайтового паритета у стилей нет — комментарии
вокруг правил в двух файлах различаются, поэтому копировать файл целиком нельзя, правится
каждый по месту.

**Файлы:**

- Изменить: `server/scorm/templates/default/styles/theme.css:376-404` и `:989-991`
- Изменить: `templates/certification/styles/theme.css:379-404` и `:1074-1076`

- [ ] **Шаг 1: заменить правило блока вопроса в стандартном шаблоне**

В `server/scorm/templates/default/styles/theme.css` строку 376
(`.tb-scene__q { display: flex; flex-direction: column; gap: var(--ou-space-2); }`) заменить на:

Правила ниже проверены в браузере на эскизе задачи 1 — брать ДОСЛОВНО, включая комментарии.
Три вещи в них неочевидны и каждая уже ломала раскладку при проверке:

- **ряды объявлены явно.** Без `grid-template-rows` линия `-1` совпадает с линией `1`, спан
  `grid-row: 1 / -1` схлопывается в одну ячейку, и подсказка уезжает под медиа в левую колонку;
- **аргумент `:has()` для аудио длиннее, чем нужно для попадания.** Специфичность `:has()`
  равна специфичности самого специфичного аргумента: короткое `:has([data-media-type="audio"])`
  даёт (0,2,0) и проигрывает правилу двух колонок (0,3,0 из-за `:not(:empty)`) — аудио молча
  остаётся в колонке 5 из 12;
- **колонки детей заданы явно**, иначе авторазмещение расставляет их иначе.

```css
/* PRD-38: медиа принадлежит блоку вопроса, а не блоку ответов. Одна колонка, пока медиа
   нет; при непустом слоте — медиа 5 модулей слева, текст с подсказкой 7 справа: та же
   пропорция, что и раньше, но справа теперь стоит ТЕКСТ ЗАДАНИЯ, а не блок ответов.
   Ветвление по ТИПУ медиа возможно только здесь: макеты обязаны совпадать побайтово у всех
   шаблонов (tests/template-layout-parity), а DSL не имеет выражений.

   Ряды объявлены явно, потому что без grid-template-rows строка `-1` равна строке `1`:
   правило grid-row:1/-1 у медиа схлопнулось бы в одну ячейку, а подсказка уехала бы под
   медиа в ЛЕВУЮ колонку. Второй ряд — `1fr`, а не `auto`: когда медиа выше пары «заголовок +
   подсказка», лишнюю высоту забирает нижний ряд целиком, и подсказка остаётся прижатой к
   заголовку, а не повисает посреди пустоты. */
.tb-scene__q { display: grid; grid-template-columns: 1fr; gap: var(--ou-space-2); }
.tb-scene__q:has([data-slot="question-media"]:not(:empty)) {
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  grid-template-rows: auto 1fr;
  column-gap: var(--ou-space-5);
  align-items: start;
}
.tb-scene__q:has([data-slot="question-media"]:not(:empty)) > [data-slot="question-media"] {
  grid-column: 1; grid-row: 1 / -1;
}
.tb-scene__q:has([data-slot="question-media"]:not(:empty)) > .tb-scene__qtitle,
.tb-scene__q:has([data-slot="question-media"]:not(:empty)) > .tb-scene__qmeta {
  grid-column: 2;
}
/* Аудио визуальной площади не имеет: плеер идёт строкой над текстом во всю ширину колонки.

   Аргумент `:has()` намеренно длиннее, чем нужно для попадания: специфичность `:has()` равна
   специфичности САМОГО СПЕЦИФИЧНОГО аргумента, поэтому короткое
   `:has([data-media-type="audio"])` (0,2,0) ПРОИГРЫВАЕТ правилу выше (0,3,0 из-за
   `:not(:empty)`) и аудио молча остаётся в колонке 5 из 12. Проверено в браузере: до правки
   плашка плеера была шириной 376px. */
.tb-scene__q:has([data-slot="question-media"] [data-media-type="audio"]) {
  grid-template-columns: 1fr;
  grid-template-rows: auto;
}
.tb-scene__q:has([data-slot="question-media"] [data-media-type="audio"]) > [data-slot="question-media"],
.tb-scene__q:has([data-slot="question-media"] [data-media-type="audio"]) > .tb-scene__qtitle,
.tb-scene__q:has([data-slot="question-media"] [data-media-type="audio"]) > .tb-scene__qmeta {
  grid-column: 1; grid-row: auto;
}
/* Порядок в DOM выбран так, что во всех одноколоночных случаях медиа само оказывается над
   текстом — отдельного правила порядка не требуется. */
.tb-scene__q > [data-slot="question-media"]:empty { display: none; }
/* Медиа и текст задания разделяет тот же интервал, что и остальные блоки колонки. */
.tb-scene__q:has([data-slot="question-media"] [data-media-type="audio"]) > [data-slot="question-media"] {
  margin-bottom: var(--ou-space-3);
}
```

- [ ] **Шаг 2: заменить правило блока ответов в стандартном шаблоне**

В том же файле заменить строки 389-404 (блок «Media + answers» вместе с обоими комментариями,
`.tb-qbody`, правилом `:has(...)`, `.tb-qbody__media:empty` и правилами `.tb-qbody__media img,
video`) на:

```css
/* Ответы: занимают колонку, когда содержимое короткое (flex-grow), и держат natural height,
   когда длинное, — тело сцены тогда прокручивается, а не обрезает последние варианты.
   PRD-38: колонки здесь больше нет — медиа ушло в блок вопроса, ответы всегда во всю ширину. */
.tb-qbody { flex: 1 0 auto; display: grid; grid-template-columns: 1fr; gap: var(--ou-space-5); }

/* Размер медиа задаёт ШАБЛОН, а не инлайн рантайма: в этом и смысл общего рендерера —
   инлайновый стиль иначе перебивает theme.css.
   max-height держит кадр вопроса: высокая вертикальная картинка иначе растянула бы левую
   колонку и утопила варианты ответа под сгиб.
   Обёртка изображения и видео хватает по содержимому (width: fit-content), поэтому кнопка
   «во весь экран» стоит в углу САМОЙ картинки, а не у края пустой колонки, и вокруг картинки
   не остаётся полей от `object-fit`.
   Картинка не растягивается сверх натурального размера: апскейл даёт мыло. */
.question-media[data-media-type="image"],
.question-media[data-media-type="video"] {
  width: fit-content; max-width: 100%; margin-inline: auto;
}
.question-media img,
.question-media video {
  display: block; width: auto; height: auto;
  max-width: 100%; max-height: 320px;
  border-radius: var(--ou-radius-m);
}
.question-media img { cursor: zoom-in; }
```

- [ ] **Шаг 3: заменить складывание на узкой сцене в стандартном шаблоне**

В том же файле в блоке `@container tbscene (max-width: 700px)` заменить строку 991
(`.tb-qbody:has([data-slot="question-media"]:not(:empty)) { grid-template-columns: 1fr; }`) на:

```css
  /* PRD-38: складывается БЛОК ВОПРОСА, а у блока ответов складывать нечего — колонок у него
     нет ни при какой ширине. Медиа оказывается над текстом само собой: в разметке оно идёт
     первым. Потолок высоты ниже, чем на широкой сцене: на телефоне картинка в 320px съедает
     экран и утапливает варианты под сгиб. */
  .tb-scene__q:has([data-slot="question-media"]:not(:empty)) {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }
  .tb-scene__q:has([data-slot="question-media"]:not(:empty)) > [data-slot="question-media"],
  .tb-scene__q:has([data-slot="question-media"]:not(:empty)) > .tb-scene__qtitle,
  .tb-scene__q:has([data-slot="question-media"]:not(:empty)) > .tb-scene__qmeta {
    grid-column: 1; grid-row: auto;
  }
  .tb-scene__q:has([data-slot="question-media"]:not(:empty)) > [data-slot="question-media"] {
    margin-bottom: var(--ou-space-3);
  }
  .question-media img,
  .question-media video { max-height: 220px; }
```

Комментарий над блоком (строки 985-988) отредактировать: фраза «media left / answers right»
устарела, правильная — «media left / prompt right».

- [ ] **Шаг 4: повторить шаги 1-3 в шаблоне «Сертификация»**

Те же три правки в `templates/certification/styles/theme.css`: строка 379 (блок вопроса),
строки 392-404 (блок ответов и правила `.tb-qbody__media`), строка 1076 (складывание на узкой
сцене). Комментарии вокруг в этом файле короче — сохранить местную редакцию, заменяя только
сами правила.

- [ ] **Шаг 5: проверить, что нигде не осталось ссылок на удалённый класс**

```bash
grep -rn "tb-qbody__media" --include=*.css --include=*.html --include=*.ts --include=*.tsx .
```

Ожидание: совпадения только в `docs/` (историческая часть планов и спек) и в файлах
`preview.html`, которые перегенерируются в задаче 9. В `server/`, `client/`, `shared/`,
`templates/` и `tests/` совпадений быть не должно.

- [ ] **Шаг 6: коммит**

```bash
git add server/scorm/templates/default/styles/theme.css templates/certification/styles/theme.css
git commit -m "feat(prd-38): медиа встроено в блок вопроса, ответы во всю ширину"
```

---

## Задача 8: оформление аудио и оверлея

**Файлы:**

- Изменить: `server/scorm/templates/default/styles/theme.css:847-855` (блок «Question media»)
- Изменить: `templates/certification/styles/theme.css:817-825` (тот же блок)

- [ ] **Шаг 1: дописать стили в стандартном шаблоне**

В `server/scorm/templates/default/styles/theme.css` блок, начинающийся комментарием
`/* Question media + fullscreen affordance (renderQuestionMedia). */` (строки 847-855),
дополнить до:

```css
/* Question media + fullscreen affordance (renderQuestionMedia, PRD-38). */
.question-media { position: relative; }
.qm-fs-btn {
  position: absolute; top: 10px; right: 10px;
  border: 0; border-radius: var(--ou-radius-s); padding: 8px 10px;
  background: var(--ou-bg-elevated); color: var(--ou-fg-default);
  cursor: pointer; font-size: 16px; line-height: 1; opacity: 0.9;
}
.qm-fs-btn:hover { opacity: 1; }

/* PRD-38: аудио — не картинка, а полоса управления. Плашка даёт ей поверхность сцены.
   Своего плеера у DS пока нет — осознанный техдолг PRD-38 (раздел 9 спеки).

   ПРО color-scheme: своего объявления здесь НЕ НУЖНО, и объявлять его прямо вредно.
   `color-scheme` НАСЛЕДУЕТСЯ, а ДС уже ставит его на корне темы (`.ou, .ou--light` — light,
   `.ou--dark` — dark, см. university-rt.css); корень сцены и есть `.ou` на обоих хостах.
   Правило вида `color-scheme: light dark` это наследование ПЕРЕБИВАЕТ и возвращает плеер к
   СИСТЕМНОЙ теме: проверено в браузере — на тёмной сцене плеер становился белым. */
.question-media[data-media-type="audio"] {
  padding: var(--ou-space-3);
  border: 1px solid var(--ou-border-soft);
  border-radius: var(--ou-radius-m);
  background: var(--ou-bg-surface-2);
}
.qm-audio { display: block; width: 100%; }

/* Полноэкранный просмотр (attachQuestionMediaFullscreen). Разметку строит ЯДРО, поэтому
   здесь только вид: до PRD-38 те же значения писались инлайном из рантайма. */
.qm-overlay {
  position: fixed; inset: 0; z-index: 99999;
  display: flex; align-items: center; justify-content: center;
  padding: var(--ou-space-6); background: rgb(0 0 0 / 0.85);
}
.qm-overlay[hidden] { display: none; }
.qm-overlay__stage { display: flex; align-items: center; justify-content: center; max-width: 95vw; max-height: 90vh; }
.qm-overlay__stage img,
.qm-overlay__stage video { max-width: 95vw; max-height: 90vh; object-fit: contain; border-radius: var(--ou-radius-m); }
.qm-overlay__close {
  position: absolute; top: var(--ou-space-4); right: var(--ou-space-4);
  border: 0; border-radius: var(--ou-radius-s); padding: 10px 12px;
  background: var(--ou-bg-elevated); color: var(--ou-fg-default);
  cursor: pointer; font-size: 22px; line-height: 1;
}
```

Имена токенов сверены по `vendor/ui-kit/css/university-rt.css` при сборке эскиза: токена
`--ou-border-subtle` в ДС НЕТ, поэтому рамка объявлена через `--ou-border-soft`. Любой другой
добавляемый токен проверять так же — контролёр не ловит несуществующий `--ou-*`, и опечатка
молча даёт прозрачный фон.

- [ ] **Шаг 2: повторить в шаблоне «Сертификация»**

Тот же блок в `templates/certification/styles/theme.css` (строки 817-825) дополнить теми же
правилами. Палитра различий не требует: значения берутся из токенов, которые каждый шаблон
переопределяет у себя.

- [ ] **Шаг 3: коммит**

```bash
git add server/scorm/templates/default/styles/theme.css templates/certification/styles/theme.css
git commit -m "feat(prd-38): плашка аудио-плеера и стили полноэкранного просмотра"
```

---

## Задача 9: предпросмотр шаблонов и версии

**Файлы:**

- Изменить: `server/scorm/templates/default/preview.html` (генерируется)
- Изменить: `templates/certification/preview.html` (генерируется)
- Изменить: `server/scorm/templates/default/manifest.json:4`
- Изменить: `templates/certification/manifest.json:4`

- [ ] **Шаг 1: перегенерировать предпросмотр**

```bash
npm run scorm:previews
```

Ожидание: оба `preview.html` обновились. Файлы генерируемые — руками их не править. Генератор
из сборки не выпиливать: это dev-инструмент, на который завязана приёмка шаблонов.

- [ ] **Шаг 2: поднять версии шаблонов**

В `server/scorm/templates/default/manifest.json` поднять `"version"` с `1.4.0` до `1.5.0`;
в `templates/certification/manifest.json` — с `1.6.0` до `1.7.0`. Меняется контракт экрана
вопроса, поэтому версия минорная, а не патч.

- [ ] **Шаг 3: прогнать тесты шаблонов**

Запуск: `npm test -- tests/template-layout-parity.test.ts tests/question-scene-layout.test.ts tests/scorm-builders.test.ts`

Ожидание: PASS.

- [ ] **Шаг 4: коммит**

```bash
git add server/scorm/templates/default/preview.html templates/certification/preview.html server/scorm/templates/default/manifest.json templates/certification/manifest.json
git commit -m "chore(prd-38): предпросмотр шаблонов и версии манифестов"
```

---

## Задача 10: приёмка в браузере

Юнит-тестов и `npm run check` для приёмки фронтенда недостаточно — правило проекта требует
проверки в настоящем браузере. Инструменты Playwright доступны через `ToolSearch`
(`mcp__playwright__browser_*`).

**Файлы:**

- Создать: `docs/reports/prd38-question-media-acceptance.md`

- [ ] **Шаг 1: поднять второй экземпляр сервера**

Серверные правки не подхватываются живым dev-процессом (tsx запущен без `--watch`), а чужой
процесс останавливать нельзя — в копии работают другие сессии:

```bash
PORT=8099 npm run dev
```

- [ ] **Шаг 2: проверить веб-хост**

Войти учеником, открыть прохождение теста и снять скриншоты четырёх состояний:

1. шкальный вопрос с изображением при ширине окна 1280 — степпер во всю ширину, подписи
   градаций не слипаются (исходный дефект);
2. вопрос с вариантами и изображением при 1280 — медиа слева от текста, карточки во всю ширину;
3. аудио-вопрос — плашка плеера над текстом, по ширине плашек вариантов; повторить в светлой
   и тёмной теме;
4. ширина окна 700 — всё в одну колонку, медиа над текстом.

Отдельно проверить кнопку «во весь экран»: открытие, закрытие по фону, по крестику и по Esc.
На вебе это новое поведение, раньше полноэкранного просмотра тут не было.

- [ ] **Шаг 3: проверить пакет**

```bash
npm run scorm:sample
npm run scorm:player
```

Открыть плеер на `:5050` и повторить те же четыре состояния и проверку оверлея. Расхождение
между хостами — дефект: разметку печатает один рендерер.

- [ ] **Шаг 4: сверить каждую деталь с эскизом**

Скриншоты сверяются с утверждённым эскизом задачи 1 по каждому пункту: доли ширины, отступы,
поведение на узкой сцене. Визуальный успех не объявляется без такой сверки.

- [ ] **Шаг 5: написать отчёт приёмки**

Создать `docs/reports/prd38-question-media-acceptance.md`: что проверено, на каких хостах, со
скриншотами и списком найденных расхождений. Отчёт без указания, что именно прогонялось,
приёмкой не считается.

- [ ] **Шаг 6: коммит**

```bash
git add docs/reports/prd38-question-media-acceptance.md
git commit -m "docs(prd-38): отчёт приёмки композиции медиа вопроса"
```

---

## Грабли, известные заранее

- **Общий индекс git.** В рабочей копии одновременно работают несколько сессий. Перед каждым
  коммитом сверять `git diff --cached --name-only` со списком файлов задачи: `git add` легко
  захватывает чужие правки.
- **Полный прогон тестов.** Не запускать без явного разрешения пользователя; `npm run test:cov`
  тем более — покрытие чистит общий каталог и ломает параллельный прогон.
- **`npx vitest run` не работает** — падает на `initConfig()`. Только `npm test -- <путь>`.
- **DS-CSS лежит в двух копиях.** Если правка всё же понадобится в `university-rt.css`, править
  обе копии.
- **Токены `--ou-*` не проверяются линтером.** Несуществующее имя не подсветится, а даст
  прозрачный фон. Сверять по `vendor/ui-kit/css/university-rt.css`.
- **Инлайн рантайма перебивает `theme.css`.** Это и есть причина задачи 2: пока размеры
  печатались инлайном, шаблон не мог управлять медиа. Не возвращать инлайновые размеры.
- **Склейка рантайма плоская.** Дубль имени `renderQuestionMedia` в файле, идущем позже
  `questionMedia.js`, молча перекроет делегат.
