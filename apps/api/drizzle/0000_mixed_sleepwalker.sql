CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"seq" integer NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"held_ms" bigint,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_seq" CHECK ("audit_events"."seq" >= 1),
	CONSTRAINT "audit_events_kind" CHECK ("audit_events"."kind" in ('created', 'assigned', 'contacted', 'advised', 'won', 'lost', 'reopened', 'confirmed', 'edited')),
	CONSTRAINT "audit_events_held_ms" CHECK ("audit_events"."held_ms" is null or "audit_events"."held_ms" >= 0),
	CONSTRAINT "audit_events_first_event" CHECK (("audit_events"."held_ms" is null) = ("audit_events"."seq" = 1))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"segment" text NOT NULL,
	"owner_id" text NOT NULL,
	"current_products" text[] DEFAULT '{}' NOT NULL,
	"revenue" bigint,
	"relation_stage" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_code_unique" UNIQUE("code"),
	CONSTRAINT "customers_segment" CHECK ("customers"."segment" in ('sse', 'rb')),
	CONSTRAINT "customers_revenue" CHECK ("customers"."revenue" is null or "customers"."revenue" >= 0)
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"customer_id" text NOT NULL,
	"segment" text NOT NULL,
	"product" text NOT NULL,
	"need" text NOT NULL,
	"value" bigint NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"contacted_at" timestamp with time zone,
	"advised_at" timestamp with time zone,
	"confirmed_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_hypothesis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"missing_info" text[] DEFAULT '{}' NOT NULL,
	"blocker_code" text,
	"blocker_note" text,
	"next_action" text,
	"owner_id" text NOT NULL,
	"due_date" date,
	"outcome" text DEFAULT 'open' NOT NULL,
	"outcome_reason" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_via" text DEFAULT 'manual' NOT NULL,
	"confirmed_by_id" text,
	"confirmed_at" timestamp with time zone,
	"confirm_note" text,
	"drafted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_code_unique" UNIQUE("code"),
	CONSTRAINT "opportunities_segment" CHECK ("opportunities"."segment" in ('sse', 'rb')),
	CONSTRAINT "opportunities_value" CHECK ("opportunities"."value" > 0),
	CONSTRAINT "opportunities_stage" CHECK ("opportunities"."stage" in ('new', 'contacted', 'advised')),
	CONSTRAINT "opportunities_product" CHECK ("opportunities"."product" in ('card', 'od', 'usl', 'loan', 'casa', 'insurance', 'other')),
	CONSTRAINT "opportunities_outcome" CHECK ("opportunities"."outcome" in ('open', 'won', 'lost')),
	CONSTRAINT "opportunities_source" CHECK ("opportunities"."source" in ('import', 'manual')),
	CONSTRAINT "opportunities_created_via" CHECK ("opportunities"."created_via" in ('manual', 'ai')),
	CONSTRAINT "opportunities_blocker_code" CHECK ("opportunities"."blocker_code" is null or "opportunities"."blocker_code" in ('rate', 'speed', 'experience', 'documents', 'collateral', 'policy', 'competitor', 'customer_hesitation', 'other')),
	CONSTRAINT "opportunities_stage_marks" CHECK (("opportunities"."stage" = 'new') = ("opportunities"."contacted_at" is null) and ("opportunities"."stage" = 'advised') = ("opportunities"."advised_at" is not null)),
	CONSTRAINT "opportunities_closed_mark" CHECK (("opportunities"."outcome" = 'open') = ("opportunities"."closed_at" is null)),
	CONSTRAINT "opportunities_outcome_reason" CHECK ("opportunities"."outcome" = 'open' or "opportunities"."outcome_reason" is not null),
	CONSTRAINT "opportunities_confirm_pair" CHECK (("opportunities"."confirmed_by_id" is null) = ("opportunities"."confirmed_at" is null)),
	CONSTRAINT "opportunities_confirm_closed" CHECK ("opportunities"."confirmed_at" is null or "opportunities"."outcome" <> 'open')
);
--> statement-breakpoint
CREATE TABLE "opportunity_products" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"product" text NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_products_product" CHECK ("opportunity_products"."product" in ('card', 'od', 'usl', 'loan', 'casa', 'insurance', 'other')),
	CONSTRAINT "opportunity_products_amount" CHECK ("opportunity_products"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"source" text DEFAULT 'sale' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"author_id" text,
	"raw_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_type" CHECK ("signals"."type" in ('cash_flow', 'product_gap', 'need', 'competition', 'deadline', 'documents', 'other')),
	CONSTRAINT "signals_source" CHECK ("signals"."source" in ('sale', 'system', 'ai')),
	CONSTRAINT "signals_author_by_source" CHECK ("signals"."source" <> 'sale' or "signals"."author_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"owner_id" text,
	"unit_id" text NOT NULL,
	"segment" text,
	"period" text NOT NULL,
	"metric" text DEFAULT 'cr_rate' NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "targets_scope" CHECK ("targets"."scope" in ('user', 'unit')),
	CONSTRAINT "targets_metric" CHECK ("targets"."metric" in ('cr_rate', 'deals', 'value')),
	CONSTRAINT "targets_amount" CHECK ("targets"."amount" > 0),
	CONSTRAINT "targets_cr_rate_range" CHECK ("targets"."metric" <> 'cr_rate' or "targets"."amount" <= 10000),
	CONSTRAINT "targets_segment" CHECK ("targets"."segment" is null or "targets"."segment" in ('sse', 'rb')),
	CONSTRAINT "targets_owner_by_scope" CHECK (case when "targets"."scope" = 'user' then "targets"."owner_id" is not null else "targets"."owner_id" is null end)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'branch' NOT NULL,
	"parent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_code_unique" UNIQUE("code"),
	CONSTRAINT "units_kind" CHECK ("units"."kind" in ('branch', 'region', 'area'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"employee_code" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"title" text NOT NULL,
	"level" text,
	"segment" text,
	"unit_id" text NOT NULL,
	"manager_id" text,
	"joined_on" date,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_code_unique" UNIQUE("code"),
	CONSTRAINT "users_employee_code_unique" UNIQUE("employee_code"),
	CONSTRAINT "users_role" CHECK ("users"."role" in ('sale', 'team_lead', 'bm', 'admin')),
	CONSTRAINT "users_segment" CHECK ("users"."segment" is null or "users"."segment" in ('sse', 'rb')),
	CONSTRAINT "users_level" CHECK ("users"."level" is null or "users"."level" in ('cv1', 'cv2', 'cv3', 'cvc', 'tn', 'gd')),
	CONSTRAINT "users_segment_by_role" CHECK ("users"."role" in ('bm', 'admin') or "users"."segment" is not null),
	CONSTRAINT "users_manager_by_role" CHECK ("users"."role" in ('bm', 'admin') or "users"."manager_id" is not null),
	CONSTRAINT "users_admin_outside_tree" CHECK ("users"."role" <> 'admin' or ("users"."segment" is null and "users"."manager_id" is null))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_products" ADD CONSTRAINT "opportunity_products_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_parent_id_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_trace" ON "audit_events" USING btree ("opportunity_id","seq");--> statement-breakpoint
CREATE INDEX "audit_events_kind_created" ON "audit_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor" ON "audit_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "customers_owner" ON "customers" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "customers_segment" ON "customers" USING btree ("segment");--> statement-breakpoint
CREATE INDEX "opportunities_customer" ON "opportunities" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "opportunities_owner_stage" ON "opportunities" USING btree ("owner_id","stage");--> statement-breakpoint
CREATE INDEX "opportunities_segment_outcome" ON "opportunities" USING btree ("segment","outcome");--> statement-breakpoint
CREATE INDEX "opportunities_due" ON "opportunities" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "opportunities_unconfirmed" ON "opportunities" USING btree ("owner_id","closed_at") WHERE "opportunities"."outcome" <> 'open' and "opportunities"."confirmed_at" is null;--> statement-breakpoint
CREATE INDEX "opportunities_blocker" ON "opportunities" USING btree ("blocker_code");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_products_key" ON "opportunity_products" USING btree ("opportunity_id","product");--> statement-breakpoint
CREATE INDEX "opportunity_products_product" ON "opportunity_products" USING btree ("product");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signals_customer_observed" ON "signals" USING btree ("customer_id","observed_at");--> statement-breakpoint
CREATE INDEX "targets_period" ON "targets" USING btree ("period");--> statement-breakpoint
CREATE INDEX "targets_owner_period" ON "targets" USING btree ("owner_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "targets_key" ON "targets" USING btree ("scope",coalesce("owner_id", ''),"unit_id",coalesce("segment", ''),"metric","period");--> statement-breakpoint
CREATE INDEX "users_manager" ON "users" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "users_unit_role" ON "users" USING btree ("unit_id","role");