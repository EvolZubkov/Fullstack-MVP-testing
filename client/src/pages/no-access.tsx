/**
 * @module pages/no-access
 *
 * "No access" screen shown to an authenticated user who holds no capability that
 * grants access to any application area — typically an account with no roles
 * assigned (PRD-13). It replaces what used to be an infinite redirect loop (the
 * default-landing fallback pointed at a route the user could not enter, so the
 * route guard redirected back to it forever, leaving a blank screen). Offers a
 * logout action so the user can switch to a different account.
 */

import { ShieldAlert, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

export default function NoAccessPage() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex items-center mb-4 gap-2">
            <ShieldAlert className="h-8 w-8 text-amber-500" />
            <h1 className="text-2xl font-bold">Нет доступа</h1>
          </div>

          <p className="text-sm text-muted-foreground">
            Вашей учётной записи не назначено ни одной роли, поэтому ни один раздел
            приложения сейчас недоступен. Обратитесь к администратору, чтобы он
            назначил вам роль.
          </p>

          <Button variant="outline" className="mt-6 w-full" onClick={() => logout()}>
            <LogOut className="h-4 w-4 mr-2" />
            Выйти
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
