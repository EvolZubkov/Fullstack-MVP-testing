/**
 * @module features/tests/debug-player/debug-player-page
 * @description PRD-18 Phase 4 — the in-service debug player window (full-screen,
 * separate browser window). It builds a throwaway SCORM package from LIVE state
 * (telemetry off), plays it in a same-origin iframe with the RTE shim hosted on
 * THIS window, and renders the shared `TBInspector` data as DS panels: a status
 * panel over the stage (progress + grade + a formula-error alarm) and a collapsible
 * inspector sidebar. The run is throwaway — nothing is written to `attempts` or
 * telemetry (R-2). The «Эталон» overlay and the «Результаты»/«Выдача» tabs are
 * Phase 4d.
 */
import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import {
  Box, Button, Cluster, EmptyState, IconButton, Input, Stack, Switch, Table, Tabs, Tag, Text,
  type TableColumn,
} from "@universityrt/ui-kit";
import { FlaskConical, RotateCw, PanelRightClose, PanelRightOpen, Download } from "lucide-react";
import { LoadingState } from "@/components/loading-state";
import { useDebugSession } from "./use-debug-session";
import {
  buildSnapshot, protocolToCsv,
  type InspectorSnapshot, type ProtocolRow, type ScaleRow, type ResultRow, type WatchSource,
  type ScoreVM, type DrawSectionVM, type AdaptiveBar,
} from "./inspector-snapshot";
import "./debug-player.css";

type TabId = "score" | "protocol" | "draw" | "scales" | "results" | "state" | "lms";

const TABS: { id: TabId; label: string }[] = [
  { id: "score", label: "Результаты" },
  { id: "protocol", label: "Протокол" },
  { id: "draw", label: "Выдача" },
  { id: "scales", label: "Шкалы" },
  { id: "results", label: "Показатели" },
  { id: "state", label: "Состояние" },
  { id: "lms", label: "LMS" },
];

const WATCH_SOURCES: { id: WatchSource; label: string }[] = [
  { id: "state", label: "state" },
  { id: "suspend", label: "suspend_data" },
  { id: "cmi", label: "cmi" },
];

const EMPTY: InspectorSnapshot = buildSnapshot(null, null, { protocolMode: "live", watchSource: "state" });

export default function DebugPlayerPage() {
  const { testId } = useParams<{ testId: string }>();
  const { state, runKey, reset } = useDebugSession(testId);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [tab, setTab] = useState<TabId>("score");
  const [collapsed, setCollapsed] = useState(false);
  const [watchSource, setWatchSource] = useState<WatchSource>("state");
  const [watchFilter, setWatchFilter] = useState("");
  const [reference, setReference] = useState(false);
  const [snap, setSnap] = useState<InspectorSnapshot>(EMPTY);

  // Real-time loop: every 600ms re-read the live package + RTE off the windows,
  // and (re)paint the «Эталон» overlay onto the live question render when enabled.
  useEffect(() => {
    if (state.status !== "ready") return;
    const tick = () => {
      const win = iframeRef.current?.contentWindow ?? null;
      setSnap(buildSnapshot(win, window.__scorm ?? null, { protocolMode: "live", watchSource }));
      if (window.TBInspector) {
        if (reference) window.TBInspector.applyReference(win);
        else window.TBInspector.clearReference(win);
      }
    };
    tick();
    const h = window.setInterval(tick, 600);
    return () => window.clearInterval(h);
  }, [state.status, watchSource, runKey, reference]);

  if (state.status === "loading") return <LoadingState message="Готовим тестовый прогон…" />;

  if (state.status === "forbidden") {
    return (
      <Center>
        <EmptyState
          art={<FlaskConical size={48} color="var(--ou-fg-muted)" />}
          title="Нет доступа к отладке теста"
          description="Тестовый прогон доступен только при праве на редактирование теста (как и экспорт SCORM)."
        />
      </Center>
    );
  }
  if (state.status === "error") {
    return (
      <Center>
        <EmptyState
          art={<FlaskConical size={48} color="var(--ou-error-600)" />}
          title="Не удалось собрать тестовый прогон"
          description={state.error || "Неизвестная ошибка сборки пакета."}
        />
      </Center>
    );
  }

  return (
    <div className="dbg">
      <header className="dbg__bar">
        <Cluster gap={3} align="center">
          <FlaskConical size={18} />
          <Text weight="bold">Тестовый прогон</Text>
          <Tag variant="outline" size="s">живой черновик</Tag>
        </Cluster>
        <Cluster gap={4} align="center">
          <Switch
            label="Эталон"
            checked={reference}
            onChange={(e) => setReference(e.target.checked)}
            data-testid="toggle-reference"
          />
          <Button variant="secondary" size="s" leadingIcon={<RotateCw size={15} />} onClick={reset}>
            Сбросить прогон
          </Button>
        </Cluster>
      </header>

      <div className="dbg__body">
        <section className="dbg__stage">
          <StatusPanel snap={snap} />
          <iframe
            key={runKey}
            ref={iframeRef}
            className="dbg__frame"
            title="Тестовый прогон"
            src={state.playUrl}
          />
        </section>

        {collapsed ? (
          <IconButton
            className="dbg__expand"
            variant="secondary"
            aria-label="Развернуть инспектор"
            icon={<PanelRightOpen size={18} />}
            onClick={() => setCollapsed(false)}
          />
        ) : (
          <aside className="dbg__inspector">
            <div className="dbg__inspector-head">
              <Tabs<TabId> variant="underline" size="s" items={TABS} value={tab} onChange={setTab} aria-label="Инспектор" />
              <IconButton
                variant="ghost"
                size="s"
                aria-label="Свернуть инспектор"
                icon={<PanelRightClose size={18} />}
                onClick={() => setCollapsed(true)}
              />
            </div>
            <div className="dbg__inspector-body">
              {tab === "score" && <ScorePanel snap={snap} />}
              {tab === "protocol" && <ProtocolPanel snap={snap} />}
              {tab === "draw" && <DrawPanel snap={snap} />}
              {tab === "scales" && <ScalesPanel snap={snap} />}
              {tab === "results" && <ResultsPanel snap={snap} />}
              {tab === "state" && (
                <StatePanel
                  snap={snap}
                  source={watchSource}
                  onSource={setWatchSource}
                  filter={watchFilter}
                  onFilter={setWatchFilter}
                />
              )}
              {tab === "lms" && <LmsPanel snap={snap} />}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="dbg__center">{children}</div>;
}

// ─── Status panel (over the stage) ───────────────────────────────────────────────

function StatusPanel({ snap }: { snap: InspectorSnapshot }) {
  const s = snap.status;
  const grade = s.score
    ? `${s.score.raw}/${s.score.max}${s.score.scaledPct != null ? ` · ${s.score.scaledPct}%` : ""}`
    : "—";
  const verdict =
    s.verdict === "passed" ? "Пройден" : s.verdict === "failed" ? "Не пройден" : s.verdict === "unknown" ? "не определён" : "—";
  return (
    <div className="dbg__status">
      <Cluster gap={5} align="center">
        <StatCell label="Прогресс" value={`${s.answered} из ${s.drawn}`} hint={`${s.percentDone}%`} />
        <StatCell label="Оценка" value={grade} hint={verdict} />
        {snap.adaptive.visible && snap.adaptive.now && (
          <StatCell
            label="Адаптив"
            value={`Тема ${snap.adaptive.now.topicIndex}/${snap.adaptive.now.topicCount}`}
            hint={snap.adaptive.now.levelName}
          />
        )}
        {s.alarm && <Tag variant="solid" tone="error" size="s">{s.alarm}</Tag>}
      </Cluster>
    </div>
  );
}

function StatCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="dbg__stat">
      <Text variant="caption" tone="muted">{label}</Text>
      <Text weight="bold">{value}{hint ? <Text as="span" tone="muted" variant="body-s">{` · ${hint}`}</Text> : null}</Text>
    </div>
  );
}

// ─── Inspector panels ────────────────────────────────────────────────────────────

function verdictTag(r: ProtocolRow) {
  if (r.verdict === "none") return <Tag size="s" variant="outline">нет ответа</Tag>;
  if (r.verdict === "correct") return <Tag size="s" tone="success">верно</Tag>;
  if (r.verdict === "partial") return <Tag size="s" tone="warning">{`частично ${r.ratioPct}%`}</Tag>;
  return <Tag size="s" tone="error">неверно</Tag>;
}

function ProtocolPanel({ snap }: { snap: InspectorSnapshot }) {
  const rows = snap.protocol.rows;
  if (!rows.length) {
    return <PanelEmpty text={snap.protocol.note || (snap.hasData ? "Пока нет выданных вопросов — начните отвечать." : "Запустите пакет и начните отвечать.")} />;
  }
  const columns: TableColumn<ProtocolRow>[] = [
    { key: "idx", header: "#", width: "44px", render: (r) => <Text variant="body-s" tone="muted">{r.idx}</Text> },
    {
      key: "q",
      header: "Вопрос",
      render: (r) => (
        <Stack gap={1}>
          <Text variant="body-s">{r.prompt || "(без текста)"}</Text>
          <Text variant="caption" tone="muted">{`${r.typeLabel}${r.topicName ? ` · ${r.topicName}` : ""}${r.levelName ? ` · ${r.levelName}` : ""}`}</Text>
        </Stack>
      ),
    },
    { key: "answer", header: "Ответ", render: (r) => <Text variant="body-s">{r.answerStr}</Text> },
    { key: "verdict", header: "Вердикт", width: "120px", render: verdictTag },
    {
      key: "price",
      header: "Цена / балл",
      width: "130px",
      render: (r) =>
        r.score != null
          ? <Text variant="body-s" className="dbg__nowrap">{`${r.score}/${r.sMax} · ${r.earned}/${r.points}`}</Text>
          : <Text variant="body-s" tone="muted">—</Text>,
    },
  ];
  return (
    <Stack gap={3}>
      <Cluster justify="end">
        <Button variant="ghost" size="s" leadingIcon={<Download size={14} />} onClick={() => downloadCsv(rows)}>
          Экспорт CSV
        </Button>
      </Cluster>
      <Table columns={columns} rows={rows} rowKey={(r) => String(r.idx)} />
    </Stack>
  );
}

function ScorePanel({ snap }: { snap: InspectorSnapshot }) {
  const sc = snap.score;
  if (!sc.available) return <PanelEmpty text="Запустите пакет и начните отвечать — здесь появится агрегат результата." />;
  if (sc.adaptive) return <AdaptivePanel bar={sc.bar} />;
  const threshold = sc.rule && sc.rule.type === "percent" ? `порог ${sc.rule.value}%` : null;
  const columns: TableColumn<NonNullable<ScoreVM["sections"]>[number]>[] = [
    { key: "topic", header: "Раздел", render: (s) => s.topicName },
    { key: "pts", header: "Баллы", width: "110px", render: (s) => `${s.earnedPoints}/${s.possiblePoints}` },
    { key: "pct", header: "%", width: "60px", render: (s) => String(s.percent) },
    {
      key: "verdict", header: "Зачёт", width: "96px",
      render: (s) => (s.passed == null ? <Text tone="muted">—</Text> : <Tag size="s" tone={s.passed ? "success" : "error"}>{s.passed ? "да" : "нет"}</Tag>),
    },
  ];
  return (
    <Stack gap={4}>
      <Box className="dbg__score-hero">
        <Cluster gap={5} align="center">
          <StatCell label="Балл" value={`${sc.earnedPoints}/${sc.possiblePoints}`} hint={`${sc.percent}%`} />
          <StatCell label="Верно" value={`${sc.correct}/${sc.totalQuestions}`} />
          <Tag variant="solid" tone={sc.passed ? "success" : "error"}>{sc.passed ? "Пройден" : "Не пройден"}</Tag>
          {threshold ? <Text tone="muted" variant="body-s">{threshold}</Text> : null}
        </Cluster>
      </Box>
      {sc.sections && sc.sections.length ? <Table columns={columns} rows={sc.sections} rowKey={(s) => s.topicName} /> : null}
    </Stack>
  );
}

function drawModeLabel(s: DrawSectionVM): string {
  return s.mode === "variants" ? "вариант" : s.mode === "quota" ? "квоты по тегам" : s.mode === "draw" ? "случайная выборка" : "все вопросы";
}

function DrawSection({ s }: { s: DrawSectionVM }) {
  return (
    <Box className="dbg__draw-section">
      <Cluster justify="between" align="center">
        <Text weight="bold" variant="body-s">{s.topicName}</Text>
        <Cluster gap={2} align="center">
          <Tag size="s" variant="outline">{drawModeLabel(s)}</Tag>
          <Text variant="caption" tone="muted">{`${s.count} вопр.`}</Text>
        </Cluster>
      </Cluster>
      {s.mode === "variants" && (
        <Text variant="body-s" tone="muted">
          {s.formId ? `Вариант ${s.formIndex} из ${s.formCount} (${s.formId})` : `Вариант не распознан (из ${s.formCount})`}
        </Text>
      )}
      {s.mode === "quota" && s.quotas && (
        <Table
          columns={[
            { key: "tag", header: "Тег", render: (q) => q.tag },
            { key: "plan", header: "План", width: "70px", render: (q) => `${q.planned}${q.mode === "min" ? "+" : ""}` },
            { key: "fact", header: "Факт", width: "70px", render: (q) => (q.short ? <Tag size="s" tone="warning">{q.actual}</Tag> : String(q.actual)) },
          ]}
          rows={s.quotas}
          rowKey={(q) => q.tag}
        />
      )}
    </Box>
  );
}

function DrawPanel({ snap }: { snap: InspectorSnapshot }) {
  const d = snap.draw;
  if (!d.available) return <PanelEmpty text="Запустите пакет — здесь появится состав выдачи этого прогона." />;
  if (d.adaptive) return <AdaptivePanel bar={d.bar} />;
  return <Stack gap={4}>{(d.sections ?? []).map((s, i) => <DrawSection key={i} s={s} />)}</Stack>;
}

function AdaptivePanel({ bar }: { bar?: AdaptiveBar }) {
  const confirmed = bar?.confirmed ?? [];
  if (!confirmed.length) return <PanelEmpty text="Адаптивный тест — подтверждённые уровни появятся по мере прохождения тем." />;
  return (
    <Stack gap={2}>
      {confirmed.map((c, i) => (
        <Box key={i} className="dbg__draw-section">
          <Cluster justify="between" align="center">
            <Text variant="body-s">{c.topicName}</Text>
            {c.kind === "ok"
              ? <Tag size="s" tone="success">{`${c.levelName} ✓ (${c.correctCount}/${c.total})`}</Tag>
              : <Tag size="s" tone="error">уровень не достигнут</Tag>}
          </Cluster>
        </Box>
      ))}
    </Stack>
  );
}

function ScalesPanel({ snap }: { snap: InspectorSnapshot }) {
  if (!snap.scales.length) {
    return <PanelEmpty text={snap.hasData ? "В тесте нет шкал." : "Запустите пакет. Значения шкал считаются вживую по ответам."} />;
  }
  const columns: TableColumn<ScaleRow>[] = [
    { key: "key", header: "Шкала", render: (r) => r.key },
    { key: "raw", header: "Значение", width: "100px", render: (r) => (r.raw == null ? "—" : String(r.raw)) },
    { key: "percent", header: "%", width: "70px", render: (r) => (r.percent == null ? "—" : String(r.percent)) },
    { key: "level", header: "Уровень", render: (r) => (r.level ? <Tag size="s" variant="outline">{r.levelLabel}</Tag> : <Text tone="muted">—</Text>) },
    { key: "pub", header: "Опубликовано", render: (r) => (r.pub ? r.pub : <Text tone="muted" variant="body-s">— (до завершения)</Text>) },
  ];
  return <Table columns={columns} rows={snap.scales} rowKey={(r) => r.key} />;
}

function ResultsPanel({ snap }: { snap: InspectorSnapshot }) {
  if (!snap.results.length) {
    return <PanelEmpty text={snap.hasData ? "В тесте нет показателей." : "Запустите пакет."} />;
  }
  const columns: TableColumn<ResultRow>[] = [
    { key: "name", header: "Показатель", render: (r) => r.name },
    { key: "live", header: "Текущее", render: (r) => (r.live == null ? <Text tone="muted">—</Text> : r.live) },
    { key: "pub", header: "Опубликовано", render: (r) => (r.pub != null ? r.pub : <Text tone="muted" variant="body-s">— (до завершения)</Text>) },
  ];
  return <Table columns={columns} rows={snap.results} rowKey={(r) => r.name} />;
}

function StatePanel({
  snap, source, onSource, filter, onFilter,
}: {
  snap: InspectorSnapshot;
  source: WatchSource;
  onSource: (s: WatchSource) => void;
  filter: string;
  onFilter: (s: string) => void;
}) {
  const f = filter.toLowerCase();
  const rows = f ? snap.watch.rows.filter((r) => r.path.toLowerCase().includes(f)) : snap.watch.rows;
  const columns: TableColumn<{ path: string; disp: string }>[] = [
    { key: "path", header: "Путь", render: (r) => <Text variant="body-s" className="dbg__path">{r.path}</Text> },
    { key: "disp", header: "Значение", render: (r) => <Text variant="body-s">{r.disp}</Text> },
  ];
  return (
    <Stack gap={3}>
      <Tabs<WatchSource> variant="segment" size="s" items={WATCH_SOURCES} value={source} onChange={onSource} aria-label="Источник состояния" />
      <Input placeholder="Фильтр по пути…" value={filter} onChange={(e) => onFilter(e.target.value)} fullWidth />
      {rows.length ? (
        <Table columns={columns} rows={rows.slice(0, 500)} rowKey={(r) => r.path} />
      ) : (
        <PanelEmpty text="Нет данных — запустите пакет и начните отвечать." />
      )}
    </Stack>
  );
}

function LmsPanel({ snap }: { snap: InspectorSnapshot }) {
  if (!snap.lms.length) return <PanelEmpty text="События обмена с LMS появятся здесь после запуска пакета." />;
  return (
    <Stack gap={1}>
      {snap.lms.map((ev, i) => (
        <Box key={i} className={`dbg__lms dbg__lms--${ev.kind}`}>
          <Text variant="body-s">{ev.text}</Text>
          {ev.sub ? <Text variant="caption" tone="muted">{ev.sub}</Text> : null}
        </Box>
      ))}
    </Stack>
  );
}

function PanelEmpty({ text }: { text: string }) {
  return <Box className="dbg__panel-empty"><Text tone="muted" variant="body-s">{text}</Text></Box>;
}

// ─── CSV download ────────────────────────────────────────────────────────────────

function downloadCsv(rows: ProtocolRow[]) {
  const blob = new Blob(["﻿" + protocolToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "protocol.csv";
  a.click();
  URL.revokeObjectURL(url);
}
