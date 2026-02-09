import { Link, useLocation } from "wouter";
import { BookOpen, LogOut, User, History, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";

interface LearnerLayoutProps {
  children: React.ReactNode;
}

export function LearnerLayout({ children }: LearnerLayoutProps) {
  const { user, logout } = useAuth();
  const [location, navigate] = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const isTestsActive = location === "/learner";
  const isHistoryActive = location === "/learner/history";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between gap-4 px-6 py-3 border-b shrink-0">
        <div className="flex items-center gap-6">
          <Link href="/learner" className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <span className="font-semibold text-lg">{t.navigation.testCenter}</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link href="/learner">
              <Button 
                variant={isTestsActive ? "secondary" : "ghost"} 
                size="sm" 
                data-testid="link-tests"
              >
                <ClipboardList className="h-4 w-4 mr-1" />
                {t.navigation.tests}
              </Button>
            </Link>
            <Link href="/learner/history">
              <Button 
                variant={isHistoryActive ? "secondary" : "ghost"} 
                size="sm" 
                data-testid="link-history"
              >
                <History className="h-4 w-4 mr-1" />
                {t.navigation.history}
              </Button>
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted">
            <Avatar className="h-7 w-7">
              <AvatarFallback>
                <User className="h-3 w-3" />
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium">{user?.name || user?.email}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
