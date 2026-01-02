import { useSubViewTitle } from "~/modules/app-layout/subview/hooks"
import { XhsTimeline } from "~/modules/xhs/XhsTimeline"

export function Component() {
  useSubViewTitle("小红书")

  return <XhsTimeline />
}
