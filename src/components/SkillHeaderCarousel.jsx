import { useRef, useState } from 'react'
import { useLanguage } from '../context/LanguageContext'

// The skill header's cards -- what's due or coming up, then the recommended
// next action -- as a slider showing one at a time. With more than one,
// small round arrows sit on the card's left and right edges, only where
// there's a card that way, and a dot per card sits along its bottom edge;
// a swipe on a touch screen moves too. It goes from the first card to the
// last without wrapping round, and nothing moves on its own. Every card
// takes the height of the tallest, so moving between them doesn't shift the
// page. slides: [{ key, content }] in order. Each content fills its slide's
// height (SkillHeaderCard does).
export default function SkillHeaderCarousel({ slides }) {
  const { t } = useLanguage()
  const [index, setIndex] = useState(0)
  const touchStart = useRef(null)
  if (slides.length === 0) return null
  if (slides.length === 1) return <div className="mt-4">{slides[0].content}</div>

  // Cards can arrive or go as the skill's data loads.
  const current = Math.min(index, slides.length - 1)
  const last = slides.length - 1
  const go = (next) => setIndex(Math.max(0, Math.min(last, next)))
  const k = (key, params) => t(`skillDetail.headerCarousel.${key}`, params)

  return (
    <section
      aria-roledescription="carousel"
      aria-label={k('label')}
      className="relative mt-4"
      onTouchStart={(e) => { touchStart.current = e.touches[0].clientX }}
      onTouchEnd={(e) => {
        if (touchStart.current === null) return
        const moved = e.changedTouches[0].clientX - touchStart.current
        touchStart.current = null
        if (Math.abs(moved) > 40) go(current + (moved < 0 ? 1 : -1))
      }}
    >
      <div className="overflow-hidden rounded-lg">
        {/* All the cards side by side, stretched to the tallest, sliding
            along; only the one shown can be read or reached. */}
        <div
          className="flex items-stretch motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {slides.map((slide, position) => (
            <div
              key={slide.key}
              role="group"
              aria-roledescription="slide"
              aria-label={k('slide', { current: position + 1, total: slides.length })}
              aria-hidden={position !== current}
              inert={position !== current}
              className="w-full shrink-0"
            >
              {slide.content}
            </div>
          ))}
        </div>
      </div>

      {current > 0 && <EdgeArrow side="left" label={k('previous')} onClick={() => go(current - 1)} />}
      {current < last && <EdgeArrow side="right" label={k('next')} onClick={() => go(current + 1)} />}

      {/* A dot per card, along the bottom edge inside the card. */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
        {slides.map((slide, position) => (
          <button
            key={slide.key}
            type="button"
            onClick={() => go(position)}
            aria-label={k('goTo', { current: position + 1, total: slides.length })}
            aria-current={position === current ? 'true' : undefined}
            className="flex h-3 items-center justify-center px-0.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-moss"
          >
            <span className={`block h-1 rounded-full motion-safe:transition-all ${position === current ? 'w-3.5 bg-moss' : 'w-1 bg-secondary/40'}`} />
          </button>
        ))}
      </div>
    </section>
  )
}

// A small round arrow sitting on the card's left or right edge, half over
// its border, vertically centred.
function EdgeArrow({ side, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute top-1/2 -translate-y-1/2 ${side === 'left' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'} z-10 flex h-7 w-7 items-center justify-center rounded-full border border-hairline bg-card text-secondary shadow-sm hover:text-ink hover:border-moss/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss`}
    >
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {side === 'left' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </button>
  )
}
