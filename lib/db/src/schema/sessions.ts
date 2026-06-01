import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const approvedUsersTable = pgTable("approved_users", {
  discordId: text("discord_id").primaryKey(),
  username: text("username").notNull(),
  discriminator: text("discriminator").notNull().default("0"),
  avatar: text("avatar"),
  approved: boolean("approved").notNull().default(false),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ApprovedUser = typeof approvedUsersTable.$inferSelect;
export type InsertApprovedUser = typeof approvedUsersTable.$inferInsert;
