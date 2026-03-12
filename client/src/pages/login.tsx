import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BookOpen, LogIn, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { loginSchema, type LoginData } from "@shared/schema";
import { t } from "@/lib/i18n";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginData) => {
    if (isLoading) return;
    console.log("=== LOGIN START ===");
    setIsLoading(true);
    try {
      console.log("Calling login...");
      const success = await login(data.email, data.password);
      console.log("Login result:", success);
      if (success) {
        toast({
          title: t.auth.welcomeBack,
          description: t.auth.loginSuccess,
        });
        console.log("Navigating to /...");
        navigate("/");
        console.log("Navigate called");
      } else {
        toast({
          variant: "destructive",
          title: t.auth.loginFailed,
          description: t.auth.invalidCredentials,
        });
      }
    } catch (err) {
      console.error("Login error:", err);
      toast({
        variant: "destructive",
        title: t.common.error,
        description: t.auth.somethingWentWrong,
      });
    } finally {
      setIsLoading(false);
      console.log("=== LOGIN END ===");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold">{t.auth.appName}</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-semibold">{t.auth.signIn}</CardTitle>
            <CardDescription>
              {t.auth.signInDescription}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.auth.email}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          placeholder={t.auth.emailPlaceholder}
                          data-testid="input-email"
                          autoComplete="email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.auth.password}</FormLabel>
                      <FormControl>
                        <PasswordInput
                          {...field}
                          placeholder={t.auth.passwordPlaceholder}
                          data-testid="input-password"
                          autoComplete="current-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading}
                  data-testid="button-login"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <LogIn className="h-4 w-4 mr-2" />
                  )}
                  {t.auth.signInButton}
                </Button>

                <div className="text-center">
                  <Link 
                    href={`/forgot-password${form.getValues("email") ? `?email=${encodeURIComponent(form.getValues("email"))}` : ""}`} 
                    className="text-sm text-primary hover:underline"
                  >
                    {t.auth.forgotPassword}
                  </Link>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
