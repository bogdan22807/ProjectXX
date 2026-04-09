/**
 * Shared UI class strings — spacing, radius, tables, form controls.
 * Keeps Dashboard, Proxies, Profiles, Logs visually aligned without a full design-system refactor.
 */

/** Vertical rhythm for main page content (sections, cards, toolbars) */
export const uiPageStack = 'space-y-8'

/** Primary surface: cards, table shells */
export const uiCardSurface =
  'rounded-xl border border-zinc-800/80 bg-zinc-900/40 shadow-sm shadow-black/20 transition-shadow duration-200 ease-out'

/** Inner padding for card sections (headers, table wrappers) */
export const uiCardHeaderPadding = 'px-5 py-4'
export const uiCardBodyPadding = 'px-5'

/** Data tables — use inside Card with overflow-hidden p-0 */
export const uiTable = 'w-full border-collapse text-left text-sm'

export const uiTableHeadRow =
  'border-b border-zinc-800 bg-zinc-950/50 text-xs font-medium uppercase tracking-wide text-zinc-500'

export const uiTableTh = 'px-4 py-3.5 align-middle first:pl-5 last:pr-5'

export const uiTableBodyRow =
  'border-b border-zinc-800/60 transition-colors duration-150 ease-out hover:bg-zinc-900/50'

export const uiTableTd = 'px-4 py-3 align-middle text-sm first:pl-5 last:pr-5'

export const uiTableCheckbox =
  'rounded border border-zinc-600 bg-zinc-900 text-violet-600 focus:ring-2 focus:ring-violet-500/35 focus:ring-offset-0 focus:ring-offset-[#0c0e14]'

/** Form fields in modals — matches Dashboard AccountFields */
export const uiInputField =
  'mt-1 w-full rounded-lg border border-zinc-700/90 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-[border-color,box-shadow] duration-150 ease-out ' +
  'placeholder:text-zinc-600 hover:border-zinc-600 ' +
  'focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/25 disabled:cursor-not-allowed disabled:opacity-45'

export const uiLabel = 'block text-xs font-medium text-zinc-400'

export const uiFormStack = 'space-y-3'

/** Modal chrome (panel uses same radius as cards) */
export const uiModalPanel =
  'relative z-10 w-full max-w-md rounded-xl border border-zinc-800/80 bg-zinc-950 shadow-2xl shadow-black/50'

export const uiModalHeader =
  'flex items-center justify-between border-b border-zinc-800/80 px-5 py-4'

export const uiModalBody = 'px-5 py-4'

export const uiModalFooter = 'border-t border-zinc-800/80 px-5 py-4'
