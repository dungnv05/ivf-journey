import { week16 as baseWeek16 } from '../../../src/data/thaiGiao/week16.js';

const SHARED_FIRST_SENTENCE =
  'Con yêu à, đêm nay ánh đèn vàng ngoài hiên thật dịu nhẹ, gió khẽ lùa qua rèm cửa như khúc hát ru bình yên dành riêng cho con.';

const SHARED_STORY_IDS = new Set(['w16-d1', 'w16-d2']);

function replaceFirstSentence(text, newSentence) {
  const match = /[.!?…]/u.exec(text);
  if (!match) {
    return newSentence;
  }
  const rest = text.slice(match.index + 1).trimStart();
  return rest ? `${newSentence} ${rest}` : newSentence;
}

function countWords(blocks) {
  return blocks
    .map((block) => block.text)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

function cloneStory(story) {
  const shouldReplace = SHARED_STORY_IDS.has(story.id);
  const blocks = story.blocks.map((block, index) => {
    if (index === 0 && shouldReplace) {
      return { ...block, text: replaceFirstSentence(block.text, SHARED_FIRST_SENTENCE) };
    }
    return { ...block };
  });
  const words = countWords(blocks);
  return {
    ...story,
    tags: [...story.tags],
    blocks,
    minutes: Math.round(words / 105),
  };
}

export const week16 = {
  ...baseWeek16,
  stories: baseWeek16.stories.map(cloneStory),
};
