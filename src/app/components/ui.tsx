// Small building blocks shared by every screen (PLAN-2 §9). Native elements carry the keyboard behavior.

import { useId } from 'react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import type { LinkProps } from 'react-router';
import { GRADES } from '../../shared/catalog';
import type { GradeId } from '../../shared/types';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm' | 'lg';

const VARIANT: Record<Variant, string> = {
  // Dark text on the accent fill. A disabled primary drops the fill so it can't be mistaken for an active one.
  primary:
    'bg-accent text-accent-ink hover:brightness-110 active:brightness-95 disabled:bg-surface-2 disabled:text-ink-3 disabled:border disabled:border-line-2 disabled:hover:brightness-100',
  secondary:
    'bg-surface-2 text-ink border border-line-2 hover:border-ink-3 hover:bg-surface-3 disabled:text-ink-3 disabled:hover:border-line-2 disabled:hover:bg-surface-2',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2 disabled:text-ink-3 disabled:hover:bg-transparent',
  danger: 'bg-transparent text-danger border border-danger/50 hover:bg-danger/10 disabled:text-ink-3 disabled:border-line-2 disabled:hover:bg-transparent',
};
// 40 px is the standard button. Small is 32 and large is 48.
const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-base',
  lg: 'h-12 px-6 text-lg',
};

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-display font-semibold whitespace-nowrap transition disabled:cursor-not-allowed cursor-pointer select-none';

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
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl">{title}</h1>
        {intro && <p className="mt-1 max-w-2xl text-ink-2">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Surface, one line and a top highlight. `interactive` adds corner marks that turn accent on hover and focus. */
export function Panel({
  children,
  className = '',
  as: Tag = 'section',
  marks = false,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'li';
  /** Corner marks that stay in line-2. */
  marks?: boolean;
  interactive?: boolean;
}) {
  const cls = ['hb-panel p-4 sm:p-6', marks || interactive ? 'hb-marks' : '', interactive ? 'hb-interactive' : '', className].filter(Boolean).join(' ');
  return <Tag className={cls}>{children}</Tag>;
}

/** The 1.0 name. */
export const Card = Panel;

export function Kicker({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`hb-kicker ${className}`}>{children}</span>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h2 className="hb-kicker">{children}</h2>
      {aside && <div className="min-w-0 text-sm text-ink-2">{aside}</div>}
    </div>
  );
}

const STAT_SIZE = { md: 'text-xl', lg: 'text-2xl', xl: 'text-3xl' } as const;

/** A label, a number and a line under it. The number is in the display font. */
export function Stat({
  label,
  value,
  sub,
  color,
  size = 'lg',
  delta,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  color?: string;
  size?: keyof typeof STAT_SIZE;
  /** A small change chip next to the number. */
  delta?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-micro uppercase text-ink-3">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className={`font-display ${STAT_SIZE[size]} leading-tight`} style={color ? { color } : undefined}>
          {value}
        </div>
        {delta}
      </div>
      {sub && <div className="text-sm text-ink-2">{sub}</div>}
    </div>
  );
}

/** The hero number: a micro label and a 48 px value. */
export function StatBig(props: Omit<Parameters<typeof Stat>[0], 'size'>) {
  return <Stat {...props} size="xl" />;
}

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line-2',
  accent: 'bg-accent/10 text-accent border-accent/40',
  good: 'bg-accent/10 text-accent border-accent/40',
  warn: 'bg-warn/10 text-warn border-warn/40',
  bad: 'bg-danger/10 text-danger border-danger/40',
};

/** A 22 px pill in micro text. `sentence` keeps normal case for longer notes. */
export function Badge({ tone = 'neutral', children, sentence = false }: { tone?: Tone; children: ReactNode; sentence?: boolean }) {
  return (
    <span
      className={`inline-flex h-[22px] items-center whitespace-nowrap rounded-full border px-2.5 text-micro ${sentence ? 'normal-case tracking-normal' : 'uppercase'} ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
export const Chip = Badge;

/** A change against an earlier value. Positive is accent, negative is warn. */
export function Delta({ value, good }: { value: string; good: boolean | null }) {
  return <Badge tone={good === null ? 'neutral' : good ? 'good' : 'warn'}>{value}</Badge>;
}

const GRADE_COLOR: Record<GradeId, string> = {
  pinpoint: 'var(--color-accent)',
  sharp: 'var(--color-data)',
  clean: 'var(--color-ink)',
  steady: 'var(--color-ink-2)',
  loose: 'var(--color-warn)',
  scattered: 'var(--color-danger)',
};

/** The grade name in the display font, inside reticle corners. `chip` is the small form for lists. */
export function GradeBadge({ grade, size = 'md' }: { grade: GradeId; size?: 'chip' | 'md' | 'lg' }) {
  const label = GRADES.find((g) => g.id === grade)?.label ?? grade;
  const box = size === 'lg' ? 'h-12 px-4 text-2xl' : size === 'chip' ? 'h-6 px-2.5 text-sm' : 'h-8 px-4 text-lg';
  return (
    <span
      className={`hb-marks hb-marks-sm relative inline-flex items-center font-display font-semibold ${box}`}
      style={{ color: GRADE_COLOR[grade], '--mark': 'currentColor' } as CSSProperties}
    >
      {label}
    </span>
  );
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
      {/* 36 by 20. The knob is 14 px with a 2 px margin. */}
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full border border-line-2 bg-surface-3 transition peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:left-0.5 after:top-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-ink-2 after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-accent-ink"
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
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="font-display text-ink-2">
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
        style={{ '--fill': `${fill}%` } as CSSProperties}
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
      <div className="inline-flex flex-wrap gap-0.5 rounded-[18px] border border-line bg-bg-2 p-0.5">
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
            <span className="flex h-7 items-center rounded-[14px] px-3 text-sm text-ink-2 transition hover:text-ink peer-checked:bg-surface-3 peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Tabs for sub-pages. The current one has a 2 px accent underline. */
export function TabNav({ label, tabs }: { label: string; tabs: readonly { to: string; label: string; end: boolean }[] }) {
  return (
    <nav aria-label={label} className="mb-8 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-base transition ${isActive ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
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
