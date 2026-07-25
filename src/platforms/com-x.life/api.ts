/**
 * com-x.life API registration
 * Imports full implementation and registers with PlatformRegistry
 */
import { comxAPI } from '@/src/api/comx';
import { PlatformRegistry } from '../PlatformRegistry';

// Register the full implementation
PlatformRegistry.register(comxAPI);

// Re-export for convenience
export { comxAPI as ComXAPI };
