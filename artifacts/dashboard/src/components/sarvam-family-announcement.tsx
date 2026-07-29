import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

const LS_KEY = "snapserve:sarvam-family-announcement";
const SESSION_KEY = "snapserve:sarvam-family-announcement:session";
const MAX_SHOWS_PER_DAY = 3;

type DayState = { day: string; count: number };

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function readDayState(): DayState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { day: todayKey(), count: 0 };
    const parsed = JSON.parse(raw) as DayState;
    if (!parsed?.day || typeof parsed.count !== "number") {
      return { day: todayKey(), count: 0 };
    }
    return parsed;
  } catch {
    return { day: todayKey(), count: 0 };
  }
}

function writeDayState(state: DayState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

/** True if we should open the modal on this authenticated visit. */
function shouldAnnounce(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_KEY) === "1") return false;
  } catch {
    /* sessionStorage blocked — still allow daily-capped shows */
  }
  const day = todayKey();
  const state = readDayState();
  if (state.day !== day) return true;
  return state.count < MAX_SHOWS_PER_DAY;
}

function recordShow() {
  const day = todayKey();
  const prev = readDayState();
  const count = prev.day === day ? prev.count + 1 : 1;
  writeDayState({ day, count });
}

function markSessionDismissed() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Post-login announcement: SnapServe × Sarvam family.
 * Shows up to 3 times per calendar day; closing hides it for the rest of the tab session.
 */
export function SarvamFamilyAnnouncement() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      // Already closed this tab session — never re-open until a new session.
      if (sessionStorage.getItem(SESSION_KEY) === "1") return;
      // Already opened (and counted) this session — reopen only for Strict Mode remounts.
      if (sessionStorage.getItem(`${SESSION_KEY}:shown`) === "1") {
        setOpen(true);
        return;
      }
    } catch {
      /* private mode — fall through to daily cap */
    }

    if (!shouldAnnounce()) return;

    try {
      sessionStorage.setItem(`${SESSION_KEY}:shown`, "1");
    } catch {
      /* ignore */
    }
    recordShow();
    setOpen(true);
  }, []);

  const handleClose = () => {
    markSessionDismissed();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        className="max-w-[min(92vw,440px)] w-full p-0 gap-0 border-0 bg-transparent shadow-none overflow-visible sm:rounded-2xl [&>button]:hidden"
        aria-describedby="sarvam-family-announcement-desc"
      >
        <DialogTitle className="sr-only">
          SnapServe is now part of the Sarvam family
        </DialogTitle>
        <DialogDescription id="sarvam-family-announcement-desc" className="sr-only">
          SnapServe joins Sarvam — India&apos;s Sovereign AI Platform — bringing AI voice
          agents in every Indian language to population scale.
        </DialogDescription>

        <div className="relative rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(30,39,73,0.35)] ring-1 ring-black/5">
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[#1E2749]/70 text-white backdrop-blur-sm hover:bg-[#1E2749] transition-colors cursor-pointer"
            aria-label="Close announcement"
          >
            <X className="h-4 w-4" />
          </button>

          <img
            src={`${import.meta.env.BASE_URL}snapserve-sarvam-family.png`}
            alt="SnapServe is now part of the Sarvam family"
            className="block w-full h-auto select-none"
            draggable={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
