/**
 * Storage writes are read-modify-write of whole blobs, so two tabs writing at
 * once silently drop each other's changes. Every lock is therefore global: the
 * background worker hosts the queues, other contexts hold a lock through a
 * runtime port — a closed tab drops its port and releases the lock with it.
 */
import { Logger } from './logger';

const PORT_PREFIX = 'lock:';
/** A stuck or unreachable host must never freeze storage writes. */
const GRANT_TIMEOUT_MS = 10000;

let isHost = false;
const held = new Set<string>();
const waiting = new Map<string, Array<() => void>>();

function acquireHosted(name: string): Promise<() => void> {
  return new Promise((resolve) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const next = waiting.get(name)?.shift();
      if (next) next();
      else held.delete(name);
    };
    const grant = () => {
      held.add(name);
      resolve(release);
    };

    if (held.has(name)) {
      const queue = waiting.get(name) ?? [];
      queue.push(grant);
      waiting.set(name, queue);
    } else {
      grant();
    }
  });
}

/** Call once from the background worker before any storage write. */
export function hostStorageLocks(): void {
  isHost = true;
  browser.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith(PORT_PREFIX)) return;

    let disconnected = false;
    let release: (() => void) | null = null;
    port.onDisconnect.addListener(() => {
      disconnected = true;
      release?.();
    });

    acquireHosted(port.name.slice(PORT_PREFIX.length)).then((releaseFn) => {
      release = releaseFn;
      if (disconnected) releaseFn();
      else port.postMessage('granted');
    });
  });
}

async function withGlobalLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (isHost) {
    const release = await acquireHosted(name);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  let port: Browser.runtime.Port | null = null;
  try {
    port = browser.runtime.connect({ name: PORT_PREFIX + name });
    const activePort = port;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('grant timeout')), GRANT_TIMEOUT_MS);
      activePort.onMessage.addListener((message) => {
        if (message !== 'granted') return;
        clearTimeout(timer);
        resolve();
      });
      activePort.onDisconnect.addListener(() => {
        clearTimeout(timer);
        reject(new Error('lock host disconnected'));
      });
    });
  } catch (error) {
    Logger.warn('lock', `Global lock "${name}" unavailable, writing with local lock only`, error);
    port?.disconnect();
    port = null;
  }

  try {
    return await fn();
  } finally {
    port?.disconnect();
  }
}

export function createLock(name: string) {
  let chain: Promise<void> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const result = chain.catch(() => {}).then(() => withGlobalLock(name, fn));
    chain = result.then(() => {}, () => {});
    return result;
  };
}
