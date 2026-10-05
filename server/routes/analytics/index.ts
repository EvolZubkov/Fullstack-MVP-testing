import { Router } from "express";
import testDetailsRouter from "./test-details";
import attemptsRouter from "./attempts";
import scormRouter from "./scorm";
import summaryRouter from "./summary";
import questionDeliveryRouter from "./question-delivery";
import questionCardRouter from "./question-card";
import questionAnswersRouter from "./question-answers";
import deliveryRouter from "./delivery";
import scalesRouter from "./scales";
import registryRouter from "./registry";
import attentionRouter from "./attention";
import slicesRouter from "./slices";
import exportRouter from "./export";
import lmsImportRouter from "./lms-import";
import psychometricsRouter from "./psychometrics";
import questionBankRouter from "./question-bank";

// Реэкспорт хелперов для использования в других модулях
export {
  formatQuestionType,
  formatAllOptions,
  formatCorrectAnswerText,
  formatUserAnswerText,
} from "./helpers";

const router = Router();

// Детали теста: GET /api/analytics/tests/:testId
router.use("/tests", testDetailsRouter);

// Попытки: GET /api/analytics/tests/:testId/attempts, GET /api/analytics/attempts/:attemptId
router.use("/", attemptsRouter);

// SCORM: GET /api/analytics/scorm-attempts, GET /api/analytics/scorm-attempts/:attemptId
router.use("/", scormRouter);

// Сводка по отбору: GET /api/analytics/summary
router.use("/", summaryRouter);

// PRD-56 FR-17a: исключение задания из выдачи теста и возврат в неё
router.use("/", questionDeliveryRouter);

// Э3.3: вопрос в тесте — его настройки и другие тесты, где он выдавался
router.use("/", questionCardRouter);

// PRD-57 FR-32: ответы одного задания списком и выгрузкой
router.use("/", questionAnswersRouter);

// PRD-56 FR-18 - FR-20: вкладка «Выдача» — GET /api/analytics/tests/:testId/delivery
router.use("/", deliveryRouter);

// PRD-56 FR-21: вкладка «Шкалы» — GET /api/analytics/tests/:testId/scales
router.use("/", scalesRouter);

// PRD-66 FR-56: психометрика теста — GET /api/analytics/psychometrics/:testId
router.use("/", psychometricsRouter);

// PRD-70: ось банка вопросов — GET /api/analytics/bank/quality, ориентир сложности вопроса
router.use("/", questionBankRouter);

// PRD-56: реестр прохождений — GET /api/analytics/registry
router.use("/", registryRouter);

// PRD-56: очередь «требует внимания» — GET /api/analytics/attention
router.use("/", attentionRouter);

// PRD-56: срезы прохождений — GET /api/analytics/slices
router.use("/", slicesRouter);

// Экспорт: GET /api/analytics/tests/:testId/export/excel, GET/POST /api/export/*
router.use("/", exportRouter);

// PRD-54: загрузка выгрузок отчётов LMS: POST /api/analytics/lms-import, партии и откат
router.use("/", lmsImportRouter);

export default router;