/**
 * @module features/home/home-page
 *
 * PRD-25: the two-column home layout (spec section 6, approved wireframe
 * `docs/wireframes/approved/prd25-home.html`). The left column carries the
 * user's objects, the right one carries what is urgent plus the shortcuts.
 *
 * Two behaviours are load bearing here and nowhere else:
 *
 * 1. When the right column resolves to nothing — the pure-learner profile — the
 *    page collapses to a single full-width column instead of leaving a dead
 *    gutter next to the content.
 * 2. The three states of a payload key are kept apart (FR-02/FR-15/FR-17): an
 *    ABSENT key hides the section entirely (no right), a `{ failed: true }` key
 *    renders a retry placeholder while its neighbours keep working, and a loaded
 *    payload renders normally even when empty. Collapsing «no right» into «empty»
 *    would advertise features the user cannot reach.
 */
import type { ReactNode } from "react";
import { Box, Card, CardBody, EmptyState, Grid, Stack, Text } from "@universityrt/ui-kit";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/loading-state";
import { sectionData, sectionFailed, type HomeSection } from "@shared/home/contract";
import { useHome } from "./use-home";
import { AttentionPanel } from "./sections/attention-panel";
import { QuickActions } from "./sections/quick-actions";
import { AssignedTestsSection } from "./sections/assigned-tests-section";
import { RecentResultsSection } from "./sections/recent-results-section";
import { MyTestsSection } from "./sections/my-tests-section";
import { MyTopicsSection } from "./sections/my-topics-section";
import { PeopleSection } from "./sections/people-section";
import { SummaryStrip } from "./sections/summary-strip";
import { MaterialsSection } from "./sections/materials-section";

/** Placeholder shown in place of a section whose source errored (FR-15). */
function SectionError({ name }: { name: string }) {
  return (
    <Card variant="outlined" data-testid={`home-section-error-${name}`}>
      <CardBody>
        <Text variant="body-s" tone="muted">
          Не удалось загрузить раздел. Обновите страницу.
        </Text>
      </CardBody>
    </Card>
  );
}

/**
 * Render one section from its payload key, preserving the absent/failed/loaded
 * distinction. Returns `null` for an absent key so the caller can simply drop it
 * from the column.
 *
 * @param name Stable key used for the error placeholder's test id.
 * @param section The raw payload key (may be undefined).
 * @param render Renderer for the loaded case.
 */
function renderSection<T>(
  name: string,
  section: HomeSection<T> | undefined,
  render: (data: T) => ReactNode,
): ReactNode {
  if (!section) return null;
  if (sectionFailed(section)) return <SectionError name={name} key={name} />;
  const data = sectionData(section);
  return data === null ? null : <Box key={name}>{render(data)}</Box>;
}

export function HomePage() {
  const { data, isLoading } = useHome();

  if (isLoading || !data) {
    return <LoadingState message="Загрузка…" />;
  }

  const attention = sectionData(data.attention);
  const quickActions = sectionData(data.quickActions);

  const left = [
    renderSection("assigned", data.assigned, (d) => (
      <AssignedTestsSection items={d.items} total={d.total} />
    )),
    renderSection("recentResults", data.recentResults, (d) => <RecentResultsSection items={d.items} />),
    renderSection("myTests", data.myTests, (d) => <MyTestsSection items={d.items} total={d.total} />),
    renderSection("myTopics", data.myTopics, (d) => <MyTopicsSection items={d.items} total={d.total} />),
    renderSection("peopleAssignments", data.peopleAssignments, (d) => <PeopleSection data={d} />),
  ].filter(Boolean);

  const right = [
    attention && attention.length > 0 ? <AttentionPanel items={attention} key="attention" /> : null,
    quickActions && quickActions.length > 0 ? <QuickActions actions={quickActions} key="quickActions" /> : null,
    renderSection("summary", data.summary, (d) => <SummaryStrip data={d} />),
    renderSection("materials", data.materials, (d) => <MaterialsSection data={d} />),
  ].filter(Boolean);

  if (left.length === 0 && right.length === 0) {
    return (
      <Box padX={6} padY={8} data-testid="home-no-sections">
        <EmptyState
          title="Нет доступных разделов"
          description="Вашей учётной записи не назначено ни одной роли. Обратитесь к администратору."
        />
      </Box>
    );
  }

  return (
    <Box padX={6} padY={8}>
      <PageHeader title="Главная" description="Что происходит и что можно продолжить" />
      {right.length === 0 ? (
        <Stack gap={4}>{left}</Stack>
      ) : (
        <Grid template="main-aside" gap={4}>
          <Stack gap={4}>{left}</Stack>
          <Stack gap={4}>{right}</Stack>
        </Grid>
      )}
    </Box>
  );
}
