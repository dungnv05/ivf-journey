import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Lightbulb } from 'lucide-react';

const InfoCard = ({ type, title, content, onClick }) => {
  let IconComponent;
  
  if (type === 'knowledge') IconComponent = Lightbulb;
  else if (type === 'dos') IconComponent = CheckCircle2;
  else if (type === 'donts') IconComponent = XCircle;

  return (
    <motion.div 
      className={`info-card ${type}`}
      whileHover={{ y: -5, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <div className="card-header">
        <div className="icon-wrapper">
          <IconComponent size={20} />
        </div>
        <h4 className="card-title">{title}</h4>
      </div>
      <div className="card-content">
        {content}
      </div>
    </motion.div>
  );
};

export default InfoCard;
