/**
 * @module pages/review/review-player-page
 * @description PRD-52 — окно рецензента (`/review/tests/:testId`).
 *
 * То же окно, что отладчик автора, с урезанным до трёх вкладок инспектором:
 * «Комментарии», «Результаты», «Протокол». «Выдача», «Шкалы», «Показатели»,
 * «Состояние» и «LMS» рецензенту не показываются — это машинерия рантайма, и
 * человека, пришедшего вычитать формулировки, она только уводит в сторону.
 *
 * Прогон одноразовый: попытка не создаётся, телеметрия выключена, следа в аналитике
 * нет. Два режимных тумблера живут в риббоне стейджа, потому что оба про то, ЧТО
 * показано на сцене: «Эталон» (подсветка верных ответов) и «Все вопросы темы»
 * (полная выдача вместо настроенной выборки).
 */
import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { Banner, Box, Button, Cluster, EmptyState, Stack, Switch, Tabs, Tag, Text } from "@skillum/ui-kit";
import { MessageSquare, RotateCcw, Info, Lock } from "lucide-react";
import { useDebugSession } from "@/features/tests/debug-player/use-debug-session";
import { buildSnapshot, type InspectorSnapshot } from "@/features/tests/debug-player/inspector-snapshot";
import { ScorePanel, ProtocolPanel, PanelEmpty } from "@/features/tests/run-inspector/panels";
import { ReviewPanel } from "@/features/tests/review/review-panel";
import { useScreenAnchor } from "@/features/tests/review/use-screen-anchor";
import "@/features/tests/debug-player/debug-player.css";

type ReviewTabId = "comments" | "score" | "protocol";

const TABS: { id: ReviewTabId; label: string }[] = [
  { id: "comments", label: "Комментарии" },
  { id: "score", label: "Результаты" },
  { id: "protocol", label: "Протокол" },
];

/** Как часто пересобирается снимок инспектора из живого рантайма пакета. */
const TICK_MS = 600;

export default function ReviewPlayerPage() {
  const params = useParams<{ testId: string }>();
  const testId = params.testId!;
  const { state, runKey, reset } = useDebugSession(testId, "review");
  const [tab, setTab] = useState<ReviewTabId>("comments");
  const [snap, setSnap] = useState<InspectorSnapshot | null>(null);
  const [reference, setReference] = useState(false);
  const [fullDraw, setFullDraw] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Место комментария — текущий экран прогона; тот же резолвер, что рисует эталон.
  const screenAnchor = useScreenAnchor(frameRef, snap);

  // Снимок инспектора снимается по тику с ЖИВОГО рантайма пакета: подписаться не на
  // что — пакет ничего не публикует наружу, кроме своих глобалей. Тем же тиком
  // перерисовывается «Эталон» — оверлей поверх реального рендера вопроса (на баллы
  // не влияет). Именно ПО ТИКУ, а не по смене экрана: пакет строит разметку вопроса
  // заново на каждом переходе и уносит с ней подсветку, а снаружи об этом узнать
  // неоткуда — счётчик выданных вопросов при переходе не меняется. Повторное
  // наложение дёшево и само по себе идемпотентно (`applyReference` начинает со
  // сброса и стоит на месте, пока идёт перетаскивание).
  useEffect(() => {
    if (state.status !== "ready") return;
    const tick = () => {
      const win = frameRef.current?.contentWindow;
      if (!win) return;
      try {
        setSnap(buildSnapshot(win, window.__scorm ?? null, { protocolMode: "live", watchSource: "state" }));
      } catch {
        // Кадр ещё не готов или сменил документ — следующий тик снимет заново.
      }
      try {
        const inspector = window.TBInspector;
        if (reference) inspector?.applyReference?.(win);
        else inspector?.clearReference?.(win);
      } catch {
        // Рендер вопроса ещё не построен — тумблер применится на следующем тике.
      }
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [state.status, runKey, reference]);

  if (state.status === "loading") {
    return <Box className="dbg dbg--center"><Text tone="muted">Собираем прогон…</Text></Box>;
  }

  if (state.status === "forbidden") {
    return (
      <Box className="dbg dbg--center">
        <EmptyState
          tone="warn"
          art={<Lock size={28} />}
          title="Нет доступа к рецензированию"
          description="Ссылка отозвана, истёк её срок или доступ к этому тесту больше не выдан. Обратитесь к автору теста — он выпустит ссылку заново."
        />
      </Box>
    );
  }

  if (state.status === "error") {
    return (
      <Box className="dbg dbg--center">
        <EmptyState
          tone="error"
          title="Не удалось открыть прогон"
          description={state.error ?? "Попробуйте обновить страницу."}
        />
      </Box>
    );
  }

  const started = Boolean(snap?.draw?.started);
  // Полная выдача едет в стейдж хешем launch-URL — тем же приёмом, что пин варианта
  // в отладчике. В проде хеша нет, и ветка мертва.
  const playUrl = fullDraw ? `${state.playUrl}#tbfa=1` : state.playUrl;

  function toggleFullDraw(next: boolean) {
    setFullDraw(next);
    // Выдача фиксируется в момент первого вопроса, поэтому смена режима
    // перезапускает прогон — иначе тумблер молча ничего бы не менял.
    reset();
  }

  return (
    <div className="dbg">
      <header className="dbg__toolbar">
        <Cluster gap={2} align="center">
          <MessageSquare size={18} className="dbg__brand-ico" />
          <strong>Рецензирование теста</strong>
          <span className="dbg__sub">{state.title}</span>
          <span
            className="dbg__hint"
            title="Прогон рецензирования не записывается: попытка не создаётся, результат никуда не идёт. Комментарии сохраняются и видны автору теста и другим рецензентам."
          >
            <Info size={14} />
          </span>
        </Cluster>
        <span className="dbg__bar-spacer" />
        <Button variant="ghost" size="s" leadingIcon={<RotateCcw size={14} />} onClick={reset}>
          Начать заново
        </Button>
      </header>

      <div className="dbg__body">
        <section className="dbg__stage">
          <div className="dbg__ribbon">
            <span>Экран пакета{state.template ? ` · шаблон ${state.template}` : ""}</span>
            <span className="dbg__bar-spacer" />
            <label className="dbg__ref-toggle" title="Подсветить правильные ответы; на баллы не влияет">
              <span className="dbg__ref-lbl">Эталон</span>
              <Switch
                checked={reference}
                onChange={(e) => setReference(e.target.checked)}
                aria-label="Показывать эталон"
                data-testid="toggle-reference"
              />
            </label>
            <label
              className="dbg__ref-toggle"
              title={started
                ? "Выдача уже зафиксирована: режим переключается до первого вопроса"
                : "Выдать весь банк темы вместо настроенной выборки"}
            >
              <span className="dbg__ref-lbl">Все вопросы темы</span>
              <Switch
                checked={fullDraw}
                onChange={(e) => toggleFullDraw(e.target.checked)}
                disabled={started}
                aria-label="Все вопросы темы"
                data-testid="toggle-full-draw"
              />
            </label>
          </div>
          <iframe
            key={runKey}
            ref={frameRef}
            className="dbg__frame"
            title="stage"
            src={playUrl}
          />
        </section>

        <aside className="dbg__inspector">
          <Tabs
            items={TABS.map((t) => ({ id: t.id, label: t.label }))}
            value={tab}
            onChange={(id) => setTab(id as ReviewTabId)}
            variant="underline"
            size="s"
          />
          <div className="dbg__ins-body">
            {tab === "comments" ? (
              <ReviewPanel testId={testId} mode="player" screenAnchor={screenAnchor} />
            ) : !snap ? (
              <PanelEmpty text="Запустите пакет — здесь появятся данные прогона." />
            ) : fullDraw ? (
              <Stack gap={3}>
                <Banner tone="info" title="Не считается в режиме полной выдачи">
                  Выдан весь банк темы, а не настроенная выборка, поэтому балл, процент и вердикт были бы
                  недостоверны. Верность ответа и балл за отдельный вопрос по-прежнему видны в «Протоколе».
                </Banner>
                {tab === "protocol" ? <ProtocolPanel snap={snap} /> : null}
              </Stack>
            ) : tab === "score" ? (
              <ScorePanel snap={snap} />
            ) : (
              <ProtocolPanel snap={snap} />
            )}
          </div>
        </aside>
      </div>

      {fullDraw ? (
        <div className="dbg__status">
          <Tag size="s" tone="accent" variant="outline">весь банк темы</Tag>
          <Text tone="muted" variant="body-s">оценка не считается в режиме полной выдачи</Text>
        </div>
      ) : null}
    </div>
  );
}
