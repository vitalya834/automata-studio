import { describe, expect, it } from 'vitest';
import { parseMachine } from './fsm.ts';

describe('parseMachine', () => {
  it('parses a complete turnstile machine', () => {
    const result = parseMachine(`machine Turnstile\ninitial Locked\nLocked --coin / unlock--> Unlocked\nUnlocked --push / lock--> Locked`);
    expect(result.machine?.states.map((state) => state.id)).toEqual(['Locked', 'Unlocked']);
    expect(result.machine?.transitions).toHaveLength(2);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports an unknown line with its number', () => {
    const result = parseMachine(`machine Broken\ninitial A\nthis is not valid`);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', line: 3 }));
  });

  it('reports nondeterministic transitions', () => {
    const result = parseMachine(`machine NFA\ninitial A\nA --x--> B\nA --x--> C`);
    expect(result.diagnostics.some((item) => item.message.includes('Недетерминированность'))).toBe(true);
  });

  it('warns about unreachable states', () => {
    const result = parseMachine(`machine Reachability\ninitial A\nstate Lost\nA --x--> A`);
    expect(result.diagnostics.some((item) => item.message.includes('недостижимо'))).toBe(true);
  });
});
