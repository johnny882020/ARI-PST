import type { Clock } from '@ari/domain';
export const systemClock: Clock = { now: () => new Date() };
export class FixedClock implements Clock {
  constructor(private t: Date) {}
  now(): Date { return new Date(this.t); }
  advance(ms: number): void { this.t = new Date(this.t.getTime() + ms); }
  set(d: Date): void { this.t = d; }
}
