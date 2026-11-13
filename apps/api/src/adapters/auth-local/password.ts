import argon2 from 'argon2';
import { createHmac } from 'node:crypto';

export interface ArgonParams { memoryCost: number; timeCost: number; parallelism: number }
export class PasswordHasher {
  constructor(private readonly p: ArgonParams, private readonly pepper: string | null = null) {}
  private pre(pw: string): string { return this.pepper ? createHmac('sha256', this.pepper).update(pw).digest('base64') : pw; }
  hash(pw: string): Promise<string> {
    return argon2.hash(this.pre(pw), { type: argon2.argon2id, memoryCost: this.p.memoryCost, timeCost: this.p.timeCost, parallelism: this.p.parallelism });
  }
  async verify(hash: string, pw: string): Promise<boolean> { try { return await argon2.verify(hash, this.pre(pw)); } catch { return false; } }
}
const COMMON = new Set(['password1234', 'passwordpassword', '123456789012', 'qwertyuiop12', 'letmein12345', 'administrator1']);
/** NIST-style policy: length first. No composition rules. */
export function passwordPolicy(pw: string, email?: string): string | null {
  if (typeof pw !== 'string' || pw.length < 12) return 'LENGTH';
  if (pw.length > 128) return 'LENGTH';
  if (COMMON.has(pw.toLowerCase())) return 'COMMON';
  if (email && pw.toLowerCase().includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length > 3) return 'CONTAINS_EMAIL';
  if (/^(.)\1+$/.test(pw)) return 'REPEATED';
  return null;
}
