/**
 * @module features/home/use-home
 * @description PRD-25 FR-14/FR-21: one request for the whole home page, refreshed
 * when the user comes back to the tab — the same freshness contract the learner
 * test list already uses, so a finished attempt does not linger as «в процессе».
 */
import { useQuery } from "@tanstack/react-query";
import type { HomePayload } from "@shared/home/contract";

/**
 * Load the aggregated home-page payload.
 *
 * @returns the React Query result carrying `HomePayload`; every section key is
 *   optional and its absence means «no right to this section» (FR-02).
 */
export function useHome() {
  return useQuery<HomePayload>({
    queryKey: ["/api/home"],
    refetchOnWindowFocus: true,
  });
}
