// Curated subset of xAPI verbs for logging day-to-day activities.
// Verbs from the official ADL registry keep that IRI; a few concepts the
// ADL registry doesn't cover use a LearnScope-namespaced IRI instead of
// guessing at a third-party registry's URI.
export const XAPI_VERBS = [
  { value: 'experienced', label: 'Experienced', iri: 'http://adlnet.gov/expapi/verbs/experienced' },
  { value: 'attempted', label: 'Attempted', iri: 'http://adlnet.gov/expapi/verbs/attempted' },
  { value: 'practiced', label: 'Practiced', iri: 'https://learnscope.app/xapi/verbs/practiced' },
  { value: 'completed', label: 'Completed', iri: 'http://adlnet.gov/expapi/verbs/completed' },
  { value: 'demonstrated', label: 'Demonstrated', iri: 'https://learnscope.app/xapi/verbs/demonstrated' },
  { value: 'mastered', label: 'Mastered', iri: 'http://adlnet.gov/expapi/verbs/mastered' },
  { value: 'passed', label: 'Passed', iri: 'http://adlnet.gov/expapi/verbs/passed' },
  { value: 'failed', label: 'Failed', iri: 'http://adlnet.gov/expapi/verbs/failed' },
  { value: 'shared', label: 'Shared', iri: 'http://adlnet.gov/expapi/verbs/shared' },
  { value: 'assessed', label: 'Assessed', iri: 'https://learnscope.app/xapi/verbs/assessed' },
]

export const XAPI_VERB_LABELS = Object.fromEntries(XAPI_VERBS.map((v) => [v.value, v.label]))
export const XAPI_VERB_BY_IRI = Object.fromEntries(XAPI_VERBS.map((v) => [v.iri, v]))
