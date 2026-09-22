The player's audio lives here. `content/shared.json` decides what is in it:
`tracks` is the library (an id and a path per file) and `playlists` picks
which of them each locale queues. Edit both from the admin's audio editor.

Only `.mp3` is committed — masters, stems and work files are gitignored and
stay local. `build.py --dist` copies this whole folder into `dist/`, so
anything committed here is on the deployed site.
