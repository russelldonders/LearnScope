import { useState } from 'react'
import { contentFileUrl } from '../lib/courseContent'
import { OVERLAY_SIZE_PX, buildFilterCss, normalizeVideoEdit, useTrimPlayback } from '../lib/videoEdit'

// Read-only playback of a video resource's stored edit (trim/filter/speed/
// overlays) -- the counterpart to VideoEditorModal.jsx, which writes that
// same shape (and shares useTrimPlayback with it, so trim behaves
// identically in both places). Renders the *original* upload plus a CSS
// filter and an absolutely-positioned overlay layer; nothing is
// re-encoded, so this is the only place trim/overlays actually take
// visible effect. Used everywhere a course video plays: the org library
// preview, the per-course editor's preview, and learner playback in
// CourseLearn.
export default function EditedVideoPlayer({ resource, onEnded, className = '', controls = true }) {
  const [currentTime, setCurrentTime] = useState(0)
  const edit = normalizeVideoEdit(resource.video_edit)
  const trim = useTrimPlayback(edit, onEnded)

  const visibleOverlays = edit.overlays.filter((o) => currentTime >= o.startTime && currentTime <= o.endTime)

  return (
    <div className="relative">
      {/* Without playsInline, mobile Safari plays <video> in its own native
          fullscreen player by default -- a separate OS-level layer the
          overlay div below can never render on top of, so trim/overlays
          would silently disappear on exactly the devices most likely to
          watch a course video. */}
      <video
        src={contentFileUrl(resource)}
        controls={controls}
        playsInline
        onLoadedMetadata={trim.handleLoadedMetadata}
        onTimeUpdate={(e) => {
          trim.handleTimeUpdate(e)
          setCurrentTime(e.currentTarget.currentTime)
        }}
        onSeeking={trim.handleSeeking}
        onEnded={trim.handleNativeEnded}
        style={{ filter: buildFilterCss(edit.filter) }}
        className={className}
      />
      {visibleOverlays.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {visibleOverlays.map((o) => (
            <div
              key={o.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 select-none max-w-[80%] text-center"
              style={{ left: `${o.x}%`, top: `${o.y}%` }}
            >
              {o.kind === 'text' ? (
                <span
                  style={{ color: o.color, fontSize: OVERLAY_SIZE_PX[o.size] }}
                  className="font-bold whitespace-pre-wrap [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]"
                >
                  {o.content}
                </span>
              ) : (
                <span style={{ fontSize: OVERLAY_SIZE_PX[o.size] }}>{o.content}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
