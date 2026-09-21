import { useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Brain, FileText, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { Button, Card, Chip, cx } from '~/components/ui/primitives'
import { SegmentedControl } from '~/components/ui/segmented'

export const Route = createFileRoute('/_app/tia/settings')({ component: TiaSettingsScreen })

/** Where Tia's working knowledge is kept: the documents it consults when it
 *  advises, and what it remembers about the person using it.
 *
 *  **Interface only, for now.** Nothing here reaches the server: files and
 *  memories live in this screen's state and are gone on reload, and the model
 *  does not read them yet. The banner says so on both tabs, because a
 *  settings page that looks finished is exactly where somebody uploads the
 *  new fee schedule and assumes Tia is quoting it. */

type Tab = 'docs' | 'memory'

const NEUTRAL = { fg: 'var(--muted)', bg: 'var(--sunken)' }

type Category = 'policy' | 'product' | 'fees' | 'process' | 'other'

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: 'policy', label: 'Chính sách' },
  { id: 'product', label: 'Sản phẩm' },
  { id: 'fees', label: 'Biểu phí' },
  { id: 'process', label: 'Quy trình' },
  { id: 'other', label: 'Khác' },
]

type Doc = {
  id: string
  name: string
  category: Category
  size: number
  uploadedBy: string
  uploadedAt: string
  /** Whether Tia may consult it. Off keeps an old version on file without
   *  it being quoted. */
  active: boolean
  example?: boolean
}

type Memory = {
  id: string
  text: string
  source: 'you' | 'tia'
  /** The conversation Tia learnt it in, when it was Tia. */
  from?: string
  at: string
  example?: boolean
}

const SEED_DOCS: Doc[] = [
  {
    id: 'ex-1',
    name: 'Biểu phí dịch vụ thẻ 2026.pdf',
    category: 'fees',
    size: 842_000,
    uploadedBy: 'Quản trị viên',
    uploadedAt: '2026-09-02',
    active: true,
    example: true,
  },
  {
    id: 'ex-2',
    name: 'Chính sách cho vay SME quý 3-2026.pdf',
    category: 'policy',
    size: 1_930_000,
    uploadedBy: 'Giám đốc đơn vị',
    uploadedAt: '2026-07-01',
    active: true,
    example: true,
  },
  {
    id: 'ex-3',
    name: 'Chính sách cho vay SME quý 2-2026.pdf',
    category: 'policy',
    size: 1_870_000,
    uploadedBy: 'Giám đốc đơn vị',
    uploadedAt: '2026-04-01',
    active: false,
    example: true,
  },
]

const SEED_MEMORIES: Memory[] = [
  {
    id: 'mx-1',
    text: 'Ưu tiên trả lời bằng bảng khi so sánh số liệu giữa các tháng.',
    source: 'you',
    at: '2026-09-18',
    example: true,
  },
  {
    id: 'mx-2',
    text: 'Phụ trách chủ yếu khách doanh nghiệp nhỏ ngành thép, xây dựng.',
    source: 'tia',
    from: 'Khách ngành thép cần vay vốn lưu động',
    at: '2026-09-20',
    example: true,
  },
]

function TiaSettingsScreen() {
  const { user } = Route.useRouteContext()
  const [tab, setTab] = useState<Tab>('docs')

  /** The branch's reference documents are shared by everybody in it, so only
   *  the people who answer for them change them. Everyone can see what Tia is
   *  reading from. */
  const canManageDocs = user.role === 'bm' || user.role === 'admin'

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/tia"
        className="flex w-fit items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} />
        Trò chuyện với Tia
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[19px] font-semibold tracking-tight">Tài liệu & ghi nhớ</h1>
          <p className="max-w-[620px] text-[12.5px] text-muted">
            Những gì Tia dựa vào khi tư vấn: tài liệu tham khảo của chi nhánh, và những điều Tia
            nhớ về cách bạn làm việc.
          </p>
        </div>
        <SegmentedControl<Tab>
          size="md"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'docs', label: 'Tài liệu tham khảo' },
            { id: 'memory', label: 'Ghi nhớ' },
          ]}
        />
      </div>

      <PreviewBanner />

      {tab === 'docs' ? <Documents canManage={canManageDocs} /> : <Memories />}
    </div>
  )
}

function PreviewBanner() {
  return (
    <div
      className="rounded-[10px] border px-3.5 py-2.5 text-[12px] leading-relaxed"
      style={{ borderColor: 'var(--warn)', background: 'var(--warn-soft)', color: 'var(--warn)' }}
    >
      <strong className="font-semibold">Bản xem trước giao diện.</strong> Tệp và ghi nhớ ở đây chưa
      được lưu lên máy chủ và Tia chưa dùng tới — tải lại trang là mất. Các dòng gắn nhãn “Ví dụ” chỉ
      để minh hoạ.
    </div>
  )
}

/* ───────────────────────────── Documents ───────────────────────────── */

function Documents({ canManage }: { canManage: boolean }) {
  const [docs, setDocs] = useState<Doc[]>(SEED_DOCS)
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const add = (files: File[]) => {
    const today = new Date().toISOString().slice(0, 10)
    setDocs((was) => [
      ...files.map((file) => ({
        id: `local-${file.name}-${file.size}-${Math.random()}`,
        name: file.name,
        category: guessCategory(file.name),
        size: file.size,
        uploadedBy: 'Bạn',
        uploadedAt: today,
        active: true,
      })),
      ...was,
    ])
  }

  const shown = filter === 'all' ? docs : docs.filter((doc) => doc.category === filter)
  const activeCount = docs.filter((doc) => doc.active).length

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="mr-auto flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold">Tài liệu tham khảo của chi nhánh</span>
          <span className="text-[11.5px] text-muted">
            {docs.length} tài liệu · Tia đang dùng {activeCount}
          </span>
        </div>
        {canManage ? (
          <>
            <Button variant="primary" onClick={() => picker.current?.click()}>
              <Upload size={13} />
              Tải tài liệu lên
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              accept="application/pdf,text/plain,.txt,.md"
              className="hidden"
              onChange={(event) => {
                add([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
        {[{ id: 'all' as const, label: 'Tất cả' }, ...CATEGORIES].map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={cx(
              'h-[26px] cursor-pointer rounded-full border px-2.5 text-[11.5px] transition-colors',
              filter === option.id
                ? 'border-line2 bg-sunken text-ink'
                : 'border-transparent text-muted hover:text-ink2',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {canManage ? (
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            add([...event.dataTransfer.files])
          }}
          className={cx(
            'mx-4 mt-3 flex flex-col items-center gap-1 rounded-[10px] border border-dashed px-4 py-5 text-center transition-colors',
            dragging ? 'border-[var(--accent)] bg-accent-soft' : 'border-line2',
          )}
        >
          <Upload size={18} className="text-muted" />
          <span className="text-[12.5px] text-ink2">Kéo thả PDF hoặc tệp văn bản vào đây</span>
          <span className="text-[11px] text-muted">
            Chính sách, biểu phí, thông tin sản phẩm, quy trình — Tia trích dẫn đúng trang khi tư
            vấn
          </span>
        </div>
      ) : null}

      <div className="flex flex-col px-2 py-2">
        {shown.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted">Chưa có tài liệu nào ở mục này.</p>
        ) : (
          shown.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              canManage={canManage}
              onChange={(next) =>
                setDocs((was) => was.map((one) => (one.id === doc.id ? next : one)))
              }
              onRemove={() => setDocs((was) => was.filter((one) => one.id !== doc.id))}
            />
          ))
        )}
      </div>

      {!canManage ? (
        <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
          Tài liệu dùng chung cho cả chi nhánh. Chỉ giám đốc đơn vị và quản trị viên thêm hoặc gỡ
          được.
        </p>
      ) : null}
    </Card>
  )
}

function DocRow({
  doc,
  canManage,
  onChange,
  onRemove,
}: {
  doc: Doc
  canManage: boolean
  onChange: (next: Doc) => void
  onRemove: () => void
}) {
  return (
    <div className="group flex flex-wrap items-center gap-3 rounded-[8px] px-2 py-2.5 hover:bg-sunken">
      <FileText size={18} className={cx('flex-none', doc.active ? 'text-ink2' : 'text-muted')} />

      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <span className={cx('flex items-center gap-2 text-[12.5px]', !doc.active && 'text-muted')}>
          <span className="truncate">{doc.name}</span>
          {doc.example ? <Chip tone={NEUTRAL}>Ví dụ</Chip> : null}
        </span>
        <span className="text-[11px] text-muted">
          {bytes(doc.size)} · {doc.uploadedBy} · {dmy(doc.uploadedAt)}
        </span>
      </div>

      {canManage ? (
        <select
          value={doc.category}
          onChange={(event) => onChange({ ...doc, category: event.target.value as Category })}
          aria-label="Loại tài liệu"
          className="h-7 cursor-pointer rounded-md border border-line2 bg-surface px-2 text-[11.5px] text-ink2"
        >
          {CATEGORIES.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
      ) : (
        <Chip tone={NEUTRAL}>
          {CATEGORIES.find((category) => category.id === doc.category)?.label}
        </Chip>
      )}

      <Toggle
        on={doc.active}
        disabled={!canManage}
        label={doc.active ? 'Tia đang dùng' : 'Tạm ngừng'}
        onChange={(active) => onChange({ ...doc, active })}
      />

      {canManage ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Gỡ ${doc.name}`}
          className="grid size-7 flex-none cursor-pointer place-items-center rounded-[6px] text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus:opacity-100"
        >
          <Trash2 size={14} />
        </button>
      ) : null}
    </div>
  )
}

/* ───────────────────────────── Memories ───────────────────────────── */

function Memories() {
  const [items, setItems] = useState<Memory[]>(SEED_MEMORIES)
  const [learning, setLearning] = useState(true)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const add = () => {
    const text = draft.trim()
    if (!text) return
    setItems((was) => [
      { id: `local-${Date.now()}`, text, source: 'you', at: new Date().toISOString().slice(0, 10) },
      ...was,
    ])
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <Brain size={18} className="mt-0.5 flex-none text-ink2" />
          <div className="mr-auto flex min-w-[240px] flex-1 flex-col gap-0.5">
            <span className="text-[13px] font-semibold">Cho phép Tia tự ghi nhớ</span>
            <span className="text-[12px] text-muted">
              Khi bật, Tia ghi lại những điều hữu ích về cách bạn làm việc trong lúc trò chuyện —
              luôn hiện ở đây để bạn sửa hoặc xoá. Chỉ bạn thấy, chỉ áp dụng cho các cuộc trò chuyện
              của bạn.
            </span>
          </div>
          <Toggle on={learning} onChange={setLearning} label={learning ? 'Đang bật' : 'Đang tắt'} />
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="mr-auto flex flex-col gap-0.5">
            <span className="text-[13px] font-semibold">Tia đang nhớ</span>
            <span className="text-[11.5px] text-muted">{items.length} điều</span>
          </div>
          {items.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setItems([])}>
              Xoá toàn bộ
            </Button>
          ) : null}
        </div>

        <div className="flex gap-2 border-b border-line px-4 py-3">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add()
            }}
            placeholder="Thêm một điều Tia nên nhớ, ví dụ: “Gọi khách vào buổi chiều”"
            className="h-8 min-w-0 flex-1 rounded-lg border border-line2 bg-sunken px-3 text-[12.5px] text-ink outline-none focus:border-[var(--accent)]"
          />
          <Button variant="secondary" onClick={add} disabled={draft.trim() === ''}>
            <Plus size={13} />
            Thêm
          </Button>
        </div>

        <div className="flex flex-col px-2 py-2">
          {items.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-muted">
              Tia chưa nhớ gì về bạn. Thêm ở trên, hoặc bật tự ghi nhớ.
            </p>
          ) : (
            items.map((item) => (
              <MemoryRow
                key={item.id}
                item={item}
                editing={editing === item.id}
                onEdit={() => setEditing(item.id)}
                onSave={(text) => {
                  setItems((was) => was.map((one) => (one.id === item.id ? { ...one, text } : one)))
                  setEditing(null)
                }}
                onCancel={() => setEditing(null)}
                onRemove={() => setItems((was) => was.filter((one) => one.id !== item.id))}
              />
            ))
          )}
        </div>
      </Card>
    </div>
  )
}

function MemoryRow({
  item,
  editing,
  onEdit,
  onSave,
  onCancel,
  onRemove,
}: {
  item: Memory
  editing: boolean
  onEdit: () => void
  onSave: (text: string) => void
  onCancel: () => void
  onRemove: () => void
}) {
  const [text, setText] = useState(item.text)

  return (
    <div className="group flex items-start gap-3 rounded-[8px] px-2 py-2.5 hover:bg-sunken">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && text.trim()) onSave(text.trim())
                if (event.key === 'Escape') onCancel()
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-line2 bg-surface px-2 text-[12.5px] outline-none focus:border-[var(--accent)]"
            />
            <Button size="sm" variant="primary" onClick={() => text.trim() && onSave(text.trim())}>
              Lưu
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Huỷ
            </Button>
          </div>
        ) : (
          <span className="flex items-center gap-2 text-[12.5px] text-ink">
            <span className="text-pretty">{item.text}</span>
            {item.example ? <Chip tone={NEUTRAL}>Ví dụ</Chip> : null}
          </span>
        )}
        <span className="text-[11px] text-muted">
          {item.source === 'you' ? 'Bạn thêm' : `Tia ghi từ “${item.from}”`} · {dmy(item.at)}
        </span>
      </div>

      {!editing ? (
        <div className="flex flex-none gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Sửa ghi nhớ"
            className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted hover:text-ink"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Xoá ghi nhớ"
            className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ) : null}
    </div>
  )
}

/* ───────────────────────────── Parts ───────────────────────────── */

function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex flex-none cursor-pointer items-center gap-2 disabled:cursor-default"
    >
      <span
        className={cx(
          'relative h-[18px] w-8 rounded-full transition-colors',
          on ? 'bg-accent' : 'bg-line2',
        )}
      >
        <span
          className={cx(
            'absolute top-[2px] size-[14px] rounded-full bg-surface transition-[left]',
            on ? 'left-[16px]' : 'left-[2px]',
          )}
        />
      </span>
      <span className="w-[86px] text-left text-[11.5px] text-muted">{label}</span>
    </button>
  )
}

/** A first guess from the file name, so a fee schedule does not land in
 *  "Khác" and wait for somebody to notice. The person can change it. */
function guessCategory(name: string): Category {
  const lower = name.toLowerCase()
  if (/biểu phí|bieu phi|phí|fee/.test(lower)) return 'fees'
  if (/chính sách|chinh sach|policy/.test(lower)) return 'policy'
  if (/quy trình|quy trinh|process|hướng dẫn/.test(lower)) return 'process'
  if (/sản phẩm|san pham|product|thẻ|vay|bảo hiểm/.test(lower)) return 'product'
  return 'other'
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function dmy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
