import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { chatStatusQuery } from '~/api/chat'
import { Assistant } from '~/components/chat/assistant'
import { Spark } from '~/components/chat/spark'
import { Card } from '~/components/ui/primitives'
import { BlockSkeleton } from '~/components/ui/query-state'

/** Imported directly, not through `lazy()`. The router already splits this
 *  route into its own chunk (`autoCodeSplitting`), so the assistant only loads
 *  for this screen either way — and a second, nested lazy boundary made the
 *  two load one after the other and paid React's suspense reveal throttle
 *  twice: about a second on a first visit with the CPU idle. Imported here, it
 *  arrives in the route's chunk, which the menu link preloads on hover. */

export const Route = createFileRoute('/_app/tia/')({ component: TiaScreen })

/** Tia's own screen: every conversation on the left, one wide enough to read
 *  a table in on the right. The floating panel is for a quick question from
 *  wherever the person is; this is for the conversations that go on. */
function TiaScreen() {
  const status = useQuery(chatStatusQuery())

  if (status.isPending) {
    return (
      <div className="p-6">
        <BlockSkeleton rows={8} />
      </div>
    )
  }

  /** A demo machine with no key should read as a product without the
   *  feature, not as a broken screen — the same rule the header button
   *  follows by not appearing at all. */
  if (!status.data?.enabled) {
    return (
      <Card className="m-6 items-center gap-2 py-12 text-center">
        <Spark size={36} />
        <span className="mt-1 text-[14px] font-semibold">Tia chưa được bật</span>
        <p className="max-w-[360px] text-[12.5px] text-muted">
          Máy chủ chưa cấu hình khoá của trợ lý. Các màn khác vẫn dùng bình thường.
        </p>
      </Card>
    )
  }

  return <Assistant open variant="page" onClose={() => {}} />
}
