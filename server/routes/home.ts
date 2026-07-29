/**
 * @module server/routes/home
 *
 * PRD-25 FR-14: `GET /api/home` — the single request that backs the home page.
 * The route is deliberately thin: authenticate, resolve the effective roles,
 * delegate to the aggregator. There is no `requirePermission` guard on the
 * endpoint itself, because the page belongs to EVERY authenticated user and it
 * is the composition of sections that is gated (see `services/home/index`).
 */
import { Router, type Request, type Response } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import { getEffectiveRoles } from "../services/access";
import { buildHome } from "../services/home/index";

const router = Router();

// GET /api/home — all sections the current user is allowed to see.
router.get("/", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: "Не авторизован" });
  }

  try {
    // `getEffectiveRoles` takes the user RECORD, not the id: the superadmin role
    // is derived from the email hash at runtime and never stored in `user_roles`.
    const user = await storage.getUser(userId);
    if (!user) {
      // The session outlived its user (deleted account) — treat it as anonymous.
      return res.status(401).json({ error: "Не авторизован" });
    }

    const roles = await getEffectiveRoles(user);
    res.json(await buildHome(userId, roles));
  } catch (error) {
    logger.error("Get home error: " + (error as Error).message);
    res.status(500).json({ error: "Не удалось собрать домашнюю страницу" });
  }
});

export default router;
