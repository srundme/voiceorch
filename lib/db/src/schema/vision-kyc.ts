import { pgTable, text, serial, timestamp, integer, boolean, jsonb, real, uuid, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { callsTable } from "./calls";
import { agentsTable } from "./agents";

/**
 * Customer Identity Records managed by SnapServe business users for Video KYC.
 */
export const visionIdentitiesTable = pgTable(
  "vision_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    
    // Identity verification assets stored as compressed base64 JPEG
    facePhotoData: text("face_photo_data"),
    facePhotoMimeType: text("face_photo_mime_type").default("image/jpeg"),
    panCardData: text("pan_card_data"),
    panCardMimeType: text("pan_card_mime_type").default("image/jpeg"),
    
    // Extracted identity details
    panNumber: text("pan_number"),
    panName: text("pan_name"),
    panDob: text("pan_dob"),
    aadhaarNumber: text("aadhaar_number"),
    
    // Status tracking
    status: text("status").notNull().default("enrolled"), // enrolled | verified | rejected | pending
    enrollmentSource: text("enrollment_source").notNull().default("admin_upload"), // admin_upload | self_onboarding | captured_on_call
    
    // Token for public customer self-onboarding portal
    selfOnboardingToken: text("self_onboarding_token").unique(),
    selfOnboardingExpiresAt: timestamp("self_onboarding_expires_at", { withTimezone: true }),
    
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("vision_identities_user_phone_idx").on(t.userId, t.phone),
    index("vision_identities_token_idx").on(t.selfOnboardingToken),
  ]
);

/**
 * Video KYC Verification Session Audit Trail (generated during live video call or manual review)
 */
export const visionKycSessionsTable = pgTable(
  "vision_kyc_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
    callId: integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
    identityId: uuid("identity_id").references(() => visionIdentitiesTable.id, { onDelete: "set null" }),
    agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
    callerPhone: text("caller_phone").notNull(),
    
    status: text("status").notNull().default("pending"), // passed | failed | manual_review | pending
    
    // Captured evidence frames from video feed
    faceCaptureData: text("face_capture_data"),
    documentCaptureData: text("document_capture_data"),
    
    // Scoring & Checks Breakdown
    faceMatchScore: real("face_match_score").default(0), // 0-100
    faceMatchPass: boolean("face_match_pass").default(false),
    
    documentOcrName: text("document_ocr_name"),
    documentOcrNumber: text("document_ocr_number"),
    documentOcrDob: text("document_ocr_dob"),
    
    documentNameMatch: boolean("document_name_match").default(false),
    documentFaceMatch: boolean("document_face_match").default(false),
    documentAuthentic: boolean("document_authentic").default(true),
    documentAuthenticityScore: real("document_authenticity_score").default(100),
    
    overallScore: real("overall_score").default(0),
    summary: text("summary"),
    notes: text("notes"),
    
    webhookSent: boolean("webhook_sent").default(false),
    webhookUrl: text("webhook_url"),
    
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("vision_kyc_sessions_user_idx").on(t.userId, t.createdAt),
    index("vision_kyc_sessions_call_idx").on(t.callId),
  ]
);

export type VisionIdentity = typeof visionIdentitiesTable.$inferSelect;
export type VisionKycSession = typeof visionKycSessionsTable.$inferSelect;
