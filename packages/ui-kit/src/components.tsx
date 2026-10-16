import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react"

type Variant = "default" | "primary" | "ghost" | "danger"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: "md" | "sm"
  block?: boolean
  loading?: boolean
}

export function Button({ variant = "default", size = "md", block, loading, className, children, disabled, ...rest }: ButtonProps) {
  const cls = [
    "vss-btn",
    variant !== "default" && `vss-btn--${variant}`,
    size === "sm" && "vss-btn--sm",
    block && "vss-btn--block",
    className,
  ]
    .filter(Boolean)
    .join(" ")
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="vss-spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

export interface FieldProps {
  label: ReactNode
  help?: ReactNode
  error?: string | null
  required?: boolean
  recommended?: boolean
  children: (id: string, describedBy: string | undefined) => ReactNode
  counter?: ReactNode
}

/** Label + control + help/error wiring with proper ids (render-prop so any control can be used). */
export function Field({ label, help, error, required, recommended, children, counter }: FieldProps) {
  const id = useId()
  const helpId = `${id}-help`
  const errId = `${id}-err`
  const describedBy = [error ? errId : null, help ? helpId : null].filter(Boolean).join(" ") || undefined
  return (
    <div className="vss-field">
      <div className="vss-row vss-row--between">
        <label className="vss-label" htmlFor={id}>
          {label}
          {required && (
            <span className="vss-required" aria-hidden="true">
              *
            </span>
          )}
          {recommended && !required && <span className="vss-help">(recommended)</span>}
        </label>
        {counter}
      </div>
      {children(id, describedBy)}
      {error && (
        <div id={errId} className="vss-error-text" role="alert">
          {error}
        </div>
      )}
      {help && !error && (
        <div id={helpId} className="vss-help">
          {help}
        </div>
      )}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="vss-input" {...props} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="vss-textarea" {...props} />
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string }>
  placeholder?: string
}

export function Select({ options, placeholder, ...rest }: SelectProps) {
  return (
    <select className="vss-select" {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="vss-check">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  )
}

export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "success" | "warning" | "danger" | "accent"; children: ReactNode; title?: string }) {
  return (
    <span className={`vss-badge${tone !== "neutral" ? ` vss-badge--${tone}` : ""}`} title={title}>
      {children}
    </span>
  )
}

export function Card({ children, title, actions }: { children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="vss-card">
      {(title || actions) && (
        <div className="vss-row vss-row--between">
          {title && <h3 className="vss-section-title">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100)
  return (
    <div className="vss-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="vss-stat">
      <strong style={tone ? { color: `var(--vss-${tone})` } : undefined}>{value}</strong>
      <span className="vss-muted vss-small">{label}</span>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="vss-empty">{children}</div>
}

export function Status({ children }: { children: ReactNode }) {
  return (
    <div className="vss-status" role="status" aria-live="polite">
      {children}
    </div>
  )
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="vss-spinner" role="img" aria-label={label} />
}

export function ColorInput({ label, value, onChange, id }: { label: string; value: string; onChange: (v: string) => void; id?: string }) {
  const autoId = useId()
  const inputId = id ?? autoId
  const isHex = /^#[0-9a-f]{6}$/i.test(value)
  return (
    <div className="vss-field">
      <label className="vss-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="vss-color">
        <input type="color" aria-label={`${label} picker`} value={isHex ? value : "#000000"} onChange={(e) => onChange(e.target.value)} />
        <input id={inputId} className="vss-input vss-mono" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      </div>
    </div>
  )
}

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const id = useId()
  return (
    <div className="vss-backdrop" onClick={onClose}>
      <div
        className="vss-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose()
        }}
      >
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="var(--vss-accent)" />
      <path d="M6 15.5 10 11l3 3 5-6" fill="none" stroke="var(--vss-accent-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="8" r="1.6" fill="var(--vss-accent-text)" />
    </svg>
  )
}

export function confidenceTone(confidence: number): "success" | "warning" | "danger" {
  if (confidence >= 0.7) return "success"
  if (confidence >= 0.5) return "warning"
  return "danger"
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.7) return "High"
  if (confidence >= 0.5) return "Medium"
  return "Low"
}
