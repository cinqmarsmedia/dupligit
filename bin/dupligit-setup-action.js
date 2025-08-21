#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const WORKFLOW_DIR = path.join(process.cwd(), '.github', 'workflows');
const WORKFLOW_FILE = path.join(WORKFLOW_DIR, 'dupligit.yml');

const TEMPLATE = `name: dupliGit (Mirror)
on:
  push:
    branches: [ "**" ]
jobs:
  mirror:
    runs-on: ubuntu-latest
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
          DUPLIGIT_TOKEN: \${{ secrets.DUPLIGIT_TOKEN }}
`;

if (!fs.existsSync(WORKFLOW_DIR)) {
  fs.mkdirSync(WORKFLOW_DIR, { recursive: true });
}
if (fs.existsSync(WORKFLOW_FILE)) {
  console.error(`[dupligit] ${WORKFLOW_FILE} already exists, not overwriting.`);
  process.exit(1);
}
fs.writeFileSync(WORKFLOW_FILE, TEMPLATE, 'utf8');
console.log(`[dupligit] Workflow created at ${WORKFLOW_FILE}`);