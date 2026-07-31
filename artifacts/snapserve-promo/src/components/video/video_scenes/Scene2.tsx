import { motion } from 'framer-motion';

export function Scene2() {
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      initial={{ clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background */}
      <div className="absolute inset-0 bg-[var(--navy)]" />
      
      {/* Pixel art stage */}
      <motion.img
        src={`${import.meta.env.BASE_URL}art/px-c6-finale.png`}
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-30"
        initial={{ scale: 1.2 }}
        animate={{ scale: 1 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Content */}
      <div className="relative z-10 text-center px-[8vw]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.5, type: 'spring', stiffness: 300, damping: 25 }}
          className="inline-block bg-[var(--orange)] px-[6vw] py-[3vh] text-white font-bold text-[5vw] tracking-wider"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          ₹1,00,000
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4 }}
          className="mt-[2vh] text-white font-bold text-[3.5vw] tracking-wide"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          PRIZE POOL
        </motion.div>
      </div>
    </motion.div>
  );
}
