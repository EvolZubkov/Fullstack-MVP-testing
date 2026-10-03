/**
 * @module features/analytics/levels/legacy-test-analytics-redirect
 * @description Перенаправление со старого адреса аналитики теста `/author/tests/:testId/analytics`
 * на уровень теста `/author/analytics/tests/:testId` (Э2). На старый адрес ведут закладки и
 * ссылки, разосланные до Э2; условия отбора и вкладка доезжают, `?questionId=` — на адрес вопроса.
 */
import { Redirect, useParams, useSearch } from "wouter";
import { legacyTestRedirect } from "./analytics-routes";

export function LegacyTestAnalyticsRedirect() {
  const { testId } = useParams<{ testId: string }>();
  const search = useSearch();
  // `replace`: старый адрес не должен оставаться в истории — «назад» с него вернул бы сюда же.
  return <Redirect to={legacyTestRedirect(testId, search)} replace />;
}
