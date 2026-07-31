import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 700),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '-100%' }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--cream)] via-[#FFF5E6] to-[var(--cream)]" />
      
      {/* Pixel art builders */}
      <motion.img
        src={`${import.meta.env.BASE_URL}art/px-c13-squad.png`}
        alt=""
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[60%] h-[60%] object-contain"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Content */}
      <div className="relative z-10 text-center px-[8vw]">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="font-black text-[11vw] leading-[0.9]"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
        >
          300
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0 }}
          animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-[2vh] font-bold text-[4vw] tracking-wide"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--orange)' }}
        >
          BUILDERS
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-[2vh] text-[2.8vw] font-semibold"
          style={{ color: 'var(--navy)' }}
        >
          Solo or Teams of 2–3
        </motion.div>
      </div>
    </motion.div>
  );
}
