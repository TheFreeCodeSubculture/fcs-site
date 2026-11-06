export type Role = "admin" | "editor" | "pending";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  can_view_analytics: boolean;
  core_member_id: string | null;
  must_reset: boolean;
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
