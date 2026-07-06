# code-review-agent

> Privacy-first GitHub Action for automated code review using a **local LLM**.
> No code leaves your runner. Works with Ollama, vLLM, llama.cpp, LM Studio, or any OpenAI-compatible endpoint.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub Action](https://img.shields.io/badge/type-GitHub_Action-blueviolet)](./action.yml)

## Why?

[CodeRabbit](https://coderabbit.ai), GitHub Copilot Code Review, Sourcery — all send your source code to third-party APIs. Enterprise security teams block them. The remaining open-source alternatives are either regex linters or noisy GPT wrappers with no privacy story.

**code-review-agent** runs against a local model you control. Runners only talk to:
1. The GitHub API (for the diff and posting comments)
2. Your LLM endpoint (Ollama, vLLM, llama.cpp — same network)

Nothing else. No telemetry, no analytics, no third-party calls.

## Features

- ✅ **Multi-model support** — works with any OpenAI-compatible endpoint
- 🎯 **Actionable findings only** — categorizes issues as `critical` / `warning` / `suggestion` / `nitpick`
- 📍 **Inline PR comments** — points to specific lines in changed code
- 🏷️ **Skip label** — opt out per PR with `skip-review`
- ⚙️ **Custom rules** — append project-specific guidelines to every review
- 🧪 **Token-efficient** — batches small files, fetches full context only when needed
- 🔒 **Zero data leakage** — runs entirely in your CI environment

## Quick Start

### 1. Run Ollama on the runner

Most CI runners don't have Ollama by default. Run it as a service in your workflow:

```yaml
name: Code Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Start Ollama
        run: |
          curl -fsSL https://ollama.com/install.sh | sh
          ollama serve &
          ollama pull qwen2.5-coder:7b

      - uses: fuleinist/code-review-agent@v1
        with:
          api-url: http://localhost:11434/v1
          model: qwen2.5-coder:7b
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

That's it. The action posts inline comments on your PR.

### 2. Use a hosted endpoint (no Ollama on the runner)

```yaml
- uses: fuleinist/code-review-agent@v1
  with:
    api-url: https://your-llm-gateway.example.com/v1
    model: qwen2.5-coder:32b
    api-key: ${{ secrets.LLM_GATEWAY_TOKEN }}
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input          | Required | Default                  | Description                              |
|----------------|----------|--------------------------|------------------------------------------|
| `api-url`      | No       | `http://localhost:11434/v1` | OpenAI-compatible endpoint URL        |
| `model`        | No       | `qwen2.5-coder:7b`       | Model name                               |
| `api-key`      | No       | (empty)                  | Bearer token for hosted endpoints        |
| `max-files`    | No       | `30`                     | Max files reviewed per PR (1–200)        |
| `max-tokens`   | No       | `4096`                   | Max tokens for LLM response (256–32768)  |
| `verbosity`    | No       | `normal`                 | `quiet`, `normal`, `detailed`            |
| `custom-rules` | No       | (empty)                  | Extra instructions for the LLM           |
| `skip-label`   | No       | `skip-review`            | PR label that opts out of review         |
| `comment-mode` | No       | `inline`                 | `inline` or `summary`                    |
| `github-token` | No       | `${{ github.token }}`    | Token for posting comments               |

## Outputs

| Output            | Description                       |
|-------------------|-----------------------------------|
| `findings-count`  | Number of findings posted         |
| `critical-count`  | Number of critical findings       |
| `review-id`       | ID of the posted PR review        |

## Custom Rules Example

```yaml
- uses: fuleinist/code-review-agent@v1
  with:
    api-url: http://localhost:11434/v1
    model: qwen2.5-coder:7b
    custom-rules: |
      - All public API changes must update docs/api.md
      - DB migrations must be reversible
      - Reject any use of eval() in production code
      - Flag missing input validation on user-facing endpoints
      - Require tests for any new error-handling code path
```

## Skip a PR

Add the `skip-review` label to any PR to opt out:

```bash
gh pr edit 123 --add-label skip-review
```

(Or change the label name via the `skip-label` input.)

## How It Works

1. On `pull_request` event, fetches changed files via the GitHub API
2. Groups files into batches (cap ~12k chars per batch to fit in context)
3. Sends each batch to your LLM with a code-review system prompt
4. Parses the JSON response into `Finding` objects
5. Validates each finding's line number against the actual diff
6. Posts inline comments on specific lines + a summary review
7. Sets the PR to `REQUEST_CHANGES` if any critical findings

## Finding Categories

| Category       | Emoji | Examples                                    |
|----------------|-------|---------------------------------------------|
| `logic`        | 🐛     | Off-by-one, wrong condition, dead code      |
| `security`     | 🔒     | SQL injection, missing auth, XSS            |
| `performance`  | ⚡     | N+1 queries, sync I/O in hot path           |
| `style`        | 🎨     | Only flag if it hides a bug                 |
| `testing`      | 🧪     | Missing test for new logic                  |
| `docs`         | 📝     | Public API change without doc update        |
| `api-misuse`   | 📚     | Using deprecated API, wrong option          |

## Compatible LLM Endpoints

| Endpoint               | Setup                              |
|------------------------|------------------------------------|
| [Ollama](https://ollama.com)            | `ollama serve` then `ollama pull qwen2.5-coder:7b` |
| [vLLM](https://docs.vllm.ai)            | `vllm serve Qwen/Qwen2.5-Coder-7B-Instruct`         |
| [llama.cpp server](https://github.com/ggerganov/llama.cpp) | `./server -m model.gguf -c 8192` |
| [LM Studio](https://lmstudio.ai)        | Local Server tab → Start Server    |
| [OpenAI](https://platform.openai.com)   | Set `api-url: https://api.openai.com/v1` |

Recommended models (coder-tuned, instruction-following):
- `qwen2.5-coder:7b` (best size/quality tradeoff, ~5GB)
- `qwen2.5-coder:32b` (highest quality, needs ~20GB RAM)
- `deepseek-coder-v2:16b`
- `codellama:13b`

## Development

```bash
npm install
npm run build         # compiles + bundles to dist/index.js
```

The bundled `dist/index.js` is committed per GitHub Actions convention. Don't edit it directly — edit `src/` then rebuild.

## Security

- No outbound HTTP besides the configured LLM endpoint and GitHub API
- No telemetry, analytics, or phone-home
- All secrets passed via `secrets.*` (never logged)
- PR content is processed in-memory only

## License

MIT — see [LICENSE](./LICENSE).

## Acknowledgements

Inspired by [CodeRabbit](https://coderabbit.ai) but built for teams that can't use SaaS code review tools.