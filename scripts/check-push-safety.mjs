// Repository-management check only. Never print secret values or read GitHub credential storage.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// Reviewed historical synthetic fixtures / storage identifier. Exact path + literal digest only;
// this never exempts provider-key signatures, and new/changed literals still fail.
const reviewedFixtureLiterals = new Set([
  "src/ai/config.ts|27bc69c2f08a22971941a6cc2379b8ebe3755791f1b606a57a8b55f26c68c8e2",
  "src/backup/service.test.ts|3448029a0a959abea3bfcf48b294f1efdb7fccaab5ac9ce54f2de0cfc872a62e",
  "src/backup/service.test.ts|83f37ddeb1100b4cc9cfa0483a2ce9f5afb83c6388c1bffcd6fe85c9c81d7fab",
  "src/backup/service.test.ts|86853a3a746ae2d69e6d3cad970116eec73b7bbc745d93836188da38c34097d2",
  "src/research/online/diagnostics.test.ts|708965c2d2eb99a9bc3adc77bf74724395782197b55ea0bbe251c0e9d6252819",
  "src/research/online/outbound.test.ts|f06e194de9d2ad49576b401e6890ab835f65e522c25aaabb8a48e95a0186cfea",
  "src/research/online/outbound.test.ts|fcfcab4091bcf288f4c91862ffaacd7f0b4b750f94909c1180c24821a1c2efaa",
  "src/research/online/proxy.test.ts|644997214048678f54b67b2d3936f2971f890e86b8b945ea2c4834788619a09b",
  "src/research/online/report-diagnostics.test.ts|76393f3aa50cb3280496239f697e0b4f29644a27d43fe8e60284323212cadc2e",
  "src/research/online/windows.test.ts|803c24e9124177b837c80439dccab66de527c32dd159669c1df0d0383ab49468",
  "src/research/research.test.ts|67ff5a8e294d62df5063b54d572534f881cf7c07676802cfb2014672d013bf19",
  "tests/browser/ai-diagnostics.spec.ts|9279ffba1408f542bd07bdac208cb56dbc9cce643639ebf08e02ee73f05a316d",
  "tests/browser/backup.spec.ts|7c1aebf438293ae7924dcb5e14e85a04f08957a38182ea2098da20a3f758c9b0",
  "tests/browser/backup.spec.ts|b2e52a8fd972694740fa8b4beda1f5b57ccbc33e30eaf514a2add3dbc314599a",
  "windows/Test-ResearchService.ps1|1c184063bff81539a38236d1f1c171bb2fb7f2effcd1788beb31f1b60f970010"
]);

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const split = (bytes) => bytes.toString('utf8').split('\0').filter(Boolean);
const blockedPath = (path) =>
  /^(?:\.local|\.codegraph|node_modules|dist|coverage|backups?|exports?|uploads?|private|data|notes|test-results[^/]*|playwright-report|screenshots|browser-profile)(?:\/|$)/i.test(
    path,
  ) ||
  /(^|\/)(?:\.env[^/]*|[^/]+\.env|credentials(?:\.[^/]+)?\.json|secrets(?:\.[^/]+)?\.json|\.npmrc|\.netrc|\.git-credentials|id_rsa|id_ed25519)$/i.test(
    path,
  ) ||
  /\.(?:sqlite[^/]*|db(?:-[^/]*)?|db3[^/]*|s3db[^/]*|pem|key|p12|pfx|dpapi|bak|dump|png|jpe?g|webp|zip)$/i.test(path);
const signatures = [
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['AWS access credential', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['API secret', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['Apify credential', /\bapify_api_[A-Za-z0-9_-]{20,}\b/],
  ['ProLevelMax credential', /\bsk_procli_[A-Za-z0-9_-]{16,}\b/],
  ['IdeaClip scoped credential', /\bmric_[A-Za-z0-9_-]{43}\b/],
  ['Private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
];
function contentFindings(bytes, path, knownSecrets = []) {
  const found = [];
  if (bytes.subarray(0, 16).toString() === 'SQLite format 3\0') found.push('SQLite database');
  for (const secret of knownSecrets)
    if (secret.length >= 16 && bytes.includes(Buffer.from(secret)))
      found.push('Local runtime credential');
  const text = bytes.toString('utf8');
  for (const [label, pattern] of signatures) if (pattern.test(text)) found.push(label);
  const assignment =
    /["']?(?:api[_-]?key|password|sessionSecret|importToken|secret|token)["']?\s*[:=]\s*["']([^"'\r\n]{12,})["']/gi;
  for (const match of text.matchAll(assignment)) {
    if (reviewedFixtureLiterals.has(path + '|' + createHash('sha256').update(match[1]).digest('hex'))) continue;
    // Existing synthetic test-session fixture, in tests only.
    if (path.startsWith('tests/') && match[1] === 'test-session-') continue;
    found.push('Literal credential assignment');
  }
  return [...new Set(found)];
}

if (process.argv.includes('--self-test')) {
  assert(blockedPath('.local/moneyradar.sqlite'));
  assert(blockedPath('renamed.db-wal'));
  assert(blockedPath('.env.example'));
  assert(!blockedPath('server/backup.ts'));
  assert(!blockedPath('src/backup/model.ts'));
  assert(blockedPath('test-results/example/trace.zip'));
  assert(blockedPath('.codegraph/metadata.json'));
  const unreviewedAssignment = ['token', ': ', JSON.stringify(['unreviewed', 'synthetic', 'value'].join('-'))].join('');
  assert(contentFindings(Buffer.from(unreviewedAssignment), 'src/backup/service.test.ts').length);
  assert(contentFindings(Buffer.from('SQLite format 3\0'), 'renamed.txt').length);
  assert(contentFindings(Buffer.from('sk_procli_' + 'X'.repeat(32)), 'sample.txt').length);
  assert(contentFindings(Buffer.from('mric_' + 'X'.repeat(43)), 'sample.txt').length);
  assert(contentFindings(Buffer.from('ghp_' + 'X'.repeat(36)), 'sample.txt').length);
  assert(contentFindings(Buffer.from('x'.repeat(64)), 'sample.txt', ['x'.repeat(64)]).length);
  const syntheticAssignment = [
    'sessionSecret',
    ': ',
    JSON.stringify(['test', 'session', ''].join('-')),
  ].join('');
  assert.equal(contentFindings(Buffer.from(syntheticAssignment), 'tests/sample.ts').length, 0);
  console.log('Push-safety self-check: PASS');
  process.exit(0);
}

const knownSecrets = [];
for (const name of ['APIFY_TOKEN', 'QOVIA_API_KEY', 'GITHUB_TOKEN'])
  if (process.env[name]) knownSecrets.push(process.env[name]);
const configPath = resolve(root, '.local/config.json');
if (existsSync(configPath)) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  for (const key of ['importToken', 'sessionSecret'])
    if (typeof config[key] === 'string') knownSecrets.push(config[key]);
}
const problems = [];
const binaryReview = new Set();
const checkedBlobs = new Set();
const inspect = (bytes, path, scope) => {
  if (blockedPath(path))
    problems.push({ scope, path, reason: 'Forbidden runtime/private filename' });
  for (const reason of contentFindings(bytes, path, knownSecrets))
    problems.push({ scope, path, reason });
  if (/\.(?:jpg|jpeg|png|webp)$/i.test(path)) binaryReview.add(path);
};
const checkObject = (oid, path, scope) => {
  if (blockedPath(path))
    problems.push({ scope, path, reason: 'Forbidden runtime/private filename' });
  if (checkedBlobs.has(oid)) return;
  checkedBlobs.add(oid);
  inspect(git('cat-file', 'blob', oid), path, scope);
};

// Check every commit that would be included in a normal history-preserving push.
const commits = git('rev-list', '--all').toString().trim().split('\n').filter(Boolean);
for (const commit of commits) {
  for (const entry of split(git('ls-tree', '-rz', commit))) {
    const tab = entry.indexOf('\t');
    const [mode, type, oid] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    if (type !== 'blob' || mode === '120000') {
      problems.push({
        scope: 'history',
        path,
        reason: 'Symlink/submodule requires separate review',
      });
      continue;
    }
    checkObject(oid, path, 'history');
  }
}
for (const entry of split(git('ls-files', '--stage', '-z'))) {
  const tab = entry.indexOf('\t');
  const [mode, oid, stage] = entry.slice(0, tab).split(' ');
  const path = entry.slice(tab + 1);
  if (stage !== '0' || mode === '120000' || mode === '160000')
    problems.push({ scope: 'index', path, reason: 'Unmerged/symlink/submodule entry' });
  else checkObject(oid, path, 'index');
}
const files = [
  ...new Set(split(git('ls-files', '--cached', '--others', '--exclude-standard', '-z'))),
];
for (const path of files) {
  const absolute = resolve(root, path);
  if (relative(root, absolute).startsWith('..')) throw new Error('Path outside repository');
  if (!existsSync(absolute)) continue;
  if (lstatSync(absolute).isSymbolicLink()) {
    problems.push({ scope: 'worktree', path, reason: 'Symlink requires separate review' });
    continue;
  }
  inspect(readFileSync(absolute), path.replaceAll('\\', '/'), 'worktree');
}
console.log(
  JSON.stringify(
    {
      passed: problems.length === 0,
      commitsChecked: commits.length,
      uniqueHistoricalAndStagedBlobsChecked: checkedBlobs.size,
      workingFilesChecked: files.length,
      knownLocalSecretsCompared: knownSecrets.length,
      findings: problems,
      binaryManualReviewRequired: [...binaryReview].sort(),
      limitation:
        'Pattern/exact-value scan; review document content and screenshots before every push. No secret values are included in this report.',
    },
    null,
    2,
  ),
);
if (problems.length) process.exitCode = 1;
