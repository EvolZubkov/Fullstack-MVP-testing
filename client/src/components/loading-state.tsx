import { Loader2 } from "lucide-react";
import { Stack, Text } from "@universityrt/ui-kit";

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Loading..." }: LoadingStateProps) {
  return (
    <Stack align="center" justify="center" padX={6} className="py-16">
      <Loader2 size={32} color="var(--ou-accent-default)" className="animate-spin" />
      <Text as="p" tone="muted">{message}</Text>
    </Stack>
  );
}

export function LoadingSpinner({ className = "" }: { className?: string }) {
  return <Loader2 size={16} className={`animate-spin ${className}`} />;
}
