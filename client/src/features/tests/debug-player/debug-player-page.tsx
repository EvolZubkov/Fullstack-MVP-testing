/**
 * @module features/tests/debug-player/debug-player-page
 * @description PRD-18 Phase 4 — the in-service debug player window. Renders the
 * approved wireframe (docs/wireframes/approved/prd18-debug-player.html) with real
 * DS components: a toolbar, a status bar over the stage, the package iframe inside
 * a framed card whose ribbon carries the «Эталон» toggle, and a collapsible
 * inspector with 7 tabs. Builds a throwaway package from LIVE state (telemetry
 * off); nothing is written to `attempts` or telemetry (R-2).
 */
import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import {
  Box, Button, Cluster, EmptyState, Fab, IconButton, Input, ProgressBar, Stack, Switch, Table, Tabs, Tag, Text, Tree,
  type TableColumn, type TreeNodeData,
} from "@universityrt/ui-kit";
import {
  Play, FlaskConical, Info, RefreshCw, RotateCcw, X, ChevronLeft, ChevronRight, Download, Search,
  CircleDot, CheckSquare, ArrowLeftRight, ListOrdered,
} from "lucide-react";
import { LoadingState } from "@/components/loading-state";
import { useDebugSession } from "./use-debug-session";
import {
  buildSnapshot, protocolToCsv,
  type InspectorSnapshot, type ProtocolRow, type ScaleRow, type ResultRow, type WatchSource,
  type ScoreVM, type DrawSectionVM, type AdaptiveBar, type LmsRow, type WatchNode,
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

// Boundary-of-fidelity note (FR-14/NFR-18): shown on the toolbar ⓘ button.
const DISCLAIMER =
  "Отладочный прогон: НЕ записывается (нет попыток/телеметрии) и НЕ заменяет приёмку в WebTutor " +
  "(нет SN-секвенсирования, cross-attempt-стора, реального retake-gate). Версия — живой черновик.";

const EMPTY: InspectorSnapshot = buildSnapshot(null, null, { protocolMode: "live", watchSource: "state" });

export default function DebugPlayerPage() {
  const { testId } = useParams<{ testId: string }>();
  const { state, runKey, reset, rebuild } = useDebugSession(testId);
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

  if (state.status === "loading") return <LoadingState message="Готовим прогон отладки…" />;

  if (state.status === "forbidden") {
    return (
      <div className="dbg__center">
        <EmptyState
          art={<FlaskConical size={48} color="var(--ou-fg-muted)" />}
          title="Нет доступа к отладке теста"
          description="Прогон отладки доступен только при праве на редактирование теста (как и экспорт SCORM)."
        />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="dbg__center">
        <EmptyState
          art={<FlaskConical size={48} color="var(--ou-error-default)" />}
          title="Не удалось собрать прогон"
          description={state.error || "Неизвестная ошибка сборки пакета."}
        />
      </div>
    );
  }

  return (
    <div className={collapsed ? "dbg is-collapsed" : "dbg"}>
      <header className="dbg__bar">
        <span className="dbg__title">
          <Play size={18} />
          <Text weight="bold">Плеер отладки</Text>
          <span className="dbg__sub">{state.title ? `${state.title} · ` : ""}живой черновик</span>
          <IconButton variant="ghost" size="s" aria-label="О прогоне отладки" title={DISCLAIMER} icon={<Info size={14} />} />
        </span>
        <span className="dbg__bar-spacer" />
        <Button variant="secondary" size="s" leadingIcon={<RefreshCw size={14} />} onClick={rebuild}>
          Пересобрать
        </Button>
        <Button variant="ghost" size="s" leadingIcon={<RotateCcw size={14} />} onClick={reset} data-testid="btn-reset">
          Сброс
        </Button>
        <span className="dbg__bar-sep" />
        <IconButton
          variant="ghost"
          size="s"
          aria-label="Закрыть окно плеера"
          title="Закрыть окно плеера"
          icon={<X size={16} />}
          onClick={() => window.close()}
        />
      </header>

      <div className="dbg__body">
        <section className="dbg__stage">
          <StatusBar snap={snap} />
          <div className="dbg__canvas">
            <div className="dbg__frame">
              <div className="dbg__ribbon">
                <span>SCORM-пакет{state.template ? ` · шаблон «${state.template}»` : ""}</span>
                <label className="dbg__ref-toggle" title="Подсветить правильные ответы (debug; на баллы не влияет)">
                  <span className="dbg__ref-lbl">Эталон</span>
                  <Switch
                    checked={reference}
                    onChange={(e) => setReference(e.target.checked)}
                    aria-label="Показать эталон"
                    data-testid="toggle-reference"
                  />
                </label>
              </div>
              <div className="dbg__frame-screen">
                <iframe key={runKey} ref={iframeRef} className="dbg__iframe" title="Прогон отладки" src={state.playUrl} />
              </div>
            </div>
          </div>
        </section>

        <aside className="dbg__inspector">
          <Fab
            className="dbg__collapse"
            size="s"
            variant="neutral"
            aria-label="Свернуть или развернуть инспектор"
            title="Свернуть или развернуть инспектор"
            icon={<ChevronLeft size={16} />}
            onClick={() => setCollapsed((c) => !c)}
          />
          <div className="dbg__ins-main">
            <TabHead tab={tab} onTab={setTab} />
            <div className="dbg__ins-body">
              {tab === "score" && <ScorePanel snap={snap} />}
              {tab === "protocol" && <ProtocolPanel snap={snap} />}
              {tab === "draw" && <DrawPanel snap={snap} />}
              {tab === "scales" && <ScalesPanel snap={snap} />}
              {tab === "results" && <ResultsPanel snap={snap} />}
              {tab === "state" && (
                <StatePanel snap={snap} source={watchSource} onSource={setWatchSource} filter={watchFilter} onFilter={setWatchFilter} />
              )}
              {tab === "lms" && <LmsPanel snap={snap} />}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Inspector tab head with overflow scroll arrows (matches the wireframe) ──────

function TabHead({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const headRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ overflow: false, left: false, right: false });

  const list = () => headRef.current?.querySelector(".ou-tabs__list") as HTMLElement | null;
  const measure = () => {
    const el = list();
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 2;
    setScroll({
      overflow,
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  };
  const scrollBy = (dir: number) => list()?.scrollBy({ left: dir * 160, behavior: "smooth" });

  useEffect(() => {
    measure();
    const el = list();
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dbg__ins-head" ref={headRef}>
      {scroll.overflow && (
        <IconButton
          className="dbg__tabscroll"
          variant="ghost"
          size="s"
          aria-label="Прокрутить вкладки влево"
          icon={<ChevronLeft size={16} />}
          disabled={!scroll.left}
          onClick={() => scrollBy(-1)}
        />
      )}
      <Tabs<TabId> variant="underline" size="s" items={TABS} value={tab} onChange={onTab} aria-label="Инспектор" />
      {scroll.overflow && (
        <IconButton
          className="dbg__tabscroll"
          variant="ghost"
          size="s"
          aria-label="Прокрутить вкладки вправо"
          icon={<ChevronRight size={16} />}
          disabled={!scroll.right}
          onClick={() => scrollBy(1)}
        />
      )}
    </div>
  );
}

// ─── Status bar over the stage ───────────────────────────────────────────────────

function StatusBar({ snap }: { snap: InspectorSnapshot }) {
  const s = snap.status;
  const sc = snap.score;
  const threshold = sc.rule && sc.rule.type === "percent" ? sc.rule.value : null;
  const currentTopic = snap.protocol.rows.length ? snap.protocol.rows[snap.protocol.rows.length - 1].topicName : "";
  return (
    <div className="dbg__status">
      <div className="dbg__status-left">
        <div className="dbg__stat">
          <span className="dbg__stat-lbl">Прогресс</span>
          <span className="dbg__stat-val">
            <span className="dbg__stat-num">{s.answered} / {s.drawn}</span>
            <span className="dbg__pbar">
              <ProgressBar value={s.percentDone} size="xs" tone={s.percentDone >= 100 ? "success" : "accent"} hideHeader />
            </span>
            {currentTopic ? <Tag variant="outline" size="s">{`Тема: ${currentTopic}`}</Tag> : null}
          </span>
        </div>
      </div>
      <div className="dbg__status-right">
        <div className="dbg__stat">
          <span className="dbg__stat-lbl">Оценка</span>
          <span className="dbg__stat-val">
            {sc.available && !sc.adaptive ? (
              <>
                <span className="dbg__stat-num">{`${sc.earnedPoints} из ${sc.possiblePoints}`}</span>
                <span className="dbg__stat-sub">{`${sc.percent}%`}</span>
                {threshold != null ? <Tag variant="soft" size="s">{`порог ${threshold}%`}</Tag> : null}
                <Tag tone={sc.passed ? "success" : "error"} size="s">{sc.passed ? "Пройден" : "Не пройден"}</Tag>
              </>
            ) : (
              <span className="dbg__stat-num">—</span>
            )}
          </span>
        </div>
        {s.alarm ? (
          <>
            <span className="dbg__bar-sep" />
            <div className="dbg__stat">
              <span className="dbg__stat-lbl">Ошибка расчёта</span>
              <span className="dbg__stat-val"><Tag tone="error" size="s">{s.alarm}</Tag></span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── Inspector panels ────────────────────────────────────────────────────────────

function qTypeIcon(type: string) {
  const p = { size: 14, className: "dbg__qico" };
  if (type === "single") return <CircleDot {...p} />;
  if (type === "multiple") return <CheckSquare {...p} />;
  if (type === "matching") return <ArrowLeftRight {...p} />;
  return <ListOrdered {...p} />;
}

function verdictTag(r: ProtocolRow) {
  if (r.verdict === "none") return <Tag size="s" variant="soft">нет ответа</Tag>;
  if (r.verdict === "correct") return <Tag size="s" tone="success">верно</Tag>;
  if (r.verdict === "partial") return <Tag size="s" tone="warning">{`частично ${r.ratioPct}%`}</Tag>;
  return <Tag size="s" tone="error">неверно</Tag>;
}

function ScorePanel({ snap }: { snap: InspectorSnapshot }) {
  const sc = snap.score;
  if (!sc.available) return <PanelEmpty text="Запустите пакет и начните отвечать — здесь появится агрегат результата." />;
  if (sc.adaptive) return <AdaptivePanel bar={sc.bar} />;
  const threshold = sc.rule && sc.rule.type === "percent" ? sc.rule.value : null;
  const columns: TableColumn<NonNullable<ScoreVM["sections"]>[number]>[] = [
    { key: "topic", header: "Раздел", render: (s) => s.topicName },
    { key: "pts", header: "Балл", width: "92px", render: (s) => `${s.earnedPoints} / ${s.possiblePoints}` },
    { key: "pct", header: "%", width: "56px", render: (s) => String(s.percent) },
    {
      key: "verdict", header: "Итог", width: "104px",
      render: (s) => (s.passed == null
        ? <Tag size="s" variant="soft">идёт</Tag>
        : <Tag size="s" tone={s.passed ? "success" : "error"}>{s.passed ? "пройден" : "не пройден"}</Tag>),
    },
  ];
  return (
    <Stack gap={3}>
      <div className="dbg__kpi-grid">
        <div className="ou-kpi"><div className="ou-kpi__head">Баллы</div><div className="ou-kpi__value">{`${sc.earnedPoints} из ${sc.possiblePoints}`}</div></div>
        <div className="ou-kpi"><div className="ou-kpi__head">Процент</div><div className="ou-kpi__value">{`${sc.percent}%`}</div></div>
        <div className="ou-kpi"><div className="ou-kpi__head">Порог</div><div className="ou-kpi__value">{threshold != null ? `${threshold}%` : "—"}</div></div>
        <div className="ou-kpi"><div className="ou-kpi__head">Результат</div><div className="ou-kpi__value"><Tag tone={sc.passed ? "success" : "error"} size="s">{sc.passed ? "Пройден" : "Не пройден"}</Tag></div></div>
      </div>
      {threshold != null ? (
        <ProgressBar
          value={sc.percent ?? 0}
          size="m"
          tone={sc.passed ? "success" : "error"}
          label="Итог против порога"
          valueLabel={<><strong>{sc.percent}</strong>% / {threshold}%</>}
        />
      ) : null}
      {sc.sections && sc.sections.length ? (
        <>
          <div className="dbg__ins-h">Результаты по разделам</div>
          <Table columns={columns} rows={sc.sections} rowKey={(s) => s.topicName} />
        </>
      ) : null}
      <div className="dbg__sum">
        <span>итог: <strong>{sc.passed ? "пройден" : "не пройден"}</strong></span>
      </div>
    </Stack>
  );
}

function ProtocolPanel({ snap }: { snap: InspectorSnapshot }) {
  const rows = snap.protocol.rows;
  if (!rows.length) {
    return <PanelEmpty text={snap.protocol.note || (snap.hasData ? "Пока нет выданных вопросов — начните отвечать." : "Запустите пакет и начните отвечать.")} />;
  }
  const earned = rows.reduce((a, r) => a + r.earned, 0);
  const possible = rows.reduce((a, r) => a + r.points, 0);
  const pct = possible ? Math.round((earned / possible) * 100) : 0;
  const columns: TableColumn<ProtocolRow>[] = [
    {
      key: "q",
      header: "Вопрос",
      render: (r) => (
        <Stack gap={1}>
          <Text variant="body-s">{qTypeIcon(r.type)}{r.prompt || "(без текста)"}</Text>
          <Text variant="caption" tone="muted">{`${r.typeLabel}${r.topicName ? ` · ${r.topicName}` : ""}${r.levelName ? ` · ${r.levelName}` : ""}`}</Text>
          {r.contribs.map((c, i) => (
            <span key={i} className="dbg__contrib">{`шкала ${c.scaleKey} ${c.delta >= 0 ? "+" : ""}${c.delta}`}</span>
          ))}
          {r.priceNote ? <span className="dbg__price">{r.priceNote}</span> : null}
        </Stack>
      ),
    },
    { key: "verdict", header: "Вердикт", width: "118px", render: verdictTag },
    { key: "score", header: "Балл", width: "78px", render: (r) => `${r.earned} / ${r.points}` },
  ];
  return (
    <Stack gap={3}>
      <div className="dbg__ins-toolbar">
        <span className="dbg__bar-spacer" />
        <Button variant="ghost" size="s" leadingIcon={<Download size={13} />} onClick={() => downloadCsv(rows)}>
          Протокол в CSV
        </Button>
      </div>
      <Table columns={columns} rows={rows} rowKey={(r) => String(r.idx)} />
      <div className="dbg__sum">
        <span>{`итог: `}<strong>{`${Math.round(earned * 100) / 100} из ${possible}`}</strong>{` · ${pct}%`}</span>
        {snap.score.available && !snap.score.adaptive
          ? <Tag size="s" tone={snap.score.passed ? "success" : "error"}>{snap.score.passed ? "Пройден" : "Не пройден"}</Tag>
          : null}
      </div>
    </Stack>
  );
}

function drawModeLabel(s: DrawSectionVM): string {
  return s.mode === "variants" ? "режим вариантов" : s.mode === "quota" ? "тег-квоты (план vs факт)" : s.mode === "draw" ? "случайная выборка" : "все вопросы";
}

/** Short type words for the «По типам» summary — matches the approved wireframe. */
const TYPE_SHORT: Record<string, string> = {
  single: "одиночный", multiple: "множественный", matching: "сопоставление", ranking: "ранжирование",
};

function byTypeSummary(s: DrawSectionVM): string | null {
  if (!s.byType.length) return null;
  return "По типам: " + s.byType.map((t) => `${TYPE_SHORT[t.type] ?? t.typeLabel} ${t.count}`).join(" · ");
}

function DrawSection({ s }: { s: DrawSectionVM }) {
  const types = byTypeSummary(s);
  return (
    <Box className="dbg__draw-section">
      <div className="dbg__ins-h">{`Тема «${s.topicName}» — ${drawModeLabel(s)}`}</div>
      {s.mode === "variants" ? (
        <div className="dbg__sum">
          <span>
            {s.formId
              ? <>Выпал <strong>{`Вариант ${s.formIndex}`}</strong>{` из ${s.formCount} · выдан целиком · ${s.count} из банка ${s.bankSize}`}</>
              : `Вариант не распознан (из ${s.formCount})`}
          </span>
        </div>
      ) : null}
      {s.mode === "quota" && s.quotas ? (
        <Table
          columns={[
            { key: "tag", header: "Подтема (тег)", render: (q) => q.tag },
            { key: "plan", header: "План", width: "64px", render: (q) => `${q.planned}${q.mode === "min" ? "+" : ""}` },
            { key: "fact", header: "Факт", width: "64px", render: (q) => (q.short ? <Tag size="s" tone="warning">{q.actual}</Tag> : <Tag size="s" tone="success">{q.actual}</Tag>) },
          ]}
          rows={s.quotas}
          rowKey={(q) => q.tag}
        />
      ) : s.byTag.length ? (
        <Table
          columns={[
            { key: "tag", header: "Подтема (тег)", render: (q) => q.tag },
            { key: "count", header: "Вопросов", width: "96px", render: (q) => q.count },
          ]}
          rows={s.byTag}
          rowKey={(q) => q.tag}
        />
      ) : null}
      {types ? <div className="dbg__sum"><span>{types}</span></div> : null}
      <div className="dbg__sum"><span>{`${s.count} вопросов из банка ${s.bankSize}`}</span></div>
    </Box>
  );
}

function DrawPanel({ snap }: { snap: InspectorSnapshot }) {
  const d = snap.draw;
  if (!d.available) return <PanelEmpty text="Запустите пакет — здесь появится состав выдачи этого прогона." />;
  if (d.adaptive) return <AdaptivePanel bar={d.bar} />;
  const secs = d.sections ?? [];
  const total = secs.reduce((a, s) => a + s.count, 0);
  const breakdown = secs.map((s) => `${s.topicName} ${s.count}`).join(" · ");
  return (
    <Stack gap={3}>
      {secs.map((s, i) => <DrawSection key={i} s={s} />)}
      <div className="dbg__sum"><span>Итого выдано <strong>{total}</strong>{breakdown ? ` (${breakdown})` : ""}</span></div>
    </Stack>
  );
}

function ScalesPanel({ snap }: { snap: InspectorSnapshot }) {
  if (!snap.scales.length) {
    return <PanelEmpty text={snap.hasData ? "В тесте нет шкал." : "Запустите пакет. Значения шкал считаются вживую по ответам."} />;
  }
  // Per the wireframe: Шкала · Значение (raw) · % · Уровень. What goes to the LMS
  // lives in the «LMS» tab, NOT here (no «Опубликовано» column).
  const columns: TableColumn<ScaleRow>[] = [
    { key: "key", header: "Шкала", render: (r) => r.key },
    { key: "raw", header: "Значение", width: "104px", render: (r) => (r.raw == null ? "—" : String(r.raw)) },
    { key: "percent", header: "%", width: "64px", render: (r) => (r.percent == null ? "—" : `${r.percent}%`) },
    { key: "level", header: "Уровень", render: (r) => (r.level ? <Tag size="s" variant="outline">{r.levelLabel}</Tag> : <Text tone="muted">—</Text>) },
  ];
  return <Table columns={columns} rows={snap.scales} rowKey={(r) => r.key} />;
}

function ResultsPanel({ snap }: { snap: InspectorSnapshot }) {
  if (!snap.results.length) {
    return <PanelEmpty text={snap.hasData ? "В тесте нет показателей." : "Запустите пакет."} />;
  }
  // Per the wireframe: Имя · Значение. Publication to the LMS is shown in the «LMS» tab.
  const columns: TableColumn<ResultRow>[] = [
    { key: "name", header: "Имя", render: (r) => r.name },
    { key: "live", header: "Значение", render: (r) => (r.live == null ? <Text tone="muted">—</Text> : r.live) },
  ];
  return <Table columns={columns} rows={snap.results} rowKey={(r) => r.name} />;
}

/** Keep only nodes whose id/label matches the filter, or that have a matching descendant. */
function pruneTree(nodes: WatchNode[], f: string): WatchNode[] {
  if (!f) return nodes;
  const out: WatchNode[] = [];
  for (const n of nodes) {
    const kids = n.children ? pruneTree(n.children, f) : undefined;
    const hit = n.id.toLowerCase().includes(f) || n.label.toLowerCase().includes(f);
    if (hit || (kids && kids.length)) out.push({ ...n, children: kids && kids.length ? kids : n.children });
  }
  return out;
}

function toTreeNodes(nodes: WatchNode[]): TreeNodeData[] {
  return nodes.map((n) => ({
    id: n.id,
    label: n.label,
    meta: <Text variant="caption" tone="muted" className="dbg__path">{n.meta}</Text>,
    folder: !n.leaf,
    children: n.children ? toTreeNodes(n.children) : undefined,
  }));
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
  const pruned = pruneTree(snap.watch.tree, filter.toLowerCase());
  return (
    <Stack gap={3}>
      <Tabs<WatchSource> variant="segment" size="s" items={WATCH_SOURCES} value={source} onChange={onSource} aria-label="Источник состояния" />
      <Input iconLeft={<Search size={16} />} placeholder="фильтр по дереву…" value={filter} onChange={(e) => onFilter(e.target.value)} fullWidth />
      {pruned.length ? (
        <Tree nodes={toTreeNodes(pruned)} guides density="compact" />
      ) : (
        <PanelEmpty text="Нет данных — запустите пакет и начните отвечать." />
      )}
    </Stack>
  );
}

function LmsPanel({ snap }: { snap: InspectorSnapshot }) {
  if (!snap.lmsRows.length) return <PanelEmpty text="События обмена с LMS появятся здесь после запуска пакета." />;
  // Per the wireframe: a structured RTE-call table + a raw-traffic disclosure.
  const columns: TableColumn<LmsRow>[] = [
    { key: "call", header: "Вызов", width: "92px", render: (r) => <Tag size="s" variant="outline">{r.call}</Tag> },
    { key: "key", header: "Ключ", render: (r) => (r.key ? <Text variant="body-s" className="dbg__path">{r.key}</Text> : <Text tone="muted">—</Text>) },
    { key: "value", header: "Значение", render: (r) => <Text variant="body-s" className="dbg__path">{r.value}</Text> },
  ];
  return (
    <Stack gap={3}>
      <Table columns={columns} rows={snap.lmsRows} rowKey={(r) => String(r.idx)} />
      <details className="dbg__rawlog-wrap">
        <summary className="dbg__rawlog-summary">Сырые вызовы RTE (GetValue / SetValue)</summary>
        <pre className="dbg__rawlog">{snap.lmsRawLog}</pre>
      </details>
    </Stack>
  );
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
