-- PRD-15 FR-07a (решение пересмотрено 2026-10-07): удалённый тест не оставляет следа в LMS-данных.
--
-- До этой миграции удаление теста сохраняло его телеметрию, загрузки выгрузок и пакеты, и
-- аналитика показывала их администратору строкой «Удалённый тест». Теперь `deleteTest` стирает
-- их той же транзакцией (`purgeTestLmsData`), а эта миграция один раз дочищает то, что накопилось
-- раньше. «Сирота» — строка, чей тест (у прохождения — свой `test_id`, у старой телеметрии — тест
-- пакета) в `tests` не найден или не известен вовсе.
--
-- Загрузки откатываются по правилу кнопки отката (PRD-54 BR-54-43, `rollbackLmsImportBatch`):
-- членство, поставленное загрузкой, и запись участника, заведённая ею, передаются ранней живой
-- загрузке того же участника (для членства — той же группы); без такой — членство снимается, а
-- внешняя запись удаляется, если больше ничем не занята.
--
-- Удаляет только СТРОКИ, схема не меняется: классификатор `predev` её не задерживает.

-- 1. Прохождения LMS без теста — сначала ответы, потом сами прохождения.
DELETE FROM "scorm_answers" AS s
WHERE s."attempt_id" IN (
  SELECT a."id" FROM "scorm_attempts" AS a
  WHERE NOT EXISTS (
    SELECT 1 FROM "tests" AS t
    WHERE t."id" = COALESCE(a."test_id", (SELECT p."test_id" FROM "scorm_packages" AS p WHERE p."id" = a."package_id"))
  )
);
--> statement-breakpoint
DELETE FROM "scorm_attempts" AS a
WHERE NOT EXISTS (
  SELECT 1 FROM "tests" AS t
  WHERE t."id" = COALESCE(a."test_id", (SELECT p."test_id" FROM "scorm_packages" AS p WHERE p."id" = a."package_id"))
);
--> statement-breakpoint

-- 2. Членство, поставленное загрузкой без теста: отметка переходит к ранней живой загрузке
--    участника в той же группе...
UPDATE "lms_import_batch_users" AS h
SET "added_to_group" = true
FROM (
  SELECT DISTINCT ON (o."user_id", ob."group_id") hu."batch_id", hu."user_id"
  FROM "lms_import_batch_users" AS o
  JOIN "lms_import_batches" AS ob ON ob."id" = o."batch_id"
  JOIN "lms_import_batch_users" AS hu ON hu."user_id" = o."user_id"
  JOIN "lms_import_batches" AS hb ON hb."id" = hu."batch_id" AND hb."group_id" = ob."group_id"
  WHERE o."added_to_group"
    AND ob."group_id" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = ob."test_id")
    AND EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = hb."test_id")
  ORDER BY o."user_id", ob."group_id", hb."imported_at"
) AS heir
WHERE h."batch_id" = heir."batch_id" AND h."user_id" = heir."user_id";
--> statement-breakpoint
-- ...а без неё снимается.
DELETE FROM "user_groups" AS ug
USING "lms_import_batch_users" AS o
JOIN "lms_import_batches" AS ob ON ob."id" = o."batch_id"
WHERE o."added_to_group"
  AND ob."group_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = ob."test_id")
  AND ug."user_id" = o."user_id"
  AND ug."group_id" = ob."group_id"
  AND NOT EXISTS (
    SELECT 1
    FROM "lms_import_batch_users" AS hu
    JOIN "lms_import_batches" AS hb ON hb."id" = hu."batch_id"
    WHERE hu."user_id" = o."user_id"
      AND hb."group_id" = ob."group_id"
      AND EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = hb."test_id")
  );
--> statement-breakpoint

-- 3. Запись участника, заведённая загрузкой без теста: отметка переходит к ранней живой
--    загрузке участника...
UPDATE "lms_import_batch_users" AS h
SET "created_user" = true
FROM (
  SELECT DISTINCT ON (o."user_id") hu."batch_id", hu."user_id"
  FROM "lms_import_batch_users" AS o
  JOIN "lms_import_batches" AS ob ON ob."id" = o."batch_id"
  JOIN "lms_import_batch_users" AS hu ON hu."user_id" = o."user_id"
  JOIN "lms_import_batches" AS hb ON hb."id" = hu."batch_id"
  WHERE o."created_user"
    AND NOT EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = ob."test_id")
    AND EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = hb."test_id")
  ORDER BY o."user_id", hb."imported_at"
) AS heir
WHERE h."batch_id" = heir."batch_id" AND h."user_id" = heir."user_id";
--> statement-breakpoint
-- ...а без неё внешняя запись удаляется, если ничем больше не занята: ни прохождениями (веб и
-- LMS), ни членством, ни назначениями, ни живой загрузкой. Сначала роли, потом запись.
DELETE FROM "user_roles" AS r
WHERE r."user_id" IN (
  SELECT o."user_id"
  FROM "lms_import_batch_users" AS o
  JOIN "lms_import_batches" AS ob ON ob."id" = o."batch_id"
  JOIN "users" AS u ON u."id" = o."user_id" AND u."is_external"
  WHERE o."created_user"
    AND NOT EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = ob."test_id")
    AND NOT EXISTS (
      SELECT 1 FROM "lms_import_batch_users" AS hu
      JOIN "lms_import_batches" AS hb ON hb."id" = hu."batch_id"
      WHERE hu."user_id" = o."user_id" AND EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = hb."test_id")
    )
    AND NOT EXISTS (SELECT 1 FROM "scorm_attempts" AS sa WHERE sa."user_id" = o."user_id")
    AND NOT EXISTS (SELECT 1 FROM "attempts" AS wa WHERE wa."user_id" = o."user_id")
    AND NOT EXISTS (SELECT 1 FROM "user_groups" AS g WHERE g."user_id" = o."user_id")
    AND NOT EXISTS (SELECT 1 FROM "test_assignments" AS ta WHERE ta."user_id" = o."user_id")
);
--> statement-breakpoint
-- Условие то же, что выше, плюс «ролей не осталось»: запись, роли которой шаг выше не тронул,
-- остаётся.
DELETE FROM "users" AS u
WHERE u."is_external"
  AND u."id" IN (
    SELECT o."user_id"
    FROM "lms_import_batch_users" AS o
    JOIN "lms_import_batches" AS ob ON ob."id" = o."batch_id"
    WHERE o."created_user"
      AND NOT EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = ob."test_id")
  )
  AND NOT EXISTS (
    SELECT 1 FROM "lms_import_batch_users" AS hu
    JOIN "lms_import_batches" AS hb ON hb."id" = hu."batch_id"
    WHERE hu."user_id" = u."id" AND EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = hb."test_id")
  )
  AND NOT EXISTS (SELECT 1 FROM "scorm_attempts" AS sa WHERE sa."user_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "attempts" AS wa WHERE wa."user_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "user_groups" AS g WHERE g."user_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "test_assignments" AS ta WHERE ta."user_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "user_roles" AS r WHERE r."user_id" = u."id");
--> statement-breakpoint

-- 4. Сами загрузки без теста и их учёт участников.
DELETE FROM "lms_import_batch_users" AS o
WHERE o."batch_id" IN (
  SELECT ob."id" FROM "lms_import_batches" AS ob
  WHERE NOT EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = ob."test_id")
);
--> statement-breakpoint
DELETE FROM "lms_import_batches" AS ob
WHERE NOT EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = ob."test_id");
--> statement-breakpoint

-- 5. Пакеты без теста: без строки пакета телеметрия копии в LMS получает 404.
DELETE FROM "scorm_packages" AS p
WHERE NOT EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = p."test_id");
--> statement-breakpoint

-- 6. Остальное, что без теста не значит ничего: экспозиция вопросов, сохранённые срезы
--    аналитики (у фильтров теста нет) и личные ссылки на прохождение и рецензирование.
DELETE FROM "question_exposure" AS e
WHERE NOT EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = e."test_id");
--> statement-breakpoint
DELETE FROM "analytics_slices" AS s
WHERE s."test_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = s."test_id");
--> statement-breakpoint
DELETE FROM "assignment_access_tokens" AS k
WHERE NOT EXISTS (SELECT 1 FROM "tests" AS t WHERE t."id" = k."test_id");
