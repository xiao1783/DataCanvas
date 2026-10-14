import type { ReactNode } from 'react'
import { maxOf } from '../utils'

/* ------------------------------------------------------------------ *
 * Small building blocks shared by every panel.
 * Keeping them here is what makes the four workspaces look like one product.
 * ------------------------------------------------------------------ */

export function Panel({
  title, kicker, actions, children, className = '', dense,
}: {
  title?: ReactNode
  kicker?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  dense?: boolean
}) {
  return (
    <section className={`panel ${dense ? 'panel-dense' : ''} ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div className="panel-heading">
            {kicker && <span className="kicker">{kicker}</span>}
            {title && <h2>{title}</h2>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Field({
  label, hint, children, className = '',
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Select<T extends string>({
  value, options, onChange, labels, disabled, placeholder,
}: {
  value: T
  options: readonly T[]
  onChange: (value: T) => void
  labels?: (value: T) => string
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <select
      className="control"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {placeholder && value === '' && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {labels ? labels(option) : option}
        </option>
      ))}
    </select>
  )
}

export function TextInput({
  value, onChange, placeholder, disabled, type = 'text',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  type?: 'text' | 'number'
}) {
  return (
    <input
      className="control"
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export function MultiSelect({
  values, options, onChange, height = 168, emptyLabel,
}: {
  values: string[]
  options: string[]
  onChange: (values: string[]) => void
  height?: number
  emptyLabel?: string
}) {
  const toggle = (option: string) => {
    onChange(values.includes(option) ? values.filter((item) => item !== option) : [...values, option])
  }
  if (!options.length) return <div className="multi-empty">{emptyLabel ?? '—'}</div>
  return (
    <div className="multi-select" style={{ maxHeight: height }}>
      {options.map((option) => (
        <label key={option} className={`multi-option ${values.includes(option) ? 'checked' : ''}`}>
          <input type="checkbox" checked={values.includes(option)} onChange={() => toggle(option)} />
          <span>{option}</span>
        </label>
      ))}
    </div>
  )
}

export function Button({
  children, onClick, variant = 'default', disabled, icon, title, type = 'button', className = '',
}: {
  children?: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'subtle'
  disabled?: boolean
  icon?: ReactNode
  title?: string
  type?: 'button' | 'submit'
  className?: string
}) {
  return (
    <button
      type={type}
      className={`button ${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon}
      {children}
    </button>
  )
}

export function IconButton({
  children, onClick, disabled, title, active, className = '',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  active?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  )
}

export function Toggle({
  checked, onChange, label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      <span className="toggle-label">{label}</span>
    </label>
  )
}

export function Chip({
  children, onRemove, tone = 'default', onClick, active,
}: {
  children: ReactNode
  onRemove?: () => void
  tone?: 'default' | 'accent' | 'warn'
  onClick?: () => void
  active?: boolean
}) {
  return (
    <span className={`chip ${tone} ${active ? 'active' : ''}`}>
      <button type="button" className="chip-body" onClick={onClick}>{children}</button>
      {onRemove && (
        <button type="button" className="chip-remove" onClick={onRemove} aria-label="remove">×</button>
      )}
    </span>
  )
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  )
}

export function Modal({
  open, onClose, children, wide,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <button type="button" className="modal-close" onClick={onClose} aria-label="close">×</button>
        {children}
      </div>
    </div>
  )
}

export function Sparkline({ values, tone = 'accent' }: { values: number[]; tone?: 'accent' | 'warn' }) {
  if (!values.length) return null
  const max = maxOf([...values, 1])
  return (
    <div className={`sparkline ${tone}`} aria-hidden="true">
      {values.map((value, index) => (
        <i key={index} style={{ height: `${Math.max(6, (value / max) * 100)}%` }} />
      ))}
    </div>
  )
}

export function Delta({ value }: { value: number }) {
  const tone = value > 0.02 ? 'up' : value < -0.02 ? 'down' : 'flat'
  return <span className={`delta ${tone}`}>{value >= 0 ? '+' : ''}{value.toFixed(2)}</span>
}
