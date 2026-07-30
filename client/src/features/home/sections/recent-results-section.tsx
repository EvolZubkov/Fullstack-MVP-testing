/**
 * @module features/home/sections/recent-results-section
 * @description PRD-25 FR-08: the three most recent FINISHED attempts — test,
 * date, percent, pass/fail — as a compact table, plus a link into the full
 * history. This is an extract, not a list: no sorting and no paging. The empty
 * state carries NO action (FR-17): the user cannot assign themselves a test.
 */
import { useLocation } from "wouter";
import { Inbox } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Cluster,
  EmptyState,
  Table,
  Tag,
  Text,
  type TableColumn,
} from "@universityrt/ui-kit";
import type { RecentResultItem } from "@shared/home/contract";

/**
 * The «Мои результаты» section.
 *
 * @param props.items - finished attempts, newest first (at most three).
 * @returns the section card.
 */
export function RecentResultsSection({ items }: { items: RecentResultItem[] }) {
  const [, navigate] = useLocation();

  const columns: TableColumn<RecentResultItem>[] = [
    { key: "testTitle", header: "Тест", render: (row) => row.testTitle },
    {
      key: "finishedAt",
      header: "Дата",
      render: (row) => new Date(row.finishedAt).toLocaleDateString("ru-RU"),
    },
    {
      key: "percent",
      header: "Результат",
      numeric: true,
      render: (row) => `${row.percent} %`,
    },
    {
      key: "passed",
      header: "",
      render: (row) =>
        row.passed === null ? null : (
          <Tag tone={row.passed ? "success" : "error"}>{row.passed ? "Зачёт" : "Незачёт"}</Tag>
        ),
    },
    {
      key: "open",
      header: "",
      render: (row) => (
        <Button
          variant="ghost"
          size="s"
          onClick={() => navigate(`/learner/result/${row.attemptId}`)}
          data-testid={`home-result-open-${row.attemptId}`}
        >
          Открыть
        </Button>
      ),
    },
  ];

  return (
    <Card variant="outlined" data-testid="home-results">
      <CardHeader title="Мои результаты" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            layout="inline"
            art={<Inbox size={24} aria-hidden="true" />}
            title="Вы ещё не проходили тестов"
            description="Результат появится здесь сразу после первой завершённой попытки."
          />
        ) : (
          <Table columns={columns} rows={items} rowKey={(row) => row.attemptId} density="compact" />
        )}
      </CardBody>
      <CardFooter>
        <Text variant="body-s" tone="muted">Три последние завершённые попытки</Text>
        <Cluster gap={2}>
          <Button
            variant="secondary"
            size="s"
            onClick={() => navigate("/learner/history")}
            data-testid="home-results-history"
          >
            История прохождений
          </Button>
        </Cluster>
      </CardFooter>
    </Card>
  );
}
