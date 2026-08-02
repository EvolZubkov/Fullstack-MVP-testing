/**
 * @module tests/scorm-media-assets
 * @description Упаковщик медиа SCORM-пакета: `extractEmbeddedMediaIntoAssets` превращает
 * ЛЮБОЙ адрес, который держит содержимое теста, в путь внутри ZIP и складывает байты рядом.
 *
 * Резолв ссылки в байты — не его работа: он получает порт `resolveRef`, поэтому здесь нет
 * ни базы, ни файловой системы, а кейсы говорят только про обход строк и подмену адреса.
 */
import { describe, it, expect, vi } from "vitest";
import { extractEmbeddedMediaIntoAssets } from "../server/scorm/builders/media-assets";

// 1x1 transparent PNG as base64
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;

const ID = "11111111-1111-1111-1111-111111111111";

/** Резолвер, который всегда отдаёт один и тот же файл. */
function resolverOf(zipPath: string, bytes = "bytes") {
  return vi.fn().mockResolvedValue({ zipPath, buffer: Buffer.from(bytes) });
}

/** Резолвер, который ничего отдать не может. */
function emptyResolver() {
  return vi.fn().mockResolvedValue(null);
}

/** Резолвер по виду ссылки — для деревьев с обоими видами адреса. */
function realisticResolver() {
  return vi.fn().mockImplementation(async (ref: any) =>
    ref.kind === "canonical"
      ? { zipPath: `assets/media/${ref.id}.png`, buffer: Buffer.from("canonical") }
      : { zipPath: `assets/${ref.storageKey}`, buffer: Buffer.from("legacy") },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe("extractEmbeddedMediaIntoAssets — base64 data URLs", () => {
  it("converts a PNG data URL to an asset file", async () => {
    const testObj = { mediaUrl: PNG_DATA_URL };
    const { assets, missing } = await extractEmbeddedMediaIntoAssets(testObj, {
      resolveRef: emptyResolver(),
    });

    expect(missing).toHaveLength(0);
    const keys = Object.keys(assets);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^assets\/media\/.+\.png$/);
    expect(assets[keys[0]]).toBeInstanceOf(Buffer);
  });

  it("rewrites mediaUrl in-place to the zip path", async () => {
    const testObj = { mediaUrl: PNG_DATA_URL };
    await extractEmbeddedMediaIntoAssets(testObj, { resolveRef: emptyResolver() });
    expect(testObj.mediaUrl).toMatch(/^assets\/media\/.+\.png$/);
  });

  it("maps image/jpeg mime to .jpg extension", async () => {
    const testObj = { mediaUrl: `data:image/jpeg;base64,${PNG_B64}` };
    const { assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef: emptyResolver() });
    expect(Object.keys(assets)[0]).toMatch(/\.jpg$/);
  });

  it("maps audio/mpeg mime to .mp3 extension", async () => {
    const testObj = { mediaUrl: `data:audio/mpeg;base64,AAAA` };
    const { assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef: emptyResolver() });
    expect(Object.keys(assets)[0]).toMatch(/\.mp3$/);
  });

  it("maps application/pdf mime to .pdf extension", async () => {
    const testObj = { mediaUrl: `data:application/pdf;base64,JVBERi0=` };
    const { assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef: emptyResolver() });
    expect(Object.keys(assets)[0]).toMatch(/\.pdf$/);
  });

  it("maps unknown mime to .bin extension", async () => {
    const testObj = { mediaUrl: `data:application/octet-stream;base64,AAAA` };
    const { assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef: emptyResolver() });
    expect(Object.keys(assets)[0]).toMatch(/\.bin$/);
  });

  it("decodes the base64 payload into the packed bytes", async () => {
    const testObj = { mediaUrl: `data:application/octet-stream;base64,${Buffer.from("hi").toString("base64")}` };
    const { assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef: emptyResolver() });
    expect(assets[Object.keys(assets)[0]]).toEqual(Buffer.from("hi"));
  });

  it("generates unique filenames for different images", async () => {
    const obj1 = { mediaUrl: PNG_DATA_URL };
    const obj2 = { mediaUrl: PNG_DATA_URL };
    await extractEmbeddedMediaIntoAssets(obj1, { resolveRef: emptyResolver() });
    await extractEmbeddedMediaIntoAssets(obj2, { resolveRef: emptyResolver() });
    // Different calls → different nanoid filenames
    expect(obj1.mediaUrl).not.toBe(PNG_DATA_URL);
    expect(obj2.mediaUrl).not.toBe(PNG_DATA_URL);
    expect(obj1.mediaUrl).not.toBe(obj2.mediaUrl);
  });

  it("processes mediaUrl in nested objects", async () => {
    const testObj = { sections: [{ questions: [{ mediaUrl: PNG_DATA_URL }] }] };
    const { assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef: emptyResolver() });
    expect(Object.keys(assets)).toHaveLength(1);
    expect(testObj.sections[0].questions[0].mediaUrl).toMatch(/^assets\/media\//);
  });

  it("embeds any data-URL field but leaves plain-text fields untouched", async () => {
    const testObj = { title: "Test", imageUrl: PNG_DATA_URL, mediaUrl: PNG_DATA_URL };
    await extractEmbeddedMediaIntoAssets(testObj, { resolveRef: emptyResolver() });
    // Plain text is not media — untouched.
    expect(testObj.title).toBe("Test");
    // Any data-URL value is embedded so the SCORM package stays self-contained,
    // regardless of the field name (e.g. a logo/image stored outside mediaUrl).
    expect(testObj.imageUrl).toMatch(/^assets\/media\//);
    expect(testObj.mediaUrl).toMatch(/^assets\/media\//);
  });

  it("packs a single mediaUrl exactly once", async () => {
    const testObj = { mediaUrl: PNG_DATA_URL };
    const { assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef: emptyResolver() });
    expect(Object.keys(assets)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("extractEmbeddedMediaIntoAssets — канонический адрес медиатеки", () => {
  it("пакует файл и переписывает адрес на путь внутри пакета", async () => {
    const resolveRef = resolverOf(`assets/media/${ID}.png`, "png-bytes");
    const testObj = { mediaUrl: `/api/media/${ID}` };
    const { assets, missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(missing).toHaveLength(0);
    expect(assets[`assets/media/${ID}.png`]).toEqual(Buffer.from("png-bytes"));
    expect(testObj.mediaUrl).toBe(`assets/media/${ID}.png`);
    expect(resolveRef).toHaveBeenCalledTimes(1);
    expect(resolveRef).toHaveBeenCalledWith({ kind: "canonical", id: ID });
  });

  it("переписывает адрес внутри разметки контентной страницы", async () => {
    const resolveRef = resolverOf(`assets/media/${ID}.png`, "png-bytes");
    const testObj = { html: `<img src="/api/media/${ID}" alt="">` };
    await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    expect(testObj.html).toBe(`<img src="assets/media/${ID}.png" alt="">`);
  });

  it("переписывает адрес во ВСЕХ вхождениях внутри одной строки", async () => {
    const resolveRef = resolverOf(`assets/media/${ID}.png`, "png-bytes");
    const testObj = { html: `<img src="/api/media/${ID}"><img src="/api/media/${ID}">` };
    await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    expect(testObj.html).toBe(`<img src="assets/media/${ID}.png"><img src="assets/media/${ID}.png">`);
    expect(resolveRef).toHaveBeenCalledTimes(1);
  });

  it("пакует один актив один раз при двух ссылках", async () => {
    const resolveRef = resolverOf(`assets/media/${ID}.png`, "png-bytes");
    const testObj = { a: { mediaUrl: `/api/media/${ID}` }, b: { mediaUrl: `/api/media/${ID}` } };
    const { assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    expect(Object.keys(assets)).toHaveLength(1);
    expect(resolveRef).toHaveBeenCalledTimes(1);
  });

  it("пакует адрес вложения обратной связи", async () => {
    const resolveRef = resolverOf(`assets/media/${ID}.pdf`, "%PDF");
    const testObj = {
      feedbackJson: {
        assets: [
          { title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${ID}` },
        ],
      },
    };
    await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    expect(testObj.feedbackJson.assets[0].url).toBe(`assets/media/${ID}.pdf`);
    expect(testObj.feedbackJson.assets[0].fileName).toBe("p.pdf");
  });

  it("очищает нерезолвленный адрес и называет причину", async () => {
    const resolveRef = emptyResolver();
    const testObj = { mediaUrl: `/api/media/${ID}` };
    const { assets, missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    // Пакет обязан быть автономным: абсолютный адрес на сервер наружу не уезжает.
    expect(testObj.mediaUrl).toBe("");
    expect(Object.keys(assets)).toHaveLength(0);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(new RegExp(`unresolved.*${ID}`, "i"));
  });

  it("спрашивает резолвер о нерезолвленном адресе один раз", async () => {
    const resolveRef = emptyResolver();
    const testObj = { a: { mediaUrl: `/api/media/${ID}` }, b: { mediaUrl: `/api/media/${ID}` } };
    const { missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    expect(resolveRef).toHaveBeenCalledTimes(1);
    expect(missing).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("extractEmbeddedMediaIntoAssets — /uploads/ file paths", () => {
  it("embeds an existing upload file into assets", async () => {
    const resolveRef = resolverOf("assets/media/track.mp3", "audio-data");
    const testObj = { mediaUrl: "/uploads/media/track.mp3" };
    const { assets, missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(missing).toHaveLength(0);
    expect(assets["assets/media/track.mp3"]).toEqual(Buffer.from("audio-data"));
    expect(testObj.mediaUrl).toBe("assets/media/track.mp3");
    expect(resolveRef).toHaveBeenCalledWith({ kind: "legacy", storageKey: "media/track.mp3" });
  });

  it("очищает адрес, когда файл не резолвится", async () => {
    const resolveRef = emptyResolver();
    const testObj = { mediaUrl: "/uploads/media/ghost.mp3" };
    const { assets, missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/unresolved/i);
    expect(Object.keys(assets)).toHaveLength(0);
    // Пакет обязан быть автономным: абсолютный адрес наружу не уезжает.
    expect(testObj.mediaUrl).toBe("");
  });

  it("deduplicates the same upload file referenced multiple times", async () => {
    const resolveRef = resolverOf("assets/media/shared.mp3", "shared-audio");
    const testObj = {
      q1: { mediaUrl: "/uploads/media/shared.mp3" },
      q2: { mediaUrl: "/uploads/media/shared.mp3" },
    };
    const { assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(resolveRef).toHaveBeenCalledTimes(1);
    expect(Object.keys(assets)).toHaveLength(1);
  });

  it("переписывает адрес, записанный обратными слэшами", async () => {
    // Обходчик нормализует `\` в `/` ДО поиска, поэтому он находит адрес, которого в
    // тексте буквально нет. Найденное обязано быть и заменено — иначе ссылка числится
    // упакованной, а в данных остаётся старый адрес.
    const resolveRef = resolverOf("assets/media/track.mp3", "audio-data");
    const testObj = { mediaUrl: "\\uploads\\media\\track.mp3" };
    await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    expect(testObj.mediaUrl).toBe("assets/media/track.mp3");
  });

  it("не трогает адрес с выходом за каталог", async () => {
    const resolveRef = emptyResolver();
    const testObj = { mediaUrl: "/uploads/media/../../../etc/passwd" };
    await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    // Обходчик отбрасывает сегмент `..` сам — до резолвера такой адрес не доходит.
    expect(resolveRef).not.toHaveBeenCalled();
    expect(testObj.mediaUrl).toBe("/uploads/media/../../../etc/passwd");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("extractEmbeddedMediaIntoAssets — оба вида адреса в одном дереве", () => {
  it("не оставляет в данных ни одного адреса на сервер", async () => {
    const resolveRef = realisticResolver();
    const testObj = {
      questions: [{ mediaUrl: `/api/media/${ID}` }, { mediaUrl: "/uploads/media/old.png" }],
      pages: [{ html: `<img src="/api/media/${ID}"><img src="/uploads/media/old.png">` }],
      designSettings: { background: `/api/media/${ID}` },
      feedbackJson: {
        assets: [
          { title: "П", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${ID}` },
        ],
      },
    };

    const { testObj: packed, assets } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    const serialised = JSON.stringify(packed);

    expect(serialised).not.toContain("/api/media/");
    expect(serialised).not.toContain("/uploads/");
    // Два разных актива — две записи, сколько бы ссылок на них ни было.
    expect(Object.keys(assets).sort()).toEqual([`assets/media/${ID}.png`, "assets/media/old.png"]);
    expect(resolveRef).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("extractEmbeddedMediaIntoAssets — edge cases", () => {
  it("ignores nodes with no mediaUrl", async () => {
    const testObj = { title: "No media here", sections: [] };
    const { assets, missing } = await extractEmbeddedMediaIntoAssets(testObj, {
      resolveRef: emptyResolver(),
    });
    expect(assets).toEqual({});
    expect(missing).toHaveLength(0);
  });

  it("ignores mediaUrl that is not a data URL or a known media address", async () => {
    const resolveRef = emptyResolver();
    const testObj = { mediaUrl: "https://external.example.com/image.png" };
    const { assets, missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    // External URLs are left unchanged — not embedded
    expect(assets).toEqual({});
    expect(missing).toHaveLength(0);
    expect(resolveRef).not.toHaveBeenCalled();
    expect(testObj.mediaUrl).toBe("https://external.example.com/image.png");
  });

  it("handles null, primitives and arrays without crashing", async () => {
    const testObj = { a: null, b: 42, c: true, d: "string", e: [null, 1, "x", ["deep"]], f: undefined };
    await expect(
      extractEmbeddedMediaIntoAssets(testObj, { resolveRef: emptyResolver() }),
    ).resolves.toBeTruthy();
    expect(testObj.a).toBeNull();
    expect(testObj.b).toBe(42);
    expect(testObj.c).toBe(true);
  });

  it("переписывает адрес внутри элемента массива строк", async () => {
    const resolveRef = resolverOf(`assets/media/${ID}.png`);
    const testObj = { gallery: [`/api/media/${ID}`, "plain"] };
    await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });
    expect(testObj.gallery).toEqual([`assets/media/${ID}.png`, "plain"]);
  });

  it("returns the same testObj reference", async () => {
    const testObj = { mediaUrl: PNG_DATA_URL };
    const { testObj: returned } = await extractEmbeddedMediaIntoAssets(testObj, {
      resolveRef: emptyResolver(),
    });
    expect(returned).toBe(testObj);
  });
});
