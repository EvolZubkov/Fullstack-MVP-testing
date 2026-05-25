/**
 * @module features/tests/editor/sections/start-pages-section
 * @description Editor section for the «Структура» tab (PRD-7 wireframes
 * `prd7-structure-linear-flat.html`, `prd7-structure-linear-by-topics.html`,
 * `prd7-structure-router.html`).
 *
 * Renders a read-only zoned view of a test's `content_pages` (PRD-1 §4) plus
 * the questions-stream rows derived from `model.sections`. The layout adapts
 * to `model.flowMode`:
 *   - `linear_flat`        — «До теста» zone (`position = before`,
 *                            `topicId = null`) → single questions row →
 *                            «После теста» zone (currently empty in MVP).
 *   - `linear_by_topics`   — per-topic before/after pages around the topic's
 *                            questions row.
 *   - `router_by_topics`   — same per-topic layout plus a router-page banner.
 *
 * Markup ports the wireframe-local classes (`flow-mode-bar`, `zone-block`,
 * `zone-header`, `topic-block`, `topic-header`, `page-row`, `page-variant-badge`,
 * `page-title`, `page-actions`) into the DS-extensions stylesheet. Per-page
 * actions live in a dots-menu (ui-kit `MenuTrigger`); delete confirms via
 * the existing inline confirm pattern. Create / edit / drag-reorder are
 * deferred (see the «следующий шаг» banner at the bottom).
 */
import { useState } from "react";
import {
  ChevronDown,
  HelpCircle,
  Info,
  Layout,
  MoreHorizontal,
} from "lucide-react";
import {
  Banner,
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Tag,
} from "@universityrt/ui-kit";
import { useContentPages, type ContentPage } from "../use-content-pages";
import type { TestEditorModel } from "../test-editor.types";

// ─── Public API ───────────────────────────────────────────────────────────────

export type StructureSectionProps = {
  model: TestEditorModel;
  /** Test id is required to fetch content_pages; `undefined` in create mode. */
  testId?: string;
};

/** Backwards-compatible alias: original skeleton lived under this name. */
export type StartPagesSectionProps = StructureSectionProps;

const FLOW_LABEL: Record<TestEditorModel["flowMode"], string> = {
  linear_flat: "Последовательный",
  linear_by_topics: "Последовательный по темам",
  router_by_topics: "Маршрутизатор по темам",
  mixed: "Смешанный (устаревший)",
};

const KIND_LABEL: Record<string, string> = {
  intro: "Введение",
  info: "Материал",
  summary: "Итоги",
  router: "Маршрутизатор",
  questions: "Вопросы",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function StructureSection({ model, testId }: StructureSectionProps) {
  const cp = useContentPages(testId);
  return (
    <div data-testid="structure-section">
      <FlowModeBar mode={model.flowMode} />

      {testId === undefined ? (
        <CreateModeNotice />
      ) : cp.isLoading ? (
        <LoadingNotice />
      ) : cp.error ? (
        <ErrorNotice message={cp.error.message} />
      ) : (
        <ZonesBlock
          model={model}
          pages={cp.pages}
          onRemove={cp.remove}
          isRemoving={cp.isRemoving}
        />
      )}

      <NextStepBanner />
    </div>
  );
}

/** Backwards-compatible re-export under the old skeleton name. */
export const StartPagesSection = StructureSection;

// ─── Top banner ───────────────────────────────────────────────────────────────

function FlowModeBar({ mode }: { mode: TestEditorModel["flowMode"] }) {
  return (
    <div className="flow-mode-bar" data-testid="structure-mode-banner">
      <Layout className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Режим:</span>
      <span className="flow-mode-label">{FLOW_LABEL[mode]}</span>
      <span className="flow-mode-hint">
        — задаётся во вкладке Настройки › Сценарий прохождения
      </span>
    </div>
  );
}

function CreateModeNotice() {
  return (
    <Banner
      tone="info"
      title="Сначала сохраните черновик"
      description="Структура страниц «до / после» привязана к существующему тесту. Сохраните черновик во вкладке «Настройки», после этого здесь появится возможность редактировать страницы."
      data-testid="structure-create-notice"
    />
  );
}

function LoadingNotice() {
  return (
    <Banner
      tone="info"
      title="Загружаем структуру…"
      data-testid="structure-loading"
    />
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <Banner
      tone="error"
      title="Не удалось загрузить структуру"
      description={message}
      data-testid="structure-error"
    />
  );
}

function NextStepBanner() {
  return (
    <Banner
      tone="info"
      title="Создание и редактирование страниц — следующий шаг"
      description="Добавление страниц «до / после», встроенный rich-text редактор, drag-reorder и выбор шаблона страницы реализуются отдельным шагом PRD-7 интеграции с PRD-1 §4."
      data-testid="structure-content-pages-stub"
    />
  );
}

// ─── Zones ────────────────────────────────────────────────────────────────────

function ZonesBlock(props: {
  model: TestEditorModel;
  pages: ContentPage[];
  onRemove: (pageId: string) => Promise<void>;
  isRemoving: boolean;
}) {
  const { model, pages, onRemove, isRemoving } = props;

  if (model.sections.length === 0) {
    return (
      <Banner
        tone="info"
        title="Тем пока нет"
        description="Добавьте темы во вкладке «Состав» — здесь они появятся в порядке прохождения."
        data-testid="structure-empty"
      />
    );
  }

  const beforeTestPages = pages
    .filter((p) => p.position === "before" && p.topicId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div data-testid="structure-section-list">
      <Zone
        title="До теста"
        testId="structure-zone-before-test"
        emptyMessage="Страниц до теста ещё нет."
      >
        {beforeTestPages.map((p) => (
          <PageRow
            key={p.id}
            page={p}
            onRemove={onRemove}
            isRemoving={isRemoving}
          />
        ))}
      </Zone>

      {model.flowMode === "linear_flat" ? (
        <Zone title="Внутри теста" testId="structure-zone-questions">
          <FlatQuestionsRow model={model} />
        </Zone>
      ) : (
        model.sections.map((section, idx) => {
          const before = pages
            .filter(
              (p) => p.position === "before_topic" && p.topicId === section.topicId,
            )
            .sort((a, b) => a.sortOrder - b.sortOrder);
          const after = pages
            .filter(
              (p) => p.position === "after_topic" && p.topicId === section.topicId,
            )
            .sort((a, b) => a.sortOrder - b.sortOrder);
          return (
            <TopicBlock
              key={section.topicId}
              index={idx + 1}
              section={section}
              before={before}
              after={after}
              onRemove={onRemove}
              isRemoving={isRemoving}
            />
          );
        })
      )}
    </div>
  );
}

function Zone(props: {
  title: string;
  testId: string;
  emptyMessage?: string;
  children: React.ReactNode;
}) {
  const empty =
    Array.isArray(props.children) && props.children.length === 0
      ? true
      : !props.children;
  return (
    <section className="zone-block" data-testid={props.testId}>
      <div className="zone-header">
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        {props.title}
      </div>
      <div className="topic-body">
        {empty && props.emptyMessage ? (
          <div className="page-row page-row--empty">{props.emptyMessage}</div>
        ) : (
          props.children
        )}
      </div>
    </section>
  );
}

function TopicBlock(props: {
  index: number;
  section: TestEditorModel["sections"][number];
  before: ContentPage[];
  after: ContentPage[];
  onRemove: (pageId: string) => Promise<void>;
  isRemoving: boolean;
}) {
  return (
    <section
      className="topic-block"
      data-testid={`structure-zone-topic-${props.section.topicId}`}
    >
      <div className="topic-header">
        <span className="topic-name">
          {props.index}. {props.section.topicName}
        </span>
        <span className="topic-count">
          {props.section.drawCount} из {props.section.maxQuestions} вопросов
        </span>
      </div>
      <div className="topic-body">
        {props.before.map((p) => (
          <PageRow
            key={p.id}
            page={p}
            onRemove={props.onRemove}
            isRemoving={props.isRemoving}
          />
        ))}
        <FlatQuestionsRow model={null} sectionDrawCount={props.section.drawCount} sectionMax={props.section.maxQuestions} />
        {props.after.map((p) => (
          <PageRow
            key={p.id}
            page={p}
            onRemove={props.onRemove}
            isRemoving={props.isRemoving}
          />
        ))}
      </div>
    </section>
  );
}

function FlatQuestionsRow({
  model,
  sectionDrawCount,
  sectionMax,
}: {
  model: TestEditorModel | null;
  sectionDrawCount?: number;
  sectionMax?: number;
}) {
  const total = model
    ? model.sections.reduce((s, x) => s + x.drawCount, 0)
    : (sectionDrawCount ?? 0);
  const max = model
    ? model.sections.reduce((s, x) => s + x.maxQuestions, 0)
    : (sectionMax ?? 0);
  const subtitle = model
    ? `Единый поток: ${total} вопросов из ${max} (${model.sections.length} ${model.sections.length === 1 ? "тема" : "тем"})`
    : `${total} вопросов из ${max}`;
  return (
    <div
      className="page-row page-row--system page-row--questions"
      data-testid={model ? "structure-flat-questions-row" : undefined}
      data-kind="questions"
    >
      <HelpCircle className="page-icon h-3.5 w-3.5" aria-hidden="true" />
      <span className="page-variant-badge">Вопросы</span>
      <span className="page-title">{subtitle}</span>
    </div>
  );
}

function PageRow(props: {
  page: ContentPage;
  onRemove: (pageId: string) => Promise<void>;
  isRemoving: boolean;
}) {
  const { page } = props;
  const [confirming, setConfirming] = useState(false);
  const title =
    (page.valuesJson?.values?.title as string | undefined) ||
    (page.valuesJson?.values?.heading as string | undefined) ||
    KIND_LABEL[page.kind] ||
    "Страница";
  const badge = KIND_LABEL[page.kind] ?? page.kind;
  return (
    <div
      className={
        "page-row" +
        (page.templateKeyMissing ? " page-row--warn" : "")
      }
      data-testid={`structure-page-row-${page.id}`}
    >
      <span className="page-variant-badge">{badge}</span>
      <span className="page-title">{title}</span>
      <div className="page-actions">
        {!confirming ? (
          <MenuTrigger
            placement="bottom-end"
            trigger={
              <button
                type="button"
                className="ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s"
                aria-label={`Действия для страницы ${title}`}
                data-testid={`structure-page-actions-${page.id}`}
              >
                <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
              </button>
            }
          >
            <Menu size="sm">
              <MenuItem
                danger
                onClick={() => setConfirming(true)}
                data-testid={`structure-page-delete-${page.id}`}
              >
                Удалить
              </MenuItem>
            </Menu>
          </MenuTrigger>
        ) : (
          <>
            <span className="page-row__delete-confirm-label">Удалить?</span>
            <Button
              variant="secondary"
              size="s"
              onClick={() => setConfirming(false)}
              data-testid={`structure-page-delete-cancel-${page.id}`}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              size="s"
              onClick={() => {
                props.onRemove(page.id).then(() => setConfirming(false)).catch(() => {
                  setConfirming(false);
                });
              }}
              disabled={props.isRemoving}
              loading={props.isRemoving}
              data-testid={`structure-page-delete-confirm-${page.id}`}
            >
              {props.isRemoving ? "Удаляем…" : "Удалить"}
            </Button>
          </>
        )}
      </div>
      {page.templateKeyMissing && (
        <div className="page-row__meta">
          <Tag tone="warning" size="s" data-testid={`structure-page-missing-${page.id}`}>
            <Info className="h-3 w-3" aria-hidden="true" />
            Шаблон страницы недоступен
          </Tag>
        </div>
      )}
    </div>
  );
}
