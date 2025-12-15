/**
 * MangaLib API registration
 * Imports full implementation and registers with PlatformRegistry
 */
import { mangalibAPI } from '@/src/api/mangalib';
import { PlatformRegistry } from '../PlatformRegistry';

// Register the full implementation
PlatformRegistry.register(mangalibAPI);

// Re-export for convenience
export { mangalibAPI as MangaLibAPI };
