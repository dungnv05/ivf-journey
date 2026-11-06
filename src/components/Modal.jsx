import React, { useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  X,
  Heart,
  Settings,
  Activity,
  Brain,
  ShieldCheck,
  Flame,
  Moon,
  Coffee
} from 'lucide-react';
import { Link } from 'react-router-dom';

const iconMap = {
  Heart,
  Settings,
  Activity,
  Brain,
  ShieldCheck,
  Flame,
  Moon,
  Coffee
};

const typeLabelMap = {
  knowledge: 'Kiến thức y khoa',
  dos: 'Nên thực hành',
  donts: 'Cần tránh'
};

const Modal = ({ isOpen, onClose, data }) => {
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!data) return null;

  const IconToRender = iconMap[data.iconName] || Heart;
  const typeLabel = typeLabelMap[data.type] || 'Thông tin chi tiết';

  const getIconAnimation = () => {
    if (prefersReducedMotion) return undefined;
    if (data.animationType === 'pulse') return { scale: [1, 1.08, 1] };
    if (data.animationType === 'spin') return { rotate: 360 };
    if (data.animationType === 'bounce') return { y: [0, -10, 0] };
    return undefined;
  };

  const getIconTransition = () => {
    if (prefersReducedMotion) return undefined;
    if (data.animationType === 'pulse') return { repeat: Infinity, duration: 2.4 };
    if (data.animationType === 'spin') return { repeat: Infinity, duration: 6, ease: 'linear' };
    if (data.animationType === 'bounce') return { repeat: Infinity, duration: 1.8, ease: 'easeInOut' };
    return undefined;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-backdrop"
          initial={prefersReducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReducedMotion ? undefined : { opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            initial={prefersReducedMotion ? false : { scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { scale: 0.95, opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label="Đóng hộp thoại chi tiết"
            >
              <X size={18} aria-hidden="true" />
              <span>Đóng</span>
            </button>

            <div className={`modal-hero ${data.type || 'knowledge'}`}>
              <motion.div
                className="modal-icon-container"
                animate={getIconAnimation()}
                transition={getIconTransition()}
              >
                <IconToRender size={72} strokeWidth={1.6} aria-hidden="true" />
              </motion.div>
            </div>

            <div className="modal-body">
              <div className="stage-meta-row">
                <span className="timeline-chapter-badge">{typeLabel}</span>
                {data.stageTitle && (
                  <span className="byline-pill">
                    {data.stageChapter ? `${data.stageChapter}: ` : ''}{data.stageTitle}
                  </span>
                )}
              </div>

              <h3 id="modal-title" className="modal-title">
                {data.title}
              </h3>

              {data.content && (
                <p className="modal-summary">{data.content}</p>
              )}

              {data.detail ? (
                <div
                  className="modal-detail"
                  dangerouslySetInnerHTML={{ __html: data.detail }}
                />
              ) : (
                <p className="modal-detail">
                  Chưa có ghi chú bổ sung cho mục này. Bạn có thể đóng hộp thoại để xem các mục khác trong chương.
                </p>
              )}

              <div className="modal-cta-row">
                {data.hasDietCTA && (
                  <Link
                    to="/pregnancy-diet"
                    className="cta-button"
                    onClick={onClose}
                  >
                    Xem cẩm nang dinh dưỡng IVF chi tiết
                  </Link>
                )}
                <button
                  type="button"
                  className="lens-next-btn"
                  onClick={onClose}
                >
                  Quay lại hành trình
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default Modal;
