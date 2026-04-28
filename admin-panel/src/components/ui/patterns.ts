/**
 * Shared UI patterns — spacing, surfaces, tables (single source for consistency).
 * Pages import these strings; components compose them.
 */

/** Vertical rhythm between major blocks on a page */
export const pageStackClass = 'space-y-6'

/** Root styles for {@link import('./Card').Card} — keep in sync when tuning the design system */
export const cardRootClass =
  'rounded-xl border border-zinc-800/80 bg-zinc-900/40 shadow-sm shadow-black/20 ring-1 ring-inset ring-white/[0.03] transition-[border-color,box-shadow] duration-200 ease-out'

/** Modal dialog panel (same radius & border language as cards, darker fill) */
export const modalPanelClass =
  'rounded-xl border border-zinc-800/80 bg-zinc-950/95 shadow-2xl shadow-black/50 ring-1 ring-inset ring-white/[0.04]'

/** Standard section header inside a card (title + optional subtitle) */
export const cardSectionHeaderClass =
  'border-b border-zinc-800/80 bg-zinc-950/25 px-5 py-4'

/** Scroll container wrapping a data table */
export const tableScrollClass = 'overflow-x-auto'

/** Base table */
export const tableClass = 'w-full text-left text-sm'

/** Header row — data tables */
export const tableHeadRowClass =
  'border-b border-zinc-800/80 bg-zinc-950/50 text-xs font-medium uppercase tracking-wide text-zinc-500'

/** Compact actions inside table rows (Dashboard accounts) */
export const tableActionButtonClass =
  'h-8 min-w-[9.25rem] shrink-0 justify-center whitespace-nowrap !px-2.5 !py-0 text-xs'

/** Body — row dividers */
export const tableBodyClass = 'divide-y divide-zinc-800/80'

/** Interactive body row */
export const tableRowClass =
  'transition-[background-color] duration-200 ease-out hover:bg-zinc-800/40'

/** Header cell padding */
export const tableCellHeaderClass = 'px-4 py-3 text-left align-middle'

/** Body cell padding */
export const tableCellClass = 'px-4 py-3 align-middle'
