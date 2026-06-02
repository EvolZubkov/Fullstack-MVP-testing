import foldersRouter from "./folders";
import testFoldersRouter from "./test-folders";
import topicsRouter from "./topics";
import authRouter from "./auth";
import usersRouter from "./users";
import groupsRouter from "./groups";
import questionsRouter from "./questions";
import testsRouter from "./tests";
import attemptsRouter from "./attempts";
import assignmentsRouter from "./assignments";
import analyticsRouter from "./analytics/index";
import scormTelemetryRouter from "./scorm-telemetry";
import logsRouter from "./logs";
import accessRouter from "./access";
import templatesRouter from "./templates";
import contentPagesRouter from "./content-pages";
import resultVariablesRouter from "./result-variables";
import scalesRouter from "./scales";

export {
  foldersRouter,
  testFoldersRouter,
  topicsRouter,
  authRouter,
  usersRouter,
  groupsRouter,
  questionsRouter,
  testsRouter,
  attemptsRouter,
  assignmentsRouter,
  analyticsRouter,
  scormTelemetryRouter,
  logsRouter,
  accessRouter,
  templatesRouter,
  contentPagesRouter,
  resultVariablesRouter,
  scalesRouter,
};

// Конфигурация монтирования роутеров
export const routerConfig = [
  { path: "/access", router: accessRouter }, // magic link — до session guard
  { path: "/api/templates", router: templatesRouter },
  { path: "/api/tests", router: contentPagesRouter },
  { path: "/api/tests", router: resultVariablesRouter },
  { path: "/api/tests", router: scalesRouter },
  { path: "/api/folders", router: foldersRouter },
  { path: "/api/test-folders", router: testFoldersRouter },
  { path: "/api/topics", router: topicsRouter },
  { path: "/api/auth", router: authRouter },
  { path: "/api/users", router: usersRouter },
  { path: "/api/groups", router: groupsRouter },
  { path: "/api/questions", router: questionsRouter },
  { path: "/api/tests", router: testsRouter },
  { path: "/api", router: attemptsRouter },
  { path: "/api", router: assignmentsRouter },
  { path: "/api/analytics", router: analyticsRouter },
  { path: "/api", router: analyticsRouter }, // для /api/export/*
  { path: "/api", router: scormTelemetryRouter },
  { path: "/api/logs", router: logsRouter },
];
