import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_DIR = 'src/data/thaiGiao';
const DEFAULT_OPENING_MAX = 14;
const OPENING_SHINGLE_WORDS = 6;
const WEEK_FILE_RE = /^week(\d+)\.js$/i;
const STORY_ID_RE = /^w(\d+)-d(\d+)$/;
const ALLOWED_BLOCK_TYPES = new Set(['p', 'h2', 'quote', 'tip']);
const EXPECTED_STORY_COUNT = 7;
const MIN_BLOCKS = 8;
const MIN_WORDS = 1050;
const MAX_WORDS = 1500;
const MAX_TITLE_CHARS = 90;
const MAX_EXCERPT_CHARS_EXCLUSIVE = 220;
const MIN_EXCERPT_SENTENCES = 1;
const MAX_EXCERPT_SENTENCES = 2;
const WORDS_PER_MINUTE = 105;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toDisplayPath(absPath) {
  const rel = path.relative(process.cwd(), absPath);
  if (!rel) {
    return path.basename(absPath);
  }
  return rel.replace(/\\/g, '/');
}

function countWords(blocks) {
  if (!Array.isArray(blocks)) {
    return 0;
  }
  const joined = blocks
    .map((block) => (isPlainObject(block) && typeof block.text === 'string' ? block.text : ''))
    .join(' ');
  return joined.split(/\s+/).filter(Boolean).length;
}

function countSentences(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  const matches = trimmed.match(/[.!?…]+(\s|$)/g);
  return matches ? matches.length : 0;
}

function extractFirstSentence(text) {
  const raw = String(text ?? '');
  const match = /[.!?…]/u.exec(raw);
  return match ? raw.slice(0, match.index + 1) : raw;
}

function normalizeOpening(s) {
  return s.toLocaleLowerCase('vi').replace(/\p{P}/gu, '').replace(/\s+/gu, ' ').trim();
}

function parseArgs(argv) {
  let json = false;
  let weeksRange = null;
  let targetDir = null;
  let openingMax = DEFAULT_OPENING_MAX;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--weeks' || arg.startsWith('--weeks=')) {
      let value;
      if (arg === '--weeks') {
        i += 1;
        if (i >= argv.length) {
          return { error: 'Missing value for --weeks (expected N or A-B)' };
        }
        value = argv[i];
      } else {
        value = arg.slice('--weeks='.length);
      }

      const singleMatch = /^(\d+)$/.exec(value);
      const rangeMatch = /^(\d+)-(\d+)$/.exec(value);
      if (singleMatch) {
        const weekNum = Number(singleMatch[1]);
        weeksRange = { min: weekNum, max: weekNum };
      } else if (rangeMatch) {
        const min = Number(rangeMatch[1]);
        const max = Number(rangeMatch[2]);
        if (min > max) {
          return { error: `Invalid --weeks range "${value}": start (${min}) > end (${max})` };
        }
        weeksRange = { min, max };
      } else {
        return { error: `Invalid --weeks value "${value}" (expected N or A-B)` };
      }
    } else if (arg === '--opening-max' || arg.startsWith('--opening-max=')) {
      let value;
      if (arg === '--opening-max') {
        i += 1;
        if (i >= argv.length) {
          return { error: 'Missing value for --opening-max (expected non-negative integer)' };
        }
        value = argv[i];
      } else {
        value = arg.slice('--opening-max='.length);
      }

      if (!/^\d+$/.test(value)) {
        return { error: `Invalid --opening-max value "${value}" (expected non-negative integer)` };
      }
      const parsedMax = Number(value);
      if (!Number.isSafeInteger(parsedMax) || parsedMax < 0) {
        return { error: `Invalid --opening-max value "${value}" (expected non-negative integer)` };
      }
      openingMax = parsedMax;
    } else if (arg.startsWith('-')) {
      return { error: `Unknown flag "${arg}"` };
    } else if (targetDir === null) {
      targetDir = arg;
    } else {
      return { error: `Unexpected extra argument "${arg}"` };
    }
  }

  return {
    json,
    weeksRange,
    openingMax,
    targetDir: targetDir ?? DEFAULT_DIR,
  };
}

function printUsage(errorMessage) {
  console.error(`Usage error: ${errorMessage}`);
  console.error(
    'Usage: node scripts/validate-stories.mjs [dir] [--weeks N|A-B] [--opening-max N] [--json]',
  );
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    printUsage(parsed.error);
    process.exitCode = 2;
    return;
  }

  const absDir = path.resolve(process.cwd(), parsed.targetDir);
  let dirStat;
  try {
    dirStat = fs.statSync(absDir);
  } catch {
    console.error(`Error: directory not found or unreadable: ${absDir}`);
    process.exitCode = 2;
    return;
  }

  if (!dirStat.isDirectory()) {
    console.error(`Error: path is not a directory: ${absDir}`);
    process.exitCode = 2;
    return;
  }

  let dirEntries;
  try {
    dirEntries = fs.readdirSync(absDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: failed to read directory ${absDir}: ${msg}`);
    process.exitCode = 2;
    return;
  }

  const weekFiles = [];
  for (const name of dirEntries) {
    const match = WEEK_FILE_RE.exec(name);
    if (!match) {
      continue;
    }
    const absFile = path.join(absDir, name);
    let fileStat;
    try {
      fileStat = fs.statSync(absFile);
    } catch {
      continue;
    }
    if (!fileStat.isFile()) {
      continue;
    }
    const fileWeek = Number(match[1]);
    if (parsed.weeksRange && (fileWeek < parsed.weeksRange.min || fileWeek > parsed.weeksRange.max)) {
      continue;
    }
    weekFiles.push({
      fileWeek,
      name,
      absFile,
      relFile: toDisplayPath(absFile),
    });
  }

  weekFiles.sort((a, b) => a.fileWeek - b.fileWeek || a.name.localeCompare(b.name));

  if (weekFiles.length === 0) {
    const rangeInfo = parsed.weeksRange
      ? ` matching --weeks ${parsed.weeksRange.min}-${parsed.weeksRange.max}`
      : '';
    console.error(`Error: no week<N>.js modules found in ${absDir}${rangeInfo}`);
    process.exitCode = 2;
    return;
  }

  const errors = [];
  const weekSummaries = [];
  const storySummaries = [];
  const loadedStories = [];
  const seenIds = new Map();
  const duplicateIds = new Set();
  let hasLoadError = false;

  for (const { fileWeek, absFile, relFile } of weekFiles) {
    let mod;
    try {
      mod = await import(pathToFileURL(absFile).href);
    } catch (err) {
      hasLoadError = true;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${relFile}:: LOAD failed to import module: ${msg}`);
      weekSummaries.push({
        week: fileWeek,
        theme: '',
        stories: 0,
        words: 0,
        ok: false,
      });
      continue;
    }

    const namedKey = `week${fileWeek}`;
    let hasExport = false;
    let weekData;

    if (namedKey in mod) {
      hasExport = true;
      weekData = mod[namedKey];
    } else if ('default' in mod) {
      hasExport = true;
      weekData = mod.default;
    }

    if (!hasExport) {
      hasLoadError = true;
      errors.push(`${relFile}:: LOAD missing export "${namedKey}" or "default"`);
      weekSummaries.push({
        week: fileWeek,
        theme: '',
        stories: 0,
        words: 0,
        ok: false,
      });
      continue;
    }

    const moduleErrors = [];
    const pushModuleError = (msg) => {
      moduleErrors.push(msg);
      errors.push(`${relFile}:: ${msg}`);
    };

    if (!isPlainObject(weekData)) {
      pushModuleError(
        `M1 export object must be a plain object (got ${weekData === null ? 'null' : typeof weekData})`,
      );
      weekSummaries.push({
        week: fileWeek,
        theme: '',
        stories: 0,
        words: 0,
        ok: false,
      });
      continue;
    }

    const hasIntWeek = typeof weekData.week === 'number' && Number.isInteger(weekData.week);
    const moduleWeek = hasIntWeek ? weekData.week : fileWeek;

    if (!hasIntWeek) {
      pushModuleError(`M1 week must be an integer (got ${JSON.stringify(weekData.week)})`);
    } else if (weekData.week !== fileWeek) {
      pushModuleError(`M1 week ${weekData.week} does not match filename week ${fileWeek}`);
    }

    if (!isNonEmptyString(weekData.theme)) {
      pushModuleError(`M1 theme must be a non-empty string (got ${JSON.stringify(weekData.theme)})`);
    }

    if (!isNonEmptyString(weekData.developmentalNote)) {
      pushModuleError(
        `M1 developmentalNote must be a non-empty string (got ${JSON.stringify(weekData.developmentalNote)})`,
      );
    }

    const weekEntry = {
      week: moduleWeek,
      theme: typeof weekData.theme === 'string' ? weekData.theme : '',
      stories: 0,
      words: 0,
      ok: true,
    };
    weekSummaries.push(weekEntry);

    if (!Array.isArray(weekData.stories)) {
      pushModuleError(
        `M2 stories must be an array (got ${weekData.stories === null ? 'null' : typeof weekData.stories})`,
      );
      weekEntry.ok = false;
      continue;
    }

    weekEntry.stories = weekData.stories.length;
    if (weekData.stories.length !== EXPECTED_STORY_COUNT) {
      pushModuleError(
        `M2 stories array length ${weekData.stories.length} must be exactly ${EXPECTED_STORY_COUNT}`,
      );
    }

    // M3: days present exactly once each, values 1..7
    const dayCounts = new Map();
    const invalidDays = [];
    for (const story of weekData.stories) {
      const dayVal = isPlainObject(story) ? story.day : undefined;
      if (typeof dayVal === 'number' && Number.isInteger(dayVal) && dayVal >= 1 && dayVal <= 7) {
        dayCounts.set(dayVal, (dayCounts.get(dayVal) ?? 0) + 1);
      } else {
        invalidDays.push(dayVal);
      }
    }
    if (invalidDays.length > 0) {
      pushModuleError(`M3 invalid day value(s) ${JSON.stringify(invalidDays)} (expected integers 1..7)`);
    }
    const duplicateDays = [];
    const missingDays = [];
    for (let d = 1; d <= 7; d += 1) {
      const count = dayCounts.get(d) ?? 0;
      if (count === 0) {
        missingDays.push(d);
      } else if (count > 1) {
        duplicateDays.push(d);
      }
    }
    if (duplicateDays.length > 0) {
      pushModuleError(
        `M3 duplicate day(s) ${duplicateDays.join(', ')} (expected each of 1..7 exactly once)`,
      );
    }
    if (missingDays.length > 0) {
      pushModuleError(`M3 missing day(s) ${missingDays.join(', ')} (expected 1..7)`);
    }

    let moduleWords = 0;

    for (let idx = 0; idx < weekData.stories.length; idx += 1) {
      const story = weekData.stories[idx];
      const storyLabel =
        isPlainObject(story) && typeof story.id === 'string' && story.id.trim().length > 0
          ? story.id.trim()
          : `stories[${idx}]`;

      let storyHasError = false;
      const pushStoryError = (msg) => {
        storyHasError = true;
        moduleErrors.push(`${storyLabel}:: ${msg}`);
        errors.push(`${relFile}:: ${storyLabel}:: ${msg}`);
      };

      if (!isPlainObject(story)) {
        pushStoryError(
          `S1 story at index ${idx} must be an object (got ${story === null ? 'null' : typeof story})`,
        );
        storySummaries.push({
          id: '',
          week: null,
          day: null,
          words: 0,
          minutes: null,
          title: '',
          ok: false,
        });
        continue;
      }

      // S1: id matches /^w(\d+)-d(\d+)$/ AND id === `w${week}-d${day}`
      const idMatch = typeof story.id === 'string' ? STORY_ID_RE.exec(story.id) : null;
      if (!idMatch) {
        pushStoryError(`S1 id ${JSON.stringify(story.id)} must be a string matching /^w(\\d+)-d(\\d+)$/`);
      } else {
        const expectedId = `w${story.week}-d${story.day}`;
        if (story.id !== expectedId) {
          pushStoryError(`S1 id "${story.id}" does not match expected "${expectedId}"`);
        }
      }

      // S2: week/day are integers equal to parent module week and id numbers
      const storyWeekIsInt = typeof story.week === 'number' && Number.isInteger(story.week);
      const storyDayIsInt = typeof story.day === 'number' && Number.isInteger(story.day);

      if (!storyWeekIsInt) {
        pushStoryError(`S2 week ${JSON.stringify(story.week)} must be an integer`);
      } else {
        if (hasIntWeek && story.week !== weekData.week) {
          pushStoryError(`S2 week ${story.week} does not match parent module week ${weekData.week}`);
        }
        if (idMatch && Number(idMatch[1]) !== story.week) {
          pushStoryError(`S2 week ${story.week} does not match id week ${Number(idMatch[1])}`);
        }
      }

      if (!storyDayIsInt) {
        pushStoryError(`S2 day ${JSON.stringify(story.day)} must be an integer`);
      } else {
        if (story.day < 1 || story.day > 7) {
          pushStoryError(`S2 day ${story.day} must be between 1 and 7`);
        }
        if (idMatch && Number(idMatch[2]) !== story.day) {
          pushStoryError(`S2 day ${story.day} does not match id day ${Number(idMatch[2])}`);
        }
      }

      // S3: title non-empty string, <= 90 chars after trim
      if (!isNonEmptyString(story.title)) {
        pushStoryError(`S3 title must be a non-empty string (got ${JSON.stringify(story.title)})`);
      } else {
        const titleLen = story.title.trim().length;
        if (titleLen > MAX_TITLE_CHARS) {
          pushStoryError(`S3 title length ${titleLen} exceeds maximum ${MAX_TITLE_CHARS}`);
        }
      }

      // S4: excerpt non-empty string, 1-2 sentences, < 220 chars after trim
      if (!isNonEmptyString(story.excerpt)) {
        pushStoryError(`S4 excerpt must be a non-empty string (got ${JSON.stringify(story.excerpt)})`);
      } else {
        const excerptText = story.excerpt.trim();
        const excerptLen = excerptText.length;
        if (excerptLen >= MAX_EXCERPT_CHARS_EXCLUSIVE) {
          pushStoryError(`S4 excerpt length ${excerptLen} must be < ${MAX_EXCERPT_CHARS_EXCLUSIVE}`);
        }
        const sentenceCount = countSentences(excerptText);
        if (sentenceCount < MIN_EXCERPT_SENTENCES || sentenceCount > MAX_EXCERPT_SENTENCES) {
          pushStoryError(
            `S4 excerpt must contain ${MIN_EXCERPT_SENTENCES}-${MAX_EXCERPT_SENTENCES} sentences (got ${sentenceCount})`,
          );
        }
      }

      // S5: tags is a non-empty array of non-empty strings
      if (!Array.isArray(story.tags) || story.tags.length === 0) {
        pushStoryError(
          `S5 tags must be a non-empty array of non-empty strings (got ${JSON.stringify(story.tags)})`,
        );
      } else {
        const invalidTagIndices = [];
        for (let ti = 0; ti < story.tags.length; ti += 1) {
          if (!isNonEmptyString(story.tags[ti])) {
            invalidTagIndices.push(ti);
          }
        }
        if (invalidTagIndices.length > 0) {
          pushStoryError(
            `S5 tags contains non-string or empty tag at index(es) ${invalidTagIndices.join(', ')}`,
          );
        }
      }

      // S6..S10: blocks and word count
      let totalWords = 0;
      if (!Array.isArray(story.blocks)) {
        pushStoryError(
          `S6 blocks must be an array (got ${story.blocks === null ? 'null' : typeof story.blocks})`,
        );
      } else {
        if (story.blocks.length < MIN_BLOCKS) {
          pushStoryError(`S6 blocks length ${story.blocks.length} is below minimum ${MIN_BLOCKS}`);
        }

        const hasH2 = story.blocks.some((b) => isPlainObject(b) && b.type === 'h2');
        if (!hasH2) {
          pushStoryError('S7 blocks must include at least one block with type "h2"');
        }

        const lastBlock = story.blocks.length > 0 ? story.blocks[story.blocks.length - 1] : undefined;
        if (!isPlainObject(lastBlock) || lastBlock.type !== 'tip') {
          const lastType = isPlainObject(lastBlock) ? lastBlock.type : undefined;
          pushStoryError(`S8 last block must have type "tip" (got ${JSON.stringify(lastType)})`);
        }

        for (let bi = 0; bi < story.blocks.length; bi += 1) {
          const block = story.blocks[bi];
          if (!isPlainObject(block)) {
            pushStoryError(
              `S9 block[${bi}] must be an object (got ${block === null ? 'null' : typeof block})`,
            );
            continue;
          }
          if (!ALLOWED_BLOCK_TYPES.has(block.type)) {
            pushStoryError(
              `S9 block[${bi}] has invalid type ${JSON.stringify(block.type)} (allowed: p, h2, quote, tip)`,
            );
          }
          if (!isNonEmptyString(block.text)) {
            pushStoryError(
              `S9 block[${bi}] text must be a non-empty string (got ${JSON.stringify(block.text)})`,
            );
          }
        }

        totalWords = countWords(story.blocks);
        if (totalWords < MIN_WORDS) {
          pushStoryError(`S10 word count ${totalWords} below floor ${MIN_WORDS}`);
        } else if (totalWords > MAX_WORDS) {
          pushStoryError(`S10 word count ${totalWords} exceeds ceiling ${MAX_WORDS}`);
        }
      }

      // S11: minutes is an integer and equals Math.round(totalWords / 105)
      const expectedMinutes = Math.round(totalWords / WORDS_PER_MINUTE);
      if (typeof story.minutes !== 'number' || !Number.isInteger(story.minutes)) {
        pushStoryError(
          `S11 minutes ${JSON.stringify(story.minutes)} must be an integer (expected ${expectedMinutes})`,
        );
      } else if (Array.isArray(story.blocks) && story.minutes !== expectedMinutes) {
        pushStoryError(
          `S11 minutes ${story.minutes} does not equal Math.round(${totalWords} / ${WORDS_PER_MINUTE}) = ${expectedMinutes}`,
        );
      }

      moduleWords += totalWords;

      const storyEntry = {
        id: typeof story.id === 'string' ? story.id : '',
        week: typeof story.week === 'number' && Number.isFinite(story.week) ? story.week : null,
        day: typeof story.day === 'number' && Number.isFinite(story.day) ? story.day : null,
        words: totalWords,
        minutes:
          typeof story.minutes === 'number' && Number.isFinite(story.minutes) ? story.minutes : null,
        title: typeof story.title === 'string' ? story.title : '',
        ok: !storyHasError,
      };
      storySummaries.push(storyEntry);

      loadedStories.push({
        relFile,
        storyLabel,
        storyId:
          typeof story.id === 'string' && story.id.trim().length > 0 ? story.id.trim() : storyLabel,
        story,
        storyEntry,
        weekEntry,
      });

      // X1: duplicate id anywhere in the scanned set
      if (typeof story.id === 'string' && story.id.trim().length > 0) {
        const existing = seenIds.get(story.id);
        if (existing) {
          duplicateIds.add(story.id);
          pushStoryError(`X1 duplicate id "${story.id}" (first seen in ${existing.relFile})`);
          storyEntry.ok = false;
          weekEntry.ok = false;
          existing.storyEntry.ok = false;
          existing.weekEntry.ok = false;
        } else {
          seenIds.set(story.id, { relFile, storyEntry, weekEntry });
        }
      }
    }

    weekEntry.words = moduleWords;
    if (moduleErrors.length > 0) {
      weekEntry.ok = false;
    }
  }

  // S12 & S11: corpus-wide opening block and opening diversity checks
  const openSentenceMap = new Map();
  const openShingleMap = new Map();

  for (const item of loadedStories) {
    const { relFile, storyLabel, story, storyEntry, weekEntry } = item;
    const firstBlock =
      Array.isArray(story.blocks) && story.blocks.length > 0 ? story.blocks[0] : undefined;

    if (!isPlainObject(firstBlock) || firstBlock.type !== 'p') {
      const firstType = isPlainObject(firstBlock) ? firstBlock.type : undefined;
      errors.push(
        `${relFile}:: ${storyLabel}:: S12 first block must have type "p" (got ${JSON.stringify(firstType)})`,
      );
      storyEntry.ok = false;
      weekEntry.ok = false;
      continue;
    }

    if (typeof firstBlock.text !== 'string') {
      continue;
    }

    const sentence = extractFirstSentence(firstBlock.text);
    const normalized = normalizeOpening(sentence);
    if (!normalized) {
      continue;
    }

    let sentenceGroup = openSentenceMap.get(normalized);
    if (!sentenceGroup) {
      sentenceGroup = [];
      openSentenceMap.set(normalized, sentenceGroup);
    }
    sentenceGroup.push(item);

    const words = normalized.split(' ').filter(Boolean);
    if (words.length > 0) {
      const shingle = words.slice(0, OPENING_SHINGLE_WORDS).join(' ');
      let shingleGroup = openShingleMap.get(shingle);
      if (!shingleGroup) {
        shingleGroup = [];
        openShingleMap.set(shingle, shingleGroup);
      }
      shingleGroup.push(item);
    }
  }

  for (const group of openSentenceMap.values()) {
    if (group.length >= 2) {
      const ids = group.map((entry) => entry.storyId);
      errors.push(
        `${toDisplayPath(absDir)}:: S11 duplicate first sentence shared by ${ids.join(', ')}`,
      );
      for (const entry of group) {
        entry.storyEntry.ok = false;
        entry.weekEntry.ok = false;
      }
    }
  }

  const openingTop = Array.from(openShingleMap.entries())
    .map(([shingle, group]) => ({
      shingle,
      count: group.length,
      ids: group.map((entry) => entry.storyId),
      entries: group,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.shingle.localeCompare(b.shingle, 'vi') ||
        (a.shingle < b.shingle ? -1 : a.shingle > b.shingle ? 1 : 0),
    );

  for (const group of openingTop) {
    if (group.count > parsed.openingMax) {
      errors.push(
        `${toDisplayPath(absDir)}:: S11 opening shingle "${group.shingle}" used by ${group.count} stories (max ${parsed.openingMax}): ${group.ids.join(', ')}`,
      );
      for (const entry of group.entries) {
        entry.storyEntry.ok = false;
        entry.weekEntry.ok = false;
      }
    }
  }

  const openings = {
    maxShare: openingTop.length > 0 ? openingTop[0].count : 0,
    shingle: openingTop.length > 0 ? openingTop[0].shingle : '',
    top: openingTop.map(({ shingle, count, ids }) => ({ shingle, count, ids })),
  };

  // X2: ids must be unique overall
  const uniqueIds = duplicateIds.size === 0;
  if (!uniqueIds) {
    errors.push(
      `${toDisplayPath(absDir)}:: X2 story ids must be unique overall (duplicates: ${Array.from(duplicateIds).join(', ')})`,
    );
  }

  const ok = !hasLoadError && errors.length === 0;
  const result = {
    ok,
    dir: absDir,
    total: storySummaries.length,
    uniqueIds,
    openings,
    weeks: weekSummaries,
    stories: storySummaries,
    errors,
  };

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const w of weekSummaries) {
      console.log(`week ${w.week}: ${w.ok ? 'ok' : 'FAIL'} (${w.stories} stories, ${w.words} words)`);
    }
    for (const errLine of errors) {
      console.log(errLine);
    }
    console.log(`TOTAL: ${storySummaries.length} stories, ${errors.length} errors`);
  }

  if (hasLoadError) {
    process.exitCode = 2;
  } else if (errors.length > 0) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Fatal error: ${msg}`);
  process.exitCode = 2;
});
