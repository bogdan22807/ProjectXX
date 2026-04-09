import type { ButtonHTMLAttributes, ReactNode } from 'react'

const variants = {
  primary:
    'bg-violet-600 text-white hover:bg-violet-500 active:bg-violet-600 border border-violet-500/50 shadow-sm shadow-violet-900/30 focus-visible:ring-violet-500/55',
  secondary:
    'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 active:bg-zinc-800 border border-zinc-700 hover:border-zinc-600 focus-visible:ring-zinc-500/40',
  ghost:
    'bg-transparent text-zinc-300 hover:bg-zinc-800/80 active:bg-zinc-800/60 border border-transparent focus-visible:ring-zinc-500/35',
  danger:
    'bg-red-950/80 text-red-200 hover:bg-red-900/70 active:bg-red-950 border border-red-800/60 focus-visible:ring-red-500/45',
} as const

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0e14]'

type Variant = keyof typeof variants

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-200 ease-out disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50 ${focusRing} ${variants[variant]} ${className}`}
      {...rest}
    />
  )
}
