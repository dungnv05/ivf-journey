import React from 'react';
import { Dna, Baby, CalendarClock, HeartPulse, Activity, Stethoscope, Footprints } from 'lucide-react';

const iconMap = {
  Dna,
  Baby,
  CalendarClock,
  HeartPulse,
  Activity,
  Stethoscope,
  Footprints
};

const Timeline = ({ stages, activeStageIndex, onStageSelect }) => {
  // Calculate progress percentage
  const progress = stages.length > 1 
    ? (activeStageIndex / (stages.length - 1)) * 100 
    : 0;

  return (
    <div className="timeline-container">
      <div className="timeline-line"></div>
      <div 
        className="timeline-progress" 
        style={{ 
          width: window.innerWidth <= 768 ? '4px' : `${progress}%`,
          height: window.innerWidth <= 768 ? `${progress}%` : '4px'
        }}
      ></div>
      
      {stages.map((stage, index) => {
        const Icon = iconMap[stage.iconName];
        const isActive = index === activeStageIndex;
        
        return (
          <div 
            key={stage.id} 
            className="timeline-node-wrapper"
            onClick={() => onStageSelect(index)}
          >
            <div className={`timeline-node ${isActive ? 'active' : ''}`}>
              <Icon size={24} />
            </div>
            <div className={`timeline-label ${isActive ? 'active' : ''}`}>
              {stage.title}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default Timeline;
