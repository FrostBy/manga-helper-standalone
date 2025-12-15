/**
 * ReadManga API registration
 * Imports full implementation and registers with PlatformRegistry
 */
import { readmangaAPI } from '@/src/api/readmanga';
import { PlatformRegistry } from '../PlatformRegistry';

// Register the full implementation
PlatformRegistry.register(readmangaAPI);

// Re-export for convenience
export { readmangaAPI as ReadMangaAPI };
