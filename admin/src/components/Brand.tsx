import clsx from 'clsx'

/** Adele Care horizontal lockup (logo mark + wordmark). */
export function BrandLogo({ className }: { className?: string }) {
  return <img src="/brand/adelecare-lockup.webp" alt="Adele Care" className={clsx('h-8 w-auto select-none', className)} draggable={false} />
}

/** Adele Care "A" loop mark on its own. */
export function BrandMark({ className }: { className?: string }) {
  return <img src="/brand/adelecare-mark.png" alt="" className={clsx('size-8 select-none', className)} draggable={false} />
}
