const weekModules = import.meta.glob('./week*.js', { eager: true });

function extractWeekModule(mod) {
  if (!mod || typeof mod !== 'object') {
    return null;
  }
  const namedKey = Object.keys(mod).find((key) => /^week\d+$/.test(key));
  const candidate = namedKey ? mod[namedKey] : mod.default;
  if (
    candidate &&
    typeof candidate === 'object' &&
    typeof candidate.week === 'number' &&
    Array.isArray(candidate.stories)
  ) {
    return candidate;
  }
  return null;
}

export const thaiGiaoWeeks = Object.values(weekModules)
  .map(extractWeekModule)
  .filter(Boolean)
  .sort((a, b) => a.week - b.week);

export const allStories = thaiGiaoWeeks.flatMap((weekObj) =>
  [...weekObj.stories].sort((a, b) => a.day - b.day),
);

export function getStory(week, day) {
  const targetWeek = Number(week);
  const targetDay = Number(day);
  if (!Number.isInteger(targetWeek) || !Number.isInteger(targetDay)) {
    return null;
  }
  const weekObj = thaiGiaoWeeks.find((item) => item.week === targetWeek);
  if (!weekObj) {
    return null;
  }
  return weekObj.stories.find((story) => story.day === targetDay) ?? null;
}
