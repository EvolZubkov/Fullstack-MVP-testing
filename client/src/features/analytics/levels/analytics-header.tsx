/**
 * @module features/analytics/levels/analytics-header
 * @description Шапка уровня аналитики (Э2, эскиз `docs/wireframes/approved/e2-analytics-levels.html`):
 * хлебные крошки, заголовок, подзаголовок «объём · источники», действия справа. Одна на три
 * уровня — общую аналитику, тест и вопрос в тесте; на общем уровне крошек нет, он корень.
 *
 * Крошка — переход маршрутизатора, а не перезагрузка страницы: у крошки «Аналитика» есть
 * состояние истории (адрес возврата), и полная загрузка его потеряла бы.
 */
import type { MouseEvent, ReactNode } from "react";
import { useLocation } from "wouter";
import { Breadcrumbs, Cluster, Stack, Text } from "@skillum/ui-kit";

/** Одна крошка: подпись и, кроме текущего уровня, адрес перехода. */
export interface AnalyticsCrumb {
  label: string;
  /** Адрес уровня; у текущего (последнего) не задаётся. */
  href?: string;
  /** Состояние записи истории для перехода (адрес возврата крошки «Аналитика»). */
  state?: unknown;
}

export interface AnalyticsHeaderProps {
  /** Путь до уровня, последним — сам уровень. Пусто — корень, крошек нет. */
  crumbs?: AnalyticsCrumb[];
  /** Заголовок уровня. */
  title: ReactNode;
  /** Строка под заголовком: объём, источники, особенности выборки. */
  subtitle?: ReactNode;
  /** Действия справа: экспорт, переход в реестр, «Обновить». */
  actions?: ReactNode;
}

export function AnalyticsHeader({ crumbs = [], title, subtitle, actions }: AnalyticsHeaderProps) {
  const [, navigate] = useLocation();

  const items = crumbs.map((crumb) => ({
    label: crumb.label,
    href: crumb.href,
    onClick: crumb.href
      ? (event: MouseEvent) => {
          // Переход внутри приложения: без перезагрузки и с состоянием истории.
          event.preventDefault();
          navigate(crumb.href!, crumb.state === undefined ? undefined : { state: crumb.state });
        }
      : undefined,
  }));

  return (
    // Кнопки держатся справа одной строкой: при нехватке места переносится заголовок, а не
    // кнопки. Прежде группа переносилась сама, и при длинном вопросе «Предыдущий», «Следующий» и
    // меню вставали в столбик по одной (замечание владельца 2026-10-04).
    <Cluster justify="between" align="start" wrap={false}>
      <Stack gap={1} align="start" className="tb-analytics-head__title">
        {items.length > 0 && <Breadcrumbs items={items} />}
        <Text as="h1" variant="heading-l">{title}</Text>
        {subtitle && <Text tone="muted">{subtitle}</Text>}
      </Stack>
      {actions && (
        // Кнопки одной группы — 4 px, как в эскизе (план сверки 6.2, 6.4).
        <Cluster gap={1} justify="end" align="center" wrap={false} className="tb-analytics-head__actions">{actions}</Cluster>
      )}
    </Cluster>
  );
}
