import { randomInt } from "node:crypto";
import bcrypt from "bcrypt";

export async function newOtp(): Promise<{ digits: string; hash: string }> {
  const digits = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const hash = await bcrypt.hash(digits, 10);
  return { digits, hash };
}

export async function verifyOtp(
  digits: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(digits, hash);
}
