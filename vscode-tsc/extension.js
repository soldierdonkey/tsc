const vscode = require("vscode");
const { checkWhitespace, fixAll } = require("./whitespace");

// A line starting with two or more semicolons is a header (spec 0.1.1), except
// ;;: which is an ordinary comment (spec 1.1.3).
// A header with N semicolons runs until the next header with N or more
// semicolons, so ;; ends at the next ;; or ;;;, and ;;; contains its ;; sections.
const HEADER = /^\s*(;{2,})(?!:)/;

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

// ---- whitespace (spec 1.2 and 1.5) -----------------------------------------

const SOURCE = "tsc whitespace";
const FIX_ALL = vscode.CodeActionKind.SourceFixAll.append("tsc");

const toRange = (doc, start, end) => new vscode.Range(doc.positionAt(start), doc.positionAt(end));
const wholeDocument = (doc) => toRange(doc, 0, doc.getText().length);
const whitespaceEnabled = (doc) => vscode.workspace.getConfiguration("tsc", doc).get("whitespace.enable", true);

function updateDiagnostics(collection, doc) {
  if (doc.languageId !== "tsc") return;
  if (!whitespaceEnabled(doc)) {
    collection.delete(doc.uri);
    return;
  }
  const diagnostics = checkWhitespace(doc.getText()).map((issue) => {
    const d = new vscode.Diagnostic(
      toRange(doc, issue.start, issue.end),
      issue.message,
      issue.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
    );
    d.source = SOURCE;
    return d;
  });
  collection.set(doc.uri, diagnostics);
}

function fixAllEdit(doc) {
  const text = doc.getText();
  const fixed = fixAll(text);
  if (fixed === text) return null;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, wholeDocument(doc), fixed);
  return edit;
}

// A quick fix for each whitespace diagnostic under the cursor, plus one that
// fixes the whole file. The fix-all action is also offered as
// source.fixAll.tsc, so "editor.codeActionsOnSave" can run it.
const codeActions = {
  provideCodeActions(doc, range, context) {
    if (!whitespaceEnabled(doc)) return [];
    const actions = [];
    const wantsFixAll = context.only && FIX_ALL.intersects(context.only);
    if (wantsFixAll) {
      const edit = fixAllEdit(doc);
      if (edit) {
        const action = new vscode.CodeAction("Fix all whitespace", FIX_ALL);
        action.edit = edit;
        actions.push(action);
      }
      return actions;
    }

    const mine = context.diagnostics.filter((d) => d.source === SOURCE);
    if (!mine.length) return actions;
    const issues = checkWhitespace(doc.getText());
    for (const d of mine) {
      const issue = issues.find((i) => i.message === d.message && toRange(doc, i.start, i.end).isEqual(d.range));
      if (!issue) continue;
      const edit = new vscode.WorkspaceEdit();
      for (const e of issue.edits) edit.replace(doc.uri, toRange(doc, e.start, e.end), e.text);
      const title = issue.message.replace(/ \([\d., ]+\)$/, "");
      const action = new vscode.CodeAction(title[0].toUpperCase() + title.slice(1), vscode.CodeActionKind.QuickFix);
      action.edit = edit;
      action.diagnostics = [d];
      action.isPreferred = true;
      actions.push(action);
    }
    if (issues.length > 1) {
      const edit = fixAllEdit(doc);
      if (edit) {
        const action = new vscode.CodeAction("Fix all whitespace in this file", vscode.CodeActionKind.QuickFix);
        action.edit = edit;
        action.diagnostics = mine;
        actions.push(action);
      }
    }
    return actions;
  },
};

function activate(context) {
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider("tsc", {
      provideFoldingRanges(doc) {
        return [...headerRanges(doc), ...bracketRanges(doc)];
      },
    })
  );

  const collection = vscode.languages.createDiagnosticCollection("tsc");
  const pending = new Map(); // uri -> timer, so typing is not re-checked on every key
  const schedule = (doc) => {
    const key = doc.uri.toString();
    clearTimeout(pending.get(key));
    pending.set(key, setTimeout(() => {
      pending.delete(key);
      updateDiagnostics(collection, doc);
    }, 250));
  };

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument((doc) => updateDiagnostics(collection, doc)),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tsc.whitespace")) vscode.workspace.textDocuments.forEach((doc) => updateDiagnostics(collection, doc));
    }),
    vscode.languages.registerCodeActionsProvider("tsc", codeActions, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, FIX_ALL],
    }),
    vscode.commands.registerCommand("tsc.fixAllWhitespace", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "tsc") {
        vscode.window.showWarningMessage("Open a .tsc file to fix its whitespace.");
        return;
      }
      const edit = fixAllEdit(editor.document);
      if (!edit) {
        vscode.window.setStatusBarMessage("tsc: no whitespace to fix", 3000);
        return;
      }
      await vscode.workspace.applyEdit(edit);
    }),
    vscode.languages.registerDocumentFormattingEditProvider("tsc", {
      provideDocumentFormattingEdits(doc) {
        const text = doc.getText();
        const fixed = fixAll(text);
        return fixed === text ? [] : [vscode.TextEdit.replace(wholeDocument(doc), fixed)];
      },
    })
  );
  vscode.workspace.textDocuments.forEach((doc) => updateDiagnostics(collection, doc));
}

function deactivate() {}

module.exports = { activate, deactivate };
