/**
 * Router types
 */
import type { BasePage } from '@/src/pages/BasePage';
import type { PageContext } from '@/src/pages/types';

/**
 * Route path matcher - string for exact match, function for complex matching
 */
export type RoutePathMatcher =
  | string
  | ((pathname: string, query: Record<string, string>) => boolean);

/**
 * Page constructor interface
 */
export interface PageConstructor {
  new (): BasePage;
  createInstance(context: PageContext): Promise<BasePage>;
}

/**
 * Route definition
 */
export interface Route {
  path: RoutePathMatcher;
  page: PageConstructor;
}

/**
 * Routes configuration object
 */
export interface RoutesConfig {
  [key: string]: Route;
}
