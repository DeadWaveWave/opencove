# CLA Setup (Maintainers)

OpenCove uses a Contributor License Agreement (CLA) to ensure contributions can be used under open-source and (potentially) future commercial distribution models.

This doc describes how maintainers can enable an automated CLA gate on GitHub.

## Recommended: CLA Assistant (GitHub App)

We recommend using **CLA Assistant** (https://cla-assistant.io) to:

- prompt contributors to sign once (per GitHub account), and
- publish a required status check on pull requests.

### 1) Create a Gist for the CLA text

CLA Assistant expects the CLA text to live in a GitHub Gist.

- Create an **unlisted** Gist that contains the exact text of `CLA.md`.
- Keep the Gist URL handy.

Tip: If you update `CLA.md` later, update the Gist to match.

### 2) Enable CLA Assistant for the repository

1. Open https://cla-assistant.io and sign in with GitHub.
2. Add the `DeadWaveWave/opencove` repository (or the current canonical repo if it moves).
3. Configure the CLA Assistant settings to point to the Gist URL from step (1).
4. Add an allowlist for bots as needed (for example, `dependabot[bot]`).

After this, a CLA check should appear on PRs from contributors who have not yet signed.

### 3) Require the CLA status check before merge

To enforce the policy:

1. In GitHub repo settings, enable **Branch protection** for `main`.
2. Turn on **Require status checks to pass before merging**.
3. Select the CLA Assistant status check (its exact name will appear after the first PR triggers it).

## Policy notes

- We do **not** require retroactive signatures for contributions merged before the CLA check was enabled.
- The authoritative agreement text lives in `CLA.md` (and should match the configured Gist).
- If a PR was opened *before* CLA Assistant was linked, you may need to re-trigger the check by pushing a new commit to the PR branch or closing/reopening the PR.
