import { Loader2 } from "lucide-react";
import { Text } from "@universityrt/ui-kit";

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Loading..." }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      <Loader2 size={32} color="var(--ou-accent-default)" className="animate-spin mb-4" />
      <Text as="p" tone="muted">{message}</Text>
    </div>
  );
}

export function LoadingSpinner({ className = "" }: { className?: string }) {
  return <Loader2 size={16} className={`animate-spin ${className}`} />;
}
