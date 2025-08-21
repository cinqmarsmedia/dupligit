#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
const MARK = '# === dupligit hook ===';
function sh(c){ return execSync(c,{stdio:'pipe'}).toString('utf8'); }
function repoRoot(){ try {return sh('git rev-parse --show-toplevel').trim();} catch {return process.cwd();} }
function hooksDir(root){ try{const h=sh('git config --get core.hooksPath', root).trim(); if(h) return path.isAbsolute(h)?h:path.join(root,h);}catch{} return path.join(root,'.git','hooks'); }
const root = repoRoot(); const hook = path.join(hooksDir(root), 'pre-push');
if (!fs.existsSync(hook)) process.exit(0);
const txt = fs.readFileSync(hook,'utf8');
const cleaned = txt.split('\n').filter(l=>!l.startsWith(MARK) && !l.includes('dupligit')).join('\n');
fs.writeFileSync(hook, cleaned, 'utf8');
console.log('[dupligit] pre-push hook entries removed.');