import { Box, Cluster, Text } from "@universityrt/ui-kit";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}

export function PageHeader({ title, description, actions, icon }: PageHeaderProps) {
  return (
    <Box padBottom={6}>
      <Cluster justify="between" align="center" gap={4} wrap={false}>
        <Cluster align="start" gap={3} wrap={false}>
          {icon && <Text as="div" tone="muted" style={{ marginTop: "var(--ou-space-1)" }}>{icon}</Text>}
          <div>
            <Text as="h1" variant="heading-l">{title}</Text>
            {description && (
              <Text as="p" tone="muted" style={{ marginTop: "var(--ou-space-1)" }}>{description}</Text>
            )}
          </div>
        </Cluster>
        {actions && <Cluster gap={2} wrap={false}>{actions}</Cluster>}
      </Cluster>
    </Box>
  );
}
