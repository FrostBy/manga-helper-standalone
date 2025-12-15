/**
 * MangaBuff API registration
 * Imports full implementation and registers with PlatformRegistry
 */
import { mangabuffAPI } from '@/src/api/mangabuff';
import { PlatformRegistry } from '../PlatformRegistry';

// Register the full implementation
PlatformRegistry.register(mangabuffAPI);

// Re-export for convenience
export { mangabuffAPI as MangaBuffAPI };
