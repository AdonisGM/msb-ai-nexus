
/** Stand-in data for the trial run.
 *
 *  Invented, and deliberately so: the brief rules out touching real customer
 *  records. It is shaped to be replaced — when the salespeople hand over their
 *  own twenty files, only this file changes.
 *
 *  The numbers are plausible for a branch: retail mortgages in the one-to-four
 *  billion range, small-business facilities a little larger, turnover figures
 *  that make the segment recognisable at a glance. */

export type SeedSignal = {
  type: string
  content: string
  /** Days before today. Signals are dated by when they were observed, not by
   *  when anyone typed them up. */
  daysAgo: number
  rawNote?: string
}

export type SeedCustomer = {
  key: string
  name: string
  contactName?: string
  contactPhone?: string
  revenue?: number
  relationStage?: string
  currentProducts?: string[]
  attributes?: Record<string, unknown>
  note?: string
  signals: SeedSignal[]
}

export type SeedDeal = {
  customer: string
  /** A code from the closed set: card, od, usl, loan, casa, insurance. */
  product: string
  need: string
  /** Expected size in đồng, as entered when the lead was opened. */
  value: number

  /** How far down the funnel it got. The replay walks it there one real
   *  action at a time, so the trace and the timings are genuine rather than
   *  written straight into the table. */
  reach: 'new' | 'contacted' | 'advised'
  outcome?: 'won' | 'lost'
  outcomeReason?: string
  /** What actually sold. Required on a win: the branch report counts cards,
   *  overdrafts and loans in separate columns. */
  sold?: Array<{ product: string; amount: number }>
  /** The team lead has reconciled it against the paperwork. */
  confirmed?: boolean
  confirmNote?: string

  blockerCode?: string
  blockerNote?: string
  nextAction?: string
  missingInfo?: string[]
  /** Days from today; negative is already past, which is what an overdue lead
   *  looks like on a team lead's screen. */
  dueInDays?: number

  /** Where it came in from. Most of a branch's volume is pushed in from a
   *  campaign; the rest a salesperson found themselves. */
  source?: 'import' | 'manual'

  /** The timeline, in days before today, and the reason the demo is worth
   *  filming: every duration a report quotes is measured off these rather
   *  than invented. A lead handed out on day 30 and first called on day 26 is
   *  four days of `heldMs` on its `contacted` event, and the branch average
   *  for "how long until somebody rings them" is a sum over that column. */
  openedDaysAgo: number
  contactedDaysAgo?: number
  advisedDaysAgo?: number
  closedDaysAgo?: number
  confirmedDaysAgo?: number
}

/* ──────────────────────────────────────────────────────────────────────────
 * Hà — small businesses and household traders
 * ────────────────────────────────────────────────────────────────────────── */

export const SSE_CUSTOMERS: SeedCustomer[] = [
  {
    /** The scenario the brief walks through: money is coming in, and leaving
     *  again for another bank. */
    key: 'ha_an',
    name: 'Công ty TNHH Thương mại Hà An',
    contactName: 'Chị Hà',
    contactPhone: '0901234567',
    revenue: 48_000_000_000,
    relationStage: 'Đang giao dịch',
    currentProducts: ['Tài khoản thanh toán'],
    attributes: {
      doanhSoTienVao: 48_000_000_000,
      tyLeChuyenSangNHKhac: '65%',
      mucDoDungSanPhamMSB: 'Chỉ dùng tài khoản thanh toán',
      nhuCauVonKinhDoanh: 'Nhập hàng theo mùa, cần vốn lưu động quý IV',
      phuongAnKinhDoanh: 'Phân phối hàng tiêu dùng, 3 kho tại Hà Nội',
    },
    signals: [
      {
        type: 'cash_flow',
        content: 'Tiền về tài khoản MSB xong chuyển ngay 65% sang ngân hàng khác',
        daysAgo: 21,
      },
      {
        type: 'product_gap',
        content: 'Chưa dùng sản phẩm tín dụng nào của MSB',
        daysAgo: 21,
      },
      {
        type: 'need',
        content: 'Cần vốn lưu động khoảng 5 tỷ cho mùa cao điểm quý IV',
        daysAgo: 12,
        rawNote:
          'Gặp chị Hà sáng nay. Chị nói quý IV nhập hàng nhiều, cần khoảng 5 tỷ vốn lưu động, đang cân nhắc vay ở đâu.',
      },
    ],
  },
  {
    key: 'minh_phat',
    name: 'Công ty CP Xây dựng Minh Phát',
    contactName: 'Anh Phát',
    contactPhone: '0908334455',
    revenue: 120_000_000_000,
    relationStage: 'Khách hàng lâu năm',
    currentProducts: ['Tài khoản thanh toán', 'Bảo lãnh'],
    attributes: {
      doanhSoTienVao: 120_000_000_000,
      tyLeChuyenSangNHKhac: '25%',
      mucDoDungSanPhamMSB: 'Tài khoản thanh toán và bảo lãnh',
      nhuCauVonKinhDoanh: 'Bảo lãnh dự thầu các gói đầu tư công',
      phuongAnKinhDoanh: 'Thi công hạ tầng, ba dự án đang triển khai',
    },
    signals: [
      { type: 'need', content: 'Sắp đấu thầu 2 gói, cần tăng hạn mức bảo lãnh', daysAgo: 8 },
    ],
  },
  {
    key: 'thanh_binh',
    name: 'Hộ kinh doanh Thanh Bình',
    contactName: 'Cô Bình',
    contactPhone: '0916552233',
    revenue: 9_500_000_000,
    relationStage: 'Mới tiếp cận',
    currentProducts: [],
    attributes: {
      doanhSoTienVao: 9_500_000_000,
      tyLeChuyenSangNHKhac: '95%',
      mucDoDungSanPhamMSB: 'Chưa dùng sản phẩm nào',
      nhuCauVonKinhDoanh: 'Xoay vòng vốn nhanh, chủ yếu dùng tiền mặt',
      phuongAnKinhDoanh: 'Tạp hoá bán buôn tại chợ đầu mối, hai sạp',
    },
    signals: [
      { type: 'competition', content: 'Đang dùng tài khoản chính ở ngân hàng khác', daysAgo: 30 },
    ],
  },
  {
    key: 'an_khang',
    name: 'Công ty TNHH Dược phẩm An Khang',
    contactName: 'Anh Khang',
    contactPhone: '0912456789',
    revenue: 62_000_000_000,
    relationStage: 'Đang giao dịch',
    currentProducts: ['Tài khoản thanh toán', 'Thu hộ'],
    attributes: {
      doanhSoTienVao: 62_000_000_000,
      tyLeChuyenSangNHKhac: '30%',
      mucDoDungSanPhamMSB: 'Tài khoản thanh toán và thu hộ',
      nhuCauVonKinhDoanh: 'Nhập khẩu nguyên liệu, thanh toán theo LC',
      phuongAnKinhDoanh: 'Phân phối dược phẩm cho 40 nhà thuốc',
    },
    signals: [
      { type: 'cash_flow', content: 'Dòng tiền vào đều, chưa khai thác tín dụng', daysAgo: 16 },
    ],
  },
  {
    key: 'dong_tien',
    name: 'Công ty TNHH Cơ khí Đông Tiến',
    contactName: 'Anh Tiến',
    contactPhone: '0903221144',
    revenue: 35_000_000_000,
    relationStage: 'Đang giao dịch',
    currentProducts: ['Tài khoản thanh toán'],
    attributes: {
      doanhSoTienVao: 35_000_000_000,
      tyLeChuyenSangNHKhac: '45%',
      mucDoDungSanPhamMSB: 'Chỉ dùng tài khoản thanh toán',
      nhuCauVonKinhDoanh: 'Đầu tư máy móc, vay trung hạn 3 năm',
      phuongAnKinhDoanh: 'Gia công cơ khí chính xác cho doanh nghiệp FDI',
    },
    signals: [
      { type: 'need', content: 'Muốn mua máy CNC mới, cần vay trung hạn', daysAgo: 5 },
    ],
  },
  {
    key: 'hoang_long',
    name: 'Công ty CP Thực phẩm Hoàng Long',
    contactName: 'Chị Loan, phòng nhân sự',
    contactPhone: '0988112233',
    revenue: 88_000_000_000,
    relationStage: 'Đang giao dịch',
    currentProducts: ['Tài khoản thanh toán', 'Chi lương'],
    attributes: {
      doanhSoTienVao: 88_000_000_000,
      tyLeChuyenSangNHKhac: '20%',
      mucDoDungSanPhamMSB: 'Tài khoản thanh toán và chi lương 180 nhân viên',
      nhuCauVonKinhDoanh: 'Chưa có nhu cầu vay, quan tâm phúc lợi nhân viên',
      phuongAnKinhDoanh: 'Chế biến thực phẩm, hai nhà máy tại Hưng Yên',
    },
    signals: [
      { type: 'product_gap', content: 'Chi lương qua MSB nhưng nhân viên mở thẻ nơi khác', daysAgo: 25 },
    ],
  },
  {
    key: 'viet_tin',
    name: 'Công ty TNHH Vận tải Việt Tín',
    contactName: 'Anh Tín',
    contactPhone: '0906778899',
    revenue: 27_000_000_000,
    relationStage: 'Mới tiếp cận',
    currentProducts: [],
    attributes: {
      doanhSoTienVao: 27_000_000_000,
      tyLeChuyenSangNHKhac: '80%',
      mucDoDungSanPhamMSB: 'Chưa dùng sản phẩm nào',
      nhuCauVonKinhDoanh: 'Mở rộng đội xe, cần vay mua phương tiện',
      phuongAnKinhDoanh: 'Vận tải container tuyến Bắc - Nam, 12 đầu kéo',
    },
    signals: [
      { type: 'need', content: 'Cần vay mua 5 đầu kéo, hỏi lãi suất', daysAgo: 3 },
    ],
  },
  {
    key: 'nam_son',
    name: 'Hộ kinh doanh Nam Sơn',
    contactName: 'Anh Sơn',
    contactPhone: '0975334422',
    revenue: 6_200_000_000,
    relationStage: 'Mới tiếp cận',
    currentProducts: [],
    attributes: {
      doanhSoTienVao: 6_200_000_000,
      tyLeChuyenSangNHKhac: '90%',
      mucDoDungSanPhamMSB: 'Chưa dùng sản phẩm nào',
      nhuCauVonKinhDoanh: 'Cần vốn nhập hàng, nhưng ngại thủ tục',
      phuongAnKinhDoanh: 'Bán buôn vật liệu xây dựng, một kho tại Hà Đông',
    },
    signals: [{ type: 'other', content: 'Chủ hộ còn e ngại thủ tục vay', daysAgo: 40 }],
  },
  {
    key: 'bao_ngoc',
    name: 'Công ty TNHH May Bảo Ngọc',
    contactName: 'Chị Ngọc',
    contactPhone: '0913557799',
    revenue: 44_000_000_000,
    relationStage: 'Đang giao dịch',
    currentProducts: ['Tài khoản thanh toán', 'Thanh toán quốc tế'],
    attributes: {
      doanhSoTienVao: 44_000_000_000,
      tyLeChuyenSangNHKhac: '55%',
      mucDoDungSanPhamMSB: 'Tài khoản thanh toán và thanh toán quốc tế',
      nhuCauVonKinhDoanh: 'Thanh toán cho đối tác nước ngoài, quan tâm phí',
      phuongAnKinhDoanh: 'May gia công xuất khẩu sang EU, 300 công nhân',
    },
    signals: [
      { type: 'competition', content: 'Ngân hàng khác chào phí thanh toán quốc tế thấp hơn', daysAgo: 11 },
    ],
  },
  {
    key: 'tan_phu',
    name: 'Công ty CP Nội thất Tân Phú',
    contactName: 'Anh Phú',
    contactPhone: '0982445566',
    revenue: 19_000_000_000,
    relationStage: 'Đang giao dịch',
    currentProducts: ['Tài khoản thanh toán'],
    attributes: {
      doanhSoTienVao: 19_000_000_000,
      tyLeChuyenSangNHKhac: '40%',
      mucDoDungSanPhamMSB: 'Chỉ dùng tài khoản thanh toán',
      nhuCauVonKinhDoanh: 'Cần vốn lưu động nhưng báo cáo chưa kiểm toán',
      phuongAnKinhDoanh: 'Sản xuất nội thất theo đơn đặt hàng',
    },
    signals: [
      { type: 'documents', content: 'Báo cáo tài chính 2025 đã có, chưa kiểm toán', daysAgo: 18 },
    ],
  },
]

/* ──────────────────────────────────────────────────────────────────────────
 * Hải — individuals
 * ────────────────────────────────────────────────────────────────────────── */

export const RB_CUSTOMERS: SeedCustomer[] = [
  {
    /** The other scenario from the brief: a mortgage with a deadline, a
     *  competitor in the room, and the whole thing hanging on a rate. */
    key: 'van_minh',
    name: 'Nguyễn Văn Minh',
    revenue: 720_000_000,
    contactName: 'Anh Minh',
    contactPhone: '0987654321',
    relationStage: 'Đang làm hồ sơ',
    currentProducts: ['Tài khoản thanh toán', 'Thẻ ghi nợ'],
    attributes: {
      mucDichVay: 'Mua căn hộ 3,2 tỷ tại quận Nam Từ Liêm',
      taiSanBaoDam: 'Chính căn hộ mua, đã có hợp đồng mua bán',
      nguonTraNo: 'Lương 60 triệu/tháng, vợ kinh doanh thêm',
      tinhTrangPhapLy: 'Hồ sơ cơ bản đầy đủ',
      nganHangDangSoSanh: 'VCB, Techcombank',
    },
    signals: [
      {
        type: 'deadline',
        content: 'Phải giải ngân trước 30/9, nếu không mất cọc',
        daysAgo: 14,
        rawNote:
          'Anh Minh cần vay 2 tỷ trước ngày 30/9, đang so lãi suất với ngân hàng khác và chưa quyết định.',
      },
      { type: 'competition', content: 'VCB chào 7,9% năm đầu', daysAgo: 10 },
      { type: 'documents', content: 'Đã nộp sao kê lương 6 tháng', daysAgo: 7 },
    ],
  },
  {
    key: 'thu_ha',
    name: 'Trần Thu Hà',
    contactName: 'Chị Hà',
    contactPhone: '0935112244',
    revenue: 420_000_000,
    relationStage: 'Đang giao dịch',
    currentProducts: ['Tài khoản thanh toán'],
    attributes: {
      mucDichVay: 'Sửa nhà, hoàn thiện tầng 3',
      taiSanBaoDam: 'Nhà đang ở, sổ đỏ chính chủ',
      nguonTraNo: 'Lương 35 triệu/tháng, thâm niên 8 năm',
      tinhTrangPhapLy: 'Hồ sơ đầy đủ',
      nganHangDangSoSanh: 'Chưa so sánh với ngân hàng nào',
    },
    signals: [{ type: 'need', content: 'Hỏi vay tiêu dùng 300 triệu sửa nhà', daysAgo: 6 }],
  },
  {
    key: 'quoc_dat',
    name: 'Lê Quốc Đạt',
    contactName: 'Anh Đạt',
    contactPhone: '0968223311',
    revenue: 600_000_000,
    relationStage: 'Đang làm hồ sơ',
    currentProducts: ['Tài khoản thanh toán', 'Thẻ tín dụng'],
    attributes: {
      mucDichVay: 'Mua ô tô phục vụ kinh doanh',
      taiSanBaoDam: 'Chính chiếc xe mua',
      nguonTraNo: 'Kinh doanh tự do, chưa chứng minh được bằng sao kê',
      tinhTrangPhapLy: 'Thiếu sao kê tài khoản kinh doanh',
      nganHangDangSoSanh: 'VPBank, MSB',
    },
    signals: [
      { type: 'documents', content: 'Chưa chứng minh được thu nhập kinh doanh', daysAgo: 9 },
    ],
  },
  {
    key: 'mai_anh',
    name: 'Phạm Mai Anh',
    contactName: 'Chị Mai Anh',
    contactPhone: '0904556677',
    revenue: 480_000_000,
    relationStage: 'Khách hàng lâu năm',
    currentProducts: ['Tài khoản thanh toán', 'Tiết kiệm'],
    attributes: {
      mucDichVay: 'Không vay, khách gửi tiết kiệm',
      nguonTraNo: 'Cho thuê hai căn hộ, thu 40 triệu/tháng',
      tinhTrangPhapLy: 'Khách lâu năm, hồ sơ đầy đủ',
      nganHangDangSoSanh: 'So lãi suất huy động với ba ngân hàng',
    },
    signals: [{ type: 'need', content: 'Sổ tiết kiệm 1,5 tỷ sắp đáo hạn', daysAgo: 4 }],
  },
  {
    key: 'tuan_kiet',
    name: 'Võ Tuấn Kiệt',
    contactName: 'Anh Kiệt',
    contactPhone: '0917889900',
    revenue: 540_000_000,
    relationStage: 'Mới tiếp cận',
    currentProducts: [],
    attributes: {
      mucDichVay: 'Chuyển khoản vay mua nhà từ ngân hàng khác về MSB',
      taiSanBaoDam: 'Căn nhà đang thế chấp tại ngân hàng cũ',
      nguonTraNo: 'Lương 45 triệu/tháng, vợ có thu nhập thêm',
      tinhTrangPhapLy: 'Chờ xác nhận dư nợ bên ngân hàng cũ',
      nganHangDangSoSanh: 'Ngân hàng đang vay, MSB',
    },
    signals: [{ type: 'competition', content: 'Đang vay mua nhà ở ngân hàng khác', daysAgo: 22 }],
  },
  {
    key: 'ngoc_lan',
    name: 'Đỗ Ngọc Lan',
    contactName: 'Chị Lan',
    contactPhone: '0942667788',
    revenue: 504_000_000,
    relationStage: 'Đang giao dịch',
    currentProducts: ['Tài khoản thanh toán', 'Thẻ ghi nợ'],
    attributes: {
      mucDichVay: 'Không vay, cần hạn mức thẻ tín dụng',
      nguonTraNo: 'Lương 42 triệu/tháng qua tài khoản MSB',
      tinhTrangPhapLy: 'Hồ sơ đầy đủ',
      nganHangDangSoSanh: 'Đang dùng thẻ của hai ngân hàng khác',
    },
    signals: [{ type: 'need', content: 'Muốn mở thẻ tín dụng hạn mức cao', daysAgo: 13 }],
  },
  {
    key: 'hong_son',
    name: 'Bùi Hồng Sơn',
    contactName: 'Anh Sơn',
    contactPhone: '0983445511',
    revenue: 660_000_000,
    relationStage: 'Đang làm hồ sơ',
    currentProducts: ['Tài khoản thanh toán'],
    attributes: {
      mucDichVay: 'Mua đất nền tại Hoài Đức',
      taiSanBaoDam: 'Sổ đỏ nhà đang ở, đang thế chấp nơi khác',
      nguonTraNo: 'Lương 38 triệu/tháng và cho thuê một phòng trọ',
      tinhTrangPhapLy: 'Chờ xác nhận dư nợ tại ngân hàng đang thế chấp',
      nganHangDangSoSanh: 'Ngân hàng đang thế chấp, MSB',
    },
    signals: [{ type: 'documents', content: 'Sổ đỏ đang thế chấp nơi khác', daysAgo: 19 }],
  },
  {
    key: 'kim_dung',
    name: 'Nguyễn Kim Dung',
    contactName: 'Cô Dung',
    contactPhone: '0913228844',
    revenue: 360_000_000,
    relationStage: 'Khách hàng lâu năm',
    currentProducts: ['Tài khoản thanh toán', 'Tiết kiệm', 'Bảo hiểm'],
    attributes: {
      mucDichVay: 'Không vay, gửi tiết kiệm và mua bảo hiểm',
      nguonTraNo: 'Lương hưu và cho thuê mặt bằng',
      tinhTrangPhapLy: 'Khách lâu năm, hồ sơ đầy đủ',
      nganHangDangSoSanh: 'Trung thành với MSB',
    },
    signals: [{ type: 'other', content: 'Giới thiệu thêm hai người thân mở tài khoản', daysAgo: 28 }],
  },
  {
    key: 'anh_tuan',
    name: 'Hoàng Anh Tuấn',
    contactName: 'Anh Tuấn',
    contactPhone: '0961335577',
    revenue: 300_000_000,
    relationStage: 'Mới tiếp cận',
    currentProducts: [],
    attributes: {
      mucDichVay: 'Vốn mở cửa hàng điện máy',
      taiSanBaoDam: 'Chưa xác định, đang cân nhắc thế chấp nhà bố mẹ',
      nguonTraNo: 'Doanh thu cửa hàng dự kiến, chưa có lịch sử',
      tinhTrangPhapLy: 'Chưa nộp giấy tờ',
      nganHangDangSoSanh: 'Đang hỏi ba ngân hàng',
    },
    signals: [{ type: 'need', content: 'Hỏi vay kinh doanh nhỏ 500 triệu', daysAgo: 2 }],
  },
  {
    key: 'thanh_thuy',
    name: 'Vũ Thanh Thuỷ',
    contactName: 'Chị Thuỷ',
    contactPhone: '0929776655',
    revenue: 336_000_000,
    relationStage: 'Đang giao dịch',
    currentProducts: ['Tài khoản thanh toán', 'Chi lương'],
    attributes: {
      mucDichVay: 'Không vay, cần thẻ tín dụng để chi tiêu',
      nguonTraNo: 'Lương 28 triệu/tháng, nhận qua MSB',
      tinhTrangPhapLy: 'Hồ sơ đầy đủ',
      nganHangDangSoSanh: 'Chưa mở thẻ ở đâu',
    },
    signals: [{ type: 'product_gap', content: 'Nhận lương qua MSB nhưng chưa dùng thẻ tín dụng', daysAgo: 15 }],
  },
]

/** The branch's month, as a table.
 *
 *  Shaped after the real report rather than after a demo script: most leads
 *  are pushed in from a campaign, most of those have been called, a smaller
 *  number reached advice, and only a handful landed. The conversion rate that
 *  falls out is a few percent, which is what the branch actually runs at — a
 *  seed where half the leads convert would make every screen look wrong to
 *  the people who know the numbers.
 *
 *  Hà is deliberately behind her rate and Hải ahead of his. A team lead's
 *  screen with nothing to chase demonstrates nothing.
 *
 *  Every `*DaysAgo` is replayed through the real services and then stamped
 *  back, so the audit trail, the waiting times and the "N ngày chưa liên hệ"
 *  counters are all measured rather than typed. */
export const DEALS: SeedDeal[] = [
  /* ── Hà · doanh nghiệp SSE ─────────────────────────────────────────────
   * Twenty-three leads, two landed. Behind the 6% she is carrying.        */

  {
    /** The walkthrough from the brief: money arrives and leaves again. */
    customer: 'ha_an',
    product: 'od',
    need: 'Bổ sung vốn nhập hàng mùa cao điểm quý IV',
    value: 5_000_000_000,
    reach: 'advised',
    blockerCode: 'rate',
    blockerNote: 'VCB chào 7,9% năm đầu, khách đang so',
    nextAction: 'Trình xin ưu đãi 0,3% rồi báo lại chị Hà',
    missingInfo: ['Báo cáo tài chính soát xét 2025'],
    dueInDays: 6,
    openedDaysAgo: 34,
    contactedDaysAgo: 31,
    advisedDaysAgo: 22,
  },
  {
    customer: 'ha_an',
    product: 'casa',
    need: 'Chuyển dòng tiền về tài khoản MSB',
    value: 300_000_000,
    reach: 'contacted',
    nextAction: 'Gửi bảng phí so sánh với ngân hàng đang dùng',
    dueInDays: 11,
    openedDaysAgo: 34,
    contactedDaysAgo: 30,
  },
  {
    customer: 'minh_phat',
    product: 'loan',
    need: 'Vay đầu tư dây chuyền đóng gói',
    value: 8_000_000_000,
    reach: 'advised',
    outcome: 'won',
    outcomeReason: 'Giải ngân đợt một ngày 08.09, hồ sơ đủ',
    sold: [{ product: 'loan', amount: 8_000_000_000 }],
    confirmed: true,
    confirmNote: 'Đã đối chiếu hợp đồng tín dụng và biên bản giải ngân, khớp',
    openedDaysAgo: 41,
    contactedDaysAgo: 39,
    advisedDaysAgo: 30,
    closedDaysAgo: 12,
    confirmedDaysAgo: 9,
  },
  {
    customer: 'minh_phat',
    product: 'card',
    need: 'Thẻ tín dụng doanh nghiệp cho ban giám đốc',
    value: 200_000_000,
    reach: 'contacted',
    nextAction: 'Chờ khách gửi danh sách người dùng thẻ',
    dueInDays: 3,
    openedDaysAgo: 24,
    contactedDaysAgo: 20,
  },
  {
    customer: 'thanh_binh',
    product: 'od',
    need: 'Hạn mức thấu chi cho vòng quay hàng tháng',
    value: 2_000_000_000,
    reach: 'advised',
    blockerCode: 'documents',
    blockerNote: 'Chưa chứng minh được dòng tiền vào đều',
    nextAction: 'Xin sao kê 12 tháng tài khoản ngân hàng khác',
    missingInfo: ['Sao kê 12 tháng'],
    dueInDays: -4,
    openedDaysAgo: 38,
    contactedDaysAgo: 35,
    advisedDaysAgo: 26,
  },
  {
    customer: 'an_khang',
    product: 'usl',
    need: 'Vay tín chấp bổ sung vốn ngắn hạn',
    value: 900_000_000,
    reach: 'contacted',
    outcome: 'lost',
    outcomeReason: 'Khách chốt với Techcombank, lãi thấp hơn 0,8%',
    blockerCode: 'rate',
    blockerNote: 'Techcombank chào 9,2%, mình 10%',
    openedDaysAgo: 45,
    contactedDaysAgo: 42,
    closedDaysAgo: 28,
    confirmedDaysAgo: 25,
    confirmed: true,
    confirmNote: 'Có xác nhận của khách qua email, ghi nhận mất vì lãi suất',
  },
  {
    customer: 'dong_tien',
    product: 'loan',
    need: 'Vay mở rộng kho tại Long Biên',
    value: 6_500_000_000,
    reach: 'advised',
    nextAction: 'Chờ định giá tài sản bảo đảm',
    missingInfo: ['Chứng thư định giá'],
    dueInDays: 14,
    openedDaysAgo: 29,
    contactedDaysAgo: 27,
    advisedDaysAgo: 15,
  },
  {
    customer: 'hoang_long',
    product: 'casa',
    need: 'Chi lương cho 180 nhân sự',
    value: 900_000_000,
    reach: 'contacted',
    blockerCode: 'competitor',
    blockerNote: 'Đang dùng dịch vụ bên khác tới hết năm',
    nextAction: 'Hẹn lại tháng 12 khi hợp đồng cũ hết hạn',
    dueInDays: 21,
    openedDaysAgo: 33,
    contactedDaysAgo: 26,
  },
  {
    customer: 'viet_tin',
    product: 'od',
    need: 'Thấu chi theo hợp đồng đầu ra',
    value: 1_500_000_000,
    reach: 'contacted',
    nextAction: 'Gọi lại sau khi khách họp nội bộ',
    dueInDays: 2,
    openedDaysAgo: 19,
    contactedDaysAgo: 12,
  },
  {
    customer: 'nam_son',
    product: 'loan',
    need: 'Vay mua xe tải phục vụ vận chuyển',
    value: 3_200_000_000,
    reach: 'contacted',
    outcome: 'lost',
    outcomeReason: 'Khách hoãn đầu tư sang năm sau',
    blockerCode: 'customer_hesitation',
    openedDaysAgo: 40,
    contactedDaysAgo: 36,
    closedDaysAgo: 19,
  },
  {
    customer: 'bao_ngoc',
    product: 'insurance',
    need: 'Bảo hiểm hàng hoá trong kho',
    value: 150_000_000,
    reach: 'new',
    openedDaysAgo: 16,
  },
  {
    customer: 'tan_phu',
    product: 'od',
    need: 'Hạn mức thấu chi 1 tỷ',
    value: 1_000_000_000,
    reach: 'new',
    openedDaysAgo: 13,
  },
  {
    customer: 'thanh_binh',
    product: 'card',
    need: 'Thẻ tín dụng cho đội mua hàng',
    value: 120_000_000,
    reach: 'new',
    openedDaysAgo: 11,
  },
  {
    customer: 'dong_tien',
    product: 'casa',
    need: 'Tài khoản thu hộ cho hệ thống đại lý',
    value: 400_000_000,
    reach: 'new',
    openedDaysAgo: 10,
  },
  {
    customer: 'hoang_long',
    product: 'usl',
    need: 'Vay tín chấp theo doanh thu',
    value: 700_000_000,
    reach: 'new',
    openedDaysAgo: 9,
  },
  {
    customer: 'viet_tin',
    product: 'insurance',
    need: 'Bảo hiểm cháy nổ bắt buộc',
    value: 80_000_000,
    reach: 'new',
    openedDaysAgo: 8,
  },
  {
    customer: 'an_khang',
    product: 'casa',
    need: 'Mở tài khoản thanh toán chính',
    value: 200_000_000,
    reach: 'new',
    openedDaysAgo: 7,
  },
  {
    customer: 'nam_son',
    product: 'card',
    need: 'Thẻ tín dụng doanh nghiệp',
    value: 150_000_000,
    reach: 'new',
    openedDaysAgo: 6,
  },
  {
    customer: 'bao_ngoc',
    product: 'od',
    need: 'Thấu chi mùa vụ',
    value: 1_200_000_000,
    reach: 'contacted',
    nextAction: 'Khách hẹn gọi lại tuần sau',
    dueInDays: 5,
    openedDaysAgo: 15,
    contactedDaysAgo: 4,
  },
  {
    customer: 'tan_phu',
    product: 'loan',
    need: 'Vay bổ sung vốn lưu động',
    value: 2_800_000_000,
    reach: 'contacted',
    nextAction: 'Đang chờ khách gửi phương án kinh doanh',
    missingInfo: ['Phương án kinh doanh 2026'],
    dueInDays: 9,
    openedDaysAgo: 21,
    contactedDaysAgo: 18,
  },
  {
    customer: 'ha_an',
    product: 'card',
    need: 'Thẻ tín dụng cho nhân sự đi công tác',
    value: 100_000_000,
    reach: 'new',
    openedDaysAgo: 5,
  },
  {
    customer: 'minh_phat',
    product: 'insurance',
    need: 'Bảo hiểm dây chuyền mới lắp',
    value: 220_000_000,
    reach: 'new',
    openedDaysAgo: 4,
  },
  {
    customer: 'thanh_binh',
    product: 'usl',
    need: 'Vay tín chấp ngắn hạn 500 triệu',
    value: 500_000_000,
    reach: 'new',
    source: 'manual',
    openedDaysAgo: 3,
  },

  /* ── Hải · khách hàng cá nhân ──────────────────────────────────────────
   * Twenty-three leads, four landed. Comfortably past his rate.           */

  {
    /** The other walkthrough: a mortgage held up on rate. */
    customer: 'van_minh',
    product: 'loan',
    need: 'Mua căn hộ, cần giải ngân trước hạn hợp đồng',
    value: 2_000_000_000,
    reach: 'advised',
    blockerCode: 'rate',
    blockerNote: 'VCB chào 7,9% năm đầu, khách so sánh',
    nextAction: 'Báo khách mức lãi mới, chốt hồ sơ trước 30.09',
    dueInDays: 8,
    openedDaysAgo: 30,
    contactedDaysAgo: 28,
    advisedDaysAgo: 17,
  },
  {
    customer: 'thu_ha',
    product: 'loan',
    need: 'Vay mua nhà đất tại Gia Lâm',
    value: 3_500_000_000,
    reach: 'advised',
    outcome: 'won',
    outcomeReason: 'Giải ngân 15.09, hồ sơ đầy đủ',
    sold: [
      { product: 'loan', amount: 3_500_000_000 },
      { product: 'card', amount: 0 },
    ],
    confirmed: true,
    confirmNote: 'Khớp hợp đồng thế chấp và phiếu giải ngân',
    openedDaysAgo: 37,
    contactedDaysAgo: 35,
    advisedDaysAgo: 24,
    closedDaysAgo: 5,
    confirmedDaysAgo: 3,
  },
  {
    customer: 'quoc_dat',
    product: 'loan',
    need: 'Mua xe phục vụ kinh doanh',
    value: 750_000_000,
    reach: 'advised',
    blockerCode: 'documents',
    blockerNote: 'Thu nhập kinh doanh chưa chứng minh được',
    nextAction: 'Xin sao kê tài khoản kinh doanh 12 tháng',
    missingInfo: ['Sao kê tài khoản kinh doanh 12 tháng'],
    dueInDays: -2,
    openedDaysAgo: 26,
    contactedDaysAgo: 24,
    advisedDaysAgo: 13,
  },
  {
    customer: 'mai_anh',
    product: 'card',
    need: 'Thẻ tín dụng hạn mức 200 triệu',
    value: 200_000_000,
    reach: 'advised',
    outcome: 'won',
    outcomeReason: 'Phát hành thẻ ngày 14.09',
    sold: [{ product: 'card', amount: 0 }],
    openedDaysAgo: 23,
    contactedDaysAgo: 21,
    advisedDaysAgo: 12,
    closedDaysAgo: 6,
  },
  {
    customer: 'tuan_kiet',
    product: 'usl',
    need: 'Vay tín chấp theo lương',
    value: 400_000_000,
    reach: 'advised',
    outcome: 'won',
    outcomeReason: 'Duyệt và giải ngân trong ngày',
    sold: [{ product: 'usl', amount: 400_000_000 }],
    openedDaysAgo: 20,
    contactedDaysAgo: 19,
    advisedDaysAgo: 11,
    closedDaysAgo: 2,
  },
  {
    customer: 'ngoc_lan',
    product: 'casa',
    need: 'Mở tài khoản nhận lương',
    value: 60_000_000,
    reach: 'advised',
    outcome: 'won',
    outcomeReason: 'Mở tài khoản và đăng ký nhận lương qua MSB',
    sold: [
      { product: 'casa', amount: 60_000_000 },
      { product: 'card', amount: 0 },
    ],
    openedDaysAgo: 18,
    contactedDaysAgo: 17,
    advisedDaysAgo: 10,
    closedDaysAgo: 1,
  },
  {
    customer: 'hong_son',
    product: 'loan',
    need: 'Vay sửa nhà',
    value: 900_000_000,
    reach: 'contacted',
    outcome: 'lost',
    outcomeReason: 'Khách vay được của người nhà, không cần ngân hàng',
    blockerCode: 'customer_hesitation',
    openedDaysAgo: 32,
    contactedDaysAgo: 29,
    closedDaysAgo: 14,
  },
  {
    customer: 'kim_dung',
    product: 'insurance',
    need: 'Bảo hiểm nhân thọ kèm khoản vay',
    value: 120_000_000,
    reach: 'contacted',
    nextAction: 'Gửi bảng quyền lợi cho khách xem',
    dueInDays: 4,
    openedDaysAgo: 22,
    contactedDaysAgo: 16,
  },
  {
    customer: 'anh_tuan',
    product: 'loan',
    need: 'Vay mua căn hộ thứ hai',
    value: 4_200_000_000,
    reach: 'advised',
    nextAction: 'Chờ khách chốt căn, đã duyệt sơ bộ hạn mức',
    dueInDays: 17,
    openedDaysAgo: 27,
    contactedDaysAgo: 25,
    advisedDaysAgo: 8,
  },
  {
    customer: 'thanh_thuy',
    product: 'usl',
    need: 'Vay tín chấp 300 triệu',
    value: 300_000_000,
    reach: 'contacted',
    blockerCode: 'policy',
    blockerNote: 'Thu nhập chưa đạt ngưỡng tối thiểu của sản phẩm',
    nextAction: 'Tư vấn chuyển sang sản phẩm có tài sản bảo đảm',
    dueInDays: 1,
    openedDaysAgo: 25,
    contactedDaysAgo: 23,
  },
  {
    customer: 'van_minh',
    product: 'card',
    need: 'Thẻ tín dụng đi kèm khoản vay',
    value: 150_000_000,
    reach: 'new',
    openedDaysAgo: 12,
  },
  {
    customer: 'thu_ha',
    product: 'insurance',
    need: 'Bảo hiểm tài sản thế chấp',
    value: 90_000_000,
    reach: 'new',
    openedDaysAgo: 11,
  },
  {
    customer: 'quoc_dat',
    product: 'casa',
    need: 'Tài khoản thanh toán cho hộ kinh doanh',
    value: 50_000_000,
    reach: 'new',
    openedDaysAgo: 10,
  },
  {
    customer: 'mai_anh',
    product: 'usl',
    need: 'Vay tiêu dùng tín chấp',
    value: 250_000_000,
    reach: 'new',
    openedDaysAgo: 9,
  },
  {
    customer: 'tuan_kiet',
    product: 'casa',
    need: 'Tài khoản tiết kiệm online',
    value: 500_000_000,
    reach: 'new',
    openedDaysAgo: 8,
  },
  {
    customer: 'ngoc_lan',
    product: 'insurance',
    need: 'Bảo hiểm sức khoẻ gia đình',
    value: 70_000_000,
    reach: 'new',
    openedDaysAgo: 7,
  },
  {
    customer: 'hong_son',
    product: 'card',
    need: 'Thẻ tín dụng hạn mức 100 triệu',
    value: 100_000_000,
    reach: 'new',
    openedDaysAgo: 6,
  },
  {
    customer: 'kim_dung',
    product: 'casa',
    need: 'Chuyển lương về MSB',
    value: 80_000_000,
    reach: 'new',
    openedDaysAgo: 5,
  },
  {
    customer: 'anh_tuan',
    product: 'insurance',
    need: 'Bảo hiểm khoản vay',
    value: 110_000_000,
    reach: 'new',
    openedDaysAgo: 4,
  },
  {
    customer: 'thanh_thuy',
    product: 'card',
    need: 'Thẻ tín dụng hạn mức nhỏ',
    value: 60_000_000,
    reach: 'new',
    openedDaysAgo: 3,
  },
  {
    customer: 'van_minh',
    product: 'casa',
    need: 'Tài khoản thanh toán trả nợ tự động',
    value: 40_000_000,
    reach: 'contacted',
    nextAction: 'Mở cùng lúc với hồ sơ vay',
    dueInDays: 8,
    openedDaysAgo: 14,
    contactedDaysAgo: 2,
  },
  {
    customer: 'thu_ha',
    product: 'casa',
    need: 'Tài khoản nhận tiền cho thuê nhà',
    value: 45_000_000,
    reach: 'new',
    source: 'manual',
    openedDaysAgo: 2,
  },
  {
    customer: 'mai_anh',
    product: 'loan',
    need: 'Vay mua ô tô trả góp',
    value: 800_000_000,
    reach: 'new',
    source: 'manual',
    openedDaysAgo: 1,
  },
]

/** What the branch is carrying, and what each salesperson is.
 *
 *  A conversion rate rather than a money number, because that is the figure
 *  the branch's own report is built around — 6% CR, and a GAP column that is
 *  leads × 6% minus wins. The money target sits beside it rather than instead
 *  of it: a rate says nothing about whether the deals were worth having.
 *
 *  Placeholders until Đức Anh signs off the real ones. */
export const PERIOD = '2026-Q3'

/** Basis points: 600 is 6%. */
export const CR_TARGETS = {
  unit: 600,
  sse: 600,
  rb: 600,
  saleSse: 600,
  saleRb: 600,
}

export const VALUE_TARGETS = {
  unit: 40_000_000_000,
  sse: 24_000_000_000,
  rb: 16_000_000_000,
  saleSse: 12_000_000_000,
  saleRb: 8_000_000_000,
}
