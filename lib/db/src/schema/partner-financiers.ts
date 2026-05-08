import { pgTable, text, timestamp, uuid, numeric } from "drizzle-orm/pg-core";

export const partnerFinanciersTable = pgTable("partner_financiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  contactEmail: text("contact_email").notNull(),
  productFocus: text("product_focus").notNull(),
  minimumTicketSize: numeric("minimum_ticket_size"),
  maximumTicketSize: numeric("maximum_ticket_size"),
  activeStatus: text("active_status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PartnerFinancier = typeof partnerFinanciersTable.$inferSelect;
