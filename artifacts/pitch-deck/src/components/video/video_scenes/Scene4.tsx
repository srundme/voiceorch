import { motion } from "framer-motion";

export function Scene4() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-[#0a0a0a]"
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.2, ease: "easeOut" }}
    >
      <motion.div 
        className="absolute bottom-10 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white/10 text-white/80 text-[1.5vw] font-medium border border-white/20 z-50"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        OAuth flow complete — agent is ready to book meetings
      </motion.div>

      {/* Pulsing background glow */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[30vw] h-[30vw] rounded-full bg-[#a855f7] opacity-10 blur-[60px]"
        animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.15, 0.1] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative z-10 flex flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <svg width="8vw" height="8vw" viewBox="0 0 26 26" fill="none" className="mb-8 mx-auto drop-shadow-2xl">
            <rect width="26" height="26" rx="7" fill="#a855f7"/>
            <rect x="4" y="7" width="3" height="12" rx="1.5" fill="white" opacity=".9"/>
            <rect x="9" y="4" width="3" height="18" rx="1.5" fill="white"/>
            <rect x="14" y="9" width="3" height="8" rx="1.5" fill="white" opacity=".8"/>
            <rect x="19" y="5" width="3" height="16" rx="1.5" fill="white" opacity=".9"/>
          </svg>
        </motion.div>

        <motion.h1 
          className="text-[4vw] font-bold text-white tracking-tight mb-2"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          SnapServe AI
        </motion.h1>

        <motion.div 
          className="text-[1.8vw] text-[#888888] font-medium tracking-wide mb-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.8 }}
        >
          AI Voice Agents · Google Calendar Integration
        </motion.div>

        <motion.div 
          className="text-[1.5vw] text-[#c084fc]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.2 }}
        >
          snapserve.ai
        </motion.div>
      </div>
    </motion.div>
  );
}
