/**
 * Zustand store for current manga page state
 */
import { create } from 'zustand';
import type { ChaptersResponse, PlatformKey } from '@/src/types';

interface MangaState {
  // Current manga data (from current platform)
  titles: string[];
  chapters: ChaptersResponse | null;
  lastChapterRead: number;
  freeChapters: number; // chapters without paywall

  // UI state
  isModalOpen: boolean;
  modalPlatform: PlatformKey | null;
  modalUrl: string;
  hasNewChapters: boolean;

  // Actions
  setMangaData: (data: {
    titles: string[];
    chapters: ChaptersResponse | null;
    lastChapterRead: number;
    freeChapters: number;
  }) => void;
  openModal: (platform: PlatformKey, url: string) => void;
  closeModal: () => void;
  setHasNewChapters: (value: boolean) => void;
  reset: () => void;
}

const initialState = {
  titles: [],
  chapters: null,
  lastChapterRead: 0,
  freeChapters: 0,
  isModalOpen: false,
  modalPlatform: null,
  modalUrl: '',
  hasNewChapters: false,
};

export const useMangaStore = create<MangaState>((set) => ({
  ...initialState,

  setMangaData: ({ titles, chapters, lastChapterRead, freeChapters }) => {
    set({ titles, chapters, lastChapterRead, freeChapters });
  },

  openModal: (platform, url) => {
    set({
      isModalOpen: true,
      modalPlatform: platform,
      modalUrl: url,
    });
  },

  closeModal: () => {
    set({
      isModalOpen: false,
      modalPlatform: null,
      modalUrl: '',
    });
  },

  setHasNewChapters: (value) => {
    set({ hasNewChapters: value });
  },

  reset: () => {
    set(initialState);
  },
}));
