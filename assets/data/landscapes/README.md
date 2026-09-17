# Static maps

`<id>.json` files here are static maps: a sculpted board relief, mountain ring,
surface paint and plants, used instead of the procedural terrain.

- Make one in the landscape editor: open a match with `?editor=true`
  (add `&landscape=<id>` to edit an existing map), sculpt, then **Save** —
  it downloads `<id>.json`; put it in this folder.
- Play one with `?landscape=<id>`, or pick it under **Map** in the Custom Game /
  Practice lobby settings (the field shows once this folder has a map).
- A map is made for one board size; a board it doesn't fit (a 2v2 board is
  wider) plays the procedural terrain.
- This folder is part of the multiplayer content hash: everyone in a room has
  the same maps, and the match settings name the one played.
