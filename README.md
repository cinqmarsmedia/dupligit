# dupligit

**Sanitize & mirror** a private repository to a public one on every push — with a tiny config-driven tool. Ideal for maintaining a public repo from a parent repo that has secrets or sensitive data. 

- 🧽 Replace secrets using simple **regex rules**
- 🚫 Skip sensitive files using **ignore globs**
- 🔁 **Push** the sanitized tree to a target repo/branch
- 🧰 Use as a **CLI** or **GitHub Action**
- 🪶 Minimal deps: only `minimatch`

## Install (CLI)

```bash
# local use
npm i -D dupligit
npx dupligit --help
```

Or run via `node` if vendored in your repo:

```bash
node node_modules/dupligit/bin/dupligit.js
```

## Config

Create a `dupligit.config.json` at the root of your private repo:

```jsonc
{
  "targetRepo": "https://github.com/you/your-public-mirror",
  "targetBranch": "main",
  "rules": [
    { "pattern": "API_KEY=.*", "replacement": "API_KEY=YOUR_API_KEY_HERE", "flags": "g" },
    { "pattern": "password\\s*=\\s*[\"'][^\"']+[\"']", "replacement": "password = \"REDACTED\"", "flags": "gi" }
  ],
  "ignore": [
    "*.env",
    "*.env.*",
    ".env*",
    "secrets/",
    "private/",
    "*.key",
    "*.pem",
    "config/production.*",
    "dupligit.config.json"
  ]
}
```

> You can also set `DUPLIGIT_CONFIG=path/to/config.json` in the environment.

## Usage

```bash
# from the root of your private repo
export DUPLIGIT_TOKEN=<gh_pat_with_repo_scope>
npx dupligit -v
```

Options:
- `-c, --config` Path to config JSON (defaults to `dupligit.config.json`)
- `-f, --force`  Force push to target branch
- `-v, --verbose` Verbose logs

## GitHub Action

use npx dupligit-setup-action to automatically do the following or manually
Add a workflow to your private repo at `.github/workflows/dupligit.yml`:

```yaml
name: dupliGit (Mirror)
on:
  push:
    branches: [ "**" ]  # or your source branch
jobs:
  mirror:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm i dupligit@0.1.0
      - run: npx dupligit -f -v
        env:
          DUPLIGIT_TOKEN: ${{ secrets.DUPLIGIT_TOKEN }}
```

> **Auth:** Create a **fine-scoped PAT** on the *target* GitHub account/repo with permission to push to the target repo. Save it as `DUPLIGIT_TOKEN` in the private repo’s settings.

## How it works

1. Lists tracked files via `git ls-files`.
2. Excludes any paths matching the `ignore` patterns.
3. Reads each remaining file:
   - If **binary**, copies as-is.
   - If **text**, sequentially applies each regex rule to the file content.
4. Initializes a temp Git repository, commits, and pushes to the `targetRepo`/`targetBranch`.

## Safety tips

- Prefer **deny-by-default** ignores; add folders like `secrets/`, `private/`, `*.env`, `*.pem`.
- Redaction regexes should be **specific**; test with representative samples.
- Consider adding a **pre-push** hook in your private repo to run `dupligit` and block pushes if redaction fails.
- Run against a **throwaway** target repo first to verify results.

## Troubleshooting

- *No changes to publish.* — After replacements, nothing changed between runs.
- *Auth failures.* — Ensure `DUPLIGIT_TOKEN` has push rights to `targetRepo`. If your `targetRepo` is not on GitHub, embed credentials in the URL or configure your git credential helper.
- *Line endings.* — The tool preserves your file’s original line endings. Configure `.gitattributes` if you need normalization.

## License

MIT


## Extra auth options

In addition to using `DUPLIGIT_TOKEN` env or Git credential helpers, you can specify:

- `"sshKey": "/path/to/private/key"`  
  dupligit will `ssh-add` this key before pushing.

- `"tokenCommand": "gh auth token"`  
  dupligit will run the command and use its stdout as the token.

Example:

```jsonc
{
  "targetRepo": "git@github.com:you/your-public-mirror.git",
  "sshKey": "~/.ssh/dupligit_mirror",
  "tokenCommand": "pass show github/dupligit-token",
  "rules": [],
  "ignore": []
}
```


## Authentication options

Pick one — **no secrets in files required**:

### 1) SSH deploy key (recommended for local hooks)
```bash
ssh-keygen -t ed25519 -C "dupligit-mirror" -f ~/.ssh/dupligit_mirror
# Add ~/.ssh/dupligit_mirror.pub as a Deploy Key (with write) on the public mirror repo
```
In `dupligit.config.json`:
```jsonc
{ "targetRepo": "git@github.com:you/your-public-mirror.git", "sshKey": "~/.ssh/dupligit_mirror" }
```

### 2) Environment token (simple for CI)
```bash
export DUPLIGIT_TOKEN=<gh_pat_with_repo_scope>
npx dupligit
```

### 3) tokenCommand (pull token from a safe helper)
```jsonc
{ "tokenCommand": "gh auth token" }
```
dupligit will run the command and use its stdout as the token if no env token is set.

### 4) System Git credential helper
Configure your OS credential store (Keychain/Manager/etc.) and do a one-time authenticated push to cache creds. dupligit will reuse them.
