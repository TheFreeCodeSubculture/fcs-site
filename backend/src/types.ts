export type Role = "admin" | "editor" | "pending" | "member";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  can_view_analytics: boolean;
  core_member_id: string | null;
  must_reset: boolean;
  email_verified_at: string | null;
}

// Express middleware augments the request object.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
