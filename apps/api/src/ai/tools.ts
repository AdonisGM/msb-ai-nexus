import { ForbiddenException } from '@nestjs/common'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { CustomersService } from '../customers/customers.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { ReportsService } from '../reports/reports.service'
import { SignalsService } from '../signals/signals.service'
import { TargetsService } from '../targets/targets.service'
import { UsersService, type TreeNode } from '../users/users.service'
import {
  BLOCKER_CODES,
  OUTCOMES,
  PRODUCTS,
  SEGMENTS,
  STAGES,
  type User,
} from '../db/schema'

/** What the assistant may reach for.
 *
 *  Two rules hold this file together.
 *
 *  **The signed-in person is not an argument.** Every tool closes over `user`
 *  and hands it to the same service the HTTP layer calls, so `customerScope`
 *  and `opportunityScope` apply exactly as they do to a request. If the person
 *  were a field in the input schema, the model would be the thing choosing
 *  whose book to open, and one wrong guess is a salesperson reading a
 *  colleague's customers. It is out of reach on purpose.
 *
 *  **Small tools, not clever ones.** Seventeen narrow tools rather than four
 *  that take a mode flag: a model composes a search and a fetch far more
 *  reliably than it fills in a discriminated union, and every one of these is
 *  a method that already exists and is already tested.
 *
 *  Three of them — `whoami`, `today`, `list_codes` — touch almost no data and
 *  exist to remove the three ways an assistant usually goes wrong: assuming
 *  who it is working for, guessing what today's date is, and inventing a
 *  product code that is not in the enum. */

/** How a tool's result should be drawn, when the screen has a component for
 *  it. `null` means the answer is prose and the model will say it. */
export type Renderer =
  | 'funnel.ring'
  | 'trend.monthly'
  | 'breakdown.bars'
  | 'table.opportunities'
  | 'table.customers'
  | 'table.owners'
  | 'table.teams'
  | 'card.customer'
  | 'card.opportunity'
  | 'timeline.signals'
  | 'timeline.history'
  | 'card.signal'
  | 'choices'
  | null

/** `auto` runs on sight; `ask` stops and waits for a person.
 *
 *  Every read is `auto` — the scope has already decided what this person may
 *  see, and asking permission to read what you are allowed to read is
 *  ceremony. Every write is `ask`. */
export type Risk = 'auto' | 'ask'

export type ToolMeta = {
  risk: Risk
  renderer: Renderer
  /** Left out of the request until the model goes looking for it.
   *
   *  Measured, not guessed: the eleven tools carrying a date range, a filter
   *  set or a write schema cost between 350 and 650 tokens each, while the ten
   *  narrow ones cost under a hundred together. Deferring the cheap ones would
   *  buy nothing and cost a search; deferring the heavy situational ones takes
   *  roughly 3,800 tokens off every request that does not need them.
   *
   *  What stays loaded is what nearly every conversation opens with: who am I,
   *  what is today, and the two searches. */
  deferred?: boolean
}

/** Declared beside the tools rather than on them, because `betaZodTool`
 *  carries the SDK's shape and nothing of ours. The chat service reads this to
 *  decide whether to run a call or park it, and the web reads it to decide
 *  what to draw. */
export const TOOL_META: Record<string, ToolMeta> = {
  whoami: { risk: 'auto', renderer: null },
  today: { risk: 'auto', renderer: null },
  list_codes: { risk: 'auto', renderer: null },
  get_org_tree: { risk: 'auto', renderer: null },
  /** Not a read and not a write — a question, drawn as buttons. `auto`
   *  because nothing happens when it runs; the person is the next actor
   *  either way. */
  ask_choice: { risk: 'auto', renderer: 'choices' },
  get_targets: { risk: 'auto', renderer: null },

  search_customers: { risk: 'auto', renderer: 'table.customers' },
  get_customer: { risk: 'auto', renderer: 'card.customer' },
  get_customer_signals: { risk: 'auto', renderer: 'timeline.signals' },
  list_customer_facets: { risk: 'auto', renderer: null },

  search_opportunities: { risk: 'auto', renderer: 'table.opportunities' },
  get_opportunity: { risk: 'auto', renderer: 'card.opportunity' },
  get_opportunity_history: { risk: 'auto', renderer: 'timeline.history' },

  get_funnel: { deferred: true, risk: 'auto', renderer: 'funnel.ring' },
  get_monthly: { deferred: true, risk: 'auto', renderer: 'trend.monthly' },
  get_breakdown: { deferred: true, risk: 'auto', renderer: 'breakdown.bars' },
  get_by_owner: { deferred: true, risk: 'auto', renderer: 'table.owners' },
  get_by_team: { deferred: true, risk: 'auto', renderer: 'table.teams' },
  get_forecast: { deferred: true, risk: 'auto', renderer: null },
  get_attention: { deferred: true, risk: 'auto', renderer: 'table.opportunities' },

  /** Every write waits for a person. Not because the model cannot be trusted
   *  with the arguments — the services would refuse anything out of scope
   *  anyway — but because somebody has to own the entry that lands in the
   *  customer's file with their name on it. */
  record_signal: { deferred: true, risk: 'ask', renderer: 'card.signal' },
  draft_opportunity: { deferred: true, risk: 'ask', renderer: 'card.opportunity' },
  set_next_action: { deferred: true, risk: 'ask', renderer: 'card.opportunity' },
  update_lead_fields: { deferred: true, risk: 'ask', renderer: 'card.opportunity' },
}

/** Whether this person may change a record at all.
 *
 *  The branch manager reads figures and never touches one — the business's
 *  rule, mirrored on the web in `lib/can.ts` and enforced on every HTTP write
 *  by `@Roles('sale', 'team_lead')`.
 *
 *  It has to be repeated here because the assistant does not go through a
 *  controller. `runApproved` calls the service method directly, and the
 *  services check *scope* — may this person see this customer — not role. A
 *  branch manager can see every customer in their unit, so without this line
 *  the assistant would happily write a signal into a customer file that the
 *  API would have refused with a 403. The guard belongs in both places: the
 *  tool list, so the model is never offered it, and `runApproved`, because an
 *  approval arrives in a later request than the one that proposed it.
 *
 *  The admin keeps the write tools. They pass every role gate on the server
 *  too — a technical account that still lands in the audit trail. */
export function mayWrite(user: User): boolean {
  return user.role !== 'bm'
}

export function metaOf(name: string): ToolMeta {
  /** An unknown name is treated as the most cautious thing it could be. The
   *  runner should never see one — the tools come from this file — but a
   *  default of `auto` would turn a future mistake into a silent write. */
  return TOOL_META[name] ?? { risk: 'ask', renderer: null }
}

/** What a tool actually returned, handed to the caller as it happens.
 *
 *  The model only ever sees JSON text, but the screen needs the object — a
 *  chart in the chat is drawn from this, never from something the model typed.
 *  Recording it here rather than after the fact also means the persistence and
 *  the timing sit in one place instead of in seventeen. */
export type ToolSink = (call: {
  name: string
  input: unknown
  result: unknown
  ms: number
  failed: boolean
}) => void

export type Services = {
  customers: CustomersService
  opportunities: OpportunitiesService
  signals: SignalsService
  reports: ReportsService
  users: UsersService
  targets: TargetsService
}

/* ──────────────────────────── Shared shapes ─────────────────────────────── */

/** A window and a slice, reused by every report tool so the model learns one
 *  shape instead of five. */
const RangeInput = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Ngày bắt đầu, YYYY-MM-DD. Bỏ trống là từ đầu.'),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Ngày kết thúc, YYYY-MM-DD. Gọi today trước nếu cần biết hôm nay.'),
  segment: z.enum(SEGMENTS).optional().describe('sse = doanh nghiệp nhỏ, rb = cá nhân'),
  ownerId: z
    .string()
    .optional()
    .describe('Chỉ tính sổ của một nhân viên. Id dạng usr_… từ whoami hoặc get_org_tree.'),
})

/** Turns whatever the model called somebody into the id the services want.
 *
 *  One person carries three identifiers, and `whoami` hands back all three:
 *  `usr_sale_rb_01`, the login code `SALE-RB-01`, and the payroll number
 *  `NV0006`. The model picks the wrong one often enough to matter, and the
 *  failure is invisible — an unknown `ownerId` is not an error anywhere
 *  downstream, it simply matches no rows. The turn then ends by telling a
 *  salesperson they have no open leads when they have thirty.
 *
 *  So take any of the three, and a name when it is unambiguous. Anything else
 *  throws, which `read` hands back as a readable error the model can act on —
 *  far better than an empty page it will believe.
 *
 *  Scoped to the caller's own branch because `tree` is: an id from somewhere
 *  else does not resolve here, and the services would refuse it anyway. */
function ownerResolver(users: UsersService, user: User) {
  /** One read per turn at most. `buildTools` is already per request, so the
   *  cache cannot outlive the person it was built for. */
  let loading: Promise<TreeNode[]> | null = null

  const flatten = (nodes: TreeNode[]): TreeNode[] =>
    nodes.flatMap((node) => [node, ...flatten(node.reports)])

  return async (value?: string): Promise<string | undefined> => {
    if (!value) return undefined

    loading ??= users.tree(user)
    const people = flatten(await loading)
    const want = value.trim().toLowerCase()

    const byId = people.find((person) =>
      [person.id, person.code, person.employeeCode].some((key) => key?.toLowerCase() === want),
    )
    if (byId) return byId.id

    /** A name only when exactly one person answers to it. Two Hảis in a branch
     *  is ordinary, and picking either would be a wrong answer wearing the
     *  shape of a right one. */
    const byName = people.filter((person) => person.name.toLowerCase() === want)
    if (byName.length === 1) return byName[0].id

    throw new Error(
      byName.length > 1
        ? `Có ${byName.length} người tên "${value}" trong chi nhánh. Gọi get_org_tree rồi dùng id.`
        : `Không có ai ứng với "${value}". Nhận id (usr_…), mã đăng nhập (SALE-…) ` +
          `hoặc mã nhân viên (NV…). Gọi get_org_tree để lấy danh sách.`,
    )
  }
}

/** How many rows a tool may hand back.
 *
 *  Small, because every row goes into the next request and is paid for again
 *  on every turn after that. The model is told the true total, so it can say
 *  "còn 340 nữa" instead of believing it has seen everything. */
const PAGE = { default: 10, max: 25 }

function pageInput() {
  return {
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(PAGE.max).optional(),
  }
}

/** Trims a page down to what is worth spending context on. */
function trimPage<T, R>(
  page: { rows: T[]; total: number; page: number; pageSize: number },
  row: (value: T) => R,
) {
  return {
    total: page.total,
    page: page.page,
    shown: page.rows.length,
    rows: page.rows.map(row),
    /** Said in words rather than left for the model to work out from three
     *  numbers, because when it works it out wrong it reports a figure.
     *
     *  Worded as what *this tool call* returned, never as what the person is
     *  looking at. "Đang xem 10 trong tổng 12" came back out of the model as
     *  "đang hiện 10" to a user whose screen showed nothing at all — the note
     *  is addressed to the model, and it has to read that way. */
    note:
      page.total > page.rows.length
        ? `Tool này trả về ${page.rows.length} dòng đầu trong tổng ${page.total}. ` +
          `Người dùng CHƯA thấy dòng nào — muốn họ thấy thì phải viết ra. ` +
          `Cần thêm thì gọi lại với page cao hơn.`
        : `Tool này trả về đủ cả ${page.total} dòng. Người dùng chưa thấy dòng nào.`,
  }
}

/* ────────────────────────────── The tools ───────────────────────────────── */

/** Built per request. Never a singleton: `user` lives in these closures, and a
 *  shared instance would either leak one person's scope into another's thread
 *  or force the caller to pass an id the model could tamper with. */
export function buildTools(services: Services, user: User, sink: ToolSink = () => {}) {
  const { customers, opportunities, signals, reports, users, targets } = services
  const ownerIdOf = ownerResolver(users, user)

  /** One wrapper for every tool below.
   *
   *  The SDK wants a string back, so the object is serialised here — once,
   *  rather than in each `run`. A tool that throws is reported to the model as
   *  a failed result instead of ending the turn: a mistyped id should let it
   *  try again, not kill the conversation. */
  function read<S extends z.ZodType>(spec: {
    name: string
    description: string
    inputSchema: S
    run: (input: z.infer<S>) => Promise<unknown>
  }) {
    return betaZodTool({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      run: async (input: z.infer<S>) => {
        const started = Date.now()
        try {
          const result = await spec.run(input)
          sink({ name: spec.name, input, result, ms: Date.now() - started, failed: false })
          return JSON.stringify(result)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const result = { error: message }
          sink({ name: spec.name, input, result, ms: Date.now() - started, failed: true })
          return JSON.stringify(result)
        }
      },
    })
  }
  /** A tool that writes.
   *
   *  It does not write. It records what it was asked to do and hands the model
   *  back a note saying a person has been asked — the turn then ends with a
   *  card on the screen showing the exact arguments, and nothing has touched
   *  the branch's data.
   *
   *  The real work happens later, in `ChatService.decide`, through this same
   *  service and this same `user`, so the scope is re-checked at the moment it
   *  runs rather than at the moment it was proposed. Minutes can pass in
   *  between, and a lead can change hands in them.
   *
   *  Refusing here rather than in a UI dialog is the point: a dialog is a
   *  courtesy that a crafted request walks straight past. */
  function ask<S extends z.ZodType>(spec: {
    name: string
    description: string
    inputSchema: S
  }) {
    return betaZodTool({
      name: spec.name,
      description: `${spec.description}

GỌI TOOL NÀY CHÍNH LÀ CÁCH BẠN XIN PHÉP. Tool không ghi gì ngay — hệ thống sẽ hiện một thẻ duyệt kèm đúng tham số bạn điền, và người dùng bấm Duyệt hoặc Từ chối.

Đừng mô tả bằng lời rồi chờ người dùng gõ "đồng ý". Làm vậy là không có gì được ghi lại và không có thẻ nào hiện ra. Cứ gọi tool với tham số tốt nhất bạn có.`,
      inputSchema: spec.inputSchema,
      run: async (input: z.infer<S>) => {
        sink({ name: spec.name, input, result: null, ms: 0, failed: false })
        return JSON.stringify({
          status: 'pending_approval',
          note:
            'Đã gửi đề xuất cho người dùng duyệt. Chưa có gì được ghi. ' +
            'Hãy nói ngắn gọn bạn vừa đề xuất gì và dừng lại chờ họ quyết định.',
        })
      },
    })
  }


  /** A person who may not write is not shown the four write tools at all,
   *  rather than being allowed to propose something that fails on approval.
   *  A model that cannot see a tool cannot offer it, which is a better
   *  experience than a card that turns into an error when it is pressed. */
  const writable = mayWrite(user)

  return [
    /* ── Who, when, and what the words mean ───────────────────────────── */

    read({
      name: 'whoami',
      description:
        'Người đang dùng trợ lý: tên, vai trò, phân khúc, cấp trên. Gọi trước khi ' +
        'suy đoán bất cứ điều gì về phạm vi dữ liệu người này thấy được.',
      inputSchema: z.object({}),
      run: async () => ({
        id: user.id,
        name: user.name,
        code: user.code,
        employeeCode: user.employeeCode,
        role: user.role,
        title: user.title,
        segment: user.segment,
        managerId: user.managerId,
        scope:
          user.role === 'sale'
            ? 'Chỉ thấy khách hàng và cơ hội của chính mình.'
            : user.role === 'team_lead'
              ? 'Thấy sổ của cả nhóm mình phụ trách.'
              : user.role === 'bm'
                ? 'Thấy toàn đơn vị, nhưng không sửa được bản ghi nào.'
                : 'Quản trị hệ thống.',
      }),
    }),

    read({
      name: 'today',
      description:
        'Hôm nay là ngày nào, và mốc đầu/cuối của tháng, quý, năm hiện tại. ' +
        'Gọi tool này trước khi dùng bất kỳ tham số ngày nào — đừng tự đoán.',
      inputSchema: z.object({}),
      run: async () => {
        const now = new Date()
        /** Formatted from the local date parts, never through `toISOString`.
         *  UTC is seven hours behind here, so midnight on the first of the
         *  month converts to the last day of the month before it — and the
         *  assistant would filter a month that has not started yet. */
        const iso = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate(),
          ).padStart(2, '0')}`
        const y = now.getFullYear()
        const m = now.getMonth()
        const q = Math.floor(m / 3)

        return {
          today: iso(now),
          thisMonth: { from: iso(new Date(y, m, 1)), to: iso(now) },
          thisQuarter: { from: iso(new Date(y, q * 3, 1)), to: iso(now) },
          thisYear: { from: iso(new Date(y, 0, 1)), to: iso(now) },
          lastMonth: { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
          note: 'Mọi kỳ đều tính đến hôm nay, không tính đến hết kỳ.',
        }
      },
    }),

    read({
      name: 'list_codes',
      description:
        'Toàn bộ mã hợp lệ của hệ thống: sản phẩm, điểm vướng, bước xử lý, kết quả, ' +
        'phân khúc. Dùng để lọc cho đúng thay vì đoán mã.',
      inputSchema: z.object({}),
      run: async () => ({
        products: PRODUCTS,
        blockerCodes: BLOCKER_CODES,
        stages: STAGES,
        outcomes: OUTCOMES,
        segments: SEGMENTS,
        note:
          'stage là bước đã đi tới (new → contacted → advised). outcome là kết cục ' +
          '(open/won/lost). Hai thứ độc lập: một lead có thể won từ bước contacted.',
      }),
    }),

    read({
      name: 'ask_choice',
      description:
        'CÁCH DUY NHẤT để hỏi lại người dùng. Bất cứ khi nào bạn định kết thúc lượt bằng ' +
        'một câu hỏi — "bạn muốn xem gì?", "ý bạn là khách nào?", "cần tôi làm gì?" — hãy ' +
        'gọi tool này thay vì viết câu hỏi đó ra.\n\n' +
        'Giao diện hiện `question` và các `label` thành nút bấm. Vì vậy:\n' +
        '- ĐỪNG viết câu hỏi bằng chữ trước khi gọi tool — nó sẽ hiện hai lần.\n' +
        '- ĐỪNG viết gì thêm sau khi gọi tool. Không "bạn chọn giúp nhé", không tóm tắt ' +
        'lại lựa chọn. Lượt của bạn kết thúc ngay tại tool này.\n\n' +
        'Mỗi lựa chọn: `label` là chữ trên nút (ngắn, 2-6 từ), `ask` là câu hỏi đầy đủ sẽ ' +
        'được gửi đi khi bấm.',
      inputSchema: z.object({
        question: z.string().min(1).max(200).describe('Câu hỏi lại, một câu'),
        options: z
          .array(
            z.object({
              label: z.string().min(1).max(40),
              ask: z.string().min(1).max(200),
            }),
          )
          .min(2)
          .max(4),
      }),
      /** Returns its own input: the screen draws the buttons from the stored
       *  result, so what is rendered is exactly what the model asked for. */
      run: async (input) => ({
        ...input,
        note:
          'Đã hiện câu hỏi và các nút bấm cho người dùng. KẾT THÚC LƯỢT TẠI ĐÂY — ' +
          'không viết thêm câu nào nữa, kể cả một lời mời chọn. Họ đã thấy nút rồi.',
      }),
    }),

    read({
      name: 'get_org_tree',
      description:
        'Sơ đồ tổ chức của chi nhánh: giám đốc, trưởng nhóm, nhân viên và ai báo cáo ai. ' +
        'Dùng để lấy id khi cần lọc theo một người cụ thể.',
      inputSchema: z.object({}),
      run: async () => users.tree(user),
    }),

    read({
      name: 'get_targets',
      description: 'Chỉ tiêu chi nhánh đang được đo: tỷ lệ chuyển đổi và giá trị.',
      inputSchema: z.object({
        period: z.string().optional().describe('Ví dụ 2026-Q3. Bỏ trống là mọi kỳ.'),
      }),
      run: async (input) => targets.list(user, input.period ? { period: input.period } : {}),
    }),

    /* ── Khách hàng ───────────────────────────────────────────────────── */

    read({
      name: 'search_customers',
      description:
        'Tìm khách hàng trong phạm vi người dùng được xem. Mọi tham số đều không bắt buộc.',
      inputSchema: z.object({
        q: z.string().optional().describe('Tìm theo tên hoặc mã khách hàng'),
        segment: z.enum(SEGMENTS).optional(),
        ownerId: z.string().optional(),
        relationStage: z.string().optional().describe('Lấy giá trị hợp lệ từ list_customer_facets'),
        product: z.string().optional().describe('Sản phẩm khách đang dùng, từ list_customer_facets'),
        hasLead: z
          .enum(['untouched', 'open', 'won', 'lost'])
          .optional()
          .describe('Có ít nhất một cơ hội đang ở trạng thái này'),
        ...pageInput(),
      }),
      run: async (input) => {
        const page = await customers.list(user, {
          ...input,
          ownerId: await ownerIdOf(input.ownerId),
          pageSize: input.pageSize ?? PAGE.default,
        })
        return {
          ...trimPage(page, (row) => ({
            id: row.id,
            code: row.code,
            name: row.name,
            segment: row.segment,
            ownerName: row.ownerName,
            relationStage: row.relationStage,
            revenue: row.revenue,
            leads: row.leads,
            lastSignalAt: row.lastSignalAt,
          })),
          summary: page.summary,
        }
      },
    }),

    read({
      name: 'get_customer',
      description:
        'Hồ sơ đầy đủ một khách hàng: thuộc tính, sản phẩm đang dùng, người phụ trách, ' +
        'tình trạng cơ hội.',
      inputSchema: z.object({ customerId: z.string() }),
      run: async (input) => customers.get(user, input.customerId),
    }),

    read({
      name: 'get_customer_signals',
      description:
        'Dòng thời gian tín hiệu của một khách hàng — những gì nhân viên quan sát và ghi lại. ' +
        'Đây là nguồn duy nhất để dẫn chứng khi đưa ra nhận định về khách.',
      inputSchema: z.object({
        customerId: z.string(),
        type: z.string().optional().describe('Lọc theo loại tín hiệu, xem list_codes'),
      }),
      run: async (input) =>
        signals.list(user, input.customerId, input.type ? { type: input.type } : {}),
    }),

    read({
      name: 'list_customer_facets',
      description:
        'Các giá trị có thật đang được dùng cho "giai đoạn quan hệ" và "sản phẩm đang dùng". ' +
        'Hai trường này là text tự do nên phải lấy từ đây thay vì đoán.',
      inputSchema: z.object({}),
      run: async () => customers.facets(user),
    }),

    /* ── Cơ hội ───────────────────────────────────────────────────────── */

    read({
      name: 'search_opportunities',
      description:
        'Tìm cơ hội trong phạm vi người dùng được xem. Dùng các cờ overdue/untouched/' +
        'awaitingConfirm để lấy đúng hàng chờ cần xử lý.',
      inputSchema: z.object({
        q: z.string().optional(),
        customerId: z.string().optional(),
        ownerId: z.string().optional(),
        segment: z.enum(SEGMENTS).optional(),
        stage: z.enum(STAGES).optional(),
        outcome: z.enum(OUTCOMES).optional(),
        product: z.enum(PRODUCTS).optional(),
        blockerCode: z.enum(BLOCKER_CODES).optional(),
        overdue: z.boolean().optional().describe('Đang mở và đã quá hạn xử lý'),
        untouched: z.boolean().optional().describe('Đang mở và chưa ai liên hệ lần nào'),
        awaitingConfirm: z.boolean().optional().describe('Đã chốt nhưng trưởng nhóm chưa đối chiếu'),
        staleDays: z.number().int().min(1).optional().describe('Đang mở và im lặng quá N ngày'),
        sort: z.enum(['due', 'stale', 'value', 'recent']).optional(),
        ...pageInput(),
      }),
      run: async (input) => {
        const page = await opportunities.list(user, {
          ...input,
          ownerId: await ownerIdOf(input.ownerId),
          pageSize: input.pageSize ?? PAGE.default,
        })
        return trimPage(page, (row) => ({
          id: row.id,
          code: row.code,
          customerName: row.customerName,
          ownerName: row.ownerName,
          product: row.product,
          need: row.need,
          value: row.value,
          stage: row.stage,
          outcome: row.outcome,
          blockerCode: row.blockerCode,
          nextAction: row.nextAction,
          dueDate: row.dueDate,
          lastTouchAt: row.lastTouchAt,
        }))
      },
    }),

    read({
      name: 'get_opportunity',
      description: 'Chi tiết một cơ hội, gồm sản phẩm đã bán nếu đã chốt.',
      inputSchema: z.object({ opportunityId: z.string() }),
      run: async (input) => opportunities.get(user, input.opportunityId),
    }),

    read({
      name: 'get_opportunity_history',
      description:
        'Vết xử lý của một cơ hội: từng bước, ai làm, lúc nào, và chờ bao lâu kể từ bước ' +
        'trước. Dùng khi cần biết vì sao một cơ hội chậm.',
      inputSchema: z.object({ opportunityId: z.string() }),
      run: async (input) => opportunities.history(user, input.opportunityId),
    }),

    /* ── Số liệu ──────────────────────────────────────────────────────── */

    read({
      name: 'get_funnel',
      description:
        'Tổng hợp phễu: số lead, đã tiếp cận, đã tư vấn, chốt, thất bại, tỷ lệ chuyển đổi ' +
        'so ngưỡng, còn thiếu bao nhiêu deal, và bước rơi nhiều nhất. Kèm cách chia lead ' +
        'thành 5 phần không chồng nhau.',
      inputSchema: RangeInput,
      run: async (input) =>
        reports.funnel(user, { ...input, ownerId: await ownerIdOf(input.ownerId) }),
    }),

    read({
      name: 'get_monthly',
      description:
        'Kết quả theo từng tháng: chốt và thất bại theo ngày chốt, lead nhận theo tháng ' +
        'nhận, chỉ tiêu tháng và phần trăm hoàn thành.',
      inputSchema: RangeInput,
      run: async (input) =>
        reports.monthly(user, { ...input, ownerId: await ownerIdOf(input.ownerId) }),
    }),

    read({
      name: 'get_breakdown',
      description: 'Cơ cấu cơ hội theo sản phẩm, theo điểm vướng, hoặc theo phân khúc.',
      inputSchema: RangeInput.extend({
        by: z.enum(['product', 'blocker', 'segment']),
      }),
      run: async ({ by, ...range }) =>
        reports.breakdown(user, { ...range, ownerId: await ownerIdOf(range.ownerId) }, by),
    }),

    read({
      name: 'get_by_owner',
      description:
        'Một dòng cho mỗi nhân viên: phễu của họ, tỷ lệ chốt, và ba hàng chờ — quá hạn, ' +
        'im lặng, chưa ai gọi.',
      inputSchema: RangeInput,
      run: async (input) =>
        reports.byOwner(user, { ...input, ownerId: await ownerIdOf(input.ownerId) }),
    }),

    read({
      name: 'get_forecast',
      description:
        'Dự báo kết quả cuối kỳ: đã chốt được bao nhiêu, và sẽ chốt được bao nhiêu cả kỳ. ' +
        'Trả về một KHOẢNG (expected.low–high) từ hai cách tính, không phải một con số — ' +
        'fromRunRate là nhịp của chính kỳ này, fromHistory là nhịp 12 tháng áp cho số ngày còn lại. ' +
        'pipeline.worth là chuyện KHÁC: phễu đang mở đáng bao nhiêu deal về lâu dài, ' +
        'KHÔNG phải trong kỳ này — đừng nói nó như dự báo của kỳ. ' +
        'Bắt buộc có from và to — gọi today trước nếu chưa biết kỳ. ' +
        'basis.closedDeals là số deal đã đóng dùng để đo tỷ lệ: dưới 20 thì nói rõ là ước lượng thô.',
      inputSchema: z.object({
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Ngày đầu kỳ, YYYY-MM-DD'),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Ngày cuối kỳ, YYYY-MM-DD'),
        segment: z.enum(SEGMENTS).optional(),
        ownerId: z.string().optional().describe('Chỉ dự báo sổ của một nhân viên'),
      }),
      run: async (input) =>
        reports.forecast(user, { ...input, ownerId: await ownerIdOf(input.ownerId) }),
    }),

    read({
      name: 'get_attention',
      description:
        'Những cơ hội đang mở cần quản lý để mắt: quá hạn, hoặc im lặng quá lâu. ' +
        'Xếp theo giá trị giảm dần, mỗi dòng kèm reasons nói vì sao nó có mặt. ' +
        'Trả về cả total (tất cả những cơ hội như vậy) và shownShareBps (mấy dòng này ' +
        'chiếm bao nhiêu phần giá trị đang kẹt) — đừng nói mấy dòng trả về là tất cả.',
      inputSchema: z.object({
        segment: z.enum(SEGMENTS).optional(),
        ownerId: z.string().optional().describe('Chỉ xét sổ của một nhân viên'),
      }),
      run: async (input) =>
        reports.attention(user, { ...input, ownerId: await ownerIdOf(input.ownerId) }),
    }),

    read({
      name: 'get_by_team',
      description: 'Một dòng cho mỗi nhóm, gộp theo trưởng nhóm.',
      inputSchema: RangeInput,
      run: async (input) =>
        reports.byTeam(user, { ...input, ownerId: await ownerIdOf(input.ownerId) }),
    }),

    /* ── Bốn việc phải xin phép ───────────────────────────────────────── */
    ...(writable ? writeTools() : []),
  ]

  /** The four that stop for a person, kept together so the role gate is one
   *  line at the call site rather than a condition wrapped round eighty. */
  function writeTools() {
    return [
    ask({
      name: 'record_signal',
      description:
        'Ghi một tín hiệu vào hồ sơ khách hàng — điều khách vừa nói, một thay đổi quan sát ' +
        'được, một mốc thời hạn. Đây là cách duy nhất thông tin mới đi vào hệ thống.',
      inputSchema: z.object({
        customerId: z.string(),
        type: z
          .enum(['cash_flow', 'product_gap', 'need', 'competition', 'deadline', 'documents', 'other'])
          .describe('Loại tín hiệu'),
        content: z.string().min(1).max(1000).describe('Nội dung, một câu, bằng tiếng Việt'),
        observedAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Ngày quan sát được, nếu không phải hôm nay'),
      }),
    }),

    ask({
      name: 'draft_opportunity',
      description:
        'Tạo một cơ hội mới cho khách hàng. Dùng khi tín hiệu cho thấy có nhu cầu chưa ' +
        'được mở thành cơ hội.',
      inputSchema: z.object({
        customerId: z.string(),
        product: z.enum(PRODUCTS),
        need: z.string().min(1).max(500).describe('Nhu cầu của khách, một câu'),
        value: z.number().int().positive().describe('Giá trị dự kiến, đơn vị đồng'),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Hạn xử lý'),
        nextAction: z.string().max(1000).optional(),
      }),
    }),

    ask({
      name: 'set_next_action',
      description: 'Đặt hành động tiếp theo và hạn xử lý cho một cơ hội đang mở.',
      inputSchema: z.object({
        opportunityId: z.string(),
        nextAction: z.string().min(1).max(1000).describe('Việc cần làm tiếp, một câu'),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Hạn, YYYY-MM-DD. Gọi today trước nếu cần tính ngày.'),
      }),
    }),

    ask({
      name: 'update_lead_fields',
      description:
        'Sửa thông tin một cơ hội đang mở: nhu cầu, giá trị, điểm vướng. Chỉ gửi những ' +
        'trường thực sự cần đổi.',
      inputSchema: z.object({
        opportunityId: z.string(),
        need: z.string().min(1).max(500).optional(),
        value: z.number().int().positive().optional(),
        blockerCode: z.enum(BLOCKER_CODES).optional(),
        blockerNote: z.string().max(1000).optional(),
      }),
    }),
    ]
  }
}

/** Runs a write tool for real, once a person has approved it.
 *
 *  Deliberately a separate function from the tools above, and deliberately
 *  taking `user` again: this is the moment the write actually happens, so it
 *  is the moment the scope has to be checked. The services do that — every one
 *  of these calls is the same method the HTTP layer uses. */
export async function runApproved(
  services: Services,
  user: User,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const { customers: _customers, opportunities, signals } = services
  void _customers

  /** Checked again here, and not only in the tool list. The approval comes
   *  back in a later request, and the only thing linking it to the proposal is
   *  a row in `tool_calls` — a role that changed in between, or a call raised
   *  before this guard existed, would otherwise write. */
  if (!mayWrite(user)) throw new ForbiddenException('role_may_not_write')

  switch (name) {
    case 'record_signal':
      return signals.create(user, input.customerId as string, {
        type: input.type as string,
        content: input.content as string,
        observedAt: input.observedAt as string | undefined,
      })

    case 'draft_opportunity':
      return opportunities.create(user, {
        customerId: input.customerId as string,
        product: input.product as string,
        need: input.need as string,
        value: input.value as number,
        dueDate: input.dueDate as string | undefined,
        nextAction: input.nextAction as string | undefined,
        /** Typed in through the assistant, not pushed in from a campaign
         *  file — which is what `manual` means, and what the source column is
         *  for. */
        source: 'manual',
      })

    case 'set_next_action':
      return opportunities.update(user, input.opportunityId as string, {
        nextAction: input.nextAction as string,
        dueDate: input.dueDate as string | undefined,
      })

    case 'update_lead_fields':
      return opportunities.update(user, input.opportunityId as string, {
        need: input.need as string | undefined,
        value: input.value as number | undefined,
        blockerCode: input.blockerCode as string | undefined,
        blockerNote: input.blockerNote as string | undefined,
      })

    default:
      throw new Error(`unknown_write_tool:${name}`)
  }
}

/** The server-side tool that finds the deferred ones.
 *
 *  Runs on Anthropic's side — there is no `run` to write. The model asks it for
 *  "monthly figures" or "record a signal" and gets back the full definition of
 *  whichever tools match, which then behave exactly as if they had been in the
 *  request all along. */
export const TOOL_SEARCH = {
  type: 'tool_search_tool_bm25_20251119',
  name: 'tool_search_tool_bm25',
} as const

/** The tools as the request should carry them: the search tool, then the
 *  definitions, with the heavy situational ones marked for deferral and a
 *  cache breakpoint on the last of them.
 *
 *  The breakpoint sits on the tool block rather than on the system prompt
 *  because these definitions are byte-identical for every user of the branch,
 *  while the system prompt carries a name. One cached prefix serves everybody;
 *  a second breakpoint on the system prompt then extends it per person. */
export function requestTools(services: Services, user: User, sink?: ToolSink) {
  const built = buildTools(services, user, sink).map((tool) => {
    const meta = metaOf(tool.name)
    return meta.deferred ? Object.assign(tool, { defer_loading: true }) : tool
  })

  const loaded = built.filter((tool) => !metaOf(tool.name).deferred)
  const last = loaded[loaded.length - 1]
  if (last) Object.assign(last, { cache_control: { type: 'ephemeral' as const } })

  return [TOOL_SEARCH, ...built]
}

export type BuiltTools = ReturnType<typeof buildTools>
