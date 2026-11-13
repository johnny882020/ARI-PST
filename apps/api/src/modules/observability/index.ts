// observability module: health, counters. Leaf module.
import type { Repository } from '@ari/domain';
export interface HealthInfo { expectedMigration: string | null; dataClassification: string; demoMode: boolean }
export class Health {
  constructor(private repo: Repository, private version: string, private info: HealthInfo = { expectedMigration: null, dataClassification: 'synthetic', demoMode: false }) {}
  private flags(): Record<string, string> { return { data: this.info.dataClassification, ...(this.info.demoMode ? { demo: 'on' } : {}) }; }
  /** Process alive. No I/O. `version` is the git SHA on Render (RENDER_GIT_COMMIT). */
  livez() { return { status: 'ok' as const, version: this.version, checks: this.flags() }; }
  /** DB reachable AND the applied migration level is at least the level this build was made for (C-05).
   *  "At least", not "equal": during a deploy the old instances must stay ready after the new migration ran (expand/contract). */
  async readyz(): Promise<{ code: number; body: { status: 'ok' | 'down'; version: string; checks: Record<string, string> } }> {
    try {
      const p = await this.repo.ping();
      const want = this.info.expectedMigration;
      const migOk = p.ok && p.migrationsOk && p.latestMigration !== null && (want === null || p.latestMigration >= want);
      const ok = p.ok && migOk;
      return { code: ok ? 200 : 503, body: { status: ok ? 'ok' : 'down', version: this.version,
        checks: { db: p.ok ? 'ok' : 'down', migrations: !p.ok ? 'unknown' : migOk ? 'ok' : 'behind', migrationApplied: p.latestMigration ?? 'none', migrationExpected: want ?? 'unknown', ...this.flags() } } };
    } catch { return { code: 503, body: { status: 'down', version: this.version, checks: { db: 'down' } } }; }
  }
}
export class Counters {
  private c = new Map<string, number>();
  inc(name: string): void { this.c.set(name, (this.c.get(name) ?? 0) + 1); }
  get(name: string): number { return this.c.get(name) ?? 0; }
}
