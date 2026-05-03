# Case Template

Copy this folder into `lab/<case-name>` and create a matching `expected/<case-name>`.

Keep these rules:

- Put Codex input under `codex-home`.
- Put pre-existing Claude state under `claude-home`.
- Put expected post-sync Claude output under `expected/<case>/claude-home`.
- Treat Codex output as source-unchanged unless a deletion/baseline scenario explicitly says otherwise.
- Use placeholder env values only.
