// Curated subset of xAPI verbs for logging day-to-day activities.
// Verbs from the official ADL registry keep that IRI; a few concepts the
// ADL registry doesn't cover use a LearnScope-namespaced IRI instead of
// guessing at a third-party registry's URI. `label` is plain-English display
// text only (stored as statement.verb.display['en-US']) -- it can read
// however's clearest to a learner without affecting spec compliance, since
// the IRI is what actually identifies the concept.
export const XAPI_VERBS = [
  { value: 'experienced', label: 'Did it', iri: 'http://adlnet.gov/expapi/verbs/experienced' },
  { value: 'attempted', label: 'Tried it', iri: 'http://adlnet.gov/expapi/verbs/attempted' },
  { value: 'practiced', label: 'Practiced it', iri: 'https://learnscope.app/xapi/verbs/practiced' },
  { value: 'completed', label: 'Finished it', iri: 'http://adlnet.gov/expapi/verbs/completed' },
  { value: 'demonstrated', label: 'Showed I could do it', iri: 'https://learnscope.app/xapi/verbs/demonstrated' },
  { value: 'mastered', label: 'Nailed it', iri: 'http://adlnet.gov/expapi/verbs/mastered' },
  { value: 'passed', label: 'Passed', iri: 'http://adlnet.gov/expapi/verbs/passed' },
  { value: 'failed', label: "Didn't pass", iri: 'http://adlnet.gov/expapi/verbs/failed' },
  { value: 'shared', label: 'Shared it', iri: 'http://adlnet.gov/expapi/verbs/shared' },
  { value: 'assessed', label: 'Got assessed', iri: 'https://learnscope.app/xapi/verbs/assessed' },
]

export const XAPI_VERB_LABELS = Object.fromEntries(XAPI_VERBS.map((v) => [v.value, v.label]))
export const XAPI_VERB_BY_IRI = Object.fromEntries(XAPI_VERBS.map((v) => [v.iri, v]))
