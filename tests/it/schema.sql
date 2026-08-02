CREATE TABLE "adaptive_level_links" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"level_id" varchar(36) NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL
);

CREATE TABLE "adaptive_levels" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"topic_id" varchar(36) NOT NULL,
	"level_index" integer NOT NULL,
	"level_name" text NOT NULL,
	"min_difficulty" integer NOT NULL,
	"max_difficulty" integer NOT NULL,
	"questions_count" integer NOT NULL,
	"pass_threshold" integer NOT NULL,
	"pass_threshold_type" text DEFAULT 'percent' NOT NULL,
	"feedback" text
);

CREATE TABLE "adaptive_topic_settings" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"topic_id" varchar(36) NOT NULL,
	"failure_feedback" text
);

CREATE TABLE "assignment_access_tokens" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"assignment_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_access_tokens_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE "attempts" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"test_version" integer DEFAULT 1 NOT NULL,
	"snapshot_id" varchar(36),
	"assignment_id" varchar(36),
	"variant_json" jsonb NOT NULL,
	"answers_json" jsonb,
	"result_json" jsonb,
	"section_timer_json" jsonb,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp
);

CREATE TABLE "content_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"topic_id" varchar(36),
	"position" text NOT NULL,
	"mode" text DEFAULT 'template' NOT NULL,
	"type" text NOT NULL,
	"kind" text NOT NULL,
	"template_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"values_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auto_advance" boolean DEFAULT false NOT NULL,
	"auto_advance_delay_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "folders" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" varchar(36),
	"created_by" varchar(36)
);

CREATE TABLE "groups" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(36)
);

CREATE TABLE "media_assets" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"kind" text NOT NULL,
	"original_name" text NOT NULL,
	"title" text,
	"owner_id" varchar(36),
	"visibility" text DEFAULT 'shared' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "media_usages" (
	"asset_id" varchar(36) NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar(36) NOT NULL,
	"field" text NOT NULL,
	CONSTRAINT "media_usages_asset_id_entity_type_entity_id_field_pk" PRIMARY KEY("asset_id","entity_type","entity_id","field")
);

CREATE TABLE "password_reset_tokens" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"request_ip" text
);

CREATE TABLE "question_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"question_id" varchar(36) NOT NULL,
	"scale_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_key" text,
	"value_json" jsonb NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"condition_json" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "questions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"topic_id" varchar(36) NOT NULL,
	"type" text NOT NULL,
	"prompt" text NOT NULL,
	"data_json" jsonb NOT NULL,
	"correct_json" jsonb NOT NULL,
	"difficulty" integer DEFAULT 50,
	"media_url" text,
	"media_type" text,
	"shuffle_answers" boolean DEFAULT true NOT NULL,
	"order_index" integer,
	"feedback" text,
	"feedback_mode" text DEFAULT 'general' NOT NULL,
	"feedback_correct" text,
	"feedback_incorrect" text,
	"content_hash" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" varchar(36)
);

CREATE TABLE "result_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"formula" text NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"learner_visibility" text DEFAULT 'hidden' NOT NULL,
	"scorm_target" text DEFAULT 'both' NOT NULL,
	"controls_status" text DEFAULT 'none' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "result_variables_name_check" CHECK ("result_variables"."name" ~ '^[a-z][a-z0-9_]{0,63}$')
);

CREATE TABLE "scales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"aggregation" text DEFAULT 'sum' NOT NULL,
	"normalization" text DEFAULT 'none' NOT NULL,
	"direction" text DEFAULT 'positive' NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"learner_visibility" text DEFAULT 'hidden' NOT NULL,
	"scorm_target" text DEFAULT 'none' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scales_key_check" CHECK ("scales"."key" ~ '^[a-z][a-z0-9_]{0,63}$')
);

CREATE TABLE "scorm_answers" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"attempt_id" varchar(36) NOT NULL,
	"question_id" varchar(36) NOT NULL,
	"question_prompt" text NOT NULL,
	"question_type" text NOT NULL,
	"topic_id" varchar(36),
	"topic_name" text,
	"difficulty" integer,
	"user_answer_json" jsonb NOT NULL,
	"correct_answer_json" jsonb NOT NULL,
	"is_correct" boolean NOT NULL,
	"points" integer NOT NULL,
	"max_points" integer NOT NULL,
	"options_json" jsonb,
	"left_items_json" jsonb,
	"right_items_json" jsonb,
	"items_json" jsonb,
	"level_index" integer,
	"level_name" text,
	"answered_at" timestamp NOT NULL
);

CREATE TABLE "scorm_attempts" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"package_id" varchar(36) NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"lms_user_id" text,
	"lms_user_name" text,
	"lms_user_email" text,
	"lms_user_org" text,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"last_activity_at" timestamp NOT NULL,
	"result_percent" integer,
	"result_passed" boolean,
	"total_points" integer,
	"max_points" integer,
	"total_questions" integer,
	"correct_answers" integer,
	"achieved_levels_json" jsonb,
	"failed_topic_courses_json" jsonb
);

CREATE TABLE "scorm_packages" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36),
	"test_title" text NOT NULL,
	"test_mode" text DEFAULT 'standard' NOT NULL,
	"secret_key" text NOT NULL,
	"api_base_url" text NOT NULL,
	"exported_at" timestamp NOT NULL,
	"created_by" varchar(36) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);

CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" text NOT NULL,
	"template_api_version" text DEFAULT '1.0' NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_type" text DEFAULT 'builtin' NOT NULL,
	"source_path" text,
	"manifest" jsonb NOT NULL,
	"preview_path" text,
	"validation_json" jsonb,
	"smoke_test_json" jsonb,
	"source_fingerprint" text,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "test_access_grants" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"access_level" text NOT NULL,
	"granted_by" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "test_assignments" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"user_id" varchar(36),
	"group_id" varchar(36),
	"due_date" timestamp,
	"link_expires_at" timestamp,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"assigned_by" varchar(36) NOT NULL
);

CREATE TABLE "test_folders" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(36)
);

CREATE TABLE "test_question_scoring" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"question_id" varchar(36) NOT NULL,
	"points" integer,
	"scoring_json" jsonb,
	"difficulty" integer,
	"pinned_content_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "test_sections" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"topic_id" varchar(36) NOT NULL,
	"draw_count" integer NOT NULL,
	"draw_all" boolean DEFAULT false NOT NULL,
	"topic_pass_rule_json" jsonb,
	"required" boolean DEFAULT true NOT NULL,
	"time_limit_minutes" integer,
	"feedback_json" jsonb,
	"draw_blueprint_json" jsonb,
	"form_set_json" jsonb,
	"question_order" text DEFAULT 'random' NOT NULL,
	"default_points" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "test_snapshots" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"version" integer NOT NULL,
	"content_json" jsonb NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"published_by" varchar(36)
);

CREATE TABLE "tests" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"folder_id" varchar(36),
	"owner_id" varchar(36),
	"title" text NOT NULL,
	"description" text,
	"mode" text DEFAULT 'standard' NOT NULL,
	"show_difficulty_level" boolean DEFAULT true NOT NULL,
	"overall_pass_rule_json" jsonb NOT NULL,
	"webhook_url" text,
	"published" boolean DEFAULT false,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"feedback" text,
	"feedback_json" jsonb,
	"flow_policy_json" jsonb,
	"telemetry_enabled" boolean DEFAULT false NOT NULL,
	"time_limit_minutes" integer,
	"max_attempts" integer,
	"show_correct_answers" boolean DEFAULT false NOT NULL,
	"start_page_content" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"design_settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retake_policy_json" jsonb,
	"default_question_points" integer,
	"allow_return_to_unanswered" boolean DEFAULT true NOT NULL,
	"allow_answer_change" boolean DEFAULT false NOT NULL,
	"show_section_results" boolean DEFAULT true NOT NULL,
	"report_settings_json" jsonb
);

CREATE TABLE "topic_access_grants" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"topic_id" varchar(36) NOT NULL,
	"grantee_id" varchar(36) NOT NULL,
	"access_level" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"granted_by" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "topics" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"feedback" text,
	"feedback_json" jsonb,
	"folder_id" varchar(36),
	"created_by" varchar(36),
	"owner_id" varchar(36),
	"visibility" text DEFAULT 'shared' NOT NULL,
	"name_normalized" text,
	"code" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "user_groups" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"group_id" varchar(36) NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "user_roles" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"role" text NOT NULL,
	"granted_by" varchar(36),
	"granted_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "users" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_hash" varchar(64),
	"password_hash" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"gdpr_consent" boolean DEFAULT false NOT NULL,
	"gdpr_consent_at" timestamp,
	"last_login_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(36),
	CONSTRAINT "users_email_hash_unique" UNIQUE("email_hash")
);

ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "question_measurements" ADD CONSTRAINT "question_measurements_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "question_measurements" ADD CONSTRAINT "question_measurements_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "question_measurements" ADD CONSTRAINT "question_measurements_scale_id_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."scales"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "result_variables" ADD CONSTRAINT "result_variables_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "scales" ADD CONSTRAINT "scales_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_question_scoring" ADD CONSTRAINT "test_question_scoring_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_question_scoring" ADD CONSTRAINT "test_question_scoring_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "attempts_user_test_idx" ON "attempts" USING btree ("user_id","test_id");
CREATE INDEX "attempts_test_id_idx" ON "attempts" USING btree ("test_id");
CREATE INDEX "attempts_snapshot_id_idx" ON "attempts" USING btree ("snapshot_id");
CREATE INDEX "content_pages_test_topic_position_sort_idx" ON "content_pages" USING btree ("test_id","topic_id","position","sort_order");
CREATE INDEX "content_pages_test_kind_idx" ON "content_pages" USING btree ("test_id","kind");
CREATE INDEX "content_pages_topic_id_idx" ON "content_pages" USING btree ("topic_id");
CREATE UNIQUE INDEX "media_assets_owner_checksum_idx" ON "media_assets" USING btree ("owner_id","checksum") WHERE "media_assets"."owner_id" is not null;
CREATE INDEX "media_assets_checksum_idx" ON "media_assets" USING btree ("checksum");
CREATE INDEX "media_usages_entity_idx" ON "media_usages" USING btree ("entity_type","entity_id");
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");
CREATE INDEX "question_measurements_test_id_idx" ON "question_measurements" USING btree ("test_id");
CREATE INDEX "question_measurements_question_id_idx" ON "question_measurements" USING btree ("question_id");
CREATE INDEX "question_measurements_scale_id_idx" ON "question_measurements" USING btree ("scale_id");
CREATE INDEX "questions_topic_id_idx" ON "questions" USING btree ("topic_id");
CREATE INDEX "result_variables_test_id_idx" ON "result_variables" USING btree ("test_id");
CREATE UNIQUE INDEX "result_variables_test_id_name_uq" ON "result_variables" USING btree ("test_id","name");
CREATE UNIQUE INDEX "result_variables_one_success_per_test" ON "result_variables" USING btree ("test_id") WHERE "result_variables"."controls_status" = 'success';
CREATE UNIQUE INDEX "result_variables_one_completion_per_test" ON "result_variables" USING btree ("test_id") WHERE "result_variables"."controls_status" = 'completion';
CREATE INDEX "scales_test_id_idx" ON "scales" USING btree ("test_id");
CREATE UNIQUE INDEX "scales_test_id_key_uq" ON "scales" USING btree ("test_id","key");
CREATE INDEX "scorm_answers_attempt_id_idx" ON "scorm_answers" USING btree ("attempt_id");
CREATE UNIQUE INDEX "scorm_attempts_session_attempt_idx" ON "scorm_attempts" USING btree ("package_id","session_id","attempt_number");
CREATE INDEX "scorm_packages_test_id_idx" ON "scorm_packages" USING btree ("test_id");
CREATE UNIQUE INDEX "test_access_grants_test_user_idx" ON "test_access_grants" USING btree ("test_id","user_id");
CREATE INDEX "test_assignments_test_id_idx" ON "test_assignments" USING btree ("test_id");
CREATE INDEX "test_assignments_user_id_idx" ON "test_assignments" USING btree ("user_id");
CREATE INDEX "test_assignments_group_id_idx" ON "test_assignments" USING btree ("group_id");
CREATE UNIQUE INDEX "test_question_scoring_test_question_idx" ON "test_question_scoring" USING btree ("test_id","question_id");
CREATE INDEX "test_question_scoring_question_id_idx" ON "test_question_scoring" USING btree ("question_id");
CREATE INDEX "test_sections_topic_id_idx" ON "test_sections" USING btree ("topic_id");
CREATE INDEX "test_sections_test_id_sort_order_idx" ON "test_sections" USING btree ("test_id","sort_order");
CREATE UNIQUE INDEX "test_snapshots_test_version_idx" ON "test_snapshots" USING btree ("test_id","version");
CREATE INDEX "tests_status_idx" ON "tests" USING btree ("status");
CREATE UNIQUE INDEX "topic_access_grants_topic_grantee_idx" ON "topic_access_grants" USING btree ("topic_id","grantee_id");
CREATE UNIQUE INDEX "topics_owner_name_normalized_idx" ON "topics" USING btree ("owner_id","name_normalized") WHERE owner_id IS NOT NULL;
CREATE INDEX "topics_updated_at_idx" ON "topics" USING btree ("updated_at");
CREATE UNIQUE INDEX "user_groups_user_group_idx" ON "user_groups" USING btree ("user_id","group_id");
CREATE UNIQUE INDEX "user_roles_user_role_idx" ON "user_roles" USING btree ("user_id","role");
