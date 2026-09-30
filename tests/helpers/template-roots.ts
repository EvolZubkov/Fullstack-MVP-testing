/**
 * @module tests/helpers/template-roots
 *
 * Единственное место, которое знает, ГДЕ лежит каждый шаблон оформления.
 *
 * Шаблоны живут в двух разных местах, и это следствие их жизненного цикла, а не
 * случайность:
 *
 *   - `default` — встроенный, поставляется вместе с продуктом и лежит в его дереве;
 *   - `certification` и `standard-rt` вынесены в СОБСТВЕННЫЕ репозитории: у них своя
 *     история, свои версии в `manifest.json` и свои релизы с собранными ZIP.
 *
 * Тесты паритета обязаны видеть все три: смысл паритета в том, что поставляемый и
 * внешние шаблоны печатают одну и ту же разметку. Поэтому путь к вынесенным задаётся
 * здесь одной строкой, а не повторяется в каждом тесте.
 *
 * Каталог с репозиториями шаблонов берётся из `SKILLUM_TEMPLATES_DIR`, а без неё —
 * из первого места, где лежат ОБА вынесенных шаблона: рядом с репозиторием продукта
 * (соседние клоны), в `../templates`, в согласованном расположении на рабочей машине.
 * Отсутствие шаблона на месте должно РОНЯТЬ тест (см. `template-roots.test.ts`):
 * молчаливый пропуск паритетной проверки неотличим от её успеха.
 */

import fs from "node:fs";
import path from "node:path";

/** Идентификаторы всех шаблонов, участвующих в проверках паритета. */
export const TEMPLATE_IDS = ["default", "certification", "standard-rt"] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** Согласованное место на рабочей машине, куда собраны репозитории вынесенных шаблонов. */
const DEFAULT_EXTERNAL_DIR = path.join("C:", "Repositories", "skill'um", "templates");

/** Имя репозитория каждого вынесенного шаблона внутри этого каталога. */
const EXTERNAL_REPOS: Record<Exclude<TemplateId, "default">, string> = {
  certification: "skillum-template-certification",
  "standard-rt": "skillum-template-standard-rt",
};

/**
 * Места, где ищутся репозитории вынесенных шаблонов, в порядке предпочтения.
 *
 * Жёсткий путь Windows работал только на одной машине: в любом другом окружении
 * (Linux, облачная сессия, CI) все паритетные наборы падали на чтении файла, и
 * настоящие падения терялись среди восьмидесяти ложных.
 * @returns {string[]} Каталоги-кандидаты.
 */
export function externalTemplatesCandidates(): string[] {
  const product = process.cwd();
  return [
    path.resolve(product, ".."),
    path.resolve(product, "..", "templates"),
    DEFAULT_EXTERNAL_DIR,
  ];
}

/** Лежат ли в каталоге оба вынесенных шаблона. */
function holdsAllExternal(dir: string): boolean {
  return Object.values(EXTERNAL_REPOS).every((repo) =>
    fs.existsSync(path.join(dir, repo, "template", "manifest.json")),
  );
}

/**
 * Каталог, в котором лежат репозитории вынесенных шаблонов.
 *
 * Явная переменная окружения побеждает всегда — даже если по ней шаблонов нет: заданный
 * руками путь не подменяется найденным где-то ещё. Без неё берётся первый кандидат, где
 * лежат оба шаблона, а если такого нет — согласованное умолчание, и тест падает на нём.
 * @returns {string} Путь из `SKILLUM_TEMPLATES_DIR`, найденный кандидат либо умолчание.
 */
export function externalTemplatesDir(): string {
  const fromEnv = process.env.SKILLUM_TEMPLATES_DIR;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  return externalTemplatesCandidates().find(holdsAllExternal) ?? DEFAULT_EXTERNAL_DIR;
}

/**
 * Корень шаблона — каталог, содержимое которого попадает в корень ZIP-пакета.
 * @param {TemplateId} id Идентификатор шаблона.
 * @returns {string} Абсолютный путь к корню шаблона.
 */
export function templateRoot(id: TemplateId): string {
  if (id === "default") {
    return path.join(process.cwd(), "server", "scorm", "templates", "default");
  }
  return path.join(externalTemplatesDir(), EXTERNAL_REPOS[id], "template");
}

/** Каталог раскладок шаблона. */
export function templateLayouts(id: TemplateId): string {
  return path.join(templateRoot(id), "layouts");
}

/** Каталог стилей шаблона. */
export function templateStyles(id: TemplateId): string {
  return path.join(templateRoot(id), "styles");
}

/** Файл манифеста шаблона. */
export function templateManifest(id: TemplateId): string {
  return path.join(templateRoot(id), "manifest.json");
}

/** Путь к файлу внутри шаблона: `templateFile("default", "layouts/start.html")`. */
export function templateFile(id: TemplateId, relative: string): string {
  return path.join(templateRoot(id), ...relative.split("/"));
}

/** Человеческие имена шаблонов — для сообщений и таблиц в тестах. */
export const TEMPLATE_NAMES: Record<TemplateId, string> = {
  default: "Стандартный",
  certification: "Сертификация (РТК)",
  "standard-rt": "Стандартный Ростелеком",
};
