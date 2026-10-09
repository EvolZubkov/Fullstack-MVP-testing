/**
 * @module features/questions/scenario/scenario-block
 * @description The «Сценарий» block of the question drawer for the «Сценарий в ИС» type — the
 * approved wireframe `docs/wireframes/sim-scenario-question.html` (states s-sim-empty,
 * s-sim-loaded, s-sim-errors).
 *
 * The author uploads a `.scenario.zip`; the server checks the contract and, when there are no
 * errors, stores the images in the media library and answers with the question content. From
 * then on the scenario is named by its title, never by the file name: the file name is shown only
 * while an archive is rejected, because there is no scenario to name yet.
 *
 * «Сыграть» plays the scenario full-screen with the same player a learner gets (`shared/sim`);
 * the author's run is not recorded anywhere.
 */
import { useRef, useState } from "react";
import { Download, MonitorPlay, Play, Trash2, Upload } from "lucide-react";
import { Banner, Button, Cluster, FileItem, FileUploader, Label, Stack, Tag, Text, useToast } from "@skillum/ui-kit";
import type { Scenario } from "@shared/sim/contract";
import { summarizeScenario, type ScenarioSummary } from "@shared/sim/validate";
import { ScenarioRun, requestScenarioFullscreen } from "./scenario-run";
import { megabytes, plural, summaryTags } from "./scenario-summary";

/** The question content of the type: the scenario with media-library addresses. */
export interface ScenarioData {
  scenario: Scenario;
}

/** What the archive route answers. */
interface ArchiveResponse {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary: ScenarioSummary | null;
  mediaBytes?: number;
  dataJson?: ScenarioData;
}

export interface ScenarioBlockProps {
  /** The accepted scenario, or `null` while none is uploaded. */
  value: ScenarioData | null;
  onChange: (next: ScenarioData | null) => void;
  /**
   * Address of the archive built from the SAVED question, or `null` when there is nothing saved
   * to download (a new question, or a scenario replaced and not saved yet).
   */
  downloadHref: string | null;
}

/**
 * The scenario block: upload, accepted scenario, rejected archive.
 */
export function ScenarioBlock({ value, onChange, downloadHref }: ScenarioBlockProps) {
  const { push: toast } = useToast();
  const [uploading, setUploading] = useState(false);
  /** The last upload: its warnings stay with the accepted scenario, its errors replace it. */
  const [last, setLast] = useState<{ fileName: string; byteSize: number; response: ArchiveResponse } | null>(null);
  const [playing, setPlaying] = useState(false);
  const replaceInput = useRef<HTMLInputElement | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/questions/scenario-archive", { method: "POST", body, credentials: "include" });
      const payload = (await res.json().catch(() => ({}))) as Partial<ArchiveResponse> & { error?: string };
      if (!res.ok && !Array.isArray(payload.errors)) {
        toast({ tone: "error", title: "Архив не принят", description: payload.error ?? `Ошибка ${res.status}` });
        return;
      }
      const response: ArchiveResponse = {
        ok: payload.ok === true,
        errors: payload.errors ?? [],
        warnings: payload.warnings ?? [],
        summary: payload.summary ?? null,
        mediaBytes: payload.mediaBytes,
        dataJson: payload.dataJson,
      };
      setLast({ fileName: file.name, byteSize: file.size, response });
      if (response.ok && response.dataJson) onChange(response.dataJson);
    } catch {
      toast({ tone: "error", title: "Архив не принят", description: "Не удалось отправить файл" });
    } finally {
      setUploading(false);
    }
  };

  const rejected = last && !last.response.ok ? last : null;
  const summary = value ? summarizeScenario(value.scenario) : null;
  const warnings = value && last?.response.ok ? last.response.warnings : [];
  const stage = summary?.stage ? `сцена ${summary.stage.w} × ${summary.stage.h}` : null;
  const weight = value && last?.response.ok && last.response.mediaBytes ? megabytes(last.response.mediaBytes) : null;

  const replaceAction = {
    icon: <Upload size={16} aria-hidden="true" />,
    ariaLabel: "Заменить архив",
    onClick: () => replaceInput.current?.click(),
  };
  const removeAction = {
    icon: <Trash2 size={16} aria-hidden="true" />,
    ariaLabel: value ? "Удалить сценарий" : "Удалить архив",
    danger: true,
    onClick: () => { setLast(null); onChange(null); },
  };

  return (
    <Stack gap={2} data-testid="scenario-block">
      <Label>Сценарий</Label>
      {/* The replace action of the card opens the same picker as the uploader. */}
      <input
        ref={replaceInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
        data-testid="scenario-replace-input"
      />

      {!value && !rejected && (
        <FileUploader
          accept=".zip,application/zip"
          maxSizeMb={40}
          disabled={uploading}
          title={uploading ? "Проверка архива…" : "Перетащите архив сценария"}
          description=".scenario.zip · scenario.json и изображения media/ · до 40 МБ"
          cta="Выбрать файл"
          onFiles={(files) => { if (files[0]) void upload(files[0]); }}
          data-testid="scenario-uploader"
        />
      )}

      {rejected && (
        <Stack gap={2}>
          <FileItem
            name={rejected.fileName}
            kind="zip"
            meta={`Архив сценария · ${megabytes(rejected.byteSize)} · не принят`}
            actions={[replaceAction, removeAction]}
            data-testid="scenario-rejected"
          />
          <Banner
            tone="error"
            variant="subtle"
            title={`Архив не принят: ${plural(rejected.response.errors.length, ["ошибка", "ошибки", "ошибок"])}`}
            data-testid="scenario-errors"
          >
            <ul className="ou-list--bulleted">
              {rejected.response.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </Banner>
          {rejected.response.warnings.length > 0 && (
            <Banner tone="warning" variant="subtle" title={`Предупреждения: ${rejected.response.warnings.length}`}>
              {rejected.response.warnings.map((warning) => <Text key={warning} variant="body-s">{warning}</Text>)}
            </Banner>
          )}
        </Stack>
      )}

      {value && summary && !rejected && (
        <Stack gap={2}>
          <FileItem
            name={summary.title}
            kind="other"
            thumb={<MonitorPlay size={18} aria-label="Сценарий" />}
            meta={["Сценарий", summary.system, stage, weight].filter(Boolean).join(" · ")}
            actions={[
              replaceAction,
              ...(downloadHref
                ? [{
                    icon: <Download size={16} aria-hidden="true" />,
                    ariaLabel: "Скачать архив",
                    onClick: () => { window.location.href = downloadHref; },
                  }]
                : []),
              removeAction,
            ]}
            data-testid="scenario-accepted"
          />
          <Cluster gap={1} wrap>
            {summaryTags(summary).map((tag) => <Tag key={tag} size="s">{tag}</Tag>)}
          </Cluster>
          {warnings.length > 0 && (
            <Banner tone="warning" variant="subtle" title={`Предупреждения: ${warnings.length}`} data-testid="scenario-warnings">
              {warnings.map((warning) => <Text key={warning} variant="body-s">{warning}</Text>)}
            </Banner>
          )}
          <Cluster>
            <Button
              variant="secondary"
              size="s"
              leadingIcon={<Play size={14} aria-hidden="true" />}
              onClick={() => {
                requestScenarioFullscreen();
                setPlaying(true);
              }}
              data-testid="scenario-play"
            >
              Сыграть
            </Button>
          </Cluster>
        </Stack>
      )}

      {playing && value && (
        <ScenarioRun
          scenario={value.scenario}
          caption="Проверка сценария · результат не сохраняется"
          onClose={() => setPlaying(false)}
          closeOnFullscreenExit
        />
      )}
    </Stack>
  );
}
