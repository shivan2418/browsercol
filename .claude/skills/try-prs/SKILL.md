---
name: try-prs
description: Cut a local try branch with open PRs merged on top of main, and serve it so the human can play-test them together.
argument-hint: "Which PRs? (default: every open PR that targets main)"
disable-model-invocation: true
---

You build a **try branch**: a throwaway local branch where the human play-tests several PRs together before `/land-batch` lands them. It is for looking at, never for landing: it stays local, and the PRs and their branches stay exactly as their authors pushed them.

The try branch is `try/prs`, in the worktree `/home/emil/freecol-online-worktrees/try-prs`. Each run rebuilds both from scratch. Leave the shared checkout `/home/emil/freecol-online` on whatever branch it is on, because other sessions use it.

## 1. Pick the PRs

Take the PRs the human named. Otherwise take every open PR that targets main: `gh pr list --base main --json number,title,headRefName,isDraft,labels`. Order them oldest first.

**Done when** you have the list, noting which are drafts or labelled `changes-requested`, since the human may be testing work that isn't finished.

## 2. Cut the branch

```
git -C /home/emil/freecol-online fetch -q origin main
```

- **The worktree exists:** stop any dev server still running from it. Then run `git checkout -B try/prs origin/main` inside it and `git clean -fd` (tracked and untracked files only, not ignored ones, so `freecol/`, `ui/generated/` and `node_modules/` survive).
- **It doesn't exist:** `git -C /home/emil/freecol-online worktree add -B try/prs /home/emil/freecol-online-worktrees/try-prs origin/main`. Then give it FreeCol's source as a shared clone pinned to `freecol.sha`, never a symlink, because `vp test` and the dev server refuse paths outside the worktree: `git clone -q --shared /home/emil/freecol-online/freecol freecol && git -C freecol checkout -q $(cat freecol.sha)`. Run `just install`.

In either case, check `freecol/` is at the sha in `freecol.sha`, and check it out if not, since main may have moved the pin.

**Done when** `try/prs` sits at `origin/main` in the worktree, and `freecol/` matches the pin.

## 3. Merge the PRs

For each PR in order:

```
git fetch -q origin pull/<n>/head
git merge --no-ff --no-edit -m "Try: merge #<n> <title>" FETCH_HEAD
```

The hooks are fine to run here: a merge that won't compile is worth knowing about.

- **Clean merge:** go on to the next PR.
- **Conflict where both sides' intent is clear** (two additions next to each other, an import list): resolve it keeping both, commit, and note the files.
- **Conflict that forces a choice between two PRs' behaviour**, or one you don't understand: `git merge --abort`, leave that PR out, and note why.

**Done when** every PR is merged or left out with a named reason.

## 4. Serve it

Run `just dev` in the worktree in the background. It builds first if needed, then prints the URL, which is on the first free port from 5173 up. Wait for that line.

**Done when** the dev server answers at the printed URL.

## 5. Report

- **What to test**, one line per PR: its number, then where to look in the game and what should happen there, in a few words, from the PR body (for example "#323: Europe → Recruit: the colonists' feet line up; select a unit: its order buttons are centred, with icons"). Mark a PR that merged with resolved conflicts (and the files) or was left out (and why).
- The tip sha of `try/prs` and the URL.
- The PRs that are drafts or labelled `changes-requested`.

Give no verdict on the PRs: the human is the one testing them.
