# План: доставка вложений обратной связи и упаковка медиа из реестра

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** PDF-вложение обратной связи доезжает до ученика на обоих хостах, а медиа любого вида
попадает в SCORM-пакет из реестра медиатеки.

**Architecture:** Адрес вложения хранится обычной строкой `/api/media/<id>` в дескрипторе, поэтому
существующий обходчик ссылок обслуживает его без специальных веток. Упаковщик SCORM получает резолвер
ссылок на реестр и переписывает найденные адреса на относительные пути внутри ZIP. Индекс
использования получает четырёх новых писателей, а правило доступа — резолв этих типов в тесты.

**Tech Stack:** TypeScript, Express, Drizzle ORM, Zod, React 19, Vitest, supertest, esbuild.

Спецификация: [2026-08-02-feedback-assets-delivery-design.md](../specs/2026-08-02-feedback-assets-delivery-design.md).

---

## Структура файлов

| Файл | Ответственность | Действие |
| --- | --- | --- |
| `shared/schema.ts` | Поле `url` дескриптора; тип `variable_feedback` в перечне использований | Изменить |
| `shared/template/result-context.ts` | Чтение адреса вложения при сборке блока рекомендаций | Изменить |
| `client/src/features/tests/editor/test-editor.types.ts` | Клиентский тип дескриптора | Изменить |
| `server/routes/media.ts` | Строгая проверка вложения по назначению загрузки | Изменить |
| `client/src/features/tests/editor/sections/feedback-editor-modal.tsx` | Немедленная загрузка PDF, метка «файл не загружен» | Изменить |
| `server/scorm/builders/media-resolver.ts` | Резолв ссылки на реестр в байты и расширение | Создать |
| `server/scorm/builders/media-assets.ts` | Чистый проход по строкам: подмена адресов на пути внутри ZIP | Изменить |
| `server/scorm/index.ts` | Ожидание асинхронного упаковщика, лог нерезолвленных адресов | Изменить |
| `server/services/media/asset-access.ts` | Резолв новых типов использования в тесты | Изменить |
| `server/services/media/usage-index.ts` | Четыре новых прохода полной пересборки | Изменить |
| `server/routes/tests.ts`, `topics.ts`, `scales.ts`, `result-variables.ts` | Запись индекса на сохранении | Изменить |

Тесты живут в корневом каталоге `tests/` (юнит, `npm test`) и `tests/it/` (интеграционные на pglite,
`npm run test:it`); тесты общего кода — рядом с ним в `shared/template/__tests__/`.

**Порядок обязателен:** контракт (1-2) -> загрузка (3-5) -> упаковщик (6-9) -> индекс и права
(10-14) -> приёмка (15). Упаковщик опирается на контракт, права — на индекс.

**Точечный прогон тестов:** `npm test -- <путь>`. Полный прогон и `npm run test:cov` в этой рабочей
копии запускать только по явному разрешению — в ней одновременно работают несколько сессий.

---

### Task 1: Дескриптор вложения хранит канонический адрес

**Files:**

- Modify: `shared/schema.ts:882-890`
- Modify: `client/src/features/tests/editor/test-editor.types.ts:63-71`
- Modify: `shared/template/result-context.ts:155-169`
- Test: `shared/template/__tests__/result-context-measures.test.ts`

- [ ] **Step 1: Написать падающий тест**

Добавь в конец `shared/template/__tests__/result-context-measures.test.ts`:

```ts
describe("normalizeFeedback — адрес вложения", () => {
  it("берёт url, когда scormHref не заполнен (веб-хост)", () => {
    const block = normalizeFeedback({
      text: "",
      links: [],
      events: [],
      assets: [
        { title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: "/api/media/11111111-1111-1111-1111-111111111111" },
      ],
    });
    expect(block?.assets).toEqual([
      { title: "Памятка", url: "/api/media/11111111-1111-1111-1111-111111111111" },
    ]);
  });

  it("при обоих адресах побеждает url", () => {
    const block = normalizeFeedback({
      text: "",
      links: [],
      events: [],
      assets: [
        { title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: "assets/media/p.pdf", scormHref: "feedback/old.pdf" },
      ],
    });
    expect(block?.assets).toEqual([{ title: "Памятка", url: "assets/media/p.pdf" }]);
  });

  it("читает scormHref, когда url не заполнен (ранее собранные данные)", () => {
    const block = normalizeFeedback({
      text: "",
      links: [],
      events: [],
      assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", scormHref: "assets/media/p.pdf" }],
    });
    expect(block?.assets).toEqual([{ title: "Памятка", url: "assets/media/p.pdf" }]);
  });

  it("отбрасывает дескриптор без обоих адресов", () => {
    const block = normalizeFeedback({
      text: "",
      links: [],
      events: [],
      assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf" }],
    });
    expect(block?.assets).toEqual([]);
  });
});
```

Импорт `normalizeFeedback` в этом файле уже есть; если нет — добавь его из `../result-context`.

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npm test -- shared/template/__tests__/result-context-measures.test.ts`
Expected: FAIL — первый кейс возвращает пустой массив (адрес читается только из `scormHref`).

- [ ] **Step 3: Расширить контракт дескриптора**

В `shared/schema.ts` замени тело `feedbackAssetSchema`:

```ts
export const feedbackAssetSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.literal("application/pdf"),
  /**
   * Canonical media-library address (`/api/media/<id>`), written by the editor as soon as
   * the file is uploaded. A plain string on purpose: the media walker recognises addresses
   * inside any field, so the usage index and the SCORM packer need no special branch here.
   */
  url: z.string().optional(),
  /**
   * Read-only legacy field: packages exported before the media library existed carry the
   * in-package address here. Nothing writes it any more — the packer rewrites `url` itself.
   */
  scormHref: z.string().optional(),
});
```

В `client/src/features/tests/editor/test-editor.types.ts` приведи тип к той же форме:

```ts
/**
 * PDF asset attached to feedback. `url` is the canonical media-library address written by
 * the editor right after the upload; `scormHref` is the legacy in-package address kept for
 * reading old data only.
 */
export type FeedbackAsset = {
  id?: string;
  title: string;
  fileName: string;
  mimeType: "application/pdf";
  url?: string;
  scormHref?: string;
};
```

- [ ] **Step 4: Научить `normalizeFeedback` читать оба поля**

В `shared/template/result-context.ts` замени объявление `assets` и его отображение:

```ts
  const assets = (f.assets as Array<{ title?: string; url?: string; scormHref?: string }> | undefined) ?? [];
```

```ts
    assets: assets
      // `url` wins: inside a package it is what the packer rewrote to a working relative
      // path, while `scormHref` is a legacy field nothing writes any more. `||` and not `??`
      // on purpose — an empty string is an absent address, not a value.
      .map((a) => ({ title: String(a.title ?? ""), url: String(a.url || a.scormHref || "") }))
      .filter((a) => !!a.url),
```

Обнови в этом же файле блок документации функции: адрес живёт в `url`, `scormHref` читается ради
ранее собранных данных и проигрывает `url`.

- [ ] **Step 4a: Привести в порядок комментарии о неидемпотентности**

С этой правкой `normalizeFeedback` становится идемпотентным по вложениям: выход `{ title, url }`
переживает второй проход, тогда как раньше нормализованный блок терял `scormHref` и лишался вложений.
Три места утверждают обратное и становятся ложными — правь ТОЛЬКО комментарии, поведение не трогай:

- `shared/template/runtime-entry.ts:44-46` и `server/scorm/template/app/render/viewResults.js:179-181` —
  «deliberately NOT idempotent» больше не так. Правило «ровно один проход на хосте» остаётся, но
  обоснование переписывается: повторный проход теперь безвреден, блок нормализуется в одном месте,
  чтобы правило жило в одном экземпляре;
- `server/services/result-context.ts:58,114` — утверждают, что адрес вложения живёт в `scormHref`.
  Теперь он живёт в `url`, а `scormHref` остаётся легаси-полем чтения.

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -- shared/template/__tests__/result-context-measures.test.ts`
Expected: PASS (включая ранее существовавшие кейсы со `scormHref`).

- [ ] **Step 6: Проверить типы**

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add shared/schema.ts shared/template/result-context.ts \
  client/src/features/tests/editor/test-editor.types.ts \
  shared/template/__tests__/result-context-measures.test.ts
git commit -m "feat(prd-32): дескриптор вложения несёт канонический адрес медиатеки"
```

---

### Task 2: Мэппер редактора не теряет адрес при сохранении

**Files:**

- Modify: `client/src/features/tests/editor/test-editor.mappers.ts:526-528` (только документация)
- Test: `client/src/features/tests/editor/__tests__/test-editor.mappers.branches.test.ts:939`

`stripScormHref` уже переносит остальные поля через `...rest`, поэтому `url` доживает до payload сам.
Задача фиксирует это тестом, чтобы будущая «уборка» не срезала адрес заодно со `scormHref`.

- [ ] **Step 1: Написать тест**

В `client/src/features/tests/editor/__tests__/test-editor.mappers.branches.test.ts` рядом с
существующим кейсом `strips scormHref from feedback assets` добавь:

```ts
  it("keeps the canonical url on feedback assets", () => {
    const payload = toTestPayload(
      makeDraft({
        basic: {
          feedback: {
            format: "plain",
            text: "",
            links: [],
            events: [],
            assets: [
              {
                id: "a1",
                title: "T",
                fileName: "f.pdf",
                mimeType: "application/pdf",
                url: "/api/media/33333333-3333-3333-3333-333333333333",
                scormHref: "feedback/f.pdf",
              },
            ],
          },
        },
      }),
    );
    expect(payload.feedbackJson.assets[0]).not.toHaveProperty("scormHref");
    expect(payload.feedbackJson.assets[0].url).toBe("/api/media/33333333-3333-3333-3333-333333333333");
  });
```

Форму вызова (`toTestPayload`, `makeDraft`) возьми дословно из соседнего кейса в этом же файле —
у него та же обвязка.

- [ ] **Step 2: Прогнать тест**

Run: `npm test -- client/src/features/tests/editor/__tests__/test-editor.mappers.branches.test.ts`
Expected: PASS сразу — тест закрепляет уже верное поведение. Если он падает, значит `url` где-то
срезается: найди место и убери срез, оставив срез `scormHref`.

- [ ] **Step 3: Обновить документацию мэппера**

В `test-editor.mappers.ts` над `stripScormHref` замени комментарий:

```ts
/**
 * Strip `scormHref` from assets — decisions §6.5. The canonical `url` is deliberately kept:
 * it is what the backend indexes and what the packer rewrites (PRD-32).
 */
```

- [ ] **Step 4: Коммит**

```bash
git add client/src/features/tests/editor/test-editor.mappers.ts \
  client/src/features/tests/editor/__tests__/test-editor.mappers.branches.test.ts
git commit -m "test(prd-32): адрес вложения доживает до payload редактора"
```

---

### Task 3: Сервер проверяет вложение по назначению загрузки

**Files:**

- Modify: `server/routes/media.ts:41-93`
- Test: `tests/media-upload-route.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Добавь в `tests/media-upload-route.test.ts` новый блок (обвязка `makeApp` и моки уже есть в файле):

```ts
describe("POST /upload?purpose=feedback-asset", () => {
  it("отклоняет не-PDF", async () => {
    const res = await request(makeApp("author-1"))
      .post("/api/media/upload?purpose=feedback-asset")
      .attach("file", Buffer.from("not a pdf"), { filename: "pic.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("feedback_asset_invalid");
    expect(storageMock.createMediaAsset).not.toHaveBeenCalled();
  });

  it("отклоняет файл больше 5 МБ", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x20);
    const res = await request(makeApp("author-1"))
      .post("/api/media/upload?purpose=feedback-asset")
      .attach("file", big, { filename: "big.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("feedback_asset_invalid");
  });

  it("пропускает PDF в пределах лимита", async () => {
    storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue(undefined);
    storageMock.createMediaAsset.mockResolvedValue({
      id: "asset-1",
      mimeType: "application/pdf",
      byteSize: 5,
    });
    const res = await request(makeApp("author-1"))
      .post("/api/media/upload?purpose=feedback-asset")
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "memo.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("/api/media/asset-1");
  });
});
```

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `npm test -- tests/media-upload-route.test.ts`
Expected: FAIL — первые два кейса получают `200`, потому что проверки нет.

- [ ] **Step 3: Реализовать проверку**

В `server/routes/media.ts` добавь константу рядом с `kindOf`:

```ts
/**
 * Feedback attachments are the one upload with a narrow contract (spec §8): the shared
 * filter admits 200 MB of any image, audio or video, which is right for question media and
 * far too wide for a PDF handed to a learner. The narrow rule lives here rather than in the
 * multer filter because only the request knows what the file is FOR.
 */
const FEEDBACK_ASSET_MAX_BYTES = 5 * 1024 * 1024;
```

И вставь проверку в обработчик `POST /upload` сразу после `if (!req.file) …`:

```ts
  if (req.query.purpose === "feedback-asset") {
    const wrongType = req.file.mimetype !== "application/pdf";
    const tooBig = req.file.size > FEEDBACK_ASSET_MAX_BYTES;
    if (wrongType || tooBig) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({
        error: "feedback_asset_invalid",
        message: wrongType
          ? "Вложением обратной связи может быть только PDF"
          : "Размер вложения не должен превышать 5 МБ",
      });
    }
  }
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test -- tests/media-upload-route.test.ts`
Expected: PASS, включая существующие кейсы маршрута.

- [ ] **Step 5: Коммит**

```bash
git add server/routes/media.ts tests/media-upload-route.test.ts
git commit -m "feat(prd-32): строгая проверка вложения обратной связи на сервере"
```

---

### Task 4: Модалка загружает PDF немедленно

**Files:**

- Modify: `client/src/features/tests/editor/sections/feedback-editor-modal.tsx:84-92,229-256,567-640`
- Test: `tests/feedback-editor-modal-upload.test.tsx` (создать)

- [ ] **Step 1: Написать падающий тест**

Создай `tests/feedback-editor-modal-upload.test.tsx`:

```tsx
/**
 * @module tests/feedback-editor-modal-upload
 * @description Выбор PDF отправляет файл на сервер сразу и кладёт канонический адрес в
 * дескриптор. Без этого автор сохраняет вложение, которого нигде нет (PRD-32).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { FeedbackEditorModal } from "../client/src/features/tests/editor/sections/feedback-editor-modal";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ id: "asset-1", url: "/api/media/asset-1", mime: "application/pdf", size: 10 }),
  });
});

function open(onSave: (value: unknown) => void) {
  render(
    <FeedbackEditorModal
      open
      title="Обратная связь"
      value={{ format: "plain", text: "", links: [], assets: [], events: [] }}
      onCancel={() => {}}
      onSave={onSave}
      testId="fb"
    />,
  );
}

describe("FeedbackEditorModal — загрузка вложения", () => {
  it("шлёт файл на /api/media/upload с назначением и сохраняет адрес", async () => {
    const onSave = vi.fn();
    open(onSave);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["%PDF-1.4"], "memo.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/media/upload?purpose=feedback-asset",
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(screen.getByText("memo.pdf")).toBeTruthy());

    fireEvent.click(screen.getByText("Сохранить"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: [expect.objectContaining({ fileName: "memo.pdf", url: "/api/media/asset-1" })],
      }),
    );
  });

  it("показывает отказ сервера и не добавляет вложение", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "feedback_asset_invalid", message: "Размер вложения не должен превышать 5 МБ" }),
    });
    const onSave = vi.fn();
    open(onSave);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "big.pdf", { type: "application/pdf" })] },
    });

    await waitFor(() => expect(screen.getByText(/не должен превышать/i)).toBeTruthy());
    fireEvent.click(screen.getByText("Сохранить"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assets: [] }));
  });
});
```

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `npm test -- tests/feedback-editor-modal-upload.test.tsx`
Expected: FAIL — `fetch` не вызывается, файл кладётся в черновик локально.

- [ ] **Step 3: Заменить черновой тип и обработчик выбора**

В `feedback-editor-modal.tsx` замени объявление `DraftAsset`:

```ts
/**
 * Draft-only asset. Extends the canonical descriptor with UI-only fields:
 *   `size` — bytes shown as «245 KB» next to the file name.
 * The file itself is no longer kept: it goes to the server the moment it is picked, and the
 * descriptor carries the address it came back with (PRD-32).
 */
type DraftAsset = FeedbackAsset & { size?: number };
```

Рядом с состоянием `oversizedFiles` добавь состояние отказов и признак загрузки:

```ts
  /** Server-side rejections and network failures, shown in the same banner slot. */
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  /** Number of uploads in flight — disables «Сохранить» so a half-uploaded list is not saved. */
  const [uploading, setUploading] = useState(0);
```

Добавь загрузчик над `handleFilePick`:

```ts
  /** Sends one file to the media library and returns its canonical address. */
  async function uploadFeedbackAsset(file: File): Promise<string | { error: string }> {
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/media/upload?purpose=feedback-asset", {
        method: "POST",
        body,
        credentials: "include",
      });
      const payload = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !payload.url) {
        return { error: `${file.name}: ${payload.message ?? "не удалось загрузить файл"}` };
      }
      return payload.url;
    } catch {
      return { error: `${file.name}: не удалось загрузить файл` };
    }
  }
```

И замени `handleFilePick` целиком:

```ts
  /** Handle file picker change: validate size, upload, then build draft assets. */
  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
    const oversized = files.filter((f) => f.size > MAX_BYTES);
    setOversizedFiles(oversized.map((f) => f.name));
    setUploadErrors([]);
    const valid = files.filter((f) => f.size <= MAX_BYTES);
    // Reset before awaiting: the input must be re-selectable even while an upload is running.
    e.target.value = "";
    if (valid.length === 0) return;

    setUploading((n) => n + valid.length);
    for (const file of valid) {
      const result = await uploadFeedbackAsset(file);
      setUploading((n) => n - 1);
      if (typeof result !== "string") {
        setUploadErrors((prev) => [...prev, result.error]);
        continue;
      }
      setDraft((d) => ({
        ...d,
        assets: [
          ...d.assets,
          {
            title: file.name.replace(/\.pdf$/i, ""),
            fileName: file.name,
            mimeType: "application/pdf" as const,
            size: file.size,
            url: result,
          },
        ],
      }));
    }
  }
```

Обнови `handleSave`, чтобы срезалось только UI-поле `size`:

```ts
  /** Strip the UI-only `size` before emitting to the caller. */
  function handleSave() {
    const canonical: FeedbackEditorValue = {
      ...draft,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      assets: draft.assets.map(({ size: _s, ...rest }) => rest),
    };
    props.onSave(canonical);
  }
```

- [ ] **Step 4: Показать отказы и заблокировать сохранение во время загрузки**

Рядом с баннером `oversizedFiles` (около строки 300) добавь второй баннер:

```tsx
        {uploadErrors.length > 0 && (
          <Banner
            tone="danger"
            title="Файл не загружен"
            description={uploadErrors.join(", ")}
            onClose={() => setUploadErrors([])}
          />
        )}
```

Свойства `tone`/`title`/`description`/`onClose` возьми дословно такими же, как у соседнего баннера
`oversizedFiles` в этом файле — если там иной набор свойств, повтори его.

Кнопке «Сохранить» в подвале добавь `disabled={uploading > 0}`, а её подписи — состояние загрузки:

```tsx
          {uploading > 0 ? "Загрузка…" : "Сохранить"}
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -- tests/feedback-editor-modal-upload.test.tsx`
Expected: PASS.

Run: `npm test -- client/src/features/tests/editor/sections/__tests__/feedback-preview.test.tsx`
Expected: PASS — соседний предпросмотр не задет.

- [ ] **Step 6: Проверить типы**

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add client/src/features/tests/editor/sections/feedback-editor-modal.tsx \
  tests/feedback-editor-modal-upload.test.tsx
git commit -m "feat(prd-32): редактор загружает вложение сразу при выборе файла"
```

---

### Task 5: Дескриптор без файла помечен и заменяем

**Files:**

- Modify: `client/src/features/tests/editor/sections/feedback-editor-modal.tsx:567-640`
- Test: `tests/feedback-editor-modal-upload.test.tsx`

- [ ] **Step 1: Написать падающий тест**

Добавь в `tests/feedback-editor-modal-upload.test.tsx`:

```tsx
describe("FeedbackEditorModal — дескриптор без файла", () => {
  it("помечает вложение без адреса и заменяет его загруженным файлом", async () => {
    const onSave = vi.fn();
    render(
      <FeedbackEditorModal
        open
        title="Обратная связь"
        value={{
          format: "plain",
          text: "",
          links: [],
          events: [],
          assets: [{ title: "Памятка", fileName: "memo.pdf", mimeType: "application/pdf" }],
        }}
        onCancel={() => {}}
        onSave={onSave}
        testId="fb"
      />,
    );

    expect(screen.getByText(/файл не загружен/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId("feedback-editor-asset-replace-0"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["%PDF-1.4"], "memo.pdf", { type: "application/pdf" })] },
    });

    await waitFor(() => expect(screen.queryByText(/файл не загружен/i)).toBeNull());
    fireEvent.click(screen.getByText("Сохранить"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ assets: [expect.objectContaining({ url: "/api/media/asset-1" })] }),
    );
  });
});
```

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `npm test -- tests/feedback-editor-modal-upload.test.tsx`
Expected: FAIL — метки нет, кнопки замены нет.

- [ ] **Step 3: Реализовать метку и замену**

Добавь состояние индекса замены рядом с `uploadErrors`:

```ts
  /**
   * Index of the descriptor being re-uploaded, or `null` for a plain add. Descriptors saved
   * before PRD-32 have no address at all: the file was never stored, so the author is shown
   * the truth and offered to upload it now.
   */
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
```

В `handleFilePick` после успешной загрузки первого файла учти замену — замени тело `setDraft` внутри
цикла на:

```ts
      setDraft((d) => {
        const asset: DraftAsset = {
          title: file.name.replace(/\.pdf$/i, ""),
          fileName: file.name,
          mimeType: "application/pdf" as const,
          size: file.size,
          url: result,
        };
        if (replaceIndex === null) return { ...d, assets: [...d.assets, asset] };
        const assets = [...d.assets];
        // Replacing keeps the author's own title: only the missing file is being supplied.
        assets[replaceIndex] = { ...asset, title: assets[replaceIndex].title };
        return { ...d, assets };
      });
```

И сбрось признак в конце `handleFilePick`:

```ts
    setReplaceIndex(null);
```

В разметке списка вложений (внутри `draft.assets.map`) под именем файла добавь ветку:

```tsx
                        {!asset.url && !asset.scormHref ? (
                          <div className="tb-feedback-editor__asset-file">
                            Файл не загружен
                            <Button
                              variant="ghost"
                              size="s"
                              onClick={() => {
                                setReplaceIndex(i);
                                fileInputRef.current?.click();
                              }}
                              data-testid={`feedback-editor-asset-replace-${i}`}
                            >
                              Загрузить файл
                            </Button>
                          </div>
                        ) : null}
```

Кнопке «Загрузить PDF» добавь сброс признака, чтобы обычное добавление не попало в замену:

```tsx
                onClick={() => {
                  setReplaceIndex(null);
                  fileInputRef.current?.click();
                }}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test -- tests/feedback-editor-modal-upload.test.tsx`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add client/src/features/tests/editor/sections/feedback-editor-modal.tsx \
  tests/feedback-editor-modal-upload.test.tsx
git commit -m "feat(prd-32): вложение без файла помечено и заменяемо в редакторе"
```

---

### Task 6: Резолвер ссылок на реестр для упаковщика

**Files:**

- Create: `server/scorm/builders/media-resolver.ts`
- Test: `tests/scorm-media-resolver.test.ts` (создать)

- [ ] **Step 1: Написать падающий тест**

Создай `tests/scorm-media-resolver.test.ts`:

```ts
/**
 * @module tests/scorm-media-resolver
 * @description Резолв ссылки медиатеки в байты для SCORM-пакета: реестр -> хранилище, с
 * запасным чтением с диска для легаси-адреса, чей файл в реестр не попал.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

const { storageMock, storeMock } = vi.hoisted(() => ({
  storageMock: { getMediaAsset: vi.fn(), getMediaAssetByStorageKey: vi.fn() },
  storeMock: { openRead: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/media/media-store", () => ({ mediaStore: storeMock }));

import { registryMediaResolver } from "../server/scorm/builders/media-resolver";

const ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  storeMock.openRead.mockResolvedValue(Readable.from([Buffer.from("bytes")]));
});

describe("registryMediaResolver", () => {
  it("резолвит канонический адрес в байты и путь внутри пакета", async () => {
    storageMock.getMediaAsset.mockResolvedValue({
      id: ID,
      storageKey: `media/ab/cd/${"a".repeat(64)}.png`,
      mimeType: "image/png",
      originalName: "picture.png",
    });
    const resolved = await registryMediaResolver({ kind: "canonical", id: ID });
    expect(resolved).toEqual({ zipPath: `assets/media/${ID}.png`, buffer: Buffer.from("bytes") });
  });

  it("берёт расширение из MIME, когда исходное имя без него", async () => {
    storageMock.getMediaAsset.mockResolvedValue({
      id: ID,
      storageKey: "media/ab/cd/x",
      mimeType: "application/pdf",
      originalName: "памятка",
    });
    const resolved = await registryMediaResolver({ kind: "canonical", id: ID });
    expect(resolved?.zipPath).toBe(`assets/media/${ID}.pdf`);
  });

  it("возвращает null, когда актива нет в реестре", async () => {
    storageMock.getMediaAsset.mockResolvedValue(undefined);
    expect(await registryMediaResolver({ kind: "canonical", id: ID })).toBeNull();
  });

  it("легаси-адрес резолвится через storage key и сохраняет исторический путь в пакете", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue({
      id: ID,
      storageKey: "media/track.mp3",
      mimeType: "audio/mpeg",
      originalName: "track.mp3",
    });
    const resolved = await registryMediaResolver({ kind: "legacy", storageKey: "media/track.mp3" });
    expect(resolved?.zipPath).toBe("assets/media/track.mp3");
  });
});
```

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `npm test -- tests/scorm-media-resolver.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать модуль**

Создай `server/scorm/builders/media-resolver.ts`:

```ts
/**
 * @module server/scorm/builders/media-resolver
 *
 * Turns a media reference into the bytes and the in-package path the SCORM packer needs.
 *
 * It exists as its own module so the packer itself stays a pure string walk: the packer knows
 * nothing about the registry or the store, and the tests of each side stay independent. The
 * ONLY recogniser of an address is `media-refs` — the same one the usage index uses, because
 * two ideas of "what a media reference is" would drift silently (spec §5).
 */
import fs from "node:fs";
import path from "node:path";
import type { MediaRef } from "../../services/media/media-refs";
import { mediaStore } from "../../services/media/media-store";
import { storage } from "../../storage";

/** What the packer needs to place one file into the ZIP. */
export interface ResolvedMedia {
  /** Path inside the package, e.g. `assets/media/<id>.png`. */
  zipPath: string;
  buffer: Buffer;
}

/** Extension by MIME for assets whose original name carries none. */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
};

/** Reads a whole stream into memory: the packer builds the ZIP from buffers. */
async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** The legacy root: files indexed in place by the backfill still live under it. */
const uploadsRoot = path.resolve(process.cwd(), "uploads");

/**
 * Resolves one reference, or `null` when nothing can be delivered.
 *
 * A canonical reference is named by the asset id, so the file inside the package is named by it
 * too — one asset used twice is packed once. A legacy reference keeps its historical path
 * (`assets/media/<file>`), so packages built before and after this work address it identically.
 */
export async function registryMediaResolver(ref: MediaRef): Promise<ResolvedMedia | null> {
  if (ref.kind === "canonical") {
    const asset = await storage.getMediaAsset(ref.id);
    if (!asset) return null;
    const ext = path.extname(asset.originalName ?? "").toLowerCase() || EXT_BY_MIME[asset.mimeType] || ".bin";
    const buffer = await readStored(asset.storageKey);
    if (!buffer) return null;
    return { zipPath: `assets/media/${asset.id}${ext}`, buffer };
  }

  const asset = await storage.getMediaAssetByStorageKey(ref.storageKey);
  const buffer = asset ? await readStored(asset.storageKey) : readFromDisk(ref.storageKey);
  if (!buffer) return null;
  return { zipPath: `assets/${ref.storageKey}`, buffer };
}

/** Reads bytes through the storage port; `null` if the object has gone. */
async function readStored(storageKey: string): Promise<Buffer | null> {
  try {
    return await readAll(await mediaStore.openRead(storageKey));
  } catch {
    return null;
  }
}

/**
 * The last resort for a legacy address whose file never reached the registry. Kept because the
 * switch-off of the static mount must not also silently empty packages of older content.
 */
function readFromDisk(storageKey: string): Buffer | null {
  const abs = path.resolve(uploadsRoot, storageKey);
  const rootWithSep = uploadsRoot.endsWith(path.sep) ? uploadsRoot : uploadsRoot + path.sep;
  if (abs !== uploadsRoot && !abs.startsWith(rootWithSep)) return null;
  try {
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test -- tests/scorm-media-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/scorm/builders/media-resolver.ts tests/scorm-media-resolver.test.ts
git commit -m "feat(scorm): резолвер ссылок медиатеки для сборки пакета"
```

---

### Task 7: Упаковщик распознаёт адрес медиатеки

**Files:**

- Modify: `server/scorm/builders/media-assets.ts` (переписывается целиком)
- Modify: `server/scorm/index.ts:201`
- Test: `tests/scorm-media-assets.test.ts`

- [ ] **Step 1: Написать падающий тест**

Добавь в `tests/scorm-media-assets.test.ts` новый блок:

```ts
describe("extractEmbeddedMediaIntoAssets — канонический адрес медиатеки", () => {
  const ID = "11111111-1111-1111-1111-111111111111";

  it("пакует файл и переписывает адрес на путь внутри пакета", async () => {
    const resolveRef = vi.fn().mockResolvedValue({
      zipPath: `assets/media/${ID}.png`,
      buffer: Buffer.from("png-bytes"),
    });
    const testObj = { mediaUrl: `/api/media/${ID}` };
    const { assets, missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(missing).toHaveLength(0);
    expect(assets[`assets/media/${ID}.png`]).toEqual(Buffer.from("png-bytes"));
    expect(testObj.mediaUrl).toBe(`assets/media/${ID}.png`);
  });

  it("переписывает адрес внутри разметки контентной страницы", async () => {
    const resolveRef = vi.fn().mockResolvedValue({
      zipPath: `assets/media/${ID}.png`,
      buffer: Buffer.from("png-bytes"),
    });
    const testObj = { html: `<img src="/api/media/${ID}" alt="">` };
    await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    expect(testObj.html).toBe(`<img src="assets/media/${ID}.png" alt="">`);
  });

  it("пакует один актив один раз при двух ссылках", async () => {
    const resolveRef = vi.fn().mockResolvedValue({
      zipPath: `assets/media/${ID}.png`,
      buffer: Buffer.from("png-bytes"),
    });
    const testObj = { a: { mediaUrl: `/api/media/${ID}` }, b: { mediaUrl: `/api/media/${ID}` } };
    const { assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    expect(Object.keys(assets)).toHaveLength(1);
    expect(resolveRef).toHaveBeenCalledTimes(1);
  });

  it("пакует адрес вложения обратной связи", async () => {
    const resolveRef = vi.fn().mockResolvedValue({
      zipPath: `assets/media/${ID}.pdf`,
      buffer: Buffer.from("%PDF"),
    });
    const testObj = {
      feedbackJson: { assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${ID}` }] },
    };
    await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    expect(testObj.feedbackJson.assets[0].url).toBe(`assets/media/${ID}.pdf`);
  });
});
```

Существующие кейсы файла тоже переводятся на `await` — это Step 4.

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `npm test -- tests/scorm-media-assets.test.ts`
Expected: FAIL — функция синхронная и канонический адрес не распознаёт.

- [ ] **Step 3: Переписать упаковщик**

Замени `server/scorm/builders/media-assets.ts` целиком:

```ts
/**
 * @module server/scorm/builders/media-assets
 *
 * Makes the package self-contained: every address the content holds is replaced by a path
 * inside the ZIP, and the bytes travel with it.
 *
 * Three address shapes are handled — an inline `data:` URL, the canonical media-library
 * address `/api/media/<id>`, and the pre-registry `/uploads/media/<file>`. Recognition of the
 * latter two is delegated to `media-refs`, the same walker the usage index uses.
 *
 * Resolving a reference to bytes is NOT this module's job: it takes a `resolveRef` port, so it
 * stays a pure string walk and its tests need neither database nor filesystem.
 *
 * An address that cannot be resolved is BLANKED rather than left in place. A package that
 * carries an absolute address to the Skill'Um server is not self-contained: inside an LMS it is
 * a foreign origin with no session, so the learner would meet a broken picture instead of an
 * absent one. The reason is reported through `missing`.
 */
import { nanoid } from "nanoid";
import { findMediaRefsInText, type MediaRef } from "../../services/media/media-refs";
import type { ResolvedMedia } from "./media-resolver";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",

  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",

  "video/mp4": "mp4",
  "video/webm": "webm",

  "application/pdf": "pdf",
};

/** Resolves a reference to bytes, or `null` when nothing can be delivered. */
export type MediaRefResolver = (ref: MediaRef) => Promise<ResolvedMedia | null>;

export interface ExtractOptions {
  resolveRef: MediaRefResolver;
}

function parseDataUrl(input: string): { mime: string; buffer: Buffer } | null {
  if (!input) return null;
  const m = /^data:([^;]+);base64,(.+)$/i.exec(input.trim());
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], "base64") };
}

/** The textual form of a reference — what has to be replaced inside the string. */
function addressOf(ref: MediaRef): string {
  return ref.kind === "canonical" ? `/api/media/${ref.id}` : `/uploads/${ref.storageKey}`;
}

export async function extractEmbeddedMediaIntoAssets(
  testObj: any,
  opts: ExtractOptions,
): Promise<{ testObj: any; assets: Record<string, Buffer>; missing: string[] }> {
  const assets: Record<string, Buffer> = {};
  const missing: string[] = [];
  /** Decisions already taken, so one asset referenced ten times is resolved once. */
  const decided = new Map<string, string | null>();

  async function zipPathFor(ref: MediaRef): Promise<string | null> {
    const address = addressOf(ref);
    const known = decided.get(address);
    if (known !== undefined) return known;

    const resolved = await opts.resolveRef(ref);
    if (!resolved) {
      missing.push(`unresolved media reference: ${address}`);
      decided.set(address, null);
      return null;
    }
    assets[resolved.zipPath] = resolved.buffer;
    decided.set(address, resolved.zipPath);
    return resolved.zipPath;
  }

  /** Rewrites every reference inside one string; returns the new value. */
  async function packString(input: string): Promise<string> {
    const parsed = parseDataUrl(input);
    if (parsed) {
      const ext = EXT_BY_MIME[parsed.mime] || "bin";
      const zipPath = `assets/media/${nanoid(10)}.${ext}`;
      assets[zipPath] = parsed.buffer;
      return zipPath;
    }

    let out = input;
    for (const ref of findMediaRefsInText(input)) {
      const address = addressOf(ref);
      const zipPath = await zipPathFor(ref);
      out = out.split(address).join(zipPath ?? "");
    }
    return out;
  }

  async function visit(node: any): Promise<void> {
    if (!node || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value) || (value && typeof value === "object")) {
        await visit(value);
      } else if (typeof value === "string") {
        const packed = await packString(value);
        if (packed !== value) node[key] = packed;
      }
    }
  }

  await visit(testObj);

  return { testObj, assets, missing };
}
```

- [ ] **Step 4: Обновить существующие тесты файла под асинхронный вызов**

Каждый существующий кейс в `tests/scorm-media-assets.test.ts` получает `async` и `await`, а вместо
моков `node:fs` — фиктивный `resolveRef`. Легаси-кейсы переписываются так:

```ts
describe("extractEmbeddedMediaIntoAssets — /uploads/ file paths", () => {
  it("embeds an existing upload file into assets", async () => {
    const resolveRef = vi.fn().mockResolvedValue({
      zipPath: "assets/media/track.mp3",
      buffer: Buffer.from("audio-data"),
    });
    const testObj = { mediaUrl: "/uploads/media/track.mp3" };
    const { assets, missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(missing).toHaveLength(0);
    expect(assets["assets/media/track.mp3"]).toEqual(Buffer.from("audio-data"));
    expect(testObj.mediaUrl).toBe("assets/media/track.mp3");
  });

  it("очищает адрес, когда файл не резолвится", async () => {
    const resolveRef = vi.fn().mockResolvedValue(null);
    const testObj = { mediaUrl: "/uploads/media/ghost.mp3" };
    const { assets, missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/unresolved/i);
    expect(Object.keys(assets)).toHaveLength(0);
    // Пакет обязан быть автономным: абсолютный адрес наружу не уезжает.
    expect(testObj.mediaUrl).toBe("");
  });

  it("deduplicates the same upload file referenced multiple times", async () => {
    const resolveRef = vi.fn().mockResolvedValue({
      zipPath: "assets/media/shared.mp3",
      buffer: Buffer.from("shared-audio"),
    });
    const testObj = {
      q1: { mediaUrl: "/uploads/media/shared.mp3" },
      q2: { mediaUrl: "/uploads/media/shared.mp3" },
    };
    const { assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(resolveRef).toHaveBeenCalledTimes(1);
    expect(Object.keys(assets)).toHaveLength(1);
  });
});
```

Кейс `blocks path traversal attempts` удали: обходчик `media-refs` отбрасывает сегменты `..` сам
([`media-refs.ts:74`](../../../server/services/media/media-refs.ts)), а чтение с диска ушло в
резолвер, где своя проверка корня. Взамен добавь:

```ts
  it("не трогает адрес с выходом за каталог", async () => {
    const resolveRef = vi.fn().mockResolvedValue(null);
    const testObj = { mediaUrl: "/uploads/media/../../../etc/passwd" };
    await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    expect(resolveRef).not.toHaveBeenCalled();
  });
```

Моки `node:fs` в начале файла удали целиком — модуль больше не читает диск.

- [ ] **Step 5: Подключить резолвер в сборке пакета**

В `server/scorm/index.ts` замени импорт и вызов:

```ts
import { extractEmbeddedMediaIntoAssets } from "./builders/media-assets";
import { registryMediaResolver } from "./builders/media-resolver";
```

```ts
  const { testObj: patchedTestObj, assets, missing } = await extractEmbeddedMediaIntoAssets(testObj, {
    resolveRef: registryMediaResolver,
  });
  // Молчаливая потеря медиа — то, из-за чего дефект упаковки прожил незамеченным: адрес
  // очищен, файла в пакете нет, и без этой записи об этом не узнал бы никто.
  if (missing.length > 0) {
    logger.warn(`SCORM package ${data.test.id}: ${missing.length} media reference(s) unresolved: ${missing.join("; ")}`);
  }
```

Если `logger` в этом модуле ещё не импортирован, добавь `import { logger } from "../logger";`.

- [ ] **Step 6: Прогнать тесты**

Run: `npm test -- tests/scorm-media-assets.test.ts tests/scorm-media-resolver.test.ts`
Expected: PASS.

Run: `npm test -- tests/scorm-export.test.ts tests/scorm-builders.test.ts`
Expected: PASS — сборка пакета не сломана.

- [ ] **Step 7: Проверить типы**

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 8: Коммит**

```bash
git add server/scorm/builders/media-assets.ts server/scorm/index.ts tests/scorm-media-assets.test.ts
git commit -m "feat(scorm): упаковка медиа по адресу реестра, включая вложения обратной связи"
```

---

### Task 8: Гард — в собранном пакете нет абсолютных адресов

**Files:**

- Test: `tests/scorm-package-media-guard.test.ts` (создать)

- [ ] **Step 1: Написать тест**

Создай `tests/scorm-package-media-guard.test.ts`:

```ts
/**
 * @module tests/scorm-package-media-guard
 * @description Гард автономности пакета: в собранных данных не остаётся ни одного адреса,
 * ведущего на сервер Skill'Ум. Именно отсутствие такой проверки позволило упаковщику молча
 * перестать класть медиа в ZIP после появления медиатеки (PRD-32).
 */
import { describe, it, expect, vi } from "vitest";
import { extractEmbeddedMediaIntoAssets } from "../server/scorm/builders/media-assets";

const ID = "11111111-1111-1111-1111-111111111111";

describe("автономность собранных данных пакета", () => {
  it("не оставляет адресов /api/media и /uploads ни в одном поле", async () => {
    const resolveRef = vi.fn().mockImplementation(async (ref) =>
      ref.kind === "canonical"
        ? { zipPath: `assets/media/${ref.id}.png`, buffer: Buffer.from("x") }
        : { zipPath: `assets/${ref.storageKey}`, buffer: Buffer.from("y") },
    );

    const testObj = {
      questions: [{ mediaUrl: `/api/media/${ID}` }, { mediaUrl: "/uploads/media/old.png" }],
      pages: [{ html: `<img src="/api/media/${ID}"><img src="/uploads/media/old.png">` }],
      designSettings: { background: `/api/media/${ID}` },
      feedbackJson: { assets: [{ title: "П", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${ID}` }] },
    };

    const { testObj: packed } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    const serialised = JSON.stringify(packed);

    expect(serialised).not.toContain("/api/media/");
    expect(serialised).not.toContain("/uploads/");
  });

  it("нерезолвленный адрес тоже не остаётся в данных", async () => {
    const resolveRef = vi.fn().mockResolvedValue(null);
    const testObj = { questions: [{ mediaUrl: `/api/media/${ID}` }] };
    const { testObj: packed, missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(JSON.stringify(packed)).not.toContain("/api/media/");
    expect(missing).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Прогнать тест**

Run: `npm test -- tests/scorm-package-media-guard.test.ts`
Expected: PASS (Task 7 уже даёт нужное поведение; тест закрепляет его как требование).

- [ ] **Step 3: Коммит**

```bash
git add tests/scorm-package-media-guard.test.ts
git commit -m "test(scorm): гард автономности пакета по адресам медиа"
```

---

### Task 9: Новый тип использования и резолв доступа

**Files:**

- Modify: `shared/schema.ts:1888-1890`
- Modify: `server/services/media/asset-access.ts:60-96`
- Test: `tests/media-asset-access.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Добавь в `tests/media-asset-access.test.ts` (обвязку моков возьми из начала файла — там уже мокнут
`../server/storage`; при необходимости дополни мок методами `getTopic`, `getTestSectionsByTopic`):

```ts
describe("резолв обратной связи в тесты", () => {
  it("обратная связь темы ведёт к тестам, где тема стоит разделом", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([
      { entityType: "topic_feedback", entityId: "topic-1", field: "feedbackJson.assets.0.url" },
    ]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([{ testId: "test-1" }]);
    storageMock.isTestAssignedToUser.mockResolvedValue(true);

    const allowed = await canDeliverAsset(
      { id: "a1", ownerId: "author-9", visibility: "private" } as never,
      "learner-1",
      ["learner"],
    );
    expect(allowed).toBe(true);
    expect(storageMock.getTestSectionsByTopic).toHaveBeenCalledWith("topic-1");
  });

  it("обратная связь шкалы и показателя ключуется тестом", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([
      { entityType: "scale_feedback", entityId: "test-7", field: "0.interpretation.bands.1.feedback.assets.0.url" },
      { entityType: "variable_feedback", entityId: "test-8", field: "0.interpretation.outcomes.0.feedback.assets.0.url" },
    ]);
    storageMock.isTestAssignedToUser.mockImplementation(async (testId: string) => testId === "test-8");

    const allowed = await canDeliverAsset(
      { id: "a2", ownerId: "author-9", visibility: "private" } as never,
      "learner-1",
      ["learner"],
    );
    expect(allowed).toBe(true);
    expect(storageMock.isTestAssignedToUser).toHaveBeenCalledWith("test-7", "learner-1");
  });
});
```

Между кейсами вызывай `clearAssetAccessCache()` (экспортируется тем же модулем) — иначе решение по
первому кейсу переживёт второй.

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `npm test -- tests/media-asset-access.test.ts`
Expected: FAIL — новые типы попадают в ветку `default` и доступ не выдаётся.

- [ ] **Step 3: Добавить тип в перечень**

В `shared/schema.ts` в объявлении `mediaUsages` замени перечень:

```ts
  entityType: text("entity_type", {
    enum: [
      "question",
      "content_page",
      "test_design",
      "test_feedback",
      "topic_feedback",
      "scale_feedback",
      "variable_feedback",
      "snapshot",
    ],
  }).notNull(),
```

Миграция не нужна: колонка объявлена как `text` без `CHECK`
([`drizzle/0009_prd_media_library.sql:17`](../../../drizzle/0009_prd_media_library.sql)).

- [ ] **Step 4: Расширить резолв**

В `server/services/media/asset-access.ts` замени ветки `switch`:

```ts
      case "topic_feedback": {
        // A topic reaches tests exactly as a question does — through the sections that use it.
        for (const section of await storage.getTestSectionsByTopic(usage.entityId)) {
          ids.add(section.testId);
        }
        break;
      }
      case "test_design":
      case "test_feedback":
      case "scale_feedback":
      case "variable_feedback":
        // Keyed by the test itself: the entity id IS the test id. Scales and result
        // variables are indexed as the test's SET of them (spec §6.1), so the same holds.
        ids.add(usage.entityId);
        break;
      default:
        break;
```

Обнови блок документации функции: перечисленные типы больше не «заявлены, но не пишутся».

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -- tests/media-asset-access.test.ts tests/media-schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add shared/schema.ts server/services/media/asset-access.ts tests/media-asset-access.test.ts
git commit -m "feat(media): доступ ученика к вложению обратной связи темы, шкалы и показателя"
```

---

### Task 10: Индекс пишется при сохранении теста

**Files:**

- Modify: `server/routes/tests.ts:676-690` (создание), `server/routes/tests.ts:1024-1026` (обновление)
- Test: `tests/media-usage-on-feedback-save.test.ts` (создать)

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-usage-on-feedback-save.test.ts`:

```ts
/**
 * @module tests/media-usage-on-feedback-save
 * @description Сохранение обратной связи держит индекс использования в согласии с контентом.
 * Без строки индекса правило выдачи откажет ученику в файле, который автор ему приложил.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncEntityUsages } from "../server/services/media/usage-index";

vi.mock("../server/storage", () => ({
  storage: {
    getMediaAssetByStorageKey: vi.fn().mockResolvedValue(undefined),
    replaceMediaUsages: vi.fn().mockResolvedValue(undefined),
  },
}));

import { storage } from "../server/storage";

const ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => vi.clearAllMocks());

describe("feedback save -> usage index", () => {
  it("индексирует вложение обратной связи теста", async () => {
    await syncEntityUsages("test_feedback", "test-1", {
      format: "plain",
      text: "",
      links: [],
      events: [],
      assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${ID}` }],
    });
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("test_feedback", "test-1", [
      { assetId: ID, field: "assets.0.url" },
    ]);
  });

  it("очищает строки, когда обратной связи не стало", async () => {
    await syncEntityUsages("test_feedback", "test-1", null);
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("test_feedback", "test-1", []);
  });
});
```

- [ ] **Step 2: Прогнать**

Run: `npm test -- tests/media-usage-on-feedback-save.test.ts`
Expected: PASS — служба уже умеет любой тип; тест фиксирует форму строк для следующего шага.

- [ ] **Step 3: Записать индекс на пути создания теста**

В `server/routes/tests.ts` после `await storage.setTestOwner(test.id, …)` добавь:

```ts
    // Медиатека: сбой индексации не должен стоить автору его правки (тот же довод, что и на
    // пути сохранения оформления). Индексируется именно блок обратной связи, а не вся строка
    // теста: оформление уже учтено под `test_design`, и двойной учёт дал бы две строки на файл.
    try {
      await syncEntityUsages("test_feedback", test.id, feedbackJson ?? null);
    } catch (error) {
      logger.error(`Media usage sync failed for test feedback ${test.id}: ${(error as Error).message}`, "tests");
    }
```

- [ ] **Step 4: Записать индекс на пути обновления теста**

В обработчике `PUT /:id` после `const test = await storage.updateTestWithSections(…)` (перед
`const full = await loadFullTest(test.id);`) добавь тот же блок, подставив `test.id`:

```ts
    try {
      await syncEntityUsages("test_feedback", test.id, feedbackJson ?? null);
    } catch (error) {
      logger.error(`Media usage sync failed for test feedback ${test.id}: ${(error as Error).message}`, "tests");
    }
```

- [ ] **Step 5: Очистить индекс при удалении теста**

Найди обработчик `DELETE /:id`, где уже стоит `await syncEntityUsages("test_design", req.params.id, null);`
(около строки 1199), и добавь рядом:

```ts
      await syncEntityUsages("test_feedback", req.params.id, null);
      await syncEntityUsages("scale_feedback", req.params.id, null);
      await syncEntityUsages("variable_feedback", req.params.id, null);
```

- [ ] **Step 6: Прогнать тесты маршрутов теста**

Run: `npm test -- tests/media-usage-on-feedback-save.test.ts`
Expected: PASS.

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add server/routes/tests.ts tests/media-usage-on-feedback-save.test.ts
git commit -m "feat(media): индекс использования для обратной связи теста"
```

---

### Task 11: Индекс пишется при сохранении темы

**Files:**

- Modify: `server/routes/topics.ts:136-170` (создание), `server/routes/topics.ts:193-235` (обновление),
  плюс удаление темы
- Modify: `server/services/media/usage-index.ts:53-63` (список каскада)
- Test: `tests/media-usage-on-feedback-save.test.ts`

- [ ] **Step 1: Дописать тест**

Добавь в `tests/media-usage-on-feedback-save.test.ts`:

```ts
  it("индексирует вложение обратной связи темы", async () => {
    await syncEntityUsages("topic_feedback", "topic-1", {
      format: "plain",
      text: "",
      links: [],
      events: [],
      assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${ID}` }],
    });
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("topic_feedback", "topic-1", [
      { assetId: ID, field: "assets.0.url" },
    ]);
  });
```

- [ ] **Step 2: Прогнать**

Run: `npm test -- tests/media-usage-on-feedback-save.test.ts`
Expected: PASS.

- [ ] **Step 3: Записать индекс при создании темы**

В `server/routes/topics.ts` в обработчике `POST /` сразу после `const topic = await storage.createTopic({…})`
(около строки 166) добавь:

```ts
    // Медиатека: сбой индексации не должен стоить автору его правки. Недостающая строка
    // индекса безопасна (она отказывает в доступе, а не выдаёт лишнее) и чинится пересборкой.
    try {
      await syncEntityUsages("topic_feedback", topic.id, fb.value ?? null);
    } catch (error) {
      logger.error(`Media usage sync failed for topic feedback ${topic.id}: ${(error as Error).message}`);
    }
```

- [ ] **Step 4: Записать индекс при обновлении темы**

В том же файле в обработчике `PUT /:id` сразу после проверки `if (!updated) { return res.status(404)… }`
(около строки 228) добавь:

```ts
    // Индексируется СОХРАНЁННОЕ значение, а не присланное: тело запроса может вовсе не нести
    // `feedbackJson`, и тогда `fb.value` равен `undefined` — по нему индекс обнулился бы,
    // хотя вложение в теме осталось.
    try {
      await syncEntityUsages("topic_feedback", updated.id, updated.feedbackJson ?? null);
    } catch (error) {
      logger.error(`Media usage sync failed for topic feedback ${updated.id}: ${(error as Error).message}`);
    }
```

- [ ] **Step 5: Очистить индекс при удалении темы**

В обработчике `DELETE /:id` (около строки 279) дополни список каскадной очистки:

```ts
    await clearCascadedUsages([
      { entityType: "topic_feedback" as const, entityId: req.params.id },
      ...result.questionIds.map((id) => ({ entityType: "question" as const, entityId: id })),
      ...result.contentPageIds.map((id) => ({ entityType: "content_page" as const, entityId: id })),
    ]);
```

И то же в массовом удалении (около строки 360), где вместо одной темы идёт список `deletableIds`:

```ts
    await clearCascadedUsages([
      ...deletableIds.map((id) => ({ entityType: "topic_feedback" as const, entityId: id })),
      ...result.questionIds.map((id) => ({ entityType: "question" as const, entityId: id })),
      ...result.contentPageIds.map((id) => ({ entityType: "content_page" as const, entityId: id })),
    ]);
```

В блоке документации `clearCascadedUsages` (`server/services/media/usage-index.ts:44-52`) добавь
упоминание темы: теперь через каскад чистится не только её содержимое, но и её собственная обратная связь.

- [ ] **Step 6: Прогнать тесты каскада**

Run: `npm test -- tests/media-usage-on-cascade-delete.test.ts tests/media-usage-on-feedback-save.test.ts`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add server/routes/topics.ts server/services/media/usage-index.ts tests/media-usage-on-feedback-save.test.ts
git commit -m "feat(media): индекс использования для обратной связи темы"
```

---

### Task 12: Индекс пишется при сохранении шкал и показателей

**Files:**

- Modify: `server/routes/scales.ts:123-150,170-197` и обработчик удаления шкалы
- Modify: `server/routes/result-variables.ts:69-101,146-182` и обработчик удаления показателя
- Test: `tests/media-usage-on-feedback-save.test.ts`

- [ ] **Step 1: Дописать тест**

Добавь в `tests/media-usage-on-feedback-save.test.ts`:

```ts
  it("индексирует набор шкал теста целиком", async () => {
    await syncEntityUsages("scale_feedback", "test-1", [
      {
        key: "burnout",
        configJson: {
          interpretation: {
            bands: [
              {
                min: 0,
                max: 10,
                feedback: {
                  assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${ID}` }],
                },
              },
            ],
          },
        },
      },
    ]);
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("scale_feedback", "test-1", [
      { assetId: ID, field: "0.configJson.interpretation.bands.0.feedback.assets.0.url" },
    ]);
  });
```

- [ ] **Step 2: Прогнать**

Run: `npm test -- tests/media-usage-on-feedback-save.test.ts`
Expected: PASS.

- [ ] **Step 3: Записать индекс в маршрутах шкал**

В `server/routes/scales.ts` добавь общий помощник над маршрутами:

```ts
/**
 * Re-indexes the test's WHOLE set of scales. The unit of indexing is the set, not one scale
 * (spec §6.1): there is no `getScale(id)` in the storage contract, and a set-wide rewrite also
 * makes deletion self-healing — the removed scale's rows simply do not come back.
 */
async function syncScaleFeedbackUsages(testId: string): Promise<void> {
  try {
    await syncEntityUsages("scale_feedback", testId, await storage.getScales(testId));
  } catch (error) {
    logger.error(`Media usage sync failed for scales of ${testId}: ${(error as Error).message}`, "scales");
  }
}
```

С импортом `import { syncEntityUsages } from "../services/media/usage-index";`.

Вызови `await syncScaleFeedbackUsages(testId);` в трёх местах: после `storage.createScale(data)`,
после `storage.updateScale(scaleId, updates)` и после удаления шкалы — во всех случаях перед `res.json`.

- [ ] **Step 4: Записать индекс в маршрутах показателей**

В `server/routes/result-variables.ts` добавь такой же помощник:

```ts
/** Re-indexes the test's WHOLE set of result variables — see the scales counterpart (spec §6.1). */
async function syncVariableFeedbackUsages(testId: string): Promise<void> {
  try {
    await syncEntityUsages("variable_feedback", testId, await storage.getResultVariables(testId));
  } catch (error) {
    logger.error(`Media usage sync failed for result variables of ${testId}: ${(error as Error).message}`, "result-variables");
  }
}
```

И вызови его после `storage.createResultVariable(data)`, после `storage.updateResultVariable(varId, updates)`
и после `storage.deleteResultVariable(varId)`.

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -- tests/media-usage-on-feedback-save.test.ts`
Expected: PASS.

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add server/routes/scales.ts server/routes/result-variables.ts tests/media-usage-on-feedback-save.test.ts
git commit -m "feat(media): индекс использования для обратной связи шкал и показателей"
```

---

### Task 13: Полная пересборка индекса знает о новых типах

**Files:**

- Modify: `server/services/media/usage-index.ts:107-138`
- Test: `tests/media-reindex.test.ts`

- [ ] **Step 1: Написать падающий тест**

Добавь в `tests/media-reindex.test.ts` (моки хранилища в файле уже есть — дополни их методами
`getTopics`, `getScales`, `getResultVariables`):

```ts
  it("пересобирает обратную связь теста, темы, шкал и показателей", async () => {
    storageMock.getTests.mockResolvedValue([
      { id: "test-1", designSettingsJson: {}, feedbackJson: { assets: [] } },
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "topic-1", feedbackJson: { assets: [] } }]);
    storageMock.getScales.mockResolvedValue([{ key: "s", configJson: {} }]);
    storageMock.getResultVariables.mockResolvedValue([{ key: "v", configJson: {} }]);

    await reindexAllUsages();

    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("test_feedback", "test-1", []);
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("topic_feedback", "topic-1", []);
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("scale_feedback", "test-1", []);
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("variable_feedback", "test-1", []);
    expect(storageMock.deleteMediaUsagesExcept).toHaveBeenCalledWith("topic_feedback", ["topic-1"]);
  });
```

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `npm test -- tests/media-reindex.test.ts`
Expected: FAIL — новых типов пересборка не касается.

- [ ] **Step 3: Дополнить пересборку**

В `server/services/media/usage-index.ts` внутри `reindexAllUsages` замени проход по тестам и добавь
проход по темам:

```ts
  for (const test of await storage.getTests()) {
    await syncEntityUsages("test_design", test.id, test.designSettingsJson);
    // The feedback block is indexed apart from the design settings: one file used in both would
    // otherwise be counted twice, and the two are edited through different routes.
    await syncEntityUsages("test_feedback", test.id, test.feedbackJson);
    await syncEntityUsages("scale_feedback", test.id, await storage.getScales(test.id));
    await syncEntityUsages("variable_feedback", test.id, await storage.getResultVariables(test.id));
    entities += 1;
  }
  for (const topic of await storage.getTopics()) {
    await syncEntityUsages("topic_feedback", topic.id, topic.feedbackJson);
    entities += 1;
  }
```

И дополни очистку, повторив приём с перечитыванием идентификаторов:

```ts
  const testIds = (await storage.getTests()).map((t) => t.id);
  await storage.deleteMediaUsagesExcept("test_feedback", testIds);
  await storage.deleteMediaUsagesExcept("scale_feedback", testIds);
  await storage.deleteMediaUsagesExcept("variable_feedback", testIds);
  await storage.deleteMediaUsagesExcept("topic_feedback", (await storage.getTopics()).map((t) => t.id));
```

Обнови блок документации функции: перечисленные типы теперь покрыты, оговорка «не подключены ни к
одному писателю» снимается.

- [ ] **Step 4: Прогнать тесты**

Run: `npm test -- tests/media-reindex.test.ts`
Expected: PASS.

- [ ] **Step 5: Прогнать интеграционный тест пересборки**

Run: `npm run test:it -- tests/it/media-reindex.it.test.ts`
Expected: PASS. Если тест перечисляет ожидаемые типы, допиши в него новые.

- [ ] **Step 6: Коммит**

```bash
git add server/services/media/usage-index.ts tests/media-reindex.test.ts tests/it/media-reindex.it.test.ts
git commit -m "feat(media): полная пересборка индекса покрывает обратную связь"
```

---

### Task 14: Прогон затронутых наборов тестов

**Files:** только запуск.

- [ ] **Step 1: Прогнать медиа-наборы**

```bash
npm test -- tests/media-asset-access.test.ts tests/media-delivery-route.test.ts \
  tests/media-upload-route.test.ts tests/media-reindex.test.ts \
  tests/media-usage-on-feedback-save.test.ts tests/media-refs.test.ts
```

Expected: PASS.

- [ ] **Step 2: Прогнать наборы SCORM**

```bash
npm test -- tests/scorm-media-assets.test.ts tests/scorm-media-resolver.test.ts \
  tests/scorm-package-media-guard.test.ts tests/scorm-export.test.ts \
  tests/scorm-package-acceptance.test.ts
```

Expected: PASS.

- [ ] **Step 3: Прогнать наборы редактора и итогов**

```bash
npm test -- tests/feedback-editor-modal-upload.test.tsx \
  shared/template/__tests__/result-context-measures.test.ts \
  client/src/features/tests/editor/__tests__/test-editor.mappers.branches.test.ts
```

Expected: PASS.

- [ ] **Step 4: Проверить типы и сборку**

Run: `npm run check`
Expected: без ошибок.

Run: `npm run build`
Expected: сборка проходит.

- [ ] **Step 5: Если что-то падает**

Чини причину, а не тест. Прогон всей сюиты (`npm test` без пути) и `npm run test:cov` в этой рабочей
копии запускай ТОЛЬКО с явного разрешения владельца: в ней параллельно работают другие сессии.

---

### Task 15: Приёмка в браузере и в локальном плеере

**Files:** только проверка; правки — по находкам.

Фронтенд принимается в реальном браузере: юнит-тестов и `tsc` недостаточно.

- [ ] **Step 1: Поднять отдельный экземпляр**

Run: `PORT=8099 npm run dev`
Живой dev-сервер владельца не трогай: серверные правки в нём всё равно не подхватываются.

- [ ] **Step 2: Пройти путь автора**

Войди автором, открой тест со шкалой, в «Рекомендациях» уровня приложи PDF и сохрани тест.
Ожидание: файл уезжает на сервер сразу (в сетевой панели виден `POST /api/media/upload?purpose=feedback-asset`
со статусом `200`), в списке видно имя и размер, «Сохранить» доступно после загрузки.

- [ ] **Step 3: Проверить отказ**

Приложи файл не-PDF и файл больше 5 МБ. Ожидание: баннер с причиной, вложение в список не попадает.

- [ ] **Step 4: Пройти путь ученика**

Войди учеником, пройди тест, дойди до экрана итогов. Ожидание: в блоке рекомендаций подсекция
«Материалы» показывает вложение, ссылка открывает PDF.

- [ ] **Step 5: Проверить чужого ученика**

Открой адрес `/api/media/<id>` этого вложения под учеником, которому тест не назначен.
Ожидание: `403`.

- [ ] **Step 6: Собрать и проиграть пакет**

Экспортируй тест в SCORM. Ожидание: в ZIP лежит `assets/media/<id>.pdf`, а в `TEST_DATA` нет строк
`/api/media/` и `/uploads/`.

Run: `npm run scorm:player`
Открой пакет и дойди до итогов: вложение открывается из пакета.

- [ ] **Step 7: Проверить медиа вопросов**

Собери пакет теста с картинкой, аудио и видео в вопросах. Ожидание: все три файла лежат внутри ZIP,
играются в локальном плеере, аудио и видео перематываются.

- [ ] **Step 8: Проверить легаси-дескриптор**

Открой обратную связь, где вложение сохранено до этой работы. Ожидание: метка «файл не загружен» и
кнопка загрузки; после загрузки название автора сохраняется, адрес появляется.

- [ ] **Step 9: Записать приёмку**

Создай `docs/reports/prd32-feedback-assets-acceptance.md` с результатом каждого шага: что проверено,
что увидел, какие дефекты найдены. Отчёт без эмодзи, по правилам markdownlint.

- [ ] **Step 10: Коммит**

```bash
git add docs/reports/prd32-feedback-assets-acceptance.md
git commit -m "docs(prd-32): отчёт приёмки доставки вложений обратной связи"
```

---

### Task 16: Обновить дорожную карту

**Files:**

- Modify: `docs/ROADMAP.md:60,149`

- [ ] **Step 1: Обновить строку PRD-32**

Замени статус «НЕ НАЧАТ» на реализованное состояние: перечисли, что закрыто (хранение вложения в
медиатеке, канонический адрес в дескрипторе, упаковка медиа из реестра, индекс и права для четырёх
мест хранения обратной связи, строгая проверка загрузки), сошлись на
[спеку](../specs/2026-08-02-feedback-assets-delivery-design.md), [план](2026-08-02-feedback-assets-delivery.md)
и отчёт приёмки. Отметь, что работа заодно закрыла этап Э4 медиатеки — упаковку медиа вопросов,
страниц и оформления из реестра.

- [ ] **Step 2: Проверить markdownlint**

Run: `npx markdownlint-cli2 docs/ROADMAP.md docs/superpowers/specs/2026-08-02-feedback-assets-delivery-design.md docs/superpowers/plans/2026-08-02-feedback-assets-delivery.md`
Expected: `0 issues`.

- [ ] **Step 3: Коммит**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): PRD-32 закрыт вместе с этапом Э4 медиатеки"
```

---

## Что осталось за рамками

| Тема | Почему не здесь |
| --- | --- |
| Экран медиатеки и выбор из библиотеки | Этап Э5 спецификации медиатеки; требует утверждённого эскиза |
| Расширение типов вложения за пределы PDF | Требует правки контракта и рендера на обоих хостах |
| Импорт медиа книгой Excel | PRD-14, отдельная работа |
| Вложения в обратной связи адаптивных уровней и тем | Секция скрыта флагом `hideAssets`; эта работа мест приложения не расширяет |
