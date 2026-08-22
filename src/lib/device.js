// Regex-based UA sniffing rather than viewport width -- a narrow desktop
// window shouldn't be treated as a phone, and a tablet/phone in landscape
// shouldn't lose its mobile affordances just because the viewport happens
// to be wide at a given moment.
export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}
