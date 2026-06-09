import { useCallback, useState } from "react";
import { createPortal } from "react-dom";

type TooltipPosition = {
  left: number;
  top: number;
  width: number;
  placement: "above" | "below";
  host: HTMLElement;
};

export function SettingsLabel({
  children,
  tooltip
}: {
  children: string;
  tooltip: string;
}) {
  const label = children.trim();
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const showTooltip = useCallback((node: HTMLElement) => {
    const rect = node.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(280, Math.max(180, window.innerWidth - margin * 2));
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, margin),
      window.innerWidth - width - margin
    );
    const placement = rect.top > 96 ? "above" : "below";
    setPosition({
      left,
      top: placement === "above" ? rect.top - 8 : rect.bottom + 8,
      width,
      placement,
      host: node.closest("dialog") ?? document.body
    });
  }, []);

  return (
    <span className="settings-label">
      <span>{label}</span>
      <button
        type="button"
        className="settings-info"
        title={tooltip}
        aria-label={tooltip}
        onMouseOver={(event) => showTooltip(event.currentTarget)}
        onMouseEnter={(event) => showTooltip(event.currentTarget)}
        onMouseLeave={() => setPosition(null)}
        onFocus={(event) => showTooltip(event.currentTarget)}
        onBlur={() => setPosition(null)}
      >
        i
      </button>
      {position
        ? createPortal(
            <span
              className={`settings-tooltip is-${position.placement}`}
              role="tooltip"
              style={{
                left: position.left,
                top: position.top,
                width: position.width
              }}
            >
              {tooltip}
            </span>,
            position.host
          )
        : null}
    </span>
  );
}
