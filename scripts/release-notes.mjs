import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const FULL_CHANGELOG_PATTERN = /^\*\*Full Changelog(?::)?\*\*:?\s*(\S+)\s*$/i;
const BULLET_PATTERN = /^\s*[-*]\s+(.+?)\s*$/;
const HEADING_PATTERN = /^#{2,6}\s+(.+?)\s*$/;

const featureHeadingHints = [
  'feature',
  'features',
  'highlight',
  'highlights',
  'durable goal continuation',
  'multi-workspace and desktop ux',
  'secure mcp tunnel',
];
const fixHeadingHints = ['bug fix', 'bug fixes', 'reliability hardening', 'release reliability'];
const otherHeadingHints = [
  'other changes',
  'release assets',
  'windows release assets',
  'windows 10 / 11 and packaging',
  'new contributors',
];

function parseArgs(argv) {
  const options = {
    apply: false,
    backfill: false,
    output: undefined,
    repository: process.env.GITHUB_REPOSITORY,
    tag: process.env.GITHUB_REF_NAME,
    commit: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') options.apply = true;
    else if (argument === '--backfill') options.backfill = true;
    else if (argument === '--repository' || argument === '--repo') options.repository = argv[++index];
    else if (argument === '--tag') options.tag = argv[++index];
    else if (argument === '--previous-tag') options.previousTag = argv[++index];
    else if (argument === '--commit') options.commit = argv[++index];
    else if (argument === '--output') options.output = argv[++index];
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function runGh(args) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed (${result.status}): ${result.stderr?.trim() || 'unknown error'}`);
  }
  return result.stdout;
}

function runGhJson(args) {
  const text = runGh(args).trim();
  return text ? JSON.parse(text) : null;
}

function stripHeadingDecoration(value) {
  return value
    .replace(/(?:🚀|🐛|🐞|🪲|🧹|📝|🔧|⚙️?)/gu, '')
    .trim()
    .toLowerCase();
}

function classifyHeading(heading) {
  const normalized = stripHeadingDecoration(heading);
  if (normalized === "what's changed" || normalized === 'whats changed') return 'auto';
  if (featureHeadingHints.some((hint) => normalized === hint || normalized.includes(hint))) return 'features';
  if (fixHeadingHints.some((hint) => normalized === hint || normalized.includes(hint))) return 'fixes';
  if (otherHeadingHints.some((hint) => normalized === hint || normalized.includes(hint))) return 'other';
  return 'auto';
}

export function classifyReleaseEntry(entry) {
  const text = entry
    .replace(/^\s*[`*_]+/, '')
    .replace(/[`*_]+\s*$/, '')
    .trim();

  if (/^(?:feat|feature)(?:\([^)]*\))?!?:/i.test(text)) return 'features';
  if (/^(?:fix|bugfix|hotfix)(?:\([^)]*\))?!?:/i.test(text)) return 'fixes';
  if (/^fix\b/i.test(text) || /\b(?:bugfix|hotfix|fixes|fixed)\b/i.test(text)) return 'fixes';
  return 'other';
}

function dedupeEntries(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function extractReleaseEntries(body = '') {
  const categories = { features: [], fixes: [], other: [] };
  let section = 'auto';
  let sawHeading = false;
  let paragraph = [];

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (!text || FULL_CHANGELOG_PATTERN.test(text)) return;
    categories.other.push(text);
  };

  for (const rawLine of body.replaceAll('\r\n', '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    if (FULL_CHANGELOG_PATTERN.test(line)) {
      flushParagraph();
      continue;
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      flushParagraph();
      section = classifyHeading(heading[1] ?? '');
      sawHeading = true;
      continue;
    }

    const bullet = line.match(BULLET_PATTERN);
    if (bullet) {
      flushParagraph();
      const entry = bullet[1]?.trim();
      if (!entry || FULL_CHANGELOG_PATTERN.test(entry)) continue;
      const target = section === 'auto' ? classifyReleaseEntry(entry) : section;
      categories[target].push(entry);
      continue;
    }

    if (sawHeading) {
      const target = section === 'auto' ? classifyReleaseEntry(line) : section;
      categories[target].push(line);
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();

  return {
    features: dedupeEntries(categories.features),
    fixes: dedupeEntries(categories.fixes),
    other: dedupeEntries(categories.other),
  };
}

export function extractFullChangelog(body = '') {
  for (const rawLine of body.replaceAll('\r\n', '\n').split('\n')) {
    const match = rawLine.trim().match(FULL_CHANGELOG_PATTERN);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function entryCount(categories) {
  return categories.features.length + categories.fixes.length + categories.other.length;
}

function mergeCategories(primary, fallback) {
  if (entryCount(primary) > 0) return primary;
  return fallback;
}

function buildFullChangelogUrl(repository, previousTag, tag) {
  if (!repository || !tag) return undefined;
  if (previousTag) return `https://github.com/${repository}/compare/${previousTag}...${tag}`;
  return `https://github.com/${repository}/commits/${tag}`;
}

function renderCategory(title, entries) {
  const lines = entries.length > 0 ? entries.map((entry) => `- ${entry}`) : ['- None.'];
  return [`## ${title}`, '', ...lines].join('\n');
}

export function renderReleaseNotes({ categories, fullChangelogUrl }) {
  const sections = [
    renderCategory('Features', categories.features),
    renderCategory('Bug Fixes', categories.fixes),
    renderCategory('Other Changes', categories.other),
  ];
  if (fullChangelogUrl) sections.push(`**Full Changelog**: ${fullChangelogUrl}`);
  return `${sections.join('\n\n')}\n`;
}

export function normalizeReleaseNotesBody({
  sourceBody = '',
  fallbackBody = '',
  repository,
  tag,
  previousTag,
  additionalOtherEntries = [],
}) {
  const sourceCategories = extractReleaseEntries(sourceBody);
  const fallbackCategories = extractReleaseEntries(fallbackBody);
  const categories = mergeCategories(sourceCategories, fallbackCategories);
  categories.other = dedupeEntries([...additionalOtherEntries, ...categories.other]);

  const fullChangelogUrl =
    extractFullChangelog(sourceBody) ??
    extractFullChangelog(fallbackBody) ??
    buildFullChangelogUrl(repository, previousTag, tag);

  return renderReleaseNotes({ categories, fullChangelogUrl });
}

function generatedNotes(repository, tag, previousTag) {
  const args = ['api', '--method', 'POST', `repos/${repository}/releases/generate-notes`, '-f', `tag_name=${tag}`];
  if (previousTag) args.push('-f', `previous_tag_name=${previousTag}`);
  const response = runGhJson(args);
  return typeof response?.body === 'string' ? response.body : '';
}

function compareCommitEntries(repository, tag, previousTag) {
  if (!previousTag) return ['Initial public release.'];
  const comparison = runGhJson(['api', `repos/${repository}/compare/${previousTag}...${tag}`]);
  const commits = Array.isArray(comparison?.commits) ? comparison.commits : [];
  const entries = [];
  for (const commit of commits) {
    const message = commit?.commit?.message?.split(/\r?\n/, 1)?.[0]?.trim();
    const sha = commit?.sha;
    if (!message || !sha || /^Merge pull request\b/i.test(message)) continue;
    const shortSha = sha.slice(0, 7);
    entries.push(`${message} ([\`${shortSha}\`](https://github.com/${repository}/commit/${sha}))`);
  }
  return dedupeEntries(entries);
}

function generatedOrCommitFallback(repository, tag, previousTag) {
  let body = '';
  try {
    body = generatedNotes(repository, tag, previousTag);
  } catch (error) {
    console.warn(`GitHub generated notes unavailable for ${tag}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (entryCount(extractReleaseEntries(body)) > 0) return body;

  const categories = { features: [], fixes: [], other: [] };
  for (const entry of compareCommitEntries(repository, tag, previousTag)) {
    categories[classifyReleaseEntry(entry)].push(entry);
  }
  return renderReleaseNotes({
    categories,
    fullChangelogUrl: buildFullChangelogUrl(repository, previousTag, tag),
  });
}

function listPublishedReleases(repository) {
  const releases = runGhJson(['api', `repos/${repository}/releases?per_page=100`]);
  if (!Array.isArray(releases)) throw new Error('GitHub releases API returned an unexpected response.');
  return releases
    .filter((release) => release && !release.draft && typeof release.tag_name === 'string')
    .sort((left, right) => new Date(right.published_at ?? right.created_at ?? 0) - new Date(left.published_at ?? left.created_at ?? 0));
}

function latestPublishedTag(repository, currentTag) {
  const releases = listPublishedReleases(repository);
  return releases.find((release) => release.tag_name !== currentTag)?.tag_name;
}

function futureReleaseMetadata(commit) {
  if (!commit) return [];
  return [
    `Published from the exact successful CI commit \`${commit}\`.`,
    'Release artifacts include target-native Windows, macOS (arm64/x64), and Linux (x64/arm64) packages with `RELEASE_MANIFEST.json`, per-target provenance, and aggregate SHA-256 evidence. No package or build step runs in the tag workflow.',
  ];
}

async function generateOne(options) {
  if (!options.repository) throw new Error('Missing repository. Pass --repository owner/repo or set GITHUB_REPOSITORY.');
  if (!options.tag) throw new Error('Missing tag. Pass --tag vX.Y.Z or set GITHUB_REF_NAME.');

  const previousTag = options.previousTag ?? latestPublishedTag(options.repository, options.tag);
  const fallbackBody = generatedOrCommitFallback(options.repository, options.tag, previousTag);
  const body = normalizeReleaseNotesBody({
    sourceBody: fallbackBody,
    repository: options.repository,
    tag: options.tag,
    previousTag,
    additionalOtherEntries: futureReleaseMetadata(options.commit),
  });

  if (options.output) {
    await writeFile(options.output, body, 'utf8');
    console.log(`Wrote standardized release notes for ${options.tag} to ${options.output}`);
  } else {
    process.stdout.write(body);
  }
}

async function backfill(options) {
  if (!options.repository) throw new Error('Missing repository. Pass --repository owner/repo or set GITHUB_REPOSITORY.');
  const releases = listPublishedReleases(options.repository);
  let changed = 0;

  for (let index = 0; index < releases.length; index += 1) {
    const release = releases[index];
    const tag = release.tag_name;
    const previousTag = releases[index + 1]?.tag_name;
    const sourceBody = typeof release.body === 'string' ? release.body : '';
    const sourceEntries = extractReleaseEntries(sourceBody);
    const fallbackBody = entryCount(sourceEntries) > 0 ? '' : generatedOrCommitFallback(options.repository, tag, previousTag);
    const normalized = normalizeReleaseNotesBody({
      sourceBody,
      fallbackBody,
      repository: options.repository,
      tag,
      previousTag,
    });

    if (normalized.trim() === sourceBody.trim()) {
      console.log(`unchanged ${tag}`);
      continue;
    }

    changed += 1;
    if (!options.apply) {
      console.log(`would update ${tag}`);
      continue;
    }

    runGh(['release', 'edit', tag, '--repo', options.repository, '--notes', normalized]);
    console.log(`updated ${tag}`);
  }

  console.log(`${options.apply ? 'Updated' : 'Would update'} ${changed} of ${releases.length} published releases.`);
}

function printHelp() {
  console.log(`Usage:
  node scripts/release-notes.mjs --tag vX.Y.Z --repository owner/repo [--commit SHA] [--output release-notes.md]
  node scripts/release-notes.mjs --backfill --repository owner/repo [--apply]

The generated body always contains these headings in this order:
  ## Features
  ## Bug Fixes
  ## Other Changes

Backfill mode is dry-run unless --apply is supplied.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.backfill) await backfill(options);
  else await generateOne(options);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
