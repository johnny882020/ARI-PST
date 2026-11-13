// Committee voting, N-of-M (ASSUMPTION-04). N and M are configuration. Enforced again in the database.
export type VoteValue = 'approve' | 'reject' | 'abstain';
export type DecisionOutcome = 'approved' | 'rejected' | 'needs_info';
export interface CommitteeConfig { votesNeeded: number; membersTotal: number }
export interface VoteTally { approve: number; reject: number; abstain: number; total: number }
export function tally(votes: ReadonlyArray<{ vote: VoteValue }>): VoteTally {
  const t = { approve: 0, reject: 0, abstain: 0, total: votes.length };
  for (const v of votes) t[v.vote]++;
  return t;
}
export function validateCommitteeConfig(c: CommitteeConfig): boolean {
  return Number.isInteger(c.votesNeeded) && Number.isInteger(c.membersTotal) && c.votesNeeded >= 1 && c.membersTotal >= c.votesNeeded;
}
/** What the tally allows. approved: N approvals. rejected: N rejections. needs_info: at least one vote. */
export function allowedOutcomes(t: VoteTally, cfg: CommitteeConfig): DecisionOutcome[] {
  const out: DecisionOutcome[] = [];
  if (t.approve >= cfg.votesNeeded) out.push('approved');
  if (t.reject >= cfg.votesNeeded) out.push('rejected');
  if (t.total >= 1) out.push('needs_info');
  return out;
}
export function quorumReached(t: VoteTally, cfg: CommitteeConfig, outcome: DecisionOutcome): boolean {
  return allowedOutcomes(t, cfg).includes(outcome);
}
