import GrowthRing from './GrowthRing'
import GrowthArrow from './GrowthArrow'
import { LEVEL_LABELS } from '../lib/levels'
import { useLanguage } from '../context/LanguageContext'

// How a practical-level assessment compares with the one before it. Recent
// growth lists show every recent assessment, not only step-ups, so a
// reassessment at the same (or a lower) level must not read as progress.
function levelChangeKind(previousLevel, level) {
  if (!previousLevel) return 'new'
  if (level > previousLevel) return 'up'
  if (level === previousLevel) return 'same'
  return 'down'
}

// The before → after rings for a step up (or a first assessment); a single
// ring for a reassessment that didn't raise the level.
export function LevelChangeRings({ previousLevel, level, targetLevel, previousSize, size }) {
  const kind = levelChangeKind(previousLevel, level)
  if (kind === 'same' || kind === 'down') {
    return <GrowthRing level={level} size={size} targetLevel={targetLevel} />
  }
  return (
    <>
      <GrowthRing level={previousLevel} size={previousSize} color="var(--color-hairline)" />
      <GrowthArrow />
      <GrowthRing level={level} size={size} targetLevel={targetLevel} />
    </>
  )
}

// "Developing → Capable" for a step up; "Reassessed: still Developing" or
// "Reassessed at Developing (was Capable)" otherwise.
export function LevelChangeText({ previousLevel, level, emphasiseCurrent = false }) {
  const { t } = useLanguage()
  const kind = levelChangeKind(previousLevel, level)
  if (kind === 'same') return t('common.levelReassessedSame', { level: LEVEL_LABELS[level] })
  if (kind === 'down') {
    return t('common.levelReassessedDown', { level: LEVEL_LABELS[level], previous: LEVEL_LABELS[previousLevel] })
  }
  const from = kind === 'new' ? t('skillsProfile.newLevel') : LEVEL_LABELS[previousLevel]
  if (!emphasiseCurrent) return `${from} → ${LEVEL_LABELS[level]}`
  return (
    <>
      <span className="text-secondary">{from} → </span>
      <span className="text-ink font-medium">{LEVEL_LABELS[level]}</span>
    </>
  )
}
