# Classical metadata editor

Open **Settings → Plugins → Aurral Classical → Pages → Open Classical metadata editor** as an admin. It needs the matching fork (admin pages v2) and the plugin's `page:editor` capability. Older fork builds with only admin forms v1 still get the previous editor.

Everything here changes the classical catalogue only. Audio files are never written.

## Layout

- **Tabs:** Works, Composers, Performers, Albums, Review (with a count of open items), Search and Activity.
- **Bulk:** the Works list, the Review list and an album's track sections have checkboxes. Tick rows (or **Select all**), then an action; destructive ones ask first and say how many are selected. Partial failures are reported without undoing what succeeded.
- **Left:** a searchable list for the current tab, 100 at a time, with the pager above and below it. Search covers titles, composers, performers, album titles and track titles, ignoring accents and punctuation. Opening an entry from a link, or reloading the page, shows the list page that holds it.
- **Pages stay put.** Saving, assigning, ticking and other actions keep you where you are on the page; when an action opens the next step further down (choosing a work, a merge's new movements), the page scrolls to it. Long sections (a composer's works, a work's movements or recordings, an album's tracks) page 100 at a time, and the page is part of the address, so a reload or an edit stays on it. A track's breadcrumb leads back to the album page it is on.
- **Right:** the open item. The breadcrumb leads back up (for example work → composer); on a phone it is also the way back to the list.
- Each item shows its details as one form with a single **Save**. Leaving or reloading with unsaved edits asks first. Saving another form or running an action also asks before discarding edits elsewhere: choose **Keep editing** to save or discard those edits first. A failed action keeps your drafts.

## Common tasks

**Group an album.** Albums tab → open the album. The album shows its works, then one **Tracks** list, 100 tracks per page. Each row shows its current work or **Not in a work**. Select tracks on the current page, then **Group selected tracks**. The selected-item actions stay visible as you scroll.
- **Choose a work:** search for an existing work or use a suggested one; choose **Create a new work** to enter a title and composer instead. Only this task's form is shown. **Choose a different work** keeps your selected tracks; **Cancel grouping** returns to the album without changing assignments.
- **Map and apply:** only selected tracks appear, in album order. Check each suggested movement, choose **New movement**, or **Skip**. Not classical tracks start as Skip. New works get one movement per included track. Nothing is assigned until **Assign tracks**, **Move tracks**, or **Create and assign** is pressed. Tracks already in another work move atomically when included; Skip leaves them where they are. The album returns to the same page.
- **Other track actions:** selected rows can be sent to Classical, removed from Classical, or removed from their work. **Send all** / **Remove all** act on the album; **Preview tag removal** reads the files without changing them.
- **When grouping changes.** Moves, assigns and unassigns change the catalogue at once; the album's **By work** view and work pages show it the next time they load (the editor refreshes them after each change). Editing a file's tags does not move a track that is already in a work: scans keep tracks where you or matching put them. Move it here instead.
- **Unassign** (under *Works on this album*) removes the album's tracks from a work without touching the work or the audio. It removes the per-track recordings too, and clears any pick of that album's recording. Rescans won't put the album back into that work; assign it again by hand to rematch.

**Send to / Remove from Classical.** On an album or a track. These manual choices beat automatic detection and survive rescans. On a track, **Use automatic detection** returns it to the detector.

**Edit a work.** Open a work and choose **Details**, **Movements**, **Credits**, **Recordings** or **Advanced**. Only the current section is shown, and reloads keep that section. Details opens first; edit its fields and press Save. Edited fields are pinned so provider refreshes never overwrite them.
- Each field shows where its value came from: MusicBrainz, From file tags, Edited, or Intentionally blank. A pinned field whose provider value differs shows that value.
- Next to a field: **Use MusicBrainz value** unpins it, **Remove pin** recomputes it, and **Mark blank** stores a deliberate blank.
- **Movements:** Move up/down or Delete (only when no track uses it). **Add movements** opens a separate form; enter one title per line. Saving returns to the page containing the new movements.
- **Credits:** choose **Add a credit**, then a person or ensemble, role and optional instrument; the person search is its own box. Saving returns to Credits.
- **Recordings** lists owned performances with movement coverage. **Add a broadcast recording** opens a form for radio or concert recordings that are not on an album; saving opens the new recording.
- **Advanced:** open **Merge with another work**, or **Delete work**. The merge form and add forms stay closed until requested. **Cancel** returns to their section; leaving a changed form asks before discarding its draft.

**Delete works.** Open a work → **Advanced** → **Delete work**, or select several from the Works list. The confirmation says how many movements, recordings and tracks are involved. The tracks stay in your library (they just leave the work) and audio files are never touched. Matching won't make a deleted work again on its own: an album that would gets a review item, **Allow this work again** or leave it.

**Edit together.** Tick works in the list → **Edit together**: period, form, key, instrumentation, or add a composer to all of them (empty fields are left alone), or **Use provider values** to unpin what you set by hand.

**Undo.** Merges and deletions appear in **Activity**; open one and **Undo**. Undo is refused when those entries changed afterwards, so it never discards a later edit.

**Duplicates.** On a work, composer or performer, **Merge with another …**: choose the other entry and **which one stays** (merge this one into the other, or the other into this one). Recordings, credits, favourites, picks and MusicBrainz/tag identities move into the entry that stays; the other is removed. A user who liked either work keeps the like; where both works had a pick, the kept work's pick wins. Movements are matched by title (or number, where one is untitled); a movement the staying work doesn't have is added to it, at the end, with its tracks, and the work opens at its Movements so you can put it in order. An unused entry can be deleted.

**Review.** The Review tab lists what needs a decision, with the action that settles it. Settle the item on screen and the next one opens; **Skip** moves on without settling. An entry under review shows its own edit form, so most fixes happen without leaving the queue. Tick several to settle them together.
- unsure classifications: **Send to Classical** / **Not classical**;
- albums whose tracks didn't line up with a work, or that several works or composers could fit: **Open album** and an **Open** link per candidate. Assigning the album resolves the item;
- albums whose composer appears only in the artist field ("Composer; Performers") with nothing else naming them: **Open album**, then create or assign the work. Nothing is created automatically for these;
- possible duplicate works ("Possible duplicate of “…”" and why): both side by side, field by field with differences marked, and what a merge would do either way round (kept fields, how movements map, which are added). **Merge into the other**, **Merge the other into this**, **Keep both** (remembered: matching won't merge them or ask again), or Dismiss;
- a MusicBrainz match held back: either "already linked to “…”" (another entry has that MusicBrainz work) or "only N% sure" (links need 95%). The page shows the MusicBrainz link, the certainty, what matched, the entry that has the link (with its composers and recordings, and both works side by side) and what to do: **Merge** either way round when they are the same piece, **Link here instead** when this entry is the right one (the other loses the link), **Link to this MusicBrainz work** for an unsure match, or Dismiss to leave it unlinked;
- composers who share a name: **Same person: merge into …**;
- MusicBrainz and Open Opus disagreeing on a field: one **use … value** action per value, for every conflicting field. The value you choose is pinned;
- a moved file that could match more than one new file: **Link to …** the right file. It keeps its works and picks.

Dismiss items you've checked.

**Creating a work that already exists.** The choose-work step offers **Suggested works** with **Use this work**. Creating a matching title or catalogue number (and composer) still requires **Create anyway**.

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
