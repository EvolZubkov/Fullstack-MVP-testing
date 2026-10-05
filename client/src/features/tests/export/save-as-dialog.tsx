/**
 * @module features/tests/export/save-as-dialog
 * @description Этап Э5: окно «Сохранить как…» — выгрузка теста по задаче (эскиз
 * docs/wireframes/approved/e5-export.html; решения владельца Р6-Р8 2026-10-05).
 *
 * Три пункта меню («Экспорт SCORM», «Экспорт в Excel», «Экспорт пакета») не говорили, чем
 * выгрузки отличаются и чего не переносят. Окно называет задачу каждого формата и путь обратно:
 * курс для LMS не загружается в Skill'Ум вовсе, книга — через «Импорт», пакет — тоже через
 * «Импорт», но на другой инсталляции.
 *
 * Версия выбирается у SCORM и пакета (Р7): опубликованная — тот снимок, который выдаёт веб, или
 * текущий черновик. Книга собирается только из черновика, и окно говорит это прямо. Телеметрия
 * пакета — настройка теста; окно её показывает и ведёт к ней, но не переопределяет (Р8).
 * Формат без права (SCORM у автора) не показывается вовсе. Последний выбранный формат
 * запоминается в браузере.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download } from "lucide-react";

import { Banner, Button, ChoiceCard, ChoiceCardGroup, ModalDialog, Select, Stack, Text } from "@skillum/ui-kit";

/** Формат выгрузки. */
export type SaveAsFormat = "scorm" | "xlsx" | "tbtest";
/** Версия теста, из которой собирается выгрузка. */
export type SaveAsVersion = "published" | "draft";

/** Что окно спрашивает у сервера: `GET /api/tests/:id/export/options`. */
export interface ExportOptions {
  published: { version: number; publishedAt: string } | null;
  telemetry: { draft: boolean; published: boolean | null };
}

/** Ключ запомненного формата. */
const LAST_FORMAT_KEY = "tb.saveAs.format";

/** Что книга Excel не переносит — сверено с кодом сборки книги (план Э5, К3). */
const XLSX_NOT_CARRIED =
  "вложения, ссылки и мероприятия исходов; логотип и подложку шаблона; ссылки и вложения рекомендаций";
/** Что переносит пакет. */
const TBTEST_CARRIES = "содержание, оформление, тексты итогов и рекомендаций — всё, что видит участник";

const FORMAT_OPTIONS: Array<{ value: SaveAsFormat; label: string; description: string }> = [
  { value: "scorm", label: "Курс для LMS — SCORM 2004 (.zip)", description: "Загружается в LMS. Обратно в Skill'Ум не загружается" },
  { value: "xlsx", label: "Книга для правки в Excel (.xlsx)", description: "Правка вопросов и настроек в таблице, загрузка обратно через «Импорт»" },
  { value: "tbtest", label: "Пакет теста (.tbtest)", description: "Тест целиком — для переноса на другую инсталляцию через «Импорт»" },
];

/** Прочитать запомненный формат; хранилище может быть недоступно. */
function readLastFormat(): SaveAsFormat | null {
  try {
    const value = window.localStorage.getItem(LAST_FORMAT_KEY);
    return value === "scorm" || value === "xlsx" || value === "tbtest" ? value : null;
  } catch {
    return null;
  }
}

/** Запомнить формат; недоступное хранилище — не повод мешать выгрузке. */
function rememberFormat(format: SaveAsFormat): void {
  try {
    window.localStorage.setItem(LAST_FORMAT_KEY, format);
  } catch {
    // приватный режим или запрет хранилища — окно просто не запомнит выбор
  }
}

/**
 * Адрес выгрузки.
 *
 * @param testId тест
 * @param format формат
 * @param version версия (у книги не передаётся: она всегда из черновика)
 */
export function saveAsUrl(testId: string, format: SaveAsFormat, version: SaveAsVersion): string {
  const id = encodeURIComponent(testId);
  if (format === "xlsx") return `/api/tests/${id}/workbook/export`;
  const path = format === "scorm" ? `/api/tests/${id}/export/scorm` : `/api/tests/${id}/transfer`;
  return `${path}?source=${version}`;
}

/** Имя файла из `Content-Disposition`: сначала `filename*` (UTF-8), потом `filename`. */
export function fileNameOf(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // битая кодировка — берём простое имя
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  if (!plain) return fallback;
  try {
    return decodeURIComponent(plain[1]);
  } catch {
    return plain[1];
  }
}

/** «версия 4 от 28.09.2026». */
function versionLabel(published: NonNullable<ExportOptions["published"]>): string {
  const date = new Date(published.publishedAt).toLocaleDateString("ru-RU");
  return `Опубликованная — версия ${published.version} от ${date}`;
}

/** Свойства окна. */
export interface SaveAsDialogProps {
  open: boolean;
  onClose: () => void;
  test: { id: string; title: string };
  /** Право собирать SCORM (`tests.export.scorm`): без него формата в окне нет. */
  canExportScorm: boolean;
  /** Открыть настройки теста там, где включается телеметрия; без него — только подпись. */
  onOpenSettings?: () => void;
}

/**
 * Окно «Сохранить как…».
 *
 * @param props тест, права и переход к настройкам
 */
export function SaveAsDialog({ open, onClose, test, canExportScorm, onOpenSettings }: SaveAsDialogProps) {
  const formats = useMemo(
    () => FORMAT_OPTIONS.filter((option) => option.value !== "scorm" || canExportScorm),
    [canExportScorm],
  );
  const [format, setFormat] = useState<SaveAsFormat>("xlsx");
  const [version, setVersion] = useState<SaveAsVersion>("draft");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const { data: options } = useQuery<ExportOptions>({
    queryKey: [`/api/tests/${encodeURIComponent(test.id)}/export/options`],
    enabled: open,
  });
  const published = options?.published ?? null;

  // Каждое открытие начинается с запомненного формата (если он доступен) и с опубликованной
  // версии, когда она есть: выгружать обычно нужно то, что получают участники.
  useEffect(() => {
    if (!open) return;
    const last = readLastFormat();
    const allowed = formats.map((option) => option.value);
    setFormat(last && allowed.includes(last) ? last : allowed[0]);
    setFailed(null);
  }, [open, formats]);
  useEffect(() => {
    if (open) setVersion(published ? "published" : "draft");
  }, [open, published]);

  const telemetryOn = version === "published" ? options?.telemetry.published : options?.telemetry.draft;

  const save = async () => {
    setBusy(true);
    setFailed(null);
    rememberFormat(format);
    try {
      const response = await fetch(saveAsUrl(test.id, format, version), { credentials: "include" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Не удалось собрать файл");
      }
      const blob = await response.blob();
      const extension = format === "scorm" ? "zip" : format;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameOf(response.headers.get("Content-Disposition"), `${test.title}.${extension}`);
      link.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (error) {
      setFailed((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const versionSelect = (
    <Select<SaveAsVersion>
      size="s"
      fullWidth
      aria-label="Версия"
      value={version}
      onChange={setVersion}
      disabled={!published}
      options={published
        ? [
          { value: "published", label: versionLabel(published) },
          { value: "draft", label: "Текущий черновик" },
        ]
        : [{ value: "draft", label: "Текущий черновик — тест ещё не опубликован" }]}
    />
  );

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="m"
      title="Сохранить как…"
      description={test.title}
      footer={(
        <>
          <Button variant="ghost" size="m" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            size="m"
            leadingIcon={<Download size={16} />}
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Собираем…" : "Сохранить"}
          </Button>
        </>
      )}
    >
      <Stack gap={4}>
        {/* Формат — карточками выбора: у каждого задача и путь обратно читаются сразу. */}
        <ChoiceCardGroup legend="Формат" value={format} onChange={(next) => setFormat(next as SaveAsFormat)}>
          {formats.map((option) => (
            <ChoiceCard key={option.value} value={option.value} title={option.label} description={option.description} showRadio />
          ))}
        </ChoiceCardGroup>

        <div className="tb-saveas-facts">
          {format === "xlsx" ? (
            <>
              <Text variant="body-s" tone="muted">Версия</Text>
              <Text variant="body-s">текущий черновик</Text>
              <Text variant="body-s" tone="muted">Не переносит</Text>
              <Text variant="body-s">{XLSX_NOT_CARRIED}</Text>
            </>
          ) : (
            <>
              <Text variant="body-s" tone="muted">Версия</Text>
              <div className="tb-saveas-select">{versionSelect}</div>
              {format === "scorm" ? (
                <>
                  <Text variant="body-s" tone="muted">Телеметрия</Text>
                  <Stack gap={1} align="start">
                    <Text variant="body-s">
                      {telemetryOn ? "включена — прохождения придут в аналитику" : "выключена"}
                    </Text>
                    <Text variant="body-s" tone="muted">Меняется в настройках теста</Text>
                    {onOpenSettings && (
                      <Button
                        variant="ghost"
                        size="s"
                        trailingIcon={<ChevronRight size={14} />}
                        onClick={onOpenSettings}
                      >
                        Основное · Интеграция
                      </Button>
                    )}
                  </Stack>
                </>
              ) : (
                <>
                  <Text variant="body-s" tone="muted">Переносит</Text>
                  <Text variant="body-s">{TBTEST_CARRIES}</Text>
                </>
              )}
            </>
          )}
        </div>

        {format === "xlsx" && (
          <Banner
            tone="info"
            size="sm"
            description="Книга собирается из текущего черновика: правки после публикации в неё попадут, даже если тест ещё не опубликован заново."
          />
        )}
        {failed && <Banner tone="error" size="sm" title="Файл не собран" description={failed} />}
      </Stack>
    </ModalDialog>
  );
}
