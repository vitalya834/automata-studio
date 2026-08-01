import { describe, expect, it } from 'vitest';
import type { TestRunResult, TestVerdict } from './testing';
import { testRunToHtml, testRunToJUnit } from './reports';

function result(verdicts: TestVerdict[] = ['pass', 'fail', 'timeout', 'inconclusive', 'invalid']): TestRunResult {
  const cases = verdicts.map((verdict, index) => ({
    caseId: `case-${index}`,
    name: `Case <${verdict}> & "quoted"`,
    verdict,
    startedAt: 1_000 + index * 100,
    finishedAt: 1_050 + index * 100,
    message: verdict === 'pass' ? undefined : `message </style><script>alert('${verdict}')</script> &`,
    steps: index === 3 ? [] : [{
      index: 0,
      input: `input<&${index}`,
      allowedExpectedOutputs: index === 0 ? [null, 'ok'] : ['expected'],
      startedAt: 1_000,
      finishedAt: 1_025,
      verdict,
      response: index === 2 ? undefined : { output: index === 0 ? null : 'actual<script>', timestamp: 1_025, durationMs: 25 },
    }],
  }));
  return {
    planId: 'plan<&"hostile',
    startedAt: 1_000,
    finishedAt: 2_234,
    verdict: verdicts.includes('invalid') ? 'invalid' : 'pass',
    cancelled: false,
    cases,
    counts: {
      pass: verdicts.filter((value) => value === 'pass').length,
      fail: verdicts.filter((value) => value === 'fail').length,
      timeout: verdicts.filter((value) => value === 'timeout').length,
      inconclusive: verdicts.filter((value) => value === 'inconclusive').length,
      invalid: verdicts.filter((value) => value === 'invalid').length,
    },
    closeError: 'close <failed> & stopped',
  };
}

describe('JUnit evidence report', () => {
  it('maps verdicts, counts, seconds and traces deterministically', () => {
    const subject = result();
    const first = testRunToJUnit(subject);
    expect(first).toBe(testRunToJUnit(subject));
    expect(first).toContain('tests="5" failures="1" errors="2" skipped="1" time="1.234"');
    expect(first).toContain('<failure type="conformance"');
    expect(first).toContain('<error type="timeout"');
    expect(first).toContain('<skipped message=');
    expect(first).toContain('<system-out>');
    expect(first).toContain('observed=null');
  });

  it('escapes XML-hostile values', () => {
    const output = testRunToJUnit(result(), { title: '<suite & "x">\u0000' });
    expect(output).toContain('&lt;suite &amp; &quot;x&quot;&gt;');
    expect(output).not.toContain('\u0000');
    expect(output).toContain('\uFFFD');
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;');
  });
});

describe('HTML evidence report', () => {
  it('is standalone, static and escapes hostile data', () => {
    const output = testRunToHtml(result(), { title: '</style><script>owned</script>' });
    expect(output.startsWith('<!doctype html>')).toBe(true);
    expect(output).toContain('&lt;/style&gt;&lt;script&gt;owned&lt;/script&gt;');
    expect(output).not.toContain('<script>');
    expect(output).not.toMatch(/<link\b|\ssrc\s*=|\son[a-z]+\s*=/i);
    expect(output).toContain('No step trace');
    expect(output).toContain('actual&lt;script&gt;');
  });

  it('is deterministic and does not mutate input', () => {
    const subject = result(['pass']);
    const snapshot = JSON.stringify(subject);
    expect(testRunToHtml(subject)).toBe(testRunToHtml(subject));
    expect(JSON.stringify(subject)).toBe(snapshot);
    testRunToJUnit(subject);
    expect(JSON.stringify(subject)).toBe(snapshot);
  });
});
