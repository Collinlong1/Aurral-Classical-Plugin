# Classical metadata editor

Open **Settings → Plugins → Aurral Classical → Pages → Open Classical metadata editor** as an admin. It needs the matching fork (admin pages v2) and the plugin's `page:editor` capability. Older fork builds with only admin forms v1 still get the previous editor.

Everything here changes the classical catalogue only. Audio files change only when you write classical tags from a preview and confirm it (below), with **Write classical tags to files** on in the plugin's settings.

## Layout

- **Tabs:** Works, Composers, Performers, Albums, Review (with a count of open items), Search and Activity.
- **Bulk:** the Works list, the Review list and an album's track sections have checkboxes. Tick rows (or **Select all**), then an action; destructive ones ask first and say how many are selected. Partial failures are reported without undoing what succeeded.
- **Left:** a searchable list for the current tab, 100 at a time, with the pager above and below it. Type, then press **Enter** or **Search** to apply the search. The hint distinguishes unapplied text from the applied search and shows its result count; **Clear search** restores the full list. Search covers titles, composers, performers, album titles and track titles, ignoring accents and punctuation. Opening an entry from a link, or reloading the page, shows the list page that holds it. Each tab remembers where you left its list (search, page and scroll) for the browser session: after following links to a composer, a movement or another entry, the tab button or the **‹** breadcrumb back to the list brings you back to that place, even after a reload. The browser's Back button also returns to each earlier list.
- **Pages stay put.** Saving, assigning, ticking and other actions keep you where you are on the page; when an action opens the next step further down (choosing a work, a merge's new movements), the page scrolls to it. Long sections (a composer's works, a work's movements or recordings, an album's tracks) page 100 at a time, and the page is part of the address, so a reload or an edit stays on it. A track's breadcrumb leads back to the album page it is on.
- **Right:** the open item. The breadcrumb leads back up (for example work → composer); on a phone it is also the way back to the list.
- Each item shows its details as one form with a single **Save**. Leaving or reloading with unsaved edits asks first. Saving another form or running an action also asks before discarding edits elsewhere: choose **Keep editing** to save or discard those edits first. A failed action keeps your drafts.
- Every form ends with its own footer: **Save** (or the form's own button), **Cancel** where the form has somewhere to return to, and **Discard changes** with a count of your unsaved changes ("2 unsaved changes") once you edit. On a long form the footer stays at the bottom of the screen, and a field you Tab to stops above it. While a save is running the button says **Saving…** and can't be pressed twice. A save refused because of one field (a date in the wrong form, a missing title) explains why under that field, marks it and puts the cursor there; your edits stay. Other results and errors appear next to what you did: in the form's footer, in the list or section where you ran an action, or in the section the result opens (for example Movements after adding movements).

## Lookup fields

Lookup fields (work, composer, person or owned track) search automatically as you type. Use **↑/↓** to move through results, **Home/End** for first/last, and **Enter** to choose without saving the form. **Escape** closes the results and keeps the previous choice; **Tab** leaves the field without choosing. Click/tap a result to choose it, or use the clear button to remove the choice.

Searching, no matches and lookup failures are separate states. **Try again** retries a failed query; it can also be reached with Tab, or press Enter in the failed lookup. Changing the query hides the old options while the new results load.

## Common tasks

**Group an album.** Albums tab → open the album. The album shows its works, then one **Tracks** list, 100 tracks per page. Each row shows its current work or **Not in a work**. Select tracks on the current page, then **Group selected tracks**. The selected-item actions stay visible as you scroll.
- **Choose a work:** search for an existing work or use a suggested one; choose **Create a new work** to enter a title and composer instead. Only this task's form is shown. **Choose a different work** keeps your selected tracks; **Cancel grouping**, beside the form's button, returns to the album without changing assignments.
- **Map and apply:** only selected tracks appear, in album order. Check each suggested movement, choose **New movement**, or **Skip**. Not classical tracks start as Skip. New works get one movement per included track. Nothing is assigned until **Assign tracks**, **Move tracks**, or **Create and assign** is pressed. Tracks already in another work move atomically when included; Skip leaves them where they are. The album returns to the same page.
- **Other track actions:** selected rows can be sent to Classical, removed from Classical, or removed from their work. **Send all** / **Remove all** act on the album; **Preview tag removal** reads the files without changing them.
- **When grouping changes.** Moves, assigns and unassigns change the catalogue at once; the album's **By work** view and work pages show it the next time they load (the editor refreshes them after each change). Editing a file's tags does not move a track that is already in a work: scans keep tracks where you or matching put them. Move it here instead.
- **Unassign** (under *Works on this album*) removes the album's tracks from a work without touching the work or the audio. It removes the per-track recordings too, and clears any pick of that album's recording. Rescans won't put the album back into that work; assign it again by hand to rematch.

**Send to / Remove from Classical.** On an album or a track. These manual choices beat automatic detection and survive rescans. On a track, **Use automatic detection** returns it to the detector.

**Edit a work.** Open a work and choose **Details**, **Movements**, **Credits**, **Recordings** or **Advanced**. Only the current section is shown, and reloads keep that section. Details opens first; edit its fields and press Save. Edited fields are pinned so provider refreshes never overwrite them.
- Each field shows where its value came from: MusicBrainz, From file tags, Edited, or Intentionally blank. A pinned field whose provider value differs shows that value.
- Next to a field: **Use MusicBrainz value** unpins it, **Remove pin** recomputes it, and **Mark blank** stores a deliberate blank.
- **Movements:** Delete (only when no track uses it). **Add movements** opens a separate form; enter one title per line. Saving returns to the page containing the new movements. **Reorder movements** opens the whole list: drag a movement by its handle, use its ↑/↓ buttons, or with the keyboard press Space on the handle, move with the arrow keys and press Space to drop. Nothing is saved until **Save order**; **Discard changes** or **Cancel** leaves the order as it was. (On an older Aurral without this list, each movement gets a position menu instead; a work with more than 500 movements keeps Move up/down per movement.)
- **Credits:** choose **Add a credit**, then a person or ensemble, role and optional instrument; the person search is its own box. Saving returns to Credits.
- **Recordings** lists owned performances with movement coverage. **Add a broadcast recording** opens a form for radio or concert recordings that are not on an album; saving opens the new recording.
- **Advanced:** open **Merge with another work**, or **Delete work**. The merge form and add forms stay closed until requested. **Cancel**, beside the form's button, returns to their section; **Cancel** on a new work, composer or performer, or on Edit together, returns to the list; leaving a changed form asks before discarding its draft.

**Delete works.** Open a work → **Advanced** → **Delete work**, or select several from the Works list. The confirmation says how many movements, recordings and tracks are involved. The tracks stay in your library (they just leave the work) and audio files are never touched. Matching won't make a deleted work again on its own: an album that would gets a review item, **Allow this work again** or leave it.

**Edit together.** Tick works in the list → **Edit together**: period, form, key, instrumentation, or add a composer to all of them (empty fields are left alone), or **Use provider values** to unpin what you set by hand.

**Undo.** Merges and deletions appear in **Activity**; open one and **Undo**. Undo is refused when those entries changed afterwards, so it never discards a later edit.

**Duplicates.** On a work, composer or performer, **Merge with another …**: choose the other entry and **Continue**. The merge step names both ("the one you opened" and "the other", with their recordings or credits), shows what happens if either stays, and the two works side by side. Choose the **Entry that stays**, then **Merge**; **Cancel** goes back without merging. Recordings, credits, favourites, picks and MusicBrainz/tag identities move into the entry that stays; the other is removed. A user who liked either work keeps the like; where both works had a pick, the kept work's pick wins. Movements are matched by title (or number, where one is untitled); a movement the staying work doesn't have is added to it, at the end, with its tracks, and the work opens at its Movements so you can put it in order with **Reorder movements**. An unused entry can be deleted.

**Review.** The Review tab lists what needs a decision, with the action that settles it. Settle the item on screen and the next one opens; **Skip** moves on without settling. An entry under review shows its own edit form, so most fixes happen without leaving the queue. Tick several to settle them together.
- unsure classifications: **Send to Classical** / **Not classical**;
- albums whose tracks didn't line up with a work: **Decide** offers **Map these tracks**, which opens the album's grouping step for exactly those tracks. Assigning them resolves the item;
- albums that several works of one title could fit: **Decide** lists each with its composer, number of recordings and first album, so identical titles can be told apart; **Use this work** opens the grouping step with it;
- albums whose composer appears only in the artist field ("Composer; Performers") with nothing else naming them: **Decide** asks **Yes, the composer is …** (the work is made from those tracks, as matching would have) or **No** (nothing is made);
- a composer or performer named on a track whose name several people share: **Use this record** credits the right one. Matching never makes another person of that name;
- an item you dismissed or decided isn't raised again by later scans while its tracks are the same; a changed track list asks again;
- possible duplicate works ("Possible duplicate of “…”" and why): the question and both entries first, then **Decide**: **Merge…** (the merge step above: see both outcomes and choose the work that stays), **Keep separate** (remembered: matching won't merge them or ask again) or **Skip**; both works side by side, field by field with differences marked, follow;
- a MusicBrainz match held back: either "already linked to “…”" (another entry has that MusicBrainz work) or "only N% sure" (links need 95%). The page shows the MusicBrainz link, the certainty, what matched, the entry that has the link (with its composers and recordings, and both works side by side) and **Decide**: **Merge…** when they are the same piece (choose the one that stays in the merge step), **Link the record here instead** when this entry is the right one (the other loses the link), **Keep separate** to leave both as they are, or **Skip**. An unsure match offers **Link to this MusicBrainz work** or Dismiss;
- composers who share a name: **Decide** offers **Merge…** with each same-named person (choose who stays in the merge step), **Keep separate** or **Skip**;
- MusicBrainz and Open Opus disagreeing on a field: one **use … value** action per value, for every conflicting field. The value you choose is pinned;
- a moved file that could match more than one new file: **Link to …** the right file. It keeps its works and picks.

Dismiss items you've checked.

**Creating a work that already exists.** The choose-work step offers **Suggested works** with **Use this work**. Creating a matching title or catalogue number (and composer) still requires **Create anyway**.

**Where movements start.** A track holding several movements of one recording (an attacca, or an album that gave them one track) shows **Where each movement starts** on its track page. Enter each later movement's start as m:ss, h:mm:ss or seconds; the first starts at 0:00 and the last runs to the end of the file. Each movement then plays only its part, on the album page and in comparisons. The file isn't changed.

**Write classical tags.** **Preview classical tags** (on an album, ticked tracks, a work's Recordings or a track) reads each file and lists what it holds and what the catalogue proposes, field by field: composer and sort name, work, movement name, number and total, performers, conductor, catalogue number and MusicBrainz work. Titles, albums and album artists are never proposed. MP3 files take no movement or performer tags; other formats are listed as not supported yet. Nothing is written until **Write N files**, which asks first and needs **Write classical tags to files** on. Each file is read again and left alone if it changed since the preview, its old values are kept, and its audio must not change. The run's page lists every file's result; **Restore this file** or **Restore all** puts the old values back while the file still holds what was written. A track's page lists its tag writes.

**Tag requests.** The album and artist menu actions **Tag as classical**, **Restore original tags** and **Clear classical tags** no longer write when chosen: they work out what they would write and leave a request under **Activity → Tag requests**. Open it to see each file's change, then **Write N files** or **Discard**. Files changed since the request are left alone.

**Credits.** Roles: composer, soloist, performer, conductor, orchestra, ensemble, choir, arranger and lyricist. Orchestra, ensemble and choir need an ensemble; the others except performer need a person.

**Two tabs.** If the entry or album changed since you opened it (in another tab, by another admin, or by a scan that changed it), saving asks you to reload instead of overwriting the newer edit. A page also can't be used to change a different entry than the one it shows.

## Scans

Scans run on their own when the plugin schedule and API access are on: after downloads, and every 6 hours. Admins can also start one from **Activity → Maintenance**. Opening the editor never starts a scan, identification or download.

## Activity

- **Maintenance** (pinned first): the model's state, **Scan the library** (or Continue / Cancel), and the lookups **Identify earlier albums**, **Work names from MusicBrainz** and **Details from MusicBrainz** (sort names, dates and other names for everyone and every work with a MusicBrainz ID; your own values stay). They run on the model worker in the background and continue on the plugin schedule; reload to see progress. These used to be album-menu actions.
- **Tag requests** waiting for you (from the album and artist menus), first.
- **Merges and deletions**, each with **Undo**.
- **slskd searches**: each step of the query ladder, the candidates with their scores and reasons, and the folders rejected with theirs.

## Search

The Search tab searches works, movements, recordings, composers, performers and albums by titles, nicknames, other names, catalogue numbers in any spelling and performers. On the fork, everyone gets the same results on Aurral's own search page. See `SEARCH.md`.
