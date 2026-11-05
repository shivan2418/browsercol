# The map generator's import file reaches the Engine as bytes with the start request

FreeCol's map generator option "import file" names a file on disk, and FreeColServer reads its map when the game starts. The server Engine runs in a browser Worker with no file system of the player's, so it cannot read a path. The start screen lets the player pick a file (a map file, .fsm, or a savegame, .fsg) and sends its bytes to the Engine in the same request that starts the game: the page reads the file, the Worker passes the bytes to `startGame` beside the preset JSON, and the Engine writes them to its in-memory file system, as it does to load a savegame, and sets the option's value to that file. FreeCol's own map generator then reads it unchanged. The Engine reads the file once when the game starts, so a file that holds no map fails the start with a message instead of FreeCol's silent fallback to a generated map.

## Considered Options

- Put the bytes in the preset JSON (base64): rejected, it grows the JSON a third and copies the file through a string, where the Worker already takes a savegame as an `Int8Array`.
- Store the file in the save store and name it, as a load does: rejected, a map file is used once and is not a save; the player would have to clean it out of the list.
- A separate "import" request before the start: rejected, the Engine would hold a file between two requests, and a start that fails would leave it behind.
- Make `importFile` a preset option holding a path: rejected, there is no path the Engine can read, and the file's bytes cannot live in an option's value (an option's value is also saved as a default for later games).

## Consequences

- `startGame` in the server Engine and the Worker takes the file's bytes, empty for none. A new game that names no file generates its map as before: each start loads a fresh specification, so the last game's import file is not remembered.
- The start screen keeps the picked file apart from the map options the player changed, and does not save it as a default.
- The option editor has a `file` kind. In game it shows the file's name read-only.
- The file is read twice for a start with an import: once to check it, once by the map generator. A large map file starts slower.
