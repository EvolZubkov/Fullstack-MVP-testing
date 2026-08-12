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
import adminTemplatesRouter from "./admin-templates";
import contentPagesRouter from "./content-pages";
import resultVariablesRouter from "./result-variables";
import scalesRouter from "./scales";
import testsWorkbookRouter from "./tests-workbook";
import workbookRouter from "./workbook";
import debugPlayerRouter from "./debug-player";
import homeRouter from "./home";
import reportRouter from "./report";
import mediaRouter from "./media";

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
  adminTemplatesRouter,
  contentPagesRouter,
  resultVariablesRouter,
  scalesRouter,
  testsWorkbookRouter,
  workbookRouter,
  debugPlayerRouter,
  homeRouter,
  reportRouter,
  mediaRouter,
};

// Конфигурация монтирования роутеров
export const routerConfig = [
  { path: "/access", router: accessRouter }, // magic link — до session guard
  { path: "/api/templates", router: templatesRouter },
  { path: "/api/admin/templates", router: adminTemplatesRouter },
  { path: "/api/tests", router: contentPagesRouter },
  { path: "/api/tests", router: resultVariablesRouter },
  { path: "/api/tests", router: scalesRouter },
  { path: "/api/tests", router: testsWorkbookRouter },
  { path: "/api/tests", router: debugPlayerRouter }, // PRD-18 debug player (session/play/delete)
  { path: "/api/workbook", router: workbookRouter },
  { path: "/api/folders", router: foldersRouter },
  { path: "/api/test-folders", router: testFoldersRouter },
  { path: "/api/topics", router: topicsRouter },
  { path: "/api/auth", router: authRouter },
  // PRD-25: смонтирован среди префиксных роутеров — до общих "/api",
  // чтобы путь не перехватывался ими
  { path: "/api/home", router: homeRouter },
  // Ingredients of the web-side attempt report (vendored PDF libs + report assets);
  // prefix-mounted before the generic "/api" routers so they cannot swallow it.
  { path: "/api/report", router: reportRouter },
  // Медиатека: префиксное монтирование до общих "/api", чтобы путь не перехватывался.
  { path: "/api/media", router: mediaRouter },
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
