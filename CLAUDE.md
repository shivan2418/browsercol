## Commits

- Work on `main`. Commit at green checkpoints without asking: when a function, small topic or ticket slice is done and its tests pass. Keep each commit to one small topic.
- Stage explicit paths (`git add path/a path/b`), never `git add -A` or `git add .`.
- Subject: a sentence-case plain sentence, with no `feat:`-style prefix and no trailing period. An `area:` prefix is fine where it reads better. Put the ticket in brackets, e.g. `Commands: found a colony from the Browser UI (#15)`. The body, if any, is wrapped prose on why.
- Hooks: run `git config core.hooksPath .githooks` once per clone. `commit-msg` rejects a message with no `Co-Authored-By:` or `Agent:` trailer. `pre-commit` runs `.githooks/check`, which compiles the Engine and is skipped for docs-only changes. On a pass the hook adds `Gate: passed`; never type it by hand, and never use `--no-verify`. If a hook fails, fix the cause and make a new commit.
- Side work by agents goes on its own branch. Once the full suite has visibly passed on it, bring it onto `main` with `git merge --ff-only`. No PRs and no squashing.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
