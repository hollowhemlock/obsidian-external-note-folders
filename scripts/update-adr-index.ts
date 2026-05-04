import {
  readdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import { join } from 'node:path';

interface AdrRecord {
  date: string;
  fileName: string;
  id: string;
  status: string;
  tags: string[];
  title: string;
  whenToRead: string;
}

const ADR_DIR = 'docs/dev/adr';
const README_PATH = join(ADR_DIR, 'README.md');
const TEMPLATE_FILE = '0000-template.md';
const REVIEW_CHECKLIST_FILE = 'review-checklist.md';

function buildReadme(records: AdrRecord[]): string {
  const generatedAt = getLatestRecordDate(records);
  const lines: string[] = [
    '# Architecture Decision Records',
    '',
    'This index is optimized for fast human and LLM retrieval.',
    '',
    `Last generated: ${generatedAt}`,
    '',
    '## Procedures',
    `- **[${REVIEW_CHECKLIST_FILE}](${REVIEW_CHECKLIST_FILE})** - Use when reviewing an ADR before accepting it.`,
    `- **[${TEMPLATE_FILE}](${TEMPLATE_FILE})** - Template for new ADRs.`,
    '',
    '## Tag Legend',
    '- `vault-model`: source-of-truth, identity, UUID rules',
    '- `external-root`: external folder path and marker contracts',
    '- `reconcile`: planning/execution/journal/recovery flow',
    '- `safety`: trust boundaries and destructive-operation constraints',
    '- `status-model`: user-visible health/status semantics',
    '- `architecture`: core vs adapter boundaries',
    '- `testing`: test strategy, fixtures, and runners',
    '- `release`: versioning/changelog/release automation',
    '- `tooling`: build/runtime/testing tool decisions',
    '',
    '## ADR Index',
    '',
    '| ADR | Status | Date | Scope | Tags | When to read |',
    '|---|---|---|---|---|---|'
  ];

  for (const record of records) {
    lines.push(
      `| [${record.id}](${record.fileName}) | ${escapePipes(record.status)} | ${escapePipes(record.date)} | ${escapePipes(record.title)} | ${
        record.tags.map((tag) => `\`${tag}\``).join(', ')
      } | ${escapePipes(record.whenToRead)} |`
    );
  }

  lines.push(
    '',
    '## Discovery Tips',
    '- Search by tags first, then scan "When to read".',
    '- If a change crosses boundaries, read all ADRs matching each boundary tag.',
    ''
  );

  return lines.join('\n');
}

function escapePipes(value: string): string {
  return value.replaceAll('|', '\\|');
}

function extractFirstMatch(content: string, pattern: RegExp, fallback: string): string {
  const match = pattern.exec(content);
  return match?.[1]?.trim() ?? fallback;
}

function getLatestRecordDate(records: AdrRecord[]): string {
  const knownDates = records
    .map((record) => record.date)
    .filter((date) => date !== 'Unknown')
    .sort();

  return knownDates.at(-1) ?? 'Unknown';
}

function inferTags(text: string): string[] {
  const rules: { regex: RegExp; tag: string }[] = [
    { regex: /\b(vault|source of truth|frontmatter|uuid)\b/i, tag: 'vault-model' },
    { regex: /\b(external|folder|path|marker|\.exf)\b/i, tag: 'external-root' },
    { regex: /\b(reconcile|execution|journal|recovery|serialization|concurrency)\b/i, tag: 'reconcile' },
    { regex: /\b(boundary|identity|trust|no deletion|no-deletions)\b/i, tag: 'safety' },
    { regex: /\b(status|warning|error|unavailable)\b/i, tag: 'status-model' },
    { regex: /\b(layered architecture|adapter|core)\b/i, tag: 'architecture' },
    { regex: /\b(test|fixtures|vitest|integration)\b/i, tag: 'testing' },
    { regex: /\b(release|versioning|changelog|release please)\b/i, tag: 'release' },
    { regex: /\b(obsidian cli|generator-obsidian-plugin|plugin)\b/i, tag: 'tooling' }
  ];

  const tags = new Set<string>();
  for (const rule of rules) {
    if (rule.regex.test(text)) {
      tags.add(rule.tag);
    }
  }

  return [...tags].sort();
}

function inferWhenToRead(tags: string[], title: string): string {
  if (tags.includes('reconcile')) {
    return 'Before changing reconcile planning/execution behavior.';
  }
  if (tags.includes('testing')) {
    return 'Before adding or changing test strategy and fixtures.';
  }
  if (tags.includes('release')) {
    return 'Before changing release automation or version policy.';
  }
  if (tags.includes('architecture')) {
    return 'Before crossing core/adapter boundaries.';
  }
  if (tags.includes('status-model')) {
    return 'Before changing user-visible health/status semantics.';
  }
  if (tags.includes('safety')) {
    return 'Before changing trust boundaries or destructive behavior.';
  }
  if (tags.includes('external-root')) {
    return 'Before changing external folder derivation and marker rules.';
  }
  if (tags.includes('vault-model')) {
    return 'Before changing identity or source-of-truth assumptions.';
  }
  if (tags.includes('tooling')) {
    return 'Before changing build/integration tool choices.';
  }

  return `When touching behavior related to "${title}".`;
}

async function loadAdrRecords(): Promise<AdrRecord[]> {
  const fileNames = await readdir(ADR_DIR);
  const adrFiles = fileNames
    .filter((fileName) => /^\d{4}-.+\.md$/i.test(fileName))
    .filter((fileName) => fileName !== TEMPLATE_FILE)
    .sort();

  const records = await Promise.all(adrFiles.map(async (fileName) => {
    const fullPath = join(ADR_DIR, fileName);
    const content = await readFile(fullPath, 'utf8');
    const frontMatter = parseFrontMatter(content);

    const title = extractFirstMatch(
      content,
      /^#\s+ADR(?:-| )\d{4}:\s+(.+)$/m,
      extractFirstMatch(content, /^#\s+(.+)$/m, fileName)
    );
    const id = fileName.slice(0, 4);
    const status = frontMatter['status'] ?? extractFirstMatch(content, /^\*\*Status:\*\*\s+(.+)$/m, 'Unknown');
    const date = frontMatter['date'] ?? extractFirstMatch(content, /^\*\*Date:\*\*\s+(.+)$/m, 'Unknown');
    const tags = inferTags(`${title} ${fileName}`);
    const whenToRead = inferWhenToRead(tags, title);

    return { date, fileName, id: `ADR-${id}`, status, tags, title, whenToRead };
  }));

  return records;
}

async function main(): Promise<void> {
  const records = await loadAdrRecords();
  const readme = buildReadme(records);
  await writeFile(README_PATH, readme, 'utf8');
}

function parseFrontMatter(content: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(content);
  if (!match?.[1]) {
    return {};
  }

  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const keyValue = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.+)\s*$/.exec(line);
    if (!keyValue) {
      continue;
    }

    const [, rawKey, rawValue] = keyValue;
    if (rawKey === undefined || rawValue === undefined) {
      continue;
    }

    const key = rawKey.trim();
    const normalizedRawValue = rawValue.trim();
    const value = normalizedRawValue.replace(/^['"]|['"]$/g, '').trim();
    metadata[key] = value;
  }

  return metadata;
}

await main();
