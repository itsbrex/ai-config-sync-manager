# Architecture

AI Config Sync Manager uses one shared engine and two host integrations.

```text
Claude config -> Claude adapter -> canonical snapshot
Codex config  -> Codex adapter  -> canonical snapshot
                                      |
                                    diff
                                      |
                              sync plan / apply
```

The Claude and Codex plugins should stay thin. They call the bundled `bin/ai-config-sync` and avoid owning sync logic.

## Design Rules

- Do not use a template generation pipeline for MVP.
- Use schema, mapping rules, and adapters.
- Bundle the CLI with the plugin/repo install; do not require global npm install.
- Keep writes behind dry-run, backup, and explicit confirmation.
- Treat this as an OSS plugin project, not a single-machine script collection.
