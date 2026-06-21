import { useState, useEffect } from "react";
import { motion } from "framer-motion";

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),   // Card slide up
      setTimeout(() => setPhase(2), 3000),  // Start scroll
      setTimeout(() => setPhase(3), 10000), // Show cursor
      setTimeout(() => setPhase(4), 22000), // Cursor moves to allow
      setTimeout(() => setPhase(5), 26000), // Click allow
      setTimeout(() => setPhase(6), 26500), // Checkmark
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -50 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div 
        className="absolute bottom-10 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white/10 text-white/80 text-[1.5vw] font-medium border border-white/20 z-50"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        Step 2 — Google OAuth consent screen showing requested scope
      </motion.div>

      <motion.div 
        className="bg-white rounded-3xl w-[45vw] max-w-[700px] text-black shadow-2xl overflow-hidden flex flex-col relative"
        initial={{ y: "50vh", opacity: 0, scale: 0.95 }}
        animate={phase >= 1 ? { y: 0, opacity: 1, scale: 1 } : { y: "50vh", opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.8, type: "spring", stiffness: 100, damping: 20 }}
      >
        {/* Header */}
        <div className="p-8 border-b border-gray-100 flex flex-col items-center">
          <div className="flex items-center gap-1 mb-6">
            <span className="text-[#4285F4] text-[2.5vw] font-medium leading-none">G</span>
            <span className="text-[#EA4335] text-[2.5vw] font-medium leading-none">o</span>
            <span className="text-[#FBBC05] text-[2.5vw] font-medium leading-none">o</span>
            <span className="text-[#4285F4] text-[2.5vw] font-medium leading-none">g</span>
            <span className="text-[#34A853] text-[2.5vw] font-medium leading-none">l</span>
            <span className="text-[#EA4335] text-[2.5vw] font-medium leading-none">e</span>
          </div>
          <h2 className="text-[2vw] font-normal text-center text-gray-800 mb-6 leading-snug">
            <span className="font-semibold text-black">SnapServe AI</span> wants access to your Google Account
          </h2>
          <div className="flex items-center gap-3 border border-gray-200 rounded-full px-5 py-2">
            <div className="w-[2vw] h-[2vw] bg-purple-600 rounded-full flex items-center justify-center text-white text-[1.2vw] font-medium">
              U
            </div>
            <span className="text-[1.2vw] font-medium text-gray-700">user@gmail.com</span>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="p-8 h-[25vw] relative overflow-hidden">
          <motion.div 
            className="flex flex-col gap-6"
            animate={phase >= 2 ? { y: "-6vw" } : { y: 0 }}
            transition={{ duration: 15, ease: "linear" }}
          >
            <div className="text-[1.4vw] text-gray-700 font-medium">
              SnapServe AI will be able to:
            </div>
            
            <div className="bg-[#f8f9fa] border border-gray-200 rounded-xl p-6">
              <div className="flex items-start gap-4">
                <div className="w-[2.5vw] h-[2.5vw] shrink-0">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M19 4H5C3.89543 4 3 4.89543 3 6V20C3 21.1046 3.89543 22 5 22H19C20.1046 22 21 21.1046 21 20V6C21 4.89543 20.1046 4 19 4Z" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M16 2V6" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M8 2V6" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M3 10H21" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <div className="text-[1.4vw] font-semibold text-gray-900 mb-2">Google Calendar</div>
                  <div className="text-[1.2vw] text-gray-600 leading-relaxed">
                    See, edit, share, and permanently delete all the calendars you can access using Google Calendar
                  </div>
                </div>
              </div>
            </div>

            <div className="text-[1.1vw] text-gray-500 bg-blue-50 p-5 rounded-lg border border-blue-100 italic">
              "Calendar access is used only to create and manage meeting bookings made through your AI agent."
            </div>

            <div className="text-[1.1vw] text-gray-500 mt-4 leading-relaxed">
              Make sure you trust SnapServe AI. You may be sharing sensitive info with this site or app. 
              Find out how SnapServe AI will handle your data by reviewing its Terms of Service and Privacy Policies.
            </div>
          </motion.div>
        </div>

        {/* Footer buttons */}
        <div className="p-6 border-t border-gray-100 flex justify-end gap-4 bg-white relative z-10">
          <div className="px-8 py-3 rounded-md border border-gray-300 text-gray-700 font-medium text-[1.2vw]">
            Cancel
          </div>
          <div className="relative">
            <motion.div 
              className="px-8 py-3 rounded-md bg-[#4285F4] text-white font-medium text-[1.2vw] flex items-center justify-center min-w-[10vw]"
              animate={phase >= 6 ? { backgroundColor: "#34A853" } : { backgroundColor: "#4285F4" }}
            >
              {phase >= 6 ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="shrink-0">
                  <path d="M20 6L9 17L4 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : "Allow"}
            </motion.div>
            
            {/* Cursor */}
            <motion.svg 
              width="3vw" height="3vw" viewBox="0 0 24 24" fill="none" 
              className="absolute z-50 filter drop-shadow-md pointer-events-none"
              initial={{ x: "-10vw", y: "15vw", opacity: 0 }}
              animate={
                phase >= 5 ? { x: "4vw", y: "1vw", opacity: 1, scale: 0.9 } :
                phase >= 4 ? { x: "4vw", y: "1vw", opacity: 1, scale: 1 } :
                phase >= 3 ? { x: "-5vw", y: "10vw", opacity: 1, scale: 1 } :
                { x: "-10vw", y: "15vw", opacity: 0, scale: 1 }
              }
              transition={{ duration: 1.5, ease: "easeInOut" }}
            >
              <path d="M5.5 3L18.5 16H11.5L9 21L5.5 3Z" fill="white" stroke="black" strokeWidth="1.5" strokeLinejoin="round" />
            </motion.svg>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
