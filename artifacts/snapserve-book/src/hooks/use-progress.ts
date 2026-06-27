import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProgressState {
  completedChapters: string[];
  quizAnswers: Record<string, number>;
  markChapterComplete: (slug: string) => void;
  unmarkChapterComplete: (slug: string) => void;
  saveQuizAnswer: (chapterSlug: string, questionIndex: number, answerIndex: number) => void;
  isChapterCompleted: (slug: string) => boolean;
  getModuleProgress: (chapterSlugs: string[]) => { completed: number; total: number; percentage: number };
}

export const useProgressStore = create<ProgressState>()(
  persist(
    (set, get) => ({
      completedChapters: [],
      quizAnswers: {},
      markChapterComplete: (slug) => 
        set((state) => ({
          completedChapters: state.completedChapters.includes(slug)
            ? state.completedChapters
            : [...state.completedChapters, slug],
        })),
      unmarkChapterComplete: (slug) =>
        set((state) => ({
          completedChapters: state.completedChapters.filter((c) => c !== slug),
        })),
      saveQuizAnswer: (chapterSlug, questionIndex, answerIndex) =>
        set((state) => ({
          quizAnswers: {
            ...state.quizAnswers,
            [`${chapterSlug}_${questionIndex}`]: answerIndex,
          },
        })),
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
    }),
    {
      name: 'snapserve-book-progress',
    }
  )
);
