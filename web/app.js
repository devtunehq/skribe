/* Skribe landing — precompiled from app.jsx (no runtime Babel). Do not edit by hand. */
/* Skribe landing page. Composes Skribe Design System primitives
   (Button, IconButton, Pill, SkillChip) over custom landing layout.
   Content sourced from the project README. */

const {
  Button,
  IconButton,
  Pill,
  SkillChip
} = window.SkribeDesignSystem_a6e4e0;
const I = window.SkIcons;
const REPO = "https://github.com/devtunehq/skribe";
const NPX = "npx skribe-editor ~/draft.md";

/* GitHub mark (not part of the DS line set — drawn to match weight) */
const GitHub = props => React.createElement("svg", Object.assign({
  viewBox: "0 0 24 24",
  fill: "currentColor",
  className: "gh-mark"
}, props), React.createElement("path", {
  d: "M12 1.5C6.2 1.5 1.5 6.3 1.5 12.2c0 4.7 3 8.7 7.2 10.1.5.1.7-.2.7-.5v-1.7c-2.9.6-3.5-1.3-3.5-1.3-.5-1.2-1.2-1.5-1.2-1.5-.9-.7.1-.6.1-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.3-.3-4.7-1.2-4.7-5.2 0-1.2.4-2.1 1.1-2.8-.1-.3-.5-1.4.1-2.8 0 0 .9-.3 2.9 1.1.8-.2 1.7-.3 2.6-.3.9 0 1.8.1 2.6.3 2-1.4 2.9-1.1 2.9-1.1.6 1.4.2 2.5.1 2.8.7.7 1.1 1.6 1.1 2.8 0 4-2.4 4.9-4.7 5.2.4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5 4.2-1.4 7.2-5.4 7.2-10.1C22.5 6.3 17.8 1.5 12 1.5z"
}));
function copyCmd(setCopied) {
  const done = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1900);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(NPX).then(done).catch(() => fallbackCopy(done));
  } else {
    fallbackCopy(done);
  }
}
function fallbackCopy(done) {
  const ta = document.createElement("textarea");
  ta.value = NPX;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch (e) {}
  document.body.removeChild(ta);
  done();
}

/* ---------------- Topbar ---------------- */
function Topbar() {
  return /*#__PURE__*/React.createElement("header", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wrap topbar__inner"
  }, /*#__PURE__*/React.createElement("a", {
    className: "brand",
    href: "#top"
  }, /*#__PURE__*/React.createElement("img", {
    className: "brand__icon",
    src: "assets/skribe-icon.png",
    alt: "Skribe"
  }), /*#__PURE__*/React.createElement("span", {
    className: "brand__name"
  }, "Skribe")), /*#__PURE__*/React.createElement("nav", {
    className: "topbar__nav"
  }, /*#__PURE__*/React.createElement("a", {
    className: "navlink nav-hide-sm",
    href: "#features"
  }, "Features"), /*#__PURE__*/React.createElement("a", {
    className: "navlink nav-hide-sm",
    href: "#surfaces"
  }, "Threads & Chat"), /*#__PURE__*/React.createElement("a", {
    className: "navlink nav-hide-sm",
    href: "#quickstart"
  }, "Quick start"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: /*#__PURE__*/React.createElement(GitHub, null),
    onClick: () => window.open(REPO, "_blank", "noopener")
  }, "GitHub"))));
}

/* ---------------- Hero ---------------- */
function Hero() {
  const [copied, setCopied] = React.useState(false);
  return /*#__PURE__*/React.createElement("section", {
    className: "hero wrap",
    id: "top"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hero__eyebrow"
  }, /*#__PURE__*/React.createElement(Pill, {
    state: "accent"
  }, I.File && /*#__PURE__*/React.createElement(I.File, null), " Local-first Markdown workbench")), /*#__PURE__*/React.createElement("h1", null, "Markdown writing with an ", /*#__PURE__*/React.createElement("span", {
    className: "mark"
  }, "AI review partner")), /*#__PURE__*/React.createElement("p", {
    className: "hero__sub"
  }, "An editable Markdown canvas with anchored comment threads, chat, reviewable diffs and revision history. ", /*#__PURE__*/React.createElement("strong", null, "The document stays local. Review state stays local.")), /*#__PURE__*/React.createElement("div", {
    className: "cta"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cmd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cmd__text"
  }, /*#__PURE__*/React.createElement("span", {
    className: "cmd__prompt"
  }, "$"), NPX), /*#__PURE__*/React.createElement("button", {
    className: "cmd__copy" + (copied ? " is-copied" : ""),
    onClick: () => copyCmd(setCopied),
    "aria-label": "Copy install command"
  }, copied ? /*#__PURE__*/React.createElement(I.Check, null) : /*#__PURE__*/React.createElement(I.Copy, null), copied ? "Copied" : "Copy")), /*#__PURE__*/React.createElement("p", {
    className: "cta__note"
  }, "Run without installing. Bring your own AI subscription \u2014 Codex CLI, Claude Code, more to come.", " ", /*#__PURE__*/React.createElement("a", {
    href: REPO,
    target: "_blank",
    rel: "noopener"
  }, "Read the docs \u2192"))), /*#__PURE__*/React.createElement("div", {
    className: "trust"
  }, /*#__PURE__*/React.createElement(Pill, null, "MIT licensed"), /*#__PURE__*/React.createElement(Pill, null, "Theme support"), /*#__PURE__*/React.createElement(Pill, null, "Provider-agnostic"), /*#__PURE__*/React.createElement(Pill, null, "Local-only storage")));
}

/* ---------------- Product shot ---------------- */
function Showcase() {
  return /*#__PURE__*/React.createElement("section", {
    className: "showcase wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "window"
  }, /*#__PURE__*/React.createElement("div", {
    className: "window__bar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "window__dots"
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null)), /*#__PURE__*/React.createElement("span", {
    className: "window__title"
  }, "Skribe \u2014 editor")), /*#__PURE__*/React.createElement("img", {
    src: "assets/editor.png",
    alt: "The Skribe editor: a rendered, editable Markdown canvas with outline rail and review panel"
  })));
}

/* ---------------- Features ---------------- */
const FEATURES = [{
  icon: "File",
  title: "Editable canvas",
  body: "Rendered Markdown you edit in place — headings, links, images, lists, quotes, code, GFM tables and keyboard shortcuts."
}, {
  icon: "Comment",
  title: "Anchored threads",
  body: "Pin comments to a selection or paragraph for focused, passage-level review and replacement suggestions."
}, {
  icon: "Chat",
  title: "Document chat",
  body: "Article-level discussion, broad review passes, structural edits and skill-driven rewrites across the whole draft."
}, {
  icon: "Refresh",
  title: "Reviewable diffs",
  body: "Accept, decline, rewrite or comment on every change block — in split or unified view — before it touches the draft."
}, {
  icon: "Spark",
  title: "Agent skills",
  body: "Reusable /slash writing passes — voice, humanising, copyediting — from any local skill your CLI runtime knows."
}, {
  icon: "Disk",
  title: "Stays local",
  body: "The Markdown file, review state, settings and revisions are stored on your machine. Nothing leaves it."
}];
function Features() {
  return /*#__PURE__*/React.createElement("section", {
    className: "section",
    id: "features"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-head"
  }, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Built around the document"), /*#__PURE__*/React.createElement("h2", null, "Long-form editing, not a chat transcript"), /*#__PURE__*/React.createElement("p", null, "Skribe keeps clean document content separate from review state, so writing stays fast while comments, diffs and history live alongside.")), /*#__PURE__*/React.createElement("div", {
    className: "features-grid"
  }, FEATURES.map(f => {
    const Icon = I[f.icon];
    return /*#__PURE__*/React.createElement("article", {
      className: "feature",
      key: f.title
    }, /*#__PURE__*/React.createElement("div", {
      className: "feature__icon"
    }, Icon && /*#__PURE__*/React.createElement(Icon, null)), /*#__PURE__*/React.createElement("h3", null, f.title), /*#__PURE__*/React.createElement("p", null, f.body));
  }))));
}

/* ---------------- Threads vs Chat ---------------- */
function Surfaces() {
  return /*#__PURE__*/React.createElement("section", {
    className: "section",
    id: "surfaces",
    style: {
      background: "var(--canvas-oat)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-head"
  }, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Two surfaces, one document"), /*#__PURE__*/React.createElement("h2", null, "Threads for the passage. Chat for the draft."), /*#__PURE__*/React.createElement("p", null, "Skribe has two agent conversation surfaces because they serve different editorial jobs. Each sees exactly the context it needs.")), /*#__PURE__*/React.createElement("div", {
    className: "duo"
  }, /*#__PURE__*/React.createElement("article", {
    className: "duo-card"
  }, /*#__PURE__*/React.createElement("span", {
    className: "duo-card__tab"
  }, "Anchored"), /*#__PURE__*/React.createElement("h3", null, I.Comment && /*#__PURE__*/React.createElement(I.Comment, null), " Threads"), /*#__PURE__*/React.createElement("div", {
    className: "duo-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "duo-row__k"
  }, "Use it for"), /*#__PURE__*/React.createElement("p", {
    className: "duo-row__v"
  }, "Anchored comments on selected text, paragraph-level rewrites, local clarification and focused suggestions.")), /*#__PURE__*/React.createElement("div", {
    className: "duo-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "duo-row__k"
  }, "What the agent sees"), /*#__PURE__*/React.createElement("p", {
    className: "duo-row__v"
  }, "The selected passage, the thread history, relevant document context and previous decisions."))), /*#__PURE__*/React.createElement("article", {
    className: "duo-card"
  }, /*#__PURE__*/React.createElement("h3", null, I.Chat && /*#__PURE__*/React.createElement(I.Chat, null), " Chat"), /*#__PURE__*/React.createElement("div", {
    className: "duo-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "duo-row__k"
  }, "Use it for"), /*#__PURE__*/React.createElement("p", {
    className: "duo-row__v"
  }, "Article-level discussion, broad review passes, structural edits, skill-driven rewrites and document-level diffs.")), /*#__PURE__*/React.createElement("div", {
    className: "duo-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "duo-row__k"
  }, "What the agent sees"), /*#__PURE__*/React.createElement("p", {
    className: "duo-row__v"
  }, "The wider document, chat history, context memory, open proposals, thread decisions and selected skills.")))), /*#__PURE__*/React.createElement("p", {
    className: "duo-foot"
  }, "Use ", /*#__PURE__*/React.createElement("strong", null, "Threads"), " when the question belongs to a specific passage. Use ", /*#__PURE__*/React.createElement("strong", null, "Chat"), " when it belongs to the whole draft."), /*#__PURE__*/React.createElement("div", {
    className: "skills"
  }, /*#__PURE__*/React.createElement("div", {
    className: "skills__copy"
  }, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Skills"), /*#__PURE__*/React.createElement("p", null, "Reusable ", /*#__PURE__*/React.createElement("code", null, "/slash"), " instructions discovered from your local skill roots. Browse them, autocomplete with ", /*#__PURE__*/React.createElement("code", null, "/"), ", or set favourite defaults \u2014 the native CLI loads and follows them before replying.")), /*#__PURE__*/React.createElement("div", {
    className: "skills__chips"
  }, /*#__PURE__*/React.createElement(SkillChip, null, "/humanizer"), /*#__PURE__*/React.createElement(SkillChip, null, "/copywriting"), /*#__PURE__*/React.createElement(SkillChip, null, "/voice"), /*#__PURE__*/React.createElement(SkillChip, null, "/newsletter-review"), /*#__PURE__*/React.createElement(SkillChip, {
    muted: true
  }, "/copyediting")))));
}

/* ---------------- Shots ---------------- */
function Shots() {
  return /*#__PURE__*/React.createElement("section", {
    className: "section wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "shots"
  }, /*#__PURE__*/React.createElement("div", {
    className: "shot"
  }, /*#__PURE__*/React.createElement("div", {
    className: "shot__text"
  }, /*#__PURE__*/React.createElement("h3", null, "Review in context"), /*#__PURE__*/React.createElement("p", null, "Anchor comments to highlighted passages, discuss the local edit, then accept a focused replacement suggestion \u2014 the yellow mark keeps the conversation tied to the words.")), /*#__PURE__*/React.createElement("div", {
    className: "window"
  }, /*#__PURE__*/React.createElement("div", {
    className: "window__bar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "window__dots"
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null)), /*#__PURE__*/React.createElement("span", {
    className: "window__title"
  }, "Skribe \u2014 threads")), /*#__PURE__*/React.createElement("img", {
    src: "assets/threads.png",
    alt: "Skribe threads: an anchored comment with agent reply and a suggested replacement"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "shot shot--rev"
  }, /*#__PURE__*/React.createElement("div", {
    className: "window"
  }, /*#__PURE__*/React.createElement("div", {
    className: "window__bar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "window__dots"
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null)), /*#__PURE__*/React.createElement("span", {
    className: "window__title"
  }, "Skribe \u2014 diff review")), /*#__PURE__*/React.createElement("img", {
    src: "assets/diff.png",
    alt: "Skribe diff review: proposed changes shown inline with accept, decline, rewrite and comment actions"
  })), /*#__PURE__*/React.createElement("div", {
    className: "shot__text"
  }, /*#__PURE__*/React.createElement("h3", null, "Accept, decline, revise"), /*#__PURE__*/React.createElement("p", null, "Agent edits arrive as a reviewable proposal. Step through each change block in split or unified view and accept, decline, rewrite or comment before anything touches your draft.")))));
}

/* ---------------- Quick start ---------------- */
function QuickStart() {
  return /*#__PURE__*/React.createElement("section", {
    className: "section quickstart",
    id: "quickstart"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-head"
  }, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Quick start"), /*#__PURE__*/React.createElement("h2", null, "Open a draft in seconds"), /*#__PURE__*/React.createElement("p", null, "Skribe starts a local server and prints the browser URL. It drives the native agent CLI you already have signed in.")), /*#__PURE__*/React.createElement("div", {
    className: "qs-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "qs-card"
  }, /*#__PURE__*/React.createElement("span", {
    className: "qs-card__label"
  }, "Run without installing"), /*#__PURE__*/React.createElement("div", {
    className: "codeblock"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ln"
  }, /*#__PURE__*/React.createElement("span", {
    className: "p"
  }, "npx"), " skribe-editor ~/draft.md")), /*#__PURE__*/React.createElement("p", {
    className: "qs-req"
  }, /*#__PURE__*/React.createElement("strong", null, "Requires"), /*#__PURE__*/React.createElement("br", null), "Node.js 20+ and npm. Optionally Codex CLI or Claude Code for live agent replies from your existing subscription.")), /*#__PURE__*/React.createElement("div", {
    className: "qs-card"
  }, /*#__PURE__*/React.createElement("span", {
    className: "qs-card__label"
  }, "Or install globally"), /*#__PURE__*/React.createElement("div", {
    className: "codeblock"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ln"
  }, /*#__PURE__*/React.createElement("span", {
    className: "p"
  }, "npm"), " install -g skribe-editor"), /*#__PURE__*/React.createElement("span", {
    className: "ln"
  }, "skribe ~/draft.md")), /*#__PURE__*/React.createElement("p", {
    className: "qs-req"
  }, /*#__PURE__*/React.createElement("strong", null, "Runtime"), /*#__PURE__*/React.createElement("br", null), "Set ", /*#__PURE__*/React.createElement("code", null, "SKRIBE_AGENT_RUNTIME"), " to ", /*#__PURE__*/React.createElement("code", null, "codex"), ", ", /*#__PURE__*/React.createElement("code", null, "claude"), " or ", /*#__PURE__*/React.createElement("code", null, "auto"), ". Your CLI still owns auth, models and billing."))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--space-3)",
      marginTop: "var(--space-8)",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: /*#__PURE__*/React.createElement(GitHub, null),
    onClick: () => window.open(REPO, "_blank", "noopener")
  }, "View the repo"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: I.Code && /*#__PURE__*/React.createElement(I.Code, null),
    onClick: () => window.open(REPO + "#run-from-source", "_blank", "noopener")
  }, "Run from source"))));
}

/* ---------------- Footer ---------------- */
function Footer() {
  return /*#__PURE__*/React.createElement("footer", {
    className: "footer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer__inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer__brand"
  }, /*#__PURE__*/React.createElement("a", {
    className: "brand",
    href: "#top"
  }, /*#__PURE__*/React.createElement("img", {
    className: "brand__icon",
    src: "assets/skribe-icon.png",
    alt: "Skribe"
  }), /*#__PURE__*/React.createElement("span", {
    className: "brand__name"
  }, "Skribe")), /*#__PURE__*/React.createElement("p", null, "A local-first Markdown writing and review workbench, for writers who still enjoy the writing process.")), /*#__PURE__*/React.createElement("div", {
    className: "footer__links"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer__col"
  }, /*#__PURE__*/React.createElement("h4", null, "Product"), /*#__PURE__*/React.createElement("a", {
    href: "#features"
  }, "Features"), /*#__PURE__*/React.createElement("a", {
    href: "#surfaces"
  }, "Threads & Chat"), /*#__PURE__*/React.createElement("a", {
    href: "#quickstart"
  }, "Quick start")), /*#__PURE__*/React.createElement("div", {
    className: "footer__col"
  }, /*#__PURE__*/React.createElement("h4", null, "Project"), /*#__PURE__*/React.createElement("a", {
    href: REPO,
    target: "_blank",
    rel: "noopener"
  }, "GitHub repo"), /*#__PURE__*/React.createElement("a", {
    href: REPO + "/blob/main/README.md",
    target: "_blank",
    rel: "noopener"
  }, "README"), /*#__PURE__*/React.createElement("a", {
    href: REPO + "/blob/main/LICENSE",
    target: "_blank",
    rel: "noopener"
  }, "MIT License")))), /*#__PURE__*/React.createElement("div", {
    className: "footer__legal"
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 THE PRODUCT-LED GEEK \xB7 MIT"), /*#__PURE__*/React.createElement("span", null, "Local-first. Your words stay yours."))));
}
function App() {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Topbar, null), /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement(Hero, null), /*#__PURE__*/React.createElement(Showcase, null), /*#__PURE__*/React.createElement(Features, null), /*#__PURE__*/React.createElement(Surfaces, null), /*#__PURE__*/React.createElement(Shots, null), /*#__PURE__*/React.createElement(QuickStart, null)), /*#__PURE__*/React.createElement(Footer, null));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));