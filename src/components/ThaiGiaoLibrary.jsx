import React from 'react';
import { ArrowRight, BookOpen, Check } from 'lucide-react';

function ThaiGiaoLibrary({
  weeks,
  activeLibraryWeek,
  onSelectLibraryWeek,
  selectedStoryId,
  readStoryIds,
  onSelectStory,
  onToggleRead,
  dayLabels,
  totalStoryCount,
  libraryRef,
}) {
  const tablistId = 'tg-week-tablist';
  const tabIdFor = (weekNum) => `tg-week-tab-${weekNum}`;
  const panelIdFor = (weekNum) => `tg-week-panel-${weekNum}`;

  const focusTab = (weekNum) => {
    const el = document.getElementById(tabIdFor(weekNum));
    if (!el) return;
    el.focus();
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  };

  const handleTablistKeyDown = (event) => {
    if (!weeks.length || event.metaKey || event.ctrlKey || event.altKey) return;
    const selectedIndex = Math.max(
      0,
      weeks.findIndex((w) => w.week === activeLibraryWeek),
    );
    let target = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = weeks[(selectedIndex + 1) % weeks.length];
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = weeks[(selectedIndex - 1 + weeks.length) % weeks.length];
        break;
      case 'Home':
        target = weeks[0];
        break;
      case 'End':
        target = weeks[weeks.length - 1];
        break;
      default:
        return;
    }
    if (!target) return;
    event.preventDefault();
    onSelectLibraryWeek(target.week);
    focusTab(target.week);
  };

  const totalReadCount = readStoryIds.size;
  const activeWeekObj =
    weeks.find((item) => item.week === activeLibraryWeek) || weeks[0] || null;
  const sortedStories = activeWeekObj
    ? [...activeWeekObj.stories].sort((a, b) => a.day - b.day)
    : [];

  return (
    <section
      id="tg-library"
      ref={libraryRef}
      className="tg-library-section"
      aria-labelledby="tg-library-heading"
    >
      <div className="tg-library-header">
        <div>
          <p className="tg-section-eyebrow">Thư viện theo tuần thai</p>
          <h2 id="tg-library-heading" className="tg-library-heading">
            Mục lục truyện thai giáo
          </h2>
        </div>

        <div className="tg-library-progress" aria-live="polite">
          <Check size={16} aria-hidden="true" />
          <span>
            Đã đọc {totalReadCount} / {totalStoryCount} truyện
          </span>
        </div>
      </div>

      {weeks.length === 0 ? (
        <div className="tg-empty-inline">
          <p className="tg-empty-text">
            Hiện chưa có tuần thai nào trong thư viện.
          </p>
        </div>
      ) : (
        <>
          <div
            id={tablistId}
            className="tg-week-tabs"
            role="tablist"
            aria-label="Chọn tuần thai trong thư viện"
            onKeyDown={handleTablistKeyDown}
          >
            {weeks.map((weekItem) => {
              const isSelectedTab = activeWeekObj?.week === weekItem.week;
              const weekReadCount = weekItem.stories.filter((s) =>
                readStoryIds.has(s.id),
              ).length;

              return (
                <button
                  key={weekItem.week}
                  id={tabIdFor(weekItem.week)}
                  type="button"
                  role="tab"
                  tabIndex={isSelectedTab ? 0 : -1}
                  aria-selected={isSelectedTab}
                  aria-controls={panelIdFor(weekItem.week)}
                  className={`tg-week-tab-btn ${isSelectedTab ? 'tg-week-tab-btn-active' : ''}`}
                  onClick={() => onSelectLibraryWeek(weekItem.week)}
                >
                  <span className="tg-week-tab-title">Tuần {weekItem.week}</span>
                  <span className="tg-week-tab-meta">
                    {weekReadCount}/{weekItem.stories.length} đã đọc
                  </span>
                </button>
              );
            })}
          </div>

          {activeWeekObj ? (
            <div
              id={panelIdFor(activeWeekObj.week)}
              className="tg-library-week-panel"
              role="tabpanel"
              aria-labelledby={tabIdFor(activeWeekObj.week)}
            >
              <div className="tg-library-week-banner">
                <span className="tg-library-week-pill">
                  Tuần {activeWeekObj.week}
                </span>
                <p className="tg-library-week-theme">{activeWeekObj.theme}</p>
              </div>

              <ul className="tg-library-grid">
                {sortedStories.map((story) => {
                  const isActive = story.id === selectedStoryId;
                  const isRead = readStoryIds.has(story.id);
                  const weekdayName = dayLabels[story.day] || '';

                  return (
                    <li
                      key={story.id}
                      className={`tg-library-card ${isActive ? 'tg-library-card-active' : ''} ${isRead ? 'tg-library-card-read' : ''}`}
                    >
                      <button
                        type="button"
                        className="tg-library-card-main"
                        aria-current={isActive ? 'true' : undefined}
                        onClick={() => onSelectStory(story.week, story.day)}
                      >
                        <div className="tg-library-card-top">
                          <span className="tg-library-day-badge">
                            Ngày {story.day}
                            {weekdayName ? ` · ${weekdayName}` : ''}
                          </span>
                          <span className="tg-library-minutes">
                            <BookOpen size={14} aria-hidden="true" />
                            <span>~{story.minutes} phút đọc</span>
                          </span>
                        </div>

                        <h3 className="tg-library-card-title">{story.title}</h3>
                        <p className="tg-library-card-excerpt">{story.excerpt}</p>

                        <span className="tg-library-card-cta">
                          <span>{isActive ? 'Đang mở truyện này' : 'Đọc truyện'}</span>
                          <ArrowRight size={15} aria-hidden="true" />
                        </span>
                      </button>

                      <div className="tg-library-card-footer">
                        <span
                          className={`tg-library-status ${isRead ? 'tg-library-status-read' : 'tg-library-status-unread'}`}
                        >
                          {isRead ? (
                            <>
                              <Check size={14} aria-hidden="true" />
                              <span>Đã đọc</span>
                            </>
                          ) : (
                            <span>Chưa đọc</span>
                          )}
                        </span>

                        <button
                          type="button"
                          className="tg-library-mark-btn"
                          aria-pressed={isRead}
                          onClick={() => onToggleRead(story.id)}
                        >
                          {isRead ? 'Bỏ đánh dấu' : 'Đánh dấu đã đọc'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export default ThaiGiaoLibrary;
