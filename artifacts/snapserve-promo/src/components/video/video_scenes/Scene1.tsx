import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene1() {
  const [showSubtitle, setShowSubtitle] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowSubtitle(true), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3 }}
    >
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--cream)] to-[var(--cream)]" />
      
      {/* Grid overlay */}
      <div 
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: 'linear-gradient(var(--charcoal) 1px, transparent 1px), linear-gradient(90deg, var(--charcoal) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      />

      {/* Pixel art hall background */}
      <motion.img
        src={`${import.meta.env.BASE_URL}art/px-c1-hall.png`}
        alt=""
        className="absolute bottom-0 right-0 w-[70%] h-[70%] object-contain opacity-40"
        initial={{ opacity: 0, x: 100 }}
        animate={{ opacity: 0.4, x: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Content */}
      <div className="relative z-10 text-center px-[10vw]">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="font-bold text-[10vw] leading-[0.95] tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            <motion.span
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
            >
              India's Biggest
            </motion.span>
            <br/>
            <motion.span 
              className="text-[var(--orange)]"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.5, type: 'spring', stiffness: 300, damping: 20 }}
            >
              Voice-a-thon
            </motion.span>
          </div>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0 }}
          animate={showSubtitle ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="mt-[3vh] font-bold text-[4vw] tracking-wide"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--navy)' }}
        >
          FOR TAMIL NADU
        </motion.div>
      </div>
    </motion.div>
  );
}
