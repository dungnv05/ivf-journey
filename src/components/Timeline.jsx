import React from 'react';
import {
  Dna,
  Baby,
  CalendarClock,
  HeartPulse,
  Activity,
  Stethoscope,
  Footprints,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

const iconMap = {
  Dna,
  Baby,
  CalendarClock,
  HeartPulse,
  Activity,
  Stethoscope,
  Footprints
};

const Timeline = ({ stages = [], activeStageIndex = 0, onStageSelect }) => {
  if (!stages.length) return null;

  const safeIndex = Math.min(Math.max(activeStageIndex, 0), stages.length - 1);
  const activeStage = stages[safeIndex];
  const progressPercent = stages.length > 1
    ? Math.round(((safeIndex + 1) / stages.length) * 100)
    : 100;

  return (
    <nav className="timeline-nav" aria-label="Bản đồ 7 chương hành trình IVF">
      <div className="timeline-top-bar">
        <div className="timeline-status">
          <span className="timeline-chapter-badge">
            Chặng {safeIndex + 1} / {stages.length}
          </span>
          <span className="timeline-active-title">
            {activeStage.title}
          </span>
          {activeStage.timeframe && (
            <span className="byline-pill">{activeStage.timeframe}</span>
          )}
        </div>

        <div className="timeline-step-controls" role="group" aria-label="Điều hướng nhanh từng chương">
          <button
            type="button"
            className="timeline-step-btn"
            disabled={safeIndex === 0}
            onClick={() => onStageSelect(safeIndex - 1)}
            aria-label="Chuyển về chương trước"
          >
            <ChevronLeft size={18} aria-hidden="true" />
            <span>Chương trước</span>
          </button>
          <button
            type="button"
            className="timeline-step-btn"
            disabled={safeIndex === stages.length - 1}
            onClick={() => onStageSelect(safeIndex + 1)}
            aria-label="Chuyển sang chương tiếp theo"
          >
            <span>Chương tiếp</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        className="timeline-meter"
        role="progressbar"
        aria-label="Tiến độ đọc qua các chương"
        aria-valuemin={1}
        aria-valuemax={stages.length}
        aria-valuenow={safeIndex + 1}
      >
        <div
          className="timeline-meter-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <ol className="timeline-stage-list">
        {stages.map((stage, index) => {
          const Icon = iconMap[stage.iconName] || Activity;
          const isActive = index === safeIndex;
          const isCompleted = index < safeIndex;
          const stageNum = String(index + 1).padStart(2, '0');

          return (
            <li key={stage.id} className="timeline-stage-item">
              <button
                type="button"
                className={`timeline-stage-btn ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                onClick={() => onStageSelect(index)}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className="timeline-stage-num">{stageNum}</span>
                <Icon size={18} aria-hidden="true" />
                <span>{stage.shortLabel || stage.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default Timeline;
