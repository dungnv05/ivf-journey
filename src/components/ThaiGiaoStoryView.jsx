import React from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Moon,
  Square,
  Sun,
  Type,
  Volume2,
} from 'lucide-react';

const TIP_PREFIX_RE = /^Lời dặn cho bố mẹ\s*:\s*/i;

function renderStoryBlock(block, index, storyId) {
  if (!block || typeof block.text !== 'string') {
    return null;
  }

  const key = `${storyId}-block-${index}`;

  if (block.type === 'h2') {
    return (
      <h3 key={key} className="tg-block-h2">
        {block.text}
      </h3>
    );
  }

  if (block.type === 'quote') {
    return (
      <blockquote key={key} className="tg-block-quote">
        <p>{block.text}</p>
      </blockquote>
    );
  }

  if (block.type === 'tip') {
    const cleaned = block.text.replace(TIP_PREFIX_RE, '').trim() || block.text;
    return (
      <aside key={key} className="tg-block-tip" aria-label="Lời dặn cho bố mẹ">
        <p className="tg-block-tip-label">Lời dặn cho bố mẹ</p>
        <p className="tg-block-tip-body">{cleaned}</p>
      </aside>
    );
  }

  return (
    <p key={key} className="tg-block-p">
      {block.text}
    </p>
  );
}

function ThaiGiaoStoryView({
  story,
  dayLabel,
  isRead,
  onToggleRead,
  isDarkMode,
  onToggleDarkMode,
  isLargeText,
  onToggleLargeText,
  speechSupported,
  isSpeaking,
  onToggleSpeech,
  prevStory,
  nextStory,
  onSelectStory,
  onScrollToLibrary,
  requestedWeek,
  requestedDay,
  articleRef,
}) {
  if (!story) {
    return (
      <section
        ref={articleRef}
        className="tg-story-card tg-empty-state"
        aria-live="polite"
      >
        <div className="tg-empty-icon" aria-hidden="true">
          <BookOpen size={28} />
        </div>
        <h2 className="tg-empty-title">
          Chưa có câu chuyện cho Tuần {requestedWeek} · Ngày {requestedDay}
        </h2>
        <p className="tg-empty-text">
          Câu chuyện bạn đang mở hiện chưa có trong thư viện thai giáo. Bố mẹ có
          thể quay lại thư viện bên dưới để chọn một câu chuyện dịu nhẹ khác cho
          hôm nay.
        </p>
        <a
          href="#tg-library"
          className="tg-primary-btn"
          onClick={(event) => {
            event.preventDefault();
            onScrollToLibrary();
          }}
        >
          <span>Quay lại thư viện truyện</span>
          <ArrowRight size={18} aria-hidden="true" />
        </a>
      </section>
    );
  }

  const blocks = Array.isArray(story.blocks) ? story.blocks : [];
  const tags = Array.isArray(story.tags) ? story.tags : [];

  return (
    <article
      ref={articleRef}
      className="tg-story-card"
      aria-labelledby="tg-story-heading"
    >
      <div className="tg-story-toolbar" role="toolbar" aria-label="Tùy chỉnh đọc truyện">
        <div className="tg-toolbar-group">
          <button
            type="button"
            className={`tg-control-btn ${isDarkMode ? 'tg-control-btn-active' : ''}`}
            aria-pressed={isDarkMode}
            onClick={onToggleDarkMode}
          >
            {isDarkMode ? (
              <Sun size={18} aria-hidden="true" />
            ) : (
              <Moon size={18} aria-hidden="true" />
            )}
            <span>{isDarkMode ? 'Chế độ sáng' : 'Chế độ tối'}</span>
          </button>

          <button
            type="button"
            className={`tg-control-btn ${isLargeText ? 'tg-control-btn-active' : ''}`}
            aria-pressed={isLargeText}
            onClick={onToggleLargeText}
          >
            <Type size={18} aria-hidden="true" />
            <span>{isLargeText ? 'Chữ vừa' : 'Chữ lớn'}</span>
          </button>

          {speechSupported ? (
            <button
              type="button"
              className={`tg-control-btn ${isSpeaking ? 'tg-control-btn-speaking' : ''}`}
              aria-pressed={isSpeaking}
              onClick={onToggleSpeech}
            >
              {isSpeaking ? (
                <>
                  <Square size={16} aria-hidden="true" />
                  <span>Dừng đọc</span>
                </>
              ) : (
                <>
                  <Volume2 size={18} aria-hidden="true" />
                  <span>Nghe đọc</span>
                </>
              )}
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className={`tg-read-toggle-btn ${isRead ? 'tg-read-toggle-btn-done' : ''}`}
          aria-pressed={isRead}
          onClick={() => onToggleRead(story.id)}
        >
          <Check size={18} aria-hidden="true" />
          <span>{isRead ? 'Đã đọc xong' : 'Đánh dấu đã đọc'}</span>
        </button>
      </div>

      <header className="tg-story-header">
        <div className="tg-story-meta">
          <span className="tg-story-badge">
            Tuần {story.week} · Ngày {story.day}
            {dayLabel ? ` (${dayLabel})` : ''}
          </span>
          <span className="tg-story-time">
            <BookOpen size={15} aria-hidden="true" />
            <span>~{story.minutes} phút đọc</span>
          </span>
          {isRead ? (
            <span className="tg-story-read-pill">
              <Check size={14} aria-hidden="true" />
              <span>Đã đọc</span>
            </span>
          ) : null}
          {isSpeaking ? (
            <span className="tg-story-playing-pill" role="status" aria-live="polite">
              <Volume2 size={14} aria-hidden="true" />
              <span>Đang đọc truyện...</span>
            </span>
          ) : null}
        </div>

        <h2 id="tg-story-heading" className="tg-story-title">
          {story.title}
        </h2>

        {story.excerpt ? (
          <p className="tg-story-excerpt">{story.excerpt}</p>
        ) : null}

        {tags.length > 0 ? (
          <ul className="tg-tag-list" aria-label="Chủ đề câu chuyện">
            {tags.map((tag) => (
              <li key={tag} className="tg-tag-pill">
                #{tag}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="tg-story-body">
        {blocks.map((block, index) => renderStoryBlock(block, index, story.id))}
      </div>

      <div className="tg-story-complete-row">
        <button
          type="button"
          className={`tg-read-toggle-btn ${isRead ? 'tg-read-toggle-btn-done' : ''}`}
          aria-pressed={isRead}
          onClick={() => onToggleRead(story.id)}
        >
          <Check size={18} aria-hidden="true" />
          <span>{isRead ? 'Đã đánh dấu đã đọc' : 'Đánh dấu đã đọc truyện này'}</span>
        </button>
      </div>

      <nav className="tg-story-nav" aria-label="Điều hướng truyện trước và truyện tiếp theo">
        <button
          type="button"
          className="tg-nav-btn tg-nav-btn-prev"
          disabled={!prevStory}
          onClick={() => {
            if (prevStory) {
              onSelectStory(prevStory.week, prevStory.day);
            }
          }}
        >
          <ChevronLeft size={20} aria-hidden="true" />
          <span className="tg-nav-btn-copy">
            <span className="tg-nav-btn-label">Truyện trước</span>
            <span className="tg-nav-btn-title">
              {prevStory
                ? `Tuần ${prevStory.week} · Ngày ${prevStory.day}: ${prevStory.title}`
                : 'Đây là truyện đầu tiên'}
            </span>
          </span>
        </button>

        <button
          type="button"
          className="tg-nav-btn tg-nav-btn-next"
          disabled={!nextStory}
          onClick={() => {
            if (nextStory) {
              onSelectStory(nextStory.week, nextStory.day);
            }
          }}
        >
          <span className="tg-nav-btn-copy tg-nav-btn-copy-right">
            <span className="tg-nav-btn-label">Truyện tiếp theo</span>
            <span className="tg-nav-btn-title">
              {nextStory
                ? `Tuần ${nextStory.week} · Ngày ${nextStory.day}: ${nextStory.title}`
                : 'Đây là truyện mới nhất'}
            </span>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </nav>
    </article>
  );
}

export default ThaiGiaoStoryView;
