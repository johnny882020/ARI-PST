import { describe, it, expect } from 'vitest';
import { canTransition, TRANSITIONS, REQUEST_STATES } from './request-state.js';
describe('request state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('draft', 'submitted')).toBe(true);
    expect(canTransition('delivery', 'closed')).toBe(true);
  });
  it('blocks reopening and skipping', () => {
    expect(canTransition('rejected', 'submitted')).toBe(false);
    expect(canTransition('closed', 'draft')).toBe(false);
    expect(canTransition('precheck', 'delivery')).toBe(false);
  });
  it('covers every state', () => { expect(Object.keys(TRANSITIONS).sort()).toEqual([...REQUEST_STATES].sort()); });
});
