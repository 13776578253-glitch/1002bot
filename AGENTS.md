# Repository instructions

Read and follow [docs/agent-context/AGENTS-en.md](docs/agent-context/AGENTS-en.md) for repository work. Keep the rules in that file; this page is their discovery entry point.

## File Reading and Terminal Encoding Standards

1. **Prefer native file tools:** Use native file reading, editing, and search tools to access source code. Avoid bulk-reading source files through PowerShell pipelines.
2. **Use appropriate tools for file processing:** Prefer `ripgrep (rg)` for bulk searches. When file parsing is required, use the Node.js `fs` API with explicit UTF-8 encoding.
3. **Use PowerShell 7:** On Windows, default to PowerShell 7 (`pwsh`) for command execution. Avoid Windows PowerShell 5.1.
4. **Specify encoding explicitly:** When reading files through PowerShell, use `Get-Content -Raw -Encoding utf8`.
5. **Standardize file encoding:** Use UTF-8 without BOM for source code and configuration files, while preserving compatibility exceptions where genuinely necessary.
6. **Diagnose encoding issues before making changes:** When encountering garbled Chinese text, distinguish between actual file corruption, incorrect decoding during file reading, and terminal output encoding issues. Never modify source code based on garbled scan results.
7. **Verify changes:** After modifications, inspect the Git diff to ensure there are no unintended encoding conversions, BOM changes, or widespread unrelated text differences.

## Subagent Delegation Policy

Subagent usage is determined by the primary agent's model identity.

### GPT / Codex Agents

- Do not spawn, delegate to, or orchestrate subagents.
- Execute all investigation, implementation, testing, and
  verification tasks within the primary agent.
- Do not use parallel agents for code exploration, reviews,
  or independent implementation.
- Sequential tool calls and ordinary parallel tool execution
  are permitted when they do not create additional agents.
- Only an explicit instruction from the user may override
  this restriction.

### DeepSeek, Gemini, and Other Non-GPT Agents

- Subagent delegation is permitted and encouraged when
  tasks contain genuinely independent workstreams.
- Prefer subagents for read-only investigation, codebase
  exploration, isolated research, and independent reviews.
- Keep architectural decisions, integration, and final
  verification under the primary agent's responsibility.
- Avoid multiple subagents editing overlapping files.
- Do not delegate trivial or tightly coupled tasks.
- Limit delegation to the minimum number of agents
  necessary for meaningful parallelism.

### Model Identification

- Apply the policy using the model identity provided
  by the execution environment.
- Do not infer model identity from writing style,
  task complexity, or assumed capabilities.
- If model identity is unavailable or ambiguous,
  default to single-agent execution.