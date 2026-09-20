import type { CSSProperties, ReactNode } from 'react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/* ---------- Chữ và số ---------- */

/** Số tài chính: luôn Roboto, luôn tabular-nums, theo nguyên tắc thiết kế. */
export function Money({
  value,
  size = 'sm',
  tone,
  className,
}: {
  value: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  tone?: string
  className?: string
}) {
  const sizes = {
    xs: 'text-[11px]',
    sm: 'text-[12.5px]',
    md: 'text-[13px] font-medium',
    lg: 'text-[17px] font-medium',
    xl: 'text-[19px] font-medium',
  }
  return (
    <span
      className={cx('num whitespace-nowrap', sizes[size], className)}
      style={tone ? { color: tone } : undefined}
    >
      {value}
    </span>
  )
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono text-[11px] text-muted', className)}>{children}</span>
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('text-[11px] font-medium text-muted', className)}>{children}</span>
  )
}

export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('text-[11px] leading-relaxed text-muted', className)}>{children}</span>
}

/* ---------- Chip ---------- */

export function Chip({
  tone,
  children,
  className,
}: {
  tone: { fg: string; bg: string }
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-[4px] px-2 py-[3px] text-[11px] font-medium whitespace-nowrap',
        className,
      )}
      style={{ color: tone.fg, background: tone.bg }}
    >
      {children}
    </span>
  )
}

/* ---------- Nút ---------- */

type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'link' | 'quiet' | 'dashed' | 'danger'
  size?: 'bare' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
  style?: CSSProperties
  title?: string
  /** Bắt buộc với nút chỉ có biểu tượng: không có nhãn thì trình đọc màn hình
   *  chỉ đọc được chữ "nút". */
  'aria-label'?: string
}

export function Button({
  variant = 'secondary',
  size = 'md',
  children,
  onClick,
  type = 'button',
  disabled,
  className,
  style,
  title,
  'aria-label': ariaLabel,
}: ButtonProps) {
  /** Thang cỡ lấy từ mục Nút bấm của Hệ thống thiết kế: chiều cao, cỡ chữ,
   *  đệm ngang, bo góc. Bo góc chỉ dùng hai bậc 6 và 8 của thang chung. */
  const sizes = {
    /** Không khung, chỉ là chữ bấm được. */
    bare: 'h-auto p-0 text-[12px] rounded-none',
    xs: 'h-6 px-2 text-[11px] rounded-md',
    sm: 'h-7 px-2.5 text-[12px] rounded-md',
    md: 'h-8 px-3 text-[12px] rounded-lg',
    lg: 'h-[38px] px-4 text-[13px] rounded-lg',
    /** Chỉ dùng cho màn đứng một mình: đăng nhập và khởi tạo tài khoản. */
    xl: 'h-[42px] px-4 text-[14px] rounded-lg',
  }
  const variants = {
    primary:
      'bg-accent text-accent-fg border border-accent font-medium hover:opacity-90',
    secondary:
      'bg-surface text-ink border border-line2 font-medium hover:bg-sunken',
    ghost: 'bg-transparent text-ink2 border border-transparent hover:bg-sunken',
    link: 'bg-transparent text-accent border border-transparent font-medium hover:bg-accent-soft',
    quiet: 'bg-transparent text-muted border-none hover:text-ink',
    danger: 'bg-danger text-white border border-danger font-medium hover:opacity-90',
    dashed:
      'bg-transparent text-accent border border-dashed border-line2 font-medium hover:bg-accent-soft',
  }
  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      style={style}
      className={cx(
        /** inline-flex để nút vừa có biểu tượng vừa có chữ mà không chồng
         *  lên nhau. Nút chỉ có chữ nhìn không khác gì trước. */
        'inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        sizes[size],
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}

/* ---------- Card ---------- */

export function Card({
  children,
  className,
  padded = true,
  style,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
  style?: CSSProperties
}) {
  return (
    <div
      style={style}
      className={cx(
        'flex flex-col rounded-xl border border-line bg-surface',
        padded && 'gap-3 p-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardTitle({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="mr-auto text-[13px] font-semibold">{children}</span>
      {action}
    </div>
  )
}

/* ---------- Trạng thái rỗng ---------- */

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-4 text-center">
      <span className="text-[12px] text-muted">{children}</span>
    </div>
  )
}

/* ---------- Ô chỉ số ---------- */

export function Stat({
  label,
  value,
  hint,
  hintTone,
  valueTone,
  size = 'lg',
}: {
  label: string
  value: string
  hint?: string
  hintTone?: string
  valueTone?: string
  size?: 'lg' | 'xl'
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Label>{label}</Label>
      <Money value={value} size={size} tone={valueTone} />
      {hint ? (
        hintTone ? (
          <span className="num text-[11px] font-medium" style={{ color: hintTone }}>
            {hint}
          </span>
        ) : (
          <Caption>{hint}</Caption>
        )
      ) : null}
    </div>
  )
}

/** Dải chỉ số liền khối, dùng ở trang Tổng quan. */
export function StatStrip({
  items,
}: {
  items: Array<{ label: string; value: string; hint?: string; hintTone?: string }>
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      {items.map((it, i) => (
        <div
          key={it.label}
          className={cx('flex flex-col gap-0.5 px-3.5 py-3', i > 0 && 'border-l border-line')}
        >
          <span className="text-[10.5px] font-medium text-muted">{it.label}</span>
          <Money value={it.value} size="lg" className="!text-[18px]" />
          {it.hint ? (
            it.hintTone ? (
              <span className="num text-[11px] font-medium" style={{ color: it.hintTone }}>
                {it.hint}
              </span>
            ) : (
              <Caption>{it.hint}</Caption>
            )
          ) : null}
        </div>
      ))}
    </div>
  )
}

/* ---------- Ô ảnh, thay cho image-slot của bản thiết kế ---------- */

export function ImageSlot({
  width,
  height,
  radius = 8,
  placeholder = 'Kéo ảnh vào đây',
}: {
  width: number | string
  height: number | string
  radius?: number
  placeholder?: string
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 border border-dashed border-line2 bg-sunken px-3 text-center"
      style={{ width, height, borderRadius: radius }}
    >
      <span className="h-4 w-5 rounded-[3px] border-[1.6px] border-muted" />
      <Caption>{placeholder}</Caption>
    </div>
  )
}
