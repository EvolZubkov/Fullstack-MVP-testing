/**
 * @module features/tests/editor/sections/card-images-control
 * @description «Картинки карточек» — the control of the `itemImages` page property of the router
 * hub (approved wireframe `docs/wireframes/approved/editor-router-card-images.html`).
 *
 * One `FileItem` per item of the hub, in hub order: a topic or a scenario item. An empty item
 * offers «Загрузить»; a set one shows its picture as the thumbnail, the file name in the caption
 * and «Заменить» / «Удалить». Upload progress and a refused file are the stock `FileItem`
 * states — no local component CSS.
 *
 * The value is a map keyed by item key (`shared/template/router-card-images`). Every write
 * keeps only the keys of the items listed, so a picture of an item that has left the test does
 * not linger in the draft and come back with the next save.
 */
import { useId, useRef, useState } from "react";
import { Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { FileItem, Stack, type FileItemAction } from "@skillum/ui-kit";
import { canonicalItemKey } from "@shared/test-items";
import { mediaUrlOf } from "@shared/template/start-image";
import { IMAGE_UPLOAD_ACCEPT, IMAGE_UPLOAD_MAX_KB, formatUploadLimit, imageUploadHint } from "../image-upload-limit";

/** One item of the hub as the control lists it. */
export interface CardImageItem {
  /** Item key: `topic:<id>` or `scenario:<id>`. */
  key: string;
  /** Name on the card. */
  title: string;
  /** Kind and size: «Тема · 8 вопросов» / «Сценарий». */
  meta: string;
}

/** One stored picture: the address and, when known, the uploaded file's name. */
interface StoredPicture {
  url: string;
  name?: string;
}

/** Largest picture accepted — the same limit as every other image field of the editor. */
export const CARD_IMAGE_MAX_KB = IMAGE_UPLOAD_MAX_KB;

/** The stored map as `key → {url, name}`, tolerant of plain-address values. */
function readPictures(value: unknown): Record<string, StoredPicture> {
  const out: Record<string, StoredPicture> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const url = mediaUrlOf(raw);
    if (!url) continue;
    const name = raw && typeof raw === "object" ? (raw as { name?: unknown }).name : undefined;
    out[canonicalItemKey(key)] = typeof name === "string" && name ? { url, name } : { url };
  }
  return out;
}

/** Caption tail: the file name, or the last segment of the address for an old value. */
function fileNameOf(picture: StoredPicture): string {
  if (picture.name) return picture.name;
  const path = picture.url.split(/[?#]/)[0];
  return decodeURIComponent(path.substring(path.lastIndexOf("/") + 1)) || "изображение";
}

/**
 * Upload one picture through the media library, reporting progress.
 *
 * `XMLHttpRequest` rather than `fetch`: only it reports upload progress, and the approved
 * wireframe shows the bar moving.
 */
function uploadPicture(file: File, onProgress: (percent: number) => void): Promise<StoredPicture> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Не удалось загрузить изображение (HTTP ${xhr.status}).`));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { url?: string; originalName?: string };
        if (!body.url) throw new Error("no url");
        resolve({ url: body.url, name: body.originalName || file.name });
      } catch {
        reject(new Error("Не удалось загрузить изображение."));
      }
    };
    xhr.onerror = () => reject(new Error("Не удалось загрузить изображение."));
    xhr.send(form);
  });
}

export function CardImagesControl(props: {
  label: string;
  description?: string;
  value: unknown;
  onChange: (value: unknown) => void;
  /** The hub's items in hub order. */
  items: CardImageItem[];
  testId: string;
}) {
  const { items, onChange, testId } = props;
  const pictures = readPictures(props.value);
  const labelId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const targetKey = useRef<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  /** Write the map back, keeping only the listed items. */
  const write = (next: Record<string, StoredPicture>) => {
    const keep = new Set(items.map((i) => canonicalItemKey(i.key)));
    const out: Record<string, StoredPicture> = {};
    for (const [key, picture] of Object.entries(next)) {
      if (keep.has(key)) out[key] = picture;
    }
    onChange(out);
  };

  const setError = (key: string, message: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

  const pick = (key: string) => {
    targetKey.current = key;
    inputRef.current?.click();
  };

  const handleFile = async (key: string, file: File) => {
    setError(key, null);
    if (file.size > CARD_IMAGE_MAX_KB * 1024) {
      setError(key, `Файл превышает ${formatUploadLimit(CARD_IMAGE_MAX_KB)}.`);
      return;
    }
    setUploading((prev) => ({ ...prev, [key]: 0 }));
    try {
      const picture = await uploadPicture(file, (percent) => setUploading((prev) => ({ ...prev, [key]: percent })));
      // Read the map afresh from the latest value: another item may have finished meanwhile.
      write({ ...readPictures(latestValue.current), [key]: picture });
    } catch (err) {
      setError(key, (err as Error).message);
    } finally {
      setUploading((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  // The value the parent holds NOW — an upload resolves after re-renders.
  const latestValue = useRef<unknown>(props.value);
  latestValue.current = props.value;

  const remove = (key: string) => {
    setError(key, null);
    const next = { ...pictures };
    delete next[key];
    write(next);
  };

  return (
    <div className="ou-formfield" data-testid={testId}>
      <span className="ou-formfield__lbl" id={labelId}>
        {props.label}
      </span>
      <Stack gap={2} role="list" aria-labelledby={labelId}>
        {items.map((item) => {
          const key = canonicalItemKey(item.key);
          const picture = pictures[key];
          const progress = uploading[key];
          const error = errors[key];
          const isUploading = progress !== undefined;
          const actions: FileItemAction[] = isUploading
            ? []
            : picture
              ? [
                  { icon: <Upload size={16} aria-hidden="true" />, ariaLabel: `Заменить картинку карточки «${item.title}»`, onClick: () => pick(key) },
                  { icon: <Trash2 size={16} aria-hidden="true" />, ariaLabel: `Удалить картинку карточки «${item.title}»`, danger: true, onClick: () => remove(key) },
                ]
              : [{ icon: <Upload size={16} aria-hidden="true" />, ariaLabel: `Загрузить картинку карточки «${item.title}»`, onClick: () => pick(key) }];
          return (
            <FileItem
              key={key}
              role="listitem"
              name={item.title}
              kind="img"
              thumb={picture ? <img src={picture.url} alt="" /> : <ImageIcon size={18} aria-hidden="true" />}
              meta={error ?? (picture ? `${item.meta} · ${fileNameOf(picture)}` : item.meta)}
              status={isUploading ? "uploading" : error ? "error" : "idle"}
              progress={progress}
              actions={actions}
              data-testid={`${testId}-item-${key}`}
            />
          );
        })}
      </Stack>
      {/* The template says WHAT picture its layout wants; formats and size are the product's. */}
      {props.description && <div className="ou-formfield__desc">{props.description}</div>}
      <div className="ou-formfield__desc">{imageUploadHint(CARD_IMAGE_MAX_KB)}</div>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          const key = targetKey.current;
          e.target.value = "";
          if (file && key) void handleFile(key, file);
        }}
        data-testid={`${testId}-file`}
      />
    </div>
  );
}
