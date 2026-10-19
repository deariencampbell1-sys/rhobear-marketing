# Privacy Policy

**Effective 19 October 2026.** The policy that applies to the product is the one published at
<https://rhobear.ai/privacy.html>, source file
[`.claude/skills/rhobear-design/ui_kits/marketing-site/privacy.html`](.claude/skills/rhobear-design/ui_kits/marketing-site/privacy.html).
This file is the repo-level summary so the two never drift again.

Operator: **Sun Sponge LLC**, 2639 N Power Rd, Apt 1076, Mesa, Arizona 85215, USA ·
<dearien@rhobear.ai>

## What RHOBEAR collects

- **Account**: email, sign-in method, plan.
- **Billing events**: purchases, renewals, upgrades, proration. Card details are handled by
  Apple (App Store) or our payment processor, never by us.
- **GitHub**: the installation and the repositories you grant.
- **Metering**: credits and tokens used per Space, and which model route served a request.
- **Session metadata**: harness name, thread title, project folder, model, status, last activity.
- **Operational logs**: relay connection and error logs.

## What stays inside a Space

Harness sign-ins (Claude Code, Codex, OpenClaw, Hermes, Pi), the user's own API keys, session
transcripts, checkouts, caches and scratch files. These live in an encrypted per-Space folder and
are never sent to our app, our cloud service or our logs. The relay between the app and a Space
is a pipe, not an archive.

## What we do not do

We do not sell or share personal information for advertising, do not train models on user
content, and do not route plan traffic through a reseller (OpenRouter is not used for plan
traffic). Work is saved to the user's own GitHub on `rhobear/<session>` branches, never to the
default branch, never force-pushed, and a secret scan runs before every push.

## Deletion

On cancel: push to GitHub, keep the Space for a stated grace period, then delete the server and
its volumes and verify it is gone. Harness logins and the user's own keys are deleted with the
Space. Account deletion on request.

The full text, including break-glass admin access, subprocessors, retention, user rights and
contact details, is the published page above. Do not edit one without the other.
