ALTER TABLE "opportunities" ADD COLUMN "unit_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunities_unit_outcome" ON "opportunities" USING btree ("unit_id","outcome");