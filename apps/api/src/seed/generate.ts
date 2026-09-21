import { SALES_PROFILES, type SalesProfile } from './staff'

/** Builds a branch's year of work: customers, leads, and the calendar each
 *  lead moved along.
 *
 *  Written rather than hand-typed because the dashboard needs volume to be
 *  worth looking at — a ranking of two salespeople is a coin toss, and a
 *  monthly trend of two bars is a rumour. The hand-written `data.ts` stays
 *  where it is: it is the walkthrough, and every row of it was chosen to say
 *  something during a demo. This one is scale.
 *
 *  Deterministic. The same seed gives the same branch on every run, because a
 *  dashboard that moves under you while you are checking it cannot be checked.
 *  Only the dates shift, and only because they are measured from today. */

/* ──────────────────────────── The dice ──────────────────────────────────── */

/** mulberry32. Small, fast, and — the only property that matters here —
 *  reproducible from its seed. */
function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Dice = {
  /** A float in [0, 1). */
  next: () => number
  /** An integer in [min, max], both ends included. */
  int: (min: number, max: number) => number
  /** True with the given probability. */
  chance: (p: number) => boolean
  pick: <T>(from: readonly T[]) => T
  /** Picks by weight, so a product mix can be lopsided the way a real one is. */
  weighted: <T>(from: ReadonlyArray<readonly [T, number]>) => T
}

function dice(seed: number): Dice {
  const next = rng(seed)
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    chance: (p: number) => next() < p,
    pick: (from) => from[int(0, from.length - 1)],
    weighted: (from) => {
      const total = from.reduce((sum, [, weight]) => sum + weight, 0)
      let roll = next() * total
      for (const [value, weight] of from) {
        roll -= weight
        if (roll <= 0) return value
      }
      return from[from.length - 1][0]
    },
  }
}

/* ──────────────────────────── Vocabulary ────────────────────────────────── */

const SURNAMES = [
  'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ',
  'Ngô', 'Dương', 'Lý', 'Phan', 'Võ', 'Đinh', 'Trịnh', 'Tạ', 'Mai', 'Lưu',
]

const MIDDLE_NAMES = ['Thị', 'Văn', 'Minh', 'Thanh', 'Quang', 'Hữu', 'Ngọc', 'Bảo', 'Đức', 'Xuân']

const GIVEN_NAMES = [
  'An', 'Bình', 'Chi', 'Dũng', 'Duyên', 'Giang', 'Hà', 'Hải', 'Hạnh', 'Hiếu',
  'Hoa', 'Hùng', 'Hương', 'Khánh', 'Lâm', 'Linh', 'Long', 'Mai', 'Nam', 'Nga',
  'Nhung', 'Phong', 'Phương', 'Quân', 'Quyên', 'Sơn', 'Tâm', 'Thảo', 'Thắng', 'Thủy',
  'Tiến', 'Trang', 'Trung', 'Tuấn', 'Tú', 'Vân', 'Việt', 'Yến', 'Khoa', 'Ngân',
]

const COMPANY_FORMS = [
  { prefix: 'Công ty TNHH', weight: 5 },
  { prefix: 'Công ty TNHH Thương mại', weight: 4 },
  { prefix: 'Công ty CP', weight: 3 },
  { prefix: 'Công ty CP Sản xuất', weight: 2 },
  { prefix: 'Công ty TNHH Dịch vụ', weight: 2 },
  { prefix: 'Hộ kinh doanh', weight: 2 },
  { prefix: 'HTX', weight: 1 },
] as const

const COMPANY_NAMES = [
  'Hà An', 'Minh Phát', 'Tân Tiến', 'Đông Đô', 'Bình Minh', 'Thành Đạt', 'Phú Cường',
  'An Khánh', 'Hải Đăng', 'Trường Thịnh', 'Hoàng Gia', 'Đại Việt', 'Kim Long',
  'Nam Sơn', 'Việt Hưng', 'Sao Mai', 'Thiên Phú', 'Tiến Đạt', 'Hồng Hà', 'Lạc Việt',
  'Vạn Xuân', 'An Phú', 'Hưng Thịnh', 'Ngọc Bích', 'Trung Dũng', 'Đại Dương',
  'Phương Nam', 'Bảo Tín', 'Quang Vinh', 'Tân Á', 'Mỹ Đình', 'Long Biên',
]

const COMPANY_TRADES = [
  'vật liệu xây dựng', 'hàng tiêu dùng', 'nông sản', 'thiết bị điện', 'may mặc',
  'cơ khí chính xác', 'bao bì', 'thủy sản', 'nội thất', 'dược phẩm', 'phụ tùng ô tô',
  'thực phẩm đông lạnh', 'hóa chất công nghiệp', 'in ấn', 'logistics',
]

const RB_JOBS = [
  'Nhân viên văn phòng', 'Giáo viên', 'Kỹ sư xây dựng', 'Bác sĩ', 'Chủ cửa hàng',
  'Lái xe dịch vụ', 'Kế toán', 'Nhân viên ngân hàng', 'Kinh doanh tự do',
  'Công nhân kỹ thuật', 'Nhân viên IT', 'Dược sĩ', 'Chủ quán ăn', 'Môi giới bất động sản',
]

const RELATION_STAGES = [
  'Khách mới',
  'Đang giao dịch',
  'Giao dịch thường xuyên',
  'Từng giao dịch, đã ngừng',
]

const RB_PRODUCTS_HELD = [
  'Tài khoản thanh toán', 'Thẻ ghi nợ', 'Tiết kiệm có kỳ hạn', 'Thẻ tín dụng',
  'Vay mua nhà', 'Bảo hiểm nhân thọ', 'Ngân hàng số',
]

const SSE_PRODUCTS_HELD = [
  'Tài khoản thanh toán', 'Trả lương qua tài khoản', 'Thấu chi doanh nghiệp',
  'Bảo lãnh', 'Tín dụng ngắn hạn', 'POS', 'Thu hộ',
]

/* ──────────────────────────── The products ──────────────────────────────── */

/** What the branch actually pushes, weighted so the mix is lopsided. A chart
 *  of seven equal slices says nothing about where the branch earns. */
const SSE_MIX = [
  ['od', 6], ['loan', 5], ['casa', 4], ['usl', 2], ['insurance', 2], ['card', 2], ['other', 1],
] as const

const RB_MIX = [
  ['card', 7], ['usl', 5], ['loan', 4], ['casa', 4], ['insurance', 3], ['od', 1], ['other', 1],
] as const

/** Deal size, in đồng, by product and segment. Retail mortgages in the one-to-
 *  four billion range, business facilities a little larger — the numbers a
 *  branch would recognise. */
const VALUE_RANGES: Record<string, { sse: [number, number]; rb: [number, number] }> = {
  card: { sse: [50_000_000, 300_000_000], rb: [30_000_000, 200_000_000] },
  od: { sse: [500_000_000, 5_000_000_000], rb: [100_000_000, 500_000_000] },
  usl: { sse: [300_000_000, 2_000_000_000], rb: [100_000_000, 800_000_000] },
  loan: { sse: [1_000_000_000, 12_000_000_000], rb: [800_000_000, 4_500_000_000] },
  casa: { sse: [200_000_000, 3_000_000_000], rb: [50_000_000, 600_000_000] },
  insurance: { sse: [100_000_000, 800_000_000], rb: [50_000_000, 400_000_000] },
  other: { sse: [100_000_000, 1_000_000_000], rb: [50_000_000, 300_000_000] },
}

const NEEDS: Record<string, string[]> = {
  card: ['Mở thẻ tín dụng hạn mức theo lương', 'Nâng hạn mức thẻ hiện có', 'Phát hành thẻ cho nhân sự công ty'],
  od: ['Thấu chi bổ sung vốn lưu động', 'Hạn mức thấu chi theo dòng tiền về tài khoản', 'Thấu chi mùa cao điểm'],
  usl: ['Vay tín chấp tiêu dùng', 'Vay tín chấp theo lương', 'Vay tín chấp bổ sung vốn ngắn hạn'],
  loan: ['Vay mua nhà có tài sản bảo đảm', 'Vay mua ô tô', 'Vay đầu tư nhà xưởng', 'Vay mua bất động sản đầu tư'],
  casa: ['Mở tài khoản và chuyển dòng tiền về MSB', 'Gói tài khoản trả lương', 'Tài khoản số đẹp cho doanh nghiệp'],
  insurance: ['Bảo hiểm nhân thọ kèm khoản vay', 'Bảo hiểm sức khỏe gia đình', 'Bảo hiểm tài sản doanh nghiệp'],
  other: ['Tư vấn gói sản phẩm tổng thể', 'Bảo lãnh thanh toán', 'Dịch vụ thu hộ'],
}

const NEXT_ACTIONS = [
  'Gọi lại xác nhận nhu cầu',
  'Hẹn gặp tại quầy tuần này',
  'Gửi bảng lãi suất qua Zalo',
  'Nhắc khách bổ sung hồ sơ',
  'Chờ khách trả lời sau kỳ nghỉ',
  'Trình hồ sơ lên bộ phận thẩm định',
]

const WIN_REASONS = [
  'Khách đồng ý lãi suất sau khi so sánh',
  'Giải ngân đúng hạn khách cần',
  'Khách chốt sau buổi gặp tại quầy',
  'Được người quen giới thiệu nên chốt nhanh',
  'Ưu đãi phí thuyết phục được khách',
]

const LOSS_BY_BLOCKER: Record<string, string> = {
  rate: 'Ngân hàng khác chào lãi suất thấp hơn',
  speed: 'Khách cần giải ngân gấp, hồ sơ chưa kịp',
  experience: 'Khách không hài lòng trải nghiệm lần trước',
  documents: 'Khách không bổ sung được hồ sơ chứng minh',
  collateral: 'Tài sản bảo đảm không đủ điều kiện',
  policy: 'Không đáp ứng được cơ chế hiện hành',
  competitor: 'Khách đã ký với ngân hàng khác',
  customer_hesitation: 'Khách hoãn kế hoạch, chưa vay nữa',
  other: 'Khách dừng không nêu lý do',
}

const BLOCKER_MIX = [
  ['rate', 8], ['competitor', 6], ['documents', 5], ['customer_hesitation', 5],
  ['speed', 4], ['collateral', 3], ['policy', 2], ['experience', 2], ['other', 1],
] as const

const CONFIRM_NOTES = [
  'Đã đối chiếu với hồ sơ giấy',
  'Khớp bảng kê cuối ngày',
  'Đã kiểm tra chứng từ giải ngân',
  'Đối chiếu đủ, đã ký xác nhận',
]

const SIGNAL_TEMPLATES = [
  { type: 'cash_flow', content: 'Dòng tiền về tài khoản tăng so với quý trước' },
  { type: 'cash_flow', content: 'Tiền về xong chuyển ngay sang ngân hàng khác' },
  { type: 'product_gap', content: 'Chưa dùng sản phẩm tín dụng nào của MSB' },
  { type: 'product_gap', content: 'Chỉ dùng tài khoản thanh toán' },
  { type: 'need', content: 'Khách hỏi về hạn mức vay trong quý tới' },
  { type: 'need', content: 'Có kế hoạch mở rộng, cần vốn bổ sung' },
  { type: 'competition', content: 'Đang được ngân hàng khác mời chào lãi suất' },
  { type: 'deadline', content: 'Khoản vay ở ngân hàng khác đến hạn tháng sau' },
  { type: 'documents', content: 'Hồ sơ chứng minh thu nhập chưa đầy đủ' },
] as const

/* ──────────────────────────── The shapes ────────────────────────────────── */

export type GenCustomer = {
  key: string
  ownerId: string
  segment: 'sse' | 'rb'
  name: string
  contactName?: string
  contactPhone: string
  revenue?: number
  relationStage: string
  currentProducts: string[]
  attributes: Record<string, unknown>
  note?: string
  signals: Array<{ type: string; content: string; daysAgo: number }>
}

export type GenDeal = {
  customerKey: string
  ownerId: string
  product: string
  need: string
  value: number
  source: 'import' | 'manual'

  reach: 'new' | 'contacted' | 'advised'
  outcome?: 'won' | 'lost'
  outcomeReason?: string
  sold?: Array<{ product: string; amount: number }>
  confirmed: boolean
  confirmNote?: string

  blockerCode?: string
  blockerNote?: string
  nextAction?: string
  dueInDays?: number

  openedDaysAgo: number
  contactedDaysAgo?: number
  advisedDaysAgo?: number
  closedDaysAgo?: number
  confirmedDaysAgo?: number
}

export type Branch = { customers: GenCustomer[]; deals: GenDeal[] }

export type GenerateOptions = {
  /** How many leads to make. Split across the roster by weight. */
  deals: number
  /** How far back the oldest lead was raised. Twelve whole months by default,
   *  which is what makes the trend a trend. */
  days: number
  seed: number
}

export const DEFAULT_DEALS = 1000
export const DEFAULT_MONTHS = 12
export const DEFAULT_SEED = 20260920

/* ──────────────────────────── The generator ─────────────────────────────── */

export function generateBranch(options: Partial<GenerateOptions> = {}): Branch {
  const wanted = options.deals ?? DEFAULT_DEALS
  const days = options.days ?? daysBackToMonthStart(DEFAULT_MONTHS)
  const d = dice(options.seed ?? DEFAULT_SEED)

  const customers: GenCustomer[] = []
  const deals: GenDeal[] = []

  const names = new Set<string>()
  /** Rounded cumulatively rather than per person, so the shares add up to the
   *  number asked for. Thirteen independent `Math.round` calls land anywhere
   *  within six of it, and `--deals 1000` producing 997 is the kind of thing
   *  nobody notices until two runs disagree. */
  const shares = splitByWeight(wanted, SALES_PROFILES.map((profile) => profile.weight))

  for (const [index, profile] of SALES_PROFILES.entries()) {
    const share = shares[index]

    /** Roughly four leads per customer, which is what a book looks like after
     *  a year: a handful of files worked repeatedly, not one lead each. */
    const bookSize = Math.max(6, Math.round(share / 4))
    const book: GenCustomer[] = []

    for (let i = 0; i < bookSize; i++) {
      /** Keyed off the running total, not off `i`: the key has to be unique
       *  across the whole branch, and a per-book counter gives two people a
       *  customer with the same key — which lands every one of the second
       *  person's leads on the first person's file. */
      const customer = makeCustomer(d, profile, names, customers.length, days)
      book.push(customer)
      customers.push(customer)
    }

    /** Outcomes are decided for the whole book at once rather than lead by
     *  lead, so this person's conversion rate is exactly the rate their
     *  profile claims — in the month, in the quarter and in the year alike.
     *
     *  Rolling a win per lead gave a rate that drifted with the window: the
     *  same branch read 6% over the year and 8.8% over the month, and a
     *  dashboard whose headline figure moves when you change the period
     *  cannot be used to check the dashboard. */
    const drafts = Array.from({ length: share }, () => ({
      customer: d.pick(book),
      openedDaysAgo: openedAt(d, days),
    }))

    for (const draft of assignOutcomes(d, drafts, profile)) {
      deals.push(finishDeal(d, profile, draft))
    }
  }

  return { customers, deals }
}

/** Splits a total into parts proportional to the weights, exactly. */
function splitByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  const out: number[] = []
  let allocated = 0
  let running = 0

  for (const [index, weight] of weights.entries()) {
    running += weight
    const upTo = index === weights.length - 1 ? total : Math.round((total * running) / sum)
    out.push(upTo - allocated)
    allocated = upTo
  }

  return out
}

type Draft = {
  customer: GenCustomer
  openedDaysAgo: number
  outcome?: 'won' | 'lost'
}

/** Marks exactly `crBps` of the book as won, spread evenly across the ages so
 *  every window gets its share, then marks some of the rest as lost.
 *
 *  Losing is the part that does move with age, and rightly: a lead raised in
 *  October has had time to go one way or the other, while one raised last week
 *  is mostly still open — which is what fills the queues the team lead's
 *  screen exists for. */
function assignOutcomes(d: Dice, drafts: Draft[], profile: SalesProfile): Draft[] {
  const ordered = [...drafts].sort((a, b) => a.openedDaysAgo - b.openedDaysAgo)
  const wins = Math.round((ordered.length * profile.crBps) / 10_000)

  for (let i = 0; i < wins; i++) {
    /** Evenly spaced through the age-sorted list, offset to the middle of each
     *  stride so the newest lead in the book is not automatically a win. */
    const at = Math.floor(((i + 0.5) * ordered.length) / wins)
    ordered[Math.min(at, ordered.length - 1)].outcome = 'won'
  }

  for (const draft of ordered) {
    if (draft.outcome) continue
    const age = draft.openedDaysAgo
    const lostChance = age > 120 ? 0.74 : age > 60 ? 0.58 : age > 25 ? 0.32 : 0.09
    if (d.chance(lostChance)) draft.outcome = 'lost'
  }

  return ordered
}

function makeCustomer(
  d: Dice,
  profile: SalesProfile,
  taken: Set<string>,
  index: number,
  days: number,
): GenCustomer {
  const sse = profile.segment === 'sse'

  let name = sse ? companyName(d) : personName(d)
  /** A branch does have two customers with the same name, but a demo where
   *  the list shows "Nguyễn Văn An" four times reads as a bug rather than as
   *  a coincidence. */
  for (let attempt = 0; taken.has(name) && attempt < 40; attempt++) {
    name = sse ? companyName(d) : personName(d)
  }
  taken.add(name)

  const held = sse ? SSE_PRODUCTS_HELD : RB_PRODUCTS_HELD
  const currentProducts = pickSome(d, held, d.int(0, 3))

  /** Only about a third carry signals. Everyone having a full file is the
   *  giveaway that a dataset was generated. */
  const signals = d.chance(0.35)
    ? pickSome(d, SIGNAL_TEMPLATES, d.int(1, 3)).map((template) => ({
        type: template.type,
        content: template.content,
        daysAgo: d.int(1, Math.min(days, 120)),
      }))
    : []

  return {
    key: `gen_${index}`,
    ownerId: profile.id,
    segment: profile.segment,
    name,
    contactName: sse ? personName(d) : undefined,
    contactPhone: phone(d),
    revenue: sse ? d.int(8, 260) * 1_000_000_000 : d.int(180, 1_800) * 1_000_000,
    relationStage: d.pick(RELATION_STAGES),
    currentProducts,
    attributes: sse
      ? {
          nganhHang: d.pick(COMPANY_TRADES),
          soNamHoatDong: d.int(2, 22),
          mucDoDungSanPhamMSB:
            currentProducts.length === 0 ? 'Chưa dùng sản phẩm nào' : `${currentProducts.length} sản phẩm`,
        }
      : {
          ngheNghiep: d.pick(RB_JOBS),
          thuNhapThangUocTinh: d.int(12, 90) * 1_000_000,
        },
    signals,
  }
}

function finishDeal(d: Dice, profile: SalesProfile, draft: Draft): GenDeal {
  const sse = profile.segment === 'sse'
  const product = d.weighted(sse ? SSE_MIX : RB_MIX)
  const [low, high] = VALUE_RANGES[product][profile.segment]

  /** Rounded to the million, because that is how a salesperson types a figure
   *  into a form. An exact 1_234_567_891 would be the other giveaway. */
  const value = Math.round(d.int(low, high) / 1_000_000) * 1_000_000

  const { customer, openedDaysAgo, outcome } = draft
  const age = openedDaysAgo

  /** How far it got. A closed lead was worked; an open one may not have been
   *  touched at all, and the younger it is the likelier that is. */
  const reach: GenDeal['reach'] = outcome
    ? d.chance(outcome === 'won' ? 0.72 : 0.48)
      ? 'advised'
      : 'contacted'
    : d.chance(age <= 10 ? 0.5 : age <= 30 ? 0.24 : 0.1)
      ? 'new'
      : d.chance(0.6)
        ? 'contacted'
        : 'advised'

  /** When a live lead was last worked, counted back from today rather than
   *  forward from the day it opened.
   *
   *  Forward was the obvious way to write it and it produced a branch nobody
   *  works at: a lead opened two hundred days ago was called on day 190 and
   *  then never again, so 92% of the open book read as "im lặng quá 7 ngày"
   *  and the queue built on that rule held almost every row. A queue that
   *  selects everything selects nothing.
   *
   *  Backwards from today instead: most live leads were touched in the last
   *  week, and the tail is the genuinely neglected ones — which is what the
   *  queue is for, and roughly a quarter of the book, which is what a branch
   *  under pressure actually looks like. Closed leads keep their own
   *  timeline; theirs ended when they closed. */
  const touchedDaysAgo = outcome
    ? undefined
    : Math.min(openedDaysAgo, d.chance(0.74) ? d.int(0, 6) : d.int(7, 55))

  /** Days are counted back from today, so each step is a smaller number than
   *  the one before it. Clamped at zero, which is today. */
  const contactedDaysAgo =
    reach === 'new'
      ? undefined
      : outcome !== undefined
        ? Math.max(0, openedDaysAgo - d.int(0, Math.min(12, openedDaysAgo)))
        : reach === 'advised'
          ? /** The call came before the advice, so it is the larger number. */
            Math.min(openedDaysAgo, touchedDaysAgo! + d.int(1, 14))
          : touchedDaysAgo!
  const advisedDaysAgo =
    reach !== 'advised' || contactedDaysAgo === undefined
      ? undefined
      : outcome !== undefined
        ? Math.max(0, contactedDaysAgo - d.int(1, Math.min(16, contactedDaysAgo + 1)))
        : touchedDaysAgo!

  const lastStep = advisedDaysAgo ?? contactedDaysAgo ?? openedDaysAgo
  const closedDaysAgo = outcome
    ? Math.max(0, lastStep - d.int(0, Math.min(21, lastStep + 1)))
    : undefined

  /** The team lead signs off afterwards, and not instantly. Almost everything
   *  old is signed; what closed in the last few days is still sitting in their
   *  queue, which is the point of the card that shows it. */
  const confirmed =
    closedDaysAgo !== undefined &&
    closedDaysAgo > 2 &&
    d.chance(closedDaysAgo > 21 ? 0.95 : closedDaysAgo > 8 ? 0.8 : 0.45)
  const confirmedDaysAgo =
    confirmed && closedDaysAgo !== undefined
      ? Math.max(0, closedDaysAgo - d.int(1, Math.min(6, closedDaysAgo + 1)))
      : undefined

  const blockerCode =
    outcome === 'lost'
      ? d.weighted(BLOCKER_MIX)
      : outcome === undefined && d.chance(0.22)
        ? d.weighted(BLOCKER_MIX)
        : undefined

  const sold =
    outcome === 'won'
      ? [
          { product, amount: value },
          ...(d.chance(0.22)
            ? [{ product: d.weighted(sse ? SSE_MIX : RB_MIX), amount: Math.round(value * 0.3) }]
            : []),
        ]
      : undefined

  return {
    customerKey: customer.key,
    ownerId: profile.id,
    product,
    need: d.pick(NEEDS[product]),
    value,
    /** Most of a branch's volume is pushed in from a campaign file; the rest
     *  a salesperson found themselves. */
    source: d.chance(0.72) ? 'import' : 'manual',

    reach,
    outcome,
    outcomeReason:
      outcome === 'won'
        ? d.pick(WIN_REASONS)
        : outcome === 'lost'
          ? LOSS_BY_BLOCKER[blockerCode ?? 'other']
          : undefined,
    sold,
    confirmed,
    confirmNote: confirmed ? d.pick(CONFIRM_NOTES) : undefined,

    blockerCode,
    blockerNote:
      blockerCode && outcome !== 'lost' ? 'Khách nêu vướng mắc trong lần trao đổi gần nhất' : undefined,
    nextAction: outcome ? undefined : d.pick(NEXT_ACTIONS),
    /** Only live leads carry a deadline worth reading. About a fifth of them
     *  are already past it, which is the queue a team lead opens the screen
     *  for. */
    dueInDays: outcome ? undefined : d.chance(0.2) ? -d.int(1, 21) : d.int(1, 30),

    openedDaysAgo,
    contactedDaysAgo,
    advisedDaysAgo,
    closedDaysAgo,
    confirmedDaysAgo,
  }
}

/** When the lead was raised, weighted toward the recent months.
 *
 *  A flat spread would put as many leads in last October as in this
 *  September, which is not what a branch that has been growing looks like —
 *  and it would leave the current month, the one the dashboard opens on, as
 *  thin as any other. The exponent is mild on purpose: squaring the roll
 *  piled a fifth of the year into the last twenty days, which reads as a data
 *  import rather than as growth. */
function openedAt(d: Dice, days: number): number {
  return Math.min(days, Math.floor(Math.pow(d.next(), 1.35) * days))
}

/** How many days back the first of the month `count - 1` months ago was.
 *
 *  The window is measured this way rather than as a flat 365 so the monthly
 *  trend starts on a whole month. A year counted back from today opens on the
 *  twentieth of September, and the oldest bar is a ten-day stub that looks
 *  like the branch was shut. */
export function daysBackToMonthStart(count: number, now = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth() - (count - 1), 1)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((today.getTime() - start.getTime()) / 86_400_000)
}

function companyName(d: Dice): string {
  const form = d.weighted(COMPANY_FORMS.map((f) => [f.prefix, f.weight] as const))
  return `${form} ${d.pick(COMPANY_NAMES)}`
}

function personName(d: Dice): string {
  return `${d.pick(SURNAMES)} ${d.pick(MIDDLE_NAMES)} ${d.pick(GIVEN_NAMES)}`
}

function phone(d: Dice): string {
  const head = d.pick(['090', '091', '093', '096', '097', '098', '032', '034', '036', '038', '070', '078', '083'])
  return `${head}${String(d.int(0, 9_999_999)).padStart(7, '0')}`
}

function pickSome<T>(d: Dice, from: readonly T[], count: number): T[] {
  if (count <= 0) return []
  const pool = [...from]
  const out: T[] = []
  for (let i = 0; i < count && pool.length > 0; i++) {
    out.push(pool.splice(d.int(0, pool.length - 1), 1)[0])
  }
  return out
}
