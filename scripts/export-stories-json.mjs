import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_STORIES_DIR = path.join(REPO_ROOT, 'src', 'data', 'thaiGiao');
const WEEK_FILE_RE = /^week(\d+)\.js$/i;
const STORY_ID_RE = /^w(\d+)-d(\d+)$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseArgs(argv) {
  let outPath = null;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '--out' || arg.startsWith('--out=')) {
      let value;
      if (arg === '--out') {
        i += 1;
        if (i >= argv.length) {
          return { error: 'Missing value for --out' };
        }
        value = argv[i];
      } else {
        value = arg.slice('--out='.length);
      }

      if (!value || !value.trim()) {
        return { error: 'Value for --out must be a non-empty file path' };
      }
      if (outPath !== null) {
        return { error: 'Flag --out may only be specified once' };
      }
      outPath = value;
    } else if (arg.startsWith('-')) {
      return { error: `Unknown flag "${arg}"` };
    } else {
      return { error: `Unexpected positional argument "${arg}"` };
    }
  }

  if (help) {
    return { help: true };
  }

  if (outPath === null) {
    return { error: 'Missing required flag --out <path>' };
  }

  return { outPath };
}

function printUsage(stream = console.error) {
  stream('Usage: node scripts/export-stories-json.mjs --out <path>');
}

function writeFileAtomically(absOutPath, content) {
  const outDir = path.dirname(absOutPath);
  const baseName = path.basename(absOutPath);
  fs.mkdirSync(outDir, { recursive: true });

  const suffix = `${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const tmpPath = path.join(outDir, `.${baseName}.${suffix}`);
  try {
    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmpPath, absOutPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup errors after primary write/rename failure.
    }
    throw err;
  }
}

async function loadStoriesFromDir(storiesDir) {
  let dirStat;
  try {
    dirStat = fs.statSync(storiesDir);
  } catch {
    throw new Error(`Stories directory not found or unreadable: ${storiesDir}`);
  }

  if (!dirStat.isDirectory()) {
    throw new Error(`Stories path is not a directory: ${storiesDir}`);
  }

  const entries = fs.readdirSync(storiesDir);
  const weekFiles = [];
  for (const name of entries) {
    const match = WEEK_FILE_RE.exec(name);
    if (!match) {
      continue;
    }
    const absFile = path.join(storiesDir, name);
    let stat;
    try {
      stat = fs.statSync(absFile);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }
    weekFiles.push({
      fileWeek: Number(match[1]),
      name,
      absFile,
    });
  }

  weekFiles.sort((a, b) => a.fileWeek - b.fileWeek || a.name.localeCompare(b.name));

  if (weekFiles.length === 0) {
    throw new Error(`No week<N>.js modules found in ${storiesDir}`);
  }

  const stories = [];
  const seenIds = new Set();

  for (const { fileWeek, name, absFile } of weekFiles) {
    let mod;
    try {
      mod = await import(pathToFileURL(absFile).href);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to import ${name}: ${msg}`);
    }

    const namedKey = `week${fileWeek}`;
    let weekData;
    if (namedKey in mod) {
      weekData = mod[namedKey];
    } else if ('default' in mod) {
      weekData = mod.default;
    } else {
      throw new Error(`${name}: missing export "${namedKey}" or "default"`);
    }

    if (!isPlainObject(weekData)) {
      throw new Error(`${name}: exported week data must be a plain object`);
    }
    if (!Array.isArray(weekData.stories)) {
      throw new Error(`${name}: weekData.stories must be an array`);
    }

    for (let idx = 0; idx < weekData.stories.length; idx += 1) {
      const raw = weekData.stories[idx];
      if (!isPlainObject(raw)) {
        throw new Error(`${name}: stories[${idx}] must be a plain object`);
      }
      if (typeof raw.week !== 'number' || !Number.isInteger(raw.week)) {
        throw new Error(`${name}: stories[${idx}].week must be an integer`);
      }
      if (typeof raw.day !== 'number' || !Number.isInteger(raw.day)) {
        throw new Error(`${name}: stories[${idx}].day must be an integer`);
      }
      if (typeof raw.id !== 'string' || !STORY_ID_RE.test(raw.id)) {
        throw new Error(`${name}: stories[${idx}].id must match /^w(\\d+)-d(\\d+)$/`);
      }
      const expectedId = `w${raw.week}-d${raw.day}`;
      if (raw.id !== expectedId) {
        throw new Error(`${name}: stories[${idx}].id "${raw.id}" does not match "${expectedId}"`);
      }
      if (seenIds.has(raw.id)) {
        throw new Error(`${name}: duplicate story id "${raw.id}"`);
      }
      seenIds.add(raw.id);

      if (typeof raw.title !== 'string') {
        throw new Error(`${name}: ${raw.id}.title must be a string`);
      }
      if (!Array.isArray(raw.blocks)) {
        throw new Error(`${name}: ${raw.id}.blocks must be an array`);
      }

      const exportedBlocks = [];
      for (let bi = 0; bi < raw.blocks.length; bi += 1) {
        const block = raw.blocks[bi];
        if (!isPlainObject(block)) {
          throw new Error(`${name}: ${raw.id}.blocks[${bi}] must be a plain object`);
        }
        if (typeof block.type !== 'string' || typeof block.text !== 'string') {
          throw new Error(`${name}: ${raw.id}.blocks[${bi}] must have string type and text`);
        }
        exportedBlocks.push({
          type: block.type,
          text: block.text,
        });
      }

      stories.push({
        id: raw.id,
        week: raw.week,
        day: raw.day,
        title: raw.title,
        blocks: exportedBlocks,
      });
    }
  }

  stories.sort((a, b) => a.week - b.week || a.day - b.day || a.id.localeCompare(b.id));
  return stories;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printUsage(console.log);
    return;
  }
  if (parsed.error) {
    console.error(`Usage error: ${parsed.error}`);
    printUsage(console.error);
    process.exitCode = 2;
    return;
  }

  const absOutPath = path.resolve(process.cwd(), parsed.outPath);
  const stories = await loadStoriesFromDir(DEFAULT_STORIES_DIR);
  const payload = `${JSON.stringify(stories, null, 2)}\n`;
  writeFileAtomically(absOutPath, payload);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${msg}`);
  process.exitCode = 1;
});
