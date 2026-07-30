import { useSyncExternalStore } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { ToastProvider } from "@universityrt/ui-kit";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ToastBridge } from "@/hooks/use-toast";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LoadingState } from "@/components/loading-state";
import { isScopeViolation, subscribeScopeViolation } from "@/lib/magic-scope";
import type { Capability } from "@shared/access";
import NotFound from "@/pages/not-found";
import NoAccessPage from "@/pages/no-access";
import LoginPage from "@/pages/login";
import HomeRoute from "@/pages/home";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import FirstLoginPage from "@/pages/first-login";
import ContentPage from "@/pages/author/content";
import TestsPage from "@/pages/author/tests";
import AuthorTemplatesPage from "@/pages/author/templates";
import AnalyticsPage from "@/pages/author/analytics";
import TestAnalyticsPage from "@/pages/author/test-analytics";
import DebugPlayerPage from "@/features/tests/debug-player/debug-player-page";
import UsersPage from "@/pages/author/users";
import GroupsPage from "@/pages/author/groups";
import ImportPage from "@/pages/author/import";
import { AuthorLayout } from "@/pages/author/layout";
import LearnerTestListPage from "@/pages/learner/test-list";
import TakeTestPage from "@/pages/learner/take-test";
import ResultPage from "@/pages/learner/result";
import HistoryPage from "@/pages/learner/history";
import { LearnerLayout } from "@/pages/learner/layout";
import LogsPage from "@/pages/author/logs";

export function ProtectedRoute({
  children,
  requiredPermission,
}: {
  children: React.ReactNode;
  requiredPermission?: Capability;
}) {
  const { user, isLoading, can } = useAuth();
  const [location] = useLocation();
  const scopeViolated = useSyncExternalStore(subscribeScopeViolation, isScopeViolation, () => false);

  if (isLoading) {
    return <LoadingState message="Loading..." />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  // A session opened by an assignment link is access to ONE test. Two routes stay
  // open: that test and a result page — ownership of the attempt is the server's
  // call, so the client does not duplicate the check. Everything else, including
  // the first-login gate below, is outside the link's remit, and the way out of the
  // test is a full authentication — so send the learner straight to the login form
  // instead of an intermediate "you cannot go there" screen.
  if (user.magicScope) {
    const testPath = `/learner/test/${user.magicScope.testId}`;
    // Wouter matches a route with an optional trailing slash, so `/learner/test/t1/`
    // is the same page as `/learner/test/t1` — compare without it, or the learner
    // gets bounced to the login form while standing on their own test.
    const path = location.replace(/\/+$/, "") || "/";
    const insideScope =
      !scopeViolated && (path === testPath || path.startsWith("/learner/result/"));
    if (!insideScope) return <Redirect to="/login" />;
    return <>{children}</>;
  }

  // Проверка первого входа: нужно согласие GDPR или смена пароля
  if (!user.gdprConsent || user.mustChangePassword) {
    return <FirstLoginPage mustChangePassword={user.mustChangePassword ?? false} />;
  }

  // PRD-13: доступ к маршруту по праву (capability), а не по жёсткой роли.
  // PRD-25 FR-19: отказ ведёт на главную. Раньше здесь выбиралась «самая
  // привилегированная доступная область», и когда таковой не было, приходилось
  // рисовать экран «нет доступа», иначе редирект зациклился бы. Теперь у любого
  // аутентифицированного пользователя есть куда приземлиться: главная сама
  // покажет «нет доступа», если ей нечего показать (FR-18).
  if (requiredPermission && !can(requiredPermission)) {
    return location === "/" ? <NoAccessPage /> : <Redirect to="/" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      {/* PRD-25: «/» — настоящая страница, а не редирект по ролям. */}
      <Route path="/">
        <ProtectedRoute>
          <HomeRoute />
        </ProtectedRoute>
      </Route>
      <Route path="/login" component={LoginPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />

      <Route path="/author/content">
        <ProtectedRoute requiredPermission="topics.manage">
          <AuthorLayout>
            <ContentPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      {/* PRD-16: «Темы» и «Вопросы» объединены в единый раздел «Темы и вопросы».
         Старые маршруты редиректят на /author/content (закладки/ссылки не падают). */}
      <Route path="/author/topics"><Redirect to="/author/content" /></Route>
      <Route path="/author/questions"><Redirect to="/author/content" /></Route>

      <Route path="/author/tests">
        <ProtectedRoute requiredPermission="tests.read">
          <AuthorLayout>
            <TestsPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/author/templates">
        <ProtectedRoute requiredPermission="adminTemplates.manage">
          <AuthorLayout>
            <AuthorTemplatesPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/author/analytics">
        <ProtectedRoute requiredPermission="analytics.read">
          <AuthorLayout>
            <AnalyticsPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/author/tests/:testId/analytics">
        <ProtectedRoute requiredPermission="analytics.read">
          <AuthorLayout>
            <TestAnalyticsPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      {/* PRD-18: in-service debug player — full-screen, no AuthorLayout (like take-test). */}
      <Route path="/author/tests/:testId/debug">
        <ProtectedRoute requiredPermission="tests.export.scorm">
          <DebugPlayerPage />
        </ProtectedRoute>
      </Route>

      <Route path="/author/users">
        <ProtectedRoute requiredPermission="users.read">
          <AuthorLayout>
            <UsersPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/author/groups">
        <ProtectedRoute requiredPermission="groups.manage">
          <AuthorLayout>
            <GroupsPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/author/import">
        <ProtectedRoute requiredPermission="questions.importExport">
          <AuthorLayout>
            <ImportPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/author/logs">
        <ProtectedRoute requiredPermission="logs.read">
          <AuthorLayout>
            <LogsPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/learner">
        <ProtectedRoute requiredPermission="attempts.self.read">
          <LearnerLayout>
            <LearnerTestListPage />
          </LearnerLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/learner/test/:testId">
        <ProtectedRoute requiredPermission="attempts.take">
          <TakeTestPage />
        </ProtectedRoute>
      </Route>

      <Route path="/learner/result/:attemptId">
        <ProtectedRoute requiredPermission="attempts.self.read">
          <LearnerLayout>
            <ResultPage />
          </LearnerLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/learner/history">
        <ProtectedRoute requiredPermission="attempts.self.read">
          <LearnerLayout>
            <HistoryPage />
          </LearnerLayout>
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <ToastBridge />
          <AuthProvider>
            <Router />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
