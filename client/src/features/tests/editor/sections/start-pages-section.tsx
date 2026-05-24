/**
 * @module features/tests/editor/sections/start-pages-section
 * @description Editor section for the «Структура» tab (PRD-7 wireframes
 * `prd7-structure-linear-flat.html`, `prd7-structure-linear-by-topics.html`,
 * `prd7-structure-router.html`).
 *
 * Renders a read-only zoned view of a test's `content_pages` (PRD-1 §4) plus
 * the questions-stream rows derived from `model.sections`. The layout adapts
 * to `model.flowMode`:
 *   - `linear_flat`        — single «До теста» zone (`position = before`,
 *                            `topicId = null`) → unified questions row →
 *                            after-test zone (currently empty — schema does
 *                            not have a `after_test` position).
 *   - `linear_by_topics`   — per-topic before/after pages around the topic's
 *                            questions row.
 *   - `router_by_topics`   — same per-topic layout plus a router-page banner.
 *
 * The delete action ships in this iteration so authors can clean up legacy
 * pages they no longer need. Create / reorder / rich-edit are deferred to
 * the next step (see banner at the bottom of the pane).
 */
import { useState } from "react";
import { Banner, Button, EmptyState, Tag } from "@universityrt/ui-kit";
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
  linear_flat: "Последовательный (плоский)",
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
      <FlowModeBanner mode={model.flowMode} />

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

// ─── Banners ──────────────────────────────────────────────────────────────────

function FlowModeBanner({ mode }: { mode: TestEditorModel["flowMode"] }) {
  return (
    <Banner
      tone="info"
      title={`Сценарий: ${FLOW_LABEL[mode]}`}
      description="Сценарий задаётся во вкладке «Настройки → Основное»."
      data-testid="structure-mode-banner"
    />
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
      <EmptyState
        layout="inline"
        well
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
    <div className="tb-structure-zones" data-testid="structure-section-list">
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
    <section className="tb-structure-zone" data-testid={props.testId}>
      <header className="tb-structure-zone__head">
        <h4 className="tb-structure-zone__title">{props.title}</h4>
      </header>
      <div className="tb-structure-zone__body">
        {empty && props.emptyMessage ? (
          <div className="tb-structure-zone__empty">{props.emptyMessage}</div>
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
      className="tb-structure-zone tb-structure-zone--topic"
      data-testid={`structure-zone-topic-${props.section.topicId}`}
    >
      <header className="tb-structure-zone__head">
        <h4 className="tb-structure-zone__title">
          {props.index}. {props.section.topicName}
        </h4>
        <span className="tb-structure-zone__meta">
          {props.section.drawCount} из {props.section.maxQuestions} вопросов
        </span>
      </header>
      <div className="tb-structure-zone__body">
        {props.before.length > 0 && (
          <div className="tb-structure-zone__group" data-testid={`structure-topic-before-${props.section.topicId}`}>
            <div className="tb-structure-zone__group-title">До темы</div>
            {props.before.map((p) => (
              <PageRow
                key={p.id}
                page={p}
                onRemove={props.onRemove}
                isRemoving={props.isRemoving}
              />
            ))}
          </div>
        )}
        <div className="tb-structure-zone__group" data-testid={`structure-topic-questions-${props.section.topicId}`}>
          <div className="tb-structure-zone__group-title">Вопросы темы</div>
          <div className="tb-page-row tb-page-row--system">
            <span className="tb-page-row__badge">Вопросы</span>
            <span className="tb-page-row__title">
              {props.section.drawCount} вопросов из {props.section.maxQuestions}
            </span>
          </div>
        </div>
        {props.after.length > 0 && (
          <div className="tb-structure-zone__group" data-testid={`structure-topic-after-${props.section.topicId}`}>
            <div className="tb-structure-zone__group-title">После темы</div>
            {props.after.map((p) => (
              <PageRow
                key={p.id}
                page={p}
                onRemove={props.onRemove}
                isRemoving={props.isRemoving}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FlatQuestionsRow({ model }: { model: TestEditorModel }) {
  const total = model.sections.reduce((s, x) => s + x.drawCount, 0);
  const max = model.sections.reduce((s, x) => s + x.maxQuestions, 0);
  return (
    <div className="tb-page-row tb-page-row--system" data-testid="structure-flat-questions-row">
      <span className="tb-page-row__badge">Вопросы</span>
      <span className="tb-page-row__title">
        Единый поток: {total} вопросов из {max} (
        {model.sections.length} {model.sections.length === 1 ? "тема" : "тем"})
      </span>
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
        "tb-page-row" +
        (page.templateKeyMissing ? " tb-page-row--missing-template" : "")
      }
      data-testid={`structure-page-row-${page.id}`}
    >
      <span className="tb-page-row__badge">{badge}</span>
      <span className="tb-page-row__title">{title}</span>
      {page.templateKeyMissing && (
        <Tag tone="warning" size="s" data-testid={`structure-page-missing-${page.id}`}>
          Шаблон страницы недоступен
        </Tag>
      )}
      <div className="tb-page-row__actions">
        {!confirming ? (
          <Button
            variant="ghost"
            size="s"
            onClick={() => setConfirming(true)}
            data-testid={`structure-page-delete-${page.id}`}
            aria-label={`Удалить страницу ${title}`}
          >
            Удалить
          </Button>
        ) : (
          <>
            <span className="tb-page-row__confirm">Удалить?</span>
            <Button
              variant="secondary"
              size="s"
              onClick={() => setConfirming(false)}
              data-testid={`structure-page-delete-cancel-${page.id}`}
            >
              Отмена
            </Button>
            <Button
              variant="primary"
              size="s"
              onClick={() => {
                props.onRemove(page.id).then(() => setConfirming(false)).catch(() => {
                  // surface left to react-query; just exit confirm mode.
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
    </div>
  );
}
