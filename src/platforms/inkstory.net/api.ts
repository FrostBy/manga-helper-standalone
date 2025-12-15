/**
 * Inkstory API registration
 * Imports full implementation and registers with PlatformRegistry
 */
import { inkstoryAPI } from '@/src/api/inkstory';
import { PlatformRegistry } from '../PlatformRegistry';

// Register the full implementation
PlatformRegistry.register(inkstoryAPI);

// Re-export for convenience
export { inkstoryAPI as InkstoryAPI };
