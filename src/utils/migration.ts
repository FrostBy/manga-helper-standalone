/**
 * One-shot migration from linear manualMappings + autoMappings → MangaNode graph.
 *
 * Called at extension startup from background.ts. Guarded by a flag so it runs
 * only once per device. Legacy data is NOT wiped — on other devices the user
 * may still be on the old version reading sync:manualMappings. Cleanup of
 * legacy namespaces will happen in a later minor release.
 */
import { storage } from '@wxt-dev/storage';
import { Logger } from './logger';
import { manualMappings, autoMappings } from './storage';
import { addOrMergeSlug, ensureNode, nodeStore, withBatch } from './nodeStorage';
import { isPlatformKey } from './platformKeys';

const FLAG_KEY = 'local:migration.nodesV1Done';
const ATTEMPTS_KEY = 'local:migration.nodesV1Attempts';
const ABANDONED_KEY = 'local:migration.nodesV1Abandoned';
const MAX_ATTEMPTS = 5;

export async function migrateLegacyToNodes(): Promise<void> {
  const done = await storage.getItem<boolean>(FLAG_KEY);
  if (done) return;
  const abandoned = await storage.getItem<boolean>(ABANDONED_KEY);
  if (abandoned) {
    Logger.warn('migration', 'Legacy migration abandoned after repeated failures; skipping');
    return;
  }

  const attempts = (await storage.getItem<number>(ATTEMPTS_KEY)) ?? 0;
  if (attempts >= MAX_ATTEMPTS) {
    await storage.setItem(ABANDONED_KEY, true);
    Logger.error('migration', `Abandoning after ${attempts} failed attempts`);
    return;
  }
  await storage.setItem(ATTEMPTS_KEY, attempts + 1);

  Logger.info('migration', `Running legacy → nodes migration (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
  let imported = 0;

  let skipped = 0;
  try {
   await withBatch(async () => {
    const manualAll = await manualMappings.getAll();
    for (const [source, bySlug] of Object.entries(manualAll)) {
      if (!isPlatformKey(source)) { skipped++; continue; }
      for (const [sourceSlug, byTarget] of Object.entries(bySlug)) {
        for (const [target, value] of Object.entries(byTarget)) {
          if (!isPlatformKey(target)) { skipped++; continue; }
          if (typeof value === 'string') {
            await addOrMergeSlug(source, sourceSlug, target, value, 'manual');
            imported++;
          } else if (value === false) {
            // Legacy manual=false means "user disabled" → new model: disabled[target]=true
            const nodeId = await ensureNode(source, sourceSlug);
            await nodeStore.updateNode(nodeId, (n) => {
              n.disabled[target] = true;
            });
            imported++;
          }
        }
      }
    }

    const autoAll = await autoMappings.getAll();
    const now = Date.now();
    for (const [source, bySlug] of Object.entries(autoAll)) {
      if (!isPlatformKey(source)) { skipped++; continue; }
      for (const [sourceSlug, byTarget] of Object.entries(bySlug)) {
        for (const [target, entry] of Object.entries(byTarget)) {
          if (!isPlatformKey(target)) { skipped++; continue; }
          if (entry.expires < now) continue;
          await addOrMergeSlug(source, sourceSlug, target, entry.value, 'auto');
          imported++;
        }
      }
    }
   });

    await storage.setItem(FLAG_KEY, true);
    Logger.info('migration', `Imported ${imported} legacy mappings into nodes (skipped ${skipped} invalid keys)`);
  } catch (err) {
    Logger.error('migration', 'Failed', err);
    // F5.5 handled elsewhere: retry with attempt counter
  }
}
