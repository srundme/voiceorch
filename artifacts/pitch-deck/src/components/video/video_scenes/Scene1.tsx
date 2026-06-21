import { useState, useEffect } from "react";
import { motion } from "framer-motion";

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // Show logo
      setTimeout(() => setPhase(2), 1500), // Show headline
      setTimeout(() => setPhase(3), 2500), // Show button
      setTimeout(() => setPhase(4), 5000), // Move cursor
      setTimeout(() => setPhase(5), 7000), // Click button
      setTimeout(() => setPhase(6), 7500), // Button effect
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center p-8"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -50 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Label */}
      <motion.div 
        className="absolute bottom-10 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white/10 text-white/80 text-[1.5vw] font-medium border border-white/20"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1 }}
      >
        Step 1 — User clicks 'Sign in with Google'
      </motion.div>

      {/* Header mock */}
      <motion.div 
        className="absolute top-8 left-12 flex items-center gap-3"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <svg width="32" height="32" viewBox="0 0 26 26" fill="none">
          <rect width="26" height="26" rx="7" fill="#a855f7"/>
          <rect x="4" y="7" width="3" height="12" rx="1.5" fill="white" opacity=".9"/>
          <rect x="9" y="4" width="3" height="18" rx="1.5" fill="white"/>
          <rect x="14" y="9" width="3" height="8" rx="1.5" fill="white" opacity=".8"/>
          <rect x="19" y="5" width="3" height="16" rx="1.5" fill="white" opacity=".9"/>
        </svg>
        <span className="text-[1.8vw] font-bold tracking-tight">SnapServe AI</span>
      </motion.div>

      <div className="flex flex-col items-center text-center max-w-4xl z-10">
        <motion.h1 
          className="text-[4.5vw] font-extrabold leading-tight mb-6"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          AI Voice Agents that <br />
          <span className="text-[#a855f7]">remember every caller</span>
        </motion.h1>
        
        <motion.p 
          className="text-[1.5vw] text-[#888888] mb-12"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 1, delay: 0.3 }}
        >
          Powered by Google Calendar · Smart Scheduling · Voice Memory
        </motion.p>

        <motion.div
          className="relative"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.5, type: "spring", stiffness: 200 }}
        >
          <motion.div 
            className="flex items-center gap-4 bg-white text-black px-8 py-4 rounded-lg font-medium text-[1.2vw] shadow-lg relative overflow-hidden"
            animate={phase >= 6 ? { scale: 0.95, backgroundColor: "#f3f4f6" } : { scale: 1, backgroundColor: "#ffffff" }}
            transition={{ duration: 0.2 }}
          >
            {/* Google G logo */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.1v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.1C1.37 8.56 1 10.23 1 12s.37 3.44 1.1 4.93l3.74-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 15.02 1 12 1 7.7 1 3.99 3.47 2.1 7.07l3.74 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
            
            {phase >= 5 && (
              <motion.div 
                className="absolute inset-0 bg-black/10 rounded-lg"
                initial={{ opacity: 1, scale: 0 }}
                animate={{ opacity: 0, scale: 2 }}
                transition={{ duration: 0.6 }}
              />
            )}
          </motion.div>

          {/* Cursor */}
          <motion.svg 
            width="4vw" height="4vw" viewBox="0 0 24 24" fill="none" 
            className="absolute z-50 filter drop-shadow-md pointer-events-none"
            initial={{ x: "15vw", y: "15vw", opacity: 0 }}
            animate={
              phase >= 5 ? { x: "4vw", y: "1vw", opacity: 1, scale: 0.9 } :
              phase >= 4 ? { x: "4vw", y: "1vw", opacity: 1, scale: 1 } :
              { x: "15vw", y: "15vw", opacity: 0, scale: 1 }
            }
            transition={{ duration: 1.2, ease: "easeOut" }}
          >
            <path d="M5.5 3L18.5 16H11.5L9 21L5.5 3Z" fill="white" stroke="black" strokeWidth="1.5" strokeLinejoin="round" />
          </motion.svg>
        </motion.div>
      </div>
    </motion.div>
  );
}
