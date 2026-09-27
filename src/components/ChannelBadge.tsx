import { channelInfo, type ChannelId } from '../data/channels'

export default function ChannelBadge({ id }: { id: ChannelId }) {
  const c = channelInfo(id)
  return (
    <span className="chip" style={{ '--accent': c.color } as React.CSSProperties}>
      {c.name}
    </span>
  )
}
