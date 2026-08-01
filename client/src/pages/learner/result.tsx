import { useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button, Center, Stack, Text } from "@universityrt/ui-kit";
import { LoadingState } from "@/components/loading-state";
import { TemplateScreen } from "@/components/template-screen";
import { RESULTS_NAV_ACTIONS } from "@shared/template/results-nav";
import {
  downloadAttemptReport,
  type AttemptReport,
  type AttemptReportRender,
} from "@/features/learner/attempt-report";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";
import type { Attempt, AttemptResult } from "@shared/schema";
import type { MeasuresInput } from "@shared/template/result-context";

interface AttemptWithResult extends Attempt {
  testTitle: string;
  result: AttemptResult;
  canRetake: boolean;
  attemptsInfo: {
    completed: number;
    max: number | null;
  } | null;
  /** PRD-12 web-host: template render payload for the results screen. */
  render?: {
    layout: string;
    css: string;
    context: unknown;
    theme?: { background: string; foreground: string };
    /** Per-test design-param CSS-var overrides (PRD-7 branding); applied on the shadow host. */
    cssVars?: Record<string, string>;
    /** PRD-23: per-theme colour overrides, printed as CSS. */
    themeCss?: string;
    /** PRD-23: palette pinned by the author; absent means «Авто». */
    dataTheme?: "light" | "dark";
    /** PRD-23: template declares a choice of palettes (see resolveSceneTheme). */
    themed?: boolean;
  } | null;
  /**
   * Input for the shared PDF report («Скачать отчёт»). Present whenever the attempt has
   * a computed result; absent payloads simply leave the footer button inert-free, since
   * the server only turns `result.nav.showReport` on together with this.
   */
  report?: AttemptReport | null;
  /**
   * PRD-27: макет выбранного варианта отчёта, его стили и токены теста. Отсутствует,
   * только когда макета не дал ни активный шаблон, ни «Стандартный».
   */
  reportRender?: AttemptReportRender | null;
  /**
   * PRD-29/PRD-35: измерения попытки — те же, по которым сервер отрисовал экран.
   * Отчёт собирается на клиенте, поэтому шкалы и радар печатаются из них.
   */
  measures?: MeasuresInput | null;
}

export default function ResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  // A magic-link session has no test list — offering "/learner" would just bounce
  // it to /login (ProtectedRoute's scope guard). Its only valid "back" is its own
  // test, and that id is only known once `attempt` has loaded.
  const magicScoped = !!user?.magicScope;

  const { data: attempt, isLoading, error } = useQuery<AttemptWithResult>({
    queryKey: ["/api/attempts", attemptId, "result"],
  });

  if (isLoading) {
    return <LoadingState message={t.result.loading} />;
  }

  // PRD-12: the results screen renders ONLY from the shared design template (both
  // standard and adaptive). Any state without a render payload — fetch error,
  // missing result, or a template that could not be read — is a degraded fallback
  // shown as a minimal message, never a parallel React results UI.
  if (error || !attempt || !attempt.result || !attempt.render) {
    const description =
      error || !attempt
        ? t.common.couldNotFindResults
        : "Результаты этой попытки ещё не сформированы или были потеряны.";
    // In a restricted session the test id comes from `attempt` — if the fetch
    // itself failed (`!attempt`), the id is unknown and there is nowhere valid to
    // send the button, so it is omitted rather than pointed at the out-of-scope list.
    const backTarget = magicScoped
      ? attempt
        ? `/learner/test/${attempt.testId}`
        : null
      : "/learner";
    return (
      <Center minH="full" pad={6}>
        <Stack gap={4} align="center">
          <Text as="h1" variant="heading-l" weight="semibold">{t.common.resultsNotFound}</Text>
          <Text tone="muted" align="center">{description}</Text>
          {backTarget && (
            <Button leadingIcon={<ArrowLeft size={16} />} onClick={() => navigate(backTarget)}>
              {t.result.backToTests}
            </Button>
          )}
        </Stack>
      </Center>
    );
  }

  return <TemplateResultPage attempt={attempt} />;
}

function TemplateResultPage({ attempt }: { attempt: AttemptWithResult }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  // A magic-link session has no test list — its "back"/"finish" both resolve to
  // its own test rather than "/learner", which would just bounce it to /login.
  const magicScoped = !!user?.magicScope;
  // Rasterizing takes a few seconds; a second click must not start a second export.
  const reportBusy = useRef(false);
  const render = attempt.render!;
  // «К списку тестов» is a WEB-only action, so it is the host that turns it on —
  // the same split as the start screen's `showBack`. It belongs to the scene's own
  // footer: rendered as host chrome under the scene it was a SECOND footer on the
  // screen, on a guessed background (`theme.background` is the first `--background`
  // in theme.css, i.e. always the light palette), with a dead band below it.
  const ctx = render.context as { result?: Record<string, unknown> } | null;
  // …and only on the ADAPTIVE results layout, because that is the one whose footer
  // has no closing action of its own: the standard layout ends with
  // `result.nav.primaryAction` (the server labels it «К списку тестов»), so a second
  // button with the same caption would just repeat it.
  const showBack = !!ctx?.result?.adaptive;
  const context = { ...(ctx ?? {}), result: { ...(ctx?.result ?? {}), showBack } };

  /**
   * «Скачать отчёт» — the shared PDF generator, loaded on demand. Failures are shown:
   * a silent no-op on a button the learner pressed is worse than an honest error.
   */
  async function handleReport() {
    if (reportBusy.current) return;
    if (!attempt.report || !attempt.reportRender) {
      toast({
        variant: "destructive",
        title: "Отчёт недоступен",
        description: attempt.report
          ? "Шаблон не предоставил макет отчёта."
          : "Нет данных для отчёта по этой попытке.",
      });
      return;
    }
    reportBusy.current = true;
    toast({ variant: "info", title: "Готовим отчёт", description: "Файл скачается автоматически." });
    try {
      await downloadAttemptReport(attempt.report, attempt.reportRender, attempt.measures ?? undefined);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Не удалось сформировать отчёт",
        description: (e as Error).message,
      });
    } finally {
      reportBusy.current = false;
    }
  }

  return (
    // Scene = the space the app shell left over (this route keeps the learner
    // navbar), so only `.tb-scene__body` scrolls and the footer sits on the bottom
    // edge — `100dvh` would add up to the navbar and push the footer out of view.
    <div className="tbh-inset-screen tbh-col">
      <TemplateScreen
        className="tbh-fill"
        layout={render.layout}
        css={render.css}
        cssVars={render.cssVars}
        themeCss={render.themeCss}
        dataTheme={render.dataTheme}
        themed={render.themed}
        context={context}
        onAction={(action) => {
          // Actions come from the LAYOUT's footer (`result.nav`) — the same names the
          // package binds; see shared/template/results-nav.
          if (action === RESULTS_NAV_ACTIONS.report) {
            void handleReport();
            return;
          }
          if (action === RESULTS_NAV_ACTIONS.retry && attempt.canRetake) {
            navigate(`/learner/test/${attempt.testId}`);
            return;
          }
          if (action === RESULTS_NAV_ACTIONS.finish || action === RESULTS_NAV_ACTIONS.back) {
            navigate(magicScoped ? `/learner/test/${attempt.testId}` : "/learner");
          }
        }}
      />
    </div>
  );
}
