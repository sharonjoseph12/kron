/**
 * Password hashing. bcrypt is pinned in root package.json's
 * onlyBuiltDependencies so its native bindings install on this machine.
 */
import bcrypt from "bcrypt";

const ROUNDS = 10;

export async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export async function compare(password: string, hashValue: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hashValue);
  } catch {
    return false;
  }
}