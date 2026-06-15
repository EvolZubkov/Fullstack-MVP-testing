import { Switch, Route, Redirect, useLocation } from "wouter";
import { ToastProvider } from "@universityrt/ui-kit";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ToastBridge } from "@/hooks/use-toast";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LoadingState } from "@/components/loading-state";
import type { Capability } from "@shared/access";
import NotFound from "@/pages/not-found";
import NoAccessPage from "@/pages/no-access";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import FirstLoginPage from "@/pages/first-login";
import TopicsPage from "@/pages/author/topics";
import QuestionsPage from "@/pages/author/questions";
import ContentPage from "@/pages/author/content";
import TestsPage from "@/pages/author/tests";
import AuthorTemplatesPage from "@/pages/author/templates";
import AnalyticsPage from "@/pages/author/analytics";
import TestAnalyticsPage from "@/pages/author/test-analytics";
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

/**
 * Default landing path for the current user (PRD-13 FR-30), chosen by the most
 * privileged area they can access: content roles -> tests; managers -> users;
 * learners -> the learner area. Returns `null` when the user holds no capability
 * that grants access to ANY area (e.g. an account with no roles): callers must
 * then render a "no access" screen instead of redirecting, otherwise the
 * fallback would point at a route the user also cannot enter and the guard would
 * redirect back to it forever (an infinite-redirect black screen).
 */
function homePath(can: (cap: Capability) => boolean): string | null {
  if (can("topics.manage")) return "/author/tests";
  if (can("groups.manage") || can("users.read")) return "/author/users";
  if (can("attempts.self.read")) return "/learner";
  return null;
}

function ProtectedRoute({
  children,
  requiredPermission,
}: {
  children: React.ReactNode;
  requiredPermission?: Capability;
}) {
  const { user, isLoading, can } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return <LoadingState message="Loading..." />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  // Проверка первого входа: нужно согласие GDPR или смена пароля
  if (!user.gdprConsent || user.mustChangePassword) {
    return <FirstLoginPage mustChangePassword={user.mustChangePassword ?? false} />;
  }

  // PRD-13: доступ к маршруту по праву (capability), а не по жёсткой роли.
  if (requiredPermission && !can(requiredPermission)) {
    const target = homePath(can);
    // No reachable landing area, or the only landing area IS this route:
    // redirecting would loop forever, so show an explicit "no access" screen.
    if (!target || target === location) {
      return <NoAccessPage />;
    }
    return <Redirect to={target} />;
  }

  return <>{children}</>;
}

function HomeRedirect() {
  const { user, isLoading, can } = useAuth();

  if (isLoading) {
    return <LoadingState message="Loading..." />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  const target = homePath(can);
  return target ? <Redirect to={target} /> : <NoAccessPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
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

      <Route path="/author/topics">
        <ProtectedRoute requiredPermission="topics.manage">
          <AuthorLayout>
            <TopicsPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/author/questions">
        <ProtectedRoute requiredPermission="questions.manage">
          <AuthorLayout>
            <QuestionsPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

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
