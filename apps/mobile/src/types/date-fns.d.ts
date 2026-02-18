/**
 * Module augmentation for date-fns v3.6.0
 *
 * Some functions (isToday, isTomorrow, isThisWeek, isPast) only ship .d.mts
 * declaration files without corresponding .d.ts files. TypeScript's bundler
 * module resolution resolves `./isToday.js` → `isToday.d.ts` (missing),
 * causing TS2305. This augmentation provides the missing type declarations.
 *
 * The top-level export {} makes this a module so that `declare module`
 * augments rather than replaces the existing date-fns types.
 */
export {};

declare module 'date-fns' {
  export function isToday(date: Date | number | string): boolean;
  export function isTomorrow(date: Date | number | string): boolean;
  export function isThisWeek(
    date: Date | number | string,
    options?: { weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6; locale?: object },
  ): boolean;
  export function isPast(date: Date | number | string): boolean;
}
