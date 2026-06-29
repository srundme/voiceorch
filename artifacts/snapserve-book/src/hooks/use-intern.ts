import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface InternProfile {
  name: string;
  email: string;
  registeredAt: string; // ISO date string
}

interface InternState {
  profile: InternProfile | null;
  register: (name: string, email: string) => void;
  clear: () => void;
  isRegistered: () => boolean;
}

export const useInternStore = create<InternState>()(
  persist(
    (set, get) => ({
      profile: null,

      register: (name: string, email: string) => {
        set({
          profile: {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            registeredAt: new Date().toISOString(),
          },
        });
      },

      clear: () => set({ profile: null }),

      isRegistered: () => get().profile !== null,
    }),
    {
      name: "snapserve-intern-profile",
    }
  )
);
