/**
 * Core types for manga-helper
 */

// ============================================
// Domain Types
// ============================================

/**
 * Single manga chapter
 */
export interface Chapter {
  id?: string | number;
  number: number;
  title?: string;
  volume?: number;
  createdAt?: string;
  [key: string]: unknown; // Platform-specific fields
}

/**
 * Chapters response from API
 */
export interface ChaptersResponse {
  data: Chapter[];
  [key: string]: unknown; // Platform-specific metadata
}

/**
 * Manga metadata
 */
export interface Manga {
  slug?: string;
  name: string;
  rus_name?: string;
  eng_name?: string;
  otherNames?: string[];
  cover?: string;
  description?: string;
  status?: string;
  [key: string]: unknown; // Platform-specific fields
}

/**
 * User's reading progress/bookmark
 */
export interface Bookmark {
  chapter: number;
  lastChapterRead?: number;
  [key: string]: unknown; // Platform-specific fields
}

// ============================================
// Storage Types
// ============================================

/**
 * Stored mapping value: slug or false (not found)
 */
export type MappingValue = string | false;

/**
 * Mapping between platforms (slug on one → slug on another, or false if not found)
 */
export interface PlatformMapping {
  [targetPlatform: string]: MappingValue;
}

/**
 * Auto-mapping entry with TTL
 */
export interface AutoMappingEntry {
  value: MappingValue;
  expires: number;
}

/**
 * Auto-mappings for one slug (with TTL)
 */
export interface AutoPlatformMapping {
  [targetPlatform: string]: AutoMappingEntry;
}

/**
 * All auto-mappings for one slug on a platform
 */
export interface AutoSlugMappings {
  [slug: string]: AutoPlatformMapping;
}

/**
 * All auto-mappings by platform (with TTL)
 */
export interface AllAutoMappings {
  [platform: string]: AutoSlugMappings;
}

/**
 * All mappings for one slug on a platform
 */
export interface SlugMappings {
  [slug: string]: PlatformMapping;
}

/**
 * All mappings by platform
 */
export interface AllMappings {
  [platform: string]: SlugMappings;
}

/**
 * Source of the slug mapping
 */
export type SlugSource = 'manual' | 'auto' | 'none';

/**
 * Search result from platform API
 */
export interface SearchResult {
  platform: string;
  platformKey: PlatformKey;
  url: string;
  slug: string;
  chapter: number;        // max available chapter
  lastChapterRead: number; // last chapter user read
}

/**
 * Cached platform data (with TTL)
 * Stored by target platform: senkuro/van-pis → { chapter, lastChapterRead }
 */
export interface CachedPlatformData {
  chapter: number;        // max available chapter
  lastChapterRead: number; // last chapter user read
  expires: number;
}

/**
 * Cache by slug on target platform
 */
export interface PlatformCache {
  [slug: string]: CachedPlatformData;
}

/**
 * All cache by target platform
 * Structure: targetPlatform → targetSlug → CachedPlatformData
 */
export interface AllCache {
  [targetPlatform: string]: PlatformCache;
}

/**
 * Structure of chrome.storage.sync
 */
export interface SyncStorage {
  manual: AllMappings; // user-defined links
  settings: {
    // future settings
  };
}

/**
 * Structure of chrome.storage.local
 */
export interface LocalStorage {
  auto: AllMappings; // auto-discovered links
  cache: AllCache; // data with TTL
}

/**
 * Supported platforms
 */
export type PlatformKey =
  | 'mangalib'
  | 'senkuro'
  | 'mangabuff'
  | 'readmanga'
  | 'inkstory';

/**
 * Platform config
 */
export interface PlatformConfig {
  key: PlatformKey;
  domain: string;
  title: string;
  color?: string;
}
