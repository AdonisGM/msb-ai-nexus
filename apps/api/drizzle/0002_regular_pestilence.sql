CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"subject_kind" text,
	"subject_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_subject_pair" CHECK (("conversations"."subject_kind" is null) = ("conversations"."subject_id" is null)),
	CONSTRAINT "conversations_subject_kind" CHECK ("conversations"."subject_kind" is null or "conversations"."subject_kind" in ('customer', 'opportunity'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_role" CHECK ("messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"tool_use_id" text NOT NULL,
	"name" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"result" jsonb,
	"note" text,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_calls_status" CHECK ("tool_calls"."status" in ('pending', 'done', 'approved', 'denied', 'failed')),
	CONSTRAINT "tool_calls_decision_pair" CHECK (("tool_calls"."decided_by_id" is null) = ("tool_calls"."decided_at" is null)),
	CONSTRAINT "tool_calls_decided_by" CHECK ("tool_calls"."status" not in ('approved', 'denied') or "tool_calls"."decided_by_id" is not null),
	CONSTRAINT "tool_calls_pending_empty" CHECK ("tool_calls"."status" <> 'pending' or "tool_calls"."result" is null)
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_owner_recent" ON "conversations" USING btree ("owner_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_seq" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_calls_use_id" ON "tool_calls" USING btree ("tool_use_id");--> statement-breakpoint
CREATE INDEX "tool_calls_conversation" ON "tool_calls" USING btree ("conversation_id","created_at");