/**
 * @module tests/scorm-package-media-guard
 * @description Гард автономности пакета: в собранных данных не остаётся ни одного ГОЛОГО
 * адреса медиа, ведущего на сервер Skill'Ум. Именно отсутствие такой проверки позволило
 * упаковщику молча перестать класть медиа в ZIP после появления медиатеки (PRD-32): адрес
 * `/api/media/<id>` он не распознавал, файл в пакет не попадал, а обнаружить это можно было
 * только открыв пакет в настоящей LMS — отладочный плеер играет его same-origin с живой
 * сессией автора, и адрес там открывается.
 *
 * «Голого» — потому что абсолютный URL (`https://cdn.example.com/uploads/media/x.png`)
 * остаётся в данных законно: это поддерживаемая авторская форма, упаковщик её намеренно не
 * трогает. Инвариант нарушает только относительный адрес, который внутри LMS ведёт на чужой
 * origin без сессии.
 */
import { describe, it, expect, vi } from "vitest";
import { extractEmbeddedMediaIntoAssets } from "../server/scorm/builders/media-assets";

const ID = "11111111-1111-1111-1111-111111111111";

/** Every media address that is NOT part of an absolute URL. */
function bareMediaAddresses(serialised: string): string[] {
  return [...serialised.matchAll(/(?<![\w.:-])(?:\/api\/media\/|\/uploads\/)[^"\\\s]*/g)].map((m) => m[0]);
}

describe("автономность собранных данных пакета", () => {
  it("не оставляет голых адресов медиа ни в одном поле", async () => {
    const resolveRef = vi.fn().mockImplementation(async (ref: { kind: string; id?: string; storageKey?: string }) =>
      ref.kind === "canonical"
        ? { zipPath: `assets/media/${ref.id}.png`, buffer: Buffer.from("x") }
        : { zipPath: `assets/${ref.storageKey}`, buffer: Buffer.from("y") },
    );

    const testObj = {
      questions: [{ mediaUrl: `/api/media/${ID}` }, { mediaUrl: "/uploads/media/old.png" }],
      pages: [{ html: `<img src="/api/media/${ID}"><img src="/uploads/media/old.png">` }],
      designSettings: { background: `/api/media/${ID}` },
      feedbackJson: {
        assets: [{ title: "П", fileName: "p.pdf", mimeType: "application/pdf", url: `/api/media/${ID}` }],
      },
    };

    // The detector itself must be able to see these addresses, or the guard would pass
    // on any input at all — including a package that lost every file.
    expect(bareMediaAddresses(JSON.stringify(testObj))).toHaveLength(6);

    const { testObj: packed } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(bareMediaAddresses(JSON.stringify(packed))).toEqual([]);
  });

  it("нерезолвленный адрес тоже не остаётся в данных", async () => {
    const resolveRef = vi.fn().mockResolvedValue(null);
    const testObj = { questions: [{ mediaUrl: `/api/media/${ID}` }] };
    const { testObj: packed, missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(bareMediaAddresses(JSON.stringify(packed))).toEqual([]);
    expect(missing).toHaveLength(1);
  });

  it("абсолютный URL остаётся нетронутым и гард на него не срабатывает", async () => {
    const resolveRef = vi.fn().mockResolvedValue(null);
    const external = "https://cdn.example.com/uploads/media/logo.png";
    const testObj = { designSettings: { background: external } };
    const { testObj: packed, missing } = await extractEmbeddedMediaIntoAssets(testObj, { resolveRef });

    expect(packed.designSettings.background).toBe(external);
    expect(bareMediaAddresses(JSON.stringify(packed))).toEqual([]);
    expect(missing).toEqual([]);
    expect(resolveRef).not.toHaveBeenCalled();
  });
});
