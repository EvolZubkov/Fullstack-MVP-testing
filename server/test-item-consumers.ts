/**
 * @module server/test-item-consumers
 *
 * Реестр мест, которые читают разделы теста, — и решение каждого о втором виде пункта, сценарии
 * (docs/specs/sim-scenario/plan-tests.md, раздел 4, пункт 3).
 *
 * Главная опасность второго вида пункта — место, которое знает только разделы и молча пропускает
 * сценарий. Архитектурный тест `tests/test-item-consumers.test.ts` проходит по коду и падает, если
 * модуль читает разделы (`getTestSections…`, таблица `testSections`), а здесь его нет. Новое место
 * без явного решения в ветку не попадёт — тем же приёмом, каким тест признаков типов вопроса
 * требует решения по каждому признаку.
 *
 * Решения:
 * - `handles` — пункт-сценарий учтён (часто — потому что модуль читает разделы через источник
 *   выдачи `server/services/test-snapshot`, который сам добавляет пункты);
 * - `not-applicable` — пункт этому месту не нужен, и причина названа;
 * - `gap` — пункт ещё не учтён, это известная работа; указан этап, где она закрывается.
 */

/** Решение модуля о пункте-сценарии. */
export type ItemDecision =
  | { decision: "handles"; how: string }
  | { decision: "not-applicable"; why: string }
  | { decision: "gap"; stage: string; what: string };

/** Модули сервера, читающие разделы теста, по путю от корня репозитория. */
export const ITEM_CONSUMERS: Record<string, ItemDecision> = {
  "server/services/test-snapshot.ts": { decision: "handles", how: "Источник выдачи: синтезирует разделы пунктов (`deliverySections`), снимок морозит `scenarios`" },
  "server/routes/attempts.ts": { decision: "handles", how: "Читает разделы через источник выдачи; пул пункта — `getScenarioPool`; ответ переигрывается" },
  "server/routes/tests.ts": { decision: "handles", how: "Редактор получает и сохраняет пункты (`scenarios`)" },
  "server/services/test-settings.ts": { decision: "handles", how: "Сохраняет пункты в той же транзакции, что разделы; id стабильны" },
  "server/storage.ts": { decision: "handles", how: "Фасад: `getTestScenarios`, `getTestScenariosByTopic`" },
  "server/storage/tests-repository.ts": { decision: "handles", how: "Чтение пунктов; удаление теста удаляет и пункты" },
  "server/services/media/asset-access.ts": { decision: "handles", how: "Вопрос ведёт к тесту и через пункт-сценарий на теме-банке" },
  "server/scorm/build-export-data.ts": { decision: "handles", how: "Раздел пункта уходит в пакет темой-банком под ключом и именем пункта, с пулом сценариев; пустой пул — отказ 422 (Э4)" },
  "server/services/effective-scoring.ts": { decision: "handles", how: "Читает разделы через источник выдачи: у раздела пункта нет своей цены, цепочка идёт к тесту" },
  "server/services/scale-composition.ts": { decision: "handles", how: "Читает разделы через источник выдачи; у сценария нет вкладов в шкалы" },
  "server/services/home/assigned.ts": { decision: "handles", how: "У теста «Сценарий» задание одно — счёт по режиму; пункты роутера в число вопросов не входят" },
  "server/services/home/my-tests.ts": { decision: "handles", how: "У теста «Сценарий» задание одно — счёт по режиму; пункты роутера в число вопросов не входят" },
  "server/routes/questions.ts": { decision: "not-applicable", why: "Разделы читаются для экспорта вопросов теста в книгу, а сценарии книга не переносит — они переносятся архивом" },
  "server/routes/content-pages.ts": { decision: "not-applicable", why: "Страницы «перед темой / после темы» привязаны к теме; у пункта-сценария таких страниц нет" },
  "server/services/breakdown-warnings.ts": { decision: "not-applicable", why: "Разрезы и квоты PRD-50 считаются по тегам вопросов раздела; у пункта-сценария их нет" },
  "server/storage/scales-variables-repository.ts": { decision: "not-applicable", why: "Вклады в шкалы — по вопросам с вариантами; у сценария их нет" },
  "server/services/media/usage-index.ts": { decision: "not-applicable", why: "Индексирует обратную связь разделов; у пункта-сценария своей обратной связи нет" },
  "server/storage/topics-repository.ts": { decision: "not-applicable", why: "Переименование темы в формулах показателей: формула ссылается на темы разделов, не на банки пунктов" },
  "server/services/draw-feasibility.ts": { decision: "handles", how: "Охрана содержимого и проверка публикации: пункт, оставшийся без сценария, — находка `scenario_item_empty`" },
  "server/services/delivery-pool.ts": { decision: "gap", stage: "Э5", what: "Пул выдачи для аналитики не включает пункты-сценарии" },
  "server/routes/analytics/answer-slices.ts": { decision: "gap", stage: "Э5", what: "Аналитика ответов по сценариям" },
  "server/routes/analytics/delivery.ts": { decision: "gap", stage: "Э5", what: "Профиль выдачи пунктов-сценариев" },
  "server/routes/analytics/psychometrics.ts": { decision: "gap", stage: "Э5", what: "Психометрия сценариев" },
  "server/routes/analytics/question-card.ts": { decision: "handles", how: "Сценарий входит в тест пунктом: тема-банк проверяется по пунктам, карточка несёт задание, пункт и выдачу (Э5б)" },
  "server/routes/analytics/question-delivery.ts": { decision: "gap", stage: "Э5", what: "Выдача вопроса-сценария по тестам" },
  "server/routes/analytics/slices.ts": { decision: "gap", stage: "Э5", what: "Срезы по пунктам-сценариям" },
  "server/services/analytics/test-answer-facts.ts": { decision: "handles", how: "Вопрос-сценарий приходит из выданного варианта; цена — по источнику выдачи с разделами пунктов (Э5б)" },
  "server/services/analytics/test-psychometrics.ts": { decision: "gap", stage: "Э5", what: "Психометрия теста с пунктами-сценариями" },
  "server/services/lms-export-import.ts": { decision: "gap", stage: "Э5", what: "Импорт выгрузки LMS не сопоставляет ответы пунктам-сценариям" },
  "server/services/lms-test-resolver.ts": { decision: "gap", stage: "Э5", what: "Опознание теста по выгрузке не видит тем-банков пунктов" },
  "server/routes/tests-workbook.ts": { decision: "not-applicable", why: "Книга — формат содержимого: сценарии в ней не переносятся (вопрос — архивом, тест целиком — пакетом `.tbtest`); режим «Сценарий» книга называет" },
  "server/services/workbook-import.ts": { decision: "handles", how: "Пункты не трогает: правила разблокировки `scenario:<id>` и места сценариев в `router.itemOrder` переживают книгу (`keepRouterItemsFromBook`)" },
  "server/services/test-transfer/target.ts": { decision: "handles", how: "Пакет — снимок теста целиком, с `scenarios`; цель читает пункты, diff ведёт их по id, ключи `scenario:<id>` перенумеровываются (`remapItemKey`)" },
  "server/storage/test-transfer-repository.ts": { decision: "handles", how: "Пишет пункты-сценарии и при копии целиком, и при выборочном импорте" },
};
