import { Router } from "express";
import generalRouter from "./general";
import testDetailsRouter from "./test-details";
import attemptsRouter from "./attempts";
import scormRouter from "./scorm";
import combinedRouter from "./combined";
import exportRouter from "./export";

// Реэкспорт хелперов для использования в других модулях
export {
  formatQuestionType,
  formatAllOptions,
  formatCorrectAnswerText,
  formatUserAnswerText,
} from "./helpers";

const router = Router();

// Общая аналитика: GET /api/analytics
router.use("/", generalRouter);

// Детали теста: GET /api/analytics/tests/:testId
router.use("/tests", testDetailsRouter);

// Попытки: GET /api/analytics/tests/:testId/attempts, GET /api/analytics/attempts/:attemptId
router.use("/", attemptsRouter);

// SCORM: GET /api/analytics/scorm-attempts, GET /api/analytics/scorm-attempts/:attemptId
router.use("/", scormRouter);

// Комбинированная аналитика: GET /api/analytics/combined, GET /api/analytics/combined-full
router.use("/", combinedRouter);

// Экспорт: GET /api/analytics/tests/:testId/export/excel, GET/POST /api/export/*
router.use("/", exportRouter);

export default router;