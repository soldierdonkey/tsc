# Typed Symbolic Code (.tsc)

Syntax highlighting and folding for the draft TSC language.

- Edit `build-grammar.js` (keywords, builtins, primitive types are lists at the top), then run `node build-grammar.js` and reload the VS Code window.
- `;;` and `;;;` (or more) header comments fold. A header with N semicolons runs until the next header with N or more, so `;;;` sections contain their `;;` sections. Multi-line `()`, `[]` and `{}` forms also fold.

Optional: to make section headers stand out, add this to your user `settings.json`:

```json
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": "comment.line.header.level-3.tsc", "settings": { "fontStyle": "bold underline" } },
    { "scope": "comment.line.header.level-2.tsc", "settings": { "fontStyle": "bold" } }
  ]
}
```
