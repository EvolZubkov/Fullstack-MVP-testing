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

CREATE TABLE "analytics_slices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'slice' NOT NULL,
	"test_id" varchar(36),
	"conditions_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" varchar(36) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_slices_slice_has_test" CHECK ("analytics_slices"."kind" <> 'slice' OR "analytics_slices"."test_id" IS NOT NULL)
);

CREATE TABLE "assignment_access_tokens" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"assignment_id" varchar(36),
	"user_id" varchar(36) NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"purpose" text DEFAULT 'attempt' NOT NULL,
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
	"hidden" boolean DEFAULT false NOT NULL,
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

CREATE TABLE "lms_import_batch_users" (
	"batch_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"created_user" boolean DEFAULT false NOT NULL,
	"added_to_group" boolean DEFAULT false NOT NULL
);

CREATE TABLE "lms_import_batches" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"group_id" varchar(36),
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"anonymized" boolean NOT NULL,
	"source_anonymized" boolean NOT NULL,
	"link_users" boolean NOT NULL,
	"imported_by" varchar(36) NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_created" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"rows_linked" integer DEFAULT 0 NOT NULL,
	"rows_unmatched" integer DEFAULT 0 NOT NULL,
	"warnings_json" jsonb
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

CREATE TABLE "question_exposure" (
	"question_id" varchar(36) NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"bucket_month" date NOT NULL,
	"source" text DEFAULT 'live' NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "question_exposure_question_id_test_id_bucket_month_source_pk" PRIMARY KEY("question_id","test_id","bucket_month","source")
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
	"prompt_format" text DEFAULT 'markdown' NOT NULL,
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
	"option_feedback_json" jsonb,
	"content_hash" text,
	"psycho_hash" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" varchar(36)
);

CREATE TABLE "report_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"mode" text NOT NULL,
	"block" text NOT NULL,
	"template_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"values_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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

CREATE TABLE "saved_list_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"conditions_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" varchar(36) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "saved_list_filters_scope_known" CHECK ("saved_list_filters"."scope" IN ('content', 'tests', 'users'))
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
	"correct_answer_json" jsonb,
	"result" text DEFAULT 'incorrect' NOT NULL,
	"is_correct" boolean,
	"points" integer,
	"max_points" integer,
	"options_json" jsonb,
	"left_items_json" jsonb,
	"right_items_json" jsonb,
	"items_json" jsonb,
	"level_index" integer,
	"level_name" text,
	"latency_ms" integer,
	"answered_at" timestamp NOT NULL
);

CREATE TABLE "scorm_attempts" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"package_id" varchar(36),
	"session_id" varchar(64),
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"test_id" varchar(36),
	"origin" text DEFAULT 'telemetry' NOT NULL,
	"batch_id" varchar(36),
	"group_id" varchar(36),
	"participant_key" text,
	"attempt_key" text,
	"user_id" varchar(36),
	"scales_json" jsonb,
	"variables_json" jsonb,
	"snapshot_id" varchar(36),
	"forms_json" jsonb,
	"delivered_question_ids" jsonb,
	"lms_user_id" text,
	"lms_user_name" text,
	"lms_user_email" text,
	"lms_user_org" text,
	"lms_user_unit" text,
	"lms_user_position" text,
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
	"excluded_from_delivery" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "test_review_comments" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"author_id" varchar(36) NOT NULL,
	"parent_id" varchar(36),
	"body" text NOT NULL,
	"anchor_kind" text NOT NULL,
	"question_id" varchar(36),
	"topic_id" varchar(36),
	"content_page_id" uuid,
	"context_label" text,
	"pinned_content_hash" text,
	"status" text,
	"resolved_by" varchar(36),
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "test_scenarios" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"topic_id" varchar(36) NOT NULL,
	"question_id" varchar(36),
	"title" text,
	"required" boolean DEFAULT true NOT NULL,
	"time_limit_minutes" integer,
	"image_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL
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
	"breakdown_feedback_json" jsonb,
	"interpretation_json" jsonb,
	"breakdown_interpretation_json" jsonb,
	"group_key" text,
	"question_order" text,
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
	"description_format" text DEFAULT 'plain' NOT NULL,
	"mode" text DEFAULT 'standard' NOT NULL,
	"show_difficulty_level" boolean DEFAULT true NOT NULL,
	"overall_pass_rule_json" jsonb NOT NULL,
	"pass_decision_policy" text DEFAULT 'overall_only' NOT NULL,
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
	"question_order" text DEFAULT 'random' NOT NULL,
	"allow_return_to_unanswered" boolean DEFAULT true NOT NULL,
	"allow_answer_change" boolean DEFAULT false NOT NULL,
	"allow_free_section_navigation" boolean DEFAULT false NOT NULL,
	"quick_advance" boolean DEFAULT false NOT NULL,
	"show_section_results" boolean DEFAULT true NOT NULL,
	"close_section_on_leave" boolean DEFAULT false NOT NULL,
	"lms_attempt_result" text DEFAULT 'last' NOT NULL,
	"skip_review_when_complete" boolean DEFAULT false NOT NULL,
	"copy_protection" boolean DEFAULT true NOT NULL,
	"protection_watermark" boolean DEFAULT false NOT NULL,
	"protection_hide_on_blur" boolean DEFAULT false NOT NULL,
	"report_settings_json" jsonb,
	"intro_json" jsonb,
	"breakdown_display_json" jsonb,
	"breakdown_gate_enabled" boolean DEFAULT false NOT NULL,
	"section_groups_json" jsonb
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
	"interpretation_json" jsonb,
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
	"email" text,
	"email_hash" varchar(64),
	"password_hash" text,
	"name" text,
	"is_external" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"gdpr_consent" boolean DEFAULT false NOT NULL,
	"gdpr_consent_at" timestamp,
	"last_login_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(36),
	"external_key" text,
	"lms_learner_id" text,
	"organization" text,
	"unit" text,
	"position" text,
	CONSTRAINT "users_email_hash_unique" UNIQUE("email_hash")
);

ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "question_measurements" ADD CONSTRAINT "question_measurements_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "question_measurements" ADD CONSTRAINT "question_measurements_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "question_measurements" ADD CONSTRAINT "question_measurements_scale_id_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."scales"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "report_blocks" ADD CONSTRAINT "report_blocks_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "result_variables" ADD CONSTRAINT "result_variables_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "saved_list_filters" ADD CONSTRAINT "saved_list_filters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "scales" ADD CONSTRAINT "scales_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_question_scoring" ADD CONSTRAINT "test_question_scoring_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_question_scoring" ADD CONSTRAINT "test_question_scoring_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_review_comments" ADD CONSTRAINT "test_review_comments_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "analytics_slices_owner_idx" ON "analytics_slices" USING btree ("created_by");
CREATE UNIQUE INDEX "analytics_slices_owner_test_name_uq" ON "analytics_slices" USING btree ("created_by","test_id","name") WHERE "analytics_slices"."kind" = 'slice';
CREATE UNIQUE INDEX "analytics_slices_owner_filter_name_uq" ON "analytics_slices" USING btree ("created_by","name") WHERE "analytics_slices"."kind" = 'filter';
CREATE INDEX "attempts_user_test_idx" ON "attempts" USING btree ("user_id","test_id");
CREATE INDEX "attempts_test_id_idx" ON "attempts" USING btree ("test_id");
CREATE INDEX "attempts_snapshot_id_idx" ON "attempts" USING btree ("snapshot_id");
CREATE INDEX "content_pages_test_topic_position_sort_idx" ON "content_pages" USING btree ("test_id","topic_id","position","sort_order");
CREATE INDEX "content_pages_test_kind_idx" ON "content_pages" USING btree ("test_id","kind");
CREATE INDEX "content_pages_topic_id_idx" ON "content_pages" USING btree ("topic_id");
CREATE UNIQUE INDEX "lms_import_batch_users_pk" ON "lms_import_batch_users" USING btree ("batch_id","user_id");
CREATE INDEX "lms_import_batch_users_user_idx" ON "lms_import_batch_users" USING btree ("user_id");
CREATE INDEX "lms_import_batches_test_id_idx" ON "lms_import_batches" USING btree ("test_id");
CREATE UNIQUE INDEX "media_assets_owner_checksum_idx" ON "media_assets" USING btree ("owner_id","checksum") WHERE "media_assets"."owner_id" is not null;
CREATE INDEX "media_assets_checksum_idx" ON "media_assets" USING btree ("checksum");
CREATE INDEX "media_usages_entity_idx" ON "media_usages" USING btree ("entity_type","entity_id");
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");
CREATE INDEX "question_exposure_question_bucket_idx" ON "question_exposure" USING btree ("question_id","bucket_month");
CREATE INDEX "question_measurements_test_id_idx" ON "question_measurements" USING btree ("test_id");
CREATE INDEX "question_measurements_question_id_idx" ON "question_measurements" USING btree ("question_id");
CREATE INDEX "question_measurements_scale_id_idx" ON "question_measurements" USING btree ("scale_id");
CREATE INDEX "questions_topic_id_idx" ON "questions" USING btree ("topic_id");
CREATE INDEX "report_blocks_test_mode_sort_idx" ON "report_blocks" USING btree ("test_id","mode","sort_order");
CREATE INDEX "result_variables_test_id_idx" ON "result_variables" USING btree ("test_id");
CREATE UNIQUE INDEX "result_variables_test_id_name_uq" ON "result_variables" USING btree ("test_id","name");
CREATE INDEX "saved_list_filters_owner_scope_idx" ON "saved_list_filters" USING btree ("created_by","scope");
CREATE UNIQUE INDEX "saved_list_filters_owner_scope_name_uq" ON "saved_list_filters" USING btree ("created_by","scope","name");
CREATE INDEX "scales_test_id_idx" ON "scales" USING btree ("test_id");
CREATE UNIQUE INDEX "scales_test_id_key_uq" ON "scales" USING btree ("test_id","key");
CREATE INDEX "scorm_answers_attempt_id_idx" ON "scorm_answers" USING btree ("attempt_id");
CREATE UNIQUE INDEX "scorm_attempts_session_attempt_idx" ON "scorm_attempts" USING btree ("package_id","session_id","attempt_number") WHERE "scorm_attempts"."package_id" IS NOT NULL;
CREATE UNIQUE INDEX "scorm_attempts_import_row_idx" ON "scorm_attempts" USING btree ("test_id","participant_key","started_at","attempt_key") WHERE "scorm_attempts"."origin" = 'import';
CREATE INDEX "scorm_attempts_test_id_idx" ON "scorm_attempts" USING btree ("test_id");
CREATE INDEX "scorm_packages_test_id_idx" ON "scorm_packages" USING btree ("test_id");
CREATE UNIQUE INDEX "test_access_grants_test_user_idx" ON "test_access_grants" USING btree ("test_id","user_id");
CREATE INDEX "test_assignments_test_id_idx" ON "test_assignments" USING btree ("test_id");
CREATE INDEX "test_assignments_user_id_idx" ON "test_assignments" USING btree ("user_id");
CREATE INDEX "test_assignments_group_id_idx" ON "test_assignments" USING btree ("group_id");
CREATE UNIQUE INDEX "test_question_scoring_test_question_idx" ON "test_question_scoring" USING btree ("test_id","question_id");
CREATE INDEX "test_question_scoring_question_id_idx" ON "test_question_scoring" USING btree ("question_id");
CREATE INDEX "test_review_comments_test_idx" ON "test_review_comments" USING btree ("test_id","created_at");
CREATE INDEX "test_review_comments_test_question_idx" ON "test_review_comments" USING btree ("test_id","question_id");
CREATE INDEX "test_review_comments_parent_idx" ON "test_review_comments" USING btree ("parent_id");
CREATE INDEX "test_scenarios_topic_id_idx" ON "test_scenarios" USING btree ("topic_id");
CREATE INDEX "test_scenarios_test_id_sort_order_idx" ON "test_scenarios" USING btree ("test_id","sort_order");
CREATE INDEX "test_sections_topic_id_idx" ON "test_sections" USING btree ("topic_id");
CREATE INDEX "test_sections_test_id_sort_order_idx" ON "test_sections" USING btree ("test_id","sort_order");
CREATE UNIQUE INDEX "test_snapshots_test_version_idx" ON "test_snapshots" USING btree ("test_id","version");
CREATE INDEX "tests_status_idx" ON "tests" USING btree ("status");
CREATE UNIQUE INDEX "topic_access_grants_topic_grantee_idx" ON "topic_access_grants" USING btree ("topic_id","grantee_id");
CREATE UNIQUE INDEX "topics_owner_name_normalized_idx" ON "topics" USING btree ("owner_id","name_normalized") WHERE owner_id IS NOT NULL;
CREATE INDEX "topics_updated_at_idx" ON "topics" USING btree ("updated_at");
CREATE UNIQUE INDEX "user_groups_user_group_idx" ON "user_groups" USING btree ("user_id","group_id");
CREATE UNIQUE INDEX "user_roles_user_role_idx" ON "user_roles" USING btree ("user_id","role");
