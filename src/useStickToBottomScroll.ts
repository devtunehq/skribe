const DEFAULT_THRESHOLD_PX = 48;

export function stickToBottomIfNear<T extends HTMLElement>(
  element: T | null,
  thresholdPx = DEFAULT_THRESHOLD_PX
) {
  if (!element) return;
  const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  if (distanceFromBottom <= thresholdPx) {
    element.scrollTop = element.scrollHeight;
  }
}
