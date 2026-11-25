import { week16 as baseWeek16 } from '../../../src/data/thaiGiao/week16.js';

const SHINGLE_OPENINGS_BY_ID = new Map([
  [
    'w16-d1',
    'Đêm nay ngoài hiên gió thổi nhẹ qua hàng cau, mang theo hương hoa bưởi thoang thoảng vào căn phòng nhỏ ấm áp của hai mẹ con mình.',
  ],
  [
    'w16-d2',
    'Đêm nay, ngoài hiên gió thổi mát rượi sau cơn mưa đầu mùa, để lại mùi đất ẩm dịu lành khiến mẹ thấy lòng nhẹ tênh.',
  ],
  [
    'w16-d3',
    'Đêm nay ngoài hiên gió thổi êm đềm qua tán lá xanh, như đang cùng bố mẹ cất lên điệu ru chậm rãi chúc con ngủ ngon.',
  ],
  [
    'w16-d4',
    'Đêm nay ngoài hiên gió thổi vi vu dưới vầng trăng non, nhắc mẹ ngồi tựa gối mềm đặt tay lên bụng trò chuyện cùng bé yêu.',
  ],
]);

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
  const replacement = SHINGLE_OPENINGS_BY_ID.get(story.id);
  const blocks = story.blocks.map((block, index) => {
    if (index === 0 && replacement) {
      return { ...block, text: replaceFirstSentence(block.text, replacement) };
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
