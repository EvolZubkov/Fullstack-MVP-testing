import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LoadingState } from "@/components/loading-state";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import TopicsPage from "@/pages/author/topics";
import QuestionsPage from "@/pages/author/questions";
import TestsPage from "@/pages/author/tests";
import AnalyticsPage from "@/pages/author/analytics";
import { AuthorLayout } from "@/pages/author/layout";
import LearnerTestListPage from "@/pages/learner/test-list";
import TakeTestPage from "@/pages/learner/take-test";
import ResultPage from "@/pages/learner/result";
import HistoryPage from "@/pages/learner/history";
import { LearnerLayout } from "@/pages/learner/layout";

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  if (isLoading) {
    return <LoadingState message="Loading..." />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (user.role === "author") {
      return <Redirect to="/author/topics" />;
    } else {
      return <Redirect to="/learner" />;
    }
  }

  return <>{children}</>;
}

function HomeRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingState message="Loading..." />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (user.role === "author") {
    return <Redirect to="/author/topics" />;
  }

  return <Redirect to="/learner" />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/login" component={LoginPage} />

      <Route path="/author/topics">
        <ProtectedRoute allowedRoles={["author"]}>
          <AuthorLayout>
            <TopicsPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/author/questions">
        <ProtectedRoute allowedRoles={["author"]}>
          <AuthorLayout>
            <QuestionsPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/author/tests">
        <ProtectedRoute allowedRoles={["author"]}>
          <AuthorLayout>
            <TestsPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/author/analytics">
        <ProtectedRoute allowedRoles={["author"]}>
          <AuthorLayout>
            <AnalyticsPage />
          </AuthorLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/learner">
        <ProtectedRoute allowedRoles={["learner"]}>
          <LearnerLayout>
            <LearnerTestListPage />
          </LearnerLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/learner/test/:testId">
        <ProtectedRoute allowedRoles={["learner"]}>
          <TakeTestPage />
        </ProtectedRoute>
      </Route>

      <Route path="/learner/result/:attemptId">
        <ProtectedRoute allowedRoles={["learner"]}>
          <LearnerLayout>
            <ResultPage />
          </LearnerLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/learner/history">
        <ProtectedRoute allowedRoles={["learner"]}>
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
        <TooltipProvider>
          <AuthProvider>
            <Toaster />
            <Router />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
