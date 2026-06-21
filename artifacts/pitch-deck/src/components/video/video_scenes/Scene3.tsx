import { useState, useEffect } from "react";
import { motion } from "framer-motion";

export function Scene3() {
  const [phase, setPhase] = useState(0);
  const [urlText, setUrlText] = useState("accounts.google.com/o/oauth2/v2/auth");

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),   // browser bar fully in
      setTimeout(() => {
        // scramble typing effect
        let i = 0;
        const target = "snapserve.ai/app/dashboard";
        const interval = setInterval(() => {
          setUrlText(target.substring(0, i) + "|");
          i++;
          if (i > target.length) {
            clearInterval(interval);
            setUrlText(target);
          }
        }, 50);
      }, 2000), // type new URL
      setTimeout(() => setPhase(2), 4000),  // transition to dashboard
      setTimeout(() => setPhase(3), 5000),  // dashboard header
      setTimeout(() => setPhase(4), 6000),  // welcome banner
      setTimeout(() => setPhase(5), 7000),  // agent cards
      setTimeout(() => setPhase(6), 8500),  // calendar badge
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-[#0a0a0a]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div 
        className="absolute bottom-10 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white/10 text-white/80 text-[1.5vw] font-medium border border-white/20 z-50"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        Step 3 — OAuth complete, user lands in authenticated dashboard
      </motion.div>

      {/* Browser Chrome */}
      <motion.div 
        className="absolute top-0 left-0 right-0 h-[8vh] bg-[#1a1a1a] border-b border-white/10 flex items-center px-6 gap-4 z-40"
        initial={{ y: "-100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <div className="flex gap-2">
          <div className="w-[1vw] h-[1vw] rounded-full bg-red-500/80"></div>
          <div className="w-[1vw] h-[1vw] rounded-full bg-yellow-500/80"></div>
          <div className="w-[1vw] h-[1vw] rounded-full bg-green-500/80"></div>
        </div>
        <div className="flex-1 max-w-2xl mx-auto bg-[#2a2a2a] rounded-full h-[4vh] flex items-center px-4">
          <svg width="1.2vw" height="1.2vw" viewBox="0 0 24 24" fill="none" className="text-gray-400 mr-3">
            <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 12H22" stroke="currentColor" strokeWidth="2"/>
            <path d="M12 2C14.5013 4.73835 15.9228 8.29203 16 12C15.9228 15.708 14.5013 19.2616 12 22C9.49872 19.2616 8.07725 15.708 8 12C8.07725 8.29203 9.49872 4.73835 12 2Z" stroke="currentColor" strokeWidth="2"/>
          </svg>
          <span className="text-gray-300 font-mono text-[1.2vw] tracking-tight">{urlText}</span>
        </div>
      </motion.div>

      {/* Dashboard View */}
      <motion.div 
        className="w-full h-full pt-[8vh] flex flex-col max-w-[80vw]"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 1 }}
      >
        {/* Header */}
        <motion.div 
          className="flex items-center justify-between py-8 border-b border-white/10"
          initial={{ opacity: 0, y: -20 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        >
          <div className="flex items-center gap-3">
            <svg width="2vw" height="2vw" viewBox="0 0 26 26" fill="none">
              <rect width="26" height="26" rx="7" fill="#a855f7"/>
              <rect x="4" y="7" width="3" height="12" rx="1.5" fill="white" opacity=".9"/>
              <rect x="9" y="4" width="3" height="18" rx="1.5" fill="white"/>
              <rect x="14" y="9" width="3" height="8" rx="1.5" fill="white" opacity=".8"/>
              <rect x="19" y="5" width="3" height="16" rx="1.5" fill="white" opacity=".9"/>
            </svg>
            <span className="text-[1.8vw] font-bold tracking-tight text-white">SnapServe AI</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-[2vw] h-[2vw] rounded-full bg-purple-600 flex items-center justify-center text-[1vw] text-white">U</div>
          </div>
        </motion.div>

        {/* Content */}
        <div className="flex-1 py-8 flex flex-col gap-8">
          {/* Welcome Banner */}
          <motion.div 
            className="bg-gradient-to-r from-purple-900/40 to-transparent border border-purple-500/20 rounded-2xl p-6 flex items-center gap-4"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={phase >= 4 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }}
            transition={{ type: "spring" }}
          >
            <div className="w-[3vw] h-[3vw] rounded-full bg-green-500/20 flex items-center justify-center">
              <svg width="1.5vw" height="1.5vw" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17L4 12" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h2 className="text-[1.5vw] font-semibold text-white">Welcome back!</h2>
              <p className="text-[1.2vw] text-purple-200">You're signed in as user@gmail.com</p>
            </div>
          </motion.div>

          <div className="grid grid-cols-2 gap-6">
            <motion.div 
              className="bg-[#111] border border-white/5 rounded-2xl p-6"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ delay: 0.1 }}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="w-[3vw] h-[3vw] rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <span className="text-blue-400 text-[1.5vw]">S</span>
                </div>
                <div className="px-3 py-1 rounded-full bg-green-500/10 text-green-400 text-[0.8vw] font-medium border border-green-500/20">Active</div>
              </div>
              <h3 className="text-[1.4vw] font-semibold text-white mb-2">Sales Agent</h3>
              <p className="text-[1vw] text-gray-400">Outbound qualifying calls</p>
            </motion.div>

            <motion.div 
              className="bg-[#111] border border-white/5 rounded-2xl p-6"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ delay: 0.2 }}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="w-[3vw] h-[3vw] rounded-xl bg-orange-500/10 flex items-center justify-center">
                  <span className="text-orange-400 text-[1.5vw]">B</span>
                </div>
                <div className="px-3 py-1 rounded-full bg-green-500/10 text-green-400 text-[0.8vw] font-medium border border-green-500/20">Active</div>
              </div>
              <h3 className="text-[1.4vw] font-semibold text-white mb-2">Support Bot</h3>
              <p className="text-[1vw] text-gray-400">Inbound issue resolution</p>
            </motion.div>
          </div>

          <motion.div 
            className="self-start inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={phase >= 6 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", bounce: 0.4 }}
          >
            <svg width="1.2vw" height="1.2vw" viewBox="0 0 24 24" fill="none">
              <path d="M19 4H5C3.89543 4 3 4.89543 3 6V20C3 21.1046 3.89543 22 5 22H19C20.1046 22 21 21.1046 21 20V6C21 4.89543 20.1046 4 19 4Z" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M16 2V6" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 2V6" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 10H21" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-[1vw] text-gray-300 font-medium">Google Calendar Connected</span>
            <svg width="1vw" height="1vw" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17L4 12" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}
