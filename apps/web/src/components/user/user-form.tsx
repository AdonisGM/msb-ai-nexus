import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  REPORTS_TO,
  ROLES,
  SEGMENTS,
  createUser,
  setPassword,
  updateUser,
  type Role,
  type UserRow,
} from '~/api/users'
import { inputBase } from '~/components/ui/form-controls'
import { Modal } from '~/components/ui/modal'
import { Button, cx } from '~/components/ui/primitives'
import { t, tCode, tError } from '~/i18n'
import { ApiError } from '~/api/client'

/** Adding somebody, or correcting their record.
 *
 *  One modal for both, because the fields are the same and the difference is
 *  whether a password is being set. What is *not* the same is the rule set the
 *  server will apply, and most of this file is about not walking somebody into
 *  a refusal: a salesperson must sit under a team lead of their own segment, a
 *  team lead under the branch manager, and the two roles outside the sales
 *  line must have neither.
 *
 *  So the manager list is filtered to the tier and segment the chosen role
 *  actually reports to. The server decides either way — this only stops the
 *  screen offering a choice it knows will be refused. */
export function UserForm({
  open,
  editing,
  people,
  onClose,
}: {
  open: boolean
  editing: UserRow | null
  people: UserRow[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const creating = editing === null

  const [code, setCode] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [role, setRole] = useState<Role>('sale')
  const [segment, setSegment] = useState('')
  const [managerId, setManagerId] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [active, setActive] = useState(true)
  const [password, setPasswordValue] = useState('')
  const [confirm, setConfirm] = useState('')
  const [tried, setTried] = useState(false)

  /** Refilled every time the modal opens on somebody new, so editing one
   *  person never shows another's details for a frame. */
  useEffect(() => {
    if (!open) return
    setTried(false)
    setPasswordValue('')
    setConfirm('')
    setCode(editing?.code ?? '')
    setEmployeeCode(editing?.employeeCode ?? '')
    setName(editing?.name ?? '')
    setTitle(editing?.title ?? '')
    setRole(editing?.role ?? 'sale')
    setSegment(editing?.segment ?? '')
    setManagerId(editing?.managerId ?? '')
    setEmail(editing?.email ?? '')
    setPhone(editing?.phone ?? '')
    setActive(editing?.active ?? true)
  }, [open, editing])

  const wants = REPORTS_TO[role]
  const needsSegment = role === 'sale' || role === 'team_lead'

  /** Only people who can actually hold this person. A salesperson's manager
   *  must be a team lead in the same segment; a team lead's must be the branch
   *  manager. Offering anyone else is offering a 400. */
  const managers = people.filter(
    (person) =>
      person.role === wants &&
      person.active &&
      person.id !== editing?.id &&
      (role !== 'sale' || !segment || person.segment === segment),
  )

  const save = useMutation({
    mutationFn: async () => {
      if (creating) {
        await createUser({
          code,
          employeeCode,
          name: name.trim(),
          title: title.trim(),
          role,
          password,
          segment: needsSegment ? segment : undefined,
          managerId: wants ? managerId : undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
        })
        return
      }

      await updateUser(editing.id, {
        code,
        employeeCode,
        name: name.trim(),
        title: title.trim(),
        role,
        segment: needsSegment ? segment : null,
        managerId: wants ? managerId : null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        active,
      })
      if (password) await setPassword(editing.id, password)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(creating ? 'Đã tạo tài khoản' : 'Đã lưu thay đổi')
      onClose()
    },
    /** The server refuses things this form cannot see: somebody still has
     *  people under them, still holds customers, is the last admin. Those come
     *  back as codes and are shown as sentences rather than swallowed. */
    onError: (error) =>
      toast.error(tError(error instanceof ApiError ? error.message : null)),
  })

  const problem = firstProblem({
    name,
    code,
    employeeCode,
    title,
    needsSegment,
    segment,
    wants,
    managerId,
    creating,
    password,
    confirm,
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      title={creating ? 'Thêm người dùng' : 'Sửa người dùng'}
      subtitle={
        creating
          ? 'Mật khẩu đặt tại đây và đưa tận tay. Hệ thống chưa gửi được email.'
          : (editing?.email ?? editing?.code ?? '')
      }
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="lg"
            variant="primary"
            disabled={save.isPending}
            onClick={() => {
              setTried(true)
              if (!problem) save.mutate()
            }}
          >
            {save.isPending
              ? t('actions.working')
              : creating
                ? 'Tạo tài khoản'
                : 'Lưu thay đổi'}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-3">
        <Field label="Họ tên" required className="flex-[1_1_200px]">
          <input
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="Bắt buộc"
            className={inputBase}
          />
        </Field>
        <Field label="Chức danh" required className="flex-[1_1_200px]">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Chuyên viên khách hàng cá nhân"
            className={inputBase}
          />
        </Field>
      </div>

      {/** Two codes, because they are two things. The login handle is ours to
        *  rename; the staff number is printed on a payslip and is what a bulk
        *  upload of leads matches people by. One box for both would mean an
        *  import silently finding nobody the day a handle changes. */}
      <div className="flex flex-wrap gap-3">
        <Field label="Mã đăng nhập" required className="flex-[1_1_150px]">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="SALE-RB-02"
            className={cx(inputBase, 'font-mono')}
          />
        </Field>
        <Field label="Mã nhân viên" required className="flex-[1_1_150px]">
          <input
            value={employeeCode}
            onChange={(event) => setEmployeeCode(event.target.value.toUpperCase())}
            placeholder="NV0007"
            className={cx(inputBase, 'font-mono')}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <Field label="Email" className="flex-[1_1_200px]">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ten@msb.com.vn"
            className={inputBase}
          />
        </Field>
        <Field label="Số điện thoại" className="flex-[1_1_150px]">
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="09xx xxx xxx"
            className={cx(inputBase, 'font-mono')}
          />
        </Field>
      </div>

      <Field label="Vai trò" required>
        <div className="flex flex-wrap gap-1.5">
          {ROLES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setRole(id)
                /** Changing the role invalidates both, so they clear rather
                 *  than carrying a manager from the wrong tier into the save. */
                setManagerId('')
                if (id === 'bm' || id === 'admin') setSegment('')
              }}
              className={cx(
                'rounded-md border px-2.5 py-1.5 text-[11.5px] transition-colors',
                id === role
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-line2 text-muted hover:text-ink',
              )}
            >
              {t(`role.${id}`)}
            </button>
          ))}
        </div>
      </Field>

      {needsSegment ? (
        <Field label="Phân khúc" required>
          <div className="flex flex-wrap gap-1.5">
            {SEGMENTS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSegment(id)
                  setManagerId('')
                }}
                className={cx(
                  'rounded-md border px-2.5 py-1.5 text-[11.5px] transition-colors',
                  id === segment
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-line2 text-muted hover:text-ink',
                )}
              >
                {t(`segment.${id}`)}
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {wants ? (
        <Field label={`Dưới quyền ${t(`role.${wants}`).toLowerCase()}`} required>
          <select
            value={managerId}
            onChange={(event) => setManagerId(event.target.value)}
            className={cx(inputBase, 'cursor-pointer')}
          >
            <option value="">Chọn người quản lý</option>
            {managers.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name} · {person.code}
              </option>
            ))}
          </select>
          {managers.length === 0 ? (
            <span className="text-[11px] text-[var(--warn)]">
              Chưa có {t(`role.${wants}`).toLowerCase()}
              {role === 'sale' && segment ? ` phân khúc ${tCode('segment', segment)}` : ''} nào
              đang hoạt động. Tạo người đó trước.
            </span>
          ) : null}
        </Field>
      ) : null}

      {!creating ? (
        <Field label="Trạng thái">
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: true, label: 'Đang hoạt động' },
              { value: false, label: 'Đã khoá' },
            ].map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => setActive(option.value)}
                className={cx(
                  'rounded-md border px-2.5 py-1.5 text-[11.5px] transition-colors',
                  option.value === active
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-line2 text-muted hover:text-ink',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-muted">
            Khoá là chặn đăng nhập ngay và huỷ mọi phiên đang mở.
          </span>
        </Field>
      ) : null}

      {/** On a new account this is the password; on an existing one it is a
        *  reset, and leaving it blank changes nothing. Resetting signs that
        *  person out everywhere — which is the point of a reset, and the
        *  reason it sits here rather than behind a quieter control. */}
      <div className="flex flex-col gap-2.5 rounded-[11px] bg-raised p-3">
        <span className="text-[11px] text-muted">
          {creating ? 'Mật khẩu khởi tạo' : 'Đặt lại mật khẩu'}
        </span>
        <div className="flex flex-wrap gap-3">
          <input
            type="password"
            value={password}
            onChange={(event) => setPasswordValue(event.target.value)}
            placeholder={creating ? 'Ít nhất 8 ký tự' : 'Để trống nếu không đổi'}
            className={cx(inputBase, 'flex-[1_1_180px]')}
          />
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="Nhập lại"
            className={cx(inputBase, 'flex-[1_1_150px]')}
          />
        </div>
        <span className="text-[11px] leading-relaxed text-muted">
          {creating
            ? 'Đưa tận tay người dùng. Hệ thống chưa có chức năng gửi email.'
            : 'Đặt lại sẽ huỷ mọi phiên đăng nhập của người này.'}
        </span>
      </div>

      {tried && problem ? (
        <span className="text-[11.5px] text-danger">{problem}</span>
      ) : null}
    </Modal>
  )
}

/** The first thing wrong, in the order somebody fills the form in. One message
 *  rather than a list: a form that lights up six errors at once reads as
 *  broken, and the person fixes them one at a time anyway. */
function firstProblem(input: {
  name: string
  code: string
  employeeCode: string
  title: string
  needsSegment: boolean
  segment: string
  wants: Role | null
  managerId: string
  creating: boolean
  password: string
  confirm: string
}): string | null {
  if (input.name.trim().length < 2) return 'Nhập họ tên đầy đủ.'
  if (!input.title.trim()) return 'Nhập chức danh.'
  if (!/^[A-Z0-9-]+$/.test(input.code)) return 'Mã đăng nhập chỉ gồm chữ hoa, số và dấu gạch.'
  if (!/^[A-Z0-9-]+$/.test(input.employeeCode)) return 'Nhập mã nhân viên.'
  if (input.needsSegment && !input.segment) return 'Chọn phân khúc.'
  if (input.wants && !input.managerId) return 'Chọn người quản lý.'
  if (input.creating && input.password.length < 8) return 'Mật khẩu cần ít nhất 8 ký tự.'
  if (input.password && input.password !== input.confirm) {
    return 'Hai lần nhập mật khẩu chưa khớp.'
  }
  return null
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-[11px] text-muted">
        {label}
        {required ? <span className="ml-1 text-[var(--warn)]">*</span> : null}
      </span>
      {children}
    </label>
  )
}
