/**
 * Centralized logging system
 * Log level controlled via extension popup or @wxt-dev/storage
 */

import { storage } from '@wxt-dev/storage';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 999,
}

// Typed storage item for log level (exported for popup)
export const logLevelItem = storage.defineItem<LogLevel>('local:manga-helper-log-level', {
  fallback: LogLevel.INFO,
});

let currentLevel: LogLevel = LogLevel.INFO;

/**
 * Initialize logger - read level from extension storage
 */
export async function initLogger(): Promise<void> {
  // Load from extension storage
  currentLevel = await logLevelItem.getValue();

  // Listen for log level changes from popup
  try {
    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'setLogLevel' && typeof message.level === 'number') {
        setLogLevel(message.level);
      }
    });
  } catch {
    // Message API not available
  }

  Logger.info('Logger', `Initialized, level: ${LogLevel[currentLevel]}`);
}

/**
 * Set log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
  Logger.info('Logger', `Level changed to: ${LogLevel[level]}`);
}

/**
 * Logger with colored output and timestamps
 */
export const Logger = {
  debug(context: string, message: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.DEBUG) {
      log('DEBUG', context, message, args, 'color: #6c757d');
    }
  },

  info(context: string, message: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.INFO) {
      log('INFO', context, message, args, 'color: #0d6efd');
    }
  },

  warn(context: string, message: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.WARN) {
      log('WARN', context, message, args, 'color: #ffc107');
    }
  },

  error(context: string, message: string, error?: unknown): void {
    if (currentLevel <= LogLevel.ERROR) {
      log('ERROR', context, message, error ? [error] : [], 'color: #dc3545; font-weight: bold');
    }
  },
};

function log(
  level: string,
  context: string,
  message: string,
  args: unknown[],
  style: string
): void {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
  const prefix = `%c[${timestamp}] [${level}] [${context}]`;

  if (args.length > 0 && args[0] !== undefined) {
    console.log(prefix, style, message, ...args);
  } else {
    console.log(prefix, style, message);
  }
}
