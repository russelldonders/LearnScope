import { OVERLAY_SIZE_PX } from '../lib/videoEdit'

// What one text or sticker overlay looks like, shared by playback
// (EditedVideoPlayer) and the editor so a caption can't look different once
// it's saved. Position, scale and rotation are applied by the wrapper.
export default function VideoOverlayContent({ overlay }) {
  if (overlay.kind !== 'text') {
    return <span style={{ fontSize: OVERLAY_SIZE_PX[overlay.size] ?? OVERLAY_SIZE_PX.large }}>{overlay.content}</span>
  }
  return (
    <span
      style={{
        color: overlay.color,
        fontSize: OVERLAY_SIZE_PX[overlay.size] ?? OVERLAY_SIZE_PX.medium,
        backgroundColor: overlay.background || undefined,
        padding: overlay.background ? '0.25em 0.6em' : undefined,
        borderRadius: overlay.background ? '0.6em' : undefined,
        boxDecorationBreak: 'clone',
        WebkitBoxDecorationBreak: 'clone',
      }}
      className={`font-bold whitespace-pre-wrap leading-snug ${overlay.background ? '' : '[text-shadow:0_1px_3px_rgba(0,0,0,0.8)]'}`}
    >
      {overlay.content}
    </span>
  )
}
