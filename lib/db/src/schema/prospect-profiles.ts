import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const prospectProfilesTable = pgTable("prospect_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  kvkNumber: text("kvk_number"),
  phone: text("phone"),
  source: text("source"),
  pipedriveDealId: text("pipedrive_deal_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProspectProfile = typeof prospectProfilesTable.$inferSelect;
