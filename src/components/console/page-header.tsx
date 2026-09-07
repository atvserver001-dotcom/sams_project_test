import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: string
  eyebrow?: string
  description?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('console-page-header', className)}>
      <div className="console-page-heading">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-bold text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1>{title}</h1>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="console-page-header-actions">{actions}</div>
      )}
    </header>
  )
}
