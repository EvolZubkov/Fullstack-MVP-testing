import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/password-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
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

      // Обновляем данные пользователя в контексте
      await refreshUser();

      // Перенаправляем на главную
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <UserCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{t.auth.firstLogin}</CardTitle>
          <CardDescription>
            {t.auth.firstLoginDescription}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Смена пароля */}
              {mustChangePassword && (
                <>
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium">{t.auth.changePassword}</h3>
                      <p className="text-sm text-muted-foreground">
                        {t.auth.currentPasswordIsTemporary}
                      </p>
                    </div>
                    <FormField
                      control={form.control}
                      name="newPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t.auth.newPassword}</FormLabel>
                          <FormControl>
                            <PasswordInput
                              placeholder="Минимум 8 символов"
                              autoComplete="new-password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t.auth.confirmNewPassword}</FormLabel>
                          <FormControl>
                            <PasswordInput
                              placeholder="Повторите пароль"
                              autoComplete="new-password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t.auth.completeRegistration}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}