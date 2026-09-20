import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ROLES, usersQuery, type UserRow } from '~/api/users'
import { UserForm } from '~/components/user/user-form'
import { Button, Card, Chip, cx } from '~/components/ui/primitives'
import { ErrorState, Refreshing, ReloadButton, TableSkeleton } from '~/components/ui/query-state'
import { SearchInput, Toolbar } from '~/components/ui/toolbar'
import { t } from '~/i18n'
import { vnDateTime } from '~/lib/dates'
import { fmtNum, initials } from '~/lib/format'
import { useTableState } from '~/lib/table-state'
import { useDebounced } from '~/lib/use-debounced'

export const Route = createFileRoute('/_app/users')({ component: UsersScreen })

const COLS = 'grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_120px_140px_128px]'

type Filters = { q: string; role: string; active: string }
const EMPTY: Filters = { q: '', role: '', active: '' }

function UsersScreen() {
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()

  const table = useTableState<Filters>(EMPTY, 100)
  const q = useDebounced(table.filters.q)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [creating, setCreating] = useState(false)

  /** The menu already hides this item from everyone else, but hiding a link is
   *  a courtesy rather than a control — somebody can type the path. The server
   *  refuses either way; this is so they are told why instead of watching a
   *  table fail to load. */
  if (user.role !== 'admin') return <NoAccess onLeave={() => void navigate({ to: '/customers' })} />

  const query = useQuery(
    usersQuery({
      q: q || undefined,
      role: table.filters.role || undefined,
      active: table.filters.active === '' ? undefined : table.filters.active === 'true',
    }),
  )

  const summary = query.data?.summary
  const filtered = Object.entries(table.filters).some(
    ([key, value]) => value !== EMPTY[key as keyof Filters],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11.5px] text-muted">Quản trị hệ thống</p>
          <h1 className="mt-0.5 text-[17px] font-semibold tracking-tight">{t('nav.users')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <ReloadButton busy={query.isFetching} onClick={() => void query.refetch()} />
          <Button size="md" variant="primary" onClick={() => setCreating(true)}>
            Thêm người dùng
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Tile label="Tổng tài khoản" value={summary?.total} note="đang có" />
        <Tile label="Đang hoạt động" value={summary?.active} note="đăng nhập được" tone="var(--success)" />
        <Tile label="Đã khoá" value={summary?.locked} note="bị chặn" tone="var(--danger)" />
        <Tile label="Quyền quản trị" value={summary?.admins} note="tài khoản" tone="var(--pending)" />
      </div>

      <Card padded={false}>
        <Toolbar className="p-3.5">
          <SearchInput
            value={table.filters.q}
            onChange={(value) => table.set('q', value)}
            placeholder="Tìm tên, mã nhân viên, email, số điện thoại"
            className="min-w-[190px] flex-1"
          />
          <Picker
            value={table.filters.role}
            onChange={(value) => table.set('role', value)}
            blank="Mọi vai trò"
            options={ROLES.map((id) => ({ value: id, label: t(`role.${id}`) }))}
          />
          <Picker
            value={table.filters.active}
            onChange={(value) => table.set('active', value)}
            blank="Mọi trạng thái"
            options={[
              { value: 'true', label: 'Đang hoạt động' },
              { value: 'false', label: 'Đã khoá' },
            ]}
          />
          {filtered ? (
            <button
              type="button"
              onClick={() => table.reset()}
              className="h-8 cursor-pointer text-[12px] text-muted underline decoration-line2 underline-offset-4 transition-colors hover:text-ink"
            >
              Bỏ lọc
            </button>
          ) : null}
        </Toolbar>
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2.5 px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">Danh sách người dùng</h2>
          {query.data && summary ? (
            <span className="text-[11.5px] text-muted">
              {query.data.rows.length} trên {summary.total} tài khoản
            </span>
          ) : null}
        </div>

        {query.isError ? (
          <div className="p-4 pt-0">
            <ErrorState
              what="danh sách người dùng"
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          </div>
        ) : query.isPending ? (
          <div className="p-4 pt-0">
            <TableSkeleton rows={6} />
          </div>
        ) : (
          <Refreshing busy={query.isFetching}>
            <div className="overflow-x-auto">
              <div className="min-w-[820px]">
                <div
                  className={cx(
                    'grid items-center gap-3 border-y border-line bg-sunken/40 px-4 py-2 text-[11px] text-muted',
                    COLS,
                  )}
                >
                  <span>Người dùng</span>
                  <span>Vai trò và nhóm</span>
                  <span>Trạng thái</span>
                  <span>Đăng nhập gần nhất</span>
                  <span />
                </div>

                {query.data.rows.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 px-4 py-[34px] text-center">
                    <span className="text-[13px]">Không có người dùng nào khớp bộ lọc</span>
                    <span className="text-[12px] text-muted">Bỏ bớt điều kiện rồi thử lại.</span>
                  </div>
                ) : (
                  query.data.rows.map((row) => (
                    <Row key={row.id} row={row} onEdit={() => setEditing(row)} />
                  ))
                )}
              </div>
            </div>

            <div className="border-t border-line bg-raised px-4 py-2.5 text-[11px] text-muted">
              Khoá tài khoản sẽ chặn đăng nhập ngay và huỷ mọi phiên đang mở. Dữ liệu và
              lịch sử vẫn giữ nguyên.
            </div>
          </Refreshing>
        )}
      </Card>

      <UserForm
        open={creating || editing !== null}
        editing={editing}
        people={query.data?.rows ?? []}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />
    </div>
  )
}

function Row({ row, onEdit }: { row: UserRow; onEdit: () => void }) {
  return (
    <div
      className={cx(
        'grid items-center gap-3 border-t border-line px-4 py-2.5 text-[12.5px]',
        COLS,
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-7 flex-none place-items-center rounded-full border border-line2 bg-sunken text-[10.5px] font-semibold text-muted">
          {initials(row.name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium">{row.name}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            {/** Two codes, not one. The login handle is ours to rename; the
              *  staff number is what a bulk upload of leads matches on. */}
            <span className="flex-none rounded-[5px] bg-sunken px-1.5 py-[1px] font-mono text-[10.5px] text-muted">
              {row.code}
            </span>
            <span className="flex-none font-mono text-[10.5px] text-muted">
              {row.employeeCode}
            </span>
            {row.email ? (
              <span className="truncate text-[10.5px] text-muted">{row.email}</span>
            ) : null}
          </span>
        </span>
      </span>

      <span className="flex min-w-0 flex-col gap-0.5">
        <Chip tone={ROLE_TONE[row.role]} className="w-fit">
          {t(`role.${row.role}`)}
        </Chip>
        {row.managerName ? (
          <span className="truncate text-[10.5px] text-muted">Dưới {row.managerName}</span>
        ) : null}
      </span>

      <span className="flex items-center gap-1.5">
        <span
          className="size-[7px] flex-none rounded-full"
          style={{ background: row.active ? 'var(--c-success)' : 'var(--c-danger)' }}
        />
        <span className="text-[12px]">{row.active ? 'Hoạt động' : 'Đã khoá'}</span>
      </span>

      <span className="num text-[11.5px] text-muted">
        {row.lastLoginAt ? vnDateTime(row.lastLoginAt) : 'chưa bao giờ'}
      </span>

      <span className="flex justify-end">
        <Button size="sm" onClick={onEdit}>
          Sửa
        </Button>
      </span>
    </div>
  )
}

/** Four figures about the branch, not about the search box. */
function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value?: number
  note: string
  tone?: string
}) {
  return (
    <div className="flex flex-[1_1_170px] flex-col gap-1 rounded-[14px] border border-line bg-surface px-[15px] py-[13px]">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="num text-[22px] leading-none font-semibold" style={{ color: tone }}>
          {value === undefined ? '—' : fmtNum(value)}
        </span>
        <span className="text-[11px] text-muted">{note}</span>
      </span>
    </div>
  )
}

function NoAccess({ onLeave }: { onLeave: () => void }) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span
          className="grid size-10 place-items-center rounded-[11px]"
          style={{ background: 'var(--danger-soft)' }}
        >
          <span
            className="size-3 rounded-[2px] border-2"
            style={{ borderColor: 'var(--danger)' }}
          />
        </span>
        <span className="text-[14px] font-semibold">Bạn không có quyền vào trang này</span>
        <p className="max-w-[360px] text-[12px] leading-relaxed text-muted">
          Trang quản lý người dùng chỉ dành cho quản trị viên. Liên hệ quản trị nếu bạn
          cần truy cập.
        </p>
        <Button size="md" onClick={onLeave}>
          Về danh sách khách hàng
        </Button>
      </div>
    </Card>
  )
}

const ROLE_TONE: Record<UserRow['role'], { fg: string; bg: string }> = {
  admin: { fg: 'var(--pending)', bg: 'var(--pending-soft)' },
  bm: { fg: 'var(--warn)', bg: 'var(--warn-soft)' },
  team_lead: { fg: 'var(--info)', bg: 'var(--info-soft)' },
  sale: { fg: 'var(--ink2)', bg: 'var(--sunken)' },
}

function Picker({
  value,
  onChange,
  options,
  blank,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  blank: string
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cx(
        'h-8 cursor-pointer rounded-lg border border-line2 bg-surface px-2 text-[12px] outline-none focus:border-accent',
        value ? 'text-ink' : 'text-muted',
      )}
    >
      <option value="">{blank}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
