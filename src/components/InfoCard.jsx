import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, XCircle, Lightbulb, ArrowRight } from 'lucide-react';

const typeMeta = {
  knowledge: {
    Icon: Lightbulb,
    label: 'Kiến thức y khoa'
  },
  dos: {
    Icon: CheckCircle2,
    label: 'Nên thực hành'
  },
  donts: {
    Icon: XCircle,
    label: 'Cần tránh'
  }
};

const InfoCard = ({ type = 'knowledge', title, content, onClick }) => {
  const prefersReducedMotion = useReducedMotion();
  const meta = typeMeta[type] || typeMeta.knowledge;
  const IconComponent = meta.Icon;

  return (
    <motion.button
      type="button"
      className={`info-card ${type}`}
      whileHover={prefersReducedMotion ? undefined : { y: -2 }}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.99 }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      aria-label={`${meta.label}: ${title}. Nhấn để đọc chi tiết.`}
    >
      <div className="card-top">
        <span className="card-type-badge">
          <IconComponent size={15} aria-hidden="true" />
          <span>{meta.label}</span>
        </span>
        <div className="card-header">
          <div className="icon-wrapper" aria-hidden="true">
            <IconComponent size={20} />
          </div>
          <h4 className="card-title">{title}</h4>
        </div>
        <p className="card-content">{content}</p>
      </div>

      <span className="card-footer-action">
        <span>Đọc phân tích chi tiết</span>
        <ArrowRight size={16} aria-hidden="true" />
      </span>
    </motion.button>
  );
};

export default InfoCard;
