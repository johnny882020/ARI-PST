// Leaf module: shared types and helpers for the repositories (keeps db.ts and repo-*.ts free of import cycles).
export type Q = { query<R = Record<string, any>>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }> };
export const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
