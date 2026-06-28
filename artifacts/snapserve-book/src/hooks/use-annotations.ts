import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Annotation {
  id: string;
  chapterSlug: string;
  text: string;         // highlighted/noted text
  note: string;         // user's note
  createdAt: string;    // ISO timestamp
  color: "yellow" | "blue" | "green" | "pink";
}

interface AnnotationsState {
  annotations: Annotation[];
  addAnnotation: (ann: Omit<Annotation, "id" | "createdAt">) => void;
  updateAnnotation: (id: string, note: string) => void;
  deleteAnnotation: (id: string) => void;
  getAnnotationsForChapter: (slug: string) => Annotation[];
}

export const useAnnotationsStore = create<AnnotationsState>()(
  persist(
    (set, get) => ({
      annotations: [],

      addAnnotation: (ann) => {
        const newAnn: Annotation = {
          ...ann,
          id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ annotations: [...state.annotations, newAnn] }));
      },

      updateAnnotation: (id, note) => {
        set((state) => ({
          annotations: state.annotations.map((a) =>
            a.id === id ? { ...a, note } : a,
          ),
        }));
      },

      deleteAnnotation: (id) => {
        set((state) => ({
          annotations: state.annotations.filter((a) => a.id !== id),
        }));
      },

      getAnnotationsForChapter: (slug) =>
        get().annotations.filter((a) => a.chapterSlug === slug),
    }),
    {
      name: "snapserve-book-annotations",
    },
  ),
);
