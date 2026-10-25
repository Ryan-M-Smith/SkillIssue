# Music

The `Music` autoload (`scripts/music.gd`) plays these files and crossfades between them:

| File | Plays on |
|---|---|
| `menu.ogg` | main menu and lobby |
| `match.ogg` | during a match |
| `results.ogg` | results screen (optional: without it the menu track plays) |

Drop a file in with that name and it's picked up. No code changes needed. `.ogg` is best,
since it's small and loops cleanly. For `.mp3` or `.wav`, change the path in `TRACKS` in
`scripts/music.gd`. Music loops automatically, whatever the import settings say.

Volume: the Music bus (Audio tab at the bottom of the editor), and the Music Volume slider
in Settings.

**Credit the artist.** Most free tracks are CC BY and need credit. List each one in
`CREDITS.md` next to this file: title, artist, link, license.
