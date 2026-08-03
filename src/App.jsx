import React, { useState, useEffect, useRef } from 'react';
import Timeline from './components/Timeline';
import StageContent from './components/StageContent';
import Modal from './components/Modal';
import { ivfStages } from './data/ivfData';

function App() {
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [selectedCard, setSelectedCard] = useState(null);
  const sectionRefs = useRef([]);

  const scrollToStage = (index) => {
    sectionRefs.current[index]?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const observerOptions = {
      root: null,
      rootMargin: '-40% 0px -50% 0px',
      threshold: 0
    };

    const observerCallback = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const index = sectionRefs.current.findIndex(ref => ref === entry.target);
          if (index !== -1) {
            setActiveStageIndex(index);
          }
        }
      });
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);
    
    sectionRefs.current.forEach(ref => {
      if (ref) observer.observe(ref);
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="app-container">
      <header className="header" style={{ marginBottom: '4rem' }}>
        <h1 className="title">Hành Trình Đón Con Yêu</h1>
        <p className="subtitle">
          Cẩm nang kiến thức IVF - Nơi chia sẻ kinh nghiệm, lưu ý quan trọng qua từng giai đoạn để bạn luôn tự tin và an tâm.
        </p>
      </header>

      <Timeline 
        stages={ivfStages} 
        activeStageIndex={activeStageIndex} 
        onStageSelect={scrollToStage} 
      />
      
      <main className="stages-container">
        {ivfStages.map((stage, index) => (
          <React.Fragment key={stage.id}>
            <StageContent 
              stage={stage} 
              ref={(el) => (sectionRefs.current[index] = el)}
              onCardClick={(cardData) => setSelectedCard(cardData)}
            />
            {index < ivfStages.length - 1 && (
              <div className="stage-divider"></div>
            )}
          </React.Fragment>
        ))}
      </main>

      <Modal 
        isOpen={!!selectedCard} 
        onClose={() => setSelectedCard(null)} 
        data={selectedCard} 
      />
    </div>
  );
}

export default App;
