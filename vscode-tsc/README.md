# Typed Symbolic Code (.tsc)

Syntax highlighting and folding for the draft TSC language, following `typed_symbolic_code.tsc`.

- Edit `build-grammar.js` (keywords, special forms, built-ins, primitive and built-in types, and grammar categories are lists at the top), then run `node build-grammar.js` and reload the VS Code window.
- `;;;;` (section), `;;;` (entry) and `;;` (sub-entry) header comments fold. A header with N semicolons runs until the next header with N or more, so sections contain their entries. `;;:` is an ordinary comment, not a header. Multi-line `()`, `[]` and `{}` forms also fold.

What gets its own scope:

- code: keywords, special forms (`print`, `panic`, `assert`, `debug`), built-ins and operators, types and type parameters, `[forall ...]`, signatures and field lists, struct/enum names and variants, module paths, `=`, `=>`, `->`, `@`, `^` pins, `..`, `_`, field bindings (`name = value`), char/string/fancy-string literals and number suffixes
- grammar notation: `<Category T>`, `X...`, `X?`
- comments: header numbers and titles, `;:` doc comments, numbered rules, `[5.5.3]` rule tags, `(2.4.2)` references, `(todo)`, `why:` / `why?:`, `hypothetical:`, and the outcomes `returns`, `type:`, `prints:`, `warning:`, `error:`, `panics:`

Optional: to style headers and annotations, add this to your user `settings.json`:

```json
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": "comment.line.header.level-4.tsc", "settings": { "fontStyle": "bold underline" } },
    { "scope": "comment.line.header.level-3.tsc", "settings": { "fontStyle": "bold" } },
    { "scope": "comment.line.header.level-2.tsc", "settings": { "fontStyle": "italic" } },
    { "scope": "keyword.other.reason.unconfirmed.tsc", "settings": { "fontStyle": "italic" } },
    { "scope": "constant.other.rule-tag.tsc", "settings": { "foreground": "#808080" } }
  ]
}
```
