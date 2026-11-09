// Generates syntaxes/tsc.tmLanguage.json. Run: node build-grammar.js
//
// Follows typed_symbolic_code.tsc (the working-draft spec). Section numbers in
// the comments below point into it.
//
// Delimiters (2.4):
//   ( ... )   a value that is not a function   -> the head is the callee
//   { ... }   a value that is a function
//   [ ... ]   a type, type header, forall list or type argument
//   | ... |   a signature or a field list
// Grammar notation (0.2): <Category T>, X..., X?, and -> T after a form.
const fs = require("fs");
const path = require("path");

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
const alt = (words) => [...words].sort((a, b) => b.length - a.length).map(esc).join("|");

// ---- word lists (keep in sync with the spec) -----------------------------

// 2.2
const KEYWORDS = [
  "do", "fn", "forall", "define", "let", "if", "when", "unless", "struct",
  "enum", "match", "next", "loop", "recur", "for", "mod", "export",
];
// 8.1.2: called like functions, but never values
const SPECIAL_FORMS = ["print", "panic", "assert", "debug"];
// 8.2 - 8.7: built-in functions with names
const BUILTINS = [
  "pow", "abs", "min", "max", "clamp",
  "not", "and", "or", "xor",
  "bit_not", "bit_and", "bit_or", "bit_xor", "shl", "shr",
  "as", "try_as", "wrap", "parse", "to_string",
  "list", "get",
];
// 8.2, 8.3: built-in operators
const OPERATORS = ["==", "<=", ">=", "+", "-", "*", "/", "%", "<", ">"];
// 3.1
const PRIMITIVES = ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "f32", "f64", "bool", "char", "string"];
// 3.2, 3.4 - 3.6
const BUILTIN_TYPES = ["Unit", "Never", "List", "Map", "Option", "Result"];
// 1.3.2
const BOOLEANS = ["true", "false"];
// 2.5: categories used in general forms; anything else after <Category is a type
const CATEGORIES = [
  "Special", "Declaration", "Callee", "Application", "Expression", "Value",
  "Type Argument", "Type Header", "Type", "Annotated", "Parameter", "Fields",
  "Signature", "Definition", "Binding", "Constructor", "Forall", "Pattern",
  "Field Pattern", "Pin", "Guard", "Arm", "Identifier", "Literal", "Path",
  "Suffix", "Name",
];

// ---- token building blocks ------------------------------------------------

const ID = "[A-Za-z_][A-Za-z0-9_]*";
// A whole word: not part of a longer identifier, qualified name or path.
const B = "(?<![A-Za-z0-9_.:])";
const E = "(?![A-Za-z0-9_:]|\\.[A-Za-z0-9_])";
const word = (words) => `${B}(?:${alt(words)})${E}`;
// An operator stands alone: followed by whitespace, a delimiter or line end.
const OP = `(?:${alt(OPERATORS)})(?=[\\s()\\[\\]{}|;]|$)`;
// A possibly qualified name: circle::Shape.Round, Employee.dept, numbers.0
const QNAME = `(?:[a-z_][A-Za-z0-9_]*::)*${ID}(?:\\.(?:${ID}|\\d+))*`;
// A single type token after : or ->, such as u32 or circle::Circle
const TYPE_ATOM = `(?:[a-z_][A-Za-z0-9_]*::)*${ID}`;
// 1.3.1: digits with single _ separators (rule 5); a float is decimal with a
// . or an exponent (rules 3, 4) and takes only a float suffix; an integer is
// decimal or radix (rule 2) and takes any suffix (rules 6, 7).
// A - ends any identifier before it (1.2.6), so x-1 is x and -1.
const DIGITS = (d) => `${d}(?:_?${d})*`;
const DEC = DIGITS("\\d");
const INT_SUFFIX = "_[ui](?:8|16|32|64)";
const FLOAT_SUFFIX = "_f(?:32|64)";
const FLOAT_LIT = `${DEC}(?:\\.${DEC}(?:e[+-]?${DEC})?|e[+-]?${DEC})(?:${FLOAT_SUFFIX})?`;
const INT_LIT =
  `(?:0x${DIGITS("[0-9A-Fa-f]")}|0o${DIGITS("[0-7]")}|0b${DIGITS("[01]")}|${DEC})` +
  `(?:${INT_SUFFIX}|${FLOAT_SUFFIX})?`;
const NUMBER = `(?:(?<![A-Za-z0-9_.])|(?=-))-?(?:${FLOAT_LIT}|${INT_LIT})(?![A-Za-z0-9_.])`;
// 1.3.5: the escapes a string or char literal may hold
const ESCAPE = "\\\\(?:[nrt0\\\\`$\"']|x[0-7][0-9A-Fa-f]|u\\{[0-9A-Fa-f]{1,6}\\})";

// `= {...}`, `= \`...\`` or `: [... -> ...]` after a defined name means the
// name is bound to a function (2.4.2, 3.3.1). Group 4 is the recursive bracket.
const FN_FOLLOWS =
  `(?=\\s*(?:=\\s*[{\`]|:\\s*\\[(?:[^\\[\\]-]|-(?!>)|(\\[(?:[^\\[\\]]|\\g<4>)*\\]))*->))`;

const typeName = (name) => ({ name, patterns: [{ include: "#type-name" }] });

const grammar = {
  $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  name: "Typed Symbolic Code",
  scopeName: "source.tsc",
  patterns: [{ include: "#value" }],
  repository: {
    // ---- comments (0.1, 0.3, 0.4, 1.1) ------------------------------------
    comment: {
      patterns: [
        // ;;;; section, ;;; entry, ;; sub-entry (0.1.1): "N title (todo)"
        ...[[";;;;+", 4], [";;;", 3], [";;", 2]].map(([semis, level]) => ({
          match: `^\\s*(${semis})(?![;:])\\s*(\\d+(?:\\.\\d+)*)?\\s*(.*?)\\s*(\\((?:old )?todo\\))?\\s*$`,
          name: `comment.line.header.level-${level}.tsc`,
          captures: {
            1: { name: "punctuation.definition.comment.tsc" },
            2: { name: "markup.heading.number.tsc constant.numeric.section.tsc" },
            3: { name: "markup.heading.tsc" },
            4: { name: "keyword.other.todo.tsc" },
          },
        })),
        {
          // ;: doc comment (1.1.3); ;;: is an ordinary comment
          begin: "(;)(:)",
          end: "$",
          beginCaptures: {
            1: { name: "punctuation.definition.comment.tsc" },
            2: { name: "punctuation.definition.comment.doc.tsc" },
          },
          name: "comment.line.documentation.tsc",
          patterns: [{ include: "#comment-annotations" }],
        },
        {
          begin: ";+",
          end: "$",
          beginCaptures: { 0: { name: "punctuation.definition.comment.tsc" } },
          name: "comment.line.semicolon.tsc",
          patterns: [
            // numbered rule: "; 3. ..." and sub-items "a. ..."
            { match: "\\G\\s*(\\d+\\.|[a-z]\\.)(?=\\s)", captures: { 1: { name: "markup.list.numbered.tsc constant.numeric.rule.tsc" } } },
            { include: "#comment-annotations" },
          ],
        },
      ],
    },
    "comment-annotations": {
      patterns: [
        // 0.4: reasons
        { match: "\\G\\s*(why\\?:)", captures: { 1: { name: "keyword.other.reason.unconfirmed.tsc" } } },
        { match: "\\G\\s*(why:)", captures: { 1: { name: "keyword.other.reason.tsc" } } },
        { match: "\\G\\s*(hypothetical:)", captures: { 1: { name: "keyword.other.hypothetical.tsc" } } },
        // 0.3.2: outcomes
        { match: "\\berror:", name: "invalid.illegal.outcome.error.tsc" },
        { match: "\\bpanics:", name: "invalid.illegal.outcome.panic.tsc" },
        { match: "\\bwarning:", name: "invalid.deprecated.outcome.warning.tsc" },
        { match: "\\b(?:prints|type):", name: "keyword.other.outcome.tsc" },
        { match: "\\G\\s*(returns)\\b", captures: { 1: { name: "keyword.other.outcome.tsc" } } },
        { match: "(?<=;\\s)returns\\b", name: "keyword.other.outcome.tsc" },
        // 0.3.3: [5.5.3] or [4.1.5, 4.1.3]
        { match: "\\[\\d+(?:\\.\\d+)+(?:,\\s*\\d+(?:\\.\\d+)+)*\\]", name: "constant.other.rule-tag.tsc" },
        // 0.1.4: (2.4.2) or (7.5.4, 8.6)
        { match: "\\(\\d+(?:\\.\\d+)*(?:,\\s*\\d+(?:\\.\\d+)*)*\\)", name: "markup.underline.link.reference.tsc" },
        { match: "\\((?:old )?todo\\)", name: "keyword.other.todo.tsc" },
      ],
    },

    // ---- literals (1.3) ---------------------------------------------------
    literal: {
      patterns: [
        { include: "#string" },
        { include: "#fancy-string" },
        { include: "#char" },
        { match: "\\(\\s*\\)", name: "constant.language.unit.tsc" },
        { match: NUMBER, name: "constant.numeric.tsc" },
        // a malformed number such as 2.5_u8 or 42u8
        { match: "(?:(?<![A-Za-z0-9_.])|(?=-))-?\\d[A-Za-z0-9_.]*", name: "invalid.illegal.numeric.tsc" },
        { match: word(BOOLEANS), name: "constant.language.boolean.tsc" },
      ],
    },
    escape: {
      patterns: [
        { match: ESCAPE, name: "constant.character.escape.tsc" },
        // 1.3.5.5: any other escape is an error
        { match: "\\\\.", name: "invalid.illegal.escape.tsc" },
      ],
    },
    string: {
      begin: '"',
      end: '"',
      beginCaptures: { 0: { name: "punctuation.definition.string.begin.tsc" } },
      endCaptures: { 0: { name: "punctuation.definition.string.end.tsc" } },
      name: "string.quoted.double.tsc",
      patterns: [{ include: "#escape" }],
    },
    "fancy-string": {
      // 1.3.4.2, 5.1.2: a function value; each ${name} is a string parameter
      begin: "`",
      end: "`",
      beginCaptures: { 0: { name: "punctuation.definition.string.begin.tsc" } },
      endCaptures: { 0: { name: "punctuation.definition.string.end.tsc" } },
      name: "string.template.tsc",
      patterns: [
        { include: "#escape" },
        {
          match: `(\\$\\{)\\s*(${ID})\\s*(\\})`,
          name: "meta.template.expression.tsc",
          captures: {
            1: { name: "punctuation.definition.template-expression.begin.tsc" },
            2: { name: "variable.parameter.tsc" },
            3: { name: "punctuation.definition.template-expression.end.tsc" },
          },
        },
      ],
    },
    char: {
      patterns: [
        {
          // 1.3.3: a single character
          match: `(')(?:[^'\\\\]|(${ESCAPE}))(')`,
          name: "string.quoted.single.char.tsc",
          captures: {
            1: { name: "punctuation.definition.string.begin.tsc" },
            2: { name: "constant.character.escape.tsc" },
            3: { name: "punctuation.definition.string.end.tsc" },
          },
        },
        // 1.3.3.2: ' never delimits a string
        { match: "'[^'\\n]*'", name: "invalid.illegal.char.tsc" },
      ],
    },

    // ---- value context -------------------------------------------------
    value: {
      patterns: [
        { include: "#comment" },
        { include: "#literal" },
        { include: "#define" },
        { include: "#type-decl" },
        { include: "#mod" },
        { include: "#fn" },
        { include: "#paren" },
        { include: "#brace" },
        { include: "#forall" },
        { include: "#type-bracket" },
        { include: "#category" },
        { include: "#signature" },
        { include: "#punctuation" },
        { include: "#annotation" },
        { include: "#binding-name" },
        { include: "#name" },
        { match: "[)\\]}]", name: "invalid.illegal.stray-bracket.tsc" },
      ],
    },

    // (define name = ...) and (let name : T = ...) (4.2, 4.3)
    define: {
      patterns: [
        {
          begin: `(\\()\\s*(define|let)\\s+(${ID})${FN_FOLLOWS}`,
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
          begin: `(\\()\\s*(define|let)\\s+(?:([A-Z][A-Z0-9_]*)|(${ID}))${E}`,
          beginCaptures: {
            1: { name: "punctuation.section.parens.begin.tsc" },
            2: { name: "keyword.control.tsc" },
            3: { name: "variable.other.constant.tsc" },
            4: { name: "variable.other.definition.tsc" },
          },
          end: "\\)",
          endCaptures: { 0: { name: "punctuation.section.parens.end.tsc" } },
          name: "meta.definition.variable.tsc",
          patterns: [{ include: "#value" }],
        },
      ],
    },

    // (struct Name |...|), (struct [Pair A B] |...|), (enum Name Variant |...| ...) (4.4, 4.5, 7.2)
    "type-decl": {
      patterns: ["struct", "enum"].map((kw) => ({
        begin: `(\\()\\s*(${kw})${E}\\s*(?:(\\[)\\s*(${ID})((?:\\s+${ID})*)\\s*(\\])|(${ID}))?`,
        beginCaptures: {
          1: { name: "punctuation.section.parens.begin.tsc" },
          2: { name: "keyword.control.tsc" },
          3: { name: "punctuation.definition.type.begin.tsc" },
          4: { name: `entity.name.type.${kw}.tsc` },
          5: { patterns: [{ match: ID, name: "entity.name.type.parameter.tsc" }] },
          6: { name: "punctuation.definition.type.end.tsc" },
          7: { name: `entity.name.type.${kw}.tsc` },
        },
        end: "\\)",
        endCaptures: { 0: { name: "punctuation.section.parens.end.tsc" } },
        name: `meta.definition.${kw}.tsc`,
        patterns:
          kw === "enum"
            ? [
                { include: "#comment" },
                { include: "#signature" },
                { include: "#category" },
                // each bare name outside | | defines a variant
                { match: `${B}[A-Z][A-Za-z0-9_]*${E}`, name: "variable.other.enummember.tsc" },
                { include: "#value" },
              ]
            : [{ include: "#value" }],
      })),
    },

    // (mod a::b::c), (mod b::c = a::b::c) (9.4)
    mod: {
      begin: `(\\()\\s*(mod)${E}`,
      beginCaptures: {
        1: { name: "punctuation.section.parens.begin.tsc" },
        2: { name: "keyword.control.tsc" },
      },
      end: "\\)",
      endCaptures: { 0: { name: "punctuation.section.parens.end.tsc" } },
      name: "meta.import.tsc",
      patterns: [
        { include: "#comment" },
        { include: "#category" },
        { match: "::", name: "punctuation.separator.namespace.tsc" },
        { match: "=", name: "keyword.operator.assignment.tsc" },
        { match: ID, name: "entity.name.namespace.tsc" },
      ],
    },

    // {fn name? [forall T]? |...| body} (5.4, 7.3)
    fn: {
      begin: `(\\{)\\s*(fn)${E}(?:\\s+(${ID})(?=\\s*[\\[|<]))?`,
      beginCaptures: {
        1: { name: "punctuation.section.braces.begin.tsc storage.type.function.brace.begin.tsc" },
        2: { name: "keyword.control.tsc storage.type.function.tsc" },
        3: { name: "entity.name.function.tsc" },
      },
      end: "\\}",
      endCaptures: { 0: { name: "punctuation.section.braces.end.tsc storage.type.function.brace.end.tsc" } },
      name: "meta.function.tsc",
      patterns: [{ include: "#value" }],
    },

    // ( head args... ): a value that is not a function
    paren: {
      begin: `(\\()\\s*(${QNAME}|${OP})?`,
      beginCaptures: {
        1: { name: "punctuation.section.parens.begin.tsc" },
        2: { patterns: [{ include: "#head" }] },
      },
      end: "\\)",
      endCaptures: { 0: { name: "punctuation.section.parens.end.tsc" } },
      name: "meta.expression.value.tsc",
      patterns: [{ include: "#value" }],
    },

    // { head args... }: a value that is a function
    brace: {
      begin: `(\\{)\\s*(${QNAME}|${OP})?`,
      beginCaptures: {
        1: { name: "punctuation.section.braces.begin.tsc storage.type.function.brace.begin.tsc" },
        2: { patterns: [{ include: "#head" }] },
      },
      end: "\\}",
      endCaptures: { 0: { name: "punctuation.section.braces.end.tsc storage.type.function.brace.end.tsc" } },
      name: "meta.expression.function.tsc",
      patterns: [{ include: "#value" }],
    },

    // the name in callee position
    head: {
      patterns: [
        { match: word(KEYWORDS), name: "keyword.control.tsc" },
        { match: word(SPECIAL_FORMS), name: "keyword.other.special-form.tsc" },
        { match: word(BUILTINS), name: "support.function.builtin.tsc" },
        { match: OP, name: "support.function.builtin.operator.tsc" },
        { match: `${B}(?:${alt(BUILTIN_TYPES)})(?=\\.[A-Z])`, name: "support.type.builtin.tsc" },
        { match: "[a-z_][A-Za-z0-9_]*(?=::)", name: "entity.name.namespace.tsc" },
        { match: "::", name: "punctuation.separator.namespace.tsc" },
        { match: "\\.", name: "punctuation.accessor.tsc" },
        // Weapon.Bow: a variant used as a constructor
        { match: "(?<=[A-Za-z0-9_]\\.)[A-Z][A-Za-z0-9_]*", name: "variable.other.enummember.tsc" },
        // Employee.dept: an accessor function
        { match: "(?<=[A-Za-z0-9_]\\.)[a-z_][A-Za-z0-9_]*", name: "entity.name.function.accessor.tsc" },
        // Employee: a struct constructor
        { match: "[A-Z][A-Za-z0-9_]*", name: "entity.name.type.tsc" },
        { match: "[a-z_][A-Za-z0-9_]*", name: "entity.name.function.tsc" },
      ],
    },

    // a binding by name: field = value in constructors, recur and patterns
    "binding-name": {
      match: `${B}(${ID})(?=\\s*=(?![=>]))`,
      captures: { 1: { name: "variable.other.property.binding.tsc" } },
    },

    // : Type (4.2, 4.3)
    annotation: {
      match: `(:)(?!:)\\s*(${TYPE_ATOM})?`,
      captures: {
        1: { name: "punctuation.separator.type.tsc" },
        2: typeName("meta.type.tsc"),
      },
    },

    punctuation: {
      patterns: [
        { match: "->", name: "storage.type.function.arrow.tsc" },
        { match: "=>", name: "keyword.operator.arm.tsc" },
        { match: "\\.\\.\\.", name: "keyword.operator.repetition.notation.tsc" },
        { match: "\\.\\.", name: "keyword.operator.spread.tsc" },
        { match: "::", name: "punctuation.separator.namespace.tsc" },
        {
          // ^name pins a name in a pattern (6.7)
          match: `(\\^)(${QNAME})?`,
          captures: {
            1: { name: "keyword.operator.pin.tsc" },
            2: { name: "variable.other.pinned.tsc", patterns: [{ include: "#name" }] },
          },
        },
        { match: "@", name: "keyword.operator.binding.tsc" },
        { match: "==", name: "support.function.builtin.operator.tsc" },
        { match: "=", name: "keyword.operator.assignment.tsc" },
        { match: `${B}_${E}`, name: "variable.language.wildcard.tsc" },
        { match: OP, name: "support.function.builtin.operator.tsc" },
        // X? in grammar notation (0.2.4)
        { match: "(?<=[>)\\]|}])\\?", name: "keyword.operator.optional.notation.tsc" },
      ],
    },

    // identifiers and qualified names, anywhere
    name: {
      patterns: [
        { match: word(KEYWORDS), name: "keyword.control.tsc" },
        { match: word(SPECIAL_FORMS), name: "keyword.other.special-form.tsc" },
        { match: word(BUILTINS), name: "support.function.builtin.tsc" },
        { match: word(PRIMITIVES), name: "support.type.primitive.tsc" },
        { match: word(BUILTIN_TYPES), name: "support.type.builtin.tsc" },
        { match: word(BOOLEANS), name: "constant.language.boolean.tsc" },
        { match: `${B}(?:${alt(BUILTIN_TYPES)})(?=\\.[A-Z])`, name: "support.type.builtin.tsc" },
        { match: "[a-z_][A-Za-z0-9_]*(?=::)", name: "entity.name.namespace.tsc" },
        { match: "::", name: "punctuation.separator.namespace.tsc" },
        { match: "(?<=[A-Za-z0-9_])\\.(?=[A-Za-z0-9_])", name: "punctuation.accessor.tsc" },
        { match: "(?<=[A-Za-z0-9_]\\.)\\d+", name: "constant.numeric.index.tsc" },
        { match: "(?<=[A-Za-z0-9_]\\.)[A-Z][A-Za-z0-9_]*", name: "variable.other.enummember.tsc" },
        { match: "(?<=[A-Za-z0-9_]\\.)[a-z_][A-Za-z0-9_]*", name: "variable.other.property.tsc" },
        { match: `${B}[A-Z]${E}`, name: "entity.name.type.parameter.tsc" },
        { match: `${B}[A-Z][A-Z0-9_]+${E}`, name: "variable.other.constant.tsc" },
        { match: "[A-Z][A-Za-z0-9_]*", name: "entity.name.type.tsc" },
        { match: "[a-z_][A-Za-z0-9_]*", name: "variable.other.tsc" },
        { match: "\\.", name: "punctuation.accessor.tsc" },
      ],
    },

    // ---- type context --------------------------------------------------
    // [forall T U] (7.3)
    forall: {
      begin: `(\\[)\\s*(forall)${E}`,
      beginCaptures: {
        1: { name: "punctuation.definition.type.begin.tsc" },
        2: { name: "keyword.control.tsc" },
      },
      end: "\\]",
      endCaptures: { 0: { name: "punctuation.definition.type.end.tsc" } },
      name: "meta.type.forall.tsc",
      patterns: [
        { include: "#comment" },
        { include: "#category" },
        { match: ID, name: "entity.name.type.parameter.tsc" },
        { match: "\\.\\.\\.", name: "keyword.operator.repetition.notation.tsc" },
      ],
    },
    "type-bracket": {
      begin: "\\[",
      end: "\\]",
      beginCaptures: { 0: { name: "punctuation.definition.type.begin.tsc" } },
      endCaptures: { 0: { name: "punctuation.definition.type.end.tsc" } },
      name: "meta.type.tsc",
      patterns: [{ include: "#type" }],
    },
    type: {
      patterns: [
        { include: "#comment" },
        { include: "#forall" },
        { include: "#type-bracket" },
        { include: "#category" },
        { match: "->", name: "storage.type.function.arrow.tsc" },
        { match: "\\.\\.\\.", name: "keyword.operator.repetition.notation.tsc" },
        { match: "(?<=[>)\\]|}])\\?", name: "keyword.operator.optional.notation.tsc" },
        { include: "#literal" },
        { include: "#type-name" },
      ],
    },
    "type-name": {
      patterns: [
        { match: word(PRIMITIVES), name: "support.type.primitive.tsc" },
        { match: word(BUILTIN_TYPES), name: "support.type.builtin.tsc" },
        { match: word(KEYWORDS), name: "keyword.control.tsc" },
        { match: "[a-z_][A-Za-z0-9_]*(?=::)", name: "entity.name.namespace.tsc" },
        { match: "::", name: "punctuation.separator.namespace.tsc" },
        { match: `${B}[A-Z]${E}`, name: "entity.name.type.parameter.tsc" },
        { match: ID, name: "entity.name.type.tsc" },
      ],
    },

    // <Category T> in general forms (0.2.1, 2.5)
    category: {
      begin: `(<)(${alt(CATEGORIES)})(?![A-Za-z])`,
      beginCaptures: {
        1: { name: "punctuation.definition.tag.begin.tsc" },
        2: { name: "entity.name.tag.category.tsc" },
      },
      end: ">",
      endCaptures: { 0: { name: "punctuation.definition.tag.end.tsc" } },
      name: "meta.category.tsc",
      patterns: [{ include: "#type" }],
    },

    // | name : Type = default ... -> Type | (2.5.2)
    signature: {
      begin: "\\|",
      end: "\\|",
      beginCaptures: { 0: { name: "punctuation.definition.parameters.begin.tsc" } },
      endCaptures: { 0: { name: "punctuation.definition.parameters.end.tsc" } },
      name: "meta.parameters.tsc",
      patterns: [
        { include: "#comment" },
        {
          match: `(${ID})\\s*(:)(?!:)\\s*(${TYPE_ATOM})?`,
          captures: {
            1: { name: "variable.parameter.tsc" },
            2: { name: "punctuation.separator.type.tsc" },
            3: typeName("meta.type.tsc"),
          },
        },
        {
          // the output type
          match: `(->)\\s*(${TYPE_ATOM})?`,
          captures: {
            1: { name: "storage.type.function.arrow.tsc" },
            2: typeName("meta.type.tsc"),
          },
        },
        { include: "#value" },
      ],
    },
  },
};

const out = path.join(__dirname, "syntaxes", "tsc.tmLanguage.json");
fs.writeFileSync(out, JSON.stringify(grammar, null, 2) + "\n");
console.log("wrote", out);
