/**
 * @module features/analytics/invalidate-analytics
 * @description Сброс кэша всех запросов аналитики после того, как изменилась выборка.
 *
 * Ключи запросов аналитики — ЦЕЛЫЕ адреса одним элементом (`"/api/analytics/psychometrics/t1"`,
 * `"/api/analytics/tests/t1"` + условия вторым элементом): так их собирает общий загрузчик
 * `getQueryFn`, склеивая ключ в адрес. React Query сравнивает элементы ключа целиком, поэтому
 * сброс по ключу `["/api/analytics"]` не совпадал ни с одним из них и не сбрасывал ничего —
 * после импорта или снятия загрузки с учёта страница показывала прежние числа.
 */
import type { QueryClient } from "@tanstack/react-query";

/** Путь, с которого начинаются адреса всех ручек аналитики. */
const ANALYTICS_PREFIX = "/api/analytics";

/**
 * Пометить устаревшими все запросы аналитики; открытые на экране перезапросятся сразу.
 *
 * @param client клиент React Query
 * @returns обещание, которое разрешается после перезапроса активных запросов
 */
export function invalidateAnalytics(client: QueryClient): Promise<void> {
  return client.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      return typeof head === "string"
        && (head === ANALYTICS_PREFIX || head.startsWith(`${ANALYTICS_PREFIX}/`) || head.startsWith(`${ANALYTICS_PREFIX}?`));
    },
  });
}
