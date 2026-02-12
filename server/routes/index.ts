import foldersRouter from "./folders";
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

export {
  foldersRouter,
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
};

// Конфигурация монтирования роутеров
export const routerConfig = [
  { path: "/api/folders", router: foldersRouter },
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
];
