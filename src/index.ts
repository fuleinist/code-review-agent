import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadConfig } from './config';
import { commitStatusFor, GitHubClient } from './github';
import { LLMClient } from './llm';
import { applyCustomRules, buildBatchPrompt, buildFilePrompt, SYSTEM_PROMPT } from './prompts';
import {
  buildReviewContext,
  extractAddedLines,
  filterIgnoredPaths,
  parsePullRequestFiles,
} from './diff';
import { Finding, FileDiff } from './types';

const MAX_DIFF_CHARS = 12000;
const SMALL_FILE_THRESHOLD = 8000;

async function run(): Promise<void> {
  try {
    const config = loadConfig();
    process.env.MODEL_NAME = config.model;
    const context = buildReviewContext(github.context.payload);

    const gh = new GitHubClient(config.githubToken, context);
    const llm = new LLMClient(config);

    core.info(`Reviewing PR #${context.prNumber}: ${context.prTitle}`);
    core.info(`Using model: ${config.model} @ ${config.apiUrl}`);

    // Check skip label
    if (await gh.hasSkipLabel(config.skipLabel)) {
      core.info(`PR has '${config.skipLabel}' label — skipping review.`);
      return;
    }

    // Fetch PR files
    const files = await fetchFiles(config, context);
    if (files.length === 0) {
      core.info('No files to review.');
      return;
    }

    // Apply ignore-paths filter before the max-files cap is reached.
    // Fetches maxFiles + 100 buffer so we don't miss real files when lots of
    // generated/lockfile/vendor paths get filtered out.
    let reviewFiles = files;
    if (config.ignorePaths.length > 0) {
      const before = files.length;
      reviewFiles = filterIgnoredPaths(files, config.ignorePaths);
      const dropped = before - reviewFiles.length;
      if (dropped > 0) {
        core.info(`Ignored ${dropped} file(s) matching ignore-paths (kept ${reviewFiles.length}).`);
      }
      reviewFiles = reviewFiles.slice(0, config.maxFiles);
      if (reviewFiles.length === 0) {
        core.info('All files were filtered by ignore-paths; nothing to review.');
        return;
      }
    }

    core.info(`Found ${reviewFiles.length} file(s) to review (max-files: ${config.maxFiles}).`);

    // Build prompts
    const systemPrompt = applyCustomRules(SYSTEM_PROMPT, config.customRules);

    // Decide batching: send small files together, large ones one at a time
    const batches = createBatches(reviewFiles);

    const allFindings: Finding[] = [];
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      core.info(`Reviewing batch ${i + 1}/${batches.length} (${batch.length} file${batch.length === 1 ? '' : 's'})...`);
      try {
        const prompt =
          batch.length === 1 && batch[0].patch && batch[0].patch.length > MAX_DIFF_CHARS
            ? buildFilePrompt(context, batch[0])
            : buildBatchPrompt(context, batch);

        const review = await llm.review(systemPrompt, prompt);
        allFindings.push(...review.findings);
        core.info(`  → ${review.findings.length} findings`);
      } catch (err: any) {
        core.warning(`Batch ${i + 1} failed: ${err.message}`);
      }
    }

    // Validate line numbers against actual diff
    const validated = validateLineNumbers(allFindings, reviewFiles);
    const criticalCount = validated.filter((f) => f.severity === 'critical').length;
    const warningCount = validated.filter((f) => f.severity === 'warning').length;

    core.info(`Total validated findings: ${validated.length} (${criticalCount} critical, ${warningCount} warnings)`);

    if (validated.length === 0) {
      core.info('No actionable findings. Posting a thumbs-up summary.');
      const { reviewId } = await gh.postFindings([], config.commentMode);
      if (reviewId) core.setOutput('review-id', reviewId);
      core.setOutput('findings-count', 0);
      core.setOutput('critical-count', 0);
      try {
        const status = commitStatusFor([]);
        await gh.postCommitStatus(status.state, status.description);
      } catch (err: any) {
        core.warning(`Commit status update failed: ${err.message}`);
      }
      return;
    }

    const { reviewId, posted, criticalCount: c } = await gh.postFindings(validated, config.commentMode);
    core.setOutput('findings-count', posted);
    core.setOutput('critical-count', c);
    if (reviewId) core.setOutput('review-id', reviewId);

    // Set commit status per SPEC §"Behavior" step 9
    const status = commitStatusFor(validated);
    try {
      await gh.postCommitStatus(status.state, status.description);
    } catch (err: any) {
      core.warning(`Commit status update failed: ${err.message}`);
    }

    core.info(`✅ Posted ${posted} of ${validated.length} findings.`);
    if (c > 0) {
      core.warning(`Found ${c} critical issue${c === 1 ? '' : 's'}.`);
    }
  } catch (err: any) {
    core.setFailed(`Action failed: ${err.message}`);
  }
}

async function fetchFiles(config: any, context: any): Promise<FileDiff[]> {
  const octokit = github.getOctokit(config.githubToken);
  const all: any[] = [];
  let page = 1;
  // When ignore-paths is set, fetch a buffer beyond maxFiles so the filter
  // doesn't accidentally drop real code when many files are lockfiles/vendored.
  const fetchCap = config.ignorePaths.length > 0
    ? config.maxFiles + 100
    : config.maxFiles;
  while (all.length < fetchCap) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner: context.owner,
      repo: context.repo,
      pull_number: context.prNumber,
      per_page: Math.min(100, fetchCap - all.length),
      page,
    });
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return parsePullRequestFiles(all.slice(0, fetchCap));
}

function createBatches(files: FileDiff[]): FileDiff[][] {
  const batches: FileDiff[][] = [];
  let current: FileDiff[] = [];
  let currentSize = 0;

  for (const f of files) {
    const size = (f.patch?.length || 0) + f.filename.length + 50;
    if (current.length > 0 && currentSize + size > MAX_DIFF_CHARS) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(f);
    currentSize += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function validateLineNumbers(findings: Finding[], files: FileDiff[]): Finding[] {
  const fileMap = new Map<string, FileDiff>();
  for (const f of files) fileMap.set(f.filename, f);

  return findings
    .map((f) => {
      const file = fileMap.get(f.file);
      if (!file) {
        core.debug(`Dropping finding for unknown file: ${f.file}`);
        return null;
      }
      if (f.line === undefined) return f;
      const addedLines = extractAddedLines(file.patch);
      const maxLine = addedLines.length > 0 ? Math.max(...addedLines.map((a) => a.line)) : 0;
      if (f.line > maxLine && maxLine > 0) {
        core.debug(`Line ${f.line} out of range for ${f.file} (max: ${maxLine})`);
        return { ...f, line: undefined };
      }
      return f;
    })
    .filter((f): f is Finding => f !== null);
}

run();