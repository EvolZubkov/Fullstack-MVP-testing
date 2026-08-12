import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, ArrowLeft, CheckCircle } from "lucide-react";
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
  Stack,
  Text,
} from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n";

const forgotPasswordSchema = z.object({
  email: z.string().min(1, t.users.emailRequired).email(t.users.invalidEmail),
});

type ForgotPasswordData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [emailConfirmed, setEmailConfirmed] = useState(false);

  // Получаем email из URL параметров
  const urlParams = new URLSearchParams(window.location.search);
  const emailFromUrl = urlParams.get("email") || "";

  const form = useForm<ForgotPasswordData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: emailFromUrl,
    },
  });

  // Проверяем email при загрузке если он передан
  useEffect(() => {
    if (emailFromUrl) {
      checkEmail(emailFromUrl);
    }
  }, []);

  const checkEmail = async (email: string) => {
    if (!email || !email.includes("@")) return;

    setIsChecking(true);
    try {
      const res = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (data.exists && data.maskedEmail) {
        setMaskedEmail(data.maskedEmail);
      } else {
        setMaskedEmail(null);
      }
    } catch (error) {
      setMaskedEmail(null);
    } finally {
      setIsChecking(false);
    }
  };

  // Проверяем email при изменении с debounce
  const handleEmailBlur = () => {
    const email = form.getValues("email");
    if (email && email.includes("@")) {
      checkEmail(email);
    }
  };

  const onSubmit = async (data: ForgotPasswordData) => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });

      if (res.status === 429) {
        toast({
          variant: "destructive",
          title: t.auth.tooManyRequests,
          description: t.auth.tooManyRequestsDescription,
        });
        return;
      }

      const result = await res.json();
      if (result.maskedEmail) {
        setMaskedEmail(result.maskedEmail);
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

  return (
    <Center minH="screen" pad={4}>
      <Box full maxW="md">
        <Card>
          {isSuccess ? (
            <>
              <CardBody>
                <Stack gap={6}>
                  <Stack gap={3} align="center">
                    <IconBadge tone="success" icon={<CheckCircle />} />
                    <Text as="h1" variant="heading-m" weight="semibold">
                      {t.auth.resetLinkSent}
                    </Text>
                    <Text variant="body-s" tone="muted" align="center">
                      {maskedEmail ? (
                        <>
                          Ссылка для сброса пароля отправлена на{" "}
                          <Text as="strong" variant="body-s" weight="semibold">
                            {maskedEmail}
                          </Text>
                        </>
                      ) : (
                        t.auth.resetLinkSentDescription
                      )}
                    </Text>
                  </Stack>
                </Stack>
              </CardBody>
              <CardFooter>
                <Link href="/login">
                  <Button
                    variant="secondary"
                    fullWidth
                    leadingIcon={<ArrowLeft size={16} />}
                  >
                    {t.auth.backToLogin}
                  </Button>
                </Link>
              </CardFooter>
            </>
          ) : (
            <>
              <CardBody>
                <Stack gap={6}>
                  <Stack gap={3} align="center">
                    <IconBadge tone="accent" icon={<Mail />} />
                    <Text as="h1" variant="heading-m" weight="semibold">
                      {t.auth.resetPassword}
                    </Text>
                    <Text variant="body-s" tone="muted" align="center">
                      {maskedEmail ? (
                        <>
                          Отправить ссылку для сброса пароля на{" "}
                          <Text as="strong" variant="body-s" weight="semibold">
                            {maskedEmail}
                          </Text>
                          ?
                        </>
                      ) : (
                        t.auth.resetPasswordDescription
                      )}
                    </Text>
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
                        {...form.register("email", {
                          onBlur: handleEmailBlur,
                        })}
                      />
                      <Button
                        type="submit"
                        fullWidth
                        loading={isSubmitting || isChecking}
                      >
                        {maskedEmail ? "Отправить ссылку" : t.auth.sendResetLink}
                      </Button>
                    </Stack>
                  </form>
                </Stack>
              </CardBody>
              <CardFooter>
                <Link href="/login">
                  <Button
                    variant="ghost"
                    fullWidth
                    leadingIcon={<ArrowLeft size={16} />}
                  >
                    {t.auth.backToLogin}
                  </Button>
                </Link>
              </CardFooter>
            </>
          )}
        </Card>
      </Box>
    </Center>
  );
}
