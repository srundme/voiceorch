import { motion } from 'framer-motion';

export function Scene4() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Colorful bunting background */}
      <div className="absolute inset-0 bg-[var(--charcoal)]" />
      
      <div className="absolute top-0 left-0 right-0 flex h-[8%]">
        {[...Array(15)].map((_, i) => (
          <motion.div
            key={i}
            className="flex-1"
            style={{ 
              background: ['#8E2A5C', '#C99A1F', '#12406B', '#256B4A', '#F04E23'][i % 5]
            }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
          />
        ))}
      </div>

      {/* Pixel art judges */}
      <motion.img
        src={`${import.meta.env.BASE_URL}art/px-c5-judges.png`}
        alt=""
        className="absolute bottom-0 right-0 w-[55%] h-[55%] object-contain opacity-50"
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 0.5, x: 0 }}
        transition={{ delay: 0.3, duration: 0.6 }}
      />

      {/* Content */}
      <div className="relative z-10 text-center px-[8vw]">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, type: 'spring', stiffness: 300, damping: 20 }}
          className="font-bold text-[6vw] leading-tight text-white"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Sat, Sep 5
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="mt-[2vh] font-bold text-[3.5vw] tracking-wider"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--orange)' }}
        >
          9:30 AM – 6:00 PM
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className="mt-[3vh] text-[2.8vw] font-semibold text-white/80"
        >
          Olive Public School<br/>
          Chitlapakkam, Chennai
        </motion.div>
      </div>
    </motion.div>
  );
}
