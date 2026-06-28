import { create } from "zustand";
import { persist } from "zustand/middleware";

interface BookmarksState {
  bookmarked: string[];
  toggleBookmark: (slug: string) => void;
  isBookmarked: (slug: string) => boolean;
}

export const useBookmarksStore = create<BookmarksState>()(
  persist(
    (set, get) => ({
      bookmarked: [],

      toggleBookmark: (slug) => {
        set((state) => ({
          bookmarked: state.bookmarked.includes(slug)
            ? state.bookmarked.filter((s) => s !== slug)
            : [...state.bookmarked, slug],
        }));
      },

      isBookmarked: (slug) => get().bookmarked.includes(slug),
    }),
    {
      name: "snapserve-book-bookmarks",
    },
  ),
);
