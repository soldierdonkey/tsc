# Stringification for tests, asserts and debug

How to drop two promises in the spec: 8.3.2 promises `==` on every type
except functions, and 8.6.6 promises `to_string` on every type. Both exist
only so that tests, asserts and `debug` work on any value. These notes
record how tests, asserts and `debug` keep working without them.

A plain number, such as 4.6.9.7, is a section of the spec,
`typed_symbolic_code.tsc`. A number with §, such as §2, is a section of
these notes. `[x]` is decided and `[ ]` is open. Syntax is hypothetical.

Contents:

- §1 The model, as decided
- §2 Decisions and their reasoning
- §3 What changes in the spec
- §4 Open questions, most consequential first
- §5 Constraints on the canonical form

---

## 1. The model, as decided

Two traits turn a value into text, each for its own job:

| Trait      | Job                | Used by                                              |
|------------|--------------------|------------------------------------------------------|
| `ToString` | display text       | only an explicit `to_string` call (for example, to `print`) |
| `Literal`  | canonical text     | `returns:`, `assert_eq`, failure reports, and (pending §4.2) `debug` |

`Literal` is a working name (§4.11).

**Magic stringification** ("magic" in these notes) is compiler-built
canonical text. It is the fallback when a type has no `Literal` impl:

- In a normal build, each place that uses magic **warns** (lint
  `magic_string`).
- In a release build, each use is an **error**, whatever the lint level.
- Under `tsc test`, and in doc examples in every build, it neither warns
  nor errors.

For tests, **equality is text equality**: two values are equal when their
canonical texts (`Literal`, else magic) match. It is not an `Eq` impl.

`ToString` is never consulted by any of this. Implementing only `ToString`
does nothing for tests.

---

## 2. Decisions and their reasoning

### 2.1 Test equality compares canonical text, not `Eq`

- [x] `returns:` and `assert_eq` compare canonical text.
  - Why: `returns: X` gives the expected value as text (4.6.9.7), so a
    byte-level or trait-level comparison has nothing to compare against.
    The expected side is a string, so the actual side becomes one too.

### 2.2 Two traits: `ToString` for display, `Literal` for canonical text (was 1C)

- [x] Comparison and canonical text use `Literal`, then magic. Display uses
      `ToString`.
  - Why: display and canonical text are different jobs (Rust's `Display`
    and `Debug`, Python's `__str__` and `__repr__`). A display impl can say
    anything: a `ToString` that prints `"Circle"` for every circle would
    make every circle compare equal, `returns:` text would have to be
    written in each type's display format, which may not lex as tsc, and
    changing a display format would break every doc example.
  - Why not magic alone for comparison: a type must be able to override its
    canonical form, for example a set that prints its items sorted (§4.3).
  - Cost accepted: one more prelude trait, and a hand-written `Literal` can
    be wrong (§4.3).

### 2.3 `assert_eq` is a reserved special form (was 2A)

- [x] `(assert_eq a b)` and `(assert_eq a b "message")` compare by
      `Literal`, then magic. `assert` is unchanged and takes any `bool`.
      `assert_eq` is reserved in the spec (2.2.2, 4.1.9, 8.1.2, 8.9.6);
      calling it is an error until it is designed.
  - Why: `(== a b)` keeps one meaning everywhere, the failure message can
    show both sides as text, and `assert` is already a special form (8.9).
  - Rejected: making `assert` treat a literal `(== a b)` specially breaks
    substitution (`(let ok = (== a b)) (assert ok)` would differ) and only
    catches the literal form. A general text-equality operator such as
    `(same a b)` would leak a slow structural equality into production
    code, and two equalities invite confusion. Text equality only in
    `returns:` would leave asserts on types without `PartialEq` unwritable.

### 2.4 Generic bodies: an unbounded `T` uses magic (was 3B)

- [x] Inside a generic body, `T` uses a trait impl only when the body's
      bounds include that trait. `[T with [Literal T]]` uses `Literal`. An
      unbounded `T` uses magic, warned once, at the body.
  - Why: a monomorphized `T` is still a type that has only its bounds;
    nothing else is known about it in the body. Magic for an unbounded `T`
    whose instantiation has an impl is not an inconsistency, because the
    body never knew about that impl. Generic bodies stay checked once
    (7.5.4), and the fix the warning suggests (add the bound) teaches the
    right habit.
  - An unbounded generic `debug` erroring in a release build is correct.
  - Rejected: choosing per instantiation makes a library's warnings depend
    on its callers and is specialization on whether an impl exists, which
    the overlap rules (7.5.6.3) avoid. Requiring a bound with no fallback
    makes debugging generic code mean editing its bounds.

### 2.5 Diagnostics: a lint for the warning, a fixed release error (was 4C)

- [x] The **warning** is the lint `magic_string`, `warn` by default:
      "magic_string is used here". It makes programmers careful about where
      magic appears, not forbid it, and a dev build can silence it with the
      usual levels (4.7).
- [x] The **error** is fixed, not a lint, and applies in a release build
      whatever the lint level: "magic_string is not allowed here".
  - Why: quiet dev builds when wanted, and a guaranteed release. A pure
    lint loses the release guarantee to `;! allow`; a pure fixed rule
    breaks "every warning has a lint" (4.7.4.1).
- [x] A doc example is a test, so it is test context in every build that
      compiles it (4.6.9.10a). Magic in an example never warns or errors.
- [x] A `debug` left in a release build is already an error (8.9.5). In a
      release build the magic rule matters only for `assert_eq`, which
      §2.6 makes test-only anyway.
- [x] "Warn each time" means each call site, matching 4.7.

### 2.6 `assert_eq` is test-only (was 5B)

- [x] `assert_eq` compiles in examples and test runs, and is an error in a
      release build. Production code uses `(assert (== a b))` with a real
      `PartialEq`.
  - Why: it fits "magic is a testing aid" most cleanly. String equality is
    a testing tool, and runtime equality is a trait. No magic code ships in
    release binaries.
  - This stands even for types that all have `Literal`, where no magic
    would be needed: allowing it then would make `assert_eq`'s legality
    depend on its operands' types.
  - Rejected: exempting comparison-magic ships magic code and magic panic
    text; compiling `assert_eq` to nothing hides production-only failures
    and drops argument side effects.
  - A lint recommends `(assert (== a b))` over `assert_eq` when the type
    has `PartialEq` (§4.9).

### 2.7 A value's parts use `Literal`, then magic, never `ToString` (was 6B)

- [x] Each part of a magic string uses its type's `Literal` impl when there
      is one, and magic otherwise. For example, a magic `Employee` with a
      `Date` field uses `Date`'s `Literal` text for that field.
  - Why: `Literal` is canonical by contract (§4.3), so mixing compiler text
    with `Literal` text keeps the result canonical. The objection to mixing
    applied to `ToString`, not to `Literal`.

### 2.8 Magic is a fallback outside trait resolution (was 4.1b)

- [x] Magic is not an impl. Only hand-written or built-in impls satisfy
      `[Literal T]`. Where none exists, magic is used and warns (§2.5).
  - Why: no overlap problem, and the bound means "this type chose its
    form", which is what §2.4's "add the bound" fix and §2.5's "no impl
    exists, so magic is used" already assume. Generics cost nothing,
    since §2.4 settles that an unbounded `T` uses magic.
  - Rejected: an automatic impl of `Literal` for every type, replaced by a
    hand-written one. Replacing an automatic impl breaks the overlap rule
    (7.5.6.3), the same problem as 11.7.9. The bound would mean nothing,
    since every type meets it, contradicting §2.4, and "magic is used"
    would stop meaning "no impl exists", so §2.5 would need restating.
    Its only gain, that `[T with [Literal T]]` is always satisfiable, is
    not needed.

---

## 3. What changes in the spec

- 8.3.2 "`==` works on every type except function types" becomes "`==` is
  `PartialEq`'s method and works on the types that implement it".
  Automatic `Eq` impls (11.7.9) are no longer needed just so tests work.
- 8.6.6 "`to_string` turns a value of any type into text" becomes "a value
  whose type implements `ToString`".
- 8.9.4 "debug writes a value of any type" stays true, through `Literal`
  then magic (pending §4.2).
- 4.6.9.7 "implicit stringification (todo)" is defined: `Literal`, then
  magic.
- 8.9.6 `assert_eq`: reserved already; still to be designed (§4.9).
- 11.7.8 "Should debug require a trait?" closes: no, it falls back to
  magic.
- 4.7 gains the `magic_string` lint, and the build modes gain the fixed
  release error. The spec has no release build yet (11.8 needs one).

---

## 4. Open questions, most consequential first

Ranked by how much other design rests on the answer and how costly it
would be to change later.

### 4.1 Functions, and types a program cannot give an impl

Functions are the hardest part of the canonical form, and every value that
holds one depends on the answer.

- Possible forms: the `fn`'s source text, its defining path such as
  `<fn geometry::area>`, or an opaque `<fn>`. Opaque makes all functions
  compare equal. A path makes closures with different captures compare
  equal. Source text plus captured values is injective but long.
- Function types are built in, so a program cannot implement `Literal`
  for them (7.5.6.1).
  - [ ] Functions always use magic: then any value holding a function
        warns. Or the compiler provides an impl, which puts this question
        into the prelude.
- The same orphan problem applies to a type from another module that has
  no impl.
  - [ ] Is a wrapper type the only way out?

### 4.2 Which trait does `debug` use?

Decides what `debug` prints in every program, and whether §3's 8.9.4 line
and §2.4's bound are right as written.

- **`Literal`, then magic.** Output matches failure reports and
  `returns:`, so it can be pasted into an example. Leaning, and assumed by
  §2.4.
- **`ToString`, then `Literal`, then magic.** Friendlier output, but three
  sources of text, and `debug` would need both bounds in generic code.

### 4.3 What `Literal` promises, and whether it is checked

§5's guarantees were the compiler's job; a hand-written impl can now break
them, and a wrong impl gives wrong test results silently.

- [ ] Only documented.
- [ ] Checked under `tsc test`: every `Literal` string produced while tests
      run must lex, or the example fails.
- [ ] Round-trip: the text must compile back to an equal value. Strongest,
      but needs §5.3's form to be real code, and is impossible for private
      fields (§4.5) and functions (§4.1).
- [ ] Must values equal by `Eq` have the same `Literal` text? Not checkable
      in general. This is the semantic-equality case: a set stored as an
      unsorted list, or an unreduced fraction, is equal by a hand-written
      `Eq` but differs in text unless its `Literal` normalizes. It is the
      main cost of not using `Eq`, and the reason `Literal` is overridable.

### 4.4 Number literals: with or without a type suffix?

Affects how every numeric `returns:` is written.

- [ ] Does `5_u8` print as `5` or `5_u8`? `returns:` is not compiled, so X
      has no type of its own. Suffixes make `returns: 5` fail for a `u8`.
      No suffixes make values of different types give the same text, which
      is fine as long as both sides always have the same type. Under §2.2
      this is part of each number type's built-in impl.

### 4.5 Private fields

- [ ] Does magic text for a type from another module show its private
      fields? A test needs them to distinguish values, but showing them
      leaks a module's internals (9.5, 9.6) into another module's examples.
      Under §2.2, "no" is more acceptable: the owner can write a `Literal`
      impl that shows what it chooses. But "no" breaks injectivity (§5.1)
      for magic text of such types.

### 4.6 Logging in a release build

- [ ] With `debug` banned in a release build (8.9.5), production logging
      needs another way to turn values into text. Does it use `ToString`
      (display) or `Literal` (canonical)? Is there a release-allowed
      logging form, and which trait does it require?

### 4.7 `Literal`'s signature

Every hand-written impl is written against it, so it is costly to change
once impls exist.

- [ ] `literal : [T -> string]`: simple, but rebuilds strings for every
      nested part.
- [ ] A writer or builder argument: efficient, and lets the compiler
      indent long output. Needs a writer type the prelude does not have.

### 4.8 Built-in impls, and floats

- [ ] Which built-in types get compiler-provided `Literal` impls, so they
      never warn: numbers, `bool`, `char`, `string`, `Unit`, `[List T]`,
      `[Option T]`, `[Result T E]`, `[Box T]` (8.8, 11.7.13), `[Map K V]`?
- [ ] `Map` key order: sort by the keys' `Literal` text, or require `Ord`
      on keys?
- [ ] Float formatting: shortest round-trip (so `(+ 0.1 0.2)` gives
      `0.30000000000000004` and `returns: 0.3` correctly fails) or another
      algorithm. It must be specified, or results differ across targets.
- [ ] Signed zero: `(== 0.0 -0.0)` is true, but the texts differ unless the
      form prints them the same. Decide, or document.
- [ ] NaN: `(== nan nan)` is false (8.3.3), but `"nan"` equals `"nan"`, so
      `returns: nan` works and `assert_eq` passes where `(assert (== x x))`
      fails. Probably desirable for tests; document it.

### 4.9 The two assert lints, and `assert_eq`'s message

- [ ] §2.3 suggested a lint toward `assert_eq` for `(assert (== a b))`.
      §2.6 decided a lint the other way: toward `(assert (== a b))` when
      the type has `PartialEq` or a `PartialEq` impl is "deemed derivable".
      These conflict. Likely resolution: keep only §2.6's lint, since
      `assert_eq` is test-only. NaN (§4.8) is a case where the two forms
      differ.
- [ ] Define "deemed derivable".
- [ ] The exact text of `assert_eq`'s failure message ("left: ...,
      right: ...").

### 4.10 Reusing magic inside a hand-written `Literal`

- [ ] A built-in such as `(literal_of x)` would let an impl override one
      field and keep the magic form for the rest. Does calling it count as
      a magic use that warns?

### 4.11 Name and relationship to `ToString`

- [ ] Name: `Literal`, `Debug`, `Repr` or `Canonical`? `Literal` already
      names a grammar category in the spec (`<Literal>`, 1.3). `Debug`
      differs from the `debug` special form (4.1.9) only in case.
- [ ] Is `ToString` blanket-implemented from `Literal`? That conflicts
      with hand-written `ToString` impls under the overlap rule.
- [ ] Is either a supertrait of the other? Probably not; the jobs are
      independent.

### 4.12 A panic inside a `Literal` impl

- [ ] During a test, a `Literal` impl panics while a failure report is
      being built. Does the example fail with that panic, or does the
      report fall back to magic and note the panic?

### 4.13 Dropping magic diagnostics later

- [ ] Should the language plan for a transition in which compilers ignore
      every magic diagnostic, both the `magic_string` warning and the
      release error? Magic would become an ordinary, always-allowed
      fallback, and needs a story for what a release build may then
      contain. Speculative; nothing depends on it now.

---

## 5. Constraints on the canonical form

The full canonical form for every type is a todo. Whatever it becomes,
magic text and every `Literal` impl must be:

1. **Injective for each type.** Two values that differ structurally give
   different text, or text equality is wrong.
2. **Deterministic.** Independent of allocation, hash-table order,
   addresses and the build. A `Box` prints its contents (8.8.6 and 11.7.13
   lean this way already).
3. **Tokenizable as tsc.** 4.6.9.7 compares "apart from the spaces between
   tokens", so the text must lex under section 1. The natural form is the
   "stringified literal": text that would rebuild the value if compiled,
   for example `(Employee name = "Jane" age = 30)` and `Option.None [u8]`.

The parts of the form still open are §4.1 (functions), §4.4 (number
suffixes), §4.5 (private fields) and §4.8 (built-ins and floats).
