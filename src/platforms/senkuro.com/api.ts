/**
 * Senkuro API registration
 * Imports full implementation and registers with PlatformRegistry
 */
import { senkuroAPI } from '@/src/api/senkuro';
import { PlatformRegistry } from '../PlatformRegistry';

// Register the full implementation
PlatformRegistry.register(senkuroAPI);

// Re-export for convenience
export { senkuroAPI as SenkuroAPI };
