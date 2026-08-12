import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserCheck } from "lucide-react";
import {
  Box,
  Button,
  Card,
  CardBody,
  Center,
  IconBadge,
  Input,
  Separator,
  Stack,
  Text,
} from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";

interface FirstLoginPageProps {
  mustChangePassword: boolean;
}

const passwordRegex = /^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]+$/;

const createSchema = (mustChangePassword: boolean) =>
  z.object({
    newPassword: mustChangePassword
      ? z.string()
          .min(8, t.users.passwordMinLength)
          .regex(passwordRegex, t.users.passwordInvalidChars)
      : z.string().optional(),
    confirmPassword: mustChangePassword
      ? z.string().min(1, t.users.passwordRequired)
      : z.string().optional(),
  }).refine(
    (data) => {
      if (mustChangePassword) {
        return data.newPassword === data.confirmPassword;
      }
      return true;
    },
    {
      message: t.auth.passwordsDoNotMatch,
      path: ["confirmPassword"],
    }
  );

export default function FirstLoginPage({ mustChangePassword }: FirstLoginPageProps) {
  const { toast } = useToast();
  const { refreshUser } = useAuth();
  const [, navigate] = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const schema = createSchema(mustChangePassword);
  type FormData = z.infer<typeof schema>;

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/complete-first-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          gdprConsent: true,
          newPassword: mustChangePassword ? data.newPassword : undefined,
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

      toast({
        title: t.auth.registrationCompleted,
        description: t.auth.registrationCompletedDescription,
      });

      // Refresh the user data in the context
      await refreshUser();

      // Redirect to the home page
      navigate("/");
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
      <Box full maxW="lg">
        <Card>
          <CardBody>
            <Stack gap={6}>
              <Stack gap={3} align="center">
                <IconBadge tone="accent" icon={<UserCheck />} />
                <Text as="h1" variant="heading-m" weight="semibold">{t.auth.firstLogin}</Text>
                <Text variant="body-s" tone="muted" align="center">
                  {t.auth.firstLoginDescription}
                </Text>
              </Stack>

              <form onSubmit={form.handleSubmit(onSubmit)}>
                <Stack gap={6}>
                  {/* Password change */}
                  {mustChangePassword && (
                    <Stack gap={4}>
                      <Stack gap={1}>
                        <Text variant="body-s" weight="medium">{t.auth.changePassword}</Text>
                        <Text variant="body-s" tone="muted">
                          {t.auth.currentPasswordIsTemporary}
                        </Text>
                      </Stack>
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
                      <Separator />
                    </Stack>
                  )}

                  <Button
                    type="submit"
                    fullWidth
                    loading={isSubmitting}
                    leadingIcon={<UserCheck size={16} />}
                  >
                    {t.auth.completeRegistration}
                  </Button>
                </Stack>
              </form>
            </Stack>
          </CardBody>
        </Card>
      </Box>
    </Center>
  );
}
