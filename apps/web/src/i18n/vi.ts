/** Every word the user reads, in one place.
 *
 *  The API speaks codes — `sale`, `escalated_to_bm`, `invalid_credentials` —
 *  and this turns them into Vietnamese. Keeping the whole vocabulary here is
 *  what makes another language a second file rather than a sweep through the
 *  screens, and it is why no component is allowed to type a Vietnamese string
 *  inline.
 *
 *  Keys are named after the domain, not the screen: `opportunity.status.x`
 *  rather than `leadPage.label3`. Screens get rearranged; the domain does not. */
export const vi = {
  'app.name': 'MSB AI Nexus',
  /** Just the product half, for where the bank's own mark sits beside it. */
  'app.product': 'AI Nexus',
  'app.tagline': 'Nền tảng AI điều hành bán hàng đa tầng',

  'nav.customers': 'Khách hàng',
  'nav.dashboard': 'Số liệu',
  'nav.users': 'Người dùng',
  'nav.tia': 'Trợ lý Tia',
  'nav.opportunities': 'Cơ hội',
  'nav.team': 'Nhóm của tôi',
  'nav.unit': 'Đơn vị',
  'nav.targets': 'Chỉ tiêu',
  'nav.settings': 'Cài đặt',
  'nav.openMenu': 'Mở menu',
  'nav.closeMenu': 'Đóng menu',

  'app.copyright': '© 2026 MSB AI Nexus',

  'theme.light': 'Sáng',
  'theme.dark': 'Tối',
  'theme.toLight': 'Chuyển nền sáng',
  'theme.toDark': 'Chuyển nền tối',

  'auth.welcome': 'Chào mừng bạn quay lại',
  'auth.welcomeNote':
    'Khách hàng, cơ hội và việc cần làm hôm nay của bạn vẫn ở đây. Đăng nhập để xem tiếp.',
  'auth.cardTitle': 'Đăng nhập bằng tài khoản',
  'auth.cardNote':
    'Dùng mã tài khoản được cấp và mật khẩu của bạn. Hệ thống chưa mở đăng nhập bằng thiết bị.',
  'auth.codePlaceholder': 'SALE-RB-01',
  'auth.forgot': 'Quên mật khẩu',
  'auth.contactAdmin': 'Liên hệ quản trị',
  'auth.issuedNote':
    'Tài khoản do quản trị hệ thống cấp, không tự đăng ký. Bản chạy thử mở cho năm tài khoản vận hành của đội AI Nexus.',
  'auth.signIn': 'Đăng nhập',
  'auth.signOut': 'Đăng xuất',
  'auth.code': 'Mã tài khoản',
  'auth.password': 'Mật khẩu',
  'auth.signingIn': 'Đang đăng nhập…',

  'role.sale': 'Nhân viên kinh doanh',
  'role.team_lead': 'Trưởng nhóm',
  'role.bm': 'Giám đốc đơn vị',
  'role.admin': 'Quản trị hệ thống',

  'segment.sse': 'Khách hàng doanh nghiệp SSE',
  'segment.rb': 'Khách hàng cá nhân',
  'segment.sse.short': 'SSE',
  'segment.rb.short': 'Cá nhân',

  'level.cv1': 'Chuyên viên bậc 1',
  'level.cv2': 'Chuyên viên bậc 2',
  'level.cv3': 'Chuyên viên bậc 3',
  'level.cvc': 'Chuyên viên chính',
  'level.tn': 'Trưởng nhóm',
  'level.gd': 'Giám đốc',

  /** The customer's journey. */
  /* Phễu — ba bước, do chính người bán đẩy, không ai duyệt. */
  'stage.new': 'Chưa xử lý',
  'stage.contacted': 'Đã tiếp cận',
  'stage.advised': 'Đã tư vấn',

  /** How far the paperwork has come inside MSB. Nobody picks one of these from
   *  a list — they are the consequence of pressing a button. */
  /* Đối chiếu của trưởng nhóm. Chạy song song với kết quả, không chặn nó. */
  'confirm.pending': 'Chờ đối chiếu',
  'confirm.done': 'Đã đối chiếu',

  /** The buttons. */
  'action.contact': 'Đánh dấu đã tiếp cận',
  'action.advise': 'Đánh dấu đã tư vấn',
  'action.win': 'Chốt thành công',
  'action.lose': 'Chốt thất bại',
  'action.confirm': 'Xác nhận đối chiếu',
  'action.reopen': 'Mở lại cơ hội',

  /** Câu báo sau khi làm xong, nói đúng việc vừa xảy ra chứ không phải
   *  "thành công" chung chung — người dùng cần biết cơ hội giờ nằm ở đâu. */
  'actionDone.contact': 'Đã ghi mốc tiếp cận',
  'actionDone.advise': 'Đã ghi mốc tư vấn',
  'actionDone.win': 'Đã ghi nhận thành công, báo cáo tính ngay',
  'actionDone.lose': 'Đã ghi nhận thất bại',
  'actionDone.confirm': 'Đã xác nhận đối chiếu',
  'actionDone.reopen': 'Đã mở lại cơ hội',

  'actions.none': 'Không còn thao tác nào trên cơ hội này',
  'actions.reason': 'Lý do',
  'actions.reasonHint': 'Lý do được lưu vào lịch sử và người nhận đọc được.',
  'actions.send': 'Xác nhận',
  'actions.working': 'Đang xử lý…',
  'actions.hint.win': 'Đã giải ngân, khách nhận tiền ngày 28.09',
  'actions.hint.lose': 'Khách chọn ngân hàng khác vì lãi suất thấp hơn',
  'actions.hint.confirm': 'Đã đối chiếu hợp đồng và phiếu giải ngân, khớp',
  'actions.hint.reopen': 'Ghi nhầm khách, cần mở lại để sửa',
  'actions.sub.contact': 'Ghi mốc tiếp cận lần đầu. Mốc ghi một lần, gọi lại sau không đè lên.',
  'actions.sub.advise': 'Ghi mốc đã tư vấn sản phẩm.',
  'actions.sub.win': 'Báo cáo tính ngay khi bấm. Việc đối chiếu của trưởng nhóm chạy song song, không chặn bước này.',
  'actions.sub.lose': 'Lý do thất bại là thứ trưởng nhóm đọc để biết chi nhánh đang thua vì cái gì.',
  'actions.sub.confirm': 'Xác nhận đã đối chiếu với hồ sơ giấy bên ngoài. Không làm đổi con số nào.',
  'actions.sub.reopen': 'Đưa cơ hội trở lại đang mở. Sản phẩm đã bán sẽ bị gỡ khỏi số liệu.',
  'actions.sold': 'Bán được sản phẩm gì',
  'actions.soldHint': 'Một cơ hội bán kèm được nhiều sản phẩm. Số tiền có thể là 0, ví dụ thẻ miễn phí, nhưng không được bỏ trống.',
  'actions.soldRequired': 'Chọn ít nhất một sản phẩm bán được',
  'actions.amountRequired': 'Nhập số tiền cho mọi sản phẩm đã chọn, số 0 vẫn hợp lệ',

  /* Sản phẩm bán được — bộ đóng, vì báo cáo chi nhánh là một cột một sản phẩm. */
  'product.card': 'Thẻ',
  'product.od': 'Thấu chi',
  'product.usl': 'Vay tín chấp',
  'product.loan': 'Vay có tài sản',
  'product.casa': 'Tài khoản',
  'product.insurance': 'Bảo hiểm',
  'product.other': 'Khác',

  /* Vết xử lý — mỗi việc đã xảy ra với một cơ hội. */
  'history.created': 'Tạo cơ hội',
  'history.assigned': 'Giao cho sale',
  'history.contacted': 'Đã tiếp cận',
  'history.advised': 'Đã tư vấn',
  'history.won': 'Chốt thành công',
  'history.lost': 'Chốt thất bại',
  'history.reopened': 'Mở lại',
  'history.confirmed': 'Đối chiếu',
  'history.edited': 'Sửa thông tin',

  'blocker.rate': 'Lãi suất',
  'blocker.speed': 'Tốc độ xử lý',
  'blocker.experience': 'Trải nghiệm',
  'blocker.documents': 'Hồ sơ',
  'blocker.collateral': 'Tài sản bảo đảm',
  'blocker.policy': 'Cơ chế, chính sách',
  'blocker.competitor': 'Ngân hàng khác',
  'blocker.customer_hesitation': 'Khách còn do dự',
  'blocker.other': 'Khác',

  'signal.cash_flow': 'Dòng tiền',
  'signal.product_gap': 'Thiếu sản phẩm',
  'signal.need': 'Nhu cầu',
  'signal.competition': 'Cạnh tranh',
  'signal.deadline': 'Thời hạn',
  'signal.documents': 'Hồ sơ',
  'signal.other': 'Khác',

  'outcome.open': 'Đang mở',
  'outcome.won': 'Thành công',
  'outcome.lost': 'Không thành công',

  'field.value': 'Giá trị cơ hội',
  'field.stage': 'Giai đoạn',
  'field.dueDate': 'Thời hạn',
  'field.winProbability': 'Xác suất',
  'field.owner': 'Phụ trách',
  'field.nextAction': 'Hành động tiếp theo',
  'field.blocker': 'Điểm nghẽn',
  'field.customer': 'Khách hàng',
  'field.product': 'Sản phẩm',
  'field.need': 'Nhu cầu',

  'common.all': 'Tất cả',
  'common.edit': 'Sửa thông tin',
  'common.cancel': 'Huỷ',
  'common.save': 'Lưu thay đổi',
  'common.unsaved': 'Có thay đổi chưa lưu',
  'common.autoGenerated': 'sinh tự động',
  'common.required': 'bắt buộc',
  'common.optional': 'không bắt buộc',

  'opportunities.unit': 'cơ hội',
  'opportunities.clickHint': 'nhấn vào dòng để mở luồng phê duyệt',
  'opportunities.empty': 'Chưa có cơ hội nào trên hồ sơ này',
  'opportunities.loadFailed': 'Không đọc được danh sách cơ hội',
  'opportunities.noNote': 'Chưa có ghi chú cho cơ hội này',
  'opportunities.add': '+ Cơ hội',
  'opportunities.newTitle': 'Cơ hội mới',
  'opportunities.newSubtitle': 'Mở dưới dạng nháp — trưởng nhóm chỉ thấy sau khi bạn xác nhận',
  'opportunities.create': 'Tạo cơ hội',
  'opportunities.creating': 'Đang tạo…',
  'opportunities.created': 'Đã tạo cơ hội, đang ở dạng nháp',

  'flow.title': 'Luồng phê duyệt',
  'flow.step': 'Bước',
  'flow.tier': 'Cấp',
  'flow.actor': 'Người xử lý',
  'flow.when': 'Ngâm',
  'flow.at': 'Lúc',
  'flow.result': 'Kết quả',
  'flow.sentUp': 'Chuyển lên',
  'flow.sentDown': 'Giao xuống',
  'flow.created': 'Tạo mới',
  'flow.edited': 'Sửa tại chỗ',
  'flow.sentBack': 'trả lại',
  'flow.empty': 'Chưa có bước phê duyệt nào',
  'flow.loadFailed': 'Không đọc được luồng phê duyệt',

  'field.bmDecision': 'Giám đốc duyệt',
  'field.blockerNote': 'Chi tiết điểm nghẽn',
  'field.supportNeeded': 'Hỗ trợ cần thiết',
  'field.missingInfo': 'Thông tin còn thiếu',
  'field.confirmedData': 'Dữ liệu đã xác nhận',

  'common.search': 'Tìm kiếm',

  'customers.attributes': 'Thông tin theo phân khúc',
  'customers.products': 'Sản phẩm đang dùng',
  'customers.noProducts': 'Chưa dùng sản phẩm nào của MSB',
  'customers.noAttributes': 'Chưa có thông tin bổ sung',
  'customers.signals': 'Dòng tín hiệu',
  'customers.note': 'Ghi chú',
  'customers.contactName': 'Người liên hệ',
  'customers.contactPhone': 'Điện thoại',
  'customers.updatedAt': 'Cập nhật',
  'customers.createdAt': 'Tạo lúc',
  'customers.revenue': 'Doanh số',
  'customers.productCount': 'Sản phẩm',
  'customers.owner': 'Nhân viên phụ trách',
  'customers.stage': 'Giai đoạn quan hệ',
  'customers.name': 'Tên khách hàng',
  'customers.code': 'Mã khách hàng',
  'customers.general': 'Thông tin chung',
  'customers.system': 'Hệ thống',
  'customers.editTitle': 'Chỉnh sửa khách hàng',
  'customers.saved': 'Đã lưu thay đổi',

  'signals.quickNote': 'Ghi chú nhanh',
  'signals.newTitle': 'Ghi nhận sau tiếp xúc',
  'signals.newSubtitle': 'Viết lại điều vừa nắm được về khách hàng',
  'signals.rawNote': 'Bạn vừa ghi nhận điều gì?',
  'signals.rawNotePlaceholder':
    'Vừa gặp khách. Khách cần vay 2 tỷ trước ngày 30/9, đang so lãi suất với ngân hàng khác và chưa quyết định.',
  'signals.rawNoteHint': 'Viết tự nhiên, giữ nguyên lời khách. Câu này được lưu lại đúng như bạn gõ.',
  'signals.type': 'Loại tín hiệu',
  'signals.content': 'Tóm tắt một dòng',
  'signals.contentPlaceholder': 'Để trống thì lấy luôn câu trên',
  'signals.observedAt': 'Ghi nhận ngày',
  'signals.save': 'Lưu tín hiệu',
  'signals.saving': 'Đang lưu…',
  'signals.saved': 'Đã ghi nhận tín hiệu',
  'signals.empty': 'Chưa ghi nhận tín hiệu nào',
  'signals.add': '+ Ghi nhận',
  'customers.saving': 'Đang lưu…',
  'customers.addProduct': 'Thêm sản phẩm, Enter để lưu',
  'customers.addAttribute': '+ Thêm thuộc tính',
  'customers.removeAttribute': 'Xoá thuộc tính',
  'customers.suggestedKeys': 'Key chuẩn của phân khúc chưa dùng',
  'customers.attributesHint':
    'Trường riêng theo phân khúc. Thêm key mới không cần đổi cấu trúc dữ liệu.',
  'customers.editDealsElsewhere':
    'Sửa cơ hội ở bảng ngoài trang chi tiết — mỗi cơ hội có luồng phê duyệt riêng.',
  'customers.searchPlaceholder': 'Tìm theo tên hoặc mã khách hàng',
  'customers.empty': 'Chưa có khách hàng nào',
  'customers.noMatch': 'Không tìm thấy khách hàng nào khớp',
  /** Ai đang xem quyết định thấy được gì, nên màn hình nói thẳng ra thay vì
   *  để người ta tự hỏi sao danh sách của đồng nghiệp lại dài hơn. */
  'customers.scope.sale': 'Khách hàng bạn đang phụ trách',
  'customers.scope.team_lead': 'Khách hàng của các nhân viên bạn quản lý',
  'customers.scope.bm': 'Toàn bộ khách hàng của đơn vị',
  'customers.scope.admin': 'Toàn bộ khách hàng, mọi đơn vị',
  'common.overdue': 'Quá hạn',
  'common.dueToday': 'Đến hạn hôm nay',
  'common.noDeadline': 'Chưa có hạn',
  'common.empty': 'Chưa có dữ liệu',
  'common.retry': 'Thử lại',
  'common.loading': 'Đang tải…',

  /** Error codes as the API sends them. A code with no entry here falls
   *  through to a generic line rather than showing the raw code, which is
   *  meaningless to a salesperson. */
  'error.invalid_credentials': 'Mã tài khoản hoặc mật khẩu không đúng',
  'error.not_authenticated': 'Phiên đã hết hạn, vui lòng đăng nhập lại',
  'error.forbidden': 'Bạn không có quyền thực hiện việc này',
  'error.customer_not_found': 'Không tìm thấy khách hàng',
  'error.opportunity_not_found': 'Không tìm thấy cơ hội',
  'error.reason_required': 'Cần nhập lý do',
  'error.action_not_allowed_for_role': 'Việc này không thuộc quyền của bạn',
  'error.action_not_allowed_from_status': 'Cơ hội đã chuyển trạng thái, vui lòng tải lại',
  'error.opportunity_is_closed': 'Cơ hội đã đóng',
  'error.owner_out_of_scope': 'Người phụ trách không thuộc phạm vi quản lý của bạn',
  'error.owner_segment_mismatch': 'Người phụ trách không phụ trách phân khúc này',
  'error.only_bm_sets_targets': 'Chỉ giám đốc đơn vị đặt được chỉ tiêu',
  'error.unexpected_response': 'Máy chủ không phản hồi đúng',
  'error.gone': 'Dữ liệu đã thay đổi trên máy chủ, đang tải lại',
  'error.unknown': 'Có lỗi xảy ra, vui lòng thử lại',
  'error.text_required': 'Nhập câu hỏi hoặc đính kèm một tệp',
  'error.attachment_required': 'Chưa chọn tệp',
  'error.attachment_empty': 'Tệp trống',
  'error.attachment_type_unsupported': 'Chỉ nhận ảnh (PNG, JPG, GIF, WEBP), PDF hoặc tệp văn bản',
  'error.attachment_too_large': 'Tệp quá lớn: ảnh tối đa 5 MB, PDF 10 MB, văn bản 256 KB',
  'error.File too large': 'Tệp quá lớn: ảnh tối đa 5 MB, PDF 10 MB, văn bản 256 KB',
  'error.attachment_message_too_large': 'Các tệp cộng lại vượt 10 MB cho một tin nhắn',
  'error.attachment_too_many': 'Tối đa 5 tệp cho một tin nhắn',
  'error.attachment_duplicate': 'Một tệp bị đính kèm hai lần',
  'error.attachment_not_found': 'Không tìm thấy tệp đính kèm',
  'error.attachment_already_sent': 'Tệp này đã được gửi rồi',
  'error.storage_not_configured': 'Máy chủ chưa cấu hình kho lưu tệp',
} satisfies Record<string, string>

export type Dict = typeof vi
export type DictKey = keyof Dict
