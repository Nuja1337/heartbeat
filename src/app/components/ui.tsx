// Small building blocks shared by every screen. Native elements carry the keyboard behavior.

import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Link } from 'react-router';
import type { LinkProps } from 'react-router';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 font-semibold',
  secondary: 'bg-surface-2 text-ink border border-line-2 hover:border-ink-3',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
  danger: 'bg-transparent text-miss border border-miss/50 hover:bg-miss/10',
};
const SIZE: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-sm',
  md: 'px-4 py-2',
  lg: 'px-6 py-3 text-lg',
};

const base = 'inline-flex items-center justify-center gap-2 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none';

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', extra = ''): string {
  return `${base} ${VARIANT[variant]} ${SIZE[size]} ${extra}`;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function PageHeader({ title, intro, actions }: { title: string; intro?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {intro && <p className="mt-1 text-ink-2">{intro}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ children, className = '', as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={`rounded-lg border border-line bg-surface p-4 ${className}`}>{children}</Tag>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">{children}</h2>
      {aside && <div className="text-sm text-ink-2">{aside}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wider text-ink-2">{label}</div>
      <div className="text-2xl font-semibold leading-tight" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="text-sm text-ink-2">{sub}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line-2',
  accent: 'bg-accent/10 text-accent border-accent/40',
  good: 'bg-solid/10 text-solid border-solid/40',
  warn: 'bg-rough/10 text-rough border-rough/40',
  bad: 'bg-miss/10 text-miss border-miss/40',
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}

export function Notice({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${TONE[tone]}`}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------- controls */

export function Toggle({
  label,
  checked,
  onChange,
  help,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  help?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex items-start justify-between gap-4 py-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span className="min-w-0">
        <span className="block">{label}</span>
        {help && <span className="block text-sm text-ink-2">{help}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-line-2 transition peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-ink after:transition peer-checked:after:translate-x-5 peer-checked:after:bg-accent-ink"
      />
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
  help,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(v: number): void;
  format?(v: number): string;
  help?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="text-ink-2">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={help ? helpId : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {help && (
        <p id={helpId} className="text-sm text-ink-2">
          {help}
        </p>
      )}
    </div>
  );
}

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** A row of radio buttons drawn as a segmented control. Arrow keys move between options. */
export function Segmented<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  className = '',
}: {
  legend: string;
  options: SegmentedOption<NoInfer<T>>[];
  value: T;
  onChange(v: NoInfer<T>): void;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={`min-w-0 border-0 p-0 ${className}`}>
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-bg p-1">
        {options.map((o) => (
          <label key={String(o.value)} className={o.disabled ? 'opacity-40' : 'cursor-pointer'}>
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              checked={o.value === value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
            />
            <span className="block rounded-md px-3 py-1.5 text-sm text-ink-2 transition hover:text-ink peer-checked:bg-surface-2 peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <div className="py-2">
      <div className="mb-1 text-sm text-ink-2">{label}</div>
      {children}
      {help && <p className="mt-1 text-sm text-ink-2">{help}</p>}
    </div>
  );
}

/** Ellipsis-safe key name from a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}
