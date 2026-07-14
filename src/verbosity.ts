import { Config } from './config';

export type LogLevel = 'quiet' | 'normal' | 'detailed';

const RANK: Record<LogLevel, number> = {
  quiet: 0,
  normal: 1,
  detailed: 2,
};

/**
 * Decide whether a log line at `level` should fire given the configured
 * verbosity. `level` is the minimum verbosity the message should appear at:
 *   - 'quiet'    → always shown
 *   - 'normal'   → hidden only when verbosity is 'quiet'
 *   - 'detailed' → only shown when verbosity is 'detailed'
 */
export function shouldLog(level: LogLevel, config: Pick<Config, 'verbosity'>): boolean {
  return RANK[config.verbosity] >= RANK[level];
}
