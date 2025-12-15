/**
 * API Registry
 * Central access point for all platform APIs
 */

import { BasePlatformAPI } from './base';
import { mangalibAPI, MangaLibAPI } from './mangalib';
import { senkuroAPI, SenkuroAPI } from './senkuro';
import { mangabuffAPI, MangaBuffAPI } from './mangabuff';
import { readmangaAPI, ReadMangaAPI } from './readmanga';
import { inkstoryAPI, InkstoryAPI } from './inkstory';
import type { PlatformKey } from '@/src/types';

// Export all API classes
export { BasePlatformAPI } from './base';
export { MangaLibAPI, mangalibAPI } from './mangalib';
export { SenkuroAPI, senkuroAPI } from './senkuro';
export { MangaBuffAPI, mangabuffAPI } from './mangabuff';
export { ReadMangaAPI, readmangaAPI } from './readmanga';
export { InkstoryAPI, inkstoryAPI } from './inkstory';

/**
 * Map of platform keys to API instances
 */
const apiRegistry: Record<PlatformKey, BasePlatformAPI> = {
  mangalib: mangalibAPI,
  senkuro: senkuroAPI,
  mangabuff: mangabuffAPI,
  readmanga: readmangaAPI,
  inkstory: inkstoryAPI,
};

/**
 * Get API instance by platform key
 */
export function getAPI(platform: PlatformKey): BasePlatformAPI {
  return apiRegistry[platform];
}

/**
 * Get all registered platform keys
 */
export function getPlatformKeys(): PlatformKey[] {
  return Object.keys(apiRegistry) as PlatformKey[];
}

/**
 * Get all registered APIs
 */
export function getAllAPIs(): Record<PlatformKey, BasePlatformAPI> {
  return apiRegistry;
}

/**
 * Check if platform is supported
 */
export function isPlatformSupported(platform: string): platform is PlatformKey {
  return platform in apiRegistry;
}
