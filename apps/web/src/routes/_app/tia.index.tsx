import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { chatStatusQuery } from '~/api/chat'
import { Spark } from '~/components/chat/spark'
import { Card } from '~/components/ui/primitives'
import { BlockSkeleton } from '~/components/ui/query-state'

/** Loaded with the screen, not with the shell — the same split the floating
 *  panel uses, so nobody who never opens Tia pays for its Markdown renderer. */
const Assistant = lazy(() =>
  import('~/components/chat/assistant').then((m) => ({ default: m.Assistant })),
)

export const Route = createFileRoute('/_app/tia/')({ component: TiaScreen })

/** Tia's own screen: every conversation on the left, one wide enough to read
 *  a table in on the right. The floating panel is for a quick question from
 *  wherever the person is; this is for the conversations that go on. */
function TiaScreen() {
  const status = useQuery(chatStatusQuery())

  if (status.isPending) return <BlockSkeleton rows={8} />

  /** A demo machine with no key should read as a product without the
   *  feature, not as a broken screen — the same rule the header button
   *  follows by not appearing at all. */
  if (!status.data?.enabled) {
    return (
      <Card className="items-center gap-2 py-12 text-center">
        <Spark size={36} />
        <span className="mt-1 text-[14px] font-semibold">Tia chưa được bật</span>
        <p className="max-w-[360px] text-[12.5px] text-muted">
          Máy chủ chưa cấu hình khoá của trợ lý. Các màn khác vẫn dùng bình thường.
        </p>
      </Card>
    )
  }

  return (
    <Suspense fallback={<BlockSkeleton rows={8} />}>
      <Assistant open variant="page" onClose={() => {}} />
    </Suspense>
  )
}
