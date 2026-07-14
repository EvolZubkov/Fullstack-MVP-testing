import { useLocation, Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button, Center, Stack, Text } from "@universityrt/ui-kit";
import { LoadingState } from "@/components/loading-state";
import { TemplateScreen } from "@/components/template-screen";
import { t } from "@/lib/i18n";
import type { Attempt, AttemptResult } from "@shared/schema";

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
  } | null;
}

export default function ResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const [, navigate] = useLocation();

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
    return (
      <Center minH="full" pad={6}>
        <Stack gap={4} align="center">
          <Text as="h1" variant="heading-l" weight="semibold">{t.common.resultsNotFound}</Text>
          <Text tone="muted" align="center">{description}</Text>
          <Button leadingIcon={<ArrowLeft size={16} />} onClick={() => navigate("/learner")}>
            {t.result.backToTests}
          </Button>
        </Stack>
      </Center>
    );
  }

  return <TemplateResultPage attempt={attempt} />;
}

/** Read a CSS custom property (e.g. `--background`) from a stylesheet string. */
function cssVar(css: string, name: string): string | undefined {
  const m = new RegExp(`--${name}:\\s*([^;}]+)`).exec(css);
  return m ? m[1].trim() : undefined;
}

function TemplateResultPage({ attempt }: { attempt: AttemptWithResult }) {
  const [, navigate] = useLocation();
  const render = attempt.render!;
  // Full-bleed surface in the template's own colors, so there is no seam between
  // the (dark) template and the surrounding app shell. The back-nav lives inside
  // the surface, on the same background. Colors come from the template CSS itself
  // (server `theme` if present, else parsed from the bundled stylesheet).
  const surface = render.theme?.background || cssVar(render.css, "background");
  const onSurface = render.theme?.foreground || cssVar(render.css, "foreground");

  return (
    <div className="tbh-minh-full tbh-col" style={{ background: surface }}>
      <TemplateScreen
        className="tbh-fill"
        layout={render.layout}
        css={render.css}
        cssVars={render.cssVars}
        context={render.context}
        onAction={(action) => {
          if (action === "restart" && attempt.canRetake) {
            navigate(`/learner/test/${attempt.testId}`);
          }
        }}
      />

      <div
        className="tbh-result-foot"
        style={{ color: onSurface }}
      >
        <Link href="/learner" className="tbh-link">
          <ArrowLeft size={16} />
          {t.result.backToTests}
        </Link>
        {attempt.attemptsInfo && (
          <span className="tbh-dim">
            Использовано попыток: {attempt.attemptsInfo.completed} / {attempt.attemptsInfo.max}
            {!attempt.canRetake && attempt.attemptsInfo.max !== null && " — попытки закончились"}
          </span>
        )}
      </div>
    </div>
  );
}
