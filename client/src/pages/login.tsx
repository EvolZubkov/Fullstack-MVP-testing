import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BookOpen, LogIn } from "lucide-react";
import {
  Box,
  Button,
  Card,
  CardBody,
  Center,
  Cluster,
  Input,
  Separator,
  Stack,
  Text,
  useToast,
} from "@skillum/ui-kit";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { loginSchema, type LoginData } from "@shared/schema";
import { t } from "@/lib/i18n";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { login, logout } = useAuth();
  const { push: toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: LoginData) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const outcome = await login(data.email, data.password);
      if (outcome === "ok") {
        toast({ tone: "success", title: t.auth.welcomeBack, description: t.auth.loginSuccess });
        navigate("/");
      } else if (outcome === "link-scope") {
        // The session still carries an invitation link, and a link admits nothing
        // outside its test — the sign-in included. Ending it here turns a dead end
        // into a second attempt that works, instead of a password the person is
        // told is wrong while it is right.
        await logout();
        toast({
          tone: "error",
          title: t.auth.loginFailed,
          description: t.auth.linkScopeBlocksLogin,
        });
      } else {
        toast({
          tone: "error",
          title: t.auth.loginFailed,
          description: t.auth.invalidCredentials,
        });
      }
    } catch (err) {
      toast({
        tone: "error",
        title: t.common.error,
        description: t.auth.somethingWentWrong,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Stack minH="screen" gap={0}>
      <Box as="header" padX={4} padY={3}>
        <Cluster justify="between">
          <Cluster gap={2}>
            <BookOpen size={24} color="var(--ou-accent-default)" />
            <Text variant="heading-s" weight="semibold">{t.auth.appName}</Text>
          </Cluster>
          <ThemeToggle />
        </Cluster>
      </Box>
      <Separator />

      <Center grow pad={6}>
        <Box full maxW="md">
          <Card>
            <CardBody>
              <Stack gap={6}>
                <Stack gap={1} align="center">
                  <Text as="h1" variant="heading-m" weight="semibold">{t.auth.signIn}</Text>
                  <Text variant="body-s" tone="muted" align="center">{t.auth.signInDescription}</Text>
                </Stack>

                <form onSubmit={form.handleSubmit(onSubmit)}>
                  <Stack gap={4}>
                    <Input
                      label={t.auth.email}
                      type="email"
                      placeholder={t.auth.emailPlaceholder}
                      autoComplete="email"
                      fullWidth
                      error={form.formState.errors.email?.message}
                      data-testid="input-email"
                      {...form.register("email")}
                    />
                    <Input
                      label={t.auth.password}
                      revealToggle
                      placeholder={t.auth.passwordPlaceholder}
                      autoComplete="current-password"
                      fullWidth
                      error={form.formState.errors.password?.message}
                      data-testid="input-password"
                      {...form.register("password")}
                    />
                    <Button
                      type="submit"
                      fullWidth
                      loading={isLoading}
                      leadingIcon={<LogIn size={16} />}
                      data-testid="button-login"
                    >
                      {t.auth.signInButton}
                    </Button>

                    <Cluster justify="center">
                      <Link href={`/forgot-password${form.getValues("email") ? `?email=${encodeURIComponent(form.getValues("email"))}` : ""}`}>
                        <Text variant="body-s" tone="accent">{t.auth.forgotPassword}</Text>
                      </Link>
                    </Cluster>
                  </Stack>
                </form>
              </Stack>
            </CardBody>
          </Card>
        </Box>
      </Center>
    </Stack>
  );
}
