# Replacing overloads with traits

Everything the spec would need in order to drop built-in overloads (7.5) and
define `+`, `-`, `==` and the other operators through traits implemented type
by type.

Syntax is **hypothetical** unless a decision below fixes it. A number with §,
such as §1.5, is a section of these notes. A plain number, such as 1.5 or
4.6.2.14, is a section of the spec, `typed_symbolic_code.tsc`. In §4's table,
the "Where" column is always the spec. `[x]` marks a decision that's been made;
`[ ]` is still open. Each section lists its decided items first, then its open
items, most consequential first.

**Scope.** §1 and §2 (the trait mechanism) are what goes into the spec
now. The actual traits (`Add`, `Eq`, `Debug` and the others) come later, in a
prelude. §3 is notes toward that prelude, and its open items don't block
integration.

**Until the prelude exists**, 7.5 is still deleted. Each built-in operator in 8.x
is described as a method of a prelude trait marked todo (for example, "`+` is
`Add`'s method; `Add` is defined in the prelude, todo"). Examples that rely on a
prelude trait are marked hypothetical, as the spec already does elsewhere.
Rejected: keeping 7.5's overloads until the prelude lands (the spec would hold
two dispatch mechanisms at once, and every built-in would be rewritten twice).

---

## 0. The outcome

- 7.5 (overloads) is deleted. No name has more than one member.
- Every built-in that is overloaded today becomes either:
  - a **trait method** (`+`, `==`, `<`, `bit_and`, `as`, `to_string`, ...); or
  - a **plain generic** (`get`); or
  - a **special built-in** (`list`, which takes any number of arguments).
- Users give their own types operators by writing impls, never overloads.
- Generics no longer need `[<Type>]` after them when their arguments settle
  the types (§2.1). Nothing else settles them.
- Unary `-` is gone. Negation is `neg` (§3.1).
- 11.4.5 (user overloads) closes: the answer is traits.
- 11.7.1 (requiring an operation on a type parameter) closes: `with` bounds
  (§1.4).

---

## 1. New language features

### 1.1 Trait declarations

```
(trait [Add T]
    ;: ...
    + : [T T -> T])
```

#### Decided

- [x] **Keyword and form.** Add `trait` to 2.2. Top-level only, like
      `struct` and `enum`, and exportable (§1.11).
- [x] **What a trait body contains:** only two kinds of entry:
      - a method name with a **function type** (impls must supply it); or
      - an **auto-implementation**: a method with a body, which behaves like
        a generic over the implementing type (§1.6).
      No constants and no associated types.
- [x] **Auto-implementation syntax.** A required method is written
      `<name> : <function type>`. An auto-implemented method is written
      `<name> = {fn ...}` instead, with no separate type entry. Its type is
      read from the `fn`'s signature.
      ```
      (trait [Ord T]
          < : [T T -> bool]
          > = {fn |a : T b : T -> bool| (< b a)})
      ```
      - `:` means "impls must supply this", and `=` means "this has an
        auto-implementation". Each method has exactly one entry.
      - The form matches `(define f = {fn ...})`, which also leaves the type
        out, and the entries in an impl (§1.3).
      - The body is checked once, as if it had an implicit
        `[forall T with [Ord T]]`, so it may call any of the trait's methods
        on `T` (§1.4). For a trait with several parameters, the implicit
        forall lists all of them in order, bounded by the trait itself:
        `[forall To From with [Widen To From]]` (§1.7).
      - Rejected: a type entry plus a separate body entry (writes the
        signature twice, and gives one name two entries); type and body in
        one entry, `> : [T T -> bool] = {fn ...}` (still writes the
        signature twice, since `fn` parameters carry types); a
        `(default ...)` keyword form (a new keyword for what `=` already
        says).
- [x] **A trait names its implementing types as explicit parameters**, as
      in `[Add T]` and `[Widen To From]`. There's no implicit `Self`.
      - Why: bounds are full trait applications (§1.4), so every parameter
        needs a name. This also fits 7.1.1 ("every type parameter must be
        declared") and the existing `<Type Header>` grammar.
- [x] **Naming.** Trait names are capitalized, like types (1.4.4).
- [x] **No clashes.** A trait name can't clash with any other name (type,
      function, value or another trait), and it can't be shadowed.
- [x] **Default parameter values** (`shl`'s `n : u32 = 1`, 8.5.2) may be
      written in both impls and auto-implementations.
- [x] **The trait decides which parameters are optional; impls decide the
      values.** The trait's function type marks a parameter as optional.
      Every impl (or the auto-implementation, if no impl overwrites it) must
      then give that parameter a default, and no impl may give a default to
      a parameter the trait didn't mark.
      - Why: a generic body's `(shl x)` with `x : T` is checked once, before
        `T` is known (§1.4). Because the trait fixes which arguments may be
        left out, the call is valid for every `T` or for none.
      - The default *value* may differ between impls, just as method
        behavior does. The trait doc should say what the default means
        (for example, "`n` defaults to one bit"), and each impl keeps to it.
      - Rejected: calls through a bound must pass every argument (loses
        defaults in generic code); only the trait declares defaults
        (contradicts impls having them); every impl must agree (can't be
        checked one module at a time).

- [x] **Marking a parameter optional: `= _` in a required method's type.**
      An auto-implemented method marks a parameter optional by writing a
      default in its `fn` (`|x : T n : u32 = 1 -> T|`). A required method
      has no body, so it writes `= _` after the parameter's type instead:
      ```
      (trait [Bits T]
          shl : [T u32 = _ -> T])          ; n is optional; each impl gives its default
      (impl [Bits u8]
          shl = {fn |x : u8 n : u32 = 1 -> u8| ...})   ; ok
      (impl [Bits u16]
          shl = {fn |x : u16 n : u32 -> u16| ...})     ; error: the trait marks n optional; give it a default
      (trait [Pad T]
          pad : [T u32 = _ char -> T])     ; error: only trailing parameters may be optional (5.2.3)
      ```
      - Why: it mirrors `name : Type = value` (5.4.2), with `_` for "the
        value is given elsewhere" (by each impl, §1.1). No new tokens.
      - **Traits only.** `= _` may appear only in a required method's type
        in a trait body. Ordinary function types (3.3) don't record
        defaults, and this doesn't change that. Whether a function value
        should keep its defaults in its type when it's passed around is a
        separate question (chapter 11).
      - Only trailing parameters may be marked, since only trailing
        parameters can be left out (5.2.3).
      - Rejected: a `?` mark, `[T u32? -> T]` (a new token, clashes with the
        spec's own `X?` grammar notation, and reads as "may be null"); a
        named signature for required methods, `shl : |x : T n : u32 = _ -> T|`
        (a second form of trait entry); an `optional` keyword (wordy, and
        parentheses in a type); allowing optional parameters only on
        auto-implementations (every such method would need a required twin
        such as `shl_by`).

### 1.2 Method names are top-level names

#### Decided

- [x] **A trait method is a top-level name of the trait's module.** It
      belongs to the module just as a `define` would, and 4.1.7 (no two
      top-level names alike) applies to it.
      ```
      ;; geo
      (trait [Shape T] area : [T -> f64])
      (trait [Plot T] area : [T -> f64])     ; error: area is already a top-level name (Shape's method)
      (define area = {fn |r : f64 -> f64| r}) ; error: area is already a top-level name
      ```
      - Why: every name keeps exactly one meaning, so deleting 7.5 needs no
        exceptions. A name is resolved by scope alone, and finding the impl
        (§1.5) is the only extra step.
      - Rejected: methods scoped under their trait, `(Shape.area s)` (every
        call names the trait, so `(Add.+ a b)` forces an unqualified special
        case for built-in operators); both forms, with `Trait.method` to
        pick between clashes (only useful if clashes were allowed, and they
        aren't); choosing between same-named methods by argument type (that
        is overloading again, which this design removes).
- [x] **A method's type is a bounded generic** whose forall is the trait's
      parameters in declared order (§1.7):
      `+ : [[forall T with [Add T]] T T -> T]`. Calling `(+ a b)` is an
      ordinary generic call. Its only dispatch step is finding the impl
      (§1.5).
- [x] **A user trait can't declare a built-in or prelude name.** 4.1.7
      already forbids a top-level name that matches a built-in one, and
      11.8.5 settles that the prelude counts as an import. So an unqualified
      `(+ a b)` always means the built-in `Add`'s `+`. A user type gets `+`
      by implementing `Add`, never by declaring its own `+`.
      ```
      ;; vec
      (trait [VecAdd T] + : [T T -> T])         ; error: + is a built-in name
      (impl [Add Vec2] + = {fn |a : Vec2 b : Vec2 -> Vec2| ...})  ; ok
      ```
      - Rejected: letting a module hide a prelude name, like Haskell's
        `import Prelude hiding` (11.8.5 already decided against it).
- [x] **Shadowing a method warns, as 4.1.8 says for any top-level or
      built-in name.** A local `max`, `area` or `+` hides the method until
      it goes out of scope, and gives a warning.
      ```
      (do (let max = 10_u32) max)   ; returns 10; warning: max hides Ord's method
      ```
      - Why: methods are ordinary lowercase words (`max`, `min`, `area`). If
        shadowing one were an error, adding a method to a library trait
        would break every caller's local of that name. 4.1.8's "why" (a new
        global never breaks local code, only warns) applies exactly. A
        local `+` already only warns today, since `+` is a built-in name.
      - Trait names stay unshadowable (§1.1). They're capitalized, so the
        stricter rule costs locals almost nothing.
- [x] **Qualification follows imports (9.4.6).** Outside its module, a
      method is reached like any other exported item: `(geo::area c)`.
      Built-in traits' methods are unqualified, through the prelude
      (11.8.5, §1.11).
- [x] **Methods are written bare inside impls.** The impl's header already
      names the trait, so its entries use the method's own name, never a
      qualified one.
      ```
      ;; main
      (mod geo)
      (impl [geo::Shape Circle]
          area = {fn |c : Circle -> f64| ...})        ; ok
      (impl [geo::Shape Square]
          geo::area = {fn |s : Square -> f64| ...})   ; error: impl entries name methods bare
      (geo::area (Circle r = 2.0))                    ; ok: qualified at the call
      ```

### 1.3 Impls

```
(impl [Add Vec2]
    + = {fn |a : Vec2 b : Vec2 -> Vec2| ...})
```

#### Decided

- [x] **Keyword and form.** Add `impl` to 2.2. Top-level only.
- [x] **Every method without an auto-implementation is required.** Methods
      with one may be left out (§1.6).
- [x] **Impls have no name.** They can't be bound or passed. They're
      usable wherever their trait and every type in their header are
      (§1.11).
- [x] **Generic impls.** An impl may begin with a forall, written exactly as
      a function's (§1.4), bounds included. Its type parameters can be used in
      the impl's header and its methods.
      ```
      (impl [forall T with [Eq T]] [Eq [List T]]
          == = {fn |a : [List T] b : [List T] -> bool| ...})
      ```
      Needed for lists, `Option` and `Result` (§2.3).
- [x] **Every impl parameter appears in the header.** A type parameter in
      an impl's forall that its header doesn't mention is an error.
      ```
      (impl [forall T U] [Eq [List T]] ...)   ; error: U doesn't appear in [Eq [List T]]
      ```
      - Why: impl lookup matches the header against a goal, so a parameter
        outside the header is never settled and the impl could never be
        compiled (§1.12). Rust forbids it for the same reason.
      - Relaxing this later breaks nothing.
- [x] **Signature check.** Each method's type must equal the trait's
      declared type with the impl's header types substituted for the
      trait's parameters. No loosening or tightening. Parameters the trait
      marks optional must have a default, and no others may (§1.1).
      ```
      (impl [Add Vec2]
          + = {fn |a : Vec2 b : u8 -> Vec2| ...})   ; error: + must be [Vec2 Vec2 -> Vec2]
      ```
- [x] **Impls for function types are allowed**, under the orphan rule
      (§1.5) like any built-in type. Whether built-in traits such as `Eq`
      get function-type impls is a prelude matter (never, by 8.3.2).
      ```
      (impl [Describe [u8 -> u8]] ...)          ; ok, in Describe's module
      (impl [forall A B] [Describe [A -> B]] ...)  ; ok: one-parameter functions
      ```
- [x] **A function type is never local to a module**, even when it
      mentions the module's own types. For the orphan rule (§1.5) it's a
      built-in type constructor, like `List`: `[Point -> u8]` is no more
      local to `Point`'s module than `[List Point]` is.
      ```
      ;; in the module that defines Point and Event
      (impl [Show [Point -> u8]] ...)      ; error: [Point -> u8] isn't a local type
      (struct Handler |run : [Event -> Unit]|)
      (impl [Show Handler] ...)            ; ok: wrap the function in a local struct
      ```
      - Why: it keeps the orphan rule's guarantee that at most one module
        besides the trait's can write any given impl. Rust's rule is the
        same.
      - Workaround: wrap the function in a struct the module defines, as
        above.
      - Rejected: local if the function type mentions any local type
        (`[Point -> Meters]` would be local to two modules, so both could
        write the same impl unnoticed); local if one fixed position is
        local, such as the first parameter (arbitrary, and needs new
        coverage rules for type parameters inside function types).
- [x] **No `forall` inside a function type in impl headers or bounds.** A
      function type that has its own forall can't appear in an impl's
      header or in any bound. Function types whose parameters come from the
      enclosing forall, like `[A -> B]` above, are fine.
      ```
      (impl [Describe [[forall T] T -> T]] ...)  ; error: a generic function type can't be implemented over
      {fn [forall F with [Describe F]] ...}      ; ok, and F can't be settled as a generic function type
      ```
      - Why: impl lookup and the overlap check (§1.5) unify types, and a type
        with its own forall needs unification under binders, which this
        design doesn't define.
      - **This leaves room for expansion.** Allowing it later only accepts
        more programs, once unification for generic function types is
        defined.

#### Open

- [ ] **Todo (will be resolved): one impl covers only one number of
      parameters.** `[forall A B] [Describe [A -> B]]` covers only
      one-parameter functions, so a trait meant for every function needs
      one impl per number of parameters. Variadic generics (11.7.7) would be
      the general fix.

### 1.4 Bounds on type parameters

```
{fn [forall T U V with [Add T] [Multiply T] [Subtract T] [Divide T] [Next U]]
    |a : T b : T n : U v : V -> T| ...}
```

#### Decided

- [x] **Syntax.** A forall lists its type parameters, then optionally `with`
      and its bounds: `[forall <Name>... with <Bound> <Bound>...]` (2.5.2).
      Every bound is a full trait application, `[<Trait> <Type>...]`, written
      like a generic type with its arguments. A parameter with no bound
      simply appears in none (`V` above). Add `with` to 2.2.
      - Why: one form covers one-parameter and multi-parameter traits
        (`[Widen To From]`, §1.7) alike, and no trait parameter is
        privileged as a "subject".
      - Rejected: per-parameter bounds, `[T with Add]` (one subject only, so
        `Widen` can't be written); subject-first partial application,
        `[From with [Widen To]]` (privileges one parameter, and needs
        references to parameters declared later); no user-visible
        multi-parameter bounds (generic code couldn't call `as`).
      - The one-parameter case is wordy. Sugar or macros for it will come
        later and aren't part of this design.
- [x] **Bounds may name concrete types**, as long as every bound names at
      least one type parameter. A bound with none says nothing about the
      generic, so it's an error.
      ```
      {fn [forall T with [Widen f64 T]] |x : T -> f64| (as [f64] x)}  ; T widens to f64
      {fn [forall T with [Widen i64 u32]] |x : T -> T| x}              ; error: the bound [Widen i64 u32] names no type parameter
      ```
- [x] **A bound may name any type parameter in scope**: its own forall's,
      or an enclosing forall's (7.1.1).
- [x] **Body checking.** A generic body may use a trait method on a type
      parameter only if a bound (after supertrait expansion, §1.6) covers
      that use. The body is checked once, before any instantiation, and
      never again per instantiation (§1.12). That's the step C++ concepts
      skipped.
      ```
      {fn [forall T with [Add T]] |a : T b : T -> T| (+ a b)}   ; ok
      {fn [forall T] |a : T b : T -> T| (+ a b)}                ; error: no [Add T] bound
      ```
- [x] **Instantiation checking.** At each call, the type arguments (given
      or settled, §2.1) are substituted into the bounds, and each resulting
      goal must be proved by impl lookup (§1.5). The error points at the type
      argument, or at the argument that settled it.
- [x] **Bounds pass through.** Inside a generic body, a goal over its type
      parameters is proved by the body's own (expanded) bounds. So a generic
      with `[Add T]` may call another generic that requires `[Add T]`.
- [x] **Bounds on an enclosing parameter.** Inside an outer body, an inner
      generic's bound that names an outer parameter (`[forall U with
      [Widen T U]]`) is proved like any other goal over `T`: from the outer
      forall's bounds, since `T` is still abstract there. This is the same
      rule as "bounds pass through".
- [x] **Duplicate bounds are allowed.** `with [Add T] [Add T]` means the
      same as `with [Add T]`. A lint for them can come later without
      breaking anything.
- [x] **No bounds on struct and enum headers, for now.** Only functions and
      impls take bounds. Type headers (`[Duo A B]`) don't use the
      `forall ... with` form, so the grammar already can't express them.
      - Cost: a type such as a set or `[Map K V]` can't require `[Eq K]` in
        its type. Every function that uses one repeats the bound instead,
        as in Rust.
      - Allowing header bounds later breaks no program.

### 1.5 Coherence: exactly one impl per (trait, types)

#### Decided

- [x] **Orphan rule.** An impl `[Trait A1 ... An]` may be written in a
      module only if either:
      - the module defines `Trait`; or
      - some `Ai` is a type the module defines, and no `Aj` before it
        (`j < i`) contains an *uncovered* type parameter of the impl.
        A type parameter is uncovered when it appears bare (`T`), and
        covered when it's an argument of another type (`[List T]`).
      ```
      ;; in the module that defines Meters
      (impl [Widen Meters u32] ...)                ; ok: Meters is local
      (impl [Widen f64 Meters] ...)                ; ok: f64 has no type parameter
      (impl [forall T] [Widen Meters T] ...)       ; ok: Meters comes before T
      (impl [forall T] [Widen [List T] Meters] ...) ; ok: T is covered by List
      (impl [forall T] [Widen T Meters] ...)       ; error: T is uncovered before Meters
      (impl [Eq [List Meters]] ...)                ; error: [List Meters] isn't a local type
      ```
      - Why: for any one impl, at most one module other than the trait's
        can satisfy the rule. So two modules can't independently write the
        same impl, and conflicts are caught one module at a time. For
        one-parameter traits it reduces to "the trait's module or the
        type's module".
      - Rejected: the first parameter as the only permitted subject (forbids
        `[Widen f64 Meters]` outside the trait's module); impls of
        multi-parameter traits only in the trait's module; allowing any
        participating type and catching conflicts program-wide (breaks
        module-at-a-time checking).
- [x] **Overlap is forbidden, taking bounds into account.** Two impls of one
      trait overlap when their headers unify (each impl's type parameters
      renamed apart, all positions unified together) *and* the bounds of
      both impls could hold at once for the unified types. Overlapping
      impls are an error. There's no specialization.
      ```
      (impl [forall T] [Eq [List T]] ...)
      (impl [Eq [List u8]] ...)                    ; error: overlaps at [List u8]

      (impl [forall T] [Widen T T] ...)
      (impl [Widen u32 u32] ...)                   ; error: overlaps at (u32, u32)

      (impl [forall T with [Eq T]] [Show [List T]] ...)
      (impl [Show [List Handler]] ...)             ; ok while Handler has no Eq impl
      ```
      - Consequence: adding an impl can create an overlap between two other
        impls. Adding `(impl [Eq Handler] ...)` above makes the two `Show`
        impls overlap. The error is reported in each module whose
        transitive imports contain all three impls (impl search scope,
        below).
      - Rejected: ignoring bounds (rejects impl chains that can never
        actually collide); specialization, where the most specific impl
        wins (needs a specificity order, and a generic body's impl isn't
        known until instantiation); negative impls such as
        `(impl not [Eq Handler])` (a whole feature for an edge case).
- [x] **Impl search scope: transitive imports.** A module finds impls, and
      checks overlap, in itself and in every module reachable by following
      `mod` forms, including `internal` modules (9.5). The search and the
      check are complete one module at a time.
      ```
      ;; conv::widen
      (impl [Widen f64 units::meters::Meters] ...)
      ;; geo::area, which imports conv::widen
      (define total = {fn [forall T with [conv::widen::Widen f64 T]] |xs : [List T] -> f64| ...})
      ;; main, which imports units::meters and geo::area but not conv::widen
      (geo::area::total (list m1 m2))    ; ok: conv::widen is reached through geo::area
      ```
      - Why: by the orphan rule, an impl lives in its trait's module or in
        the module of a type in its header. A call that needs the impl
        involves the trait and every one of those types, so the impl's
        module is always in the caller's transitive imports.
      - Rejected: direct imports only (callers must import modules they
        never name, and overlap checks miss impls); the whole program (same
        effect in every legal program, but a module's result nominally
        depends on modules it can't reach).
- [x] **"Could hold at once" is judged against the search scope.** Whether
      both impls' bounds could hold at the unified types is decided by the
      impls in the checking module's search scope (above), after expanding
      supertraits (§1.6).
      - Why: it's the same lookup a call in that module would run, so the
        overlap check and impl selection never disagree.
- [x] **Latent-overlap warnings.** Two impls whose headers unify, and that
      are kept apart only because some bound doesn't hold, give a warning.
      It's on by default. There are two lints (§2.5):
      - `latent_overlap`: at least one goal that keeps them apart has no
        type parameter, so adding one concrete impl would make them overlap.
        `[Show [List Handler]]` vs `[forall T with [Eq T]] [Show [List T]]`
        is kept apart by `[Eq Handler]`.
      - `latent_overlap_generic`: every goal that keeps them apart mentions a
        type parameter. The impls overlap as soon as any one type satisfies
        all the goals at once, so no single impl is the missing one.
        `[forall T with [Eq T]] [Show [List T]]` vs
        `[forall U with [Hash U]] [Show [List U]]` is kept apart until some
        type has both `Eq` and `Hash`.
      - Why: it promotes integrating complex types into bottom-up impl
        chains. Authors see where a type's impls sit in the chain built from
        smaller types' impls, instead of finding out when someone adds an
        impl.
      - Why two lints: the generic case fires on nearly every pair of
        blanket impls with different bounds. A module can then silence it
        on its own with one `;!!`, without losing the concrete case.
- [x] **What the warning names.** Both impls, the types where their headers
      meet, and every chain that keeps them apart, in full. A chain starts
      at a bound of one of the impls that fails at the meeting types, and
      follows each failing bound down to a goal with no impl at all. Each
      step names the impl whose bound led to it. For each final goal, the
      warning says where that impl could be written: by the orphan rule,
      the trait's module or the module of a type in the goal.
      ```
      warning[latent_overlap]: these impls would overlap if [Eq Inner] were added
        impl at show.tsc:4    [forall T with [Eq T]] [Show [List T]]
        impl at handler.tsc:9 [Show [List Handler]]
        they meet at [Show [List Handler]]
        kept apart by:
          [Eq Handler]          (bound of impl at show.tsc:4)
          → [Eq Inner]          (bound of impl at handler.tsc:2)
            no impl; it could be written in eq or in inner
      hint: ;! allow latent_overlap [Eq Inner]
      ```
      For `latent_overlap_generic`, the warning lists the goals that
      would all have to hold for one type, and the chain under each where
      one exists.
      - Why: matches the leaning for repeat errors (§1.14). The goals someone
        would actually add are at the end of the chains, and the steps
        explain how they got there.
- [x] **Who gets the warning: the module where the two impls first meet.**
      A module reports the warning for a pair of impls when both are in its
      search scope and no single module it imports directly already has
      both in its own scope. When one impl's module can reach the other,
      that module is where the warning goes. When the impls sit in modules
      that don't import each other, the first module that imports both
      (directly or not) gets it.
      ```
      ;; show            (impl [forall T with [Eq T]] [Show [List T]] ...)
      ;; handler, imports show
      ;;                 (impl [Show [List Handler]] ...)   ; warned here
      ;; app, imports handler                               ; not warned: handler already has both
      ```
      - Why: it fires once for each place the risk first appears, instead of
        repeating in every module downstream. It's computed from the
        module's own scope and its direct imports' scopes, so it stays one
        module at a time.
      - Cost: the module that gets it may have written neither impl. A
        `;!!` (below) covers that.
      - The ideal target is whoever would add the missing impl, but that
        module usually can't see the two impls. The warning names that
        module instead (above).
      - Rejected: every module whose scope holds both impls (repeats
        downstream, where nobody can fix it); only an impl's own module
        (misses impls in modules that don't import each other); the module
        that would add the missing impl (it can't see the pair, which breaks
        checking one module at a time); the trait's module (can't see
        impls written downstream).
- [x] **Silencing: `;!` on an impl, or `;!!` for a module** (§2.5).
      - `;! allow latent_overlap <goal>` attached to either impl says the
        author knows `<goal>` keeps it apart from another impl, and expects
        that goal never to hold. It silences every warning involving that
        impl where `<goal>` is on one of the chains, in every module where
        it's reported. It travels with the impl, so modules downstream don't
        see the warning either.
      - The goal may name the impl's own type parameters, as written in its
        forall: `;! allow latent_overlap_generic [Hash T]`.
      - `;! allow <lint>` with no goal silences every warning of that lint
        involving the impl.
      - `;!! allow <lint>`, optionally with a goal, silences the warnings
        reported in that module. That's how a module that wrote neither
        impl acknowledges them.
      - Naming any one goal is enough. The impls stay apart while any chain
        stays broken, so the author vouches for one of them.
      ```
      ;: Shows a handler's list as its count.
      ;! allow latent_overlap [Eq Handler]
      (impl [Show [List Handler]] ...)
      ```
      - A `;!` silences only. It isn't a promise the compiler holds anyone
        to, and it never forbids `[Eq Handler]`. If that impl is added, the
        overlap is an error as usual.
      - Why not a promise: an enforced one is a negative impl, which is
        rejected (above).
- [x] **At most one impl** for each trait and tuple of types in a whole
      program. Two impls of the same trait for the same types is a compile
      error, even across modules. This follows from the overlap rule (two
      identical headers always overlap), and the orphan rule plus the search
      scope means it's caught one module at a time.

#### Open

- [ ] **Wording** of the latent-overlap warnings. The layout in "What the
      warning names" (above) is a sketch.

### 1.6 Auto-implementations and supertraits

#### Decided

- [x] **Auto-implementations** (method bodies in the trait) exist. They work
      like generics over the implementing type. They let `Ord` define `max`,
      `min`, `clamp`, `>`, `<=` and `>=` from `<`, and a future `!=` from
      `==`.
- [x] **An impl overwrites only the methods it defines.** If an impl
      supplies a method, that method's auto-implementation is gone for that
      type. There's no way to call it from the impl or extend it. The
      trait's other auto-implementations still apply. This way no type ever
      has two definitions of one method.
- [x] **No warning for overwritten auto-implementations.** An impl may
      overwrite any auto-implementation without comment. If most impls
      should overwrite a method, the trait author says so in the method's
      doc, or makes the method required.
      - Why: any count of overwrites (across the program, per module, or
        past a fixed number) breaks checking one module at a time, since
        the trait's module can't see impls written downstream. A marker the
        trait author writes would work, but needs new syntax or a lint
        command reported somewhere other than where it's written, for a
        check the doc and a required method already cover.
- [x] **Supertraits exist.** They're required at the impl and implied at
      the bound.
- [x] **Syntax: `with` after the header.** The supertrait list uses the
      bound form (§1.4), and the body follows it:
      `(trait <Header> with <Bound>... <Entry>...)`.
      ```
      (trait [Ord T] with [Eq T] [PartialOrd T]
          max = {fn |a : T b : T -> T| (if (< a b) b a)})
      (trait [Num T] with [Add T] [Subtract T] [Multiply T] [Divide T])
      ```
      - The bound list ends at the first entry. Bounds are `[...]` forms,
        and entries start with a method name, so the two can't be confused.
      - Rejected: a forall prefix like a generic impl's,
        `(trait [forall T with [Eq T]] [Ord T] ...)` (declares `T` twice,
        since the header already declares it); a body entry such as
        `requires [Eq T]` (§1.1 allows only two kinds of entry).
- [x] **Supertrait bounds name only the trait's own parameters, bare.**
      `[Eq T]` and `[Narrow From To]` are fine. `[Eq [List T]]`, `[Eq u8]`
      and parameters that aren't the trait's are errors.
      - Why: every supertrait goal is then no bigger than the trait's
        header, so the size rule (§1.14) holds without a separate check. It
        also makes the impl search argument below work.
      - Relaxing this later breaks nothing.
- [x] **Required at the impl.** `(impl [Ord X] ...)` is an error unless each
      of `Ord`'s supertraits, instantiated at `X`, can be proved from the
      impl's own bounds (expanded, below) and the impls in its module's
      search scope (§1.5). The error is at the impl and names the missing
      impl.
      ```
      (impl [forall T with [Ord T]] [Ord [List T]] ...)
      ; needs [Eq [List T]] and [PartialOrd [List T]]: found through the
      ; generic List impls, whose [Eq T] and [PartialOrd T] bounds hold
      ; because [Ord T] implies them
      ```
      - Only direct supertraits are checked. Each of their impls was checked
        for its own supertraits in turn, so every transitive supertrait
        holds too.
      - The check is complete one module at a time. By the orphan rule, the
        impl's module is either the trait's module or the module of a type
        in its header. The trait's module imports every supertrait, and the
        impl's module imports every header type (to name them). Because
        supertrait bounds use only the trait's parameters, the supertrait
        impl lives in a supertrait's module or in one of those types'
        modules. Both are in the impl module's transitive imports.
- [x] **Implied at the bound, transitively.** A bound expands to itself plus
      every supertrait, applied at the same types, then their supertraits,
      and so on. `with [Ord T]` means `[Ord T] [Eq T] [PartialOrd T]
      [PartialEq T]` (§3.2). Since cycles are an error (§1.14), this always
      finishes. The expansion applies everywhere a bound does:
      - generic bodies, which may call `==` with only `[Ord T]` (§1.4's
        body checking);
      - auto-implementations, whose implicit bound expands the same way, so
        `Ord`'s auto-implementations may call `==` and `<`;
      - generic impls' bounds, when proving their own supertraits (above);
      - bounds passing through to other generics (§1.4);
      - the overlap check's "could hold at once" (§1.5), which judges the
        expanded bounds.
- [x] **`Num` is a trait with supertraits and no methods** (see §3.1 for
      whether it exists). A trait whose body is empty is allowed. Whether
      types opt in with `(impl [Num X])` or `Num`'s module gives one blanket
      impl, `(impl [forall T with [Add T] ...] [Num T])`, is open (§3.1).
      The blanket impl satisfies §1.14's size rule, and the overlap rule then
      forbids any other `Num` impl, so it works like a bound alias. No
      separate alias feature is needed.
- [x] **Supertrait cycles are an error** (§1.14).

- [x] **Redundant bounds are allowed.** `with [Ord T] [Eq T]` repeats what
      `[Ord T]` implies, and means the same as `with [Ord T]`. It's §1.4's
      duplicate-bounds rule, after supertrait expansion.

#### Open

- [ ] **Error wording** for a missing supertrait impl: name only the direct
      supertrait, or the whole chain from the bound that needed it?

### 1.7 Traits with more than one type parameter

Needed for the casts (§3.5 below), which relate a source and a target type.

#### Decided

- [x] **No associated types** as an alternative. Ruled out by §1.1 (trait
      bodies hold only methods).
- [x] **Multi-parameter traits are allowed**, with impls for specific
      tuples of types:
      ```
      (trait [Widen To From]
          as : [From -> To])
      (impl [Widen i64 u32]
          as = {fn |x : u32 -> i64| ...})
      ```
- [x] **Bounds** use the general form (§1.4): `with [Widen To From]`.
- [x] **Declaration order is use order.** A trait's parameters, in declared
      order, are its methods' forall, in the same order, which is the order
      type arguments are given at a call. So
      `as : [[forall To From with [Widen To From]] From -> To]`, and
      `(as [i64] x)` gives `To` and leaves `From` to `x` (§2.1). A trait author
      puts the parameters a caller will write first: the target before the
      source.
- [x] **Coherence** (§1.5) applies to the whole tuple, and the orphan rule
      (§1.5) covers every position.
- [x] **Methods with their own type parameters.** If a trait method has its
      own forall, its parameters come after the trait's, in the method's
      declared order. So a method `map : [forall U] ...` in `[Functor T]`
      has the forall `[forall T U with [Functor T]]`, and type arguments at a
      call fill `T` first (§2.1).
- [x] **Trait parameters a method doesn't mention are allowed.** The
      arguments never settle such a parameter, so callers give it as a type
      argument.
      ```
      (trait [Named T] name : [-> string])
      (name [Point])   ; T given; nothing else could settle it
      ```
      - Unlike an unused impl parameter (§1.3), it isn't a problem: a call
        supplies every trait parameter before the impl is looked up.
      - Type arguments fill from the left (§2.1), so to give a later
        parameter, a caller gives every one before it. Trait authors should
        put parameters that some methods leave out first, by the same
        "declaration order is use order" rule.

#### Open

- [ ] **Output-only parameters.** Without associated types, a parameter
      that only appears in a method's result (`To`, or `zero`'s `T`, §2.2) is
      settled only by type arguments (§2.1). Fine for `as`. It would make
      mixed-type operators (`[Add L R Out]`) need `[Out]` on every call.
      Recommendation: keep operators as `[T T -> T]`.

### 1.8 Automatic impls

`==` works on every type except function types (8.3.2), and `to_string` on
every type (8.6.6). Something has to give user structs and enums these impls.
(Not the same thing as auto-implementations, §1.6: those are default method
bodies inside a trait.)

#### Decided

- [x] **Automatic impls take one bound per type parameter**, as Rust's
      derive does: the automatic `Eq` for `[Tree T]` is
      `(impl [forall T with [Eq T]] [Eq [Tree T]] ...)`.
      - Why: forced by §1.14 (a repeated goal is an error). One bound per
        field type requires `[Eq [Box [Tree T]]]`, which leads back to
        `[Eq [Tree T]]` and repeats, so `Tree` would never get `==`.
      - Cost: parameters that need no bound still get one.
        ```
        (struct [Id T] |raw : u64|)   ; T is only a tag
        (struct Handler |run : [u8 -> u8]|)
        (== a b)   ; a, b : [Id Handler]: error, no [Eq Handler]
        ```
        The workaround is a hand-written impl, if automatic impls can be
        replaced (open, below).
      - Could relax later: coinduction for structural cycles (§1.15) would
        allow per-field bounds.

#### Open

- [ ] **When an automatic impl's body doesn't check against its bounds.**
      The per-parameter bound can be too weak for a field:
      ```
      (struct [Sorted T] |items : [List T]|)
      (impl [forall T with [Ord T]] [Eq [Sorted T]] ...)   ; user's impl needs Ord
      (struct [Index T] |by_key : [Sorted T]|)
      ; automatic (impl [forall T with [Eq T]] [Eq [Index T]] ...)
      ; body needs [Eq [Sorted T]], which needs [Ord T]: only [Eq T] is available

      (struct [Callback T] |run : [T -> u8]|)
      ; automatic (impl [forall T with [Eq T]] [Eq [Callback T]] ...)
      ; body compares a function: no Eq at any T
      ```
      Options:
      - **Skip silently.** `Index` has no `==`, found out at a use site.
      - **Error at the struct.** Noisy if automatic impls are always on,
        since every such struct errors even if nobody compares it.
      - **Per-field bounds for fields outside the type's recursive group
        (§1.13).** `[Index T]` gets `with [Eq [Sorted T]]`. `[Tree T]` keeps
        only `[Eq T]`, since while its body is checked
        `[Eq [Box [Tree T]]]` resolves through the impl being defined plus
        `[Eq T]`, and nothing repeats. Fixes both examples, and most of the
        phantom-parameter cost above, at the price of a third rule to
        explain.
      Tied to "a struct with a function field" (below).

- [ ] **Always automatic** (every struct and enum gets `Eq` and `ToString`
      unless it contains a function type), or **opt-in** (a `derive`-like
      form)?
- [ ] **What the automatic impls do.** Structural `==` on fields and
      variants, and some `to_string` format. This is 11.7.2 and 11.7.4.
- [ ] **Can a user replace an automatic impl** with a hand-written one?
      Under coherence (§1.5), only if automatic impls are opt-in. The rule in
      §1.6 (an impl overwrites) suggests yes, by analogy.
- [ ] **A struct with a function field.** No `Eq` impl. Is that silent, or a
      warning?

### 1.9 Traits are bounds, not types

#### Decided

- [x] **A trait can't be used as a type.** No `[List Add]`, no trait
      objects. Mixed lists use an enum instead.
      - Why: generics are monomorphized with no runtime dictionaries (§1.12),
        so there's nothing a trait-typed value could dispatch through.
      - Revisit later if needed. Since trait names can't clash with type
        names (§1.1), adding trait objects later is unambiguous and breaks
        nothing.

### 1.10 Docs (4.6)

Docs reuse 4.6's entry words. The only new word is `law:`.

```
; hypothetical: the arithmetic needs the prelude's traits (see "Until the prelude exists")
;: Things with an area.
;: type T: the type of the shape
;: law: (area s) is never negative
(trait [Shape T]
    ;: Returns a shape's area.
    ;: param 1: the shape
    ;: returns: its area, in square units
    area : [T -> f64]

    ;: Returns the area of two copies of a shape.
    ;: param s: the shape
    ;: returns: twice its area
    ;: example:
    ;:   (double_area (Square side = 2.0))  ; returns 8.0
    double_area = {fn |s : T -> f64| (* (area s) 2.0)})

;: A square's area is its side squared.
;: example:
;:   (area (Square side = 3.0))  ; returns 9.0
(impl [Shape Square]
    area = {fn |s : Square -> f64| (* s.side s.side)})
```

The trait's examples run in the trait's module, so `Square` and its impl are
assumed to be there.

#### Decided

- [x] **Where docs attach.** A doc directly above a `trait` or an `impl`
      documents it. A doc directly above an entry in a trait or impl body
      documents that method, as a field on its own line is documented in
      place (4.6.1.3). Add these to 4.6.1.2, 4.6.1.3 and 4.6.1.7. A `;!`
      line still comes after the doc (§2.5).
- [x] **A trait's doc** needs a summary and a `type T:` entry for each
      parameter in its header. It may have `law:` entries and examples. Any
      other entry is an error. Supertraits take no entry, since the header
      already names them. 4.6.2.3, which says `type T:` describes a
      parameter "from a forall list (7.3) or a type header (7.2)", gains
      trait headers.
- [x] **`law:` is a new entry word.** It states a property every impl must
      keep, such as "`==` is reflexive". It may appear any number of times,
      only in a trait's doc. In 4.6.2.14's order it comes after `type`
      entries and before `example:`. The compiler doesn't check laws: an
      impl that breaks one is a bug in the impl (as with `panics:`, 4.6.3.6).
      - Why: laws are the contract that makes generic code over a trait
        correct, so they get an entry that tools and readers can find,
        instead of being buried in the summary.
- [x] **Every method in a trait needs a doc, in place.** It follows the
      rules for a function define (4.6.3), with two differences:
      - A required method has no `fn`, so its parameters go by position
        (`param 1:`, `param 2:`), as 4.6.3.2 already says for a define
        whose value isn't a fn literal. An auto-implemented method names
        its parameters from its `fn`.
      - Examples are optional on required methods, since the trait's module
        may have no impl to run them against. They're required on
        auto-implemented methods, as on any function.
      - A parameter the trait marks optional (§1.1) needs a `default x:` (or
        `default 1:`) entry that says what leaving it out means. Each impl
        keeps to that meaning. 4.6.2.5 gains the positional form
        `default 1:`, matching `param 1:` (4.6.3.2).
- [x] **A trait with no doc at all** (on it or any method) gets the missing
      doc warning, and once any of its docs is there, it must be complete
      (4.6.8).
- [x] **Impl docs are optional.** An impl with no doc gets no warning, since
      its trait documents the methods. If it has a doc, the doc needs a
      summary and may have examples, like a value define (4.6.4).
      - Why: the trait already says what each method does. An impl's doc
        is the natural place for concrete examples that run, since the
        impl's module has the impl.
- [x] **Method docs inside an impl are optional** too. If present, they
      have a summary, examples, and a `default x:` entry for each default
      the impl gives (the value belongs to the impl, §1.1). `param` and
      `returns:` entries would repeat the trait, so they're errors.
      - 4.6.2.14 says a default entry comes directly after its parameter's
        entry. In an impl method's doc there are no parameter entries, so
        its default entries come where the parameter entries would have
        been: after the summary, in parameter order.
- [x] **Bounds take no entry.** A generic function's `type T:` entry covers
      its parameter, and the bounds are in the signature.

### 1.11 Modules (9.4 to 9.6)

#### Decided

- [x] **Traits are exportable.** Add trait to 9.6.2's list.
- [x] **Private in public: anything private never escapes.** An exported
      item may not mention a private type or trait anywhere in its public
      surface. Each case is a "private in public" error. This covers an
      exported define's type, an exported struct's field types, an exported
      enum's variant fields, the bounds in an exported generic's forall, and
      an exported trait's method types.
      ```
      ;; units::meters
      (struct Yards |n : f64|)                          ; not exported
      (trait [Secret T] reveal : [T -> f64])            ; not exported
      (define to_yards = {fn |m : Meters -> Yards| ...})
      (define reveal_all = {fn [forall T with [Secret T]] |xs : [List T] -> f64| ...})
      (export Meters to_yards)    ; error: private type Yards in public signature of to_yards
      (export reveal_all)         ; error: private trait Secret in public bound of reveal_all
      ```
      Add this rule to 9.6. It applies to the whole language, not only to
      traits.
- [x] **Impls have no visibility of their own.** An impl is usable
      wherever its trait and every type in its header are usable, and it's
      found through the impl search scope (§1.5). Impls are never exported on
      their own. "Exported with the type" follows from this. It isn't a
      separate rule:
      - An impl on an exported type, with an exported trait, is usable
        wherever both are, for example `(impl [Add Vec2] ...)` wherever
        `Vec2` is.
      - An impl that mentions a private type is usable only in its own
        module. By the private-in-public rule, that's the only place the
        type can appear.
      - An impl with several types in its header follows the same rule.
        `[Widen Meters Yards]`, with `Yards` private, is private.
      - An impl in the trait's module on built-in or foreign types
        (`[Widen i64 u32]`, `[Widen f64 units::meters::Meters]`) is usable
        wherever the trait is.
      - A private trait on an exported type is allowed. The impl is usable
        only where the trait is, so only in the trait's module.
      - An impl on a type that isn't exported is private with it. A generic
        from this module called with that type needs the impl only at calls
        inside this module, where it's usable.
- [x] **Exporting a trait exports all of its methods**, as exporting a
      struct exports its fields (9.6.3). A method can't be named in an
      `export` form on its own, and a trait can't be exported without its
      methods.
      ```
      ;; geo
      (trait [Shape T] area : [T -> f64])
      (export Shape)   ; exports Shape and area
      (export area)    ; error: area is a method; export its trait, Shape
      ```
      - Why: an impl outside the module must supply every required method,
        so it has to be able to name all of them. A trait with only some
        methods exported could be used in bounds but not fully implemented
        or called.
      - Rejected: exporting each method on its own (needs extra rules for
        outside impls of methods they can't name); exporting a trait
        without its methods (a half-usable trait, and the private-in-public
        rule already covers what it would protect).
- [x] **Built-in traits live in the prelude** (11.8.5 (c)), and are
      designed later, not in this doc (see the note at the top of §3).

### 1.12 Compiling generics

#### Decided

- [x] **Generics are monomorphized.** Each distinct instantiation of a
      generic function gets its own compiled copy, and trait method calls
      resolve to the impl at compile time. There are no runtime dictionaries.
      - Consequence: a generic function can't call itself at a bigger type
        (polymorphic recursion), since that would need infinitely many
        copies. The rule is the expansion graph (§1.13).

### 1.13 Recursion in types

Ways that checking a type could go on forever: types that refer to
themselves (11.3.8), types that contain themselves, and type parameters
settled as types that contain them. Impl lookup is covered separately (§1.14).

#### Decided

- [x] **Recursion never happens at a bigger type (the expansion graph).**
      One rule covers types that refer to themselves and generic functions
      that call themselves (polymorphic recursion, §1.12). A recursive group
      is a set of types that mention each other (`Tree` mentions `Forest`,
      which mentions `Tree`), or a set of generic functions that call each
      other. Build a graph with one node per type parameter of the group's
      members. For each mention of a group member inside the group (for
      functions, each call, using its settled type arguments, §2.1), and each
      of its arguments `i`:
      - a parameter `X` passed as argument `i` exactly adds a non-expanding
        edge `X → param_i`;
      - a parameter `X` nested inside argument `i` (`[List X]`) adds an
        expanding edge `X → param_i`.

      A cycle that contains an expanding edge is an error.
      ```
      (enum [Tree T]
          Leaf
          Node |left : [Box [Tree T]] value : T right : [Box [Tree T]]|)  ; ok: T → T, not expanding
      (struct [Pair A B] |swap : [Box [Pair B A]]|)                     ; ok: A → B → A, not expanding
      (struct [Pair A B] |kid : [Box [Pair [List u8] A]]|)              ; ok: closed arguments add no edges
      (enum [Nest T]
          Flat |value : T|
          Deep |inner : [Box [Nest [List T]]]|)                         ; error: T → T is expanding
      (define depth = {fn [forall T] |x : T n : u32 -> u32|
          (if (== n 0_u32) 0_u32 (depth (list x) (- n 1_u32)))})         ; error: T → T is expanding
      ```
      - Why: it rejects exactly the definitions that need infinitely many
        instantiations. A type, and everything it contains, involves only
        finitely many distinct types, so walking its structure always
        finishes, and monomorphization (§1.12) makes finitely many copies.
        Closes 11.3.8.
      - Why: linear time, through strongly connected components. The error
        can name the cycle and the edge that grows ("`T` becomes `[List T]`
        here"). It doesn't depend on the size measure (§1.14).
      - Cost: harder to explain in the spec than the strict rule. For
        functions the check runs after type arguments are settled (§2.1). A
        call in a branch that never runs still counts.
      - Prior art: .NET's check for infinitely expanding generic types
        (ECMA-335 Partition II), and Kennedy & Pierce's "expansive
        inheritance" restriction.
      - Rejected: "same parameters" (every mention uses exactly the declared
        parameters, in order). Simplest to state, but rejects `[Pair B A]`
        and `[Tree u8]` inside `[Pair A B]`, which involve only finitely
        many types.
      - Rejected: strict plus an exception for closed arguments (still
        rejects permutations; a one-off patch).
      - Rejected: a size measure, as in §1.14 (rejects big closed arguments
        such as `[Pair [List u8] A]`, and ties this rule to item 13's
        definition of size).
      - Rejected: a depth limit while monomorphizing (errors depend on an
        arbitrary number and appear at use sites in other modules, as in
        §1.14).
      - Rejected: self-reference at any arguments (a type like `Nest`
        involves `[Nest T]`, `[Nest [List T]]`, and so on without end; code
        that walks it needs dictionaries, §1.12, and its automatic impls,
        §1.8, call themselves at ever bigger types).
- [x] **Boxes.** A `[Box T]` stores its value behind a pointer, so its size
      doesn't depend on `T`. A type that contains itself without indirection
      (below) in between is an error. The check walks the type's inline
      fields, and reaching the type itself, directly or through other types,
      before passing through indirection is the error.
      ```
      (struct Loop |next : Loop|)  ; error: Loop contains itself without a Box
      (struct A |b : B|)
      (struct B |a : A|)           ; error: A contains itself through B without a Box
      ```
      - Why: every type has a fixed size, and the cost of indirection is
        written where it's paid.
      - Rejected: automatic indirection for self-referencing fields (hides
        an allocation).
- [x] **Indirection: `Box`, `List`, `Map` and function types.** A type may
      contain itself through any of these, and the check in "Boxes" stops
      at them. Each is a fixed size whatever its parameters are: `List` and
      `Map` keep their contents in a heap buffer (3.1.8), and a function
      value refers to its body and captured values (9.2.2). A function
      *type* doesn't store a value of its output type at all.
      ```
      (struct [Tree T]   |value : T kids : [List [Tree T]]|)  ; ok: List is indirection
      (struct Stream     |head : u8 next : [-> Stream]|)      ; ok: a lazy stream
      (struct [Forest T] |trees : [List [Box [Tree T]]]|)     ; ok, but the Box is unneeded
      ```
      - Why: it matches how each is already stored, so `[List [Box ...]]`
        and `[-> [Box ...]]` never need writing.
      - `string`, `ubig` and `ibig` are on the heap too, but aren't generic,
        so they can never contain a user type and don't need listing.
      - Cost: `List` and `Map` are committed to keeping their contents off
        the inline value, which rules out storing a small list's elements
        inline later.
      - **This list will be expressed more generally later.** It's written
        out for now, and is meant to be replaced by a general rule (for
        example, a marker trait on the applied types,
        `(impl [forall T] [Indirect [List T]])`, which needs no new type
        system feature) so user-defined containers can count too. The same
        definition then serves as §1.15's "component" of a built-in.
      - Rejected: only `Box` (two pointers where one would do, and it
        contradicts how `List` is stored); containers but not function
        types (a lazy stream would need a pointless `Box`).
- [x] **An enum such as `Option` is inline, so `[Option [Tree T]]` inside
      `Tree` is an error.** `Option` and `Result` are ordinary enums (3.6),
      and `Option.Some` holds its value inline. Write
      `[Option [Box [Tree T]]]`. The error suggests this.
      ```
      (struct [Node T] |value : T next : [Option [Node T]]|)
      ; error: Node contains itself through Option without a Box;
      ;        write [Option [Box [Node T]]]
      (struct [Node T] |value : T next : [Option [Box [Node T]]]|)  ; ok
      ```
      - Why: it follows from the rule above with no special case, and a
        user's own `[Maybe T]` behaves exactly like `Option`.
      - Rejected: boxing `Option`'s contents automatically when they contain
        the enclosing type (a special case for one standard enum, and a
        hidden allocation).
      - A compiler may store `[Option [Box T]]` as one pointer, with null
        for `None`. That's an implementation detail, not spec text.
- [x] **`Box` syntax: an ordinary built-in generic type with explicit
      functions.** The type is `[Box T]`. A value is built with `box` and
      read with `unbox`, both plain generics:
      `box : [[forall T] T -> [Box T]]` and
      `unbox : [[forall T] [Box T] -> T]`.
      ```
      (enum [Tree T]
          Leaf
          Node |left : [Box [Tree T]] value : T right : [Box [Tree T]]|)
      (let leaf = (box Tree.Leaf [u8]))
      (let t = (Tree.Node [u8] left = leaf value = 1_u8 right = leaf))
      (unbox t.left)   ; returns Tree.Leaf [u8]
      ```
      - Why: no new grammar. Because it's a type, it can appear anywhere a
        type can (`[List [Box T]]`, function signatures), and §1.13's and
        §1.14's rules, which are already written in terms of `[Box ...]`,
        stay as they are. The allocation is visible where it happens.
      - Rejected: a type that reads see through automatically (an implicit
        conversion, against 7.4's why?, and it raises the question of
        whether `==` compares pointers or contents); a marker on the field,
        `|left : box [Tree T]|` (not a type, so it can't go inside `List`,
        and needs new field grammar); a sigil type such as `@[Tree T]` (`@`
        is already a pattern separator, and the sigil is hard to look up);
        automatic indirection (rejected above).
      - `box` and `unbox` are built-in names, so 4.1.7 keeps users from
        taking them.
      - **`unbox` stays a plain generic**, not a trait method. A trait over
        the box type, `[Boxed B]`, can't name the type inside the box: there
        are no associated types (§1.1) and no type parameters that take
        arguments. With two parameters, `[Boxed T B]` and
        `unbox : [B -> T]`, `T` appears only in the output, so the arguments
        never settle it (§2.1) and every call would need `(unbox [u8] b)`.
        Revisit if the type system gains a way to express this.
- [x] **Reading through a box in a `match`: both `unbox` first, and a `box`
      pattern.** A value can be `unbox`ed and then matched, as with any
      function result. A pattern can also reach inside a box directly with
      `(box <Pattern>)`, which matches a `[Box T]` when its contents match
      the inner pattern. It mirrors `(box x)`, the way constructor patterns
      mirror building (6.4.2), and it nests.
      ```
      (match (unbox t.left)
          ^Tree.Leaf               => "leaf"
          (Tree.Node ..)           => "node")   ; unbox first
      (match t
          (Tree.Node left = (box ^Tree.Leaf) right = (box ^Tree.Leaf) ..) => "two leaves"
          _                                                              => "other")
      ; the box pattern nests inside a constructor pattern
      (match t.left
          (box (Tree.Node value = v ..)) => v
          (box ^Tree.Leaf)               => 0_u8)  ; matching a [Box [Tree u8]] directly
      ```
      - A new kind of pattern, in chapter 6. It takes one pattern in a fixed
        place, not `name = pattern`.
      - It can't be mistaken for a constructor pattern (6.4). A constructor
        pattern names a struct or a qualified variant, which are
        capitalized (1.4.4), while `box` is a built-in name that no user
        constructor can take (4.1.7). So a pattern `(box ...)` is always a
        box pattern.
      - `(box p)` matches only a `[Box T]`. A constructor pattern never sees
        through a box by itself: `left = ^Tree.Leaf` against a
        `[Box [Tree T]]` is a type error.
      - Why both: `unbox` is an ordinary function and needs no rule to
        allow. The pattern is what lets patterns nest through boxes, which
        every recursive type needs.
      - Rejected: patterns that see through a box automatically (an
        implicit conversion, and unclear whether `left = l` binds the box or
        its contents); making `Box` a built-in struct with a `value` field
        (revises the `box`/`unbox` spelling, and looks like a struct while
        being stored unlike one).
- [x] **Values are never mutated through shared references, so a box's
      sharing can't be observed.** Bindings are immutable (4.1), and this
      design reaffirms that **mutable references will never be added**. If
      anything like mutation ever arrives, it will only be in-place
      dropping or assigning of a value nothing else refers to, never a
      reference that's shared and written through. Everything below relies
      on this.
      - **Copying** a box (binding it, passing it, or copying a field with
        `..source`, 4.4.4) copies the pointer, and both copies share the
        value inside. This can't be observed, and a deep copy would make
        every pass of a tree cost time proportional to its size.
      - **A box's identity can't be observed.** No operation tells whether
        two boxes are the same allocation. Otherwise sharing would become
        visible, and an optimization could change a program's result.
      - **`==` compares contents**, never identity. A compiler may skip the
        comparison when both boxes point to the same value only when `T` is
        `Eq` (reflexive), since a `[Box f64]` holding NaN must still be
        unequal to itself (§3.2). The impls themselves are prelude work.
      - **Values are acyclic.** A value can only refer to values that
        existed before it, so boxes never form a cycle, and reference
        counting (9.2) never leaks through them. This also keeps §1.15's
        "values are finite" true.
- [x] **`Box` in the memory model** (to add to 9.2):
      - `box` makes one heap allocation holding a `T`, managed by reference
        counting like everything else (9.2.1). Running out of memory panics,
        as for `List` and the big number types (8.8).
      - A `[Box T]` is one pointer in size, whatever `T` is.
      - `unbox` returns the value inside. Anything in it that's on the heap
        (lists, other boxes) is shared, not copied.
      - The allocation is freed when nothing refers to the box any more,
        with no code to free it.
      - **Reuse.** When a box isn't used again (9.2), a new box built from
        its contents is written into its allocation instead of a new one,
        as the big number types reuse their operand's buffer (3.1.8). So
        `(box (f (unbox b)))`, with `b` not used afterwards, allocates
        nothing.
        - Why: updating one node of a tree, the common case for immutable
          recursive data, then takes no allocation per step.
        - This is the "in-place dropping or assigning" above: the only one
          referring to the value is the code replacing it, so nothing can
          observe it.
- [x] **A named `fn` doesn't refer to itself through its value.** Inside
      `{fn fact ...}`, `fact` refers to the function being called. It's
      supplied to the body on each call, not stored in the function value,
      so a named `fn` is no cycle. Add this to 5.4.3.
      ```
      (let factorial = {fn fact |n : u64 -> u64|
          (if (== n 0_u64) 1 (* n (fact (- n 1_u64))))})  ; fact is supplied at each call
      (let make = {fn self |n : u64 -> [-> u64]|
          {fn |-> u64| (self n)}})    ; the inner fn captures self: it refers outward, no cycle
      ```
      - Why: keeps "values are acyclic" (above) true, so reference counting
        never leaks. Nothing a program can observe changes. An inner `fn`
        that captures the name only refers outward, and returning the name
        just shares the function.
      - Rejected: storing the self-reference uncounted (a second kind of
        reference just for this); an exception in 9.2 (breaks "values are
        acyclic", and needs a cycle collector or accepts a leak per
        closure).
- [x] **Top-level names aren't captured.** A function that uses a
      top-level name refers to it directly, rather than keeping it alive
      (5.4.1.4). Top-level values live for the whole program, so mutual
      recursion between top-level functions creates no cycle. Add this to
      5.4.1.4 or 9.2.
      ```
      (define is_even = {fn |n : u32 -> bool| (if (== n 0_u32) true (is_odd (- n 1_u32)))})
      (define is_odd  = {fn |n : u32 -> bool| (if (== n 0_u32) false (is_even (- n 1_u32)))})
      ; each refers to the other directly: no counted cycle
      ```
- [x] **A named `fn` whose name is never used warns** (lint
      `unused_binding`, §2.5). The name is a binding like any other, so
      4.1.10 covers it: add named `fn`s (5.4.3) to 4.1.10's list. The fix is
      to drop the name.
      ```
      {fn helper |n : u32 -> u32| (+ n 1_u32)}  ; warning: helper is never used; drop the name
      ```
- [x] **A type with no finite value is a warning** (lint `uninhabited`,
      §2.5). `(struct Loop |next : [Box Loop]|)` passes the `Box` check, but
      no `Loop` can ever be built, since building one needs a `Loop`
      already and values are acyclic (above).
      - The check, repeated until nothing changes: a struct can have a value
        if all its fields can, and an enum if some variant's fields all
        can. Type parameters are assumed to have values. `Unit`, the number
        types, `bool`, `char` and `string` always do, and `Never` never
        does. `[List X]` and `[Map K V]` always do (the empty one), as do
        `[Option X]` (`None`) and function types (a body can panic).
        `[Box X]` has a value only if `X` does.
      ```
      (struct Loop |next : [Box Loop]|)        ; warning: Loop has no finite value
      (struct Chain |next : [Option [Box Chain]]|)  ; ok: None ends it
      (struct Bush |kids : [List Bush]|)       ; ok: the empty list ends it
      ```
      - Why a warning: it catches a real mistake, is cheap to compute, and
        can be silenced with `;!` like any lint.
      - A type meant to be empty is written `Never`, which already exists
        (3.2), and the check doesn't apply to it.
      - Rejected: allowing it silently (the mistake goes unnoticed); an
        error (stricter than needed, while a type is still being drafted).
- [x] **A type parameter can't be settled as a type that contains it.**
      When type arguments are settled (§2.1), an outcome such as
      `T = [List T]` is an error: "T would contain itself". The error
      points at the argument that settled `T`.
      - Note: while types are settled bottom-up from arguments only (§2.1),
        every argument's type is already known, so this can't come up yet.
        It can once types also come from the expected type, or unsettled
        parameters get settled later (§2.1's open items). The rule is stated
        now so it's in place.
- [x] **Alias cycles are an error** (11.3.7, once aliases exist). An alias
      whose expansion reaches itself, directly or through other aliases, is
      an error at its declaration, and the error names every alias in the
      cycle, as import cycles do (9.5.4). A recursive structure must be a
      struct or enum, never an alias.

#### Open

- [ ] **Wording of the expansion-graph error.** Where the error points
      (the expanding mention or call, or the group's first member), and
      whether it lists the whole cycle of parameters.
- [ ] **`to_string` and `debug` through a box.** Show the box, as
      `(box ...)`, so the output reads like code that builds the value, or
      show only its contents, which is shorter? Belongs with 11.7.4's output
      format and the prelude's `ToString` (and `Debug`, if it exists, §3.7).
- [ ] **Error wording.** Should "contains itself without a Box" list the
      path of fields that leads back to the type?

### 1.14 Recursion in impl lookup

Looking up an impl can need other impls through its bounds, and those can
need others through theirs. The overlap check (§1.5) runs the same lookups.
These rules make every lookup finish.

#### Decided

- [x] **Bounds must not grow.** For each bound in an impl's `with`,
      compared with the impl's header:
      - (a) no type parameter appears more times in the bound than in the
        header; and
      - (b) the bound is no bigger than the header, counting each type name
        and each type parameter occurrence.
      ```
      (impl [forall T with [Eq T]] [Eq [List T]] ...)                ; ok: 1 ≤ 2
      (impl [forall T with [Show [List T]]] [Show [Wrap T]] ...)     ; ok: 2 ≤ 2
      (impl [forall T with [Eq [Wrap [Wrap T]]]] [Eq [Wrap T]] ...)  ; error: the bound (3) is bigger than the header (2)
      (impl [forall T with [Eq [Pair T T]]] [Eq [Wrap T]] ...)       ; error: T appears twice in the bound, once in the header
      ```
      - **Size, exactly:** every type name and every type parameter
        occurrence counts 1. Built-in type names (`u8`, `List`, `Map`,
        `string`) count the same as user ones, and so does `Box`. For a
        multi-parameter trait, size is totalled across all positions, so
        `[Widen [List T] u8]` has size 3. The trait name itself isn't
        counted. A function type counts 1, plus the sizes of its parameter
        types and output type: `[u8 -> T]` has size 3, and `[-> T]` size 2.
        - Why function types count: otherwise
          `(impl [forall T with [C [-> T]]] [C T] ...)` passes both rules,
          and a lookup goes on to `[C [-> [-> T]]]` and so on forever, as
          with a free `Box` (below).
        - Why every name counts at least 1: the termination argument below
          needs finitely many goals of any given size. If `Box` counted 0,
          `[C [Box T]]` would be no bigger than `[C T]`, and a lookup could
          go on to `[C [Box [Box T]]]` and so on forever without a goal ever
          repeating.
        - Why totalled: it's the loosest measure that still terminates
          (finitely many tuples have a total size at most n). An impl may
          move size between positions, as in `[Conv A [List B]]` with the
          bound `[Conv [List A] B]`.
        - Rejected: size per position (rejects safe impls, for no gain in
          termination); counting type names only and leaving parameters to
          (a) (barely differs, and is a second definition); nesting depth
          (lets bounds grow in width, with exponentially many goals before
          a repeat); weights, such as a free `Box` (breaks termination).
      - Why (a): without it, filling in `T` with a big type makes the bound
        grow even though it looks small.
      - Why: checked per impl, in the impl's own module, with the error at
        the impl. That fits checking one module at a time (§1.5).
      - Rejected: a depth limit (errors depend on an arbitrary number and
        appear at use sites in other modules); bounds strictly smaller than
        the header (rejects the `Show` impl above, and the repeat rule below
        already covers what it adds); bounds on bare type parameters only
        (contradicts §1.4, where bounds may name concrete types); the strict
        rule with a marked opt-out to a depth limit (two systems to
        specify).
- [x] **A lookup stops when a goal repeats.** Each lookup keeps a stack of
      the goals it's currently trying to prove. If a new goal exactly
      matches one already on the stack, the lookup stops. Abstract type
      parameters count as distinct named types for this comparison.
      ```
      (impl [forall T with [Show [Wrap T]]] [Eq [Wrap T]] ...)
      (impl [forall T with [Eq [Wrap T]]] [Show [Wrap T]] ...)
      ; [Eq [Wrap u8]] needs [Show [Wrap u8]], which needs [Eq [Wrap u8]]: the goal repeats
      ```
      A stop is an error (below).
- [x] **Together, the two rules make every lookup finish.** No goal in a
      lookup is bigger than the starting goal, and goals can only be built
      from the type names in the starting goal and the concrete types
      written in impl bounds. That's finitely many possible goals, so a
      chain that never repeats must end.
      - Neither rule is enough alone. Without the size rule a chain can grow
        forever. Without the repeat rule, impls whose bounds are the same
        size as their headers can loop forever.
      - The overlap check (§1.5) runs the same lookups, so it finishes too,
        and never has to give up and guess.
- [x] **Supertrait cycles are an error** (§1.6). A trait that reaches itself
      by following supertraits is an error at its declaration, and the
      error names every trait in the cycle. So expanding a bound such as
      `[Ord T]` into everything it implies always finishes.
- [x] **Supertrait bounds name only the trait's own parameters, bare**
      (§1.6). A supertrait goal is never bigger than the goal that implied
      it, so the size rule needs no extra case for supertraits.
- [x] **A repeated goal is an error** (inductive). An impl is a proof that
      needs its bounds proved first, and a cycle never reaches an impl
      without bounds, so a goal that repeats can't be proved.
      ```
      (impl [forall T with [Show [Wrap T]]] [Eq [Wrap T]] ...)
      (impl [forall T with [Eq [Wrap T]]] [Show [Wrap T]] ...)
      (== (wrap 1_u8) (wrap 2_u8))
      ; error: [Eq [Wrap u8]] → [Show [Wrap u8]] → [Eq [Wrap u8]] repeats
      ```
      - Why: the simplest model to state, and it matches "an impl is a
        proof".
      - Why: caching stays plain. Coherence gives each goal at most one impl
        and there's no backtracking, so every goal on a cycle depends on
        itself and fails from any entry point. A cached failure is always
        right.
      - Why: impls that vouch for themselves are rejected.
        `(impl [forall T with [Eq [Wrap T]]] [Eq [Wrap T]] ...)` never
        holds, instead of holding for every `T` and looping at run time.
      - Why: it can be relaxed later. Moving to coinduction only accepts
        more programs (§1.15). Moving back would break code.
      - Cost: automatic impls take one bound per type parameter, not per
        field (§1.8), with the problems listed there.
      - Cost: the error appears at a use site, possibly in another module,
        even when the impls are broken for every `T`. Each impl alone passes
        the size rule. A static cycle check at declaration could move it
        back to the impls later, without changing what the rule means.
      - Cost: hand-written impls for mutually recursive types loop if
        their bounds name the types instead of the parameters:
        ```
        (struct [Tree T]   |value : T kids : [Forest T]|)
        (struct [Forest T] |trees : [List [Tree T]]|)
        (impl [forall T with [Show T] [Show [Forest T]]] [Show [Tree T]] ...)  ; bounds 1 and 2 ≤ 2
        (impl [forall T with [Show [Tree T]]] [Show [Forest T]] ...)           ; bound 2 ≤ 2
        ; each impl passes the size rule, but [Show [Tree u8]] needs
        ; [Show [Forest u8]], which needs [Show [Tree u8]]: repeats
        ```
        Fix: bound only `T` (`with [Show T]`) on both. The bodies still
        check, since each impl can use the other at `T`. The `Forest` body's
        `[Show [List [Tree T]]]` goes through `List`'s impl to
        `[Show [Tree T]]`, then to the `Tree` impl's `[Show T]`, and nothing
        repeats.
        The error message should say so (open, below).
      - Rejected for now: a repeat succeeds (coinduction). It gives exact
        per-field bounds, but caching needs commit-or-discard groups,
        impls can vouch for themselves, and combined with supertraits
        implied at the bound (§1.6) it opens Rust's rust-lang/rust#29859
        hole. Kept as a later step, with the rules that make it safe (§1.15).
      - Rejected: coinduction for automatic impls only (as Rust's auto
        traits). Two meanings of proof in one solver, a rule needed for
        cycles that mix kinds, and replacing an automatic impl (§1.8) could
        change what compiles.

#### Open

- [ ] **Error messages.** For a repeat: the whole chain of goals, or only
      the repeated one? For a bound that grows: the bound and the header
      with their sizes?
      - Leaning, for a repeat: the full chain, each step naming the impl
        whose bound led to it, plus a hint to bound the type parameters
        instead. There's no single wrong impl, since the cycle is in the
        combination.
        ```
        error: [Show [Tree u8]] depends on itself
          [Show [Tree u8]]
          → [Show [Forest u8]]    (bound of impl at forest.tsc:3)
          → [Show [Tree u8]]      (bound of impl at forest.tsc:4)
        hint: bound the type parameters instead (with [Show T]); an impl can
              use itself and the other impls in its body
        ```
      - Also open: show the cycle at the concrete types of the use, or at
        abstract `T`, which makes clearer that the impls are broken for
        every `T`.

### 1.15 Coinduction for structural cycles, later

Not part of this design. A repeated goal is an error (§1.14). This section
records how to relax that later, if per-parameter bounds on automatic impls
(§1.8) turn out to be a real problem. The change only turns errors into valid
programs, so it can be made at any time.

The change: a repeated goal succeeds when the cycle follows the structure of
a type (rule 1). Every other repeat stays an error. Rules 2 to 4 are needed
with it.

Without the rules, plain coinduction has two holes:

```
(impl [forall T with [Eq [Wrap T]]] [Eq [Wrap T]] ...)
; holds for every T by repeat; == on Wrap calls itself forever

(impl [forall T with [Ord [Wrap T]]] [Ord [Wrap T]] ...)
; supertrait check (§1.6): [Eq [Wrap T]] is implied by the impl's own bound: passes
; size rule (§1.14): 2 ≤ 2: passes
; [Ord [Wrap Handler]] holds by repeat, so [Eq [Wrap Handler]] is implied,
; but no Eq impl for it exists
{fn [forall T with [Ord T]] |a : T b : T -> bool| (== a b)}  ; at T = [Wrap Handler]
; monomorphization (§1.12) finds no == to call
```

The second is Rust's rust-lang/rust#29859 (auto traits with supertraits).
In Rust it was memory-unsafe. Here it would be an internal error at codegen
or a miscompile.

#### Rules that would come with it

1. **Only cycles that follow the structure of a type succeed.** Every step
   around the cycle goes from a header type to one of its own components: a
   field type of a struct or enum after substitution, or the parameter of a
   type that counts as indirection (`Box`, `List`, `Map`, function types,
   §1.13). Any other repeat is an error.
   ```
   (enum [Tree T] Leaf Node |left : [Box [Tree T]] value : T right : [Box [Tree T]]|)
   ; [Eq [Tree T]] → [Eq [Box [Tree T]]] (field) → [Eq [Tree T]] (Box's parameter): ok

   (struct [Tree T]   |value : T kids : [Forest T]|)
   (struct [Forest T] |trees : [List [Tree T]]|)
   ; Tree → Forest → List → Tree, each step a component: ok

   (impl [forall T with [Eq [Wrap T]]] [Eq [Wrap T]] ...)
   ; [Wrap T] → [Wrap T]: not a component of itself: error

   (impl [forall T with [Show [Wrap T]]] [Eq [Wrap T]] ...)
   (impl [forall T with [Eq [Wrap T]]] [Show [Wrap T]] ...)
   ; no step goes into a component: error
   ```
   - Why: the recursion in the generated methods then walks a value's
     fields. Values are finite, so it ends. Blocks both holes above.
   - Why: decided by structure, not by impl kind, so hand-written impls
     that follow the structure qualify, and replacing an automatic impl
     (§1.8) doesn't change what compiles.
   - The built-ins that count are the indirection list (§1.13). When that
     list is expressed more generally, this rule follows it.
   - "Values are finite" holds because values are acyclic and mutable
     references will never be added (§1.13).
   - Caveat: that this rule is enough is an argument, not a proof. Check
     Rust's types team's current design notes for their new trait solver,
     which moves toward a similar "only some cycle steps are coinductive"
     rule, before committing.
2. **Supertraits are proved without assuming the header.** When checking
   `(impl [Ord X] ...)`'s supertraits (§1.6), a chain that leads back to
   `[Ord X]` is a failure. Rule 1 already covers this. This is a backstop
   that keeps the supertrait hole closed if rule 1 is ever loosened.
3. **A bound equal to its own header is an error.** Cheap, local, checked at
   the impl. Rule 1 covers it too, but this gives a clearer error, at the
   impl instead of at a use.
4. **No associated types stays** (§1.1). Rust's worst coinduction bugs need
   type-level outputs: a type defined through a cycle that comes out equal
   to two different types. If associated types are ever added, resolving
   them must stay inductive even if impl lookup is coinductive.

Rule 1 also keeps the overlap check (§1.5) honest. Without it, a
self-vouching impl makes extra goals hold, which shows up as overlaps that
aren't real.

#### What it would change

- Automatic impls (§1.8) could take one bound per field. Phantom parameters
  stop needing bounds, and a field whose impl needs more than `[Eq T]` gets
  its own bound, so the fallback for bodies that don't check goes away.
- Hand-written bounds that name the recursive types (the `Tree` / `Forest`
  example in §1.14) become valid, so the hint in the repeat error goes away.
- The repeat error stays, but only for cycles that don't follow the
  structure, and its wording changes to say so.
- Implementation: every goal in a cycle depends on the goal that started it,
  so when that goal finishes, the whole group holds or none of it does.
  Track the lowest stack depth each goal reached (as in Tarjan's algorithm)
  and commit or discard the group's provisional results at the cycle's head.
  No fixpoint iteration, no partial rollback. As a fast path, compute the
  strongly connected components of the impl graph once per module. Impls in
  no cycle never need provisional handling.
- Spec: "a repeat is fine if it follows the type's structure" and the
  definition of "component" have to be written and explained. Compiler
  techniques make the solver fast and correct, but don't remove these
  rules.

---

## 2. Changes to existing rules

### 2.1 Leaving out type arguments

Needed so `(+ x y)` doesn't have to be written `(+ [u32] x y)`.

#### Decided

- [x] **Generics no longer require `[<Type>]` after them.** Applies to all
      generics, not only trait methods. `(+ x y)` and
      `(first_or (list 4 5 6) 0)` compile. Rewrite 7.4.4 and the examples in
      7.3 and 7.4 that show it as an error.
- [x] **Partial type arguments fill from the left.** The type arguments
      written at a call fill the forall list in order, starting from the
      first parameter. The arguments settle the rest. To give a later
      parameter, you must give every parameter before it.
      ```
      (define pair_up = {fn [forall A B] |a : A b : B -> [Pair A B]| ...})
      (define decode  = {fn [forall Out Err In] |input : In -> [Result Out Err]| ...})

      (as [i64] x)                       ; To = i64, From settled by x
      (as [i64] [u32] x)                 ; both given
      (as x)                             ; error: To isn't settled
      (pair_up 1 "one")                  ; A and B settled by the arguments
      (pair_up [i64] n "one")            ; n : i32; error: A is i64, but the argument n is an i32
      (pair_up [i64] 1 "one")            ; ok: [i64] makes the 1 an i64 (§2.2)
      (decode [Point] [ParseError] s)    ; Out and Err given, In settled by s
      ```
      - Conflicts: if a given type argument and an argument disagree, that's
        an error, as with `pair_up` above.
      - Why: it's the order rule (§1.7, declaration order is use order), and
        the smallest change from 7.4. Authors put the parameters callers
        write first, and reordering a forall later breaks callers.
      - Rejected: all or nothing (casts always need both type arguments);
        named type arguments, `[To = i64]` (makes parameter names public API
        and the order rule pointless); filling only the unsettled parameters
        (which slot a type argument fills changes silently with the
        signature); a declared split such as `[forall To | From]` (new forall
        syntax, and inferred parameters could never be given).
      - Possible later extension: holes, `(as [_] [u32] x)`, so a later
        parameter can be given alone. Every call that's valid now stays
        valid with holes.
- [x] **Types come from the arguments only.** A type parameter that isn't
      given is settled by the call's arguments and nothing else. The type
      expected where the call appears never settles it, even when that type
      is written (an annotation, a declared parameter type, a fn's output
      type). 7.5.6's principle now covers every generic.
      ```
      (let e = (list [u8]))                ; ok
      (let e : [List u8] = (list))         ; error: nothing settles T; write (list [u8])
      (parse [u32] s)                      ; T given; the argument can't settle it
      (parse s)                            ; error: nothing settles T
      (define add_u32 = + [u32])           ; ok
      (define add : [u32 u32 -> u32] = +)  ; error: the annotation doesn't settle T
      ```
      - Consequence: a parameter that the arguments can't settle must always
        be given. That includes `list` with no arguments, `parse`, `zero`
        and `one` (§2.2), and any generic passed as a value (`+ [u32]`,
        `first_or [i32]`). 7.5.6's examples move to 7.4.
      - Why: a call's types always follow from what's written in the call,
        with no new inference rule. It's package P1: everything the
        arguments can't settle is written.
      - Kept on purpose: a written type still reaches a *literal* (5.1.1.2),
        so `(let n : u8 = 200)` works, while `(let e : [List u8] = (list))`
        doesn't. Closing that gap is sugar for later (§2.4).
      - Rejected: written types settle type parameters, using 5.1.1.2's list
        of places (deferred to §2.4, not ruled out); full unification, where
        types come from neighbors and later uses (contradicts 7.4's why?).
- [x] **Conflicts between arguments.** If two arguments settle the same
      type parameter differently, that's an error naming both. There's no
      widening to make them agree.
      ```
      (+ x y)   ; x : u32, y : u64: error: T is u32 from x but u64 from y
      ```
      The why? rewrites in 7.4 and 4.2.2 are in §4.

### 2.2 Literals (5.1.1.3, 7.5.5)

#### Decided

- [x] **A literal never takes its type from the other arguments.** An
      unsuffixed literal argument takes its parameter's type only when that
      type is written: in the signature (`get`'s `u32` index, `shl`'s `n`),
      or by a type argument at the call (5.1.1.2). When the parameter's type
      is a type parameter, the literal keeps its fixed type (5.1.1.3) and
      helps settle the parameter like any other argument.
      ```
      (+ x 1)        ; x : u32; error: T is u32 from x but i32 from 1
      (+ x 1_u32)    ; ok
      (+ [u32] x 1)  ; ok: [u32] makes the 1 a u32 (5.1.1.2)
      (get xs 2)     ; ok: the index is written as u32
      ```
      - Why: this keeps today's behavior, and a literal's type stays either
        written or fixed (5.1.1.3's why).
      - Closes 11.5.12's first bullet: the answer is no.
      - Rejected: two passes within a call, where non-literal arguments
        settle `T` and literals then take it (deferred to §2.4).
- [x] **Literals in generic bodies: `0` and `1` through traits, other
      constants through `Widen`.** A bare literal is never a value of an
      abstract `T`. Generic code gets constants in two ways:
      - **Simple: `Zero` and `One`.** These traits have the methods
        `zero : [-> T]` and `one : [-> T]`. `T` appears only in the result,
        so every call gives it: `(zero [T])` (§2.1). The call is checked
        once, in the body, against the bound. This covers sums, products,
        counts and identities.
      - **Complex: any other constant.** Bound `T` with `[Widen T S]` and
        cast a suffixed literal: `(as [T] 10_u8)`. This uses only existing
        features (§1.7, §3.5).
      ```
      ; hypothetical: fold isn't defined yet (11.7.5)
      (define sum = {fn [forall T with [Add T] [Zero T]] |xs : [List T] -> T|
          (fold xs (zero [T]) + [T])})
      (define tenfold = {fn [forall T with [Multiply T] [Widen T u8]] |x : T -> T|
          (* x (as [T] 10_u8))})
      (define bump = {fn [forall T with [Add T]] |x : T -> T|
          (+ x 1)})  ; error: T is T from x but i32 from 1
      ```
      - Why: both are checked once, before instantiation (§1.4). `0` and `1`
        fit every number type, so `Zero` and `One` raise no range question.
        Other constants are rarer, and `Widen` already exists.
      - Rejected: a general literal trait, where any literal can be a `T`
        (whether `300` fits a `u8` is known only per instantiation, which
        breaks §1.4); nothing at all (the caller would have to pass the zero
        in).
- [x] **`Widen` includes identity impls**, `[Widen T T]` for every number
      type. Without them, the constant pattern above rejects `T = u8` for
      `[Widen T u8]`. Note that `u8` doesn't widen to `i8`, so the source
      type `S` limits which `T`s a generic accepts. Its doc should say so.
      (The impls themselves are written in the prelude, §3.)

#### Open

- [ ] **Where `zero` and `one` live:** their own traits, or methods of `Num`
      if §3.1 picks one trait. Which types implement them: every number
      type, and anything else (`char`, `bool`)? A prelude question
      (§3).

### 2.3 Built-in types that need impls

These are prelude impls, decided with the prelude (see the note at the top
of §3).

#### Open

- [ ] `[List T]`: `Eq` when `T` is `Eq`; `ToString` when `T` is `ToString`.
- [ ] `[Option T]` and `[Result T E]` (3.6): the same, on their parameters.
- [ ] `Unit`, `Never`, `bool`, `char`, `string`: which traits each gets.
- [ ] `[Map K V]` (3.5, todo): does `K` need `Eq`? A hash trait?

### 2.4 Sugar, later

Not part of this design. §2.1 and §2.2 take package P1, where everything the
arguments can't settle is written. Each item below would only shorten what
P1 makes you write. Each should only turn errors into valid programs and
never change what a valid program means, and that has to be checked when
the item is designed.

- **Written types settle type parameters,** using 5.1.1.2's list of places:
  `(let e : [List u8] = (list))`, `(define add : [u32 u32 -> u32] = +)`.
  Needs a precedence rule for when the arguments also settle `T`.
- **Literals take the type that the other arguments settle:** `(+ x 1)` with
  `x : u32`. This is 11.5.12's first bullet reopened.
- **Bare `0` and `1` at an abstract `T`** mean `(zero [T])` and `(one [T])`
  under the matching bound.
- **Other bare literals at an abstract `T`** are allowed under a
  `[Widen T S]` bound when they fit in `S`.
- One-parameter bound sugar (§1.4).

Not on this list: `(- a)` as sugar for `(neg a)`. That's ruled out (§3.1).

### 2.5 Lint commands (1.1.3, 4.6)

Warnings get names, called lints, and comments can change how they're
reported. Lint commands are part of the doc comment system. The first user
is the latent-overlap warning (§1.5).

#### Decided

- [x] **`;!` is a lint command, attached like a doc.** A comment starting
      with exactly `;!` is a lint command. It attaches by 4.6.1's rules for
      `;:`: on the lines directly above an item, with nothing between, or
      trailing a field or variant. An item is anything a doc can attach to:
      a define, struct, enum, trait or impl, an entry in a trait or impl
      body, or a field or variant. A `;!` that attaches to nothing is an
      error, like a doc (4.6.1.7).
- [x] **A `;!` applies to every warning inside its item.** That includes
      warnings in a define's body, a struct's fields, and every entry of a
      trait or impl. So a warning inside an expression, such as an unused
      `let` in a function body, is silenced with a `;!` on the enclosing
      item.
      ```
      ;: Returns n plus one.
      ;: param n: the number
      ;: returns: n plus 1
      ;: example:
      ;:   (bump 1)  ; returns 2
      ;! allow unused_binding
      (define bump = {fn |n : u32 -> u32| (do
          (let scratch = 5_u32)      ; no warning: silenced by the ;! on bump
          (+ n 1_u32))})
      ```
      - Why: lets and expressions can't take a doc (4.6.1.7), so they can't
        take a `;!` either. Covering the whole item reaches every warning
        without new attachment rules.
      - Cost: a `;!` on a large item silences more than the one site it was
        written for. Keep items small, or use the lint's goal argument
        where it has one.
- [x] **`;!!` is module-wide.** A comment starting with exactly `;!!`
      applies to the whole module. `;;!` is an ordinary comment, as `;;:` is.
- [x] **`;!!` goes before any code.** Every `;!!` line comes before the
      module's first form. It doesn't have to be the first line: blank
      lines and ordinary comments may come before it or between `;!!`
      lines. A `;!!` after the first form is an error. A `;!!` never
      attaches to anything, so a doc for the first form still goes directly
      above that form, after the `;!!` lines.
      ```
      ; geometry helpers
      ;!! allow latent_overlap_generic

      ;!! deny latent_overlap
      ;: The ratio of a circle's circumference to its diameter.
      (define PI : f64 = 3.14)
      ;!! allow latent_overlap   ; error: after the first form
      ```
      - Why: a module's lint settings are all in one place, before any code
        they affect, without forcing them above a file's header comment.
- [x] **An unused lint command is a warning,** under the lint
      `unused_lint`.
      - A `;!!` is unused when it silences or changes nothing in its module.
        That's checked in the module itself.
      - A `;!` on any other item is unused when it silences or changes
        nothing inside that item. That's also checked in the module itself.
      - Exception: a `;!` for a latent-overlap lint on an impl is unused
        when it silences nothing anywhere in the program. It's the one
        warning reported after every module is checked, since the pair it
        silences may only meet downstream (§1.5).
      - Why the whole program for `;!`: when the two impls are in modules
        that don't import each other, the pair first meets in a module
        downstream. Checking only the impl's own module would then flag a
        `;!` that's doing its job.
      - Cost: deleting a downstream module can make a `;!` upstream start
        warning.
- [x] **Form:** `<level> <lint>`, optionally followed by a goal or other
      argument the lint defines. The levels are `allow` (silence it),
      `warn` (the default for every lint in this design) and `deny` (make
      it an error).
      ```
      ;!! allow latent_overlap_generic
      ;!! deny latent_overlap

      ;: Shows a handler's list as its count.
      ;! allow latent_overlap [Eq Handler]
      (impl [Show [List Handler]] ...)
      ```
- [x] **A doc and lint commands on one item: the doc first.** The `;!`
      lines come directly after the doc's last `;:` line, and directly above
      the item. A `;:` line after a `;!` line is an error.
      - Why: the summary stays the first line a reader sees, and 4.6.1.1
        ("a doc is one or more `;:` lines with nothing else between them")
        doesn't change.
- [x] **The closest command wins.** `;!` on an item beats `;!!` in the
      module, which beats the default. When items nest, the innermost wins:
      a `;!` on a trait entry, field or variant beats a `;!` on the trait,
      struct or enum around it. Two commands for one lint at the same place
      are an error.
- [x] **Unknown lints are an error,** and so is a goal that doesn't
      resolve. A mistyped `allow` must not silently do nothing.
- [x] **Every warning names its lint** in its message
      (`warning[latent_overlap]: ...`), so the `;!` to write is always shown.

- [x] **Every existing warning gets a name.** Each is silenced on its own,
      like the lints this design adds (`latent_overlap`,
      `latent_overlap_generic`, `uninhabited`, `unused_lint`). Every new
      warning added to the spec gets a name too.

      | Lint | Warning |
      |---|---|
      | `spacing` | whitespace around `::`, or after `..` before a name (1.2.10) |
      | `leading_zero` | a number with a leading zero, such as `007` (1.3.1.10) |
      | `naming` | naming conventions, for names (1.4.4) and path segments (9.3.4) |
      | `layout` | the recommended layout (1.5) |
      | `declaration_value` | a declaration's `()` used as a value, including as the last item of a `do` (2.5.1.3, 5.3.4) |
      | `discarded_value` | a discarded value that isn't `Unit` or `Never` (3.2.2) |
      | `unreachable` | code after a `Never` expression (3.2.5) |
      | `shadowing` | a local that hides a top-level name, built-in, prelude name, alias or trait method (4.1.8, 5.4.1.6, 9.4.9, 11.8.5, §1.2) |
      | `unused_binding` | a binding that's never read, including a named `fn`'s name (4.1.10, 5.7.1.6, §1.13) |
      | `missing_doc` | a declaration with no doc (4.6.8.1, §1.10) |
      | `recur_not_tail` | `recur` not in tail position (5.9.6) |
      | `unpinned_name` | a name in a pattern that compares without a pin (6.2.2, 6.4.5) |
      | `explicit_default_alias` | a `mod` alias written out when it's the default (9.4.5) |

      - 2.5.1.3 and 5.3.4 describe one warning seen from two rules, so they
        share `declaration_value`.
      - A local named like a prelude name, such as `Option`, isn't its own
        lint: 11.8.5 says it warns by 4.1.8, so it's `shadowing`. The same
        goes for a local that hides an alias (9.4.9) and a parameter that
        hides a top-level name (5.4.1.6).
      - The new lints from this design are listed where they're decided:
        `latent_overlap` and `latent_overlap_generic` (§1.5), `uninhabited`
        (§1.13) and `unused_lint` (above).
      - This answers the spec's open question on linting (11.8.8): warnings
        can be silenced or raised per item, per module, by name.
      - Each rule in the spec that warns names its lint, and the warning
        shows it (`warning[unused_binding]: ...`, as decided above).
      - Why: the list is short and fixed, and with a `;!` covering its whole
        item, `;! allow` works for every warning, not only the new lints.
      - Rejected: lints named by rule number, `;! allow 4.1.10` (renumbering
        the spec breaks programs, and it's unreadable without the spec);
        category names (can't silence one warning alone); leaving existing
        warnings unsilenceable for now.

#### Open

- [ ] **Todo: lint messages.** The wording of each lint's message, for the
      existing warnings and the new ones. Each message should name its lint
      (above) and, where there's a likely fix, say what it is.

---

## 3. Each built-in, redefined

> **The actual traits come later, in a prelude.** This doc integrates the
> trait *mechanism* (§1 and §2) into the spec. The concrete traits
> (`Add`, `Eq`, `Ord`, `Widen`, `ToString`, `Debug` and the rest), their
> impls for built-in types (§2.3), and the open items in this section are
> designed later, as part of the prelude (11.8.5 (c)). This section records
> the thinking so far. Its decided items are carried into the prelude, and
> its open items don't block integrating §1 and §2.

### 3.1 Arithmetic (8.2)

Today: `+ - * / % pow abs min max clamp`, on "numerical types", plus `+` on strings.

#### Decided

- [x] **Unary `-` is removed. Negation is `neg`.** `-` always takes two
      arguments. `neg` is a trait method (a `Neg` trait, or part of `Num`,
      as the first open item below decides). Signed integers (including
      `isize` and `ibig`) and floats implement it. Unsigned types (including
      `usize` and `ubig`) don't. There's no sugar.
      ```
      (neg 5)       ; returns -5
      (- 5)         ; error: - takes two arguments; write (neg 5)
      (neg 5_u32)   ; error: u32 has no Neg impl
      ```
      - Why: it deletes 5.2.4, the one call where a default fills the
        *first* parameter, so `-` becomes an ordinary two-parameter trait
        method. It doesn't need `0` as a `T` (§2.2), and it turns negating an
        unsigned value into a compile error instead of an overflow.
      - Rejected: `(- a)` as `(- 0 a)` (needs `0` as a `T`, and accepts
        unsigned types); `(- a)` as sugar for `(neg a)` (two spellings for
        one operation).

#### Open

- [ ] **One `Num` trait or one per operator** (`Add`, `Subtract`,
      `Multiply`, `Divide`, `Remainder`, `Pow`, `Abs`, `Neg`, `Zero`,
      `One`)? Separate traits let a
      user type support `+` without `/`. One trait is simpler to bound. (The
      bound example in §1.4 uses separate traits with full-word names.)
- [ ] **`+` on strings.** Either:
      - (a) `string` implements `Add`. Generic numeric code then accepts
        strings, and `+` isn't commutative.
      - (b) Concatenation gets its own name (`join`, `concat`, `++`), and
        `string` doesn't implement `Add`. Breaks 5.2.5, 8.2.3 and every
        string `+` example, including 5.1.2's fancy string expansion.
- [ ] **`min`, `max`, `clamp`** move to `Ord` (§3.2) as auto-implementations.
      They work on anything ordered, not only numbers.
- [ ] **Overflow (11.5.3)** is per impl. The trait doc should say what all
      impls must do.
- [ ] **`/` on integers and floats** is one trait with different behavior
      per impl (8.2.4). The trait doc must allow both.
- [ ] **`pow`'s exponent.** Today the same type as the base. Keep, or use a
      `u32` exponent for integers (also affects 11.5.6)?
- [ ] **`abs` on unsigned types:** implemented (as identity) or not?

### 3.2 Comparison (8.3)

#### Decided

- [x] **NaN ≠ NaN.** `(== nan nan)` is `false`, and every ordering
      comparison involving a quiet NaN is `false`, as in IEEE 754.
- [x] **A signaling NaN panics immediately.** Any operation that receives
      an sNaN as an operand (arithmetic, comparison, cast, `to_string`)
      panics at once, instead of producing a quiet NaN or a result. An sNaN
      never propagates, so only quiet NaNs reach the comparison traits.

#### Note: four comparison traits

Floats break reflexivity (NaN ≠ NaN) and totality (NaN is unordered), so
comparison splits into partial and total traits, linked by supertraits
(§1.6):

```
(trait [PartialEq T]
    == : [T T -> bool])
(trait [Eq T] with [PartialEq T])                 ; no methods: promises == is reflexive
(trait [PartialOrd T] with [PartialEq T]
    < : [T T -> bool]
    > = {fn |a : T b : T -> bool| (< b a)}
    <= = ...
    >= = ...)
(trait [Ord T] with [Eq T] [PartialOrd T]        ; promises every pair is ordered
    max = ...
    min = ...
    clamp = ...)
```

- Floats (`f32` to `f256`) implement `PartialEq` and `PartialOrd` only.
  Every other type that has `==` implements `Eq` too, and every other
  ordered type implements `Ord` too.
- `==` belongs to `PartialEq` and `<` to `PartialOrd`, so the operators work
  on floats. `Eq` and `Ord` add promises, not operators. (`Ord` holds the
  auto-implementations that need totality, such as `max`, `min` and
  `clamp`, §3.1.)
- `Map` keys, sets, sorting and the like require `Eq` or `Ord`, so floats
  can't be used there without a wrapper type.
- An `Eq` or `Ord` impl can't be checked for keeping its promise. Its doc
  states the laws, and an impl that breaks them is a bug in the impl.

#### Open

- [ ] **The four traits above:** confirm the names, the split, and which
      methods sit where. In particular, whether `max`, `min` and `clamp`
      belong on `Ord` (they're ill-defined with NaN) or on `PartialOrd` with
      a documented NaN rule.
- [ ] **A total-order comparison for floats** (IEEE 754 `totalOrder`), as a
      named function or a wrapper type, so floats can be sorted.
- [ ] **`Eq` for `==`.** Implemented for every type except function types
      (8.3.2) and floats, through the automatic impls (§1.8) and conditional
      impls (§2.3). What the automatic impls derive for a struct with a float
      field: `PartialEq` only, presumably.
- [ ] **When an sNaN is detected.** Checking every float operand costs time.
      Decide whether the check runs in every build, and say whether loading
      an sNaN (from bits or a parse) panics, or only using it.
- [ ] **`Ord` for `< > <= >=`.** Today only "numerical types" (8.3.4), so
      `(< "a" "b")` is an error. Keep that, or implement `Ord` for strings,
      `char` and `bool`?
- [ ] **Does `!=` exist?** It doesn't today. If added, it's an
      auto-implementation on `Eq`.

### 3.3 Boolean logic (8.4)

#### Decided

- [x] No change. `not`, `and`, `or` and `xor` only take `bool`s, so they were
      never overloaded. Remove any wording that calls them overloaded.

### 3.4 Bitwise (8.5)

#### Open

- [ ] **A `Bits` trait** for `bit_not`, `bit_and`, `bit_or`, `bit_xor`,
      `shl` and `shr`.
- [ ] **One trait or two** (logic ops vs shifts)?
- [ ] **Which types implement it** is exactly 11.3.2 ("stack types"). The
      impl list settles it.
- [ ] **`shl` and `shr` defaults.** The trait marks `n` optional, and each
      impl gives `n : u32 = 1` (§1.1). 8.5.3 is deleted: the literal rule in
      §2.2 covers it.

### 3.5 Casts and conversion (8.6)

#### Decided

- [x] **`as`:** a two-parameter trait `[Widen To From]` (§1.7), implemented
      once for each pair in 8.6.2's "wider" table, plus the identity pairs
      (§2.2). The target comes first, so `(as [i64] x)` gives the target.
      Bounded as `with [Widen To From]` (§1.4).

#### Open

- [ ] **`try_as` and `wrap`** take the same shape: `[TryAs To From]` and
      `[Wrap To From]`.
- [ ] **`to_string`:** a `ToString` trait, implemented for every type through
      the automatic impls (§1.8). Decide its output format (11.7.4), and
      whether function types get one.
- [ ] **How many impls** that is: every widening pair across u8 to u256,
      ubig, i8 to i256, ibig, f32 to f256, usize, isize and char. Written
      out, or generated by a rule? 11.7.3's remaining pairs (`i32` to `f64`,
      etc.) get settled by adding impls.
- [ ] **Can users add `Widen` impls** for their own types? Under §1.5's orphan
      rule only for their own types, but should `as` stay limited to
      primitive types (3.1.3 says casts are the only way to change a type)?
- [ ] **`parse`:** a `Parse` trait on the target type, `string -> [Result T ParseError]`.
      `T` is never settled by the argument (§2.1's unsettled parameters).
- [ ] **`try_as`:** a separate trait for checked conversion. Which pairs?
      Every pair of number types?
- [ ] **`wrap`:** a separate trait. Its pairs exclude `ubig` and `ibig` as
      targets (8.6.4).
- [ ] Rewrite 8.6.1's "Each cast takes its target type as its type argument
      (7.5.4)".

### 3.6 Lists (8.7)

#### Open

- [ ] **`get`:** becomes a plain generic, `[forall T] [List T] u32 -> [Option T]`.
      The index is written as `u32`, so 8.7.2.3 is covered by §2.2's literal
      rule.
- [ ] **`len` and other list operations (11.7.5)** become plain generics.
      `contains`, `index_of` and similar would need `with [Eq T]`.
- [ ] **`list`:** stays a special built-in (it takes any number of
      arguments, 8.7.1.2). Its type argument rule moves from 7.5.4 into
      8.7.1.3. Revisit if variadic functions arrive (11.7.7).

### 3.7 Special forms (8.1.2)

#### Open

- [ ] `print`, `panic`, `assert`, `debug`: no change. Should `debug` require
      a trait (`Debug`), or keep working on every type?

---

## 4. Spec text to edit

Rows that name a specific trait (8.2 to 8.6, 5.2.4, 5.2.5, 11.3.2 and the
like) point at the prelude trait and mark it todo until the prelude is written
(see "Until the prelude exists" at the top).

| Where | Change |
|---|---|
| 1.4.4 | Traits are capitalized |
| 2.2 | Add `trait`, `impl`, `with` |
| 2.5.1.2 (example) | `+ [u32]` example's comment: "(7.5)" → "(7.4)" |
| 2.5.2 | `<Type Argument>`: drop "or overloaded". `<Forall>` takes `[forall <Name>... with <Bound>...]`, and `<Bound>` is `[<Trait> <Type>...]`. Impls may start with a `<Forall>`. Add categories for trait headers, trait bodies and impls. A required method's function type may end with parameters written `<Type> = _` (§1.1) |
| 11 (new question) | Should a function value keep its defaults in its type when passed around? Today function types (3.3) don't record them; `= _` is for traits only (§1.1) |
| 3.1.3 | Casts: point at the new traits |
| 3 (new) | A `[Box T]` type, built with `box` and read with `unbox`. A type that contains itself without indirection (`Box`, `List`, `Map`, function types; to be expressed more generally later) is an error. Enums such as `Option` are inline. A type with no finite value warns (`uninhabited`) (§1.13) |
| 8 (new) | `box : [[forall T] T -> [Box T]]` and `unbox : [[forall T] [Box T] -> T]` as built-ins (§1.13) |
| 6 (new) | Box patterns: `(box <Pattern>)` matches a `[Box T]` whose contents match. `box` is a built-in name, never a constructor, so it's never read as a constructor pattern (6.4) (§1.13) |
| 3.5 | `Map` keeps its contents in a heap buffer, as `List` does, so it counts as indirection (§1.13) |
| 4.1 or 9.2 | Mutable references will never be added; at most in-place dropping or assigning of an unshared value. Values are acyclic, and a box's identity can't be observed (§1.13) |
| 9.2 | `Box` in memory: one counted heap allocation, one pointer in size, copies share, freed when unreferenced, reused when not used again (§1.13) |
| 5.4.3 | A named `fn`'s name refers to the function being called, supplied at each call and not stored in its value (§1.13) |
| 5.4.1.4 or 9.2 | Top-level names aren't captured; a function refers to them directly (§1.13) |
| 4.1.10 | Add named `fn`s (5.4.3) to the bindings that warn when never read (§1.13) |
| 3.6 | `Option` and `Result` are inline: a type containing itself through them needs a `Box` (§1.13) |
| 3.3 | Function types: note they have no `Eq` |
| 4.1.7 | Add traits and their methods to the list of top-level names. A method may not take a built-in or prelude name (§1.2) |
| 4.1 (shadowing) | Trait names can't be shadowed |
| 4.1.8 | A local that hides a trait method warns, like any top-level name (§1.2) |
| 4.2.2 | Rewrite the why? ("nothing is inferred") |
| 4.6 | Doc rules for traits, methods and impls (§1.10). 4.6.1.2, 4.6.1.3, 4.6.1.7: docs attach to traits, impls and their entries. 4.6.2: add `law:` and its place in the order. 4.6.2.3: `type T:` also covers trait headers. 4.6.2.5: add the positional `default 1:`. 4.6.2.14: in an impl method's doc, default entries come after the summary, in parameter order. New subsections for trait docs (like 4.6.3 and 4.6.5) and impl docs (optional, like 4.6.4). 4.6.8: traits get the missing-doc warning, impls don't |
| 5.1.1.3 | Delete the overloaded-argument clause; point at §2.2's rule |
| 5.2.4 | Delete: `-` has no one-argument form (§3.1) |
| 5.2.5 | Replace with "operators are trait methods" |
| 7.1 | Remove the closing note about 11.7.1; mention bounds |
| 7.2 | Rule: a type may refer to itself, directly or through others, only if no cycle of its parameters grows (the expansion graph). `[Tree T]` stores its children in `Box`es (`left : [Box [Tree T]]`), its construction example wraps them (`left = (box Tree.Leaf [i32])`), and it loses its "hypothetical" note (§1.13) |
| 7.3, 7.4 (or wherever §2.1's rules land) | A type parameter can't be settled as a type that contains it (§1.13) |
| 7.3, 7.4 | `with` bounds in forall; leaving out type arguments (§2.1); rewrite errors that show missing type arguments |
| 7.3, 7.4 | Bound checking: bodies are checked once against their bounds, calls prove the substituted bounds, and bounds pass through to inner and enclosing generics (§1.4) |
| 7.4 | Types come from the arguments only, never the expected type. Move 7.5.6's examples here (§2.1). Two arguments settling one parameter differently is an error (§2.1). Rewrite the why? ("every type in a call is written...") |
| 7.4.7 | Delete ("Built-ins take type arguments by the rules of 7.5") |
| 7.5 | Delete; replace with a new section on traits. Includes: every impl parameter appears in the header, an impl's methods match the trait's types exactly (§1.3), at most one impl per trait and types (§1.5), and a trait isn't a type (§1.9). Impls for function types follow the orphan rule, and a function type is never local to a module; no function type with its own forall in impl headers or bounds (§1.3). Duplicate and redundant bounds are allowed (§1.4, §1.6). Trait parameters a method doesn't mention are given as type arguments (§1.7). Only functions and impls take bounds (§1.4) |
| 8.1.3 | Rewrite: passing `+` needs type arguments because it's generic, not because it's overloaded |
| 8.2 to 8.6 | Each category names its trait and lists impls (§3) |
| 8.2 | Add `neg`, `zero` and `one`. 8.2.2: drop `-`'s one-argument default (§2.2, §3.1) |
| 8.4 | Remove any wording that calls `not`, `and`, `or`, `xor` overloaded (§3.3) |
| 8.5.3 | Delete |
| 8.6.1 | Rewrite the reference to 7.5.4 |
| 8.7.1.3 | Move the empty-list rule here from 7.5.4 |
| 8.7.2.3 | Delete (covered by §2.2) |
| 9.6.2, 9.6.3 | Export traits. Exporting a trait exports all its methods; a method can't be exported alone. Impls have no visibility of their own (§1.11) |
| 9.4.6 | Methods are reached as `alias::method`; impl entries name methods bare (§1.2) |
| 9.6 (new rule) | Private in public: an exported item may not mention a private type or trait (§1.11) |
| 9.4 or 9.5 (new rule) | Impls are found in a module's transitive imports (§1.5) |
| 11.4.5 | Close: users write impls, not overloads |
| 11.5.12 | Close the first bullet: no, a literal never takes the type of its other operands (§2.2). Point at §2.4 for later sugar |
| 11.7.1 | Close |
| 11.7.2, 11.7.3, 11.7.4 | Reword in terms of impls |
| 11.3.2 | Reword: which types implement `Bits` |
| 11.3.7 | Aliases: note that alias cycles are an error (§1.13) |
| 11.3.8 | Close: recursion never happens at a bigger type, by the expansion graph (§1.13) |
| 11.8.5 | Confirm the leaning, (c): there is a prelude. Built-in traits live in it; their design comes later (§1.11, §3) |
| 11.8.8 | Close: lints are named, and `;!` / `;!!` silence or raise them per item or per module (§2.5) |
| 11 (new questions) | Move the deferred open items here: the wording of the latent-overlap warning (§1.5), the missing-supertrait error (§1.6), the expansion-graph and "contains itself" errors (§1.13), and the repeat and size errors (§1.14); one function-type impl per number of parameters (§1.3); output-only trait parameters (§1.7); automatic vs opt-in impls and their open items (§1.8); `to_string` and `debug` through a box (§1.13); lint messages (§2.5); coinduction for structural cycles, as a possible later step (§1.15) |
| 11.9 | Add any new hypothetical examples |
| 11.9.1 | Remove: `[Tree T]` referring to itself is no longer hypothetical (§1.13) |
| new | Latent-overlap warnings: lints `latent_overlap` and `latent_overlap_generic`, on by default, reported where the two impls first meet, naming every chain in full (§1.5) |
| 1.1.3, 4.6.1 | Lint commands: `;!` attaches like `;:` (after the doc), `;!!` is module-wide, `;;!` is ordinary. `;!!` lines come before the first form. Levels `allow`, `warn`, `deny`. Unused commands warn (`unused_lint`) (§2.5) |
| Every rule that warns (1.2.10, 1.3.1.10, 1.4.4, 1.5, 2.5.1.3, 3.2.2, 3.2.5, 4.1.8, 4.1.10, 4.6.8.1, 5.3.4, 5.4.1.6, 5.7.1.6, 5.9.6, 6.2.2, 6.4.5, 9.3.4, 9.4.5, 9.4.9, 11.8.5) | Name its lint, from §2.5's table (§2.5) |
| 1.1.3, 4.6.1 | A `;!` applies to every warning inside its item (§2.5) |
| new | Impl lookup: bounds must not grow (size: every type name and parameter occurrence counts 1, built-ins and `Box` included, a function type counts 1 plus its parameters and output, totalled across positions), a goal that repeats is an error, supertrait cycles are an error (§1.14) |
| 11.7.2, 11.7.4 | Automatic impls take one bound per type parameter (§1.8) |
| new | Supertraits: `with` after a trait header, bare own parameters only, required at the impl, implied at the bound (§1.6) |
| 8.3 | `PartialEq`, `Eq`, `PartialOrd`, `Ord`; floats implement only the partial ones (§3.2) |
| 8.3.3 | NaN ≠ NaN; a signaling NaN panics when an operation receives it (§3.2) |

---

## 5. Decided

- `trait` is top-level and exportable (§1.1, §1.11).
- `impl` is top-level. Impls have no visibility of their own: an impl is
  usable wherever its trait and every type in its header are (§1.3, §1.11).
- A trait body holds function types and auto-implementations, which work like
  generics. A required method is `<name> : <function type>`, and an
  auto-implemented one is `<name> = {fn ...}` (§1.1, §1.6).
- No associated types (§1.1, §1.7).
- Traits are capitalized, can't clash with other names, and can't be shadowed (§1.1).
- Trait methods are top-level names of the trait's module (4.1.7). A method
  can't take a built-in or prelude name, so unqualified `+` always means
  `Add`'s. Shadowing a method warns (4.1.8). Methods are qualified like any
  import (`geo::area`) and written bare inside impls (§1.2).
- Exporting a trait exports all its methods; a method can't be exported
  alone (§1.11).
- Default parameter values may appear in impls and auto-implementations. The
  trait marks which parameters are optional, and impls supply the values (§1.1).
- An impl overwrites only the methods it defines. Overwriting an
  auto-implementation never warns (§1.6).
- A required method marks an optional parameter with `= _` in its type,
  trailing parameters only, in traits only (§1.1).
- Traits name their implementing types as explicit parameters; there's no `Self` (§1.1).
- Bounds are full trait applications after `with`:
  `[forall T U V with [Add T] [Multiply T] [Next U]]`. A bound may name
  concrete types and any type parameter in scope, but must name at least one
  type parameter. Sugar for the one-parameter case comes later (§1.4).
- Generic impls start with a forall: `(impl [forall T with [Eq T]] [Eq [List T]] ...)` (§1.3).
- Impls for function types are allowed under the orphan rule, and a
  function type is never local to a module, like `[List Point]`. A function
  type with its own forall can't appear in an impl header or a bound, which
  leaves room to allow it later (§1.3).
- Duplicate and redundant bounds are allowed (§1.4, §1.6).
- Only functions and impls take bounds; struct and enum headers don't, for
  now (§1.4).
- Trait parameters a method doesn't mention are allowed, and given as type
  arguments (§1.7).
- A function type counts 1 toward size, plus its parameter and output
  types (§1.14).
- Every impl parameter appears in the impl's header, and each method's type
  equals the trait's with the header types substituted (§1.3).
- Generic bodies are checked once against their bounds. Calls prove the
  substituted bounds through impl lookup, and goals over an abstract
  parameter are proved by the enclosing bounds (§1.4).
- At most one impl per trait and tuple of types (§1.5).
- A trait method's own type parameters come after the trait's (§1.7).
- A trait can't be used as a type; no trait objects (§1.9).
- Built-in traits live in the prelude, designed later (§1.11, §3).
- Two arguments that settle a type parameter differently are an error (§2.1).
- `Widen` includes identity impls for every number type (§2.2).
- Multi-parameter traits are allowed. Declaration order is use order: the
  trait's parameters are its methods' forall and type-argument order, so
  casts are `[Widen To From]` (§1.7, §3.5).
- Orphan rule: the trait's module, or the module of some type in the impl
  header with no uncovered type parameter before it (§1.5).
- Overlapping impls are an error, taking bounds into account. There's no
  specialization (§1.5).
- Impls are found, and overlap is checked, in a module's transitive
  imports (§1.5).
- Impls kept apart only by bounds warn, on by default: `latent_overlap`
  when a concrete goal keeps them apart, `latent_overlap_generic` when only
  goals over type parameters do. The warning goes to the module where both
  impls first meet and names every chain in full. `;!` on an impl or `;!!`
  in a module silences it (§1.5, §2.5).
- Lint commands: `;!` attaches like a doc, after it, and applies to every
  warning inside its item. `;!!` applies to the module and goes before its
  first form. The levels are `allow`, `warn` and `deny`. An unused lint
  command is a warning (§2.5).
- Private in public: an exported item may not mention a private type or
  trait. Anything private never escapes (§1.11).
- Generics are monomorphized: one compiled copy per instantiation, no runtime
  dictionaries (§1.12).
- Generics no longer require `[<Type>]` after them (§2.1).
- Partial type arguments fill the forall from the left, and the arguments
  settle the rest: `(as [i64] x)` (§2.1).
- Types come from the arguments only, never from the expected type, even a
  written one. `(list)`, `(parse s)` and a generic passed as a value always
  need their type arguments (§2.1).
- A literal never takes its type from the other arguments. `(+ x 1)` with
  `x : u32` is still an error (§2.2).
- In generic bodies, `0` and `1` come from `Zero` and `One`, as
  `(zero [T])` and `(one [T])`. Other constants come from a `[Widen T S]`
  bound and `(as [T] 10_u8)`. A bare literal is never a value of an abstract
  `T` (§2.2).
- Sugar that relaxes these rules may come later (§2.4).
- Unary `-` is removed. Negation is `neg`, implemented for signed types and
  floats only, with no sugar (§3.1).
- Types that refer to themselves and generic functions that call themselves
  are checked with the expansion graph: a cycle of type parameters with an
  expanding edge is an error (§1.13).
- A `Box` type exists. A type that contains itself without indirection
  in between is an error (§1.13).
- `Box` is an ordinary built-in generic type, `[Box T]`, built with `box`
  and read with `unbox`, both plain generics (§1.13).
- `Box`, `List`, `Map` and function types count as indirection. The list
  will be expressed more generally later. Enums such as `Option` are
  inline (§1.13).
- A box is read by `unbox`, or by a `(box p)` pattern (§1.13).
- Mutable references will never be added; at most in-place dropping or
  assigning of an unshared value. Copies of a box share its value, a box's
  identity can't be observed, `==` compares contents, and values are
  acyclic (§1.13).
- A box is one counted heap allocation, reused when the box isn't used
  again (§1.13).
- A type with no finite value warns (`uninhabited`) (§1.13).
- A named `fn`'s name is supplied at each call, not stored, so it's no
  cycle. Top-level names aren't captured. A named `fn` whose name is never
  used warns (`unused_binding`) (§1.13).
- Every existing warning has a lint name, from `spacing` to
  `explicit_default_alias`, and every new warning gets one (§2.5).
- Size, for the impl bound rule: every type name and type parameter
  occurrence counts 1, built-ins and `Box` included, totalled across a
  multi-parameter trait's positions (§1.14).
- Docs: traits need a summary, `type` entries, and a doc on every method
  (examples optional on required methods). `law:` is a new entry for a
  trait's doc. Impl docs and impl method docs are optional (§1.10).
- A type parameter can't be settled as a type that contains it (§1.13).
- Alias cycles are an error (§1.13).
- Impl bounds must not grow: no type parameter appears more often in a
  bound than in the header, and no bound is bigger than the header (§1.14).
- An impl lookup stops when a goal repeats. With the size rule, every
  lookup and every overlap check finishes (§1.14).
- A repeated goal is an error (inductive), not a success. Coinduction for
  cycles that follow a type's structure may come later (§1.14, §1.15).
- Automatic impls take one bound per type parameter, not per field (§1.8).
- Supertrait cycles are an error (§1.14).
- Supertraits exist: `(trait [Ord T] with [Eq T] [PartialOrd T] ...)`.
  Supertrait bounds name only the trait's own parameters, bare. An impl
  requires its direct supertraits' impls, and a bound implies every
  supertrait, transitively (§1.6).
- A trait may have no methods (`Eq`, `Num`) (§1.6).
- NaN ≠ NaN, and a signaling NaN panics as soon as an operation receives it
  (§3.2).

## 6. Open decisions, in the order to decide them

Ordered so that each decision comes before the ones it settles, and
otherwise by how much it constrains. "Settles" means the later item is
answered, or loses an option, once the earlier one is picked.

Items marked *(prelude)* are about the actual traits, which come later in a
prelude (§3). They don't block integrating §1 and §2.

1. ~~**How strict the recursion rule is**~~ **Decided**: "never at a bigger
   type", checked with the expansion graph, for both self-referencing types
   and generic functions that call themselves (§1.13). `[Pair B A]` and
   `[Tree u8]` inside `[Pair A B]` are allowed, and so is `f` at `[A B]`
   calling `f` at `[B A]`. Only the error's wording is left (§1.13, item 13).
2. ~~**What a repeated goal means in impl lookup**~~ **Decided**: an error
   (§1.14). Automatic impls therefore take one bound per type parameter
   (§1.8). Left open: what happens when an automatic impl's body doesn't
   check against those bounds (§1.8), and the repeat error's wording
   (item 13). Coinduction for structural cycles is recorded as a later
   step (§1.15).
3. ~~**Overlap warnings**: who gets them, and how to silence them~~
   **Decided** (§1.5, §2.5): the module where both impls first meet, silenced
   by `;!` on an impl or `;!!` before the module's first form, on by
   default. An unused lint command warns. Left open: the wording.
4. *(prelude)* **One `Num` trait or one per operator**, and whether `Num`
   is opt-in or a blanket impl (§3.1, §1.6, §2.2).
   - Already settled: `neg` gets its own trait either way. Unsigned types
     don't implement `neg` (§3.1, decided), so a `Num` holding `neg` would
     shut them out of all arithmetic.
   - Settles, if one trait: `+` on strings is option (b). `string` can't
     implement `Num` without `/` and `pow`, so concatenation needs its own
     name. The opt-in vs blanket question also disappears, since that only
     arises when `Num` is a supertrait alias over separate traits.
   - Narrows, if one trait: `zero` and `one` can join `Num`, since every
     number type has them (unlike `neg`). Whether other types such as
     `char` get them (§2.2) stays open.
   - If per operator: item 10 stays open.
5. *(prelude)* **The comparison split**: confirm `PartialEq` / `Eq` / `PartialOrd` /
   `Ord`, where `max`, `min` and `clamp` sit, and when an sNaN is detected
   (§3.2).
   - Settles: what an automatic impl gives a struct with a float field
     (`PartialEq` only) once item 6 is picked.
6. *(prelude)* **Automatic vs opt-in `Eq` and `ToString` impls** (§1.8).
   Goes to chapter 11 until then.
   - Settles: whether a user can replace an automatic impl. Under the
     overlap rule (§1.5) only if they're opt-in.
   - Settles, if opt-in: "a struct with a function field, silent or a
     warning?" goes away. Asking for `Eq` on one is just an error.
   - Depends on item 5 for which traits they produce. Their bounds are
     decided (one per type parameter, §1.8).
   - Interacts with §1.8's open "body doesn't check against its bounds":
     an error at the struct is only reasonable if impls are opt-in.
7. ~~**`Box` design**~~ **Decided** (§1.13): `Box`, `List`, `Map` and
   function types are indirection; `Option` is inline; `unbox` and `(box p)`
   patterns (`unbox` a plain generic); copies share and `==` compares contents; reuse when not used
   again; a type with no finite value warns; a named `fn` is no cycle, and
   top-level names aren't captured. Left open: `to_string` and `debug`
   through a box (prelude).
8. ~~**Bound checking details**~~ **Decided** (§1.4, §1.6): duplicate and
   redundant bounds are allowed; no bounds on struct and enum headers for
   now.
9. ~~**Trait parameters a method doesn't mention**~~ **Decided** (§1.7):
   allowed; callers give them as type arguments.
10. *(prelude)* **`+` on strings** (§3.1). Open only if item 4 picks one
    trait per operator.
11. *(prelude)* **How the cast pairs are listed**, and whether users can add
    `Widen` impls (§3.5).
    - Decided: identity impls such as `[Widen u8 u8]` are included (§2.2).
    - Already partly settled: which user `Widen` impls are possible. The
      orphan rule (§1.5) allows them only for the user's own types. What's
      left is whether to allow them at all.
12. ~~**What "commonly overwritten" means**~~ **Dropped** (§1.6): there's
    no warning for overwriting an auto-implementation.
13. **The wording of recursion errors** (§1.14, §1.13). (The size measure is
    decided, §1.14.) Needs:
    - item 1 (decided: the expansion graph) for the recursion error;
    - item 2 (decided: a repeat is an error, so its message is needed).
14. ~~**Syntax for marking optional parameters**~~ **Decided** (§1.1):
    `= _` after the parameter's type, in a required method's type only.
15. ~~**Docs**~~ **Decided** (§1.10): trait docs need a summary, `type`
    entries and a doc on every method, with the new `law:` entry. Impl docs
    are optional. (Prelude placement is decided too: built-in traits live
    in the prelude, §1.11.)

### Settled by other decisions, at a glance

| Question | Settled by |
| --- | --- |
| Polymorphic recursion rule's shape | Decided: the expansion graph (§1.13) |
| Bounds of automatic impls | Decided: one per type parameter, since a repeat is an error (§1.8, §1.14) |
| Error message for a repeated goal | Needed, since a repeat is an error. Wording is item 13 |
| Which impls overlap is judged against | Decided impl search scope (§1.5) |
| Where `neg` lives | Decided: unsigned types have no `neg` (§3.1) |
| `+` on strings | 4, if one `Num` trait |
| `Num` opt-in vs blanket impl | 4, gone if one `Num` trait |
| Automatic impls for float fields | 5 and 6 |
| Replacing an automatic impl | 6, through the overlap rule |
| Struct with a function field | 6, gone if opt-in |
| `Box` in the size measure | Decided: counts 1, or lookups don't terminate (§1.14) |
| Redundant supertrait bounds (§1.6) | Decided: allowed, like duplicate bounds (§1.4, §1.6) |
| Identity `Widen` impls | Decided: included, forced by the constant pattern (§2.2) |
| Unused impl parameters | Decided: an error (§1.3) |
| Where built-in traits live | Decided: the prelude (§1.11) |
| Which user `Widen` impls are possible | Decided orphan rule (§1.5) |
