// Run: node test/whitespace.test.js
"use strict";
const assert = require("assert");
const { checkWhitespace, fixAll } = require("../whitespace");

// [description, input, expected after fixAll]
const FIXES = [
  ["no space inside brackets", "(+ x y )", "(+ x y)"],
  ["no space after an opener", "( + x y)", "(+ x y)"],
  ["separator inside brackets, word after", "{fn |->Unit| ()}", "{fn |-> Unit| ()}"],
  ["one space around :", "(let xs:[List i32] = (list 1 2))", "(let xs : [List i32] = (list 1 2))"],
  ["= next to a literal", "(let x=-1)", "(let x = -1)"],
  ["no space around .", "(print jane . dept)", "(print jane.dept)"],
  ["no space after ^", "(match x ^ y => 1 _ => 2)", "(match x ^y => 1 _ => 2)"],
  ["no space around ::", "circle :: Shape", "circle::Shape"],
  ["prefix .. hugs its name", '(Employee .. jane name = "b")', '(Employee ..jane name = "b")'],
  ["pattern .. is spaced", "(match xs (list 1..3) => 1 _ => 0)", "(match xs (list 1 .. 3) => 1 _ => 0)"],
  ["pattern .. before a name in a list", "(match xs (list a ..b) => b _ => 0)", "(match xs (list a .. b) => b _ => 0)"],
  ["two spaces before a trailing comment", "(f x) ; c", "(f x)  ; c"],
  ["a closer never starts a line", '(do\n    (print "a")\n)', '(do\n    (print "a"))'],
  ["a closer moves before a comment", '(do\n    (print "a")  ; hi\n)', '(do\n    (print "a"))  ; hi'],
  ["indent 4 per level", '(do\n  (print "a")\n        (print "b"))', '(do\n    (print "a")\n    (print "b"))'],
  ["tabs become spaces", '(do\n\t(print "a"))', '(do\n    (print "a"))'],
  [
    "align => in a multi-line match",
    "(match n\n    0 => \"zero\"\n    k if (> k 9) => \"big\"\n    _ => \"small\")",
    "(match n\n    0            => \"zero\"\n    k if (> k 9) => \"big\"\n    _            => \"small\")",
  ],
  [
    "a long arm breaks after => and indents 4",
    "(match n\n    0 =>\n      \"zero\"\n    _ => \"other\")",
    "(match n\n    0 =>\n        \"zero\"\n    _ => \"other\")",
  ],
  [
    "align the opening | of variants",
    "(enum Shape\n    Square |side : i32|\n    Rect |w : i32 h : i32|\n    Dot)",
    "(enum Shape\n    Square |side : i32|\n    Rect   |w : i32 h : i32|\n    Dot)",
  ],
  [
    "padded struct fields line up their :",
    "(struct Sword |\n    damage  : f64\n    name    : string\n    legendary : bool|)",
    "(struct Sword |\n    damage    : f64\n    name      : string\n    legendary : bool|)",
  ],
  [
    "line up consecutive trailing comments",
    "(do\n    (f x)  ; one\n    (g x y)    ; two\n    (h))  ; three",
    "(do\n    (f x)    ; one\n    (g x y)  ; two\n    (h))     ; three",
  ],
  // doc examples (4.6.7) are checked as code
  ["spacing in a doc example", ";: example:\n;:   (f  x )  ; returns 1", ";: example:\n;:   (f x)  ; returns 1"],
  ["no space around . in a doc example", ";: example:\n;:   (print jane . dept)", ";: example:\n;:   (print jane.dept)"],
  ["a doc example starts at its own column", ";: example:\n;:    (f x)", ";: example:\n;:   (f x)"],
  [
    "indentation in a multi-line doc example",
    ";: example:\n;:   (do\n;:     (f x)\n;:           (g x))",
    ";: example:\n;:   (do\n;:       (f x)\n;:       (g x))",
  ],
  [
    "a closer in a doc example moves up",
    ";: example:\n;:   (do\n;:       (f x)\n;:   )",
    ";: example:\n;:   (do\n;:       (f x))",
  ],
  [
    "trailing comments in a doc example line up",
    ";: example:\n;:   (f x)  ; one\n;:   (g x y)  ; two",
    ";: example:\n;:   (f x)    ; one\n;:   (g x y)  ; two",
  ],
  [
    "an indented doc's example",
    "(struct P |\n    x : i32|)\n    ;: example:\n    ;:   (P x=1)",
    "(struct P |\n    x : i32|)\n    ;: example:\n    ;:   (P x = 1)",
  ],
];

// Inputs that are already in layout.
const CLEAN = [
  "(+ x y)",
  "(let add = +)",
  '(print "a  ( b ]")',
  "(list 1 .. 3)",
  "(print grid.0.1)",
  "(print 2.5e-3 1e+3 0x1E10 -5_i8)",
  "{fn |x : u32  y : u32 -> u32| x}",
  "(match s (Shape.Square side = s ..) => s _ => 0)",
  "(mod geometry::shapes::circle)",
  "(struct Point |\n    x : i32\n    longer_name : i32|)",
  "(struct Point |\n    x           : i32\n    longer_name : i32|)",
  "(define main = {fn |-> Unit| (do\n    (print \"a\")\n    (print \"b\"))})",
  "(let s : [-> string] = `hi ${name}`)",
  "'日'  ; one\n'é'   ; two",
  // spec examples that state their warning or error are left alone
  "jane . dept  ; error: no whitespace around .  [1.2.10]",
  "(do\n    (print \"a\")\n)  ; warning: a closer never starts a line  [1.5.6]",
  // doc text that is not an example is not code
  ";: Adds x  to y.\n;: param x: the ( first\n;: example:\n;:   (add 1 2)  ; returns 3\n;: example:\n;:   (add 2 \"7\")  ; error: not a number",
  // grammar notation is not code
  "<Arm T U>  ; <Pattern T> <Guard>? => <Value U>",
  // a worked breakdown (spec 2.6)
  "(define PI : f64 = 3.14)  ; whole\n define                   ; Keyword\n        PI : f64          ; annotated",
];

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${e.message}\n`);
  }
};

for (const [name, input, want] of FIXES) {
  check(name, () => {
    assert.notStrictEqual(checkWhitespace(input).length, 0, "expected an issue");
    assert.strictEqual(fixAll(input), want);
    assert.deepStrictEqual(checkWhitespace(want).map((i) => i.message), [], "fixed text still has issues");
  });
}
for (const input of CLEAN) {
  check(`clean: ${JSON.stringify(input)}`, () => {
    assert.deepStrictEqual(checkWhitespace(input).map((i) => i.message), []);
  });
}
check("whitespace around . and after ^ are errors", () => {
  assert.deepStrictEqual(checkWhitespace("(print jane . dept ^ x)").map((i) => i.severity), ["error", "error", "error"]);
});

console.log(failed ? `${failed} failed` : `all ${FIXES.length + CLEAN.length + 1} passed`);
process.exit(failed ? 1 : 0);
