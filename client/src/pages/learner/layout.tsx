import { Link, useLocation } from "wouter";
import { BookOpen, Home, LogOut, User, History, ClipboardList } from "lucide-react";
import { Avatar, Box, Button, Cluster, IconButton, Separator, Stack, Text } from "@universityrt/ui-kit";
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

  // PRD-25: главная — первый пункт и в учебной шапке тоже.
  const isHomeActive = location === "/";
  const isTestsActive = location === "/learner";
  const isHistoryActive = location === "/learner/history";

  return (
    <Stack minH="screen" gap={0}>
      <Box as="header" padX={6} padY={3}>
        <Cluster justify="between" gap={4}>
          <Cluster gap={6}>
            <Link href="/learner">
              <Cluster gap={2}>
                <BookOpen size={24} color="var(--ou-accent-default)" />
                <Text variant="heading-s" weight="semibold">{t.navigation.testCenter}</Text>
              </Cluster>
            </Link>
            <Cluster gap={1}>
              <Link href="/">
                <Button
                  variant={isHomeActive ? "secondary" : "ghost"}
                  size="s"
                  leadingIcon={<Home size={16} />}
                  data-testid="link-home"
                >
                  {t.navigation.home}
                </Button>
              </Link>
              <Link href="/learner">
                <Button
                  variant={isTestsActive ? "secondary" : "ghost"}
                  size="s"
                  leadingIcon={<ClipboardList size={16} />}
                  data-testid="link-tests"
                >
                  {t.navigation.tests}
                </Button>
              </Link>
              <Link href="/learner/history">
                <Button
                  variant={isHistoryActive ? "secondary" : "ghost"}
                  size="s"
                  leadingIcon={<History size={16} />}
                  data-testid="link-history"
                >
                  {t.navigation.history}
                </Button>
              </Link>
            </Cluster>
          </Cluster>

          <Cluster gap={3}>
            <ThemeToggle />
            <Box surface="muted" radius="m" padX={3} padY={1}>
              <Cluster gap={2}>
                <Avatar size="s"><User size={14} /></Avatar>
                <Text variant="body-s" weight="medium">{user?.name || user?.email}</Text>
              </Cluster>
            </Box>
            <IconButton
              variant="ghost"
              aria-label="Выход"
              icon={<LogOut size={16} />}
              onClick={handleLogout}
              data-testid="button-logout"
            />
          </Cluster>
        </Cluster>
      </Box>
      <Separator />

      <Box as="main" grow>{children}</Box>
    </Stack>
  );
}
