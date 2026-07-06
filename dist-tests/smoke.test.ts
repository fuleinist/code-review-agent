import { test } from 'node:test';
import assert from 'node:assert';
import { detectLanguage, extractAddedLines, countChangedLines } from '../src/diff';
import { commitStatusFor, GitHubClient } from '../src/github';
import { LLMClient } from '../src/llm';
import { applyCustomRules } from '../src/prompts';
import { Finding } from '../src/types';

function mkFinding(severity: Finding['severity']): Finding {
  return { file: 'a.ts', severity, category: 'logic', message: 'x' };
}

test('detectLanguage handles common extensions', () => {
  assert.equal(detectLanguage('foo.ts'), 'typescript');
  assert.equal(detectLanguage('bar.py'), 'python');
  assert.equal(detectLanguage('Dockerfile'), 'dockerfile');
  assert.equal(detectLanguage('noext'), 'text');
  assert.equal(detectLanguage('a.go'), 'go');
});

test('extractAddedLines returns correct line numbers', () => {
  const patch = `@@ -1,3 +1,5 @@
 line1
+added2
+added3
 line4
+added5`;
  const added = extractAddedLines(patch);
  assert.equal(added.length, 3);
  assert.equal(added[0].line, 2);
  assert.equal(added[1].line, 3);
  assert.equal(added[2].line, 5);
});

test('countChangedLines excludes diff headers', () => {
  const patch = `@@ -1,3 +1,4 @@
-old
+new
 kept`;
  assert.equal(countChangedLines(patch), 2);
});

test('LLMClient.validate tolerates extra fields', () => {
  const client = new LLMClient({
    apiUrl: 'http://localhost:11434/v1',
    model: 'test',
    apiKey: '',
    maxFiles: 30,
    maxTokens: 4096,
    verbosity: 'normal',
    customRules: '',
    skipLabel: 'skip-review',
    commentMode: 'inline',
    githubToken: '',
  });
  const result = client.validate({
    findings: [
      {
        file: 'a.ts',
        line: 5,
        severity: 'critical',
        category: 'security',
        message: 'SQL injection',
        suggestion: 'use prepared statements',
        extra: 'ignored',
      },
      {
        file: 'b.ts',
        line: 'not a number',
        severity: 'fake',
        category: 'fake',
        message: '',
      },
    ],
    summary: 'test',
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].file, 'a.ts');
  assert.equal(result.findings[0].line, 5);
  assert.equal(result.findings[0].severity, 'critical');
  assert.equal(result.summary, 'test');
});

test('applyCustomRules appends when non-empty', () => {
  const out = applyCustomRules('base', '- rule1');
  assert.match(out, /base/);
  assert.match(out, /rule1/);
});

test('applyCustomRules is identity for empty', () => {
  assert.equal(applyCustomRules('base', ''), 'base');
  assert.equal(applyCustomRules('base', '   '), 'base');
});

test('commitStatusFor returns success for empty findings', () => {
  const s = commitStatusFor([]);
  assert.equal(s.state, 'success');
  assert.equal(s.description, 'No issues found');
});

test('commitStatusFor returns success for non-critical findings', () => {
  const s = commitStatusFor([mkFinding('warning'), mkFinding('suggestion')]);
  assert.equal(s.state, 'success');
  assert.match(s.description, /2 non-critical/);
});

test('commitStatusFor returns failure when any finding is critical', () => {
  const s = commitStatusFor([mkFinding('warning'), mkFinding('critical')]);
  assert.equal(s.state, 'failure');
  assert.equal(s.description, '1 critical issue');
});

test('commitStatusFor pluralizes critical description', () => {
  const s = commitStatusFor([mkFinding('critical'), mkFinding('critical'), mkFinding('critical')]);
  assert.equal(s.state, 'failure');
  assert.equal(s.description, '3 critical issues');
});

test('GitHubClient.postCommitStatus exists and is callable (signature check)', () => {
  // Compile-time / runtime sanity: ensure the method is on the prototype
  // so a future refactor that removes it breaks this test.
  assert.equal(typeof GitHubClient.prototype.postCommitStatus, 'function');
});