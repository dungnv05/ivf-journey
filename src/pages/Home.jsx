import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import {
  BookOpen,
  Layers,
  Sparkles,
  Utensils,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import Timeline from '../components/Timeline';
import StageContent from '../components/StageContent';
import Modal from '../components/Modal';
import { ivfStages, journeyMeta } from '../data/ivfData';

function Home() {
  const prefersReducedMotion = useReducedMotion();
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [viewMode, setViewMode] = useState('scrolly'); // 'scrolly' | 'stepped'
  const [selectedCard, setSelectedCard] = useState(null);
  const sectionRefs = useRef([]);
  const mainRef = useRef(null);

  const handleStageSelect = (index) => {
    if (!ivfStages.length) return;
    const boundedIndex = Math.min(Math.max(index, 0), ivfStages.length - 1);
    setActiveStageIndex(boundedIndex);

    const scrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';

    if (viewMode === 'scrolly') {
      sectionRefs.current[boundedIndex]?.scrollIntoView({
        behavior: scrollBehavior,
        block: 'start'
      });
    } else {
      mainRef.current?.scrollIntoView({
        behavior: scrollBehavior,
        block: 'start'
      });
    }
  };

  useEffect(() => {
    if (viewMode !== 'scrolly') return undefined;

    const observerOptions = {
      root: null,
      rootMargin: '-30% 0px -55% 0px',
      threshold: 0
    };

    const observerCallback = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const index = sectionRefs.current.findIndex(
            (ref) => ref === entry.target
          );
          if (index !== -1) {
            setActiveStageIndex(index);
          }
        }
      });
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);

    sectionRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => {
      observer.disconnect();
    };
  }, [viewMode]);

  const activeStage = ivfStages[activeStageIndex] || ivfStages[0];

  return (
    <div className="app-container">
      {/* Editorial Story Header (01-layout.md, 02-typography.md) */}
      <header className="editorial-hero">
        <div className="editorial-eyebrow">
          <Sparkles size={16} aria-hidden="true" />
          <span>{journeyMeta.eyebrow}</span>
        </div>

        <h1 className="title">{journeyMeta.title}</h1>

        <div className="editorial-byline">
          <span className="byline-pill">{journeyMeta.readingTime}</span>
          <span className="byline-pill">{ivfStages.length} chương hành trình</span>
          <span>{journeyMeta.editionNote}</span>
        </div>

        <p className="subtitle">{journeyMeta.dek}</p>

        <div className="editorial-actions">
          <div
            className="mode-toggle-group"
            role="group"
            aria-label="Chọn chế độ xem hành trình"
          >
            <button
              type="button"
              className={`mode-toggle-btn ${viewMode === 'scrolly' ? 'active' : ''}`}
              aria-pressed={viewMode === 'scrolly'}
              onClick={() => setViewMode('scrolly')}
            >
              <BookOpen size={18} aria-hidden="true" />
              <span>Mạch truyện (Cuộn dọc)</span>
            </button>
            <button
              type="button"
              className={`mode-toggle-btn ${viewMode === 'stepped' ? 'active' : ''}`}
              aria-pressed={viewMode === 'stepped'}
              onClick={() => setViewMode('stepped')}
            >
              <Layers size={18} aria-hidden="true" />
              <span>Từng giai đoạn (Tập trung)</span>
            </button>
          </div>

          <Link to="/pregnancy-diet" className="cta-button">
            <Utensils size={18} aria-hidden="true" />
            <span>Cẩm nang dinh dưỡng IVF</span>
          </Link>
        </div>

        <div className="interaction-cue-banner" role="note">
          <div>
            <strong>Hướng dẫn tương tác: </strong>
            <span>{journeyMeta.interactionHint}</span>
          </div>
        </div>
      </header>

      {/* Wayfinding Timeline */}
      <Timeline
        stages={ivfStages}
        activeStageIndex={activeStageIndex}
        onStageSelect={handleStageSelect}
      />

      {/* Main Stage Journey */}
      <main id="journey-main" ref={mainRef} className="stages-container">
        {ivfStages.length === 0 ? (
          <div className="empty-state-box">
            <p className="empty-state-text">
              Hiện chưa có dữ liệu giai đoạn nào được tải. Vui lòng kiểm tra lại nguồn dữ liệu hành trình hoặc xem trang dinh dưỡng.
            </p>
            <Link to="/pregnancy-diet" className="cta-button">
              Mở cẩm nang dinh dưỡng
            </Link>
          </div>
        ) : viewMode === 'scrolly' ? (
          ivfStages.map((stage, index) => (
            <React.Fragment key={stage.id}>
              <StageContent
                stage={stage}
                ref={(el) => {
                  sectionRefs.current[index] = el;
                }}
                onCardClick={(cardData) => setSelectedCard(cardData)}
              />
              {index < ivfStages.length - 1 && (
                <hr className="stage-divider" aria-hidden="true" />
              )}
            </React.Fragment>
          ))
        ) : (
          <>
            <StageContent
              key={activeStage.id}
              stage={activeStage}
              onCardClick={(cardData) => setSelectedCard(cardData)}
            />

            <div className="stepped-pagination" aria-label="Điều hướng chương ở chế độ từng giai đoạn">
              <button
                type="button"
                className="timeline-step-btn"
                disabled={activeStageIndex === 0}
                onClick={() => handleStageSelect(activeStageIndex - 1)}
              >
                <ChevronLeft size={18} aria-hidden="true" />
                <span>
                  {activeStageIndex > 0
                    ? `Trước: ${ivfStages[activeStageIndex - 1].shortLabel}`
                    : 'Đầu hành trình'}
                </span>
              </button>

              <button
                type="button"
                className="lens-next-btn"
                onClick={() => setViewMode('scrolly')}
              >
                Hiển thị toàn bộ 7 chương (Cuộn dọc)
              </button>

              <button
                type="button"
                className="timeline-step-btn"
                disabled={activeStageIndex === ivfStages.length - 1}
                onClick={() => handleStageSelect(activeStageIndex + 1)}
              >
                <span>
                  {activeStageIndex < ivfStages.length - 1
                    ? `Tiếp: ${ivfStages[activeStageIndex + 1].shortLabel}`
                    : 'Cuối hành trình'}
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </main>

      {/* Editorial Credits & Plain-Text Disclaimer Block (02-typography.md) */}
      <footer className="editorial-footer" aria-label="Thông tin biên tập và miễn trừ y khoa">
        <h2 className="editorial-footer-title">
          Thông tin biên tập & Phạm vi tham khảo
        </h2>

        <p className="editorial-disclaimer">{journeyMeta.disclaimer}</p>

        {journeyMeta.credits && journeyMeta.credits.length > 0 && (
          <ul className="editorial-credits-list">
            {journeyMeta.credits.map((item) => (
              <li key={item.role} className="editorial-credit-item">
                <span className="editorial-credit-role">{item.role}</span>
                <span className="editorial-credit-detail">{item.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </footer>

      <Modal
        isOpen={!!selectedCard}
        onClose={() => setSelectedCard(null)}
        data={selectedCard}
      />
    </div>
  );
}

export default Home;
