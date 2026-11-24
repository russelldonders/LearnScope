import { useRef, useState } from 'react'
import { useLanguage } from '../context/LanguageContext'

// The skill header's cards -- what's due or coming up, then the recommended
// next action -- shown one at a time. With more than one, previous/next
// arrows and a dot per card move between them, as does a swipe on a touch
// screen; nothing moves on its own. slides: [{ key, content }] in order.
export default function SkillHeaderCarousel({ slides }) {
  const { t } = useLanguage()
  const [index, setIndex] = useState(0)
  const touchStart = useRef(null)
  if (slides.length === 0) return null
  // Cards can arrive or go as the skill's data loads.
  const current = Math.min(index, slides.length - 1)
  if (slides.length === 1) return <div className="mt-4">{slides[0].content}</div>

  const go = (next) => setIndex((next + slides.length) % slides.length)
  const k = (key, params) => t(`skillDetail.headerCarousel.${key}`, params)

  return (
    <section
      aria-roledescription="carousel"
      aria-label={k('label')}
      className="mt-4"
      onTouchStart={(e) => { touchStart.current = e.touches[0].clientX }}
      onTouchEnd={(e) => {
        if (touchStart.current === null) return
        const moved = e.changedTouches[0].clientX - touchStart.current
        touchStart.current = null
        if (Math.abs(moved) > 40) go(current + (moved < 0 ? 1 : -1))
      }}
    >
      {slides.map((slide, position) => (
        <div
          key={slide.key}
          role="group"
          aria-roledescription="slide"
          aria-label={k('slide', { current: position + 1, total: slides.length })}
          hidden={position !== current}
        >
          {slide.content}
        </div>
      ))}

      <div className="mt-2 flex items-center justify-center gap-3">
        <ArrowButton label={k('previous')} onClick={() => go(current - 1)} direction="previous" />
        <div className="flex items-center gap-1.5">
          {slides.map((slide, position) => (
            <button
              key={slide.key}
              type="button"
              onClick={() => go(position)}
              aria-label={k('goTo', { current: position + 1, total: slides.length })}
              aria-current={position === current ? 'true' : undefined}
              className="flex h-6 items-center justify-center px-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss rounded-full"
            >
              <span className={`block h-1.5 rounded-full transition-all ${position === current ? 'w-5 bg-moss' : 'w-1.5 bg-hairline'}`} />
            </button>
          ))}
        </div>
        <ArrowButton label={k('next')} onClick={() => go(current + 1)} direction="next" />
      </div>
    </section>
  )
}

function ArrowButton({ label, onClick, direction }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-full border border-hairline text-secondary hover:border-moss/60 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-moss"
    >
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {direction === 'previous' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </button>
  )
}
