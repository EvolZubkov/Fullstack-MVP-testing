/**
 * @module pages/forgot-password
 * @description Password-recovery request screen. The address is posted straight
 * to `POST /api/auth/forgot-password` and the answer is always the same neutral
 * confirmation — the screen neither probes nor reports whether an account with
 * that address exists, so it cannot be used to enumerate accounts.
 */
import { useState } from "react";
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
  const [isSuccess, setIsSuccess] = useState(false);

  // Получаем email из URL параметров
  const urlParams = new URLSearchParams(window.location.search);
  const emailFromUrl = urlParams.get("email") || "";

  const form = useForm<ForgotPasswordData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: emailFromUrl,
    },
  });

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

      // The confirmation is deliberately the same whether or not the address is
      // known: the screen never reports that an account does or does not exist.
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
                      {t.auth.resetLinkSentDescription}
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
                      {t.auth.resetPasswordDescription}
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
                        {...form.register("email")}
                      />
                      <Button type="submit" fullWidth loading={isSubmitting}>
                        {t.auth.sendResetLink}
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
