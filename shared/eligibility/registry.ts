/**
 * @module shared/eligibility/registry
 *
 * Seeded registry of eligibility plugins + admin-managed configs (PRD-6 §3.5).
 * In Phase 1 this is a static, in-code list (mirrors how `templates` ship): the
 * author UI lists active plugins/configs from here, the SCORM export bundles the
 * chosen plugin's `runtimeEntry`, and the runtime reads the config. A DB-backed
 * admin registry with CRUD (`eligibility_plugins` / `eligibility_plugin_configs`)
 * is Phase 2; this module is the single source of truth until then.
 */

export interface EligibilityPluginConfig {
  id: string;
  name: string;
  version: string;
  isActive: boolean;
  /** Endpoints, attempt filter, date parsing — opaque to Core (PRD-6 §5.3). */
  config: Record<string, unknown>;
}

export interface EligibilityPluginEntry {
  key: string;
  name: string;
  version: string;
  description: string;
  isActive: boolean;
  /** Runtime adapter id bundled into the package (PRD-6 §5.2 `runtime_entry`). */
  runtimeEntry: string;
  /** True for best-effort sources that warrant a UI warning (PRD-6 §4.6). */
  bestEffort: boolean;
  configs: EligibilityPluginConfig[];
}

export const ELIGIBILITY_PLUGINS: EligibilityPluginEntry[] = [
  {
    key: "webtutor_cooldown",
    name: "WebTutor: период охлаждения",
    version: "1.0.0",
    description:
      "Берёт записи курса из WebTutor, выбирает последнюю полноценную попытку по настраиваемому фильтру и считает cooldown по календарным датам.",
    isActive: true,
    runtimeEntry: "webtutorCooldown",
    bestEffort: false,
    configs: [
      {
        id: "webtutor_catalog_default",
        name: "Ростелеком · каталог обучения (записи попыток)",
        version: "1.0.0",
        isActive: true,
        // Reads the learner's LEARNING RECORDS from WebTutor's ExtJS JSON collection
        // endpoint (same-origin, learner session). This — not the course card — is the
        // source that satisfies the requirement "cooldown fires after ANY completion,
        // passed OR failed": the card only carries a date for a PASSED course, so it
        // can never gate a failed attempt. The collection carries state/progress/
        // last_usage_date for EVERY attempt.
        //
        // The `attemptFilter` counts a record as a completed attempt by PROGRESS
        // (100%), regardless of pass/fail state, excluding only not-started records —
        // so a failed-but-finished attempt starts the cooldown too. Exact WebTutor
        // state/progress field names + values are portal-specific (admin-tuned,
        // NFR-03) and MUST be confirmed against the live catalog response before
        // rollout; the gate logs the raw records + applied filter for that.
        config: {
          source: "extjs_collection_records",
          // Confirmed against the live RT portal («Мои обучения» grid). POST form:
          // secid + collection_code + parameters + referer_url + page/start, header
          // X-Requested-With. Records under `results` (last_usage_date DESC).
          collectionEndpoint: "/pp/Ext5/extjs_json_collection_data.html",
          collectionCode: "rostelecom_catalog_data_grid",
          // `parameters` is one `;`-joined string. cur_person_id is left EMPTY: the
          // endpoint scopes to the learner by the SESSION COOKIE (confirmed live — the
          // request returns the caller's 384 records with cur_person_id= empty), so no
          // fragile person_id scraping is needed. {{personId}} stays for deployments
          // that DO require it (set personIdSource); with none it resolves to "".
          parametersTemplate:
            "cur_person_id={{personId}};sSearchWord={{test.title}};sRoles=all;iCount=;sCatalogName=learning",
          // Only the SECID (session token) is scraped from the portal chrome (32-hex on
          // «/»); it is not in SCORM pre-Initialize. No personIdSource — session-scoped.
          secidSource: { endpoint: "/", pattern: "[A-F0-9]{32}" },
          limit: 500,
          attemptFilter: {
            // A record is a FINISHED attempt (any outcome) when state is «Пройден» OR
            // «Не пройден» — the RT grid uses these for pass/fail; BOTH start the
            // cooldown. Completion is decided by `state`, NOT progress («X из Y баллов»
            // is not a percent), so no progressCompletePattern.
            stateField: "state",
            stateIn: ["Пройден", "Не пройден"],
            // PRD-40: the subset of stateIn counted as a PASSED attempt — same text
            // the RT portal already reports, confirmed live (PRD-6 §3.6 header note).
            passedStateIn: ["Пройден"],
            dateField: "last_usage_date",
            dateFormat: "dd.MM.yyyy",
            // Assignments of one course share `name`; match all of them (one course).
            nameField: "name",
            // «31.12.9999» = open-ended assignment never actually taken -> not an attempt.
            excludeDateValues: ["31.12.9999", "9999"],
          },
        },
      },
    ],
  },
];

/** Active plugins for the author's read-only picker (PRD-6 §4.1). */
export function listActiveEligibilityPlugins(): EligibilityPluginEntry[] {
  return ELIGIBILITY_PLUGINS.filter((p) => p.isActive);
}

export function findEligibilityPlugin(key: string | null | undefined): EligibilityPluginEntry | undefined {
  if (!key) return undefined;
  return ELIGIBILITY_PLUGINS.find((p) => p.key === key);
}

export function findEligibilityConfig(
  key: string | null | undefined,
  configId: string | null | undefined,
): EligibilityPluginConfig | undefined {
  const plugin = findEligibilityPlugin(key);
  if (!plugin) return undefined;
  if (!configId) return plugin.configs.find((c) => c.isActive);
  return plugin.configs.find((c) => c.id === configId);
}
