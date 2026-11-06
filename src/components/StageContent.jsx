import React, { forwardRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import InfoCard from './InfoCard';
import { BookOpen, CheckCircle, XOctagon, AlertTriangle, ArrowRight } from 'lucide-react';

const LENSES = [
  {
    key: 'knowledge',
    label: 'Kiến thức y khoa',
    Icon: BookOpen
  },
  {
    key: 'dos',
    label: 'Nên thực hành',
    Icon: CheckCircle
  },
  {
    key: 'donts',
    label: 'Cần tránh',
    Icon: XOctagon
  }
];

const StageContent = forwardRef(({ stage, onCardClick }, ref) => {
  const prefersReducedMotion = useReducedMotion();
  const [activeLens, setActiveLens] = useState('knowledge');

  if (!stage) return null;

  const lensItems = {
    knowledge: stage.knowledge || [],
    dos: stage.dos || [],
    donts: stage.donts || []
  };

  const currentItems = lensItems[activeLens] || [];
  const currentLensIndex = LENSES.findIndex((lens) => lens.key === activeLens);
  const nextLens = LENSES[(currentLensIndex + 1) % LENSES.length];

  return (
    <motion.article
      ref={ref}
      id={stage.id}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
      whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.4 }}
      className="stage-chapter"
      aria-labelledby={`${stage.id}-title`}
    >
      {/* Editorial Narrative Intro (01-layout.md, 02-typography.md) */}
      <header className="stage-editorial-intro">
        <div className="stage-meta-row">
          {stage.chapter && (
            <span className="stage-chapter-pill">{stage.chapter}</span>
          )}
          {stage.timeframe && (
            <span className="stage-timeframe-pill">{stage.timeframe}</span>
          )}
        </div>

        <h2 id={`${stage.id}-title`} className="stage-title">
          {stage.title}
        </h2>

        <p className="stage-description">{stage.description}</p>

        {stage.narrativeLead && (
          <p className="stage-narrative-lead">{stage.narrativeLead}</p>
        )}

        {stage.pullQuote && (
          <blockquote className="stage-pull-quote">
            “{stage.pullQuote}”
          </blockquote>
        )}
      </header>

      {/* Single Focal Beat Panel per Stage (04-density.md, AC3) */}
      <div className="stage-focal-panel">
        {stage.focalBeat && (
          <div className="focal-beat-box" aria-label={`Điểm nhấn sinh học ${stage.title}`}>
            <div className="focal-beat-header">
              <span className="focal-beat-caption">{stage.focalBeat.caption}</span>
              {stage.focalBeat.keyWindow && (
                <span className="focal-beat-window">{stage.focalBeat.keyWindow}</span>
              )}
            </div>

            {stage.focalBeat.biologicalFocus && (
              <p className="focal-beat-summary">{stage.focalBeat.biologicalFocus}</p>
            )}

            {stage.focalBeat.steps && stage.focalBeat.steps.length > 0 && (
              <ol className="focal-steps-grid" aria-label="Các bước tiến triển trong giai đoạn">
                {stage.focalBeat.steps.map((stepObj) => (
                  <li key={stepObj.step} className="focal-step-card">
                    <span className="focal-step-num">Bước {stepObj.step}</span>
                    <span className="focal-step-label">{stepObj.label}</span>
                    <span className="focal-step-meta">{stepObj.meta}</span>
                  </li>
                ))}
              </ol>
            )}

            {stage.focalBeat.safetyNotice && (
              <div className="focal-safety-notice" role="note">
                <AlertTriangle size={20} aria-hidden="true" />
                <div>
                  <span className="notice-badge">Lưu ý y khoa:</span>
                  <span>{stage.focalBeat.safetyNotice}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Progressive Lens Explorer — One Category Focus at a Time */}
        <div className="lens-explorer">
          <div className="lens-header-row">
            <p className="lens-prompt">
              Chọn góc nhìn trọng tâm để xem chi tiết từng nhóm khuyến cáo:
            </p>

            <div
              className="lens-tablist"
              role="tablist"
              aria-label={`Nhóm khuyến cáo cho giai đoạn ${stage.title}`}
            >
              {LENSES.map((lens) => {
                const Icon = lens.Icon;
                const count = (lensItems[lens.key] || []).length;
                const isSelected = activeLens === lens.key;

                return (
                  <button
                    key={lens.key}
                    type="button"
                    role="tab"
                    id={`${stage.id}-tab-${lens.key}`}
                    aria-selected={isSelected}
                    aria-controls={`${stage.id}-panel-${lens.key}`}
                    className={`lens-tab-btn ${lens.key} ${isSelected ? 'active' : ''}`}
                    onClick={() => setActiveLens(lens.key)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{lens.label}</span>
                    <span className="lens-count-pill">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            role="tabpanel"
            id={`${stage.id}-panel-${activeLens}`}
            aria-labelledby={`${stage.id}-tab-${activeLens}`}
          >
            {currentItems.length > 0 ? (
              <div className="cards-grid">
                {currentItems.map((item, idx) => {
                  const fallbackTitle = activeLens === 'dos'
                    ? `Lời khuyên ${idx + 1}`
                    : activeLens === 'donts'
                      ? `Lưu ý ${idx + 1}`
                      : `Kiến thức ${idx + 1}`;
                  const resolvedTitle = item.title || fallbackTitle;
                  const resolvedContent = item.content || item;

                  return (
                    <InfoCard
                      key={`${stage.id}-${activeLens}-${idx}`}
                      type={activeLens}
                      title={resolvedTitle}
                      content={resolvedContent}
                      onClick={() =>
                        onCardClick({
                          ...item,
                          type: activeLens,
                          title: resolvedTitle,
                          stageTitle: stage.title,
                          stageChapter: stage.chapter
                        })
                      }
                    />
                  );
                })}
              </div>
            ) : (
              <div className="empty-state-box">
                <p className="empty-state-text">
                  Chưa có mục nào trong góc nhìn này. Bạn có thể chuyển sang góc nhìn tiếp theo để tiếp tục tìm hiểu.
                </p>
                <button
                  type="button"
                  className="lens-next-btn"
                  onClick={() => setActiveLens('knowledge')}
                >
                  Quay về Kiến thức y khoa
                </button>
              </div>
            )}
          </div>

          <div className="lens-footer-bar">
            <span className="lens-prompt">
              Đang hiển thị: <strong>{LENSES[currentLensIndex].label}</strong> ({currentItems.length} mục)
            </span>
            <button
              type="button"
              className="lens-next-btn"
              onClick={() => setActiveLens(nextLens.key)}
            >
              <span>Xem góc nhìn tiếp: {nextLens.label}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </motion.article>
  );
});

export default StageContent;
