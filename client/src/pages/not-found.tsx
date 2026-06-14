import { AlertCircle } from "lucide-react";
import {
  Box,
  Card,
  CardBody,
  Center,
  IconBadge,
  Stack,
  Text,
} from "@universityrt/ui-kit";

export default function NotFound() {
  return (
    <Center minH="screen" pad={4}>
      <Box full maxW="md">
        <Card>
          <CardBody>
            <Stack gap={6}>
              <Stack gap={3} align="center">
                <IconBadge tone="error" icon={<AlertCircle />} />
                <Text as="h1" variant="heading-m" weight="semibold">
                  404 Page Not Found
                </Text>
                <Text variant="body-s" tone="muted" align="center">
                  Did you forget to add the page to the router?
                </Text>
              </Stack>
            </Stack>
          </CardBody>
        </Card>
      </Box>
    </Center>
  );
}
