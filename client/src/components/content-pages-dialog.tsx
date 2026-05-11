/**
 * @module components/content-pages-dialog
 * @description Dialog for managing content pages in a test. Displays a
 * structural view of test topics with before/after content pages, supports
 * CRUD operations, drag-and-drop reordering, placeholder form, and
 * autoAdvance configuration.
 *
 * Fetches:
 * - GET /api/tests/:testId/content-pages
 * - GET /api/templates (for content template options)
 * - GET /api/tests/:testId/design (for the active template)
 * PUT /api/tests/:testId/content-pages/:id
 * POST /api/tests/:testId/content-pages
 * DELETE /api/tests/:testId/content-pages/:id
 * PUT /api/tests/:testId/content-pages/reorder
 */
import React, { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { GripVertical, Pencil, Trash2, Plus, AlertTriangle, Clock } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContentPage {
  id: string;
  testId: string;
  topicId: string;
  position: "before_topic" | "after_topic";
  mode: "template" | "standard" | "html";
  type: "intro" | "info" | "summary" | "html";
  templateKey: string | null;
  sortOrder: number;
  valuesJson: {
    values?: Record<string, unknown>;
    placeholderStyles?: Record<string, { fontSize?: number }>;
  };
  autoAdvance: boolean;
  autoAdvanceDelayMs: number | null;
  templateKeyMissing?: boolean;
}

export interface ContentTemplatePlaceholder {
  key: string;
  type: string;
  label: string;
  required?: boolean;
  maxLength?: number;
  options?: string[];
  allowedRenderers?: string[];
  allowedPaths?: string[];
  defaultRenderer?: string;
  defaultPath?: string;
  optionsSchema?: Record<string, unknown>;
  textFit?: {
    mode: string;
    defaultFontSize: number;
    minFontSize?: number;
    maxFontSize?: number;
    allowAuthorFontSize?: boolean;
    allowedFontSizes?: number[];
    overflow?: string;
  };
}

export interface ContentTemplate {
  key: string;
  label: string;
  pageKind?: string;
  placeholders: ContentTemplatePlaceholder[];
}

interface TemplateManifest {
  contentTemplates?: ContentTemplate[];
}

interface Template {
  id: string;
  name: string;
  manifest: TemplateManifest;
}

interface DesignSettings {
  templateId: string;
}

interface TestSection {
  topicId: string;
  topicName: string;
  drawCount: number;
}

export interface ContentPagesDialogProps {
  testId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sections enriched with topicName (from GET /api/tests list response). */
  sections: TestSection[];
}

// ─── Page type labels ─────────────────────────────────────────────────────────

const PAGE_TYPE_LABELS: Record<string, string> = {
  intro: "Введение",
  info: "Информация",
  summary: "Итог",
  html: "HTML",
};

const PAGE_TYPE_OPTIONS = [
  { value: "intro", label: "Введение (intro)" },
  { value: "info", label: "Информация (info)" },
  { value: "summary", label: "Итог (summary)" },
  { value: "html", label: "HTML" },
];

const PAGE_MODE_OPTIONS = [
  { value: "template", label: "По шаблону" },
  { value: "standard", label: "Стандартная" },
  { value: "html", label: "HTML" },
];

const AUTO_ADVANCE_MIN_S = 3;
const AUTO_ADVANCE_MAX_S = 120;

// ─── PlaceholderControl ───────────────────────────────────────────────────────

interface PlaceholderControlProps {
  placeholder: ContentTemplatePlaceholder;
  value: unknown;
  style?: { fontSize?: number };
  onChange: (value: unknown) => void;
  onStyleChange?: (style: { fontSize?: number }) => void;
}

export function PlaceholderControl({
  placeholder,
  value,
  style,
  onChange,
  onStyleChange,
}: PlaceholderControlProps) {
  const tf = placeholder.textFit;
  const hasAuthorFontSize = tf?.allowAuthorFontSize;
  const fontSizeOptions = tf?.allowedFontSizes;

  const fontSizeControl = hasAuthorFontSize && onStyleChange && (
    <div className="mt-1 flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Размер шрифта:</span>
      {fontSizeOptions ? (
        <Select
          value={String(style?.fontSize ?? tf?.defaultFontSize ?? "")}
          onValueChange={(v) => onStyleChange({ ...style, fontSize: Number(v) })}
        >
          <SelectTrigger className="h-7 w-24 text-xs" data-testid={`placeholder-fontsize-${placeholder.key}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fontSizeOptions.map((s) => (
              <SelectItem key={s} value={String(s)}>{s}px</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          type="number"
          value={style?.fontSize ?? tf?.defaultFontSize ?? ""}
          onChange={(e) => onStyleChange({ ...style, fontSize: Number(e.target.value) })}
          min={tf?.minFontSize}
          max={tf?.maxFontSize}
          className="h-7 w-24 text-xs"
          data-testid={`placeholder-fontsize-${placeholder.key}`}
        />
      )}
    </div>
  );

  switch (placeholder.type) {
    case "text":
      return (
        <div>
          <Input
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            maxLength={placeholder.maxLength}
            data-testid={`placeholder-text-${placeholder.key}`}
          />
          {fontSizeControl}
        </div>
      );

    case "textarea":
      return (
        <div>
          <Textarea
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            maxLength={placeholder.maxLength}
            rows={3}
            data-testid={`placeholder-textarea-${placeholder.key}`}
          />
          {fontSizeControl}
        </div>
      );

    case "richText":
      return (
        <div>
          <Textarea
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            placeholder="Поддерживается базовый HTML"
            data-testid={`placeholder-richtext-${placeholder.key}`}
          />
          {fontSizeControl}
        </div>
      );

    case "html":
      return (
        <Textarea
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          className="font-mono text-xs"
          placeholder="<p>Введите HTML</p>"
          data-testid={`placeholder-html-${placeholder.key}`}
        />
      );

    case "number":
      return (
        <Input
          type="number"
          value={(value as number) ?? ""}
          onChange={(e) => onChange(Number(e.target.value))}
          data-testid={`placeholder-number-${placeholder.key}`}
        />
      );

    case "boolean":
      return (
        <Switch
          checked={!!(value)}
          onCheckedChange={(v) => onChange(v)}
          data-testid={`placeholder-boolean-${placeholder.key}`}
        />
      );

    case "select":
      return (
        <Select value={(value as string) || ""} onValueChange={(v) => onChange(v)}>
          <SelectTrigger data-testid={`placeholder-select-${placeholder.key}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(placeholder.options || []).map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "image":
    case "asset":
    case "font":
      return (
        <Input
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="URL или путь к файлу"
          data-testid={`placeholder-asset-${placeholder.key}`}
        />
      );

    case "resultField": {
      const rfValue = (value as Record<string, unknown>) || {};
      const renderer = (rfValue.renderer as string) || placeholder.defaultRenderer || "core.textMetric";
      const allowed = placeholder.allowedRenderers || ["core.textMetric"];
      const allowedPaths = placeholder.allowedPaths || [];
      return (
        <div className="space-y-2" data-testid={`placeholder-resultfield-${placeholder.key}`}>
          {allowedPaths.length > 0 ? (
            <Select
              value={(rfValue.path as string) || placeholder.defaultPath || allowedPaths[0]}
              onValueChange={(v) => onChange({ ...rfValue, path: v })}
            >
              <SelectTrigger data-testid={`placeholder-resultfield-path-${placeholder.key}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedPaths.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={(rfValue.path as string) || ""}
              onChange={(e) => onChange({ ...rfValue, path: e.target.value })}
              placeholder="Путь к данным (например: result.scorePercent)"
              data-testid={`placeholder-resultfield-path-${placeholder.key}`}
            />
          )}
          <Select
            value={renderer}
            onValueChange={(v) => onChange({ ...rfValue, renderer: v })}
          >
            <SelectTrigger data-testid={`placeholder-renderer-${placeholder.key}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowed.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={(rfValue.label as string) || ""}
            onChange={(e) => onChange({ ...rfValue, label: e.target.value })}
            placeholder="Подпись (необязательно)"
          />
          {placeholder.optionsSchema && (
            <Textarea
              value={JSON.stringify(rfValue.rendererOptions || {}, null, 2)}
              onChange={(e) => {
                try {
                  onChange({ ...rfValue, rendererOptions: JSON.parse(e.target.value || "{}") });
                } catch {
                  onChange({ ...rfValue, rendererOptionsText: e.target.value });
                }
              }}
              rows={3}
              className="font-mono text-xs"
              data-testid={`placeholder-renderer-options-${placeholder.key}`}
            />
          )}
        </div>
      );
    }

    default:
      return (
        <Input
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`placeholder-default-${placeholder.key}`}
        />
      );
  }
}

// ─── ContentPageForm ──────────────────────────────────────────────────────────

interface PageFormState {
  position: "before_topic" | "after_topic";
  mode: "template" | "standard" | "html";
  type: "intro" | "info" | "summary" | "html";
  templateKey: string;
  values: Record<string, unknown>;
  placeholderStyles: Record<string, { fontSize?: number }>;
  autoAdvance: boolean;
  autoAdvanceDelayS: number;
}

interface ContentPageFormProps {
  initial?: Partial<PageFormState>;
  topicId: string;
  contentTemplates: ContentTemplate[];
  onSave: (data: PageFormState) => void;
  onCancel: () => void;
  isSaving: boolean;
}

export function ContentPageForm({
  initial,
  contentTemplates,
  onSave,
  onCancel,
  isSaving,
}: ContentPageFormProps) {
  const [position, setPosition] = useState<"before_topic" | "after_topic">(
    initial?.position ?? "before_topic"
  );
  const [mode, setMode] = useState<"template" | "standard" | "html">(
    initial?.mode ?? "template"
  );
  const [type, setType] = useState<"intro" | "info" | "summary" | "html">(
    initial?.type ?? "intro"
  );
  const [templateKey, setTemplateKey] = useState<string>(
    initial?.templateKey ?? (contentTemplates[0]?.key ?? "")
  );
  const [values, setValues] = useState<Record<string, unknown>>(
    initial?.values ?? {}
  );
  const [placeholderStyles, setPlaceholderStyles] = useState<
    Record<string, { fontSize?: number }>
  >(initial?.placeholderStyles ?? {});
  const [autoAdvance, setAutoAdvance] = useState(initial?.autoAdvance ?? false);
  const [autoAdvanceDelayS, setAutoAdvanceDelayS] = useState(
    initial?.autoAdvanceDelayS ?? 10
  );

  const selectedCt = contentTemplates.find((ct) => ct.key === templateKey);

  const handleTemplateKeyChange = (key: string) => {
    setTemplateKey(key);
    // Reset values when template changes
    setValues({});
    setPlaceholderStyles({});
  };

  const handleValueChange = (key: string, val: unknown) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const handleStyleChange = (key: string, style: { fontSize?: number }) => {
    setPlaceholderStyles((prev) => ({ ...prev, [key]: style }));
  };

  const handleSubmit = () => {
    onSave({
      position,
      mode,
      type,
      templateKey,
      values,
      placeholderStyles,
      autoAdvance,
      autoAdvanceDelayS,
    });
  };

  return (
    <div className="space-y-4" data-testid="content-page-form">
      {/* Position + Type row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Позиция</Label>
          <Select value={position} onValueChange={(v) => setPosition(v as typeof position)}>
            <SelectTrigger data-testid="form-position">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="before_topic">До темы</SelectItem>
              <SelectItem value="after_topic">После темы</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Тип страницы</Label>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger data-testid="form-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Mode */}
      <div className="space-y-1">
        <Label className="text-xs">Режим</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <SelectTrigger data-testid="form-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_MODE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Template key — only for template mode */}
      {mode === "template" && contentTemplates.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs">Шаблон страницы</Label>
          <Select value={templateKey} onValueChange={handleTemplateKeyChange}>
            <SelectTrigger data-testid="form-template-key">
              <SelectValue placeholder="Выберите шаблон страницы" />
            </SelectTrigger>
            <SelectContent>
              {contentTemplates.map((ct) => (
                <SelectItem key={ct.key} value={ct.key}>{ct.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Placeholder form */}
      {mode === "template" && selectedCt && selectedCt.placeholders.length > 0 && (
        <div className="space-y-3 rounded-md border p-3" data-testid="placeholder-form">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Содержимое
          </p>
          {selectedCt.placeholders.map((ph) => (
            <div key={ph.key} className="space-y-1">
              <Label className="text-sm">
                {ph.label}
                {ph.required && <span className="text-destructive ml-1">*</span>}
              </Label>
              <PlaceholderControl
                placeholder={ph}
                value={values[ph.key]}
                style={placeholderStyles[ph.key]}
                onChange={(v) => handleValueChange(ph.key, v)}
                onStyleChange={(s) => handleStyleChange(ph.key, s)}
              />
            </div>
          ))}
        </div>
      )}

      {/* HTML mode */}
      {mode === "html" && (
        <div className="space-y-1">
          <Label className="text-xs">HTML-содержимое</Label>
          <Textarea
            value={(values["__html"] as string) || ""}
            onChange={(e) => handleValueChange("__html", e.target.value)}
            rows={8}
            className="font-mono text-xs"
            placeholder="<p>Введите HTML</p>"
            data-testid="form-html-content"
          />
        </div>
      )}

      {/* AutoAdvance */}
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <p className="text-sm font-medium">Автопереход</p>
          <p className="text-xs text-muted-foreground">
            Переходить к следующей странице автоматически
          </p>
        </div>
        <Switch
          checked={autoAdvance}
          onCheckedChange={setAutoAdvance}
          data-testid="form-auto-advance"
        />
      </div>

      {autoAdvance && (
        <div className="flex items-center gap-3">
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <Label className="text-sm shrink-0">Задержка (сек):</Label>
          <Input
            type="number"
            value={autoAdvanceDelayS}
            onChange={(e) => {
              const v = Math.max(
                AUTO_ADVANCE_MIN_S,
                Math.min(AUTO_ADVANCE_MAX_S, Number(e.target.value))
              );
              setAutoAdvanceDelayS(v);
            }}
            min={AUTO_ADVANCE_MIN_S}
            max={AUTO_ADVANCE_MAX_S}
            className="w-24"
            data-testid="form-auto-advance-delay"
          />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Отмена
        </Button>
        <Button onClick={handleSubmit} disabled={isSaving} data-testid="form-save-btn">
          {isSaving ? "Сохранение..." : "Сохранить"}
        </Button>
      </div>
    </div>
  );
}

// ─── ContentPageCard ──────────────────────────────────────────────────────────

interface ContentPageCardProps {
  page: ContentPage;
  contentTemplates: ContentTemplate[];
  onEdit: () => void;
  onDelete: () => void;
  isDragging?: boolean;
}

export function ContentPageCard({
  page,
  contentTemplates,
  onEdit,
  onDelete,
  isDragging,
}: ContentPageCardProps) {
  const ct = contentTemplates.find((c) => c.key === page.templateKey);
  const typeLabel = PAGE_TYPE_LABELS[page.type] ?? page.type;

  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-2 bg-card transition-shadow ${
        isDragging ? "shadow-lg opacity-70" : ""
      }`}
      data-testid={`content-page-card-${page.id}`}
    >
      <GripVertical
        className="h-4 w-4 text-muted-foreground cursor-grab shrink-0"
        data-testid="drag-handle"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs shrink-0">
            {typeLabel}
          </Badge>
          {ct && (
            <span className="text-sm font-medium truncate">{ct.label}</span>
          )}
          {page.templateKeyMissing && (
            <Badge variant="destructive" className="text-xs shrink-0 gap-1">
              <AlertTriangle className="h-3 w-3" />
              Шаблон не найден
            </Badge>
          )}
          {page.autoAdvance && (
            <Badge variant="secondary" className="text-xs shrink-0 gap-1">
              <Clock className="h-3 w-3" />
              {page.autoAdvanceDelayMs
                ? `${page.autoAdvanceDelayMs / 1000}с`
                : "Авто"}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {page.position === "before_topic" ? "До темы" : "После темы"}
          {" · "}
          {page.mode === "template" ? "По шаблону" : page.mode}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onEdit}
          data-testid={`edit-page-${page.id}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={onDelete}
          data-testid={`delete-page-${page.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── ContentPagesDialog ───────────────────────────────────────────────────────

export function ContentPagesDialog({
  testId,
  open,
  onOpenChange,
  sections,
}: ContentPagesDialogProps) {
  const { toast } = useToast();

  const [editingPage, setEditingPage] = useState<ContentPage | null>(null);
  const [addingForTopicId, setAddingForTopicId] = useState<string | null>(null);
  const [addingPosition, setAddingPosition] = useState<
    "before_topic" | "after_topic"
  >("before_topic");
  const [formOpen, setFormOpen] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const { data: contentPages = [], isLoading: pagesLoading } = useQuery<
    ContentPage[]
  >({
    queryKey: [`/api/tests/${testId}/content-pages`],
    enabled: open && !!testId,
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["/api/templates"],
    enabled: open,
  });

  const { data: designSettings } = useQuery<DesignSettings>({
    queryKey: [`/api/tests/${testId}/design`],
    enabled: open && !!testId,
  });

  // Active template manifest (content templates list)
  const activeTemplateId = designSettings?.templateId ?? "default";
  const activeTemplate = templates.find((t) => t.id === activeTemplateId);
  const contentTemplates: ContentTemplate[] =
    activeTemplate?.manifest?.contentTemplates ?? [];

  // Pages grouped by topicId + position
  const pagesByTopicBefore = useCallback(
    (topicId: string) =>
      contentPages
        .filter((p) => p.topicId === topicId && p.position === "before_topic")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [contentPages]
  );

  const pagesByTopicAfter = useCallback(
    (topicId: string) =>
      contentPages
        .filter((p) => p.topicId === topicId && p.position === "after_topic")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [contentPages]
  );

  // ─── Mutations ───────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("POST", `/api/tests/${testId}/content-pages`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/tests/${testId}/content-pages`],
      });
      toast({ title: "Страница добавлена" });
      setFormOpen(false);
      setAddingForTopicId(null);
    },
    onError: () => {
      toast({ title: "Ошибка при создании страницы", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiRequest("PUT", `/api/tests/${testId}/content-pages/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/tests/${testId}/content-pages`],
      });
      toast({ title: "Страница обновлена" });
      setFormOpen(false);
      setEditingPage(null);
    },
    onError: () => {
      toast({
        title: "Ошибка при обновлении страницы",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/tests/${testId}/content-pages/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/tests/${testId}/content-pages`],
      });
      toast({ title: "Страница удалена" });
    },
    onError: () => {
      toast({ title: "Ошибка при удалении страницы", variant: "destructive" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (updates: { id: string; sortOrder: number }[]) =>
      apiRequest("PUT", `/api/tests/${testId}/content-pages/reorder`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/tests/${testId}/content-pages`],
      });
    },
  });

  // ─── Form handlers ────────────────────────────────────────────────────────

  const handleOpenAdd = (
    topicId: string,
    position: "before_topic" | "after_topic"
  ) => {
    setEditingPage(null);
    setAddingForTopicId(topicId);
    setAddingPosition(position);
    setFormOpen(true);
  };

  const handleOpenEdit = (page: ContentPage) => {
    setEditingPage(page);
    setAddingForTopicId(null);
    setFormOpen(true);
  };

  const handleFormSave = (data: PageFormState) => {
    const body: Record<string, unknown> = {
      position: data.position,
      mode: data.mode,
      type: data.type,
      templateKey: data.mode === "template" ? data.templateKey || null : null,
      valuesJson: {
        values: data.values,
        placeholderStyles: data.placeholderStyles,
      },
      autoAdvance: data.autoAdvance,
      autoAdvanceDelayMs: data.autoAdvance
        ? data.autoAdvanceDelayS * 1000
        : null,
    };

    if (editingPage) {
      updateMutation.mutate({ id: editingPage.id, data: body });
    } else {
      createMutation.mutate({
        ...body,
        topicId: addingForTopicId!,
        sortOrder: 0,
      });
    }
  };

  const handleDelete = (page: ContentPage) => {
    if (!window.confirm("Удалить эту страницу?")) return;
    deleteMutation.mutate(page.id);
  };

  // ─── Drag-and-drop (HTML5) ────────────────────────────────────────────────

  const handleDragStart = (id: string) => setDraggingId(id);
  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleDrop = (targetId: string, targetTopicId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const dragged = contentPages.find((p) => p.id === draggingId);
    const target = contentPages.find((p) => p.id === targetId);
    if (!dragged || !target || dragged.topicId !== target.topicId || dragged.position !== target.position) return;

    // Build new order by swapping
    const group = contentPages
      .filter(
        (p) => p.topicId === target.topicId && p.position === target.position
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const fromIdx = group.findIndex((p) => p.id === draggingId);
    const toIdx = group.findIndex((p) => p.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...group];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    reorderMutation.mutate(
      reordered.map((p, i) => ({ id: p.id, sortOrder: i }))
    );
    setDraggingId(null);
    setDragOverId(null);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const isMutating =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  // Template key missing state - collect pages needing remapping
  const missingKeyPages = contentPages.filter((p) => p.templateKeyMissing);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Страницы теста</DialogTitle>
        </DialogHeader>

        {/* Template key missing warning */}
        {missingKeyPages.length > 0 && (
          <div
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="missing-keys-warning"
          >
            <p className="font-medium mb-1">
              {missingKeyPages.length}{" "}
              {missingKeyPages.length === 1 ? "страница использует" : "страниц используют"}{" "}
              шаблон страницы, которого нет в активном дизайн-шаблоне.
            </p>
            <p className="text-xs">
              Отредактируйте эти страницы, чтобы выбрать актуальный шаблон.
            </p>
          </div>
        )}

        {pagesLoading ? (
          <div
            className="flex justify-center items-center py-12"
            data-testid="pages-loading"
          >
            <div className="h-6 w-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-4" data-testid="structural-view">
            {sections.map((section) => {
              const beforePages = pagesByTopicBefore(section.topicId);
              const afterPages = pagesByTopicAfter(section.topicId);
              return (
                <div
                  key={section.topicId}
                  className="rounded-lg border bg-muted/30 p-3 space-y-2"
                  data-testid={`topic-block-${section.topicId}`}
                >
                  {/* Before pages */}
                  {beforePages.map((page) => (
                    <ContentPageCard
                      key={page.id}
                      page={page}
                      contentTemplates={contentTemplates}
                      onEdit={() => handleOpenEdit(page)}
                      onDelete={() => handleDelete(page)}
                      isDragging={draggingId === page.id}
                    />
                  ))}

                  {/* Topic header */}
                  <div className="flex items-center gap-2 px-1 py-1.5">
                    <div
                      className="flex-1 h-px bg-border"
                      aria-hidden="true"
                    />
                    <span
                      className="text-sm font-semibold text-foreground shrink-0"
                      data-testid={`topic-name-${section.topicId}`}
                    >
                      {section.topicName}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {section.drawCount} вопр.
                    </Badge>
                    <div
                      className="flex-1 h-px bg-border"
                      aria-hidden="true"
                    />
                  </div>

                  {/* After pages */}
                  {afterPages.map((page) => (
                    <ContentPageCard
                      key={page.id}
                      page={page}
                      contentTemplates={contentTemplates}
                      onEdit={() => handleOpenEdit(page)}
                      onDelete={() => handleDelete(page)}
                      isDragging={draggingId === page.id}
                    />
                  ))}

                  {/* Add buttons */}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 flex-1"
                      onClick={() =>
                        handleOpenAdd(section.topicId, "before_topic")
                      }
                      data-testid={`add-before-${section.topicId}`}
                    >
                      <Plus className="h-3 w-3" />
                      До темы
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 flex-1"
                      onClick={() =>
                        handleOpenAdd(section.topicId, "after_topic")
                      }
                      data-testid={`add-after-${section.topicId}`}
                    >
                      <Plus className="h-3 w-3" />
                      После темы
                    </Button>
                  </div>
                </div>
              );
            })}

            {sections.length === 0 && (
              <div
                className="text-center py-8 text-muted-foreground text-sm"
                data-testid="no-sections-empty"
              >
                В тесте нет тем. Добавьте темы в настройках теста.
              </div>
            )}
          </div>
        )}

        {/* Inline page form */}
        {formOpen && (
          <div
            className="rounded-lg border bg-card p-4 space-y-3"
            data-testid="inline-page-form"
          >
            <h3 className="text-sm font-semibold">
              {editingPage ? "Редактировать страницу" : "Новая страница"}
            </h3>
            <ContentPageForm
              initial={
                editingPage
                  ? {
                      position: editingPage.position,
                      mode: editingPage.mode,
                      type: editingPage.type,
                      templateKey: editingPage.templateKey ?? "",
                      values: editingPage.valuesJson?.values ?? {},
                      placeholderStyles:
                        editingPage.valuesJson?.placeholderStyles ?? {},
                      autoAdvance: editingPage.autoAdvance,
                      autoAdvanceDelayS: editingPage.autoAdvanceDelayMs
                        ? editingPage.autoAdvanceDelayMs / 1000
                        : 10,
                    }
                  : {
                      position: addingPosition,
                    }
              }
              topicId={editingPage?.topicId ?? addingForTopicId ?? ""}
              contentTemplates={contentTemplates}
              onSave={handleFormSave}
              onCancel={() => {
                setFormOpen(false);
                setEditingPage(null);
                setAddingForTopicId(null);
              }}
              isSaving={isMutating}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
