/**
 * @module server/middleware/ensure-body
 *
 * Гарантирует, что `req.body` — объект, а не `undefined`.
 *
 * Express 5 оставляет тело НЕОПРЕДЕЛЁННЫМ, если ни один парсер не сработал: например,
 * когда клиент не прислал `Content-Type: application/json`. Обработчики же почти везде
 * начинаются с деструктуризации (`const { x } = req.body`), и она падает раньше любой
 * собственной проверки — запрос без заголовка получал `500` вместо внятного `400`, а в
 * журнал уходило «Cannot destructure property ... of req.body as it is undefined»:
 * ошибка, выглядящая как поломка сервера, хотя виноват вызывающий.
 *
 * Подставляется ПУСТОЙ объект, а не заглушка с полями: дальше маршрут сам решит, чего в
 * теле не хватает, и ответит своим кодом. Схемы Zod на пустом объекте дают ту же ошибку
 * валидации, что и на отсутствующем теле, поэтому поведение корректных запросов не
 * меняется — меняется только ответ на запрос без тела.
 */
import type { NextFunction, Request, Response } from "express";

/** Express-middleware: `undefined` тело заменяется на `{}`, любое другое не трогается. */
export function ensureBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body === undefined) req.body = {};
  next();
}
