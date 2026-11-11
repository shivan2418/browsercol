# Beta reports

The game's Send feedback dialog posts reports to the relay (#370), which
writes each one to the reports bucket as
`inbox/<date>_R-XXXXX_<kind>_<title>/` with `report.json` and, when the tester
left them ticked, `logs.txt` and `save.fsg`. These commands pull and handle
them on your machine. They run the AWS CLI's Docker image
(`amazon/aws-cli`, pinned in `lib.sh`), so nothing is installed on the host;
it gets `~/.aws` read-only, the profile and the region, and runs as you, so
the files it writes are yours.

Agents never run these: they need AWS credentials.

## Setup, once

1. The relay's deploy user in the BrowserCol AWS account (never work's),
   profile `browsercol`, already lists the bucket through
   `relay/deploy-policy.json`. Give it this extra inline policy (#371 step 6)
   so it can read, move and delete reports:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::browsercol-feedback-relay-reports-*/*"
       }
     ]
   }
   ```

   If it ever lacks `s3:ListBucket` on the bucket itself
   (`arn:aws:s3:::browsercol-feedback-relay-reports-*`), add that too.
   Optionally, a separate IAM user with only these permissions keeps report
   handling apart from deploys; give it its own profile and use that below.

2. Copy `config.env.example` to `config.env` (gitignored) and fill in the
   profile (`browsercol`), the stack's region and the bucket, the relay
   stack's `Reports` resource (`browsercol-feedback-relay-reports-...`; the
   stack's Resources tab in the CloudFormation console names it). Or set
   `BETA_AWS_PROFILE`, `BETA_AWS_REGION` and `BETA_BUCKET` in the
   environment, which wins over the file.

The scripts refuse the profiles `default`, `dev` and `prod`, and any profile
whose `~/.aws/config` section has `sso_session = herasight`.

## Commands

- `just beta-pull`: download what is new in `inbox/` to `beta-reports/inbox/`.
  Nothing local is deleted. The folder names carry date, reference, kind and
  title, so `ls beta-reports/inbox` is the index.
- `just beta-reviewed R-XXXXX`: move the report from `inbox/` to `reviewed/`
  in the bucket (where it expires 180 days later) and the local copy to
  `beta-reports/reviewed/`.
- `just beta-delete R-XXXXX`: on a tester's request, delete the report from
  the bucket (`inbox/` or `reviewed/`) and locally. It lists what goes and
  asks first.
- `just beta-test`: the scripts' tests, against a fake `docker` and a fake
  bucket in a temp dir (`fake-docker.sh`). No AWS.
