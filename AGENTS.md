# Repository instructions

Read and follow [docs/agent-context/AGENTS-en.md](docs/agent-context/AGENTS-en.md) for repository work. Keep the rules in that file; this page is their discovery entry point.

## Multi-Agent Delegation

The main agent is the orchestrator and may spawn subagents when useful. Delegate bounded exploration, implementation, test creation, and verification. Keep architecture decisions, critical-path work, security-sensitive changes, and final review with the main agent. Use the configured default subagent model unless explicitly instructed otherwise. Avoid subagents for trivial tasks and concurrent edits to the same files.
