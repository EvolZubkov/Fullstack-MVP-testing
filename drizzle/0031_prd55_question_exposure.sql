CREATE TABLE "question_exposure" (
	"question_id" varchar(36) NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"bucket_month" date NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "question_exposure_question_id_test_id_bucket_month_pk" PRIMARY KEY("question_id","test_id","bucket_month")
);
--> statement-breakpoint
CREATE INDEX "question_exposure_question_bucket_idx" ON "question_exposure" USING btree ("question_id","bucket_month");