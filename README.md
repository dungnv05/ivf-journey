# IVF Journey — Thai Giáo Prenatal Story Reader

A calm, daily bedtime prenatal story reader designed for expecting parents to bond with their baby through soothing bedtime stories aligned with weekly fetal developmental milestones.

The feature is accessible at route `/thai-giao`.

## Corpus Overview

The story corpus contains **175 finished stories** covering gestational **weeks 16–40 inclusive**, with exactly **seven stories per week** (days 1–7, corresponding to Monday through Sunday).

Content modules reside in `src/data/thaiGiao/` as individual weekly files (`week16.js` through `week40.js`).

## Reader Features & Local State

- **Due-Date Estimation**: Computes the current pregnancy week and day based on the mother's Estimated Due Date (EDD).
- **Navigation & Deep Linking**: Browse previous/next stories, pick stories from the library, or link directly using URL query parameters (`/thai-giao?tuan=<week>&ngay=<day>`).
- **Reading Modes**: Toggle between light and dark backgrounds, as well as standard and large typography.
- **Speech Synthesis Narration**: Segmented audio reading via browser `SpeechSynthesis` with automatic fallback watchdog timer to prevent UI lockups if speech synthesis stalls.
- **Reading Tracker**: Mark individual stories as read to track completion.
- **Medical Disclaimer**: All story text and developmental notes are educational, designed for relaxation and family connection, and do not constitute medical advice or clinical guidance.

### LocalStorage Persistence

The reader persists user settings across browser sessions using three localStorage keys:

| Key | Value Type | Description |
|---|---|---|
| `ivf_thaigiao_due_date` | String (`YYYY-MM-DD`) | Expected Due Date (EDD) ISO date string used to calculate current gestational week and day. |
| `ivf_thaigiao_read_stories` | JSON array of strings | List of story IDs marked as read (e.g., `["w16-d1", "w16-d2"]`). |
| `ivf_thaigiao_reading_prefs` | JSON object | Reading preference flags: `{ darkMode: boolean, largeText: boolean }`. |

## Story Schema

Each story object must define the following schema fields:

- `id` *(string)*: Unique identifier strictly formatted as `w<week>-d<day>` (e.g., `w16-d1`).
- `week` *(number)*: Integer matching the parent week module (16–40 describes the current corpus).
- `day` *(number)*: Integer day of the week (1–7).
- `title` *(string)*: Story title (non-empty string, maximum 90 characters after trimming).
- `excerpt` *(string)*: Short overview containing 1–2 sentences and fewer than 220 characters after trimming.
- `minutes` *(number)*: Integer estimated reading duration, computed as `Math.round(words / 105)`.
- `tags` *(array of strings)*: Non-empty array of non-empty thematic strings.
- `blocks` *(array of objects)*: Array of at least 8 block objects comprising the story narrative.

### Block Types

Each block in `blocks` must be an object with `{ type, text }`:

- `p`: Paragraph prose text for the story narrative.
- `h2`: Section heading dividing thematic scenes within the story.
- `quote`: Highlighted lyrical reflection, soothing thought, or poetic excerpt.
- `tip`: Concluding gentle parenting tip, breathing exercise, or baby-connection practice (must be the final block).

## Word Count & Reading Duration

The validator calculates word count by joining all `blocks[].text` and splitting on whitespace (`\s+`):

- **Word count**: Every story must contain between **1050 and 1500 words** inclusive.
- **Reading duration**: `minutes` must equal `Math.round(words / 105)` based on the content pace of 105 words per minute.

## Corpus Validation

Validate the entire story corpus using the validation script:

```bash
node scripts/validate-stories.mjs --json
```

Or via npm:

```bash
npm run validate -- --json
```

### CLI Arguments

- `[dir]`: Optional path to story data directory (defaults to `src/data/thaiGiao`).
- `--weeks N|A-B`: Validate a single week (e.g., `--weeks 20`) or a range of weeks (e.g., `--weeks 16-24`).
- `--opening-max N`: Maximum allowable count of stories sharing the same opening 6-word shingle (default: `14`).
- `--json`: Outputs structured JSON report with summaries, errors, and opening metrics.

### Validation Rules

The validator (`scripts/validate-stories.mjs`) enforces the following integrity checks:

1. **Module Export & Object (M1)**: The module must export a plain object under either `week<N>` (e.g., `week16`) or `default`.
2. **Filename, Week & Metadata (M1)**: Filename must match `week<N>.js`. The `week` property must be an integer matching `<N>`. `theme` and `developmentalNote` must both be non-empty strings.
3. **Story Count (M2)**: Each week module must contain an array of exactly 7 stories.
4. **Day Consistency (M3)**: Days 1 through 7 must each appear exactly once per week without omissions or duplicates.
5. **Story ID Consistency (S1, S2)**: Story `id` must match `^w(\d+)-d(\d+)$` and equal `w${week}-d${day}`. Story `week` and `day` must match the parent module week and day values.
6. **Title Constraints (S3)**: Non-empty string with at most 90 characters.
7. **Excerpt Constraints (S4)**: Non-empty string containing 1–2 sentences and strictly fewer than 220 characters.
8. **Tags Constraints (S5)**: Non-empty array of non-empty strings.
9. **Block Count & Structure (S6, S7, S8, S12)**:
   - At least 8 blocks in total (S6).
   - First block must have type `p` (S12).
   - At least one block must have type `h2` (S7).
   - Final block must have type `tip` (S8).
10. **Allowed Block Types & Non-Empty Text (S9)**: Block types are restricted to `p`, `h2`, `quote`, `tip`, each containing non-empty `text`.
11. **Word Count Limits (S10)**: Total story words must be between 1050 and 1500.
12. **Minutes Formula (S11 minutes)**: `minutes` must be an integer equal to `Math.round(words / 105)`.
13. **Unique Story IDs (X1, X2)**: Story IDs must be globally unique across the scanned corpus.
14. **Opening Diversity (S11 opening diversity)**:
    - *Distinct from S11 minutes*, opening diversity ensures narrative variety across the corpus.
    - The normalized first sentence (lowercase Vietnamese, punctuation removed, whitespace collapsed) must be unique across all stories.
    - The normalized first-six-word opening shingle cannot be shared by more than `--opening-max` stories (default: 14).

## Adding a New Week Module

To add a new week module (for example, `src/data/thaiGiao/week41.js`):

1. Create `src/data/thaiGiao/weekNN.js`.
2. Export a week object conforming to the schema:
   ```javascript
   export const weekNN = {
     week: NN,
     theme: 'Weekly Theme Title',
     developmentalNote: 'Description of fetal development for this week...',
     stories: [
       // exactly 7 stories for days 1 to 7
     ],
   };
   ```
3. Follow all story schema and validator rules above.
4. Run full-corpus validation:
   ```bash
   node scripts/validate-stories.mjs --json
   ```
5. **Automatic Module Discovery**: `src/data/thaiGiao/index.js` automatically imports all `week*.js` files using Vite's `import.meta.glob('./week*.js', { eager: true })`. No manual imports or edits to `index.js` are required.

## Project Commands

- `npm run dev` — Start the local Vite development server
- `npm run build` — Build the application for production
- `npm run lint` — Run Oxlint code analysis
- `npm run validate` — Validate prenatal story modules (`node scripts/validate-stories.mjs`)
