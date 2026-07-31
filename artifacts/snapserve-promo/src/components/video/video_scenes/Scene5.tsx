import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene5() {
  const [showDeadline, setShowDeadline] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowDeadline(true), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      initial={{ clipPath: 'polygon(0 0, 100% 0, 100% 0, 0 0)' }}
      animate={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--orange)] via-[#D44520] to-[var(--orange)]" />
      
      {/* Pixel art trophy */}
      <motion.img
        src={`${import.meta.env.BASE_URL}art/px-c7-trophy.png`}
        alt=""
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[50%] h-[50%] object-contain opacity-40"
        initial={{ opacity: 0, y: 30, scale: 0.9 }}
        animate={{ opacity: 0.4, y: 0, scale: 1 }}
        transition={{ delay: 0.3, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Content */}
      <div className="relative z-10 text-center px-[8vw]">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="font-black text-[7vw] leading-tight text-white"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Registration Closes
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={showDeadline ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.4, type: 'spring', stiffness: 300, damping: 20 }}
          className="mt-[3vh] inline-block bg-white px-[5vw] py-[2vh] font-bold text-[4.5vw] tracking-wider"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--charcoal)' }}
        >
          AUG 15, 11:59 PM
        </motion.div>
      </div>
    </motion.div>
  );
}
