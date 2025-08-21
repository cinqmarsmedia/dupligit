import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Minimatch } from 'minimatch';

// === dupligit history helpers ===
function gitBuf(cmd, opts={}) {
  const o = { stdio: 'pipe', encoding: 'buffer', ...opts };
  return execSync(`git ${cmd}`, o);
}
function rimrafExceptGit(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (entry === '.git') continue;
    const p = path.join(dir, entry);
    fs.rmSync(p, { recursive: true, force: true });
  }
}
function copyDir(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}
// === end helpers ===


/** Simple binary file heuristic: if it contains a NULL byte in first 8KB, treat as binary */
function isProbablyBinary(buf) {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function git(cmd, opts={}) {
  const o = { stdio: 'pipe', ...opts };
  return execSync(`git ${cmd}`, o).toString('utf8');
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const cfg = JSON.parse(raw);
  if (!cfg.targetRepo) throw new Error("Missing 'targetRepo' in config");
  if (!cfg.targetBranch) cfg.targetBranch = 'main';
  cfg.rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  cfg.ignore = Array.isArray(cfg.ignore) ? cfg.ignore : [];
  return cfg;
}

function makeIgnoreMatchers(patterns) {
  const opts = { dot: true, matchBase: true, nocase: false };
  return patterns.map(p => new Minimatch(p, opts));
}

function isIgnored(file, matchers) {
  return matchers.some(m => m.match(file));
}

function applyRulesToText(text, rules) {
  let out = text;
  for (const r of rules) {
    const flags = r.flags || 'g';
    const re = new RegExp(r.pattern, flags);
    out = out.replace(re, r.replacement);
  }
  return out;
}

import { spawnSync } from 'child_process';

function resolveTargetRemoteUrl(targetRepo, cfg) {
  let token = process.env.DUPLIGIT_TOKEN || process.env.GITHUB_TOKEN;
  if (!token && cfg.tokenCommand) {
    try {
      const out = spawnSync(cfg.tokenCommand, { shell: true, encoding: 'utf8' });
      if (out.status === 0) token = out.stdout.trim();
    } catch (e) {
      console.error('[dupligit] failed to run tokenCommand:', e.message || e);
    }
  }

  // If targetRepo already contains credentials or is ssh, respect it
  if (/^git@/.test(targetRepo) || /^https?:\/\/[^@]+@/.test(targetRepo)) return targetRepo;
  if (token && /^https?:\/\/github\.com\//i.test(targetRepo)) {
    return targetRepo.replace(/^https?:\/\//i, `https://${token}@`);
  }
  return targetRepo;
}

export async function run({ configPath, force = false, verbose = false }) {
  const repoRoot = process.cwd();
  if (verbose) console.error(`[dupligit] repo root: ${repoRoot}`);

  // Resolve config file
  const cfgPath = configPath || process.env.DUPLIGIT_CONFIG || 'dupligit.config.json';
  if (!fs.existsSync(cfgPath)) throw new Error(`Config file not found: ${cfgPath}`);
  const cfg = loadConfig(cfgPath);
  if (!cfg.messageRules) cfg.messageRules = cfg.rules;
  cfg.preserveHistory = !!cfg.preserveHistory;
  // Optionally fetch a token via a command if no env token provided
  if (!process.env.DUPLIGIT_TOKEN && !process.env.GITHUB_TOKEN && cfg.tokenCommand) {
    try {
      const t = execSync(cfg.tokenCommand, { stdio: 'pipe' }).toString('utf8').trim();
      if (t) process.env.DUPLIGIT_TOKEN = t;
    } catch (e) {
      if (verbose) console.error('[dupligit] tokenCommand failed:', e?.message || e);
    }
  }

  const ignoreMatchers = makeIgnoreMatchers([
    '.git/**',
    'node_modules/**',
    ...cfg.ignore
  ]);

  // Retrieve tracked files via git
  let filesRaw;
  try {
    filesRaw = git('ls-files -z', { cwd: repoRoot });
  } catch (e) {
    throw new Error("Failed to list tracked files with 'git ls-files'. Is this a git repo?");
  }
  const files = filesRaw.split('\0').filter(Boolean);

  // Create temp directory
  
  // === preserve history mode ===
  if (cfg.preserveHistory) {
    if (verbose) console.error('[dupligit] history mode enabled');
    // Prepare ignore matchers already built above
    const commitsStr = git('rev-list --first-parent --reverse HEAD', { cwd: repoRoot });
    const commits = commitsStr.trim().split('\n').filter(Boolean);
    if (verbose) console.error(`[dupligit] commits to mirror: ${commits.length}`);

    const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dupligit-stage-'));

    // Prepare push env and remote
    const targetRepo = resolveTargetRemoteUrl(cfg.targetRepo, process.env.DUPLIGIT_TOKEN || process.env.GITHUB_TOKEN);
    const branch = cfg.targetBranch || 'main';
    const env = { ...process.env };
    if (cfg.sshKey) {
      const keyPath = cfg.sshKey.replace(/^~\//, require('os').homedir() + '/');
      env.GIT_SSH_COMMAND = `ssh -i "${keyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
      if (verbose) console.error(`[dupligit] using ssh key: ${keyPath}`);
    }

    // Initialize mirror repo directory (tmpRoot) if not yet
    try { git('init', { cwd: tmpRoot, env }); } catch {}
    try { git('config user.name', { cwd: tmpRoot, env }); }
    catch { git('config user.name \"dupligit-bot\"', { cwd: tmpRoot, env }); }
    try { git('config user.email', { cwd: tmpRoot, env }); }
    catch { git('config user.email \"dupligit@example.com\"', { cwd: tmpRoot, env }); }
    try { git(`remote add origin \"${targetRepo}\"`, { cwd: tmpRoot, env }); } catch {}

    for (const sha of commits) {
      // Build sanitized tree for this commit
      fs.rmSync(stageDir, { recursive: true, force: true });
      fs.mkdirSync(stageDir, { recursive: true });

      const treeRaw = git('ls-tree -r --name-only -z ' + sha, { cwd: repoRoot });
      const files = treeRaw.split('\\0').filter(Boolean);
      for (const rel of files) {
        if (isIgnored(rel, ignoreMatchers)) continue;
        let buf;
        try { buf = gitBuf(`show ${sha}:${rel}`, { cwd: repoRoot }); }
        catch { continue; }
        const dst = path.join(stageDir, rel);
        if (isProbablyBinary(buf)) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.writeFileSync(dst, buf);
        } else {
          const out = applyRulesToText(buf.toString('utf8'), cfg.rules);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.writeFileSync(dst, out, 'utf8');
        }
      }

      // Read author/committer and message
      const meta = git(`show -s --format=%an%n%ae%n%ad%n%B --date=iso-strict ${sha}`, { cwd: repoRoot });
      const lines = meta.split('\\n');
      const authorName = lines.shift() || 'unknown';
      const authorEmail = lines.shift() || 'unknown@example.com';
      const authorDate = lines.shift() || new Date().toISOString();
      const originalMsg = lines.join('\\n');
      const sanitizedMsg = applyRulesToText(originalMsg, cfg.messageRules);

      // Replace mirror worktree with staged files
      rimrafExceptGit(tmpRoot);
      copyDir(stageDir, tmpRoot);

      const commitEnv = {
        ...env,
        GIT_AUTHOR_NAME: authorName,
        GIT_AUTHOR_EMAIL: authorEmail,
        GIT_AUTHOR_DATE: authorDate,
        GIT_COMMITTER_NAME: authorName,
        GIT_COMMITTER_EMAIL: authorEmail,
        GIT_COMMITTER_DATE: authorDate
      };
      git('add -A', { cwd: tmpRoot, env: commitEnv });
      const s = git('status --porcelain', { cwd: tmpRoot, env: commitEnv }).trim();
      if (s.length === 0) {
        git(`commit --allow-empty -m ${JSON.stringify(sanitizedMsg)}`, { cwd: tmpRoot, env: commitEnv });
      } else {
        git(`commit -m ${JSON.stringify(sanitizedMsg)}`, { cwd: tmpRoot, env: commitEnv });
      }
    }

    // Push
    const pushFlags = force ? '--force' : '';
    git(`push ${pushFlags} -u origin ${branch}:${branch}`, { cwd: tmpRoot, env });
    console.error(`[dupligit] Pushed history to ${cfg.targetRepo} (${branch})`);
    return;
  }
  // === end history mode ===
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dupligit-'));
  if (verbose) console.error(`[dupligit] temp dir: ${tmpRoot}`);

  // Copy & transform
  for (const rel of files) {
    if (isIgnored(rel, ignoreMatchers)) {
      if (verbose) console.error(`[dupligit] ignore: ${rel}`);
      continue;
    }
    const src = path.join(repoRoot, rel);
    const dst = path.join(tmpRoot, rel);
    const buf = fs.readFileSync(src);
    if (isProbablyBinary(buf)) {
      ensureDir(dst);
      fs.writeFileSync(dst, buf);
    } else {
      const text = buf.toString('utf8');
      const out = applyRulesToText(text, cfg.rules);
      ensureDir(dst);
      fs.writeFileSync(dst, out, 'utf8');
    }
  }

  // Init repo and push
  const targetRepo = resolveTargetRemoteUrl(cfg.targetRepo, cfg);
  // If sshKey provided, try to ssh-add
  if (cfg.sshKey) {
    try {
      console.error(`[dupligit] adding ssh key: ${cfg.sshKey}`);
      execSync(`ssh-add ${cfg.sshKey}`, { stdio: 'ignore' });
    } catch (e) {
      console.error('[dupligit] failed to add ssh key:', e.message || e);
    }
  }

  const branch = cfg.targetBranch || 'main';
  const env = { ...process.env };
  // If an SSH key path is provided, set GIT_SSH_COMMAND so all git ops use it
  if (cfg.sshKey) {
    const keyPath = cfg.sshKey.replace(/^~\//, require('os').homedir() + '/');
    env.GIT_SSH_COMMAND = `ssh -i "${keyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
    if (verbose) console.error(`[dupligit] using ssh key: ${keyPath}`);
  }

  git('init', { cwd: tmpRoot, env });
  // basic identity if not provided
  try { git('config user.name', { cwd: tmpRoot, env }); }
  catch { git('config user.name "dupligit-bot"', { cwd: tmpRoot, env }); }
  try { git('config user.email', { cwd: tmpRoot, env }); }
  catch { git('config user.email "dupligit@example.com"', { cwd: tmpRoot, env }); }

  // If the target has an existing history, fetch to preserve it (optional)
  try {
    git(`remote add origin "${targetRepo}"`, { cwd: tmpRoot, env });
  } catch {}
  try {
    git(`fetch origin ${branch}`, { cwd: tmpRoot, env });
    git(`checkout -B ${branch} FETCH_HEAD`, { cwd: tmpRoot, env });
  } catch {
    git(`checkout -B ${branch}`, { cwd: tmpRoot, env });
  }

  git('add -A', { cwd: tmpRoot, env });
  // Only commit if there are changes
  let changed = true;
  try {
    const s = git('status --porcelain', { cwd: tmpRoot, env }).trim();
    changed = s.length > 0;
  } catch {}
  if (!changed) {
    console.error('[dupligit] No changes to publish. Exiting.');
    return;
  }
  git(`commit -m "dupligit: sanitized mirror"`, { cwd: tmpRoot, env });

  const pushFlags = force ? '--force' : '';
  git(`push ${pushFlags} -u origin ${branch}:${branch}`, { cwd: tmpRoot, env });
  console.error(`[dupligit] Pushed to ${cfg.targetRepo} (${branch})`);
}
