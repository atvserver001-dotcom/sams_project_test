'use client'

import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type RecordSelectProps = {
  value: string | number
  onValueChange: (value: string) => void
  children: ReactNode
  className?: string
  id?: string
  name?: string
  disabled?: boolean
  'aria-label': string
}

// Keep the existing option lists and their values when moving record filters to Select.
export function RecordSelect({
  value, onValueChange, children, className, id, name, disabled, 'aria-label': label,
}: RecordSelectProps) {
  const emptyValue = '__record_empty__'
  return (
    <Select
      value={String(value) || emptyValue}
      onValueChange={(next) => onValueChange(next === emptyValue ? '' : next)}
      name={name}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Children.toArray(children).map((child) => {
          if (!isValidElement<ComponentProps<'option'>>(child)) return null
          const optionValue = String(child.props.value ?? '') || emptyValue
          return (
            <SelectItem key={optionValue} value={optionValue} disabled={child.props.disabled}>
              {child.props.children}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
