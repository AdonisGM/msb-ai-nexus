import { createFileRoute } from '@tanstack/react-router'
import { Card } from '~/components/ui/primitives'
import { t } from '~/i18n'

export const Route = createFileRoute('/_app/dashboard')({ component: DashboardScreen })

/** The reading screen, for the two roles that read rather than work.
 *
 *  Empty on purpose. The figures it will carry — the funnel, the conversion
 *  rate against the 6% the branch is judged on, and the gap between them —
 *  come from a reporting query that does not exist yet, and a placeholder
 *  filled with plausible numbers is the one thing on this screen that would
 *  be worse than nothing: somebody would read them.
 *
 *  What differs between the two roles is what the rows are grouped by. A team
 *  lead wants one row per salesperson and the question "who is behind". A
 *  branch manager wants one row per segment and the question "is the unit
 *  going to make it". Same figures, same query, one grouping key apart — which
 *  is why this is one screen and not two. */
function DashboardScreen() {
  const { user } = Route.useRouteContext()

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight">{t('nav.dashboard')}</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          {user.role === 'team_lead'
            ? 'Số liệu của nhóm bạn phụ trách.'
            : 'Số liệu của toàn đơn vị.'}
        </p>
      </div>

      <Card>
        <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
          <span className="text-[13px]">Chưa dựng nội dung</span>
          <p className="max-w-[420px] text-[12px] leading-relaxed text-muted">
            Màn này sẽ có phễu khai thác, tỷ lệ chốt so với chỉ tiêu 6%, và số deal
            còn thiếu để chạm chỉ tiêu. Đang chờ phần truy vấn báo cáo ở API.
          </p>
        </div>
      </Card>
    </div>
  )
}
