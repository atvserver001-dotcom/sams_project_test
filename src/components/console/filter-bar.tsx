import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
export function FilterBar({
  className,
  children,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div className={cn('console-filter-bar', className)} {...props}>
      {children}
    </div>
  )
}
