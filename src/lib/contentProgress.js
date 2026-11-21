// A course content item counts as done once it is completed, passed or failed.
export function isContentComplete(status) {
  return status === 'completed' || status === 'passed' || status === 'failed'
}
