/**
 * @module features/tests/editor/sections/feedback-preview
 * @description Shared feedback preview (TD-02). Renders the configured feedback
 * as grouped lists — Материалы (title+URL links, PRD-42), Курсы (course
 * links) and Мероприятия (event links, URL optional) — instead of bare counts.
 *
 * The whole card is NO LONGER the edit trigger (that conflicted with the now
 * real item links). Editing is opened by a dedicated pencil IconButton; item
 * names are functional links. The empty placeholder stays click-to-edit.
 *
 * The empty placeholder carries the SAME pencil as a filled card, so an
 * unfilled field is recognisable as editable at a glance instead of reading
 * as inert text. There the whole card is already the button, so the pencil is
 * decorative (`aria-hidden`) — a real button inside would nest one control in
 * another.
 */
import { CalendarDays, FileText, Link as LinkIcon, Pencil, RotateCcw } from "lucide-react";
import { IconButton, Tag } from "@skillum/ui-kit";
import type { FeedbackFormat } from "@shared/schema";
import type { FeedbackAsset, FeedbackEvent, FeedbackLink } from "../test-editor.types";

export type FeedbackFieldProps = {
  /** Что это за текст: «Толкование» или «Обратная связь». */
  label: string;
  /** Подпись источника («из темы» / «этот тест») или состояния («скрыто от участника»). */
  tag?: { text: string; tone?: "neutral" | "warning" };
  /** Снять правку теста. Без него сброса нет — значит, править нечего. */
  onReset?: () => void;
  /** Подпись действия сброса: она называет, ЧТО именно сбрасывается. */
  resetLabel?: string;
  resetTestId?: string;
  /** Предпросмотр текста. */
  children: React.ReactNode;
};

/**
 * Поле текста: шапка (что это, откуда взято, чем сбросить) и предпросмотр под ней.
 *
 * Своя обёртка, а не `ou-formfield`: полей внутри одной темы теперь ДВА — толкование и
 * обратная связь, — и группой их держит как раз `ou-formfield`. Подпись источника стоит
 * ТЕГОМ: без неё автор не отличит, где текст пришёл из темы, а где переопределён этим
 * тестом, а полосы слева для этого мало — она говорит «не как у темы», но не говорит, что
 * это за поле (решение эскиза 2026-09-21).
 */
export function FeedbackField(props: FeedbackFieldProps): React.JSX.Element {
  const tag = props.tag ? (
    <Tag tone={props.tag.tone ?? "neutral"} size="s">
      {props.tag.text}
    </Tag>
  ) : null;
  return (
    <div className="tb-textfield">
      <div className="tb-feedback-head">
        <label className="ou-formfield__lbl">{props.label}</label>
        {props.onReset ? (
          <span className="tb-feedback-head__trail">
            {tag}
            <IconButton
              icon={<RotateCcw size={14} aria-hidden="true" />}
              aria-label={props.resetLabel ?? "Сбросить до установок темы"}
              title={props.resetLabel ?? "Сбросить до установок темы"}
              variant="ghost"
              size="s"
              onClick={props.onReset}
              data-testid={props.resetTestId}
            />
          </span>
        ) : (
          tag
        )}
      </div>
      {props.children}
    </div>
  );
}

export type FeedbackPreviewProps = {
  format: FeedbackFormat;
  text: string;
  /** Recommended courses (label «Курсы»). */
  links: FeedbackLink[];
  /** Materials — title+URL links (label «Материалы», PRD-42). */
  assets: FeedbackAsset[];
  /** Recommended events (label «Мероприятия»). */
  events: FeedbackEvent[];
  /** Opens the editor. When omitted the preview is read-only (no pencil). */
  onEdit?: () => void;
  /** aria-label for the pencil / empty placeholder. */
  editAriaLabel?: string;
  /** Placeholder shown when nothing is configured. */
  emptyLabel?: string;
  /** Текст переопределён в этом тесте: рисуется полосой слева, без подписи. */
  overridden?: boolean;
  /** data-testid for the preview root. The pencil gets `${testId}-edit`. */
  testId?: string;
};

/** A single named link group (Материалы / Курсы / Мероприятия). */
function PreviewGroup(props: {
  title: string;
  icon: React.ReactNode;
  items: { label: string; href?: string; download?: boolean }[];
}) {
  if (props.items.length === 0) return null;
  return (
    <div className="tb-feedback-preview__group">
      <div className="tb-feedback-preview__group-title">{props.title}</div>
      <ul className="tb-feedback-preview__items">
        {props.items.map((it, i) => (
          <li key={i} className="tb-feedback-preview__item">
            <span className="tb-feedback-preview__item-ico" aria-hidden="true">
              {props.icon}
            </span>
            {it.href ? (
              <a
                href={it.href}
                target="_blank"
                rel="noopener noreferrer"
                download={it.download || undefined}
                // Keep the link click from bubbling to any parent handler.
                onClick={(e) => e.stopPropagation()}
              >
                {it.label}
              </a>
            ) : (
              <span>{it.label}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** @public */
export function FeedbackPreview(props: FeedbackPreviewProps) {
  const isRich = props.format === "richText" || props.format === "html";
  const hasText = props.text.trim() !== "";
  const isEmpty =
    !hasText &&
    props.links.length === 0 &&
    props.assets.length === 0 &&
    props.events.length === 0;

  if (isEmpty) {
    const empty = props.emptyLabel ?? "Без текста";
    if (props.onEdit) {
      return (
        <div
          role="button"
          tabIndex={0}
          className={
            props.overridden ? "tb-feedback-preview is-empty is-overridden" : "tb-feedback-preview is-empty"
          }
          onClick={props.onEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onEdit?.();
            }
          }}
          aria-label={props.editAriaLabel}
          data-testid={props.testId}
        >
          <div className="tb-feedback-preview__head">
            <span className="tb-feedback-preview__snippet">{empty}</span>
            <span className="tb-feedback-preview__edit-hint" aria-hidden="true">
              <Pencil size={14} />
            </span>
          </div>
        </div>
      );
    }
    return (
      <div className="tb-feedback-preview is-empty" data-testid={props.testId}>
        {empty}
      </div>
    );
  }

  return (
    <div
      className={props.overridden ? "tb-feedback-preview is-overridden" : "tb-feedback-preview"}
      data-testid={props.testId}
    >
      <div className="tb-feedback-preview__head">
        {isRich && hasText ? (
          <div
            className="tb-feedback-preview__rich"
            // Author-controlled RTE content — rendered in the author's editor UI only.
            dangerouslySetInnerHTML={{ __html: props.text }}
          />
        ) : (
          <span className="tb-feedback-preview__snippet">
            {hasText ? props.text.replace(/<[^>]+>/g, "").slice(0, 120) : "Без текста"}
          </span>
        )}
        {props.onEdit && (
          <IconButton
            icon={<Pencil size={14} aria-hidden="true" />}
            aria-label={props.editAriaLabel ?? "Редактировать обратную связь"}
            variant="ghost"
            size="s"
            onClick={props.onEdit}
            data-testid={props.testId ? `${props.testId}-edit` : undefined}
          />
        )}
      </div>

      <PreviewGroup
        title="Материалы"
        icon={<FileText size={14} />}
        items={props.assets.map((a) => ({
          label: a.title,
          // Same first-non-empty rule as `normalizeFeedback`: the address belongs in `url`;
          // `scormHref` is a read-only legacy field for descriptors saved through the
          // retired upload flow (PRD-32/PRD-42) that never wrote `url`.
          href: a.url || a.scormHref,
          download: true,
        }))}
      />
      <PreviewGroup
        title="Курсы"
        icon={<LinkIcon size={14} />}
        items={props.links.map((l) => ({ label: l.title, href: l.url }))}
      />
      {/* Календарь, а не ссылка: `CalendarDays` был импортирован под эту группу, но
          не подставлен, и мероприятия печатались тем же значком, что курсы. На экране
          итогов оба вида чипов стоят в ОДНОМ ряду без подписей, так что значок —
          единственное различие; обе поверхности обязаны показывать одно и то же. */}
      <PreviewGroup
        title="Мероприятия"
        icon={<CalendarDays size={14} />}
        items={props.events.map((ev) => ({ label: ev.title, href: ev.url || undefined }))}
      />
    </div>
  );
}
