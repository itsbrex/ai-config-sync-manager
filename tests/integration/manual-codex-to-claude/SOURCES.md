# Sources

Reference search used Exa MCP first, then GitHub file fetches for concrete examples.

## GitHub References

- `fcakyon/claude-codex-settings` README: real mixed Claude Code and Codex setup with plugins, skills, hooks, agents, MCP servers, and CLAUDE/AGENTS cross-tool compatibility.
  - https://github.com/fcakyon/claude-codex-settings
- `affaan-m/everything-claude-code` `.codex/config.toml`: Codex approval policy, sandbox mode, web search, MCP servers, profiles, and agent role config.
  - https://github.com/affaan-m/everything-claude-code/blob/main/.codex/config.toml
- `xihuai18/claude-code-mcp` README: Codex MCP server config for wrapping Claude Code, env options, polling workflow, and permission model notes.
  - https://github.com/xihuai18/claude-code-mcp
- `JSONbored/claudepro-directory` `mcp-setup.mdx`: project-scoped `.mcp.json`, remote OAuth MCP, local Docker MCP, and team/user scope split.
  - https://github.com/JSONbored/claudepro-directory/blob/main/content/commands/mcp-setup.mdx
- `Dokkabei97/all-agents-mcp` README: multi-agent MCP registration for Claude and Codex, env model overrides, and direct CLI invocation pattern.
  - https://github.com/Dokkabei97/all-agents-mcp

## Case Mapping

- `case-01-gstack-notion-exa-grep`: skill + Notion + Exa + grep allowlist mix.
- `case-02-ecc-context7-playwright-reviewer`: ECC-style Codex config with Context7, Playwright, GitHub tools, and local agents.
- `case-03-claude-code-mcp-disk-resume`: Claude Code MCP as a Codex server with disk-resume env placeholders.
- `case-04-team-mcp-oauth-stack`: GitHub/Linear/Sentry remote MCP plus local Postgres Docker MCP.
- `case-05-all-agents-orchestration`: all-agents MCP plus CLI prefix rules for cross-agent work.
- `case-06-plugin-hooks-frontend-design`: plugin-style frontend skill plus native Codex hook migration.
- `case-07-observability-cloud-mix`: cloud/observability MCP stack with mixed allow/deny shell rules.
