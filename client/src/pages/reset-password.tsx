import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, ArrowLeft, CheckCircle, XCircle } from "lucide-react";
import {
  Box,
  Button,
  Card,
  CardBody,
  CardFooter,
  Center,
  Cluster,
  IconBadge,
  Input,
  Spinner,
  Stack,
  Text,
} from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n";

const passwordRegex = /^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]+$/;

const resetPasswordSchema = z.object({
  newPassword: z.string()
    .min(8, t.users.passwordMinLength)
    .regex(passwordRegex, t.users.passwordInvalidChars),
  confirmPassword: z.string().min(1, t.users.passwordRequired),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: t.auth.passwordsDoNotMatch,
  path: ["confirmPassword"],
});

type ResetPasswordData = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [token, setToken] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(true);
  const [isValidToken, setIsValidToken] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<ResetPasswordData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Get the token from the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    setToken(urlToken);

    if (urlToken) {
      verifyToken(urlToken);
    } else {
      setIsVerifying(false);
      setIsValidToken(false);
    }
  }, []);

  const verifyToken = async (tokenToVerify: string) => {
    try {
      const res = await fetch(`/api/auth/verify-reset-token?token=${tokenToVerify}`);
      const data = await res.json();
      setIsValidToken(data.valid === true);
    } catch (error) {
      setIsValidToken(false);
    } finally {
      setIsVerifying(false);
    }
  };

  const onSubmit = async (data: ResetPasswordData) => {
    if (!token) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword: data.newPassword,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        toast({
          variant: "destructive",
          title: t.common.error,
          description: result.error || t.auth.somethingWentWrong,
        });
        return;
      }

      setIsSuccess(true);
    } catch (error) {
      toast({
        variant: "destructive",
        title: t.common.error,
        description: t.auth.somethingWentWrong,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading
  if (isVerifying) {
    return (
      <Center minH="screen" pad={4}>
        <Box full maxW="md">
          <Card>
            <CardBody>
              <Cluster justify="center">
                <Spinner size="l" tone="neutral" />
              </Cluster>
            </CardBody>
          </Card>
        </Box>
      </Center>
    );
  }

  // Invalid token
  if (!isValidToken && !isSuccess) {
    return (
      <Center minH="screen" pad={4}>
        <Box full maxW="md">
          <Card>
            <CardBody>
              <Stack gap={3} align="center">
                <IconBadge tone="error" size="l" icon={<XCircle />} />
                <Text as="h1" variant="heading-m" weight="semibold">{t.auth.invalidOrExpiredToken}</Text>
                <Text variant="body-s" tone="muted" align="center">
                  {t.auth.invalidOrExpiredTokenDescription}
                </Text>
              </Stack>
            </CardBody>
            <CardFooter>
              <Stack gap={2} full>
                <Link href="/forgot-password">
                  <Button fullWidth>{t.auth.requestNewLink}</Button>
                </Link>
                <Link href="/login">
                  <Button variant="ghost" fullWidth leadingIcon={<ArrowLeft size={16} />}>
                    {t.auth.backToLogin}
                  </Button>
                </Link>
              </Stack>
            </CardFooter>
          </Card>
        </Box>
      </Center>
    );
  }

  // Success
  if (isSuccess) {
    return (
      <Center minH="screen" pad={4}>
        <Box full maxW="md">
          <Card>
            <CardBody>
              <Stack gap={3} align="center">
                <IconBadge tone="success" size="l" icon={<CheckCircle />} />
                <Text as="h1" variant="heading-m" weight="semibold">{t.auth.passwordResetSuccess}</Text>
                <Text variant="body-s" tone="muted" align="center">
                  {t.auth.passwordResetSuccessDescription}
                </Text>
              </Stack>
            </CardBody>
            <CardFooter>
              <Link href="/login">
                <Button fullWidth>{t.auth.signInButton}</Button>
              </Link>
            </CardFooter>
          </Card>
        </Box>
      </Center>
    );
  }

  // New password form
  return (
    <Center minH="screen" pad={4}>
      <Box full maxW="md">
        <Card>
          <CardBody>
            <Stack gap={6}>
              <Stack gap={3} align="center">
                <IconBadge tone="accent" size="l" icon={<KeyRound />} />
                <Text as="h1" variant="heading-m" weight="semibold">{t.auth.resetPassword}</Text>
                <Text variant="body-s" tone="muted" align="center">
                  Введите новый пароль для вашего аккаунта
                </Text>
              </Stack>

              <form onSubmit={form.handleSubmit(onSubmit)}>
                <Stack gap={4}>
                  <Input
                    label={t.auth.newPassword}
                    revealToggle
                    placeholder="Минимум 8 символов"
                    autoComplete="new-password"
                    fullWidth
                    error={form.formState.errors.newPassword?.message}
                    {...form.register("newPassword")}
                  />
                  <Input
                    label={t.auth.confirmNewPassword}
                    revealToggle
                    placeholder="Повторите пароль"
                    autoComplete="new-password"
                    fullWidth
                    error={form.formState.errors.confirmPassword?.message}
                    {...form.register("confirmPassword")}
                  />
                  <Button
                    type="submit"
                    fullWidth
                    loading={isSubmitting}
                  >
                    {t.auth.resetPassword}
                  </Button>
                </Stack>
              </form>
            </Stack>
          </CardBody>
          <CardFooter>
            <Link href="/login">
              <Button variant="ghost" fullWidth leadingIcon={<ArrowLeft size={16} />}>
                {t.auth.backToLogin}
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </Box>
    </Center>
  );
}
