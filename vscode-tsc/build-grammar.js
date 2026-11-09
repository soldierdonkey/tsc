// Generates syntaxes/tsc.tmLanguage.json. Run: node build-grammar.js
//
// Syntax classes (from typed_symbolic_code.tsc):
//   ( ... )   non-function value     -> head is the function being applied
//   { ... }   function value
//   [ ... ]   type                   -> everything inside is a type
//   | ... |   function arguments     -> `name : Type ... -> Type`
//   < ... >   token stream (documentation), e.g. <Expression T>
//   ->        functional "to"
const fs = require("fs");
const path = require("path");

// Characters that end a symbol.
const DELIM = "\\s()\\[\\]{}|'\"`;:";
const SYM = `[^${DELIM}]+`;
const START = `(?<![^${DELIM}])`; // preceded by a delimiter or line start
const END = `(?![^${DELIM}])`; // followed by a delimiter or line end
const word = (alts) => `${START}(?:${alts.join("|")})${END}`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

const KEYWORDS = ["fn", "define", "let", "do", "if", "map"];
const BUILTINS = [
  "+", "-", "*", "/", "=", "<", ">", "<=", ">=", "exp",
  "not", "or", "and", "xor", "bit-not", "bit-or", "bit-and", "bit-xor",
  "as", "try-as", "wrap", "parse", "to-string", "panic", "assert",
].sort((a, b) => b.length - a.length).map(esc);
const PRIMITIVES = ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "f32", "f64", "bool", "string"];
const CONSTANTS = ["true", "false", "Unit", "Never", "None"];

// A `<` opens a token stream only when it is immediately followed by a symbol
// or `>`, so the builtins `(< a b)`, `(<= a b)` are left alone.
const STREAM_OPEN = `<(?=[^\\s=<${DELIM.slice(2)}])`;

// `: Type` whose outermost [] contains a top-level -> is a function type.
const FN_ANNOTATION = ":\\s*\\[(?:[^\\[\\]-]|-(?!>)|(\\[(?:[^\\[\\]]|\\g<4>)*\\]))*->";

const grammar = {
  $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  name: "Typed Symbolic Code",
  scopeName: "source.tsc",
  patterns: [{ include: "#value" }],
  repository: {
    comment: {
      patterns: [
        {
          // ;;; and higher: top-level section header
          match: "^\\s*(;{3,})(.*)$",
          name: "comment.line.header.level-3.tsc",
          captures: { 1: { name: "punctuation.definition.comment.tsc" } },
        },
        {
          // ;; sub-section header
          match: "^\\s*(;;)(.*)$",
          name: "comment.line.header.level-2.tsc",
          captures: { 1: { name: "punctuation.definition.comment.tsc" } },
        },
        {
          match: "(;+).*$",
          name: "comment.line.semicolon.tsc",
          captures: { 1: { name: "punctuation.definition.comment.tsc" } },
        },
      ],
    },

    string: {
      patterns: [
        {
          begin: "'", end: "'", name: "string.quoted.single.tsc",
          patterns: [{ include: "#escape" }],
        },
        {
          begin: '"', end: '"', name: "string.quoted.double.tsc",
          patterns: [{ include: "#escape" }],
        },
        {
          // fancy string: secretly a function value
          begin: "`", end: "`", name: "string.template.tsc",
          patterns: [
            { include: "#escape" },
            {
              begin: "\\$\\{", end: "\\}",
              beginCaptures: { 0: { name: "punctuation.definition.template-expression.begin.tsc" } },
              endCaptures: { 0: { name: "punctuation.definition.template-expression.end.tsc" } },
              name: "meta.template.expression.tsc",
              contentName: "meta.embedded.line.tsc",
              patterns: [{ include: "#value" }],
            },
          ],
        },
      ],
    },
    escape: { match: "\\\\.", name: "constant.character.escape.tsc" },

    arrow: { match: "->", name: "storage.type.function.arrow.tsc" },

    // ---- value context -------------------------------------------------
    value: {
      patterns: [
        { include: "#comment" },
        { include: "#string" },
        { include: "#define" },
        { include: "#paren" },
        { include: "#brace" },
        { include: "#type-bracket" },
        { include: "#token-stream" },
        { include: "#params" },
        { include: "#arrow" },
        { include: "#atom" },
        { match: "[)\\]}]", name: "invalid.illegal.stray-bracket.tsc" },
      ],
    },

    // (define name {fn ...}) or (define name : [A -> B] ...) names a function value,
    // anything else a plain value
    define: {
      patterns: [
        {
          begin: `(\\()\\s*(define|let)\\s+(${SYM})(?=\\s*(?:\\{|${FN_ANNOTATION}))`,
          beginCaptures: {
            1: { name: "punctuation.section.parens.begin.tsc" },
            2: { name: "keyword.control.tsc" },
            3: { name: "entity.name.function.tsc" },
          },
          end: "\\)",
          endCaptures: { 0: { name: "punctuation.section.parens.end.tsc" } },
          name: "meta.definition.function.tsc",
          patterns: [{ include: "#value" }],
        },
        {
          begin: `(\\()\\s*(define|let)\\s+(${SYM})`,
          beginCaptures: {
            1: { name: "punctuation.section.parens.begin.tsc" },
            2: { name: "keyword.control.tsc" },
            3: { name: "variable.other.constant.tsc" },
          },
          end: "\\)",
          endCaptures: { 0: { name: "punctuation.section.parens.end.tsc" } },
          name: "meta.definition.variable.tsc",
          patterns: [{ include: "#value" }],
        },
      ],
    },

    // ( head args... ) : evaluates to a non-function value
    paren: {
      begin: `(\\()\\s*(?!-?\\d)(${SYM})?`,
      beginCaptures: {
        1: { name: "punctuation.section.parens.begin.tsc" },
        2: { patterns: [{ include: "#head" }] },
      },
      end: "\\)",
      endCaptures: { 0: { name: "punctuation.section.parens.end.tsc" } },
      name: "meta.expression.value.tsc",
      patterns: [{ include: "#value" }],
    },

    // { head args... } : evaluates to a function value
    brace: {
      begin: `(\\{)\\s*(?!-?\\d)(${SYM})?`,
      beginCaptures: {
        1: { name: "storage.type.function.brace.begin.tsc" },
        2: { patterns: [{ include: "#head" }] },
      },
      end: "\\}",
      endCaptures: { 0: { name: "storage.type.function.brace.end.tsc" } },
      name: "meta.expression.function.tsc",
      patterns: [{ include: "#value" }],
    },

    // the symbol in operator position is a function value
    head: {
      patterns: [
        { match: word(KEYWORDS), name: "keyword.control.tsc" },
        { match: word(BUILTINS), name: "support.function.builtin.tsc" },
        { match: word(PRIMITIVES), name: "support.type.primitive.tsc" },
        { match: `${START}[A-Z]${SYM}`, name: "entity.name.type.tsc" },
        { match: SYM, name: "entity.name.function.tsc" },
      ],
    },

    atom: {
      patterns: [
        { match: `${START}-?\\d+(?:\\.\\d+)?(?:[ui](?:8|16|32|64)|f(?:32|64))?${END}`, name: "constant.numeric.tsc" },
        { match: word(KEYWORDS), name: "keyword.control.tsc" },
        { match: word(CONSTANTS), name: "constant.language.tsc" },
        { match: word(BUILTINS), name: "support.function.builtin.tsc" },
        { match: word(PRIMITIVES), name: "support.type.primitive.tsc" },
        { match: `${START}[A-Z]${SYM}`, name: "entity.name.type.tsc" },
        {
          // type annotation, e.g. (define PI : f64 3.14)
          match: `(:)\\s*(${SYM})?`,
          captures: {
            1: { name: "punctuation.separator.type.tsc" },
            2: { patterns: [{ include: "#type" }] },
          },
        },
        { match: SYM, name: "variable.other.tsc" },
      ],
    },

    // ---- type context --------------------------------------------------
    "type-bracket": {
      begin: "\\[",
      end: "\\]",
      beginCaptures: { 0: { name: "support.type.bracket.begin.tsc" } },
      endCaptures: { 0: { name: "support.type.bracket.end.tsc" } },
      name: "meta.type.tsc",
      patterns: [{ include: "#type" }],
    },
    type: {
      patterns: [
        { include: "#comment" },
        { include: "#type-bracket" },
        { include: "#token-stream" },
        { include: "#arrow" },
        { match: "\\*", name: "keyword.operator.variadic.tsc" },
        { match: word(PRIMITIVES), name: "support.type.primitive.tsc" },
        { match: `[^${DELIM}*<>]+`, name: "entity.name.type.tsc" },
      ],
    },

    // <Category T ...> : token stream, used for documentation
    "token-stream": {
      begin: STREAM_OPEN,
      end: ">",
      beginCaptures: { 0: { name: "entity.name.tag.stream.begin.tsc" } },
      endCaptures: { 0: { name: "entity.name.tag.stream.end.tsc" } },
      name: "meta.token-stream.tsc",
      patterns: [{ include: "#type" }],
    },

    // | name : Type ... -> Type |
    params: {
      begin: "\\|",
      end: "\\|",
      beginCaptures: { 0: { name: "keyword.operator.parameters.begin.tsc" } },
      endCaptures: { 0: { name: "keyword.operator.parameters.end.tsc" } },
      name: "meta.parameters.tsc",
      patterns: [
        { include: "#comment" },
        { include: "#arrow" },
        { match: `(${SYM})\\s*(?=:)`, captures: { 1: { name: "variable.parameter.tsc" } } },
        { match: ":", name: "punctuation.separator.type.tsc" },
        { include: "#type" },
      ],
    },
  },
};

const out = path.join(__dirname, "syntaxes", "tsc.tmLanguage.json");
fs.writeFileSync(out, JSON.stringify(grammar, null, 2) + "\n");
console.log("wrote", out);
