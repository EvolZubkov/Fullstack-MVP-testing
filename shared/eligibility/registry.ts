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
        name: "Основной каталог",
        version: "1.0.0",
        isActive: true,
        config: {
          sessionIdSource: "url.search.session_id",
          collectionEndpoint: "/pp/Ext5/extjs_json_collection_data.html",
          collectionCode: "rostelecom_catalog_data_grid",
          parametersTemplate:
            "cur_person_id={{personId}};sSearchWord=;sRoles=all;iCount=;sCatalogName=learning",
          courseSearchName: "{{test.title}}",
          limit: 500,
          attemptFilter: {
            stateField: "state",
            stateIn: ["Завершен", "Завершён", "Пройден"],
            excludeStateIn: ["Не начат"],
            progressField: "progress",
            progressCompletePattern: "^100\\b",
            dateField: "last_usage_date",
            dateFormat: "dd.MM.yyyy",
          },
        },
      },
    ],
  },
  {
    key: "suspend_data_cooldown",
    name: "SCORM suspend_data (best-effort)",
    version: "1.0.0",
    description:
      "Считает cooldown по дате, сохранённой в suspend_data. Надёжно только внутри той же SCORM registration; для строгого cooldown между попытками нужен внешний/LMS-источник.",
    isActive: true,
    runtimeEntry: "suspendDataCooldown",
    bestEffort: true,
    configs: [
      { id: "suspend_default", name: "По умолчанию", version: "1.0.0", isActive: true, config: {} },
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
