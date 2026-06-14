import { Text } from "@universityrt/ui-kit";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}

export function PageHeader({ title, description, actions, icon }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-6">
      <div className="flex items-start gap-3">
        {icon && <Text as="div" tone="muted" className="mt-1">{icon}</Text>}
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && (
            <Text as="p" tone="muted" className="mt-1">{description}</Text>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 mt-3 sm:mt-0">{actions}</div>}
    </div>
  );
}
