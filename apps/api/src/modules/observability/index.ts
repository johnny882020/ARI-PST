// observability module: health, counters. Leaf module.
import type { Repository } from '@ari/domain';
export class Health {
  constructor(private repo: Repository, private version: string) {}
  livez() { return { status: 'ok' as const, version: this.version }; }
  async readyz(): Promise<{ code: number; body: { status: 'ok' | 'down'; version: string; checks: Record<string, string> } }> {
    try {
      const p = await this.repo.ping();
      const ok = p.ok && p.migrationsOk;
      return { code: ok ? 200 : 503, body: { status: ok ? 'ok' : 'down', version: this.version, checks: { db: p.ok ? 'ok' : 'down', migrations: p.migrationsOk ? (p.latestMigration ?? 'ok') : 'behind' } } };
    } catch { return { code: 503, body: { status: 'down', version: this.version, checks: { db: 'down' } } }; }
  }
}
export class Counters {
  private c = new Map<string, number>();
  inc(name: string): void { this.c.set(name, (this.c.get(name) ?? 0) + 1); }
  get(name: string): number { return this.c.get(name) ?? 0; }
}
