import { useCallback, useMemo, useState } from 'react'
import type { DateFilter, DatePreset } from './dates'

/** Số dòng mỗi trang.
 *
 *  Mười, cho mọi bảng. Chọn theo màn hình chứ không theo dữ liệu: mười dòng vừa
 *  đúng một khung nhìn nên người đọc thấy hết bảng mà không phải cuộn, và thanh
 *  phân trang luôn nằm trong tầm mắt thay vì trôi xuống dưới.
 *
 *  Ai cần nhiều hơn thì đổi ngay trên thanh phân trang, và lựa chọn ấy giữ
 *  nguyên trong suốt phiên làm việc. */
export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZES = [10, 25, 50, 100]

/** Kỳ mặc định: cả sổ. */
export const ALL_DATES: DateFilter = { preset: 'all', from: '', to: '' }

export type TableState<F> = {
  /** Đếm từ 1, như người đọc vẫn đọc. */
  page: number
  size: number
  filters: F
  setPage: (p: number) => void
  setSize: (n: number) => void
  /** Đổi một ô lọc và quay về trang đầu. Gộp hai việc vào một chỗ vì tách ra thì
   *  trang nào cũng phải tự nhớ gọi setPage(1), và trang nào quên thì gõ vào ô
   *  tìm xong rơi vào một trang trống. */
  set: <K extends keyof F>(key: K, value: F[K]) => void
  /** Cắt đúng trang đang xem, dùng cho bảng còn chia trang tại chỗ. */
  slice: <T>(rows: T[]) => T[]
  /** Đưa mọi ô lọc về mặc định và quay lại trang đầu. Nút "Bỏ lọc" của bảng
   *  nào cũng làm đúng việc này, và bảng nào tự làm lấy thì sớm muộn quên
   *  setPage(1) rồi rơi vào một trang trống. */
  reset: () => void
  /** Các cỡ trang bảng này cho chọn: ba cỡ chuẩn, cộng cỡ riêng của nó nếu có.
   *
   *  Cố định theo bảng, không đổi theo cỡ đang dùng. Tính từ cỡ hiện tại thì ô
   *  chọn tự bỏ đi mất chính mình: bảng cỡ 12 đổi lên 25 là 12 rơi khỏi danh
   *  sách, ngưỡng bày ô cũng nhích lên theo, ô biến mất và không còn đường về. */
  sizes: number[]
}

/** Trang, cỡ trang và bộ lọc của một bảng, giữ trong state của trang.
 *
 *  Không đụng tới URL: người dùng không cần gửi đường dẫn cho ai, nên đổi lại
 *  F5 là về mặc định. Bù lại mỗi bảng khai đúng những ô lọc nó dùng, thay vì
 *  nhận chung một thanh lọc vẽ sáu ô cho mọi trang.
 *
 *  Đây cũng là chỗ nối sang đợt sau: cùng một khối {page, size, filters}, bảng
 *  nhỏ thì cắt tại chỗ bằng `slice`, bảng lớn thì gửi xuống làm tham số API. */
export function useTableState<F extends Record<string, unknown>>(
  initialFilters: F,
  initialSize: number = DEFAULT_PAGE_SIZE,
): TableState<F> {
  const [page, setPage] = useState(1)
  const [size, setSizeRaw] = useState(initialSize)
  const [filters, setFilters] = useState<F>(initialFilters)

  const set = useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }, [])

  const reset = useCallback(() => {
    setFilters(initialFilters)
    setPage(1)
    /** Ô lọc ban đầu thường là một literal viết thẳng ở chỗ gọi, nên mỗi lần
     *  render là một object mới. Phụ thuộc vào nó thì gõ một phím là bảng tự
     *  reset. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Đổi cỡ trang cũng về trang đầu: trang 12 của cỡ 25 không có nghĩa gì khi
   *  chuyển sang cỡ 100. */
  const setSize = useCallback((n: number) => {
    setSizeRaw(n)
    setPage(1)
  }, [])

  const slice = useCallback(
    <T,>(rows: T[]) => {
      const cur = clampPage(page, rows.length, size)
      return rows.slice((cur - 1) * size, cur * size)
    },
    [page, size],
  )

  const sizes = useMemo(
    () =>
      PAGE_SIZES.includes(initialSize)
        ? PAGE_SIZES
        : [initialSize, ...PAGE_SIZES].sort((a, b) => a - b),
    [initialSize],
  )

  return useMemo(
    () => ({ page, size, filters, setPage, setSize, set, reset, slice, sizes }),
    [page, size, filters, set, reset, setSize, slice, sizes],
  )
}

/** Trang thật sự đang xem.
 *
 *  Danh sách co lại — vì lọc chặt hơn, vì vừa xoá một dòng — thì số trang đang
 *  giữ có thể vượt quá số trang còn lại. Hàm này thuần tuý, nên chỗ cắt dữ liệu
 *  và chỗ vẽ chân bảng gọi nó với cùng đầu vào là ra cùng kết quả, không phải
 *  đồng bộ state giữa hai nơi. */
export function clampPage(page: number, total: number, size: number): number {
  return Math.min(Math.max(1, page), pageCountOf(total, size))
}

export function pageCountOf(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size))
}

/** Đổi mốc thì bỏ luôn khoảng ngày gõ tay, và ngược lại: hai thứ nói cùng một
 *  chuyện nên để cả hai cùng bật thì không biết cái nào thắng. */
export function withPreset(preset: DatePreset): DateFilter {
  return { preset, from: '', to: '' }
}
