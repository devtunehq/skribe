import { useEffect, useRef, type DependencyList, type RefObject } from "react";

const DEFAULT_THRESHOLD_PX = 48;

export function useStickToBottomScroll<T extends HTMLElement>(
  deps: DependencyList,
  thresholdPx = DEFAULT_THRESHOLD_PX
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom <= thresholdPx) {
      el.scrollTop = el.scrollHeight;
    }
  }, deps);

  return ref;
}
