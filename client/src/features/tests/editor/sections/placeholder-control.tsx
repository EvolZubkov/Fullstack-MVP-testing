/**
 * @module features/tests/editor/sections/placeholder-control
 * @description Контролы полей PRD-22 — ОДИН на весь продукт.
 *
 * Вынесены из `start-pages-section.tsx` без единой правки поведения: те же типы, те же
 * режимы ввода, та же нормализация вставки. Раньше они жили внутри вкладки «Структура»,
 * и до PRD-51 этого хватало — поля были только у контентных страниц. Теперь их правит и
 * документ отчёта, а вторая копия контрола означала бы, что режимы ввода и очистка
 * разметки разойдутся на первой же правке: автор увидел бы на одном экране «HTML», а на
 * другом — нет, и узнал бы об этом от сохранения.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Image as ImageIcon, Upload, X } from "lucide-react";
import {
  Banner,
  Button,
  IconButton,
  Input,
  RichTextEditor,
  type RichTextMode,
} from "@skillum/ui-kit";
import { isPlaceholderType, inputModesFor } from "@shared/template/field-types";
import { sanitizeHtml as sanitizeContentHtml, placeholderScope } from "@shared/security/html-sanitize";
import type { ContentTemplatePlaceholder } from "../use-content-pages";

export function PlaceholderControl(props: {
  placeholder: ContentTemplatePlaceholder;
  value: unknown;
  style?: { fontSize?: number };
  onChange: (value: unknown) => void;
  onStyleChange: (style: { fontSize?: number }) => void;
  testId: string;
}) {
  const { placeholder: ph, value, onChange, testId } = props;
  const label = ph.label + (ph.required ? " *" : "");

  // PRD-22 FR-10: content types come from the closed registry and every one of
  // them is handled here. The former `default` branch silently turned an unknown
  // type into a single-line input; now an unknown type is a template error caught
  // at upload, and a page that still carries one shows a diagnostic instead.
  if (!isPlaceholderType(ph.type)) {
    return (
      <div className="ou-formfield" data-testid={testId}>
        <span className="ou-formfield__lbl">{ph.label}</span>
        <Banner
          tone="warning"
          size="sm"
          description={`Тип поля «${ph.type}» не поддерживается. Сохранённое значение не изменяется и остаётся в тесте.`}
          data-testid={`${testId}-unknown-type`}
        />
      </div>
    );
  }

  switch (ph.type) {
    case "textarea":
    case "richText":
    case "html":
      // PRD-22 FR-32/33: the declared type is the CEILING of what the author may
      // enter; within it they pick the mode. Formatted mode shows the result, not
      // the markup, and pasted fragments are normalised on arrival (FR-34), so a
      // save error can only come from HTML the author typed themselves.
      //
      // Normalisation includes confining a pasted `<style>` to this field's own
      // region — the SAME scope the server applies on save and on package build,
      // so the author sees the final CSS immediately instead of discovering in the
      // package that their `body { … }` rule restyled the player.
      return (
        <RichTextEditor
          label={label}
          value={(value as string) || ""}
          onChange={(next) => onChange(next)}
          modes={inputModesFor(ph.type) as RichTextMode[]}
          sanitize={(html) => sanitizeContentHtml(html, { scope: placeholderScope(ph.key) })}
          rows={ph.type === "html" ? 6 : 5}
          fullWidth
          data-testid={testId}
        />
      );
    case "image":
      return <ImagePlaceholderControl label={label} value={value} onChange={onChange} testId={testId} />;
    case "resultField":
    case "text":
      return (
        <Input
          label={label}
          size="m"
          fullWidth
          value={typeof value === "string" ? value : value == null ? "" : String(value)}
          maxLength={ph.maxLength}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
        />
      );
  }
}

/** Best-effort human file name from an uploaded media URL (`/uploads/media/...`). */
function imageNameFromUrl(url: string): string {
  try {
    const clean = url.split("?")[0].split("#")[0];
    const seg = clean.substring(clean.lastIndexOf("/") + 1);
    return decodeURIComponent(seg) || "изображение";
  } catch {
    return "изображение";
  }
}

/**
 * Upload control for `image`-typed page placeholders (PRD-1 content pages). Mirrors
 * the «Оформление» {@link MediaParamRow} (hidden file input behind a DS Button +
 * a filename chip with remove), but stores a PLAIN URL string — the unified
 * renderer emits `String(value)` for image placeholders
 * ({@link module:shared/template/render-screen}), so the design-section media
 * ENVELOPE (`{ url, name, ... }`) would render as `[object Object]`. Upload goes
 * through `POST /api/media/upload` (multer disk storage), the same endpoint the
 * design tab uses.
 */
export function ImagePlaceholderControl(props: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  testId: string;
}) {
  const { value, onChange, testId } = props;
  const fieldId = useId();
  // Image placeholders store a PLAIN URL string. Be tolerant of a legacy media
  // envelope `{ url, name }` (e.g. copied from «Оформление» params, imported, or
  // hand-edited): surface its `.url` so the field isn't shown as empty, and heal
  // it on mount so the stray object never survives to render as `[object Object]`.
  const url =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string"
        ? (value as { url: string }).url
        : "";
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxSizeKb = 512;

  useEffect(() => {
    // Normalise a non-string value once, on mount (no-op for the common string case).
    if (typeof value !== "string") onChange(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > maxSizeKb * 1024) {
      setError(`Файл превышает ${maxSizeKb} КБ.`);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      const res = await fetch("/api/media/upload", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { url: string; originalName?: string };
      setUploadedName(body.originalName ?? null);
      onChange(body.url);
    } catch (err) {
      setError((err as Error)?.message ?? "Не удалось загрузить изображение");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="ou-formfield" data-testid={testId}>
      <label className="ou-formfield__lbl" htmlFor={fieldId}>
        {props.label}
      </label>
      <div className="design-media-row">
        {/* PRD-22: a thumbnail of what is actually loaded. The file name alone
            told the author nothing — least of all for a background image. */}
        <span
          className="image-field__preview"
          style={url ? { backgroundImage: `url("${url.replace(/"/g, "%22")}")` } : undefined}
          role={url ? "img" : undefined}
          aria-label={url ? "Предпросмотр изображения" : undefined}
          aria-hidden={url ? undefined : true}
          data-testid={`${testId}-preview`}
        />
        <Button
          id={fieldId}
          variant="secondary"
          size="s"
          leadingIcon={<Upload width={12} height={12} aria-hidden="true" />}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          loading={uploading}
          data-testid={`${testId}-upload`}
        >
          {uploading ? "Загрузка…" : url ? "Заменить изображение" : "Загрузить изображение"}
        </Button>
        {url && (
          <span className="design-media-chip" data-testid={`${testId}-chip`}>
            <ImageIcon className="design-media-chip__ico" width={14} height={14} aria-hidden="true" />
            <span className="design-media-chip__name">{uploadedName || imageNameFromUrl(url)}</span>
            <IconButton
              icon={<X width={12} height={12} aria-hidden="true" />}
              aria-label="Удалить изображение"
              variant="ghost"
              size="s"
              onClick={() => onChange("")}
              data-testid={`${testId}-remove`}
            />
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          style={{ display: "none" }}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
          data-testid={`${testId}-file`}
        />
      </div>
      <div className="ou-formfield__desc">PNG, JPEG, SVG или WebP; до {maxSizeKb} КБ.</div>
      {error && <Banner tone="error" size="sm" description={error} data-testid={`${testId}-error`} />}
    </div>
  );
}
