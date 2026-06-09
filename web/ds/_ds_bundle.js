/* @ds-bundle: {"format":3,"namespace":"SkribeDesignSystem_a6e4e0","components":[{"name":"Button","sourcePath":"components/buttons/Button.jsx"},{"name":"IconButton","sourcePath":"components/buttons/IconButton.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"SkillChip","sourcePath":"components/forms/SkillChip.jsx"},{"name":"Tabs","sourcePath":"components/forms/Tabs.jsx"},{"name":"MessageBubble","sourcePath":"components/review/MessageBubble.jsx"},{"name":"SuggestionCard","sourcePath":"components/review/SuggestionCard.jsx"},{"name":"ThreadCard","sourcePath":"components/review/ThreadCard.jsx"},{"name":"Badge","sourcePath":"components/status/Badge.jsx"},{"name":"Pill","sourcePath":"components/status/Pill.jsx"}],"sourceHashes":{"components/buttons/Button.jsx":"d890a7183b48","components/buttons/IconButton.jsx":"a3356269b3a1","components/forms/Select.jsx":"6e8345197d6b","components/forms/SkillChip.jsx":"9cbafa34a364","components/forms/Tabs.jsx":"5130f613b049","components/review/MessageBubble.jsx":"ba215cad0462","components/review/SuggestionCard.jsx":"4125bcd4c5c2","components/review/ThreadCard.jsx":"b06a971159ea","components/status/Badge.jsx":"5472ba5e2cfd","components/status/Pill.jsx":"ab4b32254b35","ui_kits/editor/EditorApp.jsx":"5752d6f2f9b0","ui_kits/editor/editorData.js":"62afd4182995","ui_kits/editor/icons.jsx":"424e3e2bc77a"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.SkribeDesignSystem_a6e4e0 = window.SkribeDesignSystem_a6e4e0 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/buttons/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const BUTTON_CSS = `
.sk-btn {
  border: 1px solid var(--line-ink);
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--paper-white);
  color: var(--text);
  padding: 0 16px;
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  cursor: pointer;
  transition:
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1),
    background 140ms ease,
    border-color 140ms ease;
}
.sk-btn--primary { background: var(--sky-blue); border-color: var(--ink); color: var(--accent-ink); }
.sk-btn--primary:hover { box-shadow: var(--hard-shadow); transform: translate(6px, -6px); }
.sk-btn--primary:active { box-shadow: -2px 2px 0 0 var(--ink); transform: translate(2px, -2px); }
.sk-btn--secondary { background: var(--smoke-gray); color: var(--text); }
.sk-btn--secondary:hover { background: var(--frost-blue); border-color: var(--sky-blue); }
.sk-btn--ghost { background: transparent; border-color: transparent; color: var(--text); }
.sk-btn--ghost:hover { border-color: var(--line-ink); background: var(--smoke-gray); }
.sk-btn--ghost.is-active { border-color: var(--coral-red); background: color-mix(in srgb, var(--coral-red) 14%, white); color: var(--danger); }
.sk-btn--small { min-height: 30px; padding: 0 12px; font-size: 11px; }
.sk-btn:disabled { cursor: not-allowed; opacity: 0.55; transform: none; box-shadow: none; }
.sk-btn svg { width: 15px; height: 15px; }
`;
function ensureButtonStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sk-button-css")) return;
  const el = document.createElement("style");
  el.id = "sk-button-css";
  el.textContent = BUTTON_CSS;
  document.head.appendChild(el);
}
function Button({
  variant = "primary",
  size = "default",
  active = false,
  icon = null,
  children,
  className = "",
  ...rest
}) {
  ensureButtonStyles();
  const classes = ["sk-btn", `sk-btn--${variant}`, size === "small" ? "sk-btn--small" : "", active ? "is-active" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    className: classes
  }, rest), icon, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/Button.jsx", error: String((e && e.message) || e) }); }

// components/buttons/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const ICON_BUTTON_CSS = `
.sk-icon-btn {
  width: 34px;
  height: 34px;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--line-ink);
  background: var(--paper-white);
  color: var(--text);
  border-radius: var(--radius);
  padding: 0;
  cursor: pointer;
  transition:
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1),
    background 140ms ease;
}
.sk-icon-btn:hover { box-shadow: var(--hard-shadow); transform: translate(6px, -6px); }
.sk-icon-btn:active { box-shadow: -2px 2px 0 0 var(--ink); transform: translate(2px, -2px); }
.sk-icon-btn:disabled { cursor: not-allowed; opacity: 0.55; transform: none; box-shadow: none; }
.sk-icon-btn--mini { width: 24px; height: 24px; }
.sk-icon-btn svg { width: 16px; height: 16px; }
.sk-icon-btn--mini svg { width: 13px; height: 13px; }
`;
function ensureIconButtonStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sk-icon-button-css")) return;
  const el = document.createElement("style");
  el.id = "sk-icon-button-css";
  el.textContent = ICON_BUTTON_CSS;
  document.head.appendChild(el);
}
function IconButton({
  size = "default",
  children,
  className = "",
  ...rest
}) {
  ensureIconButtonStyles();
  const classes = ["sk-icon-btn", size === "mini" ? "sk-icon-btn--mini" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    className: classes
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SELECT_CSS = `
.sk-select {
  position: relative;
  height: 34px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--line-ink);
  background: var(--paper-white);
  color: var(--text);
  border-radius: var(--radius);
}
.sk-select::after {
  content: "";
  position: absolute;
  right: 11px;
  top: 12px;
  width: 6px;
  height: 6px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  opacity: 0.7;
  pointer-events: none;
  transform: rotate(45deg);
}
.sk-select:focus-within { border-color: var(--sky-blue); background: var(--frost-blue); }
.sk-select select {
  width: 100%;
  height: 100%;
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 0 28px 0 10px;
  text-transform: uppercase;
  cursor: pointer;
}
.sk-select select:focus { outline: none; }
.sk-select:has(select:disabled) { opacity: 0.58; }
`;
function ensureSelectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sk-select-css")) return;
  const el = document.createElement("style");
  el.id = "sk-select-css";
  el.textContent = SELECT_CSS;
  document.head.appendChild(el);
}
function Select({
  options = [],
  value,
  onChange,
  disabled = false,
  width,
  className = "",
  ...rest
}) {
  ensureSelectStyles();
  const classes = ["sk-select", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", {
    className: classes,
    style: width ? {
      width
    } : undefined
  }, /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    onChange: onChange,
    disabled: disabled
  }, rest), options.map(o => {
    const opt = typeof o === "string" ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: opt.value,
      value: opt.value
    }, opt.label);
  })));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/SkillChip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SKILL_CHIP_CSS = `
.sk-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--line);
  background: var(--frost-blue);
  color: var(--accent-ink);
  border-radius: var(--radius);
  padding: 4px 7px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.sk-chip--muted { background: var(--paper-white); color: var(--muted); }
.sk-chip button {
  display: inline-grid;
  place-items: center;
  width: 13px; height: 13px;
  border: 0; padding: 0; margin: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.sk-chip button svg { width: 11px; height: 11px; }
`;
function ensureSkillChipStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sk-chip-css")) return;
  const el = document.createElement("style");
  el.id = "sk-chip-css";
  el.textContent = SKILL_CHIP_CSS;
  document.head.appendChild(el);
}
const Cross = () => React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4
}, React.createElement("path", {
  d: "M18 6 6 18M6 6l12 12"
}));
function SkillChip({
  children,
  muted = false,
  onRemove,
  className = "",
  ...rest
}) {
  ensureSkillChipStyles();
  const classes = ["sk-chip", muted ? "sk-chip--muted" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", _extends({
    className: classes
  }, rest), children, onRemove ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Remove skill",
    onClick: onRemove
  }, /*#__PURE__*/React.createElement(Cross, null)) : null);
}
Object.assign(__ds_scope, { SkillChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SkillChip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Tabs.jsx
try { (() => {
const TABS_CSS = `
.sk-tabs {
  display: inline-grid;
  grid-auto-flow: column;
  gap: 8px;
}
.sk-tabs.is-fill { display: grid; grid-auto-columns: 1fr; }
.sk-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 34px;
  border: 1px solid var(--line-ink);
  background: var(--paper-white);
  color: var(--text);
  border-radius: var(--radius);
  padding: 0 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.sk-tab svg { width: 15px; height: 15px; }
.sk-tab:hover:not(.is-active) { background: var(--frost-blue); }
.sk-tab.is-active { background: var(--sky-blue); color: var(--accent-ink); }
`;
function ensureTabsStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sk-tabs-css")) return;
  const el = document.createElement("style");
  el.id = "sk-tabs-css";
  el.textContent = TABS_CSS;
  document.head.appendChild(el);
}
function Tabs({
  tabs = [],
  value,
  onChange,
  fill = false,
  className = ""
}) {
  ensureTabsStyles();
  const classes = ["sk-tabs", fill ? "is-fill" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", {
    className: classes,
    role: "tablist"
  }, tabs.map(t => {
    const tab = typeof t === "string" ? {
      value: t,
      label: t
    } : t;
    const active = tab.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: tab.value,
      role: "tab",
      "aria-selected": active,
      className: `sk-tab${active ? " is-active" : ""}`,
      onClick: () => onChange && onChange(tab.value)
    }, tab.icon, tab.label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/review/MessageBubble.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const MESSAGE_BUBBLE_CSS = `
.sk-msg {
  border: 1px solid var(--line-ink);
  border-radius: var(--radius-card);
  background: var(--paper-white);
  padding: 12px;
}
.sk-msg.is-agent { border-color: var(--cerulean-blue); background: var(--frost-blue); }
.sk-msg.is-error { border-color: var(--coral-red); background: color-mix(in srgb, var(--coral-red) 10%, white); }
.sk-msg.is-typing { border-style: dashed; }
.sk-msg-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.sk-msg-head strong { color: var(--text-strong); font-weight: 700; }
.sk-msg p { margin: 8px 0 0; color: var(--text); font-size: 14px; line-height: 1.5; }
.sk-msg.is-typing p { display: flex; gap: 6px; align-items: center; min-height: 18px; margin-top: 10px; }
.sk-typing-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--sky-blue); opacity: 0.4; animation: typingPulse 1.1s ease-in-out infinite; }
.sk-typing-dot:nth-child(2) { animation-delay: 0.16s; }
.sk-typing-dot:nth-child(3) { animation-delay: 0.32s; }
`;
function ensureMessageBubbleStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sk-msg-css")) return;
  const el = document.createElement("style");
  el.id = "sk-msg-css";
  el.textContent = MESSAGE_BUBBLE_CSS;
  document.head.appendChild(el);
}
function MessageBubble({
  author,
  time,
  variant = "human",
  typing = false,
  children,
  className = "",
  ...rest
}) {
  ensureMessageBubbleStyles();
  const classes = ["sk-msg", variant === "agent" ? "is-agent" : "", variant === "error" ? "is-error" : "", typing ? "is-typing" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: classes
  }, rest), /*#__PURE__*/React.createElement("div", {
    className: "sk-msg-head"
  }, /*#__PURE__*/React.createElement("strong", null, author), time ? /*#__PURE__*/React.createElement("span", null, time) : null), typing ? /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("span", {
    className: "sk-typing-dot"
  }), /*#__PURE__*/React.createElement("span", {
    className: "sk-typing-dot"
  }), /*#__PURE__*/React.createElement("span", {
    className: "sk-typing-dot"
  })) : /*#__PURE__*/React.createElement("p", null, children));
}
Object.assign(__ds_scope, { MessageBubble });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/review/MessageBubble.jsx", error: String((e && e.message) || e) }); }

// components/review/SuggestionCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SUGGESTION_CSS = `
.sk-suggestion {
  border: 1px solid var(--aqua-teal);
  background: var(--paper-white);
  border-radius: var(--radius-card);
  padding: 12px;
}
.sk-suggestion.is-accepted { background: color-mix(in srgb, var(--aqua-teal) 12%, white); }
.sk-suggestion.is-rejected { opacity: 0.6; }
.sk-suggestion-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.sk-suggestion-meta strong { color: var(--text-strong); }
.sk-suggestion p { margin: 8px 0 0; color: var(--text); font-size: 14px; line-height: 1.5; }
`;
function ensureSuggestionStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sk-suggestion-css")) return;
  const el = document.createElement("style");
  el.id = "sk-suggestion-css";
  el.textContent = SUGGESTION_CSS;
  document.head.appendChild(el);
}
function SuggestionCard({
  label = "Suggested replacement",
  status,
  state = "open",
  children,
  className = "",
  ...rest
}) {
  ensureSuggestionStyles();
  const classes = ["sk-suggestion", state === "accepted" ? "is-accepted" : "", state === "rejected" ? "is-rejected" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: classes
  }, rest), /*#__PURE__*/React.createElement("div", {
    className: "sk-suggestion-meta"
  }, /*#__PURE__*/React.createElement("strong", null, label), /*#__PURE__*/React.createElement("span", null, status || state)), /*#__PURE__*/React.createElement("p", null, children));
}
Object.assign(__ds_scope, { SuggestionCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/review/SuggestionCard.jsx", error: String((e && e.message) || e) }); }

// components/review/ThreadCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const THREAD_CARD_CSS = `
.sk-thread-card {
  display: grid;
  grid-template-columns: 28px 1fr 16px;
  gap: 10px;
  align-items: center;
  width: 100%;
  text-align: left;
  border: 1px solid var(--line-ink);
  background: var(--paper-white);
  border-radius: var(--radius-card);
  padding: 12px;
  cursor: pointer;
  transition:
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 140ms ease;
}
.sk-thread-card:hover { border-color: var(--sky-blue); }
.sk-thread-card.is-active {
  border-color: var(--ink);
  background: var(--frost-blue);
  box-shadow: var(--hard-shadow);
  transform: translate(6px, -6px);
}
.sk-thread-card.is-resolved { opacity: 0.6; }
.sk-thread-index {
  width: 26px; height: 26px;
  display: grid; place-items: center;
  background: var(--mellow-yellow);
  border: 1px solid var(--ink);
  border-radius: var(--radius);
  color: var(--coal);
  font-family: var(--font-mono);
  font-weight: 700; font-size: 12px;
}
.sk-thread-body { min-width: 0; }
.sk-thread-body strong {
  display: -webkit-box;
  color: var(--text-strong);
  font-size: 13px; line-height: 1.3;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.sk-thread-body small {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-family: var(--font-mono); font-size: 11px;
}
.sk-thread-card > svg { width: 16px; height: 16px; color: var(--slate); }
`;
function ensureThreadCardStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sk-thread-card-css")) return;
  const el = document.createElement("style");
  el.id = "sk-thread-card-css";
  el.textContent = THREAD_CARD_CSS;
  document.head.appendChild(el);
}
const Chevron = () => React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2
}, React.createElement("path", {
  d: "m9 18 6-6-6-6"
}));
function ThreadCard({
  index,
  title,
  meta,
  active = false,
  resolved = false,
  className = "",
  ...rest
}) {
  ensureThreadCardStyles();
  const classes = ["sk-thread-card", active ? "is-active" : "", resolved ? "is-resolved" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    className: classes
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "sk-thread-index"
  }, index), /*#__PURE__*/React.createElement("span", {
    className: "sk-thread-body"
  }, /*#__PURE__*/React.createElement("strong", null, title), meta ? /*#__PURE__*/React.createElement("small", null, meta) : null), /*#__PURE__*/React.createElement(Chevron, null));
}
Object.assign(__ds_scope, { ThreadCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/review/ThreadCard.jsx", error: String((e && e.message) || e) }); }

// components/status/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const BADGE_CSS = `
.sk-badge {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 2px 6px;
  border: 1px solid var(--line);
  background: var(--paper-white);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
}
.sk-badge--mark {
  width: 26px;
  height: 26px;
  min-width: 0;
  padding: 0;
  border-color: var(--ink);
  background: var(--mellow-yellow);
  color: var(--coal);
  font-size: 12px;
}
`;
function ensureBadgeStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sk-badge-css")) return;
  const el = document.createElement("style");
  el.id = "sk-badge-css";
  el.textContent = BADGE_CSS;
  document.head.appendChild(el);
}
function Badge({
  variant = "count",
  children,
  className = "",
  ...rest
}) {
  ensureBadgeStyles();
  const classes = ["sk-badge", variant === "mark" ? "sk-badge--mark" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", _extends({
    className: classes
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/status/Badge.jsx", error: String((e && e.message) || e) }); }

// components/status/Pill.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const PILL_CSS = `
.sk-pill {
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--line-ink);
  color: var(--text);
  background: var(--paper-white);
  padding: 0 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  border-radius: var(--radius);
  white-space: nowrap;
}
.sk-pill svg { width: 14px; height: 14px; }
.sk-pill.is-running { color: var(--text-strong); border-color: var(--sky-blue); background: var(--frost-blue); }
.sk-pill.is-running svg { animation: spin 1s linear infinite; }
.sk-pill.is-error { color: var(--danger); border-color: var(--coral-red); }
.sk-pill.is-accent { background: var(--sky-blue); border-color: var(--ink); color: var(--accent-ink); }
`;
function ensurePillStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sk-pill-css")) return;
  const el = document.createElement("style");
  el.id = "sk-pill-css";
  el.textContent = PILL_CSS;
  document.head.appendChild(el);
}
function Pill({
  state = "idle",
  icon = null,
  children,
  className = "",
  ...rest
}) {
  ensurePillStyles();
  const classes = ["sk-pill", state === "running" ? "is-running" : "", state === "error" ? "is-error" : "", state === "accent" ? "is-accent" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", _extends({
    className: classes
  }, rest), icon, children);
}
Object.assign(__ds_scope, { Pill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/status/Pill.jsx", error: String((e && e.message) || e) }); }

// ui_kits/editor/EditorApp.jsx
try { (() => {
// Skribe editor workbench — interactive recreation. Composes the design-system
// primitives from the bundle with kit-local chrome.
(function () {
  const {
    useState,
    useRef,
    useEffect,
    Fragment
  } = React;
  const NS = window.SkribeDesignSystem_a6e4e0;
  const {
    Tabs,
    Pill,
    IconButton,
    ThreadCard,
    MessageBubble,
    SuggestionCard,
    SkillChip,
    Button
  } = NS;
  const I = window.SkIcons;
  const DATA = window.SkribeEditorData;

  // ---------- Topbar ----------
  function Topbar({
    saveState,
    agentRunning,
    onToggleAgent
  }) {
    return /*#__PURE__*/React.createElement("header", {
      className: "topbar"
    }, /*#__PURE__*/React.createElement("div", {
      className: "brand"
    }, /*#__PURE__*/React.createElement("span", {
      className: "brand-mark"
    }, /*#__PURE__*/React.createElement("img", {
      src: "../../assets/skribe-icon.png",
      alt: "Skribe"
    })), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, "Skribe"), /*#__PURE__*/React.createElement("span", null, DATA.doc.title))), /*#__PURE__*/React.createElement("div", {
      className: "topbar-actions"
    }, /*#__PURE__*/React.createElement("button", {
      className: "agent-config-button" + (agentRunning ? " is-running" : ""),
      onClick: onToggleAgent
    }, /*#__PURE__*/React.createElement(I.Spark, null), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, "Claude Code"), /*#__PURE__*/React.createElement("small", null, "Opus 4.8 \xB7 High")), /*#__PURE__*/React.createElement("em", null, agentRunning ? "Run" : "Idle"), /*#__PURE__*/React.createElement(I.ChevDown, {
      style: {
        width: 12,
        height: 12
      }
    })), /*#__PURE__*/React.createElement(Pill, {
      state: saveState === "saving" ? "running" : "idle",
      icon: /*#__PURE__*/React.createElement(I.Disk, null)
    }, saveState === "saving" ? "Saving" : "Saved"), /*#__PURE__*/React.createElement(IconButton, {
      "aria-label": "Settings"
    }, /*#__PURE__*/React.createElement(I.Gear, null)), /*#__PURE__*/React.createElement(IconButton, {
      "aria-label": "Export"
    }, /*#__PURE__*/React.createElement(I.Export, null)), /*#__PURE__*/React.createElement(IconButton, {
      "aria-label": "Copy markdown"
    }, /*#__PURE__*/React.createElement(I.Copy, null)), /*#__PURE__*/React.createElement(IconButton, {
      "aria-label": "Download"
    }, /*#__PURE__*/React.createElement(I.Download, null))));
  }

  // ---------- Left rail ----------
  function LeftRail({
    openCount,
    onScrollToHeading
  }) {
    return /*#__PURE__*/React.createElement("aside", {
      className: "left-rail"
    }, /*#__PURE__*/React.createElement("button", {
      className: "rail-collapse-button",
      "aria-label": "Collapse"
    }, /*#__PURE__*/React.createElement(I.ChevLeft, null)), /*#__PURE__*/React.createElement("div", {
      className: "rail-content"
    }, /*#__PURE__*/React.createElement("div", {
      className: "metric-row"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, DATA.doc.words.toLocaleString()), /*#__PURE__*/React.createElement("span", null, "words")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, openCount), /*#__PURE__*/React.createElement("span", null, "open"))), /*#__PURE__*/React.createElement("section", {
      className: "rail-section",
      style: {
        borderTop: 0,
        paddingTop: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "rail-heading"
    }, /*#__PURE__*/React.createElement(I.File, null), " Outline"), /*#__PURE__*/React.createElement("div", {
      className: "outline-list"
    }, DATA.outline.map((o, i) => /*#__PURE__*/React.createElement("a", {
      key: i,
      className: "outline-item level-" + o.level,
      onClick: () => onScrollToHeading(o.label)
    }, o.label)))), /*#__PURE__*/React.createElement("section", {
      className: "rail-section"
    }, /*#__PURE__*/React.createElement("div", {
      className: "rail-heading"
    }, /*#__PURE__*/React.createElement(I.Clock, null), " Revisions ", /*#__PURE__*/React.createElement("span", {
      className: "rail-heading-count"
    }, DATA.revisions.length)), DATA.revisions.map(r => /*#__PURE__*/React.createElement("div", {
      key: r.id,
      className: "doc-revision-item" + (r.current ? " is-current" : "")
    }, /*#__PURE__*/React.createElement("span", {
      className: "doc-revision-dot"
    }), /*#__PURE__*/React.createElement("span", {
      className: "doc-revision-main"
    }, /*#__PURE__*/React.createElement("strong", null, r.label), /*#__PURE__*/React.createElement("small", null, r.time, r.current ? " · Current" : "")))))));
  }

  // ---------- Center pane (toolbar + canvas) ----------
  const TOOLS = [{
    key: "p",
    node: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontWeight: 700
      }
    }, "\xB6")
  }, {
    key: "h1",
    node: /*#__PURE__*/React.createElement("b", null, "H1")
  }, {
    key: "h2",
    node: /*#__PURE__*/React.createElement("b", null, "H2")
  }, {
    key: "h3",
    node: /*#__PURE__*/React.createElement("b", null, "H3")
  }, {
    div: true
  }, {
    key: "b",
    node: /*#__PURE__*/React.createElement("b", null, "B")
  }, {
    key: "i",
    node: /*#__PURE__*/React.createElement("i", null, "I")
  }, {
    key: "code",
    node: /*#__PURE__*/React.createElement(I.Code, null)
  }, {
    key: "link",
    node: /*#__PURE__*/React.createElement(I.Link, null)
  }, {
    div: true
  }, {
    key: "ul",
    node: /*#__PURE__*/React.createElement(I.List, null)
  }, {
    key: "quote",
    node: /*#__PURE__*/React.createElement(I.Quote, null)
  }, {
    div: true
  }, {
    key: "comment",
    node: /*#__PURE__*/React.createElement(I.Comment, null)
  }];
  function CenterPane({
    threads,
    activeThread,
    onAnchorClick,
    onComment,
    canvasRef
  }) {
    const anchorState = {};
    threads.forEach(t => {
      anchorState[t.id] = {
        active: t.id === activeThread,
        resolved: t.resolved
      };
    });
    return /*#__PURE__*/React.createElement("main", {
      className: "center-pane"
    }, /*#__PURE__*/React.createElement("div", {
      className: "canvas-toolbar"
    }, /*#__PURE__*/React.createElement("div", {
      className: "format-toolbar"
    }, TOOLS.map((t, i) => t.div ? /*#__PURE__*/React.createElement("span", {
      key: "d" + i,
      className: "toolbar-divider"
    }) : /*#__PURE__*/React.createElement("button", {
      key: t.key,
      className: t.key === "comment" ? "" : "",
      "aria-label": t.key
    }, t.node)))), /*#__PURE__*/React.createElement("div", {
      className: "markdown-canvas",
      ref: canvasRef,
      onMouseUp: onComment
    }, /*#__PURE__*/React.createElement("h1", null, DATA.doc.heading), DATA.doc.paragraphs.map(p => /*#__PURE__*/React.createElement("p", {
      key: p.id,
      "data-pid": p.id
    }, p.runs.map((run, ri) => {
      if (run.anchor) {
        const st = anchorState[run.anchor];
        return /*#__PURE__*/React.createElement("button", {
          key: ri,
          className: "anchor-highlight" + (st && st.active ? " is-active" : ""),
          style: {
            font: "inherit",
            border: 0,
            color: "inherit",
            lineHeight: "inherit"
          },
          onClick: e => {
            e.stopPropagation();
            onAnchorClick(run.anchor);
          }
        }, run.text);
      }
      if (run.strong) return /*#__PURE__*/React.createElement("strong", {
        key: ri
      }, run.text);
      return /*#__PURE__*/React.createElement("span", {
        key: ri
      }, run.text);
    })))));
  }

  // ---------- Right panel ----------
  function ThreadsPanel({
    threads,
    activeThread,
    setActiveThread,
    onAccept,
    onResolve,
    onAnchorScroll
  }) {
    const open = threads.filter(t => !t.resolved);
    const active = threads.find(t => t.id === activeThread);
    return /*#__PURE__*/React.createElement("div", {
      className: "panel-body"
    }, /*#__PURE__*/React.createElement("div", {
      className: "panel-toolbar"
    }, /*#__PURE__*/React.createElement("span", null, open.length, " visible \xB7 ", threads.length - open.length, " resolved"), /*#__PURE__*/React.createElement("button", null, /*#__PURE__*/React.createElement(I.Eye, null), " Show resolved")), !active && open.length === 0 && /*#__PURE__*/React.createElement("p", {
      className: "empty-note"
    }, "Select text in the canvas, then use the comment button in the toolbar."), /*#__PURE__*/React.createElement("div", {
      className: "thread-list"
    }, open.map(t => /*#__PURE__*/React.createElement(ThreadCard, {
      key: t.id,
      index: t.index,
      title: t.title,
      meta: t.meta,
      active: t.id === activeThread,
      onClick: () => setActiveThread(t.id === activeThread ? null : t.id)
    }))), active && /*#__PURE__*/React.createElement("div", {
      className: "thread-detail"
    }, /*#__PURE__*/React.createElement("div", {
      className: "thread-detail-header"
    }, /*#__PURE__*/React.createElement("span", null, "Open"), /*#__PURE__*/React.createElement("span", {
      className: "thread-actions"
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "small"
    }, "Ask agent"), /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "small",
      onClick: () => onResolve(active.id)
    }, "Resolve"))), /*#__PURE__*/React.createElement("button", {
      className: "thread-anchor-preview",
      onClick: () => onAnchorScroll(active.id)
    }, active.anchor), /*#__PURE__*/React.createElement("div", {
      className: "message-stack"
    }, active.messages.map(m => /*#__PURE__*/React.createElement(MessageBubble, {
      key: m.id,
      author: m.author,
      time: m.time,
      variant: m.variant
    }, m.text))), active.suggestion && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        display: "grid",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(SuggestionCard, {
      state: active.accepted ? "accepted" : "open",
      status: active.accepted ? "Accepted" : "Open"
    }, active.suggestion), !active.accepted && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "small",
      icon: /*#__PURE__*/React.createElement(I.Check, null),
      onClick: () => onAccept(active.id)
    }, "Accept"), /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "small"
    }, "Reject"))), /*#__PURE__*/React.createElement("div", {
      className: "composer"
    }, /*#__PURE__*/React.createElement("textarea", {
      rows: 2,
      placeholder: "Reply in this thread\u2026"
    }), /*#__PURE__*/React.createElement("div", {
      className: "composer-actions"
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "small",
      icon: /*#__PURE__*/React.createElement(I.Spark, null)
    }, "Skills"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "small"
    }, "Reply")))));
  }
  function ChatPanel({
    chat,
    onSend
  }) {
    const [draft, setDraft] = useState("");
    const [skills, setSkills] = useState(chat.skills);
    return /*#__PURE__*/React.createElement("div", {
      className: "panel-body chat-panel"
    }, /*#__PURE__*/React.createElement("div", {
      className: "chat-stack"
    }, /*#__PURE__*/React.createElement("div", {
      className: "memory-card"
    }, /*#__PURE__*/React.createElement("div", {
      className: "memory-card-header"
    }, /*#__PURE__*/React.createElement("span", null, "Context memory"), /*#__PURE__*/React.createElement("strong", null, chat.count)), /*#__PURE__*/React.createElement("p", null, "Editorial decisions, accepted changes, and revision requests stay available to the agent."), /*#__PURE__*/React.createElement("ol", null, chat.memory.map((m, i) => /*#__PURE__*/React.createElement("li", {
      key: i
    }, /*#__PURE__*/React.createElement("span", null, m.tag), m.text)))), chat.messages.map(m => /*#__PURE__*/React.createElement(MessageBubble, {
      key: m.id,
      author: m.author,
      time: m.time,
      variant: m.variant
    }, m.text))), /*#__PURE__*/React.createElement("div", {
      className: "composer chat-composer"
    }, /*#__PURE__*/React.createElement("div", {
      className: "skill-chip-row"
    }, skills.map(s => /*#__PURE__*/React.createElement(SkillChip, {
      key: s,
      onRemove: () => setSkills(skills.filter(x => x !== s))
    }, s))), /*#__PURE__*/React.createElement("textarea", {
      rows: 3,
      value: draft,
      onChange: e => setDraft(e.target.value),
      placeholder: "Discuss the draft, ask for a pass, or leave agent instructions\u2026"
    }), /*#__PURE__*/React.createElement("div", {
      className: "composer-actions"
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "small",
      icon: /*#__PURE__*/React.createElement(I.Spark, null)
    }, "Skills"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "small",
      icon: /*#__PURE__*/React.createElement(I.Send, null),
      onClick: () => {
        if (draft.trim()) {
          onSend(draft.trim());
          setDraft("");
        }
      }
    }, "Send"))));
  }

  // ---------- App ----------
  function EditorApp() {
    const [tab, setTab] = useState("threads");
    const [threads, setThreads] = useState(DATA.threads.map(t => ({
      ...t
    })));
    const [activeThread, setActiveThread] = useState("t1");
    const [chat, setChat] = useState(DATA.chat);
    const [saveState, setSaveState] = useState("saved");
    const [agentRunning, setAgentRunning] = useState(false);
    const [toast, setToast] = useState("");
    const [commentBtn, setCommentBtn] = useState(null);
    const canvasRef = useRef(null);
    const toastTimer = useRef(null);
    const flashToast = msg => {
      setToast(msg);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(""), 1900);
    };
    const openCount = threads.filter(t => !t.resolved).length;
    const onAnchorClick = id => {
      setTab("threads");
      setActiveThread(id);
    };
    const onAccept = id => {
      setThreads(ts => ts.map(t => t.id === id ? {
        ...t,
        accepted: true
      } : t));
      setSaveState("saving");
      setTimeout(() => setSaveState("saved"), 900);
      flashToast("Change accepted");
    };
    const onResolve = id => {
      setThreads(ts => ts.map(t => t.id === id ? {
        ...t,
        resolved: true
      } : t));
      setActiveThread(null);
      flashToast("Thread resolved");
    };
    const onSend = text => {
      const human = {
        id: "u" + Date.now(),
        author: "Human",
        time: "now",
        variant: "human",
        text
      };
      setChat(c => ({
        ...c,
        messages: [...c.messages, human]
      }));
      setAgentRunning(true);
      const typingId = "typing";
      setChat(c => ({
        ...c,
        messages: [...c.messages, human, {
          id: typingId,
          author: "Agent",
          variant: "agent",
          typing: true
        }]
      }));
      setTimeout(() => {
        setChat(c => ({
          ...c,
          messages: c.messages.filter(m => m.id !== typingId).concat({
            id: "a" + Date.now(),
            author: "Agent",
            time: "now",
            variant: "agent",
            text: "On it — I'll return a reviewable diff that sharpens that pass while keeping the founder-to-founder voice."
          })
        }));
        setAgentRunning(false);
      }, 1500);
    };

    // selection → floating comment button
    const onComment = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !canvasRef.current) {
        setCommentBtn(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!canvasRef.current.contains(range.commonAncestorContainer)) {
        setCommentBtn(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width < 2) {
        setCommentBtn(null);
        return;
      }
      setCommentBtn({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
        text: sel.toString()
      });
    };
    const addThread = () => {
      if (!commentBtn) return;
      const id = "t" + (threads.length + 1);
      const text = commentBtn.text.slice(0, 64);
      const nt = {
        id,
        index: threads.length + 1,
        anchor: text,
        title: text,
        meta: "1 message · open",
        resolved: false,
        messages: [{
          id: "nm",
          author: "Human",
          time: "now",
          variant: "human",
          text: ""
        }],
        suggestion: null
      };
      // keep messages empty-friendly: drop the empty seed
      nt.messages = [];
      setThreads(ts => [...ts, nt]);
      setTab("threads");
      setActiveThread(id);
      setCommentBtn(null);
      window.getSelection().removeAllRanges();
      flashToast("Comment thread added");
    };
    useEffect(() => {
      const clear = () => setCommentBtn(null);
      window.addEventListener("scroll", clear, true);
      return () => window.removeEventListener("scroll", clear, true);
    }, []);
    return /*#__PURE__*/React.createElement("div", {
      className: "app-shell"
    }, /*#__PURE__*/React.createElement(Topbar, {
      saveState: saveState,
      agentRunning: agentRunning,
      onToggleAgent: () => setAgentRunning(v => !v)
    }), /*#__PURE__*/React.createElement("div", {
      className: "workspace"
    }, /*#__PURE__*/React.createElement(LeftRail, {
      openCount: openCount,
      onScrollToHeading: () => {}
    }), /*#__PURE__*/React.createElement(CenterPane, {
      threads: threads,
      activeThread: activeThread,
      onAnchorClick: onAnchorClick,
      onComment: onComment,
      canvasRef: canvasRef
    }), /*#__PURE__*/React.createElement("aside", {
      className: "right-panel"
    }, /*#__PURE__*/React.createElement("div", {
      className: "right-panel-content"
    }, /*#__PURE__*/React.createElement("div", {
      className: "panel-tabs"
    }, /*#__PURE__*/React.createElement("button", {
      className: "right-collapse-button in-panel",
      "aria-label": "Collapse"
    }, /*#__PURE__*/React.createElement(I.ChevRight, null)), /*#__PURE__*/React.createElement(Tabs, {
      fill: true,
      value: tab,
      onChange: setTab,
      tabs: [{
        value: "threads",
        label: "Threads",
        icon: /*#__PURE__*/React.createElement(I.Comment, null)
      }, {
        value: "chat",
        label: "Chat",
        icon: /*#__PURE__*/React.createElement(I.Spark, null)
      }]
    })), tab === "threads" ? /*#__PURE__*/React.createElement(ThreadsPanel, {
      threads: threads,
      activeThread: activeThread,
      setActiveThread: setActiveThread,
      onAccept: onAccept,
      onResolve: onResolve,
      onAnchorScroll: onAnchorClick
    }) : /*#__PURE__*/React.createElement(ChatPanel, {
      chat: chat,
      onSend: onSend
    })))), commentBtn && /*#__PURE__*/React.createElement("div", {
      className: "floating-comment",
      style: {
        left: commentBtn.x,
        top: commentBtn.y
      }
    }, /*#__PURE__*/React.createElement("button", {
      onMouseDown: e => {
        e.preventDefault();
        addThread();
      }
    }, /*#__PURE__*/React.createElement(I.Comment, null), " Comment")), /*#__PURE__*/React.createElement("div", {
      className: "toast" + (toast ? " is-visible" : "")
    }, toast));
  }
  window.SkribeEditorApp = EditorApp;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/editor/EditorApp.jsx", error: String((e && e.message) || e) }); }

// ui_kits/editor/editorData.js
try { (() => {
// Skribe editor UI kit — seed content. Plain globals (no modules).
window.SkribeEditorData = {
  doc: {
    title: "Internal draft",
    file: "primitive-wedge-demo.md",
    words: 4058,
    heading: "Primitives for AI-native development",
    // Each paragraph: id, runs[] where a run is {text} or {text, anchor: threadId}
    paragraphs: [{
      id: "p1",
      runs: [{
        text: "And just like that — we're back on Substack. I'll save the detail on all that for another time. For now, this post is about something I've been thinking about a lot lately."
      }]
    }, {
      id: "p2",
      runs: [{
        text: "Every other day I see another X thread or Product Hunt post promising the next great AI developer platform."
      }]
    }, {
      id: "p3",
      runs: [{
        text: "Big technology shifts create big reactions from founders. When the surface area gets messy, "
      }, {
        text: "the answer gets packaged as something bigger",
        anchor: "t1"
      }, {
        text: ": AI engineering clouds, agentic SDLC platforms, control planes for generated work."
      }]
    }, {
      id: "p4",
      runs: [{
        text: "But most companies still have to earn their way in through one narrow capability first."
      }]
    }, {
      id: "p5",
      runs: [{
        text: "In this post, I'll cover what I mean by a primitive, why the next really large AI dev tool companies are likely to start with one, where I think those primitives are forming, and how to test whether a narrow product is a wedge or just a feature."
      }]
    }, {
      id: "p6",
      runs: [{
        text: "They'll own what I call a "
      }, {
        text: "Primitive Wedge",
        strong: true
      }, {
        text: " — a narrow capability that becomes the default way developers do one important thing, then expands after the dependency is real."
      }]
    }, {
      id: "p7",
      runs: [{
        text: "Own the verb. Become the default. Expand from there."
      }]
    }]
  },
  outline: [{
    level: 1,
    label: "Primitives for AI-native development"
  }, {
    level: 2,
    label: "What is a primitive?"
  }, {
    level: 2,
    label: "Platforms have to be earned"
  }, {
    level: 3,
    label: "Secure execution"
  }, {
    level: 3,
    label: "Context & verification"
  }, {
    level: 2,
    label: "What should founders look for?"
  }],
  revisions: [{
    id: "r1",
    label: "Tightened the opening",
    time: "JUN 4 · 08:35",
    current: true
  }, {
    id: "r0",
    label: "First import",
    time: "JUN 4 · 08:02",
    current: false
  }],
  threads: [{
    id: "t1",
    index: 1,
    anchor: "the answer gets packaged as something bigger",
    title: "the answer gets packaged as something bigger",
    meta: "3 messages · open",
    resolved: false,
    messages: [{
      id: "m1",
      author: "Human",
      time: "10:14",
      variant: "human",
      text: "This feels a bit abstract. Can we make the platform reflex sharper?"
    }, {
      id: "m2",
      author: "Agent",
      time: "10:15",
      variant: "agent",
      text: "Yes. I'd make the causal move clearer: the market sees a messy surface, then founders package the answer as a platform before they have earned the workflow."
    }],
    suggestion: "Big technology shifts expose messy surfaces. The answer then gets packaged as something bigger: AI engineering clouds, agentic SDLC platforms, and control planes for generated work."
  }],
  chat: {
    memory: [{
      tag: "Accepted change",
      text: "Tightened the opening to reach the thesis faster."
    }, {
      tag: "Thread decision",
      text: "Kept the DevTune section as a concise postscript."
    }],
    count: 12,
    messages: [{
      id: "c1",
      author: "Human",
      time: "09:41",
      variant: "human",
      text: "Give me a sharper pass on the opening, but keep the voice direct and founder-to-founder."
    }, {
      id: "c2",
      author: "Agent",
      time: "09:42",
      variant: "agent",
      text: "I'd make this a reviewable diff: cut the throat-clearing, name the primitive wedge sooner, and preserve the dry aside in paragraph three."
    }, {
      id: "c3",
      author: "Human",
      time: "09:44",
      variant: "human",
      text: "Show me the diff in the editor."
    }],
    skills: ["/humanizer", "/copywriting", "/plgeek-voice"]
  }
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/editor/editorData.js", error: String((e && e.message) || e) }); }

// ui_kits/editor/icons.jsx
try { (() => {
// Shared inline icons for the editor kit (assigned to window for cross-file use).
(function () {
  const S = (paths, extra) => function Icon(props) {
    return React.createElement("svg", Object.assign({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, extra, props), paths.map((d, i) => React.createElement("path", {
      key: i,
      d
    })));
  };
  window.SkIcons = {
    Spark: S(["m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"]),
    Disk: S(["M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z", "M17 21v-8H7v8M7 3v5h8"]),
    Gear: S(["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"]),
    Export: S(["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"]),
    Copy: S(["M9 9h11v11H9z", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"]),
    Download: S(["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"]),
    File: S(["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"]),
    Clock: S(["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"]),
    Chat: S(["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"]),
    Comment: S(["M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"]),
    Eye: S(["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"]),
    Send: S(["M22 2 11 13", "M22 2 15 22l-4-9-9-4z"]),
    ChevLeft: S(["m15 18-6-6 6-6"]),
    ChevRight: S(["m9 18 6-6-6-6"]),
    ChevDown: S(["m6 9 6 6 6-6"]),
    List: S(["M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"]),
    Quote: S(["M3 21c3 0 7-1 7-8V5c0-1.25-.756-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1v2c0 1-1 1-1 1z", "M14 21c3 0 7-1 7-8V5c0-1.25-.757-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h.5c.5 0 1 0 1 1v2c0 1-1 1-1 1z"]),
    Link: S(["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"]),
    Code: S(["m16 18 6-6-6-6", "m8 6-6 6 6 6"]),
    Check: S(["M20 6 9 17l-5-5"], {
      strokeWidth: 2.4
    }),
    Cross: S(["M18 6 6 18M6 6l12 12"], {
      strokeWidth: 2.4
    }),
    Refresh: S(["M3 2v6h6", "M3 13a9 9 0 1 0 3-7.7L3 8"])
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/editor/icons.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.SkillChip = __ds_scope.SkillChip;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.MessageBubble = __ds_scope.MessageBubble;

__ds_ns.SuggestionCard = __ds_scope.SuggestionCard;

__ds_ns.ThreadCard = __ds_scope.ThreadCard;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Pill = __ds_scope.Pill;

})();
