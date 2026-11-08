---
name: deploy
description: Deploy main to GitHub Pages as the next build, with a developer changelog (the GitHub release) and a player changelog (WHATS-NEW.md, shown on the website).
argument-hint: "Which commit? (default: origin/main)"
disable-model-invocation: true
---

You ship the next **build**: `tools/deploy.sh` tags a commit `build-N` and pushes the tag, and the tag starts the Pages workflow. Each build gets two changelogs, written from the same set of changes for two readers:

- **Developer changelog**: the body of the GitHub release for `build-N`. Everything that landed, grouped by ticket, linked.
- **Player changelog**: the build's entry at the top of `WHATS-NEW.md`, which the website shows. Written for someone who plays the game and has never seen the repo.

Both are public once pushed. The human approves both drafts before anything leaves this machine.

## 1. Collect the changes

```
git fetch -q origin --tags
last=$(git tag --list 'build-*' | sort -t- -k2 -n | tail -1)
target=$(git rev-parse --verify "${ARGUMENTS:-origin/main}^{commit}")
git log --reverse --format='%h %s' "$last..$target"
```

The next build is `build-<N+1>`, where N is the number in `$last`. For each ticket number the subjects name, read its title and state (`gh issue view <n> --json title,state,labels`); a closed ticket's closing comment says what landed. Commits without a ticket stand on their own subject.

**Done when** every commit in the range sits in one of these groups: a ticket, a stand-alone change a player would notice, or internal work (tests, scripts, CI, agent skills, Storybook, prototypes, formatting, refactors).

## 2. Draft both changelogs

**Developer changelog**, in Markdown:

- A line with the range: `Changes since build-N (<sha>..<sha>), <count> commits.`
- One bullet per ticket: `#<n> <ticket title>`, with the commit subjects under it when there are several.
- Stand-alone commits as bullets of their subject, then internal work in its own short group at the end.

**Player changelog**: one entry in this shape:

```
## Build <N+1> · <YYYY-MM-DD>

### New
- …
### Fixed
- …
### Changed
- …
```

- Plain, concrete sentences about what a player sees or can now do: "The trade report fits its table instead of a fixed width." Name game things by their in-game names (colony, Europe, Continental Congress), never code, files or ticket numbers.
- Merge several commits about one screen into one line. Keep only what a player would notice; internal work never appears. Omit an empty group.
- Around 3–12 lines in all. If the build is mostly internal, a single line is fine.

**Done when** both drafts exist and every player-facing change from step 1 appears in the player entry exactly once.

## 3. Get approval

Show the human both drafts in full, with the target commit and the build number. Ask for a yes or for edits, and apply edits until they say yes.

**Done when** the human has said yes to both texts as they now stand.

## 4. Commit the player changelog

The player entry ships inside the build it describes, so it goes on main before the tag.

- Check the shared checkout is on main and clean for `WHATS-NEW.md`: `git -C /home/emil/freecol-online branch --show-current`. If another session has it on another branch, work in a worktree of main instead.
- If `WHATS-NEW.md` doesn't exist yet, create it with a `# What's new in BrowserCol` heading. Insert the new entry right under the heading, above older entries.
- Commit only that file: `git add WHATS-NEW.md`, subject `What's new: build <N+1>`. Push main: `git push origin main`. The deploy target is now this new commit, not the one from step 1. If main moved on origin in the meantime, stop and tell the human.

**Done when** `git rev-parse origin/main` is the changelog commit.

## 5. Deploy and publish the release

```
just deploy <changelog commit sha>
gh release create build-<N+1> --verify-tag --title "Build <N+1>" --notes-file <developer changelog file>
```

Check `deploy.sh` printed the tag you expected. If it numbered the build differently (someone deployed in between), retitle the player entry and the release to match before going on.

Follow the Pages run in the background (`gh run watch $(gh run list --workflow pages.yml -L 1 --json databaseId --jq '.[0].databaseId') --exit-status`). It builds, deploys and smoke-tests the live page.

**Done when** the release exists and the Pages run has finished.

## 6. Report

The build number, the commit, the release URL, the Pages run URL and its result (with the failing step if it failed), and the player entry as published.
