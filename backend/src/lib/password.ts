import bcrypt from "bcryptjs";
import { config } from "../config.js";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.BCRYPT_ROUNDS);
}

export function verifyPassword(
  password: string,
  passwordHash: string | null,
): Promise<boolean> {
  if (!passwordHash) return Promise.resolve(false);
  return bcrypt.compare(password, passwordHash);
}
