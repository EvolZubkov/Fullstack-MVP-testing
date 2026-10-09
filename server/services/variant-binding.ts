/**
 * @module server/services/variant-binding
 * @description Совместимость адреса. Молчаливое связывание системного экрана с
 * вариантом шаблона переехало в {@link module:shared/content-pages/variant-binding}
 * вместе с планировщиком, который его зовёт: правила связывания нужны и серверу, и
 * редактору, предсказывающему структуру несохранённого теста.
 *
 * Новый код импортирует из `@shared/content-pages/variant-binding` напрямую.
 */
export * from "@shared/content-pages/variant-binding";
