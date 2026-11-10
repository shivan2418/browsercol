# Beta feedback goes to a small Lambda that keeps reports in S3, a side channel the game does not need

The r/colonization beta needs a way for players to send bug reports and ideas without a GitHub account (#369). A static site cannot receive anything, so something must run on a server: `relay/`, one TypeScript Lambda behind a Function URL that writes each report, with its logs and save, to a private S3 bucket under `inbox/` and answers with a reference `R-XXXXX`. Nothing is published: a report stays private until the developer has read it (#372), and a tester can name their reference to have it deleted.

This does not go against ADR 0001. That decision is about the game depending on a third party's runtime to run at all. The relay is a side channel: the game loads, plays and saves without it, a build with no relay URL leaves out only the Send button, and when the relay is down the dialog still offers the report as a download. Our own code runs in it, and the account is ours.

## Considered Options

- **Open a GitHub issue per report, through a GitHub App or a token in the relay:** rejected. An issue is public the moment it exists, and a report can hold a contact address, a save with a player's choices, and logs nobody has looked at. A token able to open issues also has to live in the relay, where a bug or a leak lets anyone write to the repo. Review first, then file an issue by hand.
- **A form service (Formspree, Google Forms and the like):** rejected. Their limits on attachment size and count do not fit a save of a few hundred KB, the data sits with a third party, and the free tiers change.
- **A database (DynamoDB) instead of S3:** rejected. A report is three files the developer opens, not records to query; one S3 listing of `inbox/` shows date, reference, kind and title for every report because the folder name carries them.
- **Download only, testers attach the zip somewhere:** kept as the fallback, not the main path. Most testers have nowhere to attach a file without an account.

## Consequences

- The relay can only `PutObject` under `inbox/`. "Is this reference free?" is a conditional write (`If-None-Match: *`) of `report.json`, so the relay cannot read, list or delete a report, and a report is never written over. References are unique within a day's folder by that check and across days by chance (31^5 of them).
- Guards against abuse cost money, not features: a 5 MB body limit, reserved concurrency 2, CORS for the game's domain `https://browsercol.com` only (the `github.io` address redirects there, so no page posts from it), and a strict check of the JSON's fields and lengths. Changing what the dialog sends means changing `relay/src/report.ts` and deploying the relay first, since it rejects unknown fields.
- Reviewing is moving a folder from `inbox/` to `reviewed/`, where it expires after 180 days. `inbox/` is kept until reviewed.
- Deploys are by hand (`relay/deploy.sh`, the SAM CLI from a Docker image), apart from the game's own deploy. The Pages workflow passes the relay's URL to the build from a repository variable.
