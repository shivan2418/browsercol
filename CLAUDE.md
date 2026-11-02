## Commits

- Work on `main` when working alone. Commit at green checkpoints without asking: when a function, small topic or ticket slice is done and its tests pass. Keep each commit to one small topic.
- Stage explicit paths (`git add path/a path/b`), never `git add -A` or `git add .`.
- Subject: a sentence-case plain sentence, with no `feat:`-style prefix and no trailing period. An `area:` prefix is fine where it reads better. Put the ticket in brackets, e.g. `Commands: found a colony from the Browser UI (#15)`. The body, if any, is wrapped prose on why.
- Hooks: run `git config core.hooksPath .githooks` once per clone. `commit-msg` rejects a message with no `Co-Authored-By:` or `Agent:` trailer. `pre-commit` runs `.githooks/check`, which compiles the Engine and is skipped for docs-only changes. On a pass the hook adds `Gate: passed`; never type it by hand, and never use `--no-verify`. If a hook fails, fix the cause and make a new commit.
- Side work by agents goes on its own branch. Once the full suite has visibly passed on it, bring it onto `main` fast-forward only. Never squash, and never use GitHub's merge button.
- Parallel ticket agents (`/implement-parallel-mr`) each open a PR after the **fast checks**: Engine tests, `vp check`, `vp test`. The PR is a queue: a separate lander (`/land-batch`) reviews PRs from non-Claude models (`Agent:` trailer), rebases a batch of PRs onto `main`, runs the full suite once for the batch, and fast-forwards `main`. A PR it can't land gets a comment saying why and the `changes-requested` label; whoever fixes it pushes to the same branch and removes the label.

## Offloading tests to CI

When the user asks to offload tests (for example "offload the tests for this session"), the machine is busy with other work: for the rest of the session run no local test, build or browser command. Commit first, then run `./ci.sh`, which runs the whole suite on GitHub Actions for HEAD and prints the run URL, step results and failed logs. Run it in the background and show the user the URL. It counts as the whole-suite run below. The pre-commit hook still compiles the Engine locally; that stays.

## Finishing a ticket

- Finish everything in the ticket's spec, including checking code you changed but that no test runs. A small fix outside the spec goes in the same ticket when it touches code already in the diff.
- File a follow-up issue (`needs-triage`, "Found while doing #N") only for something broken, or something that blocks planned work. A real bug gets its own issue; anything else worth tracking goes in one follow-up issue per ticket that lists its items. Review suggestions you don't take, tidy-ups and loose observations go in the ticket's closing comment, not in an issue. Before filing, check whether an open issue already covers it and add to that one instead.
- Before closing, run the whole suite on the final commit (for a PR, the lander does this on the batch): Engine tests, `vp check`, `vp test`, `build.sh` and the browser scripts (`smoke`, `play`, `tileset`). Rerun a failure before calling it a flake, and file any flake as an issue, or comment on its existing one.
- When the ticket is done, merge its branch into `main` (ff-only, as above) if the work was on one, then close the GitHub issue with a comment summarising what landed and naming any follow-up issues.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
