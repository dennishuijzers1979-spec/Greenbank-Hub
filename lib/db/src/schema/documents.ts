import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { dossiersTable } from "./dossiers";
import { usersTable } from "./users";

export const documentsTable = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossierId: uuid("dossier_id")
    .notNull()
    .references(() => dossiersTable.id, { onDelete: "cascade" }),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  uploadStatus: text("upload_status").notNull().default("uploaded"),
  validationStatus: text("validation_status").notNull().default("pending"),
  extractedDataStatus: text("extracted_data_status")
    .notNull()
    .default("pending"),
  usedInAnalysis: boolean("used_in_analysis").notNull().default(false),
  validationNotes: text("validation_notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Document = typeof documentsTable.$inferSelect;
