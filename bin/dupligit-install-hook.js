#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const MARK = '# === dupligit hook ===';
const HOOK_NAME = 'pre-push';
const SHEBANG = '#!/usr/bin/env bash\n';

function sh(cmd, cwd = process.cwd()) {
  return execSync(cmd, { stdio: 'pipe', cwd }).toString('utf8').trim();
}

function inGitRepo() {
  try { sh('git rev-parse --is-inside-work-tree'); return true; }
  catch { return false; }
}

function repoRoot() {
  try { return sh('git rev-parse --show-toplevel'); } catch { return process.cwd(); }
}

function hooksDir(root) {
  try {
    const custom = sh('git config --get core.hooksPath', root);
    if (custom) return path.isAbsolute(custom) ? custom : path.join(root, custom);
  } catch {}
  return path.join(root, '.git', 'hooks');
}

function makeExecutable(p) {
  try { fs.chmodSync(p, 0o755); } catch {}
}

function install() {
  // Opt-out knobs
  if (process.env.DUPLIGIT_INSTALL_HOOK === '0' || process.env.CI === 'true') {
    console.log('[dupligit] hook install skipped (env opt-out or CI).');
    return;
  }
  if (!inGitRepo()) {
    console.log('[dupligit] not in a git repo; skipping hook install.');
    return;
  }

  const root = repoRoot();
  const dir = hooksDir(root);
  const hookPath = path.join(dir, HOOK_NAME);

  fs.mkdirSync(dir, { recursive: true });

  const hookBody = `${SHEBANG}set -euo pipefail
${MARK}
# Prefer env token, fallback to global git config key: dupligit.token
if [[ -z \"${DUPLIGIT_TOKEN:-}\" ]]; then
  t=\"$(git config --get dupligit.token || true)\"
  if [[ -n \"$t\" ]]; then export DUPLIGIT_TOKEN=\"$t\"; fi
fi

# Only run if config exists
if [[ -f \"dupligit.config.json\" ]]; then
  echo \"[dupligit hook] running dupligit…\"
  npx -y dupligit -v
else
  echo \"[dupligit hook] no dupligit.config.json; skipping.\"
fi
${MARK} end
`;

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (existing.includes(MARK)) {
      console.log('[dupligit] hook already present.');
      return;
    }
    // Append our block safely before any "exit" lines if possible
    const updated = existing.endsWith('\n')
      ? existing + '\n' + hookBody
      : existing + '\n' + hookBody;
    fs.writeFileSync(hookPath, updated, 'utf8');
    makeExecutable(hookPath);
    console.log('[dupligit] hook appended to existing pre-push.');
  } else {
    fs.writeFileSync(hookPath, hookBody, 'utf8');
    makeExecutable(hookPath);
    console.log('[dupligit] pre-push hook installed.');
  }
}

try { install(); } catch (e) {
  console.log('[dupligit] hook install skipped:', e?.message || e);
}