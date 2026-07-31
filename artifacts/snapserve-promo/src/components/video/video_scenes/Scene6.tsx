import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 900),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 1.1, opacity: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background */}
      <div className="absolute inset-0 bg-[var(--cream)]" />
      
      {/* Grid overlay */}
      <div 
        className="absolute inset-0 opacity-15"
        style={{
          backgroundImage: 'linear-gradient(var(--charcoal) 1px, transparent 1px), linear-gradient(90deg, var(--charcoal) 1px, transparent 1px)',
          backgroundSize: '50px 50px'
        }}
      />

      {/* Pixel art crowd cheering */}
      <motion.img
        src={`${import.meta.env.BASE_URL}art/px-c15-cheer.png`}
        alt=""
        className="absolute bottom-0 w-full h-[50%] object-cover opacity-30"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 0.3, y: 0 }}
        transition={{ delay: 0.2, duration: 0.7 }}
      />

      {/* Content */}
      <div className="relative z-10 text-center px-[8vw]">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="font-black text-[8vw] leading-[0.95]"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
        >
          Register Now
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0 }}
          animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-[3vh] font-bold text-[3.5vw] tracking-wider"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--navy)' }}
        >
          snapserve.ai
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          transition={{ duration: 0.3 }}
          className="mt-[1.5vh] text-[2.5vw] font-semibold"
          style={{ color: 'var(--orange)' }}
        >
          Free Entry
        </motion.div>
      </div>

      {/* Logos at bottom */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="absolute bottom-[8%] left-[8%] right-[8%] flex items-center justify-between gap-[4vw]"
      >
        <div className="flex items-center gap-[2vw]">
          <div className="text-[1.8vw] font-bold tracking-wide" style={{ fontFamily: 'var(--font-mono)', color: '#999' }}>ORGANISED BY</div>
          <img src={`${import.meta.env.BASE_URL}snapserve-logo-t.png`} alt="SnapServe" className="h-[6vh]" />
        </div>
        <div className="flex items-center gap-[2vw]">
          <div className="text-[1.8vw] font-bold tracking-wide" style={{ fontFamily: 'var(--font-mono)', color: '#999' }}>POWERED BY</div>
          <img src={`${import.meta.env.BASE_URL}vobiz-logo.png`} alt="Vobiz" className="h-[5vh]" />
        </div>
        <div className="flex items-center gap-[2vw]">
          <div className="text-[1.8vw] font-bold tracking-wide" style={{ fontFamily: 'var(--font-mono)', color: '#999' }}>SUPPORTED BY</div>
          <img src={`${import.meta.env.BASE_URL}zenxai-logo.png`} alt="ZenXai" className="h-[5vh]" />
        </div>
      </motion.div>
    </motion.div>
  );
}
