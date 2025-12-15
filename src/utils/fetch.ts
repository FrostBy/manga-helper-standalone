/**
 * Fetch utility for content scripts
 * Routes requests through background service worker to bypass CORS
 */

import { Logger } from './logger';

interface FetchResponse<T = unknown> {
  data?: T;
  error?: string;
}

/**
 * Fetch via background script (bypasses CORS)
 * Use this for cross-origin requests from content scripts
 */
export async function bgFetch<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<T | null> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'fetch',
      url,
      options: serializeOptions(options),
    }) as FetchResponse<T>;

    if (response.error) {
      Logger.error('bgFetch', response.error, { url });
      return null;
    }

    return response.data ?? null;
  } catch (error) {
    Logger.error('bgFetch', 'Failed to send message', error);
    return null;
  }
}

/**
 * Serialize RequestInit for message passing
 * Some properties like AbortSignal can't be serialized
 */
function serializeOptions(options?: RequestInit): RequestInit | undefined {
  if (!options) return undefined;

  // Remove non-serializable properties
  const { signal, ...rest } = options;

  // Handle body serialization
  if (rest.body instanceof FormData) {
    // FormData can't be serialized, convert to object
    const formObj: Record<string, string> = {};
    rest.body.forEach((value, key) => {
      formObj[key] = String(value);
    });
    return {
      ...rest,
      body: JSON.stringify(formObj),
      headers: {
        ...rest.headers,
        'Content-Type': 'application/json',
      },
    };
  }

  return rest;
}
