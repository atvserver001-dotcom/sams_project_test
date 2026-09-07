-- AUTO-GENERATED PREP FILE. DO NOT RUN BLINDLY.
-- schema: public
-- generated_at: 2025-12-26T05:12:44.892Z
-- 목적: TEST 스키마를 기준으로 PROD에 적용할 DDL을 "준비" (실행은 별도)

BEGIN;

ALTER TABLE "public"."devices" ADD COLUMN "icon_path" text;

ALTER TABLE "public"."classes" ADD CONSTRAINT "classes_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "public"."grades" ("id");
ALTER TABLE "public"."classes" ADD CONSTRAINT "classes_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."content_devices" ADD CONSTRAINT "content_devices_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."contents" ("id");
ALTER TABLE "public"."content_devices" ADD CONSTRAINT "content_devices_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices" ("id");
ALTER TABLE "public"."content_devices" ADD CONSTRAINT "content_devices_pkey" PRIMARY KEY ("content_id", "device_id");
ALTER TABLE "public"."contents" ADD CONSTRAINT "contents_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."device_management" ADD CONSTRAINT "device_management_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."grades" ADD CONSTRAINT "grades_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."grades" ADD CONSTRAINT "grades_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools" ("id");
ALTER TABLE "public"."permission_logs" ADD CONSTRAINT "permission_logs_grantee_id_fkey" FOREIGN KEY ("grantee_id") REFERENCES "public"."user_profiles" ("id");
ALTER TABLE "public"."permission_logs" ADD CONSTRAINT "permission_logs_grantor_id_fkey" FOREIGN KEY ("grantor_id") REFERENCES "public"."user_profiles" ("id");
ALTER TABLE "public"."permission_logs" ADD CONSTRAINT "permission_logs_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."school_contents" ADD CONSTRAINT "school_contents_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."contents" ("id");
ALTER TABLE "public"."school_contents" ADD CONSTRAINT "school_contents_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."school_contents" ADD CONSTRAINT "school_contents_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools" ("id");
ALTER TABLE "public"."school_devices" ADD CONSTRAINT "school_devices_auth_key_key" UNIQUE ("auth_key");
ALTER TABLE "public"."school_devices" ADD CONSTRAINT "school_devices_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices" ("id");
ALTER TABLE "public"."school_devices" ADD CONSTRAINT "school_devices_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."school_devices" ADD CONSTRAINT "school_devices_school_content_id_fkey" FOREIGN KEY ("school_content_id") REFERENCES "public"."school_contents" ("id");
ALTER TABLE "public"."user_profiles" ADD CONSTRAINT "user_profiles_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes" ("id");
ALTER TABLE "public"."user_profiles" ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");
ALTER TABLE "public"."user_profiles" ADD CONSTRAINT "user_profiles_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools" ("id");

CREATE UNIQUE INDEX classes_pkey ON public.classes USING btree (id);
CREATE UNIQUE INDEX content_devices_pkey ON public.content_devices USING btree (content_id, device_id);
CREATE UNIQUE INDEX contents_pkey ON public.contents USING btree (id);
CREATE UNIQUE INDEX device_management_pkey ON public.device_management USING btree (id);
CREATE INDEX idx_device_mgmt_school_id ON public.device_management USING btree (school_id);
CREATE UNIQUE INDEX grades_pkey ON public.grades USING btree (id);
CREATE UNIQUE INDEX permission_logs_pkey ON public.permission_logs USING btree (id);
CREATE UNIQUE INDEX school_contents_pkey ON public.school_contents USING btree (id);
CREATE UNIQUE INDEX school_devices_auth_key_key ON public.school_devices USING btree (auth_key);
CREATE UNIQUE INDEX school_devices_pkey ON public.school_devices USING btree (id);
CREATE INDEX idx_schools_recognition_key ON public.schools USING btree (recognition_key);
CREATE UNIQUE INDEX idx_students_school_year_grade_classno_studentno ON public.students USING btree (school_id, year, grade, class_no, student_no);
CREATE UNIQUE INDEX user_profiles_pkey ON public.user_profiles USING btree (id);

ROLLBACK;

-- ⚠️ 기본은 ROLLBACK으로 생성됩니다. 실제 적용하려면 SQL 검토 후 COMMIT으로 바꾸거나, 별도 실행 절차를 사용하세요.