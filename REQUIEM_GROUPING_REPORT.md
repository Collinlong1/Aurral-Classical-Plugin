# Requiem grouping investigation

Album: **The History of Classical Music, Part 2: Classical to Early Romantic: From Haydn to Paganini**.

The screenshot's repeated **Requiem in D minor, K 626** headings are explained by two grouping rules in the plugin. This investigation uses the source at `1019fd5` plus the review fixes, and synthetic track metadata reproducing the screenshot's titles and credits. It does not inspect the user's live database or fetch provider data.

| Tracks | Composer credits shown |
| --- | --- |
| Introitus, Kyrie | Mozart, Süßmayr |
| Dies irae, Tuba mirum, Rex tremendae, Recordare | Mozart, Eybler |
| Confutatis | Mozart, Eybler, Süßmayr |
| Lacrimosa | Mozart, Süßmayr, Eybler |

## Findings

1. **Display grouping compares the composer string in order.** `pieceGroups` joins adjacent pieces only when both their work headings and their displayed composer strings agree. Confutatis and Lacrimosa have the same three names in different orders, so they become separate blocks. The reproduction yields exactly four display groups, with `workId: null` for each. Repeated headings in this screenshot therefore do not by themselves establish four stored work entities.
2. **Auto-match uses the complete composer-name set as work identity.** Candidate grouping and `workKey` sort the names, which removes the order difference, but Mozart/Süßmayr, Mozart/Eybler and Mozart/Eybler/Süßmayr are still three different identities despite the shared K 626 title. Running the real matcher on the reproduction creates three catalogue works, grouping the eight tracks as 2 + 4 + 2. This is distinct from accidental merging of differently verified works: the identity-preservation fix deliberately does not loosen names to merge them.
3. **Movement-specific completion credits need a different role from canonical work identity.** These credit changes can describe contributors to sections of one work. Names and a shared catalogue number alone cannot establish the intended completion/edition, and the screenshot supplies no verified parent-work IDs.

## Recommended correction

Resolve a shared canonical parent-work identity when provider evidence supports it, retaining completion/arrangement and movement-level credits on their appropriate assertions or recordings. For display-only grouping, compare normalized contributor sets rather than their display order. Do not discard the extra names, assume the first name is always the primary composer, or automatically merge every same-titled work: those shortcuts would undermine the distinct-identity protection fixed in this review.

This grouping rule has been investigated and reported, not changed in the three-bug fix. Existing mistaken splits or merges require a reviewed catalogue repair; the screenshots and synthetic reproduction are insufficient to safely rewrite the live catalogue.
