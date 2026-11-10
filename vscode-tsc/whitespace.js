"use strict";
// Whitespace checks for Typed Symbolic Code, following the spec's 1.2
// (tokens and whitespace) and 1.5 (layout). No dependency on vscode, so it
// can be run and tested with plain node.
//
// checkWhitespace(text) returns issues:
//   { start, end, message, severity: "warning" | "error", edits }
// start/end are offsets of the range to underline. edits is a list of
// { start, end, text } replacements that fix the issue.
// fixAll(text) applies every fix, repeating until nothing changes.

// 1.2.7: the fixed set of symbol tokens, longest first for maximal munch.
const SYMBOLS = ["->", "=>", "==", "<=", ">=", "::", "..", ".", ":", "=", "@", "^", "+", "-", "*", "/", "%", "<", ">"];
// 1.2.8: spacing categories of the symbol tokens.
const OPERATORS = new Set(["+", "-", "*", "/", "%", "==", "<", ">", "<=", ">="]);
const SEPARATORS = new Set(["->", "=", "=>", "@", ":"]);
const CLOSER_OF = { "(": ")", "[": "]", "{": "}" };
const OPENER_OF = { ")": "(", "]": "[", "}": "{" };

const IDENT = /[\p{L}_][\p{L}\p{N}_]*/uy;
const WORD_TAIL = /[\p{L}\p{N}_]*/uy;
const isDigit = (c) => c >= "0" && c <= "9";
// A rule tag such as [1.2.7] or [5.7.1.3, 6.6] closing a spec example's
// outcome comment.
const SPEC_OUTCOME = /\b(warning|error):.*\[\d+(\.\d+)+(,\s*\d+(\.\d+)+)*\]\s*$/;
// Grammar notation (spec 0.2): <Category T>, X..., which is not real code.
const NOTATION = /<[A-Z]|[\w>\]]\.\.\.(?!\.)/;

// Wide characters, such as 日, take two columns in the editor.
function charWidth(cp) {
  return (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff)
    || (cp >= 0x20000 && cp <= 0x3fffd) ? 2 : 1;
}

function width(str) {
  let w = 0;
  for (const ch of str) w += ch === "\t" ? 4 : charWidth(ch.codePointAt(0));
  return w;
}

function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ---- lexing (1.2) ---------------------------------------------------------

// kind: comment | word | sep | join | prefix | dots | bracket | other
//   word    identifiers, keywords, literals, _ and the operators
//   join    . and ::, tight on both sides
//   prefix  ^, tight after (a prefix .. becomes this too, see classifyDots)
//   dots    .., until classified
function lex(text) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  const push = (start, kind, sub) => tokens.push({ start, end: i, text: text.slice(start, i), kind, sub });

  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
    const start = i;

    if (c === ";") {
      const e = text.indexOf("\n", i);
      i = e < 0 ? n : e;
      if (text[i - 1] === "\r") i--;
      push(start, "comment");
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < n && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
      i = Math.min(i + 1, n);
      push(start, "word", "string");
      continue;
    }

    const prev = tokens[tokens.length - 1];
    if (isDigit(c) || (c === "-" && isDigit(text[i + 1]))) {
      if (prev && prev.text === "." && prev.end === start) {
        // 2.3.3: digits after a . are a list index, never a float.
        while (isDigit(text[i])) i++;
      } else {
        WORD_TAIL.lastIndex = c === "-" ? i + 1 : i;
        WORD_TAIL.exec(text);
        i = WORD_TAIL.lastIndex;
        const radix = /^-?0[xob]/.test(text.slice(start, start + 3));
        if (!radix && text[i] === "." && isDigit(text[i + 1])) {
          WORD_TAIL.lastIndex = i + 1;
          WORD_TAIL.exec(text);
          i = WORD_TAIL.lastIndex;
        }
        if (!radix && /[eE]$/.test(text.slice(start, i)) && (text[i] === "+" || text[i] === "-") && isDigit(text[i + 1])) {
          WORD_TAIL.lastIndex = i + 1;
          WORD_TAIL.exec(text);
          i = WORD_TAIL.lastIndex;
        }
      }
      push(start, "word", "number");
      continue;
    }

    IDENT.lastIndex = i;
    if (IDENT.exec(text)) {
      i = IDENT.lastIndex;
      push(start, "word", "ident");
      continue;
    }

    if ("([{)]}|".includes(c)) {
      i++;
      push(start, "bracket");
      continue;
    }

    const sym = SYMBOLS.find((s) => text.startsWith(s, i));
    if (sym) {
      i += sym.length;
      const kind = OPERATORS.has(sym) ? "word"
        : SEPARATORS.has(sym) ? "sep"
        : sym === "." || sym === "::" ? "join"
        : sym === "^" ? "prefix"
        : "dots";
      push(start, kind, OPERATORS.has(sym) ? "operator" : undefined);
      continue;
    }

    i++;
    push(start, "other");
  }
  return tokens;
}

// ---- structure ------------------------------------------------------------

// Pairs brackets and bars, and records for every token the form it sits in.
// Bars pair up within one level of brackets (2.4.1.2). A header comment
// (;; or more at the start of a line) resets everything, so one broken
// example cannot throw off the rest of a file.
function annotate(text, tokens, starts) {
  const stack = [];
  let nextId = 0;
  const lineIndent = new Map(); // line -> column of its first token

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    t.index = k;
    t.line = lineOf(starts, t.start);
    t.endLine = lineOf(starts, Math.max(t.start, t.end - 1));
    t.col = width(text.slice(starts[t.line], t.start));
    t.endCol = width(text.slice(starts[t.endLine], t.end));
    if (!lineIndent.has(t.line)) lineIndent.set(t.line, t.col);
    t.stackAtStart = stack.slice();
    t.enclosing = stack[stack.length - 1] || null;

    if (t.kind === "comment") {
      if (t.col === 0 && /^;;(?!:)/.test(t.text)) stack.length = 0;
      continue;
    }
    if (t.kind !== "bracket") continue;

    const top = stack[stack.length - 1];
    if (t.text === "|" && top && top.kind === "|") {
      t.role = "close";
      stack.pop();
    } else if (t.text === "|" || CLOSER_OF[t.text]) {
      t.role = "open";
      stack.push({ id: nextId++, kind: t.text, opener: k, line: t.line, lineIndent: lineIndent.get(t.line) });
    } else {
      t.role = "close";
      const want = OPENER_OF[t.text];
      const at = stack.map((e) => e.kind).lastIndexOf(want);
      if (at >= 0) stack.length = at;
    }
  }
  return lineIndent;
}

// The token after k that is not a comment.
function nextCode(tokens, k) {
  for (let j = k + 1; j < tokens.length; j++) if (tokens[j].kind !== "comment") return tokens[j];
  return null;
}

function prevCode(tokens, k) {
  for (let j = k - 1; j >= 0; j--) if (tokens[j].kind !== "comment") return tokens[j];
  return null;
}

// The head of the form an entry opens: the first token after its opener.
function headOf(tokens, entry) {
  if (!entry) return null;
  const h = nextCode(tokens, entry.opener);
  return h ? h.text : null;
}

// .. before a name copies fields (4.4.4) and is a joiner; anywhere else it
// skips items in a pattern (6.5) and is a separator. A list pattern never
// copies, and a .. followed by a field binding (name = ...) is a skip.
function classifyDots(tokens) {
  for (const t of tokens) {
    if (t.kind !== "dots") continue;
    const next = nextCode(tokens, t.index);
    const after = next && nextCode(tokens, next.index);
    const isPrefix = next && next.sub === "ident" && next.text !== "_"
      && !(after && after.text === "=")
      && t.enclosing && t.enclosing.kind === "("
      && headOf(tokens, t.enclosing) !== "list";
    t.kind = isPrefix ? "prefix" : "sep";
  }
}

// ---- checks ---------------------------------------------------------------

const spaces = (n) => " ".repeat(Math.max(0, n));
const show = (t) => (t.text.length > 12 ? t.text.slice(0, 10) + "…" : t.text);

function gapIssue(a, b, want, message, severity = "warning") {
  const gap = b.start - a.end;
  return {
    start: gap > 0 ? a.end : a.start,
    end: gap > 0 ? b.start : b.end,
    message,
    severity,
    edits: [{ start: a.end, end: b.start, text: spaces(want) }],
  };
}

// Lines up a set of tokens (each following another token on its line) in
// one column. Any shared column with at least one space everywhere is
// fine. Otherwise the target is the reachable column most of them already
// share, or else the first column every line can reach.
function alignColumn(tokens, group, message, issues, handled) {
  const items = group.map((t) => ({ t, prev: tokens[t.index - 1] }))
    .filter(({ t, prev }) => prev && prev.kind !== "comment" && prev.endLine === t.line);
  if (items.length < 2) return;
  const least = Math.max(...items.map(({ prev }) => prev.endCol + 1));
  const counts = new Map();
  for (const { t } of items) if (t.col >= least) counts.set(t.col, (counts.get(t.col) || 0) + 1);
  const ranked = [...counts].filter(([, n]) => n > 1).sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  const column = ranked.length ? ranked[0][0] : least;
  for (const { t, prev } of items) {
    handled.add(t);
    if (t.col !== column) issues.push(gapIssue(prev, t, column - prev.endCol, message));
  }
}

// 1.5.9: => in one column in a multi-line match, the opening | of each
// variant in one column in a multi-line enum, and, optionally, the : of
// each field in one column in a multi-line struct field list.
function checkAlignment(tokens, issues, handled) {
  const arms = new Map(); // match form id -> [=> tokens]
  const variants = new Map(); // enum form id -> [opening | tokens]
  const fields = new Map(); // struct field list id -> [: tokens]
  for (const t of tokens) {
    const e = t.enclosing;
    if (!e) continue;
    if (t.text === ":" && e.kind === "|" && headOf(tokens, tokens[e.opener].enclosing) === "struct") {
      const name = prevCode(tokens, t.index);
      const before = name && prevCode(tokens, name.index);
      if (name && name.sub === "ident" && name.line === t.line && before && before.endLine < t.line) {
        if (!fields.has(e.id)) fields.set(e.id, []);
        fields.get(e.id).push(t);
      }
    }
    if (t.text === "=>" && headOf(tokens, e) === "match") {
      if (!arms.has(e.id)) arms.set(e.id, []);
      arms.get(e.id).push(t);
    }
    if (t.text === "|" && t.role === "open" && headOf(tokens, e) === "enum") {
      const name = prevCode(tokens, t.index);
      const first = prevCode(tokens, name ? name.index : 0);
      if (name && name.sub === "ident" && name.line === t.line && (!first || first.endLine < t.line)) {
        if (!variants.has(e.id)) variants.set(e.id, []);
        variants.get(e.id).push(t);
      }
    }
  }
  const soleOnLine = (list) => list.filter((t) => list.filter((u) => u.line === t.line).length === 1);
  for (const list of arms.values()) {
    alignColumn(tokens, soleOnLine(list), "line up => with the other arms of this match (1.5.9)", issues, handled);
  }
  for (const list of variants.values()) {
    alignColumn(tokens, soleOnLine(list), "line up the opening | of each variant (1.5.9)", issues, handled);
  }
  // Fields each with one space before : need no lining up; once any is
  // padded, they all line up.
  for (const list of fields.values()) {
    const padded = list.some((t) => t.start - tokens[t.index - 1].end > 1);
    if (padded) alignColumn(tokens, list, "line up : with the other fields, or use one space before each (1.5.9)", issues, handled);
  }
}

// 1.2.5, 1.2.10 and 1.5.1: the spacing between two tokens on one line.
function checkPairs(tokens, issues, handled) {
  const code = tokens.filter((t) => t.kind !== "comment");
  for (let k = 0; k + 1 < code.length; k++) {
    const a = code[k], b = code[k + 1];
    if (a.endLine !== b.line || a.kind === "other" || b.kind === "other" || handled.has(b)) continue;
    const gap = b.start - a.end;

    let want = 1;
    if (a.role === "open" || b.role === "close" || a.kind === "join" || b.kind === "join" || a.kind === "prefix") want = 0;
    if (gap === want) continue;

    // 1.5.9: two spaces may separate the parameters of a signature.
    if (want === 1 && gap === 2 && b.enclosing && b.enclosing.kind === "|" && b.sub === "ident") {
      const next = code[k + 2];
      if (next && next.text === ":") continue;
    }

    let message, severity = "warning";
    if (want === 1) {
      message = gap === 0
        ? `add a space between ${show(a)} and ${show(b)} (1.5.1)`
        : `use one space between ${show(a)} and ${show(b)} (1.5.1)`;
    } else if (a.text === "." || b.text === ".") {
      message = "no whitespace around . (1.2.10)";
      severity = "error";
    } else if (a.text === "^") {
      message = "no whitespace after ^ (1.2.5)";
      severity = "error";
    } else if (a.text === "::" || b.text === "::") {
      message = "no whitespace around :: (1.2.10)";
    } else if (a.kind === "prefix") {
      message = "no whitespace after .. before a name (1.2.10)";
    } else if (a.role === "open") {
      message = `no space after ${a.text} (1.5.1)`;
    } else {
      message = `no space before ${b.text} (1.5.1)`;
    }
    issues.push(gapIssue(a, b, want, message, severity));
  }
}

// 1.5.2 and 1.5.6: indentation, and closers that start a line.
function checkLines(text, tokens, starts, lineIndent, issues) {
  const firstOnLine = new Map();
  for (const t of tokens) if (!firstOnLine.has(t.line)) firstOnLine.set(t.line, t);

  for (const [line, first] of firstOnLine) {
    if (first.kind === "comment") continue;
    const prev = prevCode(tokens, first.index);
    if (prev && prev.endLine === line) continue; // the line starts inside a multi-line string

    const lineStart = starts[line];
    const indentText = text.slice(lineStart, first.start);

    if (first.role === "close") {
      if (!prev) continue;
      let k = first.index, last = first;
      while (tokens[k + 1] && tokens[k + 1].role === "close" && tokens[k + 1].line === line) last = tokens[++k];
      const rest = nextCode(tokens, last.index);
      const restOnLine = rest && rest.line === line;
      const nextTok = tokens[last.index + 1];
      const lineEnd = line + 1 < starts.length ? starts[line + 1] : text.length;
      const edits = [{ start: prev.end, end: prev.end, text: text.slice(first.start, last.end) }];
      if (!restOnLine && !(nextTok && nextTok.line === line)) {
        // Nothing else on the line: remove it, line break included. On
        // the last line, the line break before it goes instead.
        const lastLine = line + 1 >= starts.length;
        const from = lastLine ? lineStart - (text[lineStart - 2] === "\r" ? 2 : 1) : lineStart;
        edits.push({ start: from, end: lineEnd, text: "" });
      } else {
        const after = nextTok && nextTok.line === line ? nextTok.start : last.end;
        edits.push({ start: first.start, end: after, text: "" });
      }
      issues.push({
        start: first.start,
        end: last.end,
        message: "a closer never starts a line; move it to the end of the line above (1.5.6)",
        severity: "warning",
        edits,
      });
      continue;
    }

    // 1.5.3: 4 more than the line the innermost open form starts on.
    // 1.5.7: an arm broken after => indents 4 more than the arm.
    const entry = first.stackAtStart[first.stackAtStart.length - 1];
    let want = entry ? entry.lineIndent + 4 : 0;
    if (prev && prev.text === "=>" && headOf(tokens, prev.enclosing) === "match") want = lineIndent.get(prev.line) + 4;

    if (indentText !== spaces(want)) {
      issues.push({
        start: lineStart,
        end: first.start > lineStart ? first.start : first.end,
        message: indentText.includes("\t")
          ? `indent with ${want} spaces, not tabs (1.5.2)`
          : `indent this line ${want} spaces (1.5.2, 1.5.3)`,
        severity: "warning",
        edits: [{ start: lineStart, end: first.start, text: spaces(want) }],
      });
    }
  }
}

// 1.5.8: at least two spaces before a trailing comment, and trailing
// comments on consecutive lines in one column.
function checkComments(tokens, issues) {
  const trailing = [];
  for (const t of tokens) {
    if (t.kind !== "comment") continue;
    const prev = tokens[t.index - 1];
    if (!prev || prev.endLine !== t.line) continue;
    let k = t.index;
    while (k > 0 && tokens[k - 1].line === t.line) k--;
    trailing.push({ t, prev, firstOnLine: tokens[k] });
  }
  let group = [];
  const flush = () => {
    if (!group.length) return;
    // The group's column is the one most of its comments already share (with
    // their two spaces); if none is shared, the first column every line can
    // reach. A line whose code runs past the column only needs two spaces.
    const counts = new Map();
    for (const { t, prev } of group) {
      if (t.col >= prev.endCol + 2) counts.set(t.col, (counts.get(t.col) || 0) + 1);
    }
    const ranked = [...counts].filter(([, n]) => n > 1).sort((x, y) => y[1] - x[1] || x[0] - y[0]);
    const column = ranked.length ? ranked[0][0]
      : group.length > 1 ? Math.max(...group.map(({ prev }) => prev.endCol + 2))
      : -Infinity; // a lone comment only needs its two spaces
    for (const { t, prev } of group) {
      const least = prev.endCol + 2;
      let target;
      if (least > column) {
        if (t.col >= least) continue;
        target = least;
      } else {
        if (t.col === column) continue;
        target = column;
      }
      const message = t.col < least
        ? "put at least two spaces before a trailing comment (1.5.8)"
        : "line up this comment with the trailing comments around it (1.5.8)";
      issues.push(gapIssue(prev, t, target - prev.endCol, message));
    }
    group = [];
  };
  // Trailing comments group by consecutive lines at the same depth, so the
  // comments inside a form and those of the next top-level form need not
  // line up with each other.
  const depth = (item) => {
    const first = item.firstOnLine;
    return first ? first.stackAtStart.length : 0;
  };
  for (const item of trailing) {
    const last = group[group.length - 1];
    if (last && (last.t.line !== item.t.line - 1 || depth(last) !== depth(item))) flush();
    group.push(item);
  }
  flush();
}

// Lines that are not checked:
// - grammar notation (spec 0.2), which is not code;
// - spec examples whose comment says they warn or fail, such as
//   "; warning: layout (1.5)  [1.2.7]", together with the lines of the form
//   they end, and a comment-only line that continues them.
function quietLines(text, starts, tokens) {
  const quiet = new Set();
  const byLine = new Map();
  for (const t of tokens) {
    if (!byLine.has(t.line)) byLine.set(t.line, []);
    byLine.get(t.line).push(t);
  }
  let head = null; // tokens of the first line of a worked breakdown (spec 2.6)
  for (const [line, list] of [...byLine].sort((x, y) => x[0] - y[0])) {
    const code = list.filter((t) => t.kind !== "comment");
    if (!code.length) continue;
    const end = code[code.length - 1].end;
    if (NOTATION.test(text.slice(starts[line], end))) quiet.add(line);
    // A breakdown line repeats tokens of the line above it in the same
    // columns: an indented top-level line whose every token is in the head.
    if (code[0].stackAtStart.length) { head = null; continue; }
    if (head && code.every((t) => head.some((h) => h.col === t.col && h.text === t.text))) quiet.add(line);
    else head = code[0].col === 0 ? code : null;
  }
  for (const t of tokens) {
    if (t.kind !== "comment" || !SPEC_OUTCOME.test(t.text)) continue;
    let target = prevCode(tokens, t.index);
    if (!target) continue;
    const onOwnLine = target.endLine !== t.line;
    if (onOwnLine && target.endLine !== t.line - 1) continue;
    if (onOwnLine) quiet.add(t.line);
    const first = byLine.get(target.line).find((u) => u.kind !== "comment") || target;
    const outer = first.stackAtStart[0];
    const from = outer ? outer.line : target.line;
    for (let l = from; l <= target.endLine; l++) quiet.add(l);
  }
  return quiet;
}

function checkWhitespace(text) {
  const starts = lineStartsOf(text);
  const tokens = lex(text);
  const lineIndent = annotate(text, tokens, starts);
  classifyDots(tokens);

  const issues = [];
  const handled = new Set();
  checkAlignment(tokens, issues, handled);
  checkPairs(tokens, issues, handled);
  checkLines(text, tokens, starts, lineIndent, issues);
  checkComments(tokens, issues);

  const quiet = quietLines(text, starts, tokens);
  return issues
    .filter((x) => !quiet.has(lineOf(starts, x.start)))
    .sort((x, y) => x.start - y.start);
}

// Applies edits that do not touch each other; returns the new text.
function applyEdits(text, edits) {
  const sorted = [...edits].sort((x, y) => x.start - y.start || x.end - y.end);
  let out = "", at = 0;
  for (const e of sorted) {
    if (e.start < at) continue;
    out += text.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + text.slice(at);
}

// Every fix, repeated until nothing changes. Edits of different issues that
// touch each other wait for the next pass, so one fix never undoes another.
function fixAll(text) {
  for (let pass = 0; pass < 20; pass++) {
    const issues = checkWhitespace(text);
    if (!issues.length) break;
    const chosen = [];
    const taken = [];
    const touches = (e) => taken.some((r) => e.start <= r.end && r.start <= e.end);
    for (const issue of issues) {
      if (issue.edits.some(touches)) continue;
      for (const e of issue.edits) {
        chosen.push(e);
        taken.push(e);
      }
    }
    const next = applyEdits(text, chosen);
    if (next === text) break;
    text = next;
  }
  return text;
}

module.exports = { checkWhitespace, fixAll, lex };
