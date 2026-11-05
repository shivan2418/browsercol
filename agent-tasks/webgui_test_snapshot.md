Issue #95: `WebGUITest.theViewFollowsTheActiveUnitAndTheFocus` fails now and
then with `java.util.ConcurrentModificationException` from
`ArrayList$ArrayListSpliterator.forEachRemaining`. There is no gh in the
sandbox, so this brief is the spec.

Cause: `shown` (engine/src/test/java/browsercol/web/WebGUITest.java
line 69) is a `Collections.synchronizedList`, which the client thread
appends to (`show`, ~line 114). A synchronized list's `stream()` and
iterator are not covered by its lock, so the test's `shown.stream()...`
calls (14 of them, e.g. lines 167, 178, 192, 208, 545, 700, 760) race the
client thread. Copying the list (`new ArrayList<>(shown)`) is safe, since
the wrapper's `toArray` takes the lock; `messageEvents()` (~line 246)
already does that.

Where: only WebGUITest.java.
- Add a small helper, e.g. `private List<String> shown()` returning
  `new ArrayList<>(shown)` with a one-line comment on why.
- Replace every `shown.stream()` with `shown().stream()`. The two places
  already inside `synchronized (shown) { ... }` (~lines 847, 964) may
  switch too, dropping the `synchronized` block, or stay; your choice,
  but be consistent.
- `asked` (line 70) and `held` (line 75) are synchronized lists too:
  grep for any `stream()`, `forEach` or for-each loop over them and give
  them the same treatment if there are any.

Done when:
- `grep -n "shown.stream()" engine/src/test/java/browsercol/web/WebGUITest.java`
  prints nothing.
- No assertion is changed, loosened or removed; only how the list is read.
- `./dev.sh -C engine gradle test --tests browsercol.web.WebGUITest`
  passes 3 times in a row (add `--rerun`); say the times it printed.
- One commit: `WebGUITest: read the shown events from a copy, not the live list (#95)`.

Traps: this is a test-only fix; do not touch WebGUI or other Engine code,
and don't read FreeCol sources, nothing here needs them. #97 (a timeout in
`theOptionEntriesShowTheGamesOptionGroups`) is a different flake and out
of scope.
