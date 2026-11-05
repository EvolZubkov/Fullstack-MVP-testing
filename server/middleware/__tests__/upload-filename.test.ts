import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { workbookUploadSingle, transferUploadSingle } from "../upload";

/** Приложение, которое отдаёт обратно имя файла так, как его увидел обработчик. */
function app(middleware: ReturnType<typeof workbookUploadSingle>) {
  const a = express();
  a.post("/", middleware, (req, res) => res.json({ name: req.file?.originalname }));
  return a;
}

describe("имя загруженного файла", () => {
  const name = "Демо_аналитика_1_vysokiy_uroven.xlsx";

  it("книга: кириллица в имени доезжает без искажений", async () => {
    // Браузер шлёт имя в UTF-8, а busboy по умолчанию читает его как latin1 — получались «Ð\x94Ð...».
    const res = await request(app(workbookUploadSingle("file")))
      .post("/")
      .attach("file", Buffer.from("x"), { filename: name });
    expect(res.body.name).toBe(name);
  });

  it("пакет переноса: то же самое", async () => {
    const res = await request(app(transferUploadSingle("file")))
      .post("/")
      .attach("file", Buffer.from("x"), { filename: "тест.tbtest" });
    expect(res.body.name).toBe("тест.tbtest");
  });
});
