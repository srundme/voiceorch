import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getBookProgress,
  completeBookChapter,
  uncompleteBookChapter,
  saveBookQuizAnswer,
} from '@workspace/api-client-react';
import { getDeviceId } from '@/lib/device-id';

/**
 * Reading progress store.
 *
 * The server (book_progress table, keyed on the anonymous device UUID) is the
 * source of truth. localStorage (via zustand persist) is a write-through cache
 * so the UI is instant and still works offline:
 *   - mutations update local state immediately, then fire-and-forget to the API
 *     and reconcile with the server's authoritative response.
 *   - on startup, initializeProgress() pulls the server row and merges it with
 *     whatever localStorage hydrated, so progress survives a localStorage wipe
 *     (server rehydrates) AND a backend outage (localStorage carries it).
 */
interface ProgressState {
  completedChapters: string[];
  quizAnswers: Record<string, number>;
  hydrated: boolean;
  markChapterComplete: (slug: string) => void;
  unmarkChapterComplete: (slug: string) => void;
  saveQuizAnswer: (chapterSlug: string, questionIndex: number, answerIndex: number) => void;
  isChapterCompleted: (slug: string) => boolean;
  getModuleProgress: (chapterSlugs: string[]) => { completed: number; total: number; percentage: number };
  initializeProgress: () => Promise<void>;
}

export const useProgressStore = create<ProgressState>()(
  persist(
    (set, get) => ({
      completedChapters: [],
      quizAnswers: {},
      hydrated: false,

      markChapterComplete: (slug) => {
        set((state) => ({
          completedChapters: state.completedChapters.includes(slug)
            ? state.completedChapters
            : [...state.completedChapters, slug],
        }));
        void completeBookChapter({ deviceId: getDeviceId(), slug })
          .then((p) =>
            set({ completedChapters: p.completedChapters, quizAnswers: p.quizAnswers }),
          )
          .catch(() => {
            /* offline — localStorage keeps the optimistic value */
          });
      },

      unmarkChapterComplete: (slug) => {
        set((state) => ({
          completedChapters: state.completedChapters.filter((c) => c !== slug),
        }));
        void uncompleteBookChapter({ deviceId: getDeviceId(), slug })
          .then((p) =>
            set({ completedChapters: p.completedChapters, quizAnswers: p.quizAnswers }),
          )
          .catch(() => {
            /* offline — localStorage keeps the optimistic value */
          });
      },

      saveQuizAnswer: (chapterSlug, questionIndex, answerIndex) => {
        const key = `${chapterSlug}_${questionIndex}`;
        set((state) => ({
          quizAnswers: { ...state.quizAnswers, [key]: answerIndex },
        }));
        void saveBookQuizAnswer({ deviceId: getDeviceId(), chapterSlug, questionIndex, answerIndex })
          .then((p) =>
            set({ completedChapters: p.completedChapters, quizAnswers: p.quizAnswers }),
          )
          .catch(() => {
            /* offline — localStorage keeps the optimistic value */
          });
      },

      isChapterCompleted: (slug) => get().completedChapters.includes(slug),

      getModuleProgress: (chapterSlugs) => {
        const completed = chapterSlugs.filter((slug) => get().completedChapters.includes(slug)).length;
        const total = chapterSlugs.length;
        return {
          completed,
          total,
          percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
        };
      },

      initializeProgress: async () => {
        if (get().hydrated) return;
        try {
          const server = await getBookProgress({ deviceId: getDeviceId() });
          set((local) => ({
            // Union so an offline-completed chapter is never visually lost.
            completedChapters: Array.from(
              new Set([...local.completedChapters, ...server.completedChapters]),
            ),
            // Server wins on conflicts, but keep any local-only answers.
            quizAnswers: { ...local.quizAnswers, ...server.quizAnswers },
            hydrated: true,
          }));
        } catch {
          // Backend unavailable — keep whatever persist hydrated from localStorage.
          set({ hydrated: true });
        }
      },
    }),
    {
      name: 'snapserve-book-progress',
      partialize: (s) => ({
        completedChapters: s.completedChapters,
        quizAnswers: s.quizAnswers,
      }),
    },
  ),
);
