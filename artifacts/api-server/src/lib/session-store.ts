export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface UserSession {
  userId: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  approved: boolean;
  approvalToken?: string;
  approvalStatus?: ApprovalStatus;
}

declare module "express-session" {
  interface SessionData {
    user?: UserSession;
    oauthState?: string;
    approvalToken?: string;
  }
}
