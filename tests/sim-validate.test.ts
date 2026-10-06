/**
 * @module tests/sim-validate
 * @description Import checks of a «Сценарий в ИС» scenario (`shared/sim/validate`, exchange-format.md
 * section 6): the reference scenario passes in both modes, and each rule of the section rejects
 * the mistake it names, in words that point at the place.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { summarizeScenario, validateScenario, type ArchiveImage } from "@shared/sim/validate";
import type { Scenario } from "@shared/sim/contract";

const ROOT = resolve(process.cwd(), "docs/specs/sim-scenario/example");
const reference = JSON.parse(readFileSync(resolve(ROOT, "scenario.json"), "utf8")) as Scenario;

/** The reference archive as the server would see it: every PNG of media/, with its real size. */
function archiveFiles(): Map<string, ArchiveImage> {
  const files = new Map<string, ArchiveImage>();
  for (const name of readdirSync(resolve(ROOT, "media"))) {
    const bytes = readFileSync(resolve(ROOT, "media", name));
    files.set(`media/${name}`, {
      path: `media/${name}`,
      byteSize: statSync(resolve(ROOT, "media", name)).size,
      format: "png",
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    });
  }
  return files;
}

const copy = (): Scenario => structuredClone(reference);
const archive = (s: unknown) => validateScenario(s, { mode: "archive", files: archiveFiles() });

describe("эталонный сценарий", () => {
  it("проходит проверку архива без ошибок и предупреждений", () => {
    expect(archive(reference)).toEqual({ errors: [], warnings: [] });
  });

  it("проходит проверку хранимого сценария, когда пути заменены адресами медиатеки", () => {
    const stored = copy();
    stored.media.forEach((m, i) => { m.file = `/api/media/00000000-0000-0000-0000-00000000000${i % 10}`; });
    expect(validateScenario(stored, { mode: "stored" }).errors).toEqual([]);
  });

  it("сводка называет сцены, изображения, поля, ловушки и проверки цели", () => {
    const summary = summarizeScenario(reference);
    expect(summary).toMatchObject({ title: "Регистрация входящего письма", scenes: 11, images: 12, fields: 4, traps: 2, checks: 4 });
  });
});

describe("ошибки, которые отклоняют архив", () => {
  it("не тот формат или версия новее поддерживаемой", () => {
    expect(archive({ ...copy(), format: "other" }).errors[0]).toMatch(/format/);
    expect(archive({ ...copy(), version: 2 }).errors[0]).toMatch(/новее/);
  });

  it("элемент ссылается на изображение, которого нет в библиотеке, — называется сцена", () => {
    const s = copy();
    const scene = s.scenes.find((x) => x.elements.length > 1)!;
    scene.elements[1].media = "ghost";
    expect(archive(s).errors).toContain(`Сцена «${scene.title}»: элемент ${scene.elements[1].id} ссылается на изображение ghost, которого нет в библиотеке`);
  });

  it("файла изображения нет в архиве", () => {
    const files = archiveFiles();
    files.delete("media/home.png");
    expect(validateScenario(reference, { mode: "archive", files }).errors.some((e) => /home\.png нет в архиве/.test(e))).toBe(true);
  });

  it("изображение тяжелее 1 МБ, шире 3840 px и не PNG/JPEG/WebP", () => {
    const files = archiveFiles();
    files.set("media/home.png", { ...files.get("media/home.png")!, byteSize: 2 * 1024 * 1024 });
    files.set("media/form.png", { ...files.get("media/form.png")!, width: 4000 });
    files.set("media/list.png", { ...files.get("media/list.png")!, format: null });
    const { errors } = validateScenario(reference, { mode: "archive", files });
    expect(errors.some((e) => /home\.png — 2,0 МБ, больше допустимых 1,0 МБ/.test(e))).toBe(true);
    expect(errors.some((e) => /form\.png — 4000 × \d+, сторона больше 3840 px/.test(e))).toBe(true);
    expect(errors.some((e) => /list\.png — не PNG, JPEG или WebP/.test(e))).toBe(true);
  });

  it("у ловушки нет названия ошибки", () => {
    const s = copy();
    const trap = s.scenes.flatMap((x) => x.zones ?? []).find((z) => z.role === "trap")!;
    delete trap.error;
    expect(archive(s).errors.some((e) => e.includes(`зона ${trap.id}: у ловушки не задано название ошибки`))).toBe(true);
  });

  it("к цели нельзя дойти только по основному и другим верным путям", () => {
    const s = copy();
    for (const z of s.scenes.flatMap((x) => x.zones ?? [])) if (z.role === "alt") z.role = "detour";
    for (const z of s.scenes.flatMap((x) => x.zones ?? [])) if (z.id === "confirm-ok") z.role = "detour";
    expect(archive(s).errors.some((e) => /нельзя дойти только по основному/.test(e))).toBe(true);
  });

  it("переход на несуществующую сцену и эффект над чужим элементом", () => {
    const s = copy();
    const zone = s.scenes[0].zones!.find((z) => z.role === "path")!;
    zone.effects = [{ goto: "nowhere" }, { show: "nothing" }];
    const { errors } = archive(s);
    expect(errors.some((e) => /переход на несуществующую сцену nowhere/.test(e))).toBe(true);
    expect(errors.some((e) => /show nothing — нет такого элемента на этой сцене/.test(e))).toBe(true);
  });

  it("зона за пределами сцены и негодный многоугольник", () => {
    const s = copy();
    const zones = s.scenes[0].zones!;
    Object.assign(zones[0], { x: 5000 });
    zones.push({ id: "bow", role: "neutral", shape: "polygon", points: [[0, 0], [10, 10], [10, 0], [0, 10]] } as never);
    const { errors } = archive(s);
    expect(errors.some((e) => e.includes(`зона ${zones[0].id} выходит за пределы сцены`))).toBe(true);
    expect(errors.some((e) => /зона bow: многоугольник — стороны пересекаются/.test(e))).toBe(true);
  });

  it("сочетание клавиш не по шаблону", () => {
    const s = copy();
    s.scenes[0].keys = [{ id: "bad-key", keys: "ctrl+s", role: "detour", effects: [] } as never];
    expect(archive(s).errors.some((e) => /запись «ctrl\+s» не по шаблону/.test(e))).toBe(true);
  });

  it("в хранимом сценарии путь не из медиатеки", () => {
    expect(validateScenario(reference, { mode: "stored" }).errors.some((e) => /не из медиатеки/.test(e))).toBe(true);
  });
});

describe("предупреждения не мешают принять архив", () => {
  it("недостижимая сцена, лишний файл, размер изображения не совпал", () => {
    const s = copy();
    s.scenes.push({ id: "orphan", title: "Сирота", elements: [], goal: { outcome: "fail" } });
    s.media[0].w = 100;
    const files = archiveFiles();
    files.set("media/extra.png", { path: "media/extra.png", byteSize: 10, format: "png", width: 1, height: 1 });
    const { errors, warnings } = validateScenario(s, { mode: "archive", files });
    expect(errors).toEqual([]);
    expect(warnings).toContain("Сцена «Сирота» недостижима от старта");
    expect(warnings).toContain("Файл media/extra.png в архиве, но в сценарии не используется");
    expect(warnings.some((w) => w.startsWith(`Изображение ${s.media[0].id}: в файле`))).toBe(true);
  });
});
