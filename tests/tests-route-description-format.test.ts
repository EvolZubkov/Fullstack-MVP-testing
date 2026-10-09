/**
 * @module tests/tests-route-description-format
 *
 * PRD-59 FR-02. Маршруты `POST /api/tests` и `PUT /api/tests/:id` перечисляют поля тела
 * запроса ПОИМЁННО и собирают из них полезную нагрузку. Поле, добавленное только в
 * zod-схему, проходит проверку и молча теряется: ответ 200/201, в базе прежнее значение.
 *
 * Это уже случалось в этом файле с разделами теста, и приёмка PRD-59 поймала ровно то же
 * с форматом описания: автор переключал режим, сохранение отвечало успехом, а описание
 * оставалось плоским. Юнит-тесты сервиса дефект не видели — он был не в сервисе.
 *
 * Тест читает ИСХОДНИК маршрута, а не поведение: ради одного поля поднимать express с
 * базой дороже, чем проверить то единственное, что здесь ломается, — что имя поля стоит
 * и в схеме, и в разборе тела, и в собираемой нагрузке, по обоим маршрутам.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE = fs.readFileSync(path.join(process.cwd(), "server/routes/tests.ts"), "utf-8");

/** Тело обработчика от его объявления до конца файла или до следующего маршрута. */
function handler(signature: string): string {
  const start = SOURCE.indexOf(signature);
  expect(start, `маршрут не найден: ${signature}`).toBeGreaterThan(-1);
  const next = SOURCE.indexOf("\nrouter.", start + signature.length);
  return SOURCE.slice(start, next === -1 ? undefined : next);
}

describe("маршруты теста везут формат описания", () => {
  it("поле объявлено в схеме тела запроса", () => {
    expect(SOURCE).toContain('descriptionFormat: z.enum(["plain", "richText", "html"]).optional()');
  });

  for (const [name, signature] of [
    ["POST /api/tests", 'router.post("/"'],
    ["PUT /api/tests/:id", 'router.put("/:id"'],
  ] as const) {
    it(`${name} разбирает поле и кладёт его в нагрузку`, () => {
      const body = handler(signature);
      // Дважды: один раз в деструктуризации тела, один — в собираемой нагрузке.
      const hits = body.match(/\bdescriptionFormat\b/g) ?? [];
      expect(hits.length, `${name}: поле встречается ${hits.length} раз(а), ожидалось 2`).toBe(2);
    });
  }
});
