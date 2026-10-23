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
import { comxAPI, ComXAPI } from './comx';
import { allhentaiAPI } from './allhentai';
import { remangaAPI } from './remanga';
import { mangachanAPI } from './mangachan';
import { mangahubAPI } from './mangahub';
import { mangapoiskAPI } from './mangapoisk';
import type { PlatformKey } from '@/src/types';

// Export all API classes
export { BasePlatformAPI } from './base';
export { MangaLibAPI, mangalibAPI } from './mangalib';
export { SenkuroAPI, senkuroAPI } from './senkuro';
export { MangaBuffAPI, mangabuffAPI } from './mangabuff';
export { ReadMangaAPI, readmangaAPI } from './readmanga';
export { InkstoryAPI, inkstoryAPI } from './inkstory';
export { ComXAPI, comxAPI } from './comx';
export { allhentaiAPI } from './allhentai';
export { RemangaAPI, remangaAPI } from './remanga';
export { MangaChanAPI, mangachanAPI } from './mangachan';
export { MangaHubAPI, mangahubAPI } from './mangahub';
export { MangaPoiskAPI, mangapoiskAPI } from './mangapoisk';

/**
 * Map of platform keys to API instances
 */
const apiRegistry: Record<PlatformKey, BasePlatformAPI> = {
  mangalib: mangalibAPI,
  senkuro: senkuroAPI,
  mangabuff: mangabuffAPI,
  readmanga: readmangaAPI,
  inkstory: inkstoryAPI,
  comx: comxAPI,
  allhentai: allhentaiAPI,
  remanga: remangaAPI,
  mangachan: mangachanAPI,
  mangahub: mangahubAPI,
  mangapoisk: mangapoiskAPI,
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
