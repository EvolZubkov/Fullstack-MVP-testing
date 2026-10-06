/**
 * @module server/services/analytics/scale-ramp
 * @description PRD-56 FR-21a: рампа уровней шкал теста — откуда аналитика берёт цвета полос.
 *
 * Одна функция на вкладку «Шкалы» и на сравнение срезов (FR-07l): иначе один и тот же уровень
 * окрасился бы на двух экранах по-разному. Рампа собирается из параметров оформления теста той же
 * функцией, какой её собирает экран итогов участника, с умолчаниями манифеста АКТИВНОГО шаблона:
 * схему уровней нетронутого теста выбирает шаблон, и аналитика обязана её повторить.
 */
import { rampFromParams, type LevelRamp } from "@shared/template/level-ramp";
import { withParamDefaults } from "@shared/template/params-css";
import { resolveTemplateDir } from "../template-dir";
import { readManifestParams } from "../template-render";

/**
 * Рампа уровней теста.
 *
 * @param test тест с его настройками оформления
 * @returns рампа для раскраски полос толкования
 */
export async function scaleRampOf(test: { designSettingsJson?: unknown }): Promise<LevelRamp> {
  const design = (test.designSettingsJson ?? {}) as { params?: Record<string, unknown>; templateId?: string };
  const templateDir = await resolveTemplateDir(design.templateId || "default", { activeOnly: true });
  return rampFromParams(withParamDefaults(design.params ?? {}, readManifestParams(templateDir)));
}
