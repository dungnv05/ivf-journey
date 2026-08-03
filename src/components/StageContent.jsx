import React, { forwardRef } from 'react';
import { motion } from 'framer-motion';
import InfoCard from './InfoCard';
import { BookOpen, CheckCircle, XOctagon } from 'lucide-react';

const StageContent = forwardRef(({ stage, onCardClick }, ref) => {
  if (!stage) return null;

  return (
    <motion.section
      ref={ref}
      id={stage.id}
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.6 }}
      className="stage-content"
      style={{ minHeight: '80vh', paddingTop: '100px', marginBottom: '5rem' }}
    >
      <div className="stage-header">
        <h2 className="stage-title">{stage.title}</h2>
        <p className="stage-description">{stage.description}</p>
      </div>

      {/* Knowledge Section */}
      {stage.knowledge && stage.knowledge.length > 0 && (
        <div className="section-container">
          <h3 className="section-title knowledge">
            <BookOpen size={24} /> Kiến thức cơ bản
          </h3>
          <div className="cards-grid">
            {stage.knowledge.map((item, idx) => (
              <InfoCard 
                key={`k-${idx}`}
                type="knowledge"
                title={item.title}
                content={item.content}
                onClick={() => onCardClick({ ...item, type: 'knowledge' })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Do's Section */}
      {stage.dos && stage.dos.length > 0 && (
        <div className="section-container">
          <h3 className="section-title dos">
            <CheckCircle size={24} /> Nên làm
          </h3>
          <div className="cards-grid">
            {stage.dos.map((item, idx) => (
              <InfoCard 
                key={`d-${idx}`}
                type="dos"
                title={item.title || `Lời khuyên ${idx + 1}`}
                content={item.content || item}
                onClick={() => onCardClick({ ...item, type: 'dos', title: item.title || `Lời khuyên ${idx + 1}` })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Don'ts Section */}
      {stage.donts && stage.donts.length > 0 && (
        <div className="section-container">
          <h3 className="section-title donts">
            <XOctagon size={24} /> Tránh làm
          </h3>
          <div className="cards-grid">
            {stage.donts.map((item, idx) => (
              <InfoCard 
                key={`nd-${idx}`}
                type="donts"
                title={item.title || `Lưu ý ${idx + 1}`}
                content={item.content || item}
                onClick={() => onCardClick({ ...item, type: 'donts', title: item.title || `Lưu ý ${idx + 1}` })}
              />
            ))}
          </div>
        </div>
      )}
    </motion.section>
  );
});

export default StageContent;
