import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Heart, Settings, Activity, Brain, ShieldCheck, Flame, Moon, Coffee } from 'lucide-react';
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

const Modal = ({ isOpen, onClose, data }) => {
  if (!data) return null;

  const IconToRender = iconMap[data.iconName] || Heart;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div 
            className="modal-content"
            initial={{ scale: 0.8, opacity: 0, y: 50 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 50 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()} // Chặn sự kiện click ra ngoài
          >
            <button className="modal-close-btn" onClick={onClose}>
              <X size={20} />
            </button>
            
            <div className={`modal-hero ${data.type}`}>
              <motion.div 
                className="modal-icon-container"
                animate={
                  data.animationType === 'pulse' ? { scale: [1, 1.2, 1] } :
                  data.animationType === 'spin' ? { rotate: 360 } :
                  data.animationType === 'bounce' ? { y: [0, -20, 0] } :
                  { scale: 1 } // default
                }
                transition={
                  data.animationType === 'pulse' ? { repeat: Infinity, duration: 2 } :
                  data.animationType === 'spin' ? { repeat: Infinity, duration: 4, ease: "linear" } :
                  data.animationType === 'bounce' ? { repeat: Infinity, duration: 1.5, ease: "easeInOut" } :
                  {}
                }
              >
                <IconToRender size={100} strokeWidth={1.5} />
              </motion.div>
            </div>

            <div className="modal-body">
              <h3 className="modal-title">{data.title}</h3>
              <div className="modal-summary" style={{ fontSize: '1.1rem', marginBottom: '1.5rem', color: 'var(--text-main)', borderLeft: '4px solid var(--primary)', paddingLeft: '1rem', fontWeight: '500' }}>
                {data.content}
              </div>
              <div 
                className="modal-detail" 
                dangerouslySetInnerHTML={{ __html: data.detail }} 
              />
              {data.hasDietCTA && (
                <div style={{ marginTop: '2rem', textAlign: 'center' }}>
                  <Link 
                    to="/pregnancy-diet" 
                    className="cta-button"
                    onClick={onClose}
                    style={{
                      display: 'inline-block',
                      backgroundColor: 'var(--primary)',
                      color: 'white',
                      padding: '0.75rem 1.5rem',
                      borderRadius: '2rem',
                      textDecoration: 'none',
                      fontWeight: 'bold',
                      boxShadow: '0 4px 14px rgba(236, 72, 153, 0.4)',
                      transition: 'transform 0.2s',
                    }}
                  >
                    Chế độ ăn uống chi tiết
                  </Link>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default Modal;
