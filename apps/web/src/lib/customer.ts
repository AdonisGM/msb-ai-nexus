/** Labels and tones for a customer file, shared by the detail screen and the
 *  edit form so the two describe the same field the same way. */

/** The per-segment keys the sales team actually uses, with a Vietnamese label
 *  and a fixed reading order.
 *
 *  `attributes` is an open map — the whole point of it is that a new field
 *  needs no migration — so this is a display convention, never a schema. A key
 *  absent from here still renders, under its own name. */
export const ATTRIBUTE_LABELS: Record<string, string> = {
  doanhSoTienVao: 'Doanh số tiền vào',
  tyLeChuyenSangNHKhac: 'Chuyển sang ngân hàng khác',
  mucDoDungSanPhamMSB: 'Mức độ dùng sản phẩm MSB',
  nhuCauVonKinhDoanh: 'Nhu cầu vốn kinh doanh',
  phuongAnKinhDoanh: 'Phương án kinh doanh',
  mucDichVay: 'Mục đích vay',
  taiSanBaoDam: 'Tài sản bảo đảm',
  nguonTraNo: 'Nguồn trả nợ',
  tinhTrangPhapLy: 'Tình trạng pháp lý',
  nganHangDangSoSanh: 'Ngân hàng đang so sánh',
}

/** The keys each segment is normally filled in with, offered as one-tap
 *  suggestions on the edit form. Somebody typing `nguonTraNo` by hand will
 *  eventually type `nguontraNo`, and then it reads as a different field. */
export const SEGMENT_KEYS: Record<'sse' | 'rb', string[]> = {
  sse: [
    'doanhSoTienVao',
    'tyLeChuyenSangNHKhac',
    'mucDoDungSanPhamMSB',
    'nhuCauVonKinhDoanh',
    'phuongAnKinhDoanh',
  ],
  rb: [
    'mucDichVay',
    'taiSanBaoDam',
    'nguonTraNo',
    'tinhTrangPhapLy',
    'nganHangDangSoSanh',
  ],
}

/** Two segments, two tones, so a mixed list sorts itself out at a glance
 *  without anyone reading the column. */
export const SEGMENT_TONE: Record<'sse' | 'rb', { fg: string; bg: string }> = {
  sse: { fg: 'var(--info)', bg: 'var(--info-soft)' },
  /** Not green. Green means "won" on every other badge in this app, and a
   *  segment that borrowed it would read as an outcome on a row that also
   *  carries a real one. */
  rb: { fg: 'var(--pending)', bg: 'var(--pending-soft)' },
}
