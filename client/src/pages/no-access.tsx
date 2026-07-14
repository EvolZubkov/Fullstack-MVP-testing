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
import {
  Box,
  Button,
  Card,
  CardBody,
  Center,
  IconBadge,
  Stack,
  Text,
} from "@universityrt/ui-kit";
import { useAuth } from "@/lib/auth";

export default function NoAccessPage() {
  const { logout } = useAuth();

  return (
    <Center minH="screen" pad={4}>
      <Box full maxW="md">
        <Card>
          <CardBody>
            <Stack gap={6}>
              <Stack gap={3} align="center">
                <IconBadge tone="warning" size="l" icon={<ShieldAlert />} />
                <Text as="h1" variant="heading-m" weight="semibold">
                  Нет доступа
                </Text>
                <Text variant="body-s" tone="muted" align="center">
                  Вашей учётной записи не назначено ни одной роли, поэтому ни один
                  раздел приложения сейчас недоступен. Обратитесь к
                  администратору, чтобы он назначил вам роль.
                </Text>
              </Stack>

              <Button
                variant="secondary"
                fullWidth
                leadingIcon={<LogOut size={16} />}
                onClick={() => logout()}
              >
                Выйти
              </Button>
            </Stack>
          </CardBody>
        </Card>
      </Box>
    </Center>
  );
}
