const vscode = require("vscode");

// A line starting with two or more semicolons is a section header.
// A header with N semicolons runs until the next header with N or more
// semicolons, so ;; ends at the next ;; or ;;;, and ;;; contains its ;; sections.
const HEADER = /^\s*(;{2,})/;

function headerRanges(doc) {
  const ranges = [];
  const open = []; // { line, level }, levels strictly decreasing
  let lastContent = -1;

  const close = (header, endLine) => {
    if (endLine > header.line) {
      ranges.push(new vscode.FoldingRange(header.line, endLine, vscode.FoldingRangeKind.Region));
    }
  };

  for (let i = 0; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text;
    const m = HEADER.exec(text);
    if (m) {
      const level = m[1].length;
      while (open.length && open[open.length - 1].level <= level) close(open.pop(), lastContent);
      open.push({ line: i, level });
    }
    if (text.trim() !== "") lastContent = i;
  }
  while (open.length) close(open.pop(), lastContent);
  return ranges;
}

// Multi-line (), [], {} forms, skipping strings and comments.
function bracketRanges(doc) {
  const ends = new Map(); // start line -> end line, outermost form wins
  const stack = [];
  const CLOSE = { ")": "(", "]": "[", "}": "{" };
  let quote = null; // ' " or ` while inside a string

  for (let i = 0; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text;
    for (let j = 0; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === ";") break;
      if (c === "'" || c === '"' || c === "`") quote = c;
      else if (c === "(" || c === "[" || c === "{") stack.push({ c, line: i });
      else if (CLOSE[c]) {
        while (stack.length && stack[stack.length - 1].c !== CLOSE[c]) stack.pop();
        const start = stack.pop();
        if (start && i > start.line) ends.set(start.line, i);
      }
    }
  }
  return [...ends].map(([start, end]) => new vscode.FoldingRange(start, end));
}

function activate(context) {
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider("tsc", {
      provideFoldingRanges(doc) {
        return [...headerRanges(doc), ...bracketRanges(doc)];
      },
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
