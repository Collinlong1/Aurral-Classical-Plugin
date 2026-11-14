# Classical metadata editor

Open **Settings → Plugins → Aurral Classical → Pages → Open Classical metadata editor** as an admin. It needs the matching fork (admin pages v2) and the plugin's `page:editor` capability. Older fork builds with only admin forms v1 still get the previous editor.

Everything here changes the classical catalogue only. Audio files are never written.

## Layout

- **Tabs:** Works, Composers, Performers, Albums, Review (with a count of open items), Search and Activity.
- **Bulk:** the Works list, the Review list and an album's track sections have checkboxes. Tick rows (or **Select all**), then an action; destructive ones ask first and say how many are selected. Partial failures are reported without undoing what succeeded.
- **Left:** a searchable list for the current tab. Search covers titles, composers, performers, album titles and track titles, ignoring accents and punctuation.
- **Right:** the open item. The breadcrumb leads back up (for example work → composer); on a phone it is also the way back to the list.
- Each item shows its details as one form with a single **Save**. Leaving with unsaved edits asks first.

## Common tasks

**Group an album.** Albums tab → open the album. It shows the works on the album (with how many movements are missing), then its tracks 100 at a time in **Not in a work** and **In a work**; the pager under them moves through a large box set. Tick tracks to **Send to Classical**, **Remove from Classical** or **Remove from work**; **Send all** / **Remove all** act on the whole album. The forms below work on the unmatched tracks of the page you are on; **Preview tag removal** reads the files and says what clearing tags would remove, changing nothing.
- **Create a work from this album** creates the work with one movement per track you keep, in album order, and assigns them. Choose **Skip** for tracks that aren't part of the work; tracks marked Not classical start as Skip and stay Not classical. The title and composer are suggested from tags.
- **Assign to an existing work:** search for the work, press Continue, check each track's suggested movement (or Skip), then **Assign tracks**. Tracks you assign are sent to Classical.
- **Unassign** (under *Works on this album*) removes the album's tracks from a work without touching the work or the audio. It removes the per-track recordings too, and clears any pick of that album's recording. Rescans won't put the album back into that work; assign it again by hand to rematch.

**Send to / Remove from Classical.** On an album or a track. These manual choices beat automatic detection and survive rescans. On a track, **Use automatic detection** returns it to the detector.

**Edit a work.** Edit any details and press Save; edited fields are pinned so provider refreshes never overwrite them.
- Each field shows where its value came from: MusicBrainz, From file tags, Edited, or Intentionally blank. A pinned field whose provider value differs shows that value.
- Next to a field: **Use MusicBrainz value** unpins it, **Remove pin** recomputes it, and **Mark blank** stores a deliberate blank.
- **Movements:** Move up/down, Delete (only when no track uses it), and add several at once, one per line.
- **Credits:** add a person or ensemble with a role and optional instrument; the person search is its own box.
- **Recordings** lists every owned performance with movement coverage.
- **Add a broadcast recording** covers radio or concert recordings that aren't on an album.

**Delete works.** On a work, or several from the Works list. The confirmation says how many movements, recordings and tracks are involved. The tracks stay in your library (they just leave the work) and audio files are never touched. Matching won't make a deleted work again on its own: an album that would gets a review item, **Allow this work again** or leave it.

**Edit together.** Tick works in the list → **Edit together**: period, form, key, instrumentation, or add a composer to all of them (empty fields are left alone), or **Use provider values** to unpin what you set by hand.

**Undo.** Merges and deletions appear in **Activity**; open one and **Undo**. Undo is refused when those entries changed afterwards, so it never discards a later edit.

**Duplicates.** On a work, composer or performer, **Merge with another …** moves recordings, credits, favourites, picks and MusicBrainz/tag identities into the entry you keep, then removes this one. A user who liked either work keeps the like; where both works had a pick, the kept work's pick wins. Works merge when their movements line up by title or number. An unused entry can be deleted.

**Review.** The Review tab lists what needs a decision, with the action that settles it. Settle the item on screen and the next one opens; **Skip** moves on without settling. An entry under review shows its own edit form, so most fixes happen without leaving the queue. Tick several to settle them together.
- unsure classifications: **Send to Classical** / **Not classical**;
- albums whose tracks didn't line up with a work, or that several works or composers could fit: **Open album** and an **Open** link per candidate. Assigning the album resolves the item;
- albums whose composer appears only in the artist field ("Composer; Performers") with nothing else naming them: **Open album**, then create or assign the work. Nothing is created automatically for these;
- possible duplicate works: both side by side, field by field with differences marked, and what a merge would keep and how the movements map. **Merge into the other**, **Keep both** (remembered: matching won't merge them or ask again), or Dismiss;
- composers who share a name: **Same person: merge into …**;
- MusicBrainz and Open Opus disagreeing on a field: one **use … value** action per value, for every conflicting field. The value you choose is pinned;
- a moved file that could match more than one new file: **Link to …** the right file. It keeps its works and picks.

Dismiss items you've checked.

**Creating a work that already exists.** If a work with the same title or catalogue number (and composer) is already in the catalogue, the album page lists it under *This work may already exist* with **Assign here**. Creating it anyway asks you to tick **Create anyway**.

**Credits.** Roles: composer, soloist, performer, conductor, orchestra, ensemble, choir, arranger and lyricist. Orchestra, ensemble and choir need an ensemble; the others except performer need a person.

**Two tabs.** If the entry or album changed since you opened it (in another tab, by another admin, or by a scan that changed it), saving asks you to reload instead of overwriting the newer edit. A page also can't be used to change a different entry than the one it shows.

## Scans

Scans run on their own when the plugin schedule and API access are on: after downloads, and every 6 hours. Admins can also start one from **Activity → Maintenance**. Opening the editor never starts a scan, identification or download.

## Activity

- **Maintenance** (pinned first): the model's state, **Scan the library** (or Continue / Cancel), and the one-time lookups **Identify earlier albums** and **Work names from MusicBrainz**. They run on the model worker in the background and continue on the plugin schedule; reload to see progress. These used to be album-menu actions.
- **Merges and deletions**, each with **Undo**.
- **slskd searches**: each step of the query ladder, the candidates with their scores and reasons, and the folders rejected with theirs.

## Search

The Search tab searches works, movements, recordings, composers, performers and albums by titles, nicknames, other names, catalogue numbers in any spelling and performers. On the fork, everyone gets the same results on Aurral's own search page. See `SEARCH.md`.
