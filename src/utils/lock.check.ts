// Run: pnpm test
import assert from 'node:assert/strict';

type Listener = (...args: unknown[]) => void;
const connectListeners: Listener[] = [];
const noopEvent = { addListener: () => {}, removeListener: () => {} };
const emptyArea = {
  get: async () => ({}),
  set: async () => {},
  remove: async () => {},
  onChanged: noopEvent,
};
// lock.ts pulls in the logger, whose storage item touches these on import.
const extensionApi = {
  runtime: {
    id: 'check',
    onConnect: { addListener: (fn: Listener) => connectListeners.push(fn) },
    onMessage: noopEvent,
  },
  storage: { local: emptyArea, sync: emptyArea, session: emptyArea, onChanged: noopEvent },
};
Object.assign(globalThis, { browser: extensionApi, chrome: extensionApi });

const { createLock, hostStorageLocks } = await import('./lock.ts');
hostStorageLocks();

// Host side of a tab's port; close() is what the host sees when the tab goes away.
function connectTab(name: string) {
  const onDisconnect: Listener[] = [];
  const port = {
    name,
    granted: false,
    postMessage: (message: unknown) => {
      if (message === 'granted') port.granted = true;
    },
    onDisconnect: { addListener: (fn: Listener) => onDisconnect.push(fn) },
    close: () => onDisconnect.forEach((fn) => fn()),
  };
  connectListeners.forEach((fn) => fn(port));
  return port;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Host writes never interleave.
const lockX = createLock('x');
const log: string[] = [];
await Promise.all(
  [1, 2].map((i) =>
    lockX(async () => {
      log.push(`start${i}`);
      await tick();
      log.push(`end${i}`);
    })
  )
);
assert.deepEqual(log, ['start1', 'end1', 'start2', 'end2']);

// A tab holding the lock blocks the host until the tab's port closes.
const tab = connectTab('lock:x');
await tick();
assert.ok(tab.granted);
let hostRan = false;
const hostWrite = lockX(async () => {
  hostRan = true;
});
await tick();
await tick();
assert.ok(!hostRan);
tab.close();
await hostWrite;
assert.ok(hostRan);

// A tab closed while still queued must not keep the lock forever.
const holder = connectTab('lock:y');
const queued = connectTab('lock:y');
await tick();
assert.ok(holder.granted && !queued.granted);
queued.close();
holder.close();
let afterRan = false;
await createLock('y')(async () => {
  afterRan = true;
});
assert.ok(afterRan);

console.log('lock: ok');
