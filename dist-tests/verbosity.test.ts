import { test } from 'node:test';
import assert from 'node:assert';
import { shouldLog } from '../src/verbosity';
import { Config } from '../src/config';

function cfg(verbosity: Config['verbosity']): Config {
  return {
    apiUrl: 'http://localhost:11434/v1',
    model: 'test',
    apiKey: '',
    maxFiles: 30,
    maxTokens: 4096,
    verbosity,
    customRules: '',
    skipLabel: 'skip-review',
    commentMode: 'inline',
    githubToken: '',
    ignorePaths: [],
  };
}

test('shouldLog: quiet hides normal and detailed messages', () => {
  const c = cfg('quiet');
  assert.equal(shouldLog('quiet', c), true);
  assert.equal(shouldLog('normal', c), false);
  assert.equal(shouldLog('detailed', c), false);
});

test('shouldLog: normal shows quiet and normal, hides detailed', () => {
  const c = cfg('normal');
  assert.equal(shouldLog('quiet', c), true);
  assert.equal(shouldLog('normal', c), true);
  assert.equal(shouldLog('detailed', c), false);
});

test('shouldLog: detailed shows every level', () => {
  const c = cfg('detailed');
  assert.equal(shouldLog('quiet', c), true);
  assert.equal(shouldLog('normal', c), true);
  assert.equal(shouldLog('detailed', c), true);
});
