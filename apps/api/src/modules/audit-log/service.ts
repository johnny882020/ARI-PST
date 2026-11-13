import type { AuditQuery, Ctx, Repository } from '@ari/domain';
export class AuditService {
  constructor(private repo: Repository) {}
  query(ctx: Ctx, q: Omit<AuditQuery, 'limit'> & { limit?: number }) { return this.repo.tx(ctx, (tx) => tx.auditLog.query({ ...q, limit: q.limit ?? 50 })); }
  /** Returns the first broken sequence number or null. Reading the verification result is audited by the database function. */
  async verify(ctx: Ctx, from?: number, to?: number): Promise<{ intact: boolean; firstBrokenSeq: number | null }> {
    const broken = await this.repo.tx(ctx, (tx) => tx.auditLog.verify(from, to));
    return { intact: broken === null, firstBrokenSeq: broken };
  }
}
