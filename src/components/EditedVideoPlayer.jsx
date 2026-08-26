import { useRef, useState } from 'react'
import { contentFileUrl } from '../lib/courseContent'
import { OVERLAY_SIZE_PX, buildFilterCss, normalizeVideoEdit } from '../lib/videoEdit'

// Read-only playback of a video resource's stored edit (trim/filter/speed/
// overlays) -- the counterpart to VideoEditorModal.jsx, which writes that
// same shape. Renders the *original* upload plus a CSS filter and an
// absolutely-positioned overlay layer; nothing is re-encoded, so this is
// the only place trim/overlays actually take visible effect. Used
// everywhere a course video plays: the org library preview, the per-course
// editor's preview, and learner playback in CourseLearn.
export default function EditedVideoPlayer({ resource, onEnded, className = '', controls = true }) {
  const videoRef = useRef(null)
  const [currentTime, setCurrentTime] = useState(0)
  const endedFiredRef = useRef(false)
  const edit = normalizeVideoEdit(resource.video_edit)

  function handleLoadedMetadata(e) {
    e.currentTarget.playbackRate = edit.playbackRate
    if (edit.trimStart > 0) e.currentTarget.currentTime = edit.trimStart
  }

  function handleTimeUpdate(e) {
    setCurrentTime(e.currentTarget.currentTime)
    if (edit.trimEnd != null && e.currentTarget.currentTime >= edit.trimEnd && !endedFiredRef.current) {
      endedFiredRef.current = true
      e.currentTarget.pause()
      onEnded?.()
    }
  }

  function handleSeeking(e) {
    // Scrubbing before the trim start snaps forward to it -- trim is a
    // soft/non-destructive playback window (the underlying file is
    // untouched), but a viewer dragging the native seek bar shouldn't be
    // able to land in the pre-trim portion any more than they could with a
    // truly trimmed file.
    if (e.currentTarget.currentTime < edit.trimStart) {
      e.currentTarget.currentTime = edit.trimStart
      return
    }
    // Re-arms the "already fired" guard on seeking back before the trim
    // end, so scrubbing back and re-watching the tail fires completion
    // again too -- matches native <video> onEnded firing every time
    // playback runs off the end, not just once per element lifetime.
    if (e.currentTarget.currentTime < (edit.trimEnd ?? Infinity)) endedFiredRef.current = false
  }

  function handleNativeEnded() {
    if (!endedFiredRef.current) {
      endedFiredRef.current = true
      onEnded?.()
    }
  }

  const visibleOverlays = edit.overlays.filter((o) => currentTime >= o.startTime && currentTime <= o.endTime)

  return (
    <div className="relative">
      <video
        ref={videoRef}
        src={contentFileUrl(resource)}
        controls={controls}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onSeeking={handleSeeking}
        onEnded={handleNativeEnded}
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
