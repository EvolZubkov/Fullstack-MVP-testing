/**
 * @module features/home/sections/my-tests-section
 * @description PRD-25 FR-09: recently touched tests with their publication state.
 * The status is shown with the SAME pair of chips the product test list uses
 * («Опубликован» + «Есть изменения»), so the home page and the section never call
 * one state by two names. Action buttons mirror the rights the server resolved —
 * the row never offers an export to a user who may not export.
 */
import { Fragment } from "react";
import { useLocation } from "wouter";
import { BugPlay, Download, FilePlus, Pencil } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardDivider,
  CardFooter,
  CardHeader,
  Cluster,
  EmptyState,
  IconButton,
  Stack,
  Tag,
  Text,
} from "@universityrt/ui-kit";
import { formatQuestions, pluralize } from "@/lib/i18n";
import type { HomeTestStatus, MyTestItem } from "@shared/home/contract";

/** Status chips of a test, in the order the product list renders them. */
function StatusTags({ status }: { status: HomeTestStatus }) {
  if (status === "published" || status === "published_with_changes") {
    return (
      <>
        <Tag tone="success">Опубликован</Tag>
        {status === "published_with_changes" && <Tag tone="warning">Есть изменения</Tag>}
      </>
    );
  }
  if (status === "archived") return <Tag tone="neutral">Архив</Tag>;
  return <Tag tone="neutral">Черновик</Tag>;
}

/**
 * The «Мои тесты» section.
 *
 * @param props.items - up to six tests, attention-flagged ones first.
 * @param props.total - how many tests the user may see in all; the footer link
 *   appears only when it exceeds the number shown.
 * @returns the section card.
 */
export function MyTestsSection({ items, total }: { items: MyTestItem[]; total: number }) {
  const [, navigate] = useLocation();
  const hasMore = total > items.length;

  return (
    <Card variant="outlined" data-testid="home-my-tests">
      <CardHeader
        title="Мои тесты"
        subtitle="Сначала — требующие действия, дальше по времени изменения"
      />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            layout="inline"
            art={<FilePlus size={24} aria-hidden="true" />}
            title="Тестов пока нет"
            description="Создайте первый тест — он появится здесь."
            actions={
              <Button size="s" onClick={() => navigate("/author/tests")} data-testid="home-my-tests-create">
                Создать тест
              </Button>
            }
          />
        ) : (
          <Stack gap={0}>
            {items.map((item, index) => (
              <Fragment key={item.testId}>
                {index > 0 && <CardDivider />}
                <Stack
                  direction="row"
                  align="center"
                  gap={3}
                  padY={3}
                  data-testid={`home-test-${item.testId}`}
                >
                  <Stack gap={1} grow>
                    <Cluster gap={2}>
                      <Text variant="body-m" weight="medium">{item.title}</Text>
                      <StatusTags status={item.status} />
                      {item.owned ? null : <Tag variant="outline">Доступ выдан</Tag>}
                    </Cluster>
                    <Text variant="body-xs" tone="muted">
                      {`${item.sectionCount} ${pluralize(item.sectionCount, "раздел", "раздела", "разделов")}`
                        + ` · ${formatQuestions(item.questionCount)}`
                        + ` · изменён ${new Date(item.updatedAt).toLocaleDateString("ru-RU")}`}
                    </Text>
                  </Stack>
                  <Cluster gap={1} wrap={false}>
                    {item.canEdit && (
                      <IconButton
                        size="s"
                        aria-label="Открыть редактор"
                        title="Открыть редактор"
                        icon={<Pencil size={15} />}
                        onClick={() => navigate(`/author/tests?edit=${item.testId}`)}
                        data-testid={`home-test-edit-${item.testId}`}
                      />
                    )}
                    {item.canDebug && (
                      <IconButton
                        size="s"
                        aria-label="Тестовый прогон"
                        title="Тестовый прогон"
                        icon={<BugPlay size={15} />}
                        // PRD-18: the debug player lives in its own chromeless
                        // window, exactly as the test list opens it.
                        onClick={() =>
                          window.open(
                            `/author/tests/${item.testId}/debug`,
                            `tb-debug-${item.testId}`,
                            `popup=yes,width=${window.screen.availWidth},height=${window.screen.availHeight},left=0,top=0`,
                          )
                        }
                        data-testid={`home-test-debug-${item.testId}`}
                      />
                    )}
                    {item.canExport && (
                      <IconButton
                        size="s"
                        aria-label="Выгрузить SCORM"
                        title="Выгрузить SCORM"
                        icon={<Download size={15} />}
                        // The route answers with `Content-Disposition: attachment`,
                        // so this downloads the package without leaving the page.
                        onClick={() => window.location.assign(`/api/tests/${item.testId}/export/scorm`)}
                        data-testid={`home-test-export-${item.testId}`}
                      />
                    )}
                  </Cluster>
                </Stack>
              </Fragment>
            ))}
          </Stack>
        )}
      </CardBody>
      {hasMore && (
        <CardFooter>
          <Text variant="body-s" tone="muted">{`Показаны ${items.length} из ${total}`}</Text>
          <Cluster gap={2}>
            <Button
              variant="secondary"
              size="s"
              onClick={() => navigate("/author/tests")}
              data-testid="home-my-tests-all"
            >
              Все тесты
            </Button>
          </Cluster>
        </CardFooter>
      )}
    </Card>
  );
}
