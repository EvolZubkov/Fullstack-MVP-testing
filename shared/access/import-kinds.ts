/**
 * @module shared/access/import-kinds
 *
 * Виды файлов раздела «Импорт» и право, которым открывается каждый (этап Э6 UX-аудита
 * аналитики, решение владельца 2026-10-02: «единая точка импорта, права — по виду файла»).
 *
 * Одна таблица на сервер и клиент: ручка разбора файла отказывает по ней, раздел по ней решает,
 * какие виды перечислить и какие форматы принять, меню — показывать ли пункт «Импорт». Две
 * копии соответствия разошлись бы молча: клиент предложил бы вид, на котором сервер откажет.
 */

import type { Capability } from "./capabilities";
import { hasPermission } from "./permissions";
import type { Role } from "./roles";

/** Вид файла, который принимает раздел «Импорт». */
export type ImportKind = "workbook" | "lmsExport" | "users" | "package" | "template";

/**
 * Право на каждый вид файла.
 *
 * Книга с вопросами — право импорта вопросов (запись в тест проверяет своё право дальше, по
 * ветке); выгрузка отчёта LMS — право загрузки выгрузок (тест файла проверяется областью
 * аналитики); пакет теста — создание теста; список пользователей — создание пользователей (роли
 * строк режет потолок назначения ролей PRD-13); шаблон оформления — управление шаблонами.
 */
export const IMPORT_KIND_CAPABILITY: Readonly<Record<ImportKind, Capability>> = {
  workbook: "questions.importExport",
  lmsExport: "analytics.import",
  users: "users.create",
  package: "tests.create",
  template: "adminTemplates.manage",
};

/** Все виды в порядке перечня раздела «Импорт». */
export const IMPORT_KINDS: readonly ImportKind[] = ["workbook", "lmsExport", "package", "users", "template"];

/** Права, открывающие раздел «Импорт»: любое из прав на какой-либо вид файла. */
export const IMPORT_CAPABILITIES: readonly Capability[] = IMPORT_KINDS.map(kind => IMPORT_KIND_CAPABILITY[kind]);

/**
 * Виды файлов, которые разрешено загружать набору ролей.
 *
 * @param roles действующие роли пользователя
 * @returns виды в порядке перечня
 */
export function importKindsFor(roles: readonly Role[]): ImportKind[] {
  return IMPORT_KINDS.filter(kind => hasPermission(roles, IMPORT_KIND_CAPABILITY[kind]));
}

/** Есть ли у набора ролей право хотя бы на один вид файла — то есть открыт ли раздел. */
export function canImportAny(roles: readonly Role[]): boolean {
  return importKindsFor(roles).length > 0;
}
