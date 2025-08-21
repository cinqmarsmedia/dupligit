#!/usr/bin/env node
import { run } from '../lib/dupligit.js';

function parseArgs(argv) {
  const args = { config: null, force: false, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-c' || a === '--config') { args.config = argv[++i]; }
    else if (a === '-f' || a === '--force') { args.force = true; }
    else if (a === '-v' || a === '--verbose') { args.verbose = true; }
    else if (a === '-h' || a === '--help') { args.help = true; }
    else {
      // allow positional config path
      if (!args.config) args.config = a;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`dupligit - sanitize & mirror a repo
Usage:
  dupligit [options] [path/to/dupligit.config.json]

Options:
  -c, --config   Path to config JSON (defaults to dupligit.config.json)
  -f, --force    Force push to target branch
  -v, --verbose  Verbose logs
  -h, --help     Show help

Env:
  DUPLIGIT_CONFIG  Path to config JSON (alternative to --config)
  DUPLIGIT_TOKEN   Git auth token with push rights to target repo (preferred)
  GITHUB_TOKEN     Fallback token name (e.g., in GitHub Actions)
`);
    process.exit(0);
  }
  try {
    await run({ configPath: args.config, force: args.force, verbose: args.verbose });
  } catch (e) {
    console.error('[dupligit] ERROR:', e?.message || e);
    process.exit(1);
  }
}

main();
