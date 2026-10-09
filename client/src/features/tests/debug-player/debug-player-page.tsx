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
  Banner, Box, Button, Cluster, EmptyState, Fab, IconButton, Input, ProgressBar, Select, Stack, Switch, Table, Tabs, Tag, Text, Tree,
  type TableColumn, type TreeNodeData,
} from "@skillum/ui-kit";
import {
  BugPlay, Info, RefreshCw, RotateCcw, X, ChevronLeft, ChevronRight, Download, Search,
  CircleDot, CheckSquare, Unplug, ListOrdered, ThermometerSun, SlidersHorizontal, List, Layers, ChevronDown, ChevronUp,
} from "lucide-react";
import { useDebugSession } from "./use-debug-session";
import {
  buildSnapshot, protocolToCsv,
  type InspectorSnapshot, type ProtocolRow, type ScaleRow, type ResultRow, type WatchSource,
  type ScoreVM, type DrawSectionVM, type AdaptiveBar, type AdaptivePathTopic, type AdaptivePathStep,
  type LmsRow, type WatchNode,
} from "./inspector-snapshot";
import {
  ScorePanel, ProtocolPanel, PanelEmpty, QuestionLabel, ScoreAdaptivePanel,
} from "../run-inspector/panels";
import { ReviewPanel } from "../review/review-panel";
import { useScreenAnchor } from "../review/use-screen-anchor";
import { QuestionEditorDrawer } from "@/features/questions/question-editor-drawer";
import { useQuery } from "@tanstack/react-query";
import type { Question, Topic } from "@shared/schema";
import { describeFeasibilityState } from "@/features/content-protection/issue-text";
import "./debug-player.css";

type TabId = "review" | "score" | "protocol" | "draw" | "scales" | "results" | "state" | "lms";

const TABS: { id: TabId; label: string }[] = [
  // PRD-52: комментарии рецензентов видит и автор — в том же прогоне, где он их
  // проверяет. Первой вкладку не ставим: у автора отладчик прежде всего про
  // математику теста, а комментарии — то, ради чего он сюда вернулся.
  { id: "review", label: "Комментарии" },
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
  const inspectorRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<TabId>("score");
  const [collapsed, setCollapsed] = useState(false);
  const [watchSource, setWatchSource] = useState<WatchSource>("state");
  const [watchFilter, setWatchFilter] = useState("");
  const [reference, setReference] = useState(false);
  // PRD-52: тот же режим полной выдачи, что у рецензента. Автору он нужен по той же
  // причине — просмотреть банк темы целиком, а не ту выборку, что выпала прогону.
  const [fullDraw, setFullDraw] = useState(false);
  // PRD-52 FR-30: правка по комментарию не перезагружает стейдж — прогон остаётся на
  // том же вопросе, — но и в пакет она не попадает. Молчать об этом нельзя: автор
  // решит, что правка не сработала.
  const [pendingRebuild, setPendingRebuild] = useState(false);
  // PRD-52 FR-28: правка по комментарию открывается ящиком ПОВЕРХ окна. Стейдж при
  // этом не перезагружается, поэтому после закрытия ящика прогон стоит на том же
  // вопросе, а место в списке комментариев не теряется.
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const questionsQuery = useQuery<Question[]>({ queryKey: ["/api/questions"], enabled: Boolean(editingQuestionId) });
  const topicsQuery = useQuery<Topic[]>({ queryKey: ["/api/topics"], enabled: Boolean(editingQuestionId) });
  const editingQuestion = editingQuestionId
    ? (questionsQuery.data ?? []).find((q) => q.id === editingQuestionId) ?? null
    : null;
  const [snap, setSnap] = useState<InspectorSnapshot>(EMPTY);
  // PRD-18: per-topic pinned variants { topicId: formId } for variants-mode sections.
  // Empty on mount (a fresh window starts unpinned). Passed to the stage as a
  // launch-URL hash so the runtime delivers exactly the pinned form (tbDebugForcedForms
  // in app.js). Survives «Сброс»/«Пересобрать» (it is page state). Editable only before
  // start; changing a pin resets the run so the new variant is drawn from a clean slate.
  const [pins, setPins] = useState<Record<string, string>>({});
  const setPin = (topicId: string, formId: string | null) => {
    setPins((prev) => {
      const next = { ...prev };
      if (formId) next[topicId] = formId;
      else delete next[topicId];
      return next;
    });
    reset();
  };

  // Standalone window/tab title.
  useEffect(() => {
    document.title = state.title ? `Отладка теста · ${state.title}` : "Отладка теста";
  }, [state.title]);

  // Real-time loop: every 600ms re-read the live package + RTE off the windows,
  // and (re)paint the «Эталон» overlay onto the live question render when enabled.
  useEffect(() => {
    // Not running yet (building / error): blank the snapshot so the inspector
    // shows its empty states instead of stale data from the previous run.
    if (state.status !== "ready") { setSnap(EMPTY); return; }
    const tick = () => {
      const win = iframeRef.current?.contentWindow ?? null;
      setSnap(buildSnapshot(win, window.__scorm ?? null, { protocolMode: "live", watchSource }));
      if (window.TBInspector) {
        if (reference) window.TBInspector.applyReference(win);
        else window.TBInspector.clearReference(win);
        window.TBInspector.guardFinishButton(win);
      }
    };
    tick();
    const h = window.setInterval(tick, 600);
    return () => window.clearInterval(h);
  }, [state.status, watchSource, runKey, reference]);

  // Align the round collapse toggle's vertical centre to the underline LINE below
  // the tabs (the wireframe's alignToggle) — so it sits on the tab row's baseline
  // and never overlaps the ‹ scroll arrow. Re-run on tab/collapse/size changes.
  useEffect(() => {
    const insp = inspectorRef.current;
    if (!insp) return;
    const align = () => {
      const tabs = insp.querySelector(".ou-tabs") as HTMLElement | null;
      const fab = insp.querySelector(".dbg__collapse") as HTMLElement | null;
      if (!tabs || !fab) return;
      const tr = tabs.getBoundingClientRect();
      if (tr.height === 0) return; // collapsed — no tabs, leave the toggle where it is
      const ir = insp.getBoundingClientRect();
      fab.style.top = Math.round(tr.bottom - ir.top - fab.offsetHeight / 2) + "px";
    };
    align();
    window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
  }, [collapsed, tab, state.status]);

  if (state.status === "forbidden") {
    return (
      <div className="dbg__center">
        <EmptyState
          art={<BugPlay size={48} color="var(--ou-fg-muted)" />}
          title="Нет доступа к отладке теста"
          description="Прогон отладки доступен только при праве на редактирование теста (как и экспорт SCORM)."
        />
      </div>
    );
  }

  // Build (loading) and build-error keep the player chrome mounted and show an
  // overlay OVER the stage (wireframe: progress над стейджем, действия недоступны)
  // — so «Пересобрать» never blanks the inspector/toolbar.
  const building = state.status === "loading";
  const errored = state.status === "error";
  const openEditor = () => window.open(`/author/tests?edit=${testId}`, "_blank", "noopener");
  // Variant pins ride on the stage launch-URL hash; the runtime reads `#tbff=` at draw time.
  const pinHash = Object.keys(pins).length ? "#tbff=" + encodeURIComponent(JSON.stringify(pins)) : "";
  // Полная выдача едет тем же хешем; оба флага уживаются в одной строке.
  const drawHash = fullDraw ? (pinHash ? pinHash + "&tbfa=1" : "#tbfa=1") : pinHash;
  // Выдача фиксируется на первом вопросе — дальше режим не переключить.
  // Место комментария — вопрос текущего экрана прогона (PRD-52 FR-18).
  const screenAnchor = useScreenAnchor(iframeRef, snap);
  const drawStarted = Boolean(snap.draw?.started);
  const stageSrc = state.playUrl ? state.playUrl + drawHash : undefined;

  return (
    <div className={collapsed ? "dbg is-collapsed" : "dbg"}>
      <header className="dbg__bar">
        <span className="dbg__title">
          <BugPlay size={18} />
          <Text weight="bold">{state.title || "Отладка теста"}</Text>
          <span className="dbg__sub">черновик</span>
          <IconButton variant="ghost" size="s" aria-label="О прогоне отладки" title={DISCLAIMER + (state.template ? ` Шаблон оформления: ${state.template}.` : "")} icon={<Info size={14} />} />
        </span>
        <span className="dbg__bar-spacer" />
        <Button
          variant={pendingRebuild ? "primary" : "secondary"}
          size="s"
          leadingIcon={<RefreshCw size={14} />}
          onClick={() => { setPendingRebuild(false); rebuild(); }}
          disabled={building}
          title={pendingRebuild
            ? "Собрать пакет заново с учётом правок — прогон начнётся сначала"
            : "Собрать пакет заново из текущего состояния теста"}
        >
          Пересобрать
        </Button>
        <Button variant="ghost" size="s" leadingIcon={<RotateCcw size={14} />} onClick={reset} data-testid="btn-reset" disabled={state.status !== "ready"}>
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
          {pendingRebuild ? (
            <Banner
              tone="warning"
              title="Сохранено. В текущем прогоне изменения не видны"
              data-testid="rebuild-banner"
            >
              Чтобы прогон учитывал правку, нужна пересборка пакета — она начнёт прохождение сначала.
            </Banner>
          ) : null}
          <StatusBar snap={snap} />
          <div className="dbg__canvas">
            <div className="dbg__frame">
              <div className="dbg__ribbon">
                <span>SCORM-пакет{state.template ? ` · шаблон «${state.template}»` : ""}</span>
                {/*
                  Распорка, как в эскизе (`docs/wireframes/approved/prd52-review-player.html`,
                  `.wf-frame-ribbon .spacer`) и как на экране рецензирования: тумблеры стоят
                  ПАРОЙ у правого края. Без неё `justify-content: space-between` растаскивал
                  три элемента риббона по всей ширине, и «Эталон» повисал посередине.
                */}
                <span className="dbg__bar-spacer" />
                <label className="dbg__ref-toggle" title="Подсветить правильные ответы (debug; на баллы не влияет)">
                  <span className="dbg__ref-lbl">Эталон</span>
                  <Switch
                    checked={reference}
                    onChange={(e) => setReference(e.target.checked)}
                    aria-label="Показать эталон"
                    data-testid="toggle-reference"
                  />
                </label>
                <label
                  className="dbg__ref-toggle"
                  title={drawStarted
                    ? "Выдача уже зафиксирована: режим переключается до первого вопроса"
                    : "Выдать весь банк темы вместо настроенной выборки"}
                >
                  <span className="dbg__ref-lbl">Все вопросы темы</span>
                  <Switch
                    checked={fullDraw}
                    onChange={(e) => { setFullDraw(e.target.checked); reset(); }}
                    disabled={drawStarted}
                    aria-label="Все вопросы темы"
                    data-testid="toggle-full-draw"
                  />
                </label>
              </div>
              <div className="dbg__frame-screen">
                {stageSrc ? (
                  <iframe key={runKey} ref={iframeRef} className="dbg__iframe" title="Прогон отладки" src={stageSrc} />
                ) : null}
              </div>
            </div>
            {building ? (
              <div className="dbg__overlay">
                <ProgressBar value={0} size="m" indeterminate hideHeader />
                <span className="dbg__overlay-text">Собираем пакет из живого состояния теста…</span>
              </div>
            ) : null}
            {/*
              PRD-15 FR-05: состав тем не даёт выдать вопросы. Не поверх сцены и не
              вместо неё — прогон запускается, — но автор видит причину заранее, а не
              гадает над «Вопрос 1 из 0» с молчащим экраном.
            */}
            {!building && !errored && (state.feasibility?.length ?? 0) > 0 ? (
              <div className="dbg__notice">
                <Banner
                  tone="warning"
                  title="Выдать вопросы по этому составу нельзя — прогон встанет"
                  description={(state.feasibility ?? [])
                    .map((f) => `${f.topicName}: ${f.issues.map(describeFeasibilityState).join("; ")}`)
                    .join(". ")}
                  actions={[{ label: "Открыть тест в редакторе", onClick: openEditor }]}
                  data-testid="debug-player-feasibility"
                />
              </div>
            ) : null}
            {errored ? (
              <div className="dbg__overlay">
                <Banner
                  tone="error"
                  title="Не удалось собрать пакет"
                  description={state.error || "Неизвестная ошибка сборки пакета."}
                  actions={[{ label: "Открыть тест в редакторе", onClick: openEditor }]}
                />
              </div>
            ) : null}
          </div>
        </section>

        <aside className="dbg__inspector" ref={inspectorRef}>
          <Fab
            className="dbg__collapse"
            size="s"
            variant="neutral"
            aria-label="Свернуть или развернуть инспектор"
            title="Свернуть или развернуть инспектор"
            icon={<ChevronRight size={16} />}
            onClick={() => setCollapsed((c) => !c)}
          />
          <div className="dbg__ins-main">
            <TabHead tab={tab} onTab={setTab} />
            <div className="dbg__ins-body">
              {tab === "review" && (
                <ReviewPanel
                  testId={testId}
                  mode="player"
                  canResolve
                  screenAnchor={screenAnchor}
                  onNavigate={(target) => {
                    if (target.target === "question-editor") setEditingQuestionId(target.questionId);
                    else openEditor();
                  }}
                />
              )}
              {tab === "score" && <ScorePanel snap={snap} />}
              {tab === "protocol" && <ProtocolPanel snap={snap} />}
              {tab === "draw" && <DrawPanel snap={snap} pins={pins} onPin={setPin} />}
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

        {/* Монтируется ТОЛЬКО открытым: редактор вопроса тянет за собой контекст
            авторизации и охрану контента — держать его в окне весь прогон значит
            платить за то, что почти всегда не нужно. */}
        {editingQuestionId ? (
          <QuestionEditorDrawer
            open={Boolean(editingQuestion)}
            question={editingQuestion}
            topics={topicsQuery.data ?? []}
            onClose={() => setEditingQuestionId(null)}
            onSaved={() => {
              // Пакет собран ДО правки: пока его не пересобрать, прогон её не увидит.
              setPendingRebuild(true);
              setEditingQuestionId(null);
            }}
          />
        ) : null}
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

  // Click a half-hidden tab → scroll it FULLY into view and peek the neighbour
  // halfway (wireframe scrollTabIntoView). Only runs when the lane overflows.
  useEffect(() => {
    const el = list();
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;
    const active = el.querySelector('.ou-tabs__tab[aria-selected="true"]') as HTMLElement | null;
    if (!active) return;
    const lr = el.getBoundingClientRect();
    const tr = active.getBoundingClientRect();
    const tabs = Array.from(el.querySelectorAll(".ou-tabs__tab")) as HTMLElement[];
    const idx = tabs.indexOf(active);
    const max = el.scrollWidth - el.clientWidth;
    let target: number | null = null;
    if (tr.right > lr.right - 1) {
      const next = tabs[idx + 1];
      target = el.scrollLeft + (tr.right - lr.right) + (next ? next.getBoundingClientRect().width / 2 : 24);
    } else if (tr.left < lr.left + 1) {
      const prev = tabs[idx - 1];
      target = el.scrollLeft - (lr.left - tr.left) - (prev ? prev.getBoundingClientRect().width / 2 : 24);
    }
    if (target == null) return;
    el.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: "smooth" });
    const t = window.setTimeout(measure, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
  return (
    <div className="dbg__status">
      <div className="dbg__status-left">
        <ProgressLane snap={snap} />
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
                {s.completed
                  ? <Tag tone={sc.passed ? "success" : "error"} size="s">{sc.passed ? "Пройден" : "Не пройден"}</Tag>
                  : <Tag tone="accent" variant="outline" size="s">в процессе</Tag>}
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
              <span className="dbg__stat-lbl">Не рассчитано</span>
              <span className="dbg__stat-val"><Tag tone="error" size="s">{s.alarm}</Tag></span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * PRD-36 FR-17: занятая доля бюджета `cmi.suspend_data`. Переполнение состояния проявляется
 * молча — LMS обрезает строку, и разом теряются счётчик попыток, таймер и оба барьера, — поэтому
 * запас показывается ДО того, как он кончится, а не диагностируется по последствиям.
 *
 * МЕСТО — ВКЛАДКА «LMS», а не статусная панель. Панель по эскизу несёт методологический
 * минимум — прогресс, оценку и алярм расчёта, — а всё, что относится к обмену с LMS
 * (`completion_status`, `entry`, длина `suspend_data`), эскиз прямо отправляет в LMS-журнал:
 * «плумбинг, не зона методолога». Показатель приехал из PRD-36 позже плеера и осел на панели
 * не по правилу, а по месту, где было свободно.
 */
function RunStateStat({ run }: { run: InspectorSnapshot["runState"] }) {
  const percent = Math.round(run.share * 100);
  const tone = run.share >= 1 ? "error" : run.share >= 0.8 ? "warning" : "success";
  return (
    <div className="dbg__stat dbg__stat--inline">
      <span className="dbg__stat-lbl">Состояние прогона · suspend_data</span>
      <span className="dbg__stat-val">
        <span className="dbg__stat-num">{`${run.length} из ${run.budget}`}</span>
        <Tag tone={tone} size="s">{`${percent}% бюджета`}</Tag>
        {run.version === 1 ? <Tag variant="soft" size="s">формат 1</Tag> : null}
      </span>
    </div>
  );
}

// Mode-aware progress lane (FR-19): flat «вопрос i из N», sectioned «разделы» with
// %/✓/✗, or the adaptive «уровни по темам» lane — picked from the snapshot.
function ProgressLane({ snap }: { snap: InspectorSnapshot }) {
  const sc = snap.score;
  const bar = snap.adaptive;
  if (sc.adaptive && bar.visible && bar.topicLevels && bar.topicLevels.length) {
    return <AdaptiveProgressLane levels={bar.topicLevels} />;
  }
  if (!sc.adaptive && sc.sectioned && sc.sections && sc.sections.length) {
    return <SectionProgressLane sections={sc.sections} completed={snap.status.completed} />;
  }
  return <FlatProgressLane snap={snap} />;
}

function FlatProgressLane({ snap }: { snap: InspectorSnapshot }) {
  const s = snap.status;
  const currentTopic = snap.protocol.rows.length ? snap.protocol.rows[snap.protocol.rows.length - 1].topicName : "";
  return (
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
  );
}

function SectionProgressLane({ sections, completed }: { sections: NonNullable<ScoreVM["sections"]>; completed: boolean }) {
  return (
    <div className="dbg__stat">
      <span className="dbg__stat-lbl">Прогресс · разделы</span>
      <span className="dbg__stat-val">
        {sections.map((sec, i) => {
          // A section shows ✓/✗ once IT is completed OR the whole run finished;
          // until then «в процессе» (no premature red ✗ on an unattempted 0%). N9.
          const done = sec.completed || completed;
          return !done || sec.passed == null ? (
            <Tag key={i} size="s" tone="accent" variant="outline">{`${sec.topicName} — в процессе`}</Tag>
          ) : (
            <Tag key={i} size="s" tone={sec.passed ? "success" : "error"}>
              {`${sec.topicName} — ${sec.percent}% ${sec.passed ? "✓" : "✗"}`}
            </Tag>
          );
        })}
      </span>
    </div>
  );
}

// Adaptive «уровни по темам» lane. At scale («много тем») confirmed topics collapse
// behind a «+N подтверждено» toggle and the pending tail folds to «осталось K»,
// expanding inline — matching the wireframe.
function AdaptiveProgressLane({ levels }: { levels: NonNullable<AdaptiveBar["topicLevels"]> }) {
  const [expanded, setExpanded] = useState(false);
  const confirmed = levels.filter((l) => l.status === "confirmed");
  const failed = levels.filter((l) => l.status === "failed");
  const running = levels.filter((l) => l.status === "running");
  const pending = levels.filter((l) => l.status === "pending");
  const scale = levels.length > 6;
  const headConfirmed = scale && !expanded ? confirmed.slice(0, 2) : confirmed;
  const hiddenConfirmed = confirmed.length - headConfirmed.length;
  const showPending = !scale || expanded;
  return (
    <div className="dbg__stat">
      <span className="dbg__stat-lbl">Прогресс · адаптив — уровни по темам</span>
      <span className="dbg__stat-val">
        {headConfirmed.map((l, i) => (
          <Tag key={`c${i}`} size="s" tone="success">{`${l.topicName} — ${l.levelName ?? ""} ✓`}</Tag>
        ))}
        {failed.map((l, i) => (
          <Tag key={`f${i}`} size="s" tone="error">{`${l.topicName} — не подтверждён`}</Tag>
        ))}
        {hiddenConfirmed > 0 ? (
          <Button size="xs" variant="secondary" trailingIcon={<ChevronDown size={12} />} onClick={() => setExpanded(true)}>{`+${hiddenConfirmed} подтверждено`}</Button>
        ) : null}
        {scale && expanded ? (
          <Button size="xs" variant="secondary" trailingIcon={<ChevronUp size={12} />} onClick={() => setExpanded(false)}>свернуть</Button>
        ) : null}
        {running.map((l, i) => (
          <Tag key={`r${i}`} size="s" tone="accent" variant="outline">{`${l.topicName} — ${l.levelName ?? ""} · идёт`}</Tag>
        ))}
        {showPending
          ? pending.map((l, i) => (
              <Tag key={`p${i}`} size="s" variant="outline">{`${l.topicName} — не начато`}</Tag>
            ))
          : pending.length
            ? <Tag size="s" variant="outline">{`осталось ${pending.length}`}</Tag>
            : null}
      </span>
    </div>
  );
}

// ─── Inspector panels ────────────────────────────────────────────────────────────

/** Подпись режима выдачи темы на вкладке «Выдача» (только у автора). */
function drawModeLabel(s: DrawSectionVM): string {
  return s.mode === "variants" ? "режим вариантов" : s.mode === "quota" ? "тег-квоты (план vs факт)" : s.mode === "draw" ? "случайная выборка" : "все вопросы";
}

const TYPE_SHORT: Record<string, string> = {
  single: "одиночный", multiple: "множественный", matching: "сопоставление", ranking: "ранжирование",
};

function byTypeSummary(s: DrawSectionVM): string | null {
  if (!s.byType.length) return null;
  return "По типам: " + s.byType.map((t) => `${TYPE_SHORT[t.type] ?? t.typeLabel} ${t.count}`).join(" · ");
}

function QuestionRow({ q, showTopic }: { q: DrawSectionVM["questions"][number]; showTopic?: boolean }) {
  return (
    <div className="dbg__q-row">
      <QuestionLabel type={q.type} prompt={q.prompt} topic={showTopic ? q.topicName : undefined} />
      {q.delivered
        ? <Tag size="s" tone="success">выдан</Tag>
        : <Tag size="s" variant="outline">не выдан</Tag>}
    </div>
  );
}

// Collapsible question list with the per-question delivery status (N3). In flat flow
// the combined list shows each question's topic (showTopic) since it spans topics.
function QuestionDisclosure({ title, items, showTopic }: { title: string; items: DrawSectionVM["questions"]; showTopic?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <Stack gap={1}>
      <button type="button" className="dbg__disclosure" aria-label={open ? "Свернуть вопросы" : "Развернуть вопросы"} onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={14} className={open ? "dbg__disclosure-chevron is-open" : "dbg__disclosure-chevron"} />
        {title}
      </button>
      {open ? <Stack gap={1}>{items.map((q, i) => <QuestionRow key={i} q={q} showTopic={showTopic} />)}</Stack> : null}
    </Stack>
  );
}

// PRD-18: per-topic variant pin (variants mode only). «Случайно» (value "") = the
// normal random draw; a form id pins that exact variant. Locked once the run started
// (all variants are fixed at draw time) — the methodologist unlocks it via «Сброс».
function VariantPinControl({
  s, pin, started, onPin,
}: {
  s: DrawSectionVM;
  pin: string;
  started: boolean;
  onPin?: (topicId: string, formId: string | null) => void;
}) {
  const options = [
    { value: "", label: "Случайно (по умолчанию)" },
    ...s.forms.map((f) => ({ value: f.id, label: f.label })),
  ];
  return (
    <Stack gap={1}>
      <Cluster gap={2}>
        <Text variant="body-s" tone="muted">Выдать вариант</Text>
        <Select<string>
          size="s"
          value={pin}
          disabled={started}
          options={options}
          onChange={(v) => onPin?.(s.topicId, v || null)}
          aria-label={`Выдать вариант — тема «${s.topicName}»`}
          data-testid={`variant-pin-${s.topicId}`}
        />
      </Cluster>
      <Text variant="caption" tone="muted">
        {started
          ? "После старта прогона выбор зафиксирован — «Сброс» вернёт настройку."
          : "Применяется при старте прогона. «Случайно» — обычная случайная выдача."}
      </Text>
    </Stack>
  );
}

function DrawSection({
  s, showQuestions, pin, started, onPin,
}: {
  s: DrawSectionVM;
  showQuestions: boolean;
  pin?: string;
  started?: boolean;
  onPin?: (topicId: string, formId: string | null) => void;
}) {
  const types = byTypeSummary(s);
  return (
    <Box className="dbg__draw-section">
      <div className="dbg__ins-h">
        {s.mode === "quota" ? <Layers size={14} /> : <List size={14} />}
        {`Тема «${s.topicName}» — ${drawModeLabel(s)}`}
      </div>
      {s.mode === "variants" && s.forms.length ? (
        <VariantPinControl s={s} pin={pin ?? ""} started={!!started} onPin={onPin} />
      ) : null}
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
      {s.mode !== "variants" ? <div className="dbg__sum"><span>{`${s.count} вопросов из банка ${s.bankSize}`}</span></div> : null}
      {showQuestions ? <QuestionDisclosure title={`Вопросы — выдано ${s.delivered} из ${s.count}`} items={s.questions} /> : null}
    </Box>
  );
}

function DrawPanel({
  snap, pins, onPin,
}: {
  snap: InspectorSnapshot;
  pins: Record<string, string>;
  onPin: (topicId: string, formId: string | null) => void;
}) {
  const d = snap.draw;
  if (!d.available) return <PanelEmpty text="Запустите пакет — здесь появится состав выдачи этого прогона." />;
  if (d.adaptive) return <DrawAdaptivePanel path={d.path} />;
  const secs = d.sections ?? [];
  const flat = d.flat ?? true;
  const started = !!d.started;
  const total = secs.reduce((a, s) => a + s.count, 0);
  const delivered = secs.reduce((a, s) => a + s.delivered, 0);
  // «По темам»: each topic expands into its own questions. Flat: topic summaries
  // + one combined «Вопросы» list in delivery order.
  // Attach each question's topic from its section (always present) so the combined
  // flat list shows it without depending on the server compute version (N11).
  const allQuestions = secs
    .flatMap((s) => s.questions.map((q) => ({ ...q, topicName: s.topicName })))
    .sort((a, b) => a.idx - b.idx);
  return (
    <Stack gap={3}>
      {secs.map((s, i) => (
        <DrawSection key={i} s={s} showQuestions={!flat} pin={pins[s.topicId] ?? ""} started={started} onPin={onPin} />
      ))}
      {flat ? (
        <Box className="dbg__draw-section">
          <div className="dbg__ins-h"><List size={14} />Состав выдачи</div>
          <QuestionDisclosure title={`Вопросы — выдано ${delivered} из ${total}`} items={allQuestions} showTopic />
        </Box>
      ) : null}
      <div className="dbg__sum"><span>Итого выдано <strong>{`${delivered} из ${total}`}</strong></span></div>
    </Stack>
  );
}

function ScalesPanel({ snap }: { snap: InspectorSnapshot }) {
  if (!snap.scales.length) {
    return <PanelEmpty text={snap.hasData ? "В тесте нет шкал." : "Запустите пакет. Значения шкал считаются вживую по ответам."} />;
  }
  // Шкала · Значение (raw, абсолютный набранный балл) · Уровень (интерпретационный
  // диапазон `bands`). Процент не показываем — на верном прогоне он всегда 100% и
  // несёт лишь визуальный шум; для формул показателей `scale.*.percent` он остаётся
  // в движке. Публикация в LMS — во вкладке «LMS».
  const columns: TableColumn<ScaleRow>[] = [
    { key: "key", header: "Шкала", render: (r) => r.key },
    { key: "raw", header: "Значение", width: "120px", render: (r) => (r.raw == null ? "—" : String(r.raw)) },
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
  // No folder icon — the chevron (driven by hasChildren) is enough (N5).
  return nodes.map((n) => ({
    id: n.id,
    label: n.label,
    meta: <Text variant="caption" tone="muted" className="dbg__path">{n.meta}</Text>,
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

/** Pretty-print a JSON payload (suspend_data) for the expanded full-width row. */
function formatPayload(value: string): string {
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}
function byteSize(value: string): string {
  const bytes = new Blob([value]).size;
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} КБ` : `${bytes} Б`;
}

// Raw RTE traffic disclosure — lucide chevron, not the native <details> marker (N10).
function RawLogDisclosure({ log }: { log: string }) {
  const [open, setOpen] = useState(false);
  // One call per line, truncated to a single readable line (full text on hover) —
  // instead of a wrapping wall of inline JSON.
  const lines = !log || log === "—" ? [] : log.split("\n");
  return (
    <Stack gap={1}>
      <button type="button" className="dbg__disclosure" aria-label={open ? "Свернуть сырые вызовы" : "Развернуть сырые вызовы"} onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={14} className={open ? "dbg__disclosure-chevron is-open" : "dbg__disclosure-chevron"} />
        Сырые вызовы RTE (GetValue / SetValue)
      </button>
      {open ? (
        <div className="dbg__rawlog">
          {lines.map((ln, i) => <div key={i} className="dbg__rte-line" title={ln}>{ln}</div>)}
        </div>
      ) : null}
    </Stack>
  );
}

function LmsPanel({ snap }: { snap: InspectorSnapshot }) {
  // A long value (suspend_data) keeps its «N КБ» toggle in the row; the full
  // formatted payload expands as a SEPARATE full-width row below it (DS Table
  // renderExpanded ≈ the wireframe's wf-payload-row colspan), not in the column.
  const [expanded, setExpanded] = useState<string[]>([]);
  if (!snap.lmsRows.length) return <PanelEmpty text="События обмена с LMS появятся здесь после запуска пакета." />;
  const toggle = (key: string) =>
    setExpanded((xs) => (xs.includes(key) ? xs.filter((x) => x !== key) : [...xs, key]));
  const isLong = (r: LmsRow) => !r.marker && r.value.length > 80;
  const columns: TableColumn<LmsRow>[] = [
    {
      // Session markers (Initialize/Terminate/Commit) get a chip; plain Set rows don't.
      key: "call", header: "Вызов", width: "92px",
      render: (r) => (r.marker ? <Tag size="s" variant="outline">{r.call}</Tag> : <Text variant="body-s">{r.call}</Text>),
    },
    { key: "key", header: "Ключ", width: "190px", render: (r) => (r.key ? <Text variant="body-s" className="dbg__path">{r.key}</Text> : <Text tone="muted">—</Text>) },
    {
      key: "value", header: "Значение",
      render: (r) => {
        if (r.marker) return <Text variant="body-s" className="dbg__path">{r.value}</Text>;
        if (isLong(r)) {
          const open = expanded.includes(String(r.idx));
          return (
            <button type="button" className="dbg__disclosure" aria-label={open ? "Свернуть данные" : "Развернуть данные"} onClick={() => toggle(String(r.idx))}>
              <ChevronRight size={14} className={open ? "dbg__disclosure-chevron is-open" : "dbg__disclosure-chevron"} />
              {byteSize(r.value)}
            </button>
          );
        }
        // Short scalar Set value → kbd chip (matches the wireframe).
        return <code className="ou-kbd">{r.value}</code>;
      },
    },
  ];
  return (
    <Stack gap={3}>
      {/* Запас состояния — над журналом: он про ту же строку `suspend_data`, что журнал
          пишет, и читается как её итог, а не как отдельная метрика прогона. */}
      <RunStateStat run={snap.runState} />
      <Table
        columns={columns}
        rows={snap.lmsRows}
        rowKey={(r) => String(r.idx)}
        expandedKeys={expanded}
        renderExpanded={(r) => <pre className="dbg__payload-body">{formatPayload(r.value)}</pre>}
      />
      <RawLogDisclosure log={snap.lmsRawLog} />
    </Stack>
  );
}

function DrawAdaptivePanel({ path }: { path?: AdaptivePathTopic[] }) {
  const topics = path ?? [];
  if (!topics.length) return <PanelEmpty text="Адаптивный тест — путь по уровням появится по мере прохождения тем." />;
  const columns: TableColumn<AdaptivePathStep>[] = [
    { key: "step", header: "Шаг", width: "52px", render: (s) => s.step },
    { key: "level", header: "Уровень", render: (s) => s.levelName },
    { key: "answer", header: "Ответ", width: "88px", render: (s) => s.answer },
    { key: "trans", header: "Переход", render: (s) => s.transition },
  ];
  return (
    <Stack gap={3}>
      {topics.map((t, i) => (
        <Box key={i} className="dbg__draw-section">
          <div className="dbg__ins-h">
            <Layers size={14} />
            {t.status === "confirmed"
              ? `Тема «${t.topicName}» — подтверждён уровень ${t.confirmedLevelName ?? ""}`
              : t.status === "running"
                ? `Тема «${t.topicName}» — идёт (текущий: ${t.currentLevelName ?? ""}${t.currentArrow ? ` ${t.currentArrow}` : ""})`
                : `Тема «${t.topicName}» — не подтверждён`}
          </div>
          <Table columns={columns} rows={t.steps} rowKey={(s) => String(s.step)} />
        </Box>
      ))}
    </Stack>
  );
}
