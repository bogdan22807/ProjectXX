import type { ButtonHTMLAttributes, ReactNode } from 'react'

const variants = {
  primary:
    'bg-violet-600 text-white hover:bg-violet-500 border border-violet-500/50 shadow-sm shadow-violet-900/30',
  secondary:
    'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700',
  ghost: 'bg-transparent text-zinc-300 hover:bg-zinc-800/80 border border-transparent',
  danger:
    'bg-red-950/80 text-red-200 hover:bg-red-900/80 border border-red-800/60',
} as const

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
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${variants[variant]} ${className}`}
      {...rest}
    />
  )
}
