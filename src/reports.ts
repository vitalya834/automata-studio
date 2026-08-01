import type { OutputSymbol, TestCaseResult, TestRunResult, TestStepTrace } from './testing';

export type ReportOptions = {
  title?: string;
};

function xml(value: unknown): string {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '\uFFFD')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function html(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function seconds(milliseconds: number): string {
  return (Math.max(0, milliseconds) / 1_000).toFixed(3);
}

function duration(startedAt: number, finishedAt: number): number {
  return Math.max(0, finishedAt - startedAt);
}

function symbol(value: OutputSymbol | undefined): string {
  if (value === undefined) return '—';
  return value === null ? 'null' : JSON.stringify(value);
}

function stepLine(step: TestStepTrace): string {
  const expected = step.allowedExpectedOutputs.map((value) => symbol(value)).join('|');
  const observed = symbol(step.response?.output);
  const message = step.message === undefined ? '' : ` message=${step.message}`;
  return `#${step.index + 1} ${step.verdict.toUpperCase()} input=${JSON.stringify(step.input)} expected=${expected} observed=${observed} duration=${duration(step.startedAt, step.finishedAt)}ms${message}`;
}

function caseTrace(testCase: TestCaseResult): string {
  const lines = testCase.steps.map(stepLine);
  if (testCase.message !== undefined) lines.unshift(`case: ${testCase.message}`);
  return lines.length === 0 ? '(no step trace)' : lines.join('\n');
}

export function testRunToJUnit(result: TestRunResult, options: ReportOptions = {}): string {
  const suiteName = options.title ?? `Automata Studio: ${result.planId}`;
  const failures = result.cases.filter((testCase) => testCase.verdict === 'fail').length;
  const errors = result.cases.filter((testCase) => testCase.verdict === 'timeout' || testCase.verdict === 'invalid').length;
  const skipped = result.cases.filter((testCase) => testCase.verdict === 'inconclusive').length;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${xml(suiteName)}" tests="${result.cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${seconds(duration(result.startedAt, result.finishedAt))}">`,
    `  <testsuite name="${xml(suiteName)}" tests="${result.cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${seconds(duration(result.startedAt, result.finishedAt))}" timestamp="${xml(new Date(result.startedAt).toISOString())}">`,
  ];

  for (const testCase of result.cases) {
    lines.push(`    <testcase classname="${xml(result.planId)}" name="${xml(testCase.name)}" time="${seconds(duration(testCase.startedAt, testCase.finishedAt))}">`);
    const trace = caseTrace(testCase);
    if (testCase.verdict === 'fail') {
      lines.push(`      <failure type="conformance" message="${xml(testCase.message ?? 'Observed output does not conform to the plan.')}">${xml(trace)}</failure>`);
    } else if (testCase.verdict === 'timeout' || testCase.verdict === 'invalid') {
      lines.push(`      <error type="${xml(testCase.verdict)}" message="${xml(testCase.message ?? testCase.verdict)}">${xml(trace)}</error>`);
    } else if (testCase.verdict === 'inconclusive') {
      lines.push(`      <skipped message="${xml(testCase.message ?? 'Inconclusive test case.')}" />`);
    }
    lines.push(`      <system-out>${xml(trace)}</system-out>`);
    lines.push('    </testcase>');
  }
  if (result.closeError !== undefined) lines.push(`    <system-err>${xml(result.closeError)}</system-err>`);
  lines.push('  </testsuite>', '</testsuites>', '');
  return lines.join('\n');
}

function summaryCard(label: string, value: string | number, className: string): string {
  return `<div class="card ${className}"><span>${html(label)}</span><strong>${html(value)}</strong></div>`;
}

function caseHtml(testCase: TestCaseResult): string {
  const rows = testCase.steps.map((step) => {
    const expected = step.allowedExpectedOutputs.map((value) => symbol(value)).join(', ');
    return `<tr><td>${step.index + 1}</td><td><code>${html(step.input)}</code></td><td>${html(expected)}</td><td>${html(symbol(step.response?.output))}</td><td>${duration(step.startedAt, step.finishedAt)} ms</td><td><span class="verdict ${html(step.verdict)}">${html(step.verdict.toUpperCase())}</span>${step.message === undefined ? '' : `<small>${html(step.message)}</small>`}</td></tr>`;
  }).join('');
  const body = rows === '' ? '<tr><td colspan="6" class="empty">No step trace</td></tr>' : rows;
  return `<section class="case"><h2><span class="verdict ${html(testCase.verdict)}">${html(testCase.verdict.toUpperCase())}</span> ${html(testCase.name)}</h2>${testCase.message === undefined ? '' : `<p class="message">${html(testCase.message)}</p>`}<table><thead><tr><th>#</th><th>Input</th><th>Expected</th><th>Observed</th><th>Duration</th><th>Verdict</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

export function testRunToHtml(result: TestRunResult, options: ReportOptions = {}): string {
  const title = options.title ?? `Automata Studio — ${result.planId}`;
  const totalDuration = duration(result.startedAt, result.finishedAt);
  const cards = [
    summaryCard('PASS', result.counts.pass, 'pass'),
    summaryCard('FAIL', result.counts.fail, 'fail'),
    summaryCard('TIMEOUT', result.counts.timeout, 'timeout'),
    summaryCard('INCONCLUSIVE', result.counts.inconclusive, 'inconclusive'),
    summaryCard('INVALID', result.counts.invalid, 'invalid'),
    summaryCard('DURATION', `${totalDuration} ms`, 'duration'),
  ].join('');
  const cases = result.cases.map(caseHtml).join('') || '<p class="empty">No test cases</p>';
  const closeError = result.closeError === undefined ? '' : `<aside class="close-error"><strong>Adapter close error:</strong> ${html(result.closeError)}</aside>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#080c0e;color:#dce7e8}*{box-sizing:border-box}body{margin:0;padding:32px;background:#080c0e}main{max-width:1200px;margin:auto}header{border-bottom:1px solid #263137;padding-bottom:20px}h1{margin:0 0 8px;font-size:28px}p{color:#8fa0a6}.summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:24px 0}.card{background:#111719;border:1px solid #263137;padding:14px}.card span{display:block;color:#789096;font-size:11px;letter-spacing:.08em}.card strong{font-size:24px}.case{margin:18px 0;border:1px solid #263137;background:#0d1214}.case h2{margin:0;padding:14px;font-size:16px}.message,.close-error{margin:0;padding:12px 14px;border-top:1px solid #263137}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-top:1px solid #202a2e;font-size:13px}th{color:#829399}.verdict{display:inline-block;padding:3px 6px;border:1px solid #3a4b50;font:700 11px ui-monospace,monospace}.verdict.pass{color:#62d4bd}.verdict.fail,.verdict.invalid{color:#ff8078}.verdict.timeout{color:#f2b66d}.verdict.inconclusive{color:#aeb8bd}small{display:block;color:#9ba7ab;margin-top:5px}.empty{color:#829399}.close-error{border:1px solid #824a46;color:#ffaaa4}@media(max-width:800px){body{padding:12px}.summary{grid-template-columns:repeat(2,1fr)}table{display:block;overflow:auto}}
</style></head><body><main><header><h1>${html(title)}</h1><p>Plan <code>${html(result.planId)}</code> · ${html(new Date(result.startedAt).toISOString())} · overall <span class="verdict ${html(result.verdict)}">${html(result.verdict.toUpperCase())}</span>${result.cancelled ? ' · cancelled' : ''}</p></header><div class="summary">${cards}</div>${closeError}${cases}</main></body></html>
`;
}
