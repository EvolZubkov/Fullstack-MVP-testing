-- PRD-54 раздел 5.6 (BR-54-38 - BR-54-45): участник выгрузки LMS — внешняя учётная запись.
--
-- 1. `users.email` необязательна: у участника выгрузки почты нет, а выдуманный адрес хуже
--    отсутствующего (BR-54-42).
-- 2. `lms_import_batch_users` — что партия завела и куда добавила; по ней работает откат (BR-54-43).
-- 3. Перенос уже загруженного (BR-54-44): каждое импортированное прохождение без `user_id`
--    связывается с записью по `external_key` или получает новую внешнюю запись; участник становится
--    членом группы своей партии; учёт партий заполняется, чтобы откат старых партий работал так же.
-- 4. Метки групп, которых уже нет, снимаются с прохождений и партий (BR-54-45).
--
-- Аддитивная по классификации `predev`: ничего не удаляет и не переименовывает.
CREATE TABLE "lms_import_batch_users" (
	"batch_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"created_user" boolean DEFAULT false NOT NULL,
	"added_to_group" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lms_import_batch_users_pk" ON "lms_import_batch_users" USING btree ("batch_id","user_id");--> statement-breakpoint
CREATE INDEX "lms_import_batch_users_user_idx" ON "lms_import_batch_users" USING btree ("user_id");--> statement-breakpoint
-- Перенос: участник за участником. Существующая запись с тем же ключом (без учёта регистра — как
-- индекс уникальности `external_key`) важнее новой: это связывание, которое импорт сделал бы и сам.
DO $$
DECLARE
	r record;
	existing_id text;
	uid text;
	label text;
	n int;
	first_batch text;
BEGIN
	FOR r IN
		SELECT DISTINCT ON (participant_key)
			participant_key, lms_user_name, lms_user_org, lms_user_unit, lms_user_position
		FROM scorm_attempts
		WHERE origin = 'import' AND user_id IS NULL AND participant_key IS NOT NULL
		ORDER BY participant_key, started_at DESC
	LOOP
		SELECT id INTO existing_id FROM users WHERE lower(external_key) = lower(r.participant_key) LIMIT 1;
		IF existing_id IS NOT NULL THEN
			uid := existing_id;
		ELSE
			-- BR-54-40: ФИО, если его сохраняли; иначе подпись из восьми знаков ключа, удлиняемая
			-- до первой свободной среди внешних записей.
			IF r.lms_user_name IS NOT NULL AND btrim(r.lms_user_name) <> '' THEN
				label := r.lms_user_name;
			ELSE
				n := 8;
				LOOP
					label := 'Участник ' || left(r.participant_key, n);
					EXIT WHEN n >= length(r.participant_key)
						OR NOT EXISTS (SELECT 1 FROM users WHERE is_external AND name = label);
					n := n + 1;
				END LOOP;
			END IF;
			uid := gen_random_uuid()::text;
			INSERT INTO users (id, email, password_hash, name, is_external, status, must_change_password,
				external_key, organization, unit, position)
			VALUES (uid, NULL, NULL, label, true, 'active', false,
				r.participant_key, r.lms_user_org, r.lms_user_unit, r.lms_user_position);
			INSERT INTO user_roles (id, user_id, role) VALUES (gen_random_uuid()::text, uid, 'learner');
			-- Заведённой считается самая ранняя партия участника: откат любой другой его не тронет.
			SELECT a.batch_id INTO first_batch
			FROM scorm_attempts a JOIN lms_import_batches b ON b.id = a.batch_id
			WHERE a.origin = 'import' AND a.participant_key = r.participant_key
			ORDER BY b.imported_at LIMIT 1;
			IF first_batch IS NOT NULL THEN
				INSERT INTO lms_import_batch_users (batch_id, user_id, created_user) VALUES (first_batch, uid, true);
			END IF;
		END IF;
		UPDATE scorm_attempts SET user_id = uid
		WHERE origin = 'import' AND participant_key = r.participant_key AND user_id IS NULL;
	END LOOP;
END $$;
--> statement-breakpoint
-- BR-54-45: метки удалённых групп больше ни на что не указывают.
UPDATE scorm_attempts SET group_id = NULL
WHERE group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = scorm_attempts.group_id);--> statement-breakpoint
UPDATE lms_import_batches SET group_id = NULL
WHERE group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = lms_import_batches.group_id);--> statement-breakpoint
-- Учёт партий: каждая пара (партия, участник), в том числе связанные раньше.
INSERT INTO lms_import_batch_users (batch_id, user_id)
SELECT DISTINCT batch_id, user_id FROM scorm_attempts
WHERE origin = 'import' AND batch_id IS NOT NULL AND user_id IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- BR-54-41: членство по метке группы. Отметка «добавлено импортом» ставится самой ранней партии
-- этой группы у участника — откат снимет членство, когда прохождений с группой не останется.
WITH added AS (
	INSERT INTO user_groups (id, user_id, group_id)
	SELECT gen_random_uuid()::text, x.user_id, x.group_id
	FROM (
		SELECT DISTINCT user_id, group_id FROM scorm_attempts
		WHERE origin = 'import' AND user_id IS NOT NULL AND group_id IS NOT NULL
	) x
	WHERE NOT EXISTS (SELECT 1 FROM user_groups ug WHERE ug.user_id = x.user_id AND ug.group_id = x.group_id)
	RETURNING user_id, group_id
), marked AS (
	SELECT DISTINCT ON (ad.user_id, ad.group_id) ad.user_id, b.id AS batch_id
	FROM added ad
	JOIN lms_import_batches b ON b.group_id = ad.group_id
	JOIN lms_import_batch_users bu ON bu.batch_id = b.id AND bu.user_id = ad.user_id
	ORDER BY ad.user_id, ad.group_id, b.imported_at
)
UPDATE lms_import_batch_users bu SET added_to_group = true
FROM marked m WHERE bu.batch_id = m.batch_id AND bu.user_id = m.user_id;
