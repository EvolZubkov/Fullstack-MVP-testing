/**
 * @module components/design-settings-dialog
 * @description Dialog for selecting a design template and configuring its parameters.
 * Fetches the template list from GET /api/templates and current settings from
 * GET /api/tests/:testId/design, then saves via PUT /api/tests/:testId/design.
 */
import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TemplateParam {
  key: string;
  type: "color" | "text" | "number" | "boolean" | "select" | "image" | "font" | "asset";
  label: string;
  default: unknown;
  options?: string[];
  group?: string;
}

export interface TemplateManifest {
  params: TemplateParam[];
  contentTemplates?: unknown[];
}

export interface Template {
  id: string;
  name: string;
  version: string;
  templateApiVersion: string;
  description?: string;
  isBuiltin: boolean;
  isActive: boolean;
  manifest: TemplateManifest;
}

export interface DesignSettings {
  templateId: string;
  templateVersion?: string;
  templateApiVersion?: string;
  params?: Record<string, unknown>;
}

export interface DesignSettingsDialogProps {
  testId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Param control ────────────────────────────────────────────────────────────

interface ParamControlProps {
  param: TemplateParam;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function ParamControl({ param, value, onChange }: ParamControlProps) {
  switch (param.type) {
    case "color":
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={(value as string) || "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-10 rounded border cursor-pointer p-0.5"
            data-testid={`param-color-${param.key}`}
          />
          <Input
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#000000"
            className="font-mono w-28"
            data-testid={`param-colorhex-${param.key}`}
          />
        </div>
      );

    case "text":
      return (
        <Input
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`param-text-${param.key}`}
        />
      );

    case "number":
      return (
        <Input
          type="number"
          value={(value as number) ?? ""}
          onChange={(e) => onChange(Number(e.target.value))}
          data-testid={`param-number-${param.key}`}
        />
      );

    case "boolean":
      return (
        <Switch
          checked={!!(value)}
          onCheckedChange={(v) => onChange(v)}
          data-testid={`param-boolean-${param.key}`}
        />
      );

    case "select":
      return (
        <Select value={(value as string) || ""} onValueChange={(v) => onChange(v)}>
          <SelectTrigger data-testid={`param-select-${param.key}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(param.options || []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "image":
    case "font":
    case "asset":
      return (
        <Input
          type="file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onChange(file.name);
          }}
          data-testid={`param-file-${param.key}`}
        />
      );

    default:
      return null;
  }
}

// ─── DesignSettingsDialog ─────────────────────────────────────────────────────

export function DesignSettingsDialog({ testId, open, onOpenChange }: DesignSettingsDialogProps) {
  const { toast } = useToast();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("default");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [isDirty, setIsDirty] = useState(false);

  const { data: templates, isLoading: templatesLoading, isError: templatesError } = useQuery<Template[]>({
    queryKey: ["/api/templates"],
    enabled: open,
  });

  const { data: currentSettings } = useQuery<DesignSettings>({
    queryKey: [`/api/tests/${testId}/design`],
    enabled: open && !!testId,
  });

  useEffect(() => {
    if (currentSettings) {
      setSelectedTemplateId(currentSettings.templateId || "default");
      setParams(currentSettings.params || {});
      setIsDirty(false);
    }
  }, [currentSettings]);

  const selectedTemplate = templates?.find((tmpl) => tmpl.id === selectedTemplateId);

  const handleSelectTemplate = (templateId: string) => {
    const template = templates?.find((tmpl) => tmpl.id === templateId);
    if (template) {
      setSelectedTemplateId(templateId);
      const defaults: Record<string, unknown> = {};
      for (const param of template.manifest.params || []) {
        defaults[param.key] = param.default;
      }
      setParams(defaults);
      setIsDirty(true);
    } else {
      setSelectedTemplateId(templateId);
      setParams({});
      setIsDirty(true);
    }
  };

  const handleParamChange = (key: string, value: unknown) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (selectedTemplateId === "default") {
        return apiRequest("PUT", `/api/tests/${testId}/design`, {});
      }
      const template = templates?.find((tmpl) => tmpl.id === selectedTemplateId);
      return apiRequest(
        "PUT",
        `/api/tests/${testId}/design`,
        {
          templateId: selectedTemplateId,
          templateVersion: template?.version,
          templateApiVersion: template?.templateApiVersion,
          params,
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/design`] });
      setIsDirty(false);
      toast({ title: "Настройки оформления сохранены" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Ошибка сохранения", variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/tests/${testId}/design`, {}),
    onSuccess: () => {
      setSelectedTemplateId("default");
      setParams({});
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/design`] });
      toast({ title: "Оформление сброшено до умолчаний" });
    },
    onError: () => {
      toast({ title: "Ошибка сброса", variant: "destructive" });
    },
  });

  const groupedParams = (): Record<string, TemplateParam[]> => {
    const groups: Record<string, TemplateParam[]> = {};
    for (const param of selectedTemplate?.manifest.params || []) {
      const group = param.group || "";
      if (!groups[group]) groups[group] = [];
      groups[group].push(param);
    }
    return groups;
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen && isDirty) {
      if (!window.confirm("Есть несохранённые изменения. Закрыть без сохранения?")) return;
    }
    onOpenChange(isOpen);
  };

  const isSaving = saveMutation.isPending || resetMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="!max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Оформление теста</DialogTitle>
        </DialogHeader>

        {templatesLoading && (
          <div className="flex justify-center items-center py-12" data-testid="loading-state">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {templatesError && (
          <div className="text-destructive text-sm py-4" data-testid="error-state">
            Не удалось загрузить шаблоны. Попробуйте ещё раз.
          </div>
        )}

        {!templatesLoading && !templatesError && (
          <div className="space-y-6">
            {/* Template gallery */}
            <div>
              <h3 className="text-sm font-medium mb-3">Выберите шаблон</h3>
              <div className="grid grid-cols-3 gap-3" data-testid="template-gallery">
                {(templates || []).map((template) => (
                  <Card
                    key={template.id}
                    className={`cursor-pointer transition-all hover:border-primary ${
                      selectedTemplateId === template.id
                        ? "border-primary ring-2 ring-primary ring-offset-2"
                        : ""
                    }`}
                    onClick={() => handleSelectTemplate(template.id)}
                    data-testid={`template-card-${template.id}`}
                  >
                    <CardContent className="p-3">
                      <div className="bg-muted rounded mb-2 h-16 flex items-center justify-center">
                        <span className="text-muted-foreground text-xs">Превью</span>
                      </div>
                      <p className="font-medium text-sm">{template.name}</p>
                      {template.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{template.description}</p>
                      )}
                      <div className="flex items-center gap-1 mt-1">
                        {template.isBuiltin && (
                          <Badge variant="secondary" className="text-xs">
                            Встроенный
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">v{template.version}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Param form (only for non-default templates) */}
            {selectedTemplate && selectedTemplate.id !== "default" && (
              <div data-testid="param-form">
                <h3 className="text-sm font-medium mb-3">Параметры шаблона</h3>
                {Object.entries(groupedParams()).map(([group, groupParams]) => (
                  <div key={group} className="space-y-3 mb-4">
                    {group && (
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                        {group}
                      </p>
                    )}
                    {groupParams.map((param) => (
                      <div key={param.key} className="flex items-center gap-4">
                        <Label className="text-sm flex-1 min-w-0">{param.label}</Label>
                        <div className="flex-shrink-0 w-56">
                          <ParamControl
                            param={param}
                            value={params[param.key] ?? param.default}
                            onChange={(v) => handleParamChange(param.key, v)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 flex-row">
          <Button
            variant="ghost"
            onClick={() => resetMutation.mutate()}
            disabled={isSaving}
            data-testid="button-reset-design"
          >
            Сбросить до умолчаний
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleClose(false)} disabled={isSaving}>
              Отмена
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!isDirty || isSaving}
              data-testid="button-save-design"
            >
              {saveMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
