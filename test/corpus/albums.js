// A library of classical albums to test the whole pipeline against: tags as
// a scan reads them, what MusicBrainz would answer, and what the album page
// should show. Albums are modelled on real releases, but every value here is
// written by hand. `npm run corpus` prints each album as the page shows it,
// and `npm run corpus -- --audio <folder>` writes silent FLAC files with
// these tags and lengths for a real Aurral.
//
// expect.groups lists the works in album order with their rows; tracks not in
// any group stay single pieces. expect: null means no work view at all.

const min = (m, s) => (m * 60 + s) * 1000;

// One album: shared tags, then [disc, number, title, length, extra tags].
function album(id, { title, artist, genre = "Classical", composer, tracks, ...rest }) {
  return {
    id,
    title,
    artist,
    tracks: tracks.map(([disc, number, trackTitle, durationMs, extra = {}]) => ({
      disc,
      number,
      title: trackTitle,
      durationMs,
      artist: extra.artist ?? artist,
      composer: extra.composer ?? (composer ? [composer] : []),
      genres: extra.genres ?? (genre ? [genre] : []),
      work: extra.work ?? "",
      grouping: extra.grouping ?? "",
      workId: extra.workId ?? "",
      recordingMbid: extra.recordingMbid ?? "",
    })),
    ...rest,
  };
}

const levitArtist = "Ludwig van Beethoven — Igor Levit";
const les = "Piano Sonata no. 26 in E-flat major, op. 81A “Les Adieux”";
const op90 = "Piano Sonata no. 27 in E minor, op. 90";
const op101 = "Piano Sonata no. 28 in A major, op. 101";
const hammer = "Piano Sonata no. 29 in B flat major “Hammerklavier”, op. 106";

// Picard-style tags from a well-entered MusicBrainz release. Movement titles
// are the composer's own German markings, and MusicBrainz has no English
// names for them; No. 29's track titles use "; " before the movement.
export const levit = album("levit-beethoven-9", {
  title: "Beethoven: The Complete Piano Sonatas (Disc 9)",
  artist: levitArtist,
  composer: "Ludwig van Beethoven",
  kind: "box set disc, well tagged on MusicBrainz",
  tracks: [
    [9, 1, `${les}: I. Das Lebewohl. Adagio - Allegro`, min(6, 39), { work: `${les}: I. Das Lebewohl. Adagio - Allegro`, recordingMbid: "levit-26-1" }],
    [9, 2, `${les}: II. Abwesenheit. Andante espressivo. In gehender Bewegung, doch mit Ausdruck`, min(3, 28), { work: `${les}: II. Abwesenheit`, recordingMbid: "levit-26-2" }],
    [9, 3, `${les}: III. Das Wiedersehen. Vivacissimamente. Im lebhaftesten Zeitmaße - Poco Andante - Tempo I`, min(5, 18), { work: `${les}: III. Das Wiedersehen`, recordingMbid: "levit-26-3" }],
    [9, 4, `${op90}: I. Mit Lebhaftigkeit und durchaus mit Empfindung und Ausdruck`, min(5, 34), { work: `${op90}: I. Mit Lebhaftigkeit und durchaus mit Empfindung und Ausdruck`, recordingMbid: "levit-27-1" }],
    [9, 5, `${op90}: II. Nicht zu geschwind und sehr singbar vorgetragen`, min(7, 58), { work: `${op90}: II. Nicht zu geschwind und sehr singbar vorgetragen`, recordingMbid: "levit-27-2" }],
    [9, 6, `${op101}: I. Etwas lebhaft und mit der innigsten Empfindung. Allegretto ma non troppo`, min(4, 27), { work: `${op101}: I. Etwas lebhaft und mit der innigsten Empfindung`, recordingMbid: "levit-28-1" }],
    [9, 7, `${op101}: II. Lebhaft. Marschmäßig. Vivace alla marcia`, min(6, 7), { work: `${op101}: II. Lebhaft. Marschmäßig`, recordingMbid: "levit-28-2" }],
    [9, 8, `${op101}: III. Langsam und sehnsuchtsvoll. Adagio, ma non troppo, con affetto - Zeitmaß des ersten Stückes. Tempo del primo pezzo - Presto - attacca`, min(3, 28), { work: `${op101}: III. Langsam und sehnsuchtsvoll`, recordingMbid: "levit-28-3" }],
    [9, 9, `${op101}: IV. Geschwinde, doch nicht zu sehr, und mit Entschlossenheit. Allegro`, min(7, 17), { work: `${op101}: IV. Geschwinde, doch nicht zu sehr`, recordingMbid: "levit-28-4" }],
    [9, 10, `${hammer}; I. Allegro`, min(10, 18), { recordingMbid: "levit-29-1" }],
    [9, 11, `${hammer}; II. Scherzo. Assai vivace`, min(2, 34), { recordingMbid: "levit-29-2" }],
    [9, 12, `${hammer}; III. Adagio sostenuto. Appassionato e con molto sentimento`, min(16, 51), { recordingMbid: "levit-29-3" }],
    [9, 13, `${hammer}; IV. Largo - Allegro risoluto`, min(11, 52), { recordingMbid: "levit-29-4" }],
  ],
  musicbrainz: {
    recordings: {
      "levit-29-1": "mb-29-1",
      "levit-29-2": "mb-29-2",
      "levit-29-3": "mb-29-3",
      "levit-29-4": "mb-29-4",
    },
    works: {
      // MusicBrainz's own title for No. 29 reads differently from the tags.
      "mb-29": { title: "Sonata for Piano no. 29 in B-flat major, op. 106 \"Hammer-Klavier\"" },
      "mb-29-1": { title: "Piano Sonata no. 29 in B-flat major, op. 106 “Hammerklavier”: I. Allegro", parent: "mb-29" },
      "mb-29-2": { title: "Piano Sonata no. 29 in B-flat major, op. 106 “Hammerklavier”: II. Scherzo. Assai vivace", parent: "mb-29" },
      "mb-29-3": { title: "Piano Sonata no. 29 in B-flat major, op. 106 “Hammerklavier”: III. Adagio sostenuto", parent: "mb-29" },
      "mb-29-4": { title: "Piano Sonata no. 29 in B-flat major, op. 106 “Hammerklavier”: IV. Largo – Allegro risoluto", parent: "mb-29" },
    },
  },
  expect: {
    groups: [
      [les, ["I. Das Lebewohl. Adagio - Allegro", "II. Abwesenheit. Andante espressivo. In gehender Bewegung, doch mit Ausdruck", "III. Das Wiedersehen. Vivacissimamente. Im lebhaftesten Zeitmaße - Poco Andante - Tempo I"]],
      [op90, ["I. Mit Lebhaftigkeit und durchaus mit Empfindung und Ausdruck", "II. Nicht zu geschwind und sehr singbar vorgetragen"]],
      [op101, ["I. Etwas lebhaft und mit der innigsten Empfindung. Allegretto ma non troppo", "II. Lebhaft. Marschmäßig. Vivace alla marcia", "III. Langsam und sehnsuchtsvoll. Adagio, ma non troppo, con affetto - Zeitmaß des ersten Stückes. Tempo del primo pezzo - Presto - attacca", "IV. Geschwinde, doch nicht zu sehr, und mit Entschlossenheit. Allegro"]],
      [hammer, ["I. Allegro", "II. Scherzo. Assai vivace", "III. Adagio sostenuto. Appassionato e con molto sentimento", "IV. Largo - Allegro risoluto"]],
    ],
  },
});

const corelli = "Variations on a Theme of Corelli, op. 42";
const chopin = "Variations on a Theme of Chopin, op. 22";
// Poorly entered: no WORK tags, several variations share a track, a theme
// track with no number, a "Variation" typo and a mistyped XXII.
export const lugansky = album("lugansky-rachmaninoff", {
  title: "Rachmaninoff: Rhapsody on a Theme of Paganini, Variations on Themes of Corelli and Chopin",
  artist: "Sergei Rachmaninoff — Nikolai Lugansky",
  composer: "Sergei Rachmaninoff",
  kind: "poorly tagged: titles only, multi-variation tracks, typos",
  tracks: [
    [1, 1, "Rhapsody on a Theme of Paganini, op. 43 (arr. for piano)", min(22, 41)],
    [1, 2, `${corelli}: Theme: Andante`, min(1, 1)],
    [1, 3, `${corelli}: I. Poco più mosso / II. L'istesso tempo / III. Tempo di minuetto`, min(2, 12)],
    [1, 4, `${corelli}: IV. Andante / V. Allegro (ma non tanto) / VI. L'istesso tempo / VII. Vivace`, min(2, 25)],
    [1, 5, `${corelli}: VIII. Adagio misterioso / IX. Un poco più mosso / X. Allegro scherzando`, min(2, 36)],
    [1, 6, `${corelli}: XI. Allegro vivace / XII. L'istesso tempo / XIII. Agitato`, min(1, 41)],
    [1, 7, `${corelli}: Intermezzo: A tempo rubato`, min(1, 18)],
    [1, 8, `${corelli}: XIV. Andante (come prima) / XV. L'istesso tempo`, min(3, 2)],
    [1, 9, `${corelli}: XVI. Allegro vivace / XVII. Meno mosso`, min(2, 3)],
    [1, 10, `Variation on a Theme of Corelli, op. 42: XVIII. Più mosso - Agitato / XIX. Più mosso / XX. Più mosso / Coda: Andante`, min(2, 37)],
    [1, 11, `${chopin}: Theme: Largo`, min(1, 7)],
    [1, 12, `${chopin}: I. Moderato / II. L'istesso tempo / III. L'istesso tempo / IV. L'istesso tempo / V. Meno mosso / VI. Meno mosso`, min(4, 10)],
    [1, 13, `${chopin}: VII. Allegro / VIII. L'istesso tempo / IX. L'istesso tempo / X. Più vivo`, min(2, 14)],
    [1, 14, `${chopin}: XI. Lento`, min(1, 52)],
    [1, 15, `${chopin}: XII. Moderato`, min(1, 6)],
    [1, 16, `${chopin}: XIII. Largo`, min(1, 39)],
    [1, 17, `${chopin}: XIV. Moderato / XV. Allegro scherzando`, min(1, 35)],
    [1, 18, `${chopin}: XVI. Lento / XVII. Grave`, min(3, 13)],
    [1, 19, `${chopin}: XVIII. Più mosso`, min(0, 51)],
    [1, 20, `${chopin}: XIX. Allegro vivace`, min(1, 1)],
    [1, 21, `${chopin}: XX. Presto`, min(0, 46)],
    [1, 22, `${chopin}: XXI. Andante - Più vivo`, min(3, 21)],
    [1, 23, `${chopin}: XII. Maestoso - Meno mosso - Presto`, min(2, 50)],
  ],
  expect: {
    groups: [
      ["Rhapsody on a Theme of Paganini, op. 43 (arr. for piano)", ["Rhapsody on a Theme of Paganini, op. 43 (arr. for piano)"]],
      [corelli, ["Theme: Andante", "I. Poco più mosso / II. L'istesso tempo / III. Tempo di minuetto", "IV. Andante / V. Allegro (ma non tanto) / VI. L'istesso tempo / VII. Vivace", "VIII. Adagio misterioso / IX. Un poco più mosso / X. Allegro scherzando", "XI. Allegro vivace / XII. L'istesso tempo / XIII. Agitato", "Intermezzo: A tempo rubato", "XIV. Andante (come prima) / XV. L'istesso tempo", "XVI. Allegro vivace / XVII. Meno mosso", "XVIII. Più mosso - Agitato / XIX. Più mosso / XX. Più mosso / Coda: Andante"]],
      [chopin, ["Theme: Largo", "I. Moderato / II. L'istesso tempo / III. L'istesso tempo / IV. L'istesso tempo / V. Meno mosso / VI. Meno mosso", "VII. Allegro / VIII. L'istesso tempo / IX. L'istesso tempo / X. Più vivo", "XI. Lento", "XII. Moderato", "XIII. Largo", "XIV. Moderato / XV. Allegro scherzando", "XVI. Lento / XVII. Grave", "XVIII. Più mosso", "XIX. Allegro vivace", "XX. Presto", "XXI. Andante - Più vivo", "XII. Maestoso - Meno mosso - Presto"]],
    ],
  },
});

const scriabin3 = "Piano Sonata No. 3 in F-Sharp Minor, Op. 23";
const hunt = 'Piano Sonata No. 18 in E-Flat Major, Op. 31 No. 3 "The Hunt"';
const secs = (s) => s * 1000;
// A recital, with the real programme and store titles of Yuja Wang's
// "The Vienna Recital" (Deutsche Grammophon, 2024). Apple Music Classical
// shows every track under a composer and work, in album order: the two
// sonatas as works, single pieces headed by their set ("Iberia, B. 47",
// "Etudes, Book 1"), and Kapustin's two preludes sharing one block.
export const recital = album("wang-vienna-recital", {
  title: "The Vienna Recital",
  artist: "Yuja Wang",
  kind: "recital: real programme, single pieces, two sonatas, encores",
  tracks: [
    [1, 1, "Iberia, T. 105,  Book 4: No. 10, Málaga", secs(297), { composer: ["Isaac Albéniz"] }],
    [1, 2, `${scriabin3}: I. Drammatico`, secs(395), { composer: ["Alexander Scriabin"] }],
    [1, 3, `${scriabin3}: II. Allegretto`, secs(170), { composer: ["Alexander Scriabin"] }],
    [1, 4, `${scriabin3}: III. Andante`, secs(280), { composer: ["Alexander Scriabin"] }],
    [1, 5, `${scriabin3}: IV. Presto con fuoco`, secs(355), { composer: ["Alexander Scriabin"] }],
    [1, 6, "24 Jazz Preludes, Op. 53: No. 11", secs(161), { composer: ["Nikolai Kapustin"] }],
    [1, 7, "24 Jazz Preludes, Op. 53: No. 10", secs(110), { composer: ["Nikolai Kapustin"] }],
    [1, 8, "Iberia, T. 105, Book 3: No. 9, Lavapiés", secs(346), { composer: ["Isaac Albéniz"] }],
    [1, 9, `${hunt}: I. Allegro`, secs(377), { composer: ["Ludwig van Beethoven"] }],
    [1, 10, `${hunt}: II. Scherzo. Allegretto vivace`, secs(208), { composer: ["Ludwig van Beethoven"] }],
    [1, 11, `${hunt}: III. Minuet. Moderato e grazioso - Trio`, secs(182), { composer: ["Ludwig van Beethoven"] }],
    [1, 12, `${hunt}: IV. Presto con fuoco`, secs(226), { composer: ["Ludwig van Beethoven"] }],
    [1, 13, "Études, Book 1: No. 6, Automne à Varsovie", secs(292), { composer: ["György Ligeti"] }],
    [1, 14, "Études, Book 2: No. 13, L'escalier du diable", secs(301), { composer: ["György Ligeti"] }],
    [1, 15, "Études: No. 6", secs(167), { composer: ["Philip Glass"] }],
    [1, 16, "Danzón No. 2 (Transcr. for Piano by Gómez-Tagle)", secs(226), { composer: ["Arturo Márquez"] }],
    [1, 17, "3 Intermezzi, Op. 117: No. 3 in C-Sharp Minor. Andante con moto", secs(406), { composer: ["Johannes Brahms"] }],
    [1, 18, "Orfeo ed Euridice, Wq. 30: Melodie dell'Orfeo (Arr. for Piano by Sgambati)", secs(186), { composer: ["Christoph Willibald Gluck"] }],
  ],
  expect: {
    groups: [
      ["Iberia, T. 105, Book 4", ["No. 10, Málaga"]],
      [scriabin3, ["I. Drammatico", "II. Allegretto", "III. Andante", "IV. Presto con fuoco"]],
      ["24 Jazz Preludes, Op. 53", ["No. 11", "No. 10"]],
      ["Iberia, T. 105, Book 3", ["No. 9, Lavapiés"]],
      [hunt, ["I. Allegro", "II. Scherzo. Allegretto vivace", "III. Minuet. Moderato e grazioso - Trio", "IV. Presto con fuoco"]],
      ["Études, Book 1", ["No. 6, Automne à Varsovie"]],
      ["Études, Book 2", ["No. 13, L'escalier du diable"]],
      ["Études", ["No. 6"]],
      ["Danzón No. 2 (Transcr. for Piano by Gómez-Tagle)", ["Danzón No. 2 (Transcr. for Piano by Gómez-Tagle)"]],
      ["3 Intermezzi, Op. 117", ["No. 3 in C-Sharp Minor. Andante con moto"]],
      ["Orfeo ed Euridice, Wq. 30", ["Melodie dell'Orfeo (Arr. for Piano by Sgambati)"]],
    ],
  },
});

// The same recital as Picard tags it from MusicBrainz: lower-case "no.",
// "/" between levels, and MusicBrainz nesting each Iberia piece under its
// book and then "Iberia, B. 47". Tracks 1 and 8 are the same work, apart.
const scriabin3mb = "Piano Sonata no. 3 in F-sharp minor, op. 23";
const huntMb = "Piano Sonata no. 18 in E-flat major, op. 31 no. 3 “The Hunt”";
export const recitalPicard = album("wang-vienna-recital-picard", {
  title: "The Vienna Recital (MusicBrainz tags)",
  artist: "Yuja Wang",
  kind: "recital tagged by Picard: one work twice, apart",
  tracks: [
    [1, 1, "Iberia, T. 105 / Book 4: no. 10, Málaga", secs(296), { composer: ["Isaac Albéniz"], recordingMbid: "wang-malaga" }],
    [1, 2, `${scriabin3mb}: I. Drammatico`, secs(395), { composer: ["Alexander Scriabin"] }],
    [1, 3, `${scriabin3mb}: II. Allegretto`, secs(170), { composer: ["Alexander Scriabin"] }],
    [1, 4, `${scriabin3mb}: III. Andante`, secs(279), { composer: ["Alexander Scriabin"] }],
    [1, 5, `${scriabin3mb}: IV. Presto con fuoco`, secs(354), { composer: ["Alexander Scriabin"] }],
    [1, 6, "24 Jazz Preludes, op. 53: no. 11", secs(161), { composer: ["Nikolai Kapustin"] }],
    [1, 7, "24 Jazz Preludes, op. 53: no. 10", secs(109), { composer: ["Nikolai Kapustin"] }],
    [1, 8, "Iberia, T. 105 / Book 3: no. 9, Lavapiés", secs(346), { composer: ["Isaac Albéniz"], recordingMbid: "wang-lavapies" }],
    [1, 9, `${huntMb}: I. Allegro`, secs(377), { composer: ["Ludwig van Beethoven"] }],
    [1, 10, `${huntMb}: II. Scherzo. Allegretto vivace`, secs(207), { composer: ["Ludwig van Beethoven"] }],
    [1, 11, `${huntMb}: III. Menuetto. Moderato e grazioso`, secs(182), { composer: ["Ludwig van Beethoven"] }],
    [1, 12, `${huntMb}: IV. Presto con fuoco`, secs(226), { composer: ["Ludwig van Beethoven"] }],
    [1, 13, "Études pour piano, premier livre: no. 6. Automne à Varsovie", secs(292), { composer: ["György Ligeti"] }],
    [1, 14, "Études pour piano, deuxième livre: no. 13. L’Escalier du diable", secs(301), { composer: ["György Ligeti"] }],
    [1, 15, "Études: no. 6", secs(167), { composer: ["Philip Glass"] }],
    [1, 16, "Danzón no. 2", secs(225), { composer: ["Arturo Márquez"] }],
    [1, 17, "3 Intermezzi, op. 117: no. 3 in C-sharp minor: Andante con moto", secs(405), { composer: ["Johannes Brahms"] }],
    [1, 18, "Orfeo ed Euridice, Wq. 30: Melodie (arr. Sgambati)", secs(185), { composer: ["Christoph Willibald Gluck"] }],
  ],
  musicbrainz: {
    recordings: { "wang-malaga": "mb-malaga", "wang-lavapies": "mb-lavapies" },
    works: {
      "mb-iberia": { title: "Iberia, B. 47" },
      "mb-iberia-3": { title: "Iberia, B. 47: Book 3", parent: "mb-iberia" },
      "mb-iberia-4": { title: "Iberia, B. 47: Book 4", parent: "mb-iberia" },
      "mb-lavapies": { title: "Iberia, B. 47: Book 3: no. 9. Lavapiés", parent: "mb-iberia-3" },
      "mb-malaga": { title: "Iberia, B. 47: Book 4: no. 10. Málaga", parent: "mb-iberia-4" },
    },
  },
  expect: {
    groups: [
      ["Iberia, B. 47", ["no. 10, Málaga"]],
      // Both sonatas join the works the store-tagged copy created: one work,
      // one title and one set of movement names across the library.
      [scriabin3, ["I. Drammatico", "II. Allegretto", "III. Andante", "IV. Presto con fuoco"]],
      // A set with its own opus is a work, shared with the other copy of the recital.
      ["24 Jazz Preludes, Op. 53", ["No. 11", "No. 10"]],
      ["Iberia, B. 47", ["no. 9, Lavapiés"]],
      [hunt, ["I. Allegro", "II. Scherzo. Allegretto vivace", "III. Minuet. Moderato e grazioso - Trio", "IV. Presto con fuoco"]],
      ["Études pour piano, premier livre", ["no. 6. Automne à Varsovie"]],
      ["Études pour piano, deuxième livre", ["no. 13. L’Escalier du diable"]],
      ["Études", ["no. 6"]],
      ["Danzón no. 2", ["Danzón no. 2"]],
      // One piece of a set is matched to the set, shared with the other copy.
      ["3 Intermezzi, Op. 117", ["No. 3 in C-Sharp Minor. Andante con moto"]],
      ["Orfeo ed Euridice, Wq. 30", ["Melodie (arr. Sgambati)"]],
    ],
  },
});

// Not on MusicBrainz: a small label's own tags, " - " before the movement.
export const cello = album("bach-cello-suites-indie", {
  title: "Bach: Cello Suites Nos. 1 & 2",
  artist: "Anna Lindqvist",
  composer: "Johann Sebastian Bach",
  kind: "not on MusicBrainz, dash-separated titles",
  tracks: [
    ...["Prélude", "Allemande", "Courante", "Sarabande", "Menuets I & II", "Gigue"].map((part, i) => [1, i + 1, `Cello Suite No. 1 in G Major, BWV 1007 - ${["I", "II", "III", "IV", "V", "VI"][i]}. ${part}`, min(2, 10 + i * 7)]),
    ...["Prélude", "Allemande", "Courante", "Sarabande", "Menuets I & II", "Gigue"].map((part, i) => [1, i + 7, `Cello Suite No. 2 in D Minor, BWV 1008 - ${["I", "II", "III", "IV", "V", "VI"][i]}. ${part}`, min(2, 30 + i * 5)]),
  ],
  expect: {
    groups: [
      ["Cello Suite No. 1 in G Major, BWV 1007", ["I. Prélude", "II. Allemande", "III. Courante", "IV. Sarabande", "V. Menuets I & II", "VI. Gigue"]],
      ["Cello Suite No. 2 in D Minor, BWV 1008", ["I. Prélude", "II. Allemande", "III. Courante", "IV. Sarabande", "V. Menuets I & II", "VI. Gigue"]],
    ],
  },
});

// iTunes/Apple-style tags: WORK holds the work, titles hold the movement.
// The Ninth starts on disc 2, so album order crosses a disc.
export const symphonies = album("karajan-beethoven-7-9", {
  title: "Beethoven: Symphonies Nos. 7 & 9",
  artist: "Berliner Philharmoniker & Herbert von Karajan",
  composer: "Ludwig van Beethoven",
  kind: "two discs, WORK tag holds the work",
  tracks: [
    [2, 1, "I. Allegro ma non troppo, un poco maestoso", min(15, 29), { work: "Symphony No. 9 in D Minor, Op. 125" }],
    [2, 2, "II. Molto vivace", min(10, 6), { work: "Symphony No. 9 in D Minor, Op. 125" }],
    [2, 3, "III. Adagio molto e cantabile", min(16, 32), { work: "Symphony No. 9 in D Minor, Op. 125" }],
    [2, 4, "IV. Presto - Allegro assai", min(24, 31), { work: "Symphony No. 9 in D Minor, Op. 125" }],
    [1, 1, "I. Poco sostenuto - Vivace", min(13, 22), { work: "Symphony No. 7 in A Major, Op. 92" }],
    [1, 2, "II. Allegretto", min(8, 17), { work: "Symphony No. 7 in A Major, Op. 92" }],
    [1, 3, "III. Presto - Assai meno presto", min(8, 4), { work: "Symphony No. 7 in A Major, Op. 92" }],
    [1, 4, "IV. Allegro con brio", min(6, 47), { work: "Symphony No. 7 in A Major, Op. 92" }],
  ],
  expect: {
    groups: [
      ["Symphony No. 7 in A Major, Op. 92", ["I. Poco sostenuto - Vivace", "II. Allegretto", "III. Presto - Assai meno presto", "IV. Allegro con brio"]],
      ["Symphony No. 9 in D Minor, Op. 125", ["I. Allegro ma non troppo, un poco maestoso", "II. Molto vivace", "III. Adagio molto e cantabile", "IV. Presto - Allegro assai"]],
    ],
  },
});

// A second recording of the Seventh: it joins the same work.
export const seventh = album("kleiber-beethoven-5-7", {
  title: "Beethoven: Symphonies Nos. 5 & 7",
  artist: "Wiener Philharmoniker & Carlos Kleiber",
  composer: "Ludwig van Beethoven",
  kind: "same work as another album",
  tracks: [
    [1, 1, "Symphony No. 5 in C Minor, Op. 67: I. Allegro con brio", min(7, 22), { work: "Symphony No. 5 in C Minor, Op. 67" }],
    [1, 2, "Symphony No. 5 in C Minor, Op. 67: II. Andante con moto", min(9, 59), { work: "Symphony No. 5 in C Minor, Op. 67" }],
    [1, 3, "Symphony No. 5 in C Minor, Op. 67: III. Allegro", min(5, 7), { work: "Symphony No. 5 in C Minor, Op. 67" }],
    [1, 4, "Symphony No. 5 in C Minor, Op. 67: IV. Allegro", min(10, 58), { work: "Symphony No. 5 in C Minor, Op. 67" }],
    [1, 5, "Symphony No. 7 in A Major, Op. 92: I. Poco sostenuto - Vivace", min(13, 41), { work: "Symphony No. 7 in A Major, Op. 92" }],
    [1, 6, "Symphony No. 7 in A Major, Op. 92: II. Allegretto", min(8, 25), { work: "Symphony No. 7 in A Major, Op. 92" }],
    [1, 7, "Symphony No. 7 in A Major, Op. 92: III. Presto - Assai meno presto", min(7, 59), { work: "Symphony No. 7 in A Major, Op. 92" }],
    [1, 8, "Symphony No. 7 in A Major, Op. 92: IV. Allegro con brio", min(8, 35), { work: "Symphony No. 7 in A Major, Op. 92" }],
  ],
  expect: {
    groups: [
      ["Symphony No. 5 in C Minor, Op. 67", ["I. Allegro con brio", "II. Andante con moto", "III. Allegro", "IV. Allegro"]],
      ["Symphony No. 7 in A Major, Op. 92", ["I. Poco sostenuto - Vivace", "II. Allegretto", "III. Presto - Assai meno presto", "IV. Allegro con brio"]],
    ],
  },
});

const winterreise = "Winterreise, D. 911";
const songs = ["Gute Nacht", "Die Wetterfahne", "Gefrorne Tränen", "Erstarrung", "Der Lindenbaum", "Wasserflut"];
// A song cycle: one work of numbered songs, no sonata-like form word.
export const songCycle = album("goerne-winterreise", {
  title: "Schubert: Winterreise",
  artist: "Matthias Goerne & Alfred Brendel",
  composer: "Franz Schubert",
  kind: "song cycle, WORK tag with a catalogue number",
  tracks: songs.map((song, i) => [1, i + 1, `${winterreise}: No. ${i + 1}, ${song}`, min(3, 20 + i * 11), { work: winterreise }]),
  expect: { groups: [[winterreise, songs.map((song, i) => `No. ${i + 1}, ${song}`)]] },
});

// A compilation: one movement from each of many works. Nothing to group.
export const compilation = album("classical-essentials", {
  title: "Classical Essentials",
  artist: "Various Artists",
  kind: "compilation of single movements",
  tracks: [
    [1, 1, "Symphony No. 5 in C Minor, Op. 67: I. Allegro con brio", min(7, 31), { composer: ["Ludwig van Beethoven"], artist: "Chicago Symphony Orchestra" }],
    [1, 2, "Piano Concerto No. 21 in C Major, K. 467: II. Andante", min(6, 52), { composer: ["Wolfgang Amadeus Mozart"], artist: "Mitsuko Uchida" }],
    [1, 3, "The Four Seasons, Violin Concerto in E Major, RV 269 \"Spring\": I. Allegro", min(3, 21), { composer: ["Antonio Vivaldi"], artist: "Il Giardino Armonico" }],
    [1, 4, "Suite bergamasque, L. 75: III. Clair de lune", min(5, 2), { composer: ["Claude Debussy"], artist: "Seong-Jin Cho" }],
    [1, 5, "Gymnopédie No. 1", min(3, 18), { composer: ["Erik Satie"], artist: "Jean-Yves Thibaudet" }],
  ],
  expect: null,
});

// Not classical at all: nothing should happen.
export const pop = album("indie-pop", {
  title: "Summer Lights",
  artist: "The Night Owls",
  genre: "Pop",
  kind: "not classical",
  tracks: [
    [1, 1, "Summer Lights", min(3, 31)],
    [1, 2, "Ocean Drive", min(3, 2)],
    [1, 3, "Neon Hearts", min(4, 1)],
  ],
  expect: null,
});

// Picard tags with the work in GROUPING and WORK left empty, from a real
// library. The Bells is Trifonov's piano arrangement: its title names no form,
// and its MusicBrainz work is the arrangement, linked to the movement it
// arranges rather than to The Bells.
const rach = "Sergei Rachmaninoff";
const trifonovArtist = `${rach} — Daniil Trifonov`;
const bells = "The Bells, op. 35";
const rach3 = "Concerto for Piano and Orchestra no. 3 in D minor, op. 30";
const bellsMovements = [
  "1. The Silver Sleigh Bells. Allegro ma non tanto",
  "2. The Mellow Wedding Bells. Lento",
  "3. The Loud Alarum Bells. Presto",
  "4. The Mournful Iron Bells. Lento lugubre",
];
const rach3Movements = ["1. Allegro ma non tanto", "2. Intermezzo. Adagio", "3. Finale. Alla breve"];
const bellsWorks = {
  "mb-bells": { title: bells },
  ...Object.fromEntries(
    ["I. Allegro ma non tanto", "II. Lento", "III. Presto", "IV. Lento lugubre"].flatMap((movement, i) => [
      [`mb-bells-${i + 1}`, { title: `${bells}: ${movement}`, parent: "mb-bells" }],
      [`mb-bells-arr-${i + 1}`, { title: bellsMovements[i].replace(/^\d\. /, "").split(". ")[0], arrangementOf: `mb-bells-${i + 1}` }],
    ]),
  ),
};
export const trifonovArrival = album("trifonov-arrival", {
  title: "Destination Rachmaninov: Arrival",
  artist: `${rach}; Daniil Trifonov, The Philadelphia Orchestra, Yannick Nézet‐Séguin`,
  genre: "classical",
  composer: rach,
  kind: "Picard tags, work in GROUPING, no WORK",
  tracks: [
    ...bellsMovements.map((movement, i) => [1, i + 1, `${bells}: ${movement}`, min(5, 0), { artist: trifonovArtist, grouping: bells, workId: `mb-bells-arr-${i + 1}` }]),
    [1, 5, "Vocalise, op. 34 no. 14", min(6, 0), { artist: trifonovArtist, grouping: "Vocalise, op. 34 no. 14" }],
    ...rach3Movements.map((movement, i) => [1, i + 6, `${rach3}: ${movement}`, min(15, 0), { artist: `${rach} — Daniil Trifonov — The Philadelphia Orchestra — Yannick Nézet‐Séguin`, grouping: "Piano Concerto no. 3 in D minor, op. 30" }]),
  ],
  musicbrainz: { works: bellsWorks },
  expect: {
    groups: [
      [bells, bellsMovements],
      ["Vocalise, op. 34 no. 14", ["Vocalise, op. 34 no. 14"]],
      ["Piano Concerto no. 3 in D minor, op. 30", rach3Movements],
    ],
  },
});

// The same arrangement tagged with only the arrangement's names and
// MusicBrainz IDs: nothing in the tags names The Bells, so only following
// MusicBrainz's arrangement link finds it.
export const trifonovArranged = album("trifonov-arranged", {
  title: "Rachmaninoff Transcriptions",
  artist: "Daniil Trifonov",
  composer: rach,
  kind: "arrangement known only to MusicBrainz",
  tracks: bellsMovements.map((movement, i) => [1, i + 1, movement.replace(/^\d\. /, "").split(". ")[0], min(5, 0), { workId: `mb-bells-arr-${i + 1}` }]),
  musicbrainz: { works: bellsWorks },
  // Arrival's tracks made the work first, so these join it, with its names.
  expect: { groups: [[bells, bellsMovements]] },
});

// GROUPING as free text on a compilation: it reads like a work ("Concerto")
// but names none of the tracks, so it must not make one.
export const groupingCompilation = album("grouping-compilation", {
  title: "Concerto Highlights",
  artist: "Various Artists",
  kind: "compilation with free-text GROUPING",
  tracks: [
    [1, 1, "Piano Concerto no. 2 in C minor, op. 18: II. Adagio sostenuto", min(11, 0), { composer: [rach], grouping: "Romantic Concerto Highlights" }],
    [1, 2, "Piano Concerto no. 1 in B-flat minor, op. 23: I. Allegro non troppo", min(20, 0), { composer: ["Pyotr Ilyich Tchaikovsky"], grouping: "Romantic Concerto Highlights" }],
    [1, 3, "Piano Concerto in A minor, op. 16: II. Adagio", min(6, 0), { composer: ["Edvard Grieg"], grouping: "Romantic Concerto Highlights" }],
  ],
  expect: null,
});

// A recital whose WORK tags name a set with no form or catalogue number.
// The sonata is a work; the Liszt pieces stay pieces under their WORK name.
const chopin2 = "Piano Sonata No. 2 in B-flat minor, Op. 35";
const annees = "Années de pèlerinage, Deuxième année";
const petrarca = ["Sonetto 47 del Petrarca", "Sonetto 104 del Petrarca", "Sonetto 123 del Petrarca", "Après une lecture du Dante (Fantasia quasi sonata)"];
export const kobayashi = album("kobayashi-recital", {
  title: "Chopin & Liszt",
  artist: "Aimi Kobayashi",
  kind: "WORK names a set without a form",
  tracks: [
    ...["I. Grave - Doppio movimento", "II. Scherzo", "III. Marche funèbre", "IV. Presto"].map((movement, i) => [1, i + 1, movement, min(6, 0), { composer: ["Frédéric Chopin"], work: chopin2 }]),
    ...petrarca.map((piece, i) => [1, i + 5, `Italie, S. 161, no. ${i + 4}: ${piece}`, min(7, 0), { composer: ["Franz Liszt"], work: annees }]),
  ],
  expect: {
    groups: [
      [chopin2, ["I. Grave - Doppio movimento", "II. Scherzo", "III. Marche funèbre", "IV. Presto"]],
      [annees, petrarca.map((piece, i) => `Italie, S. 161, no. ${i + 4}: ${piece}`)],
    ],
  },
});

// Picard-tagged with recording IDs and nothing else that names a work:
// MusicBrainz files each prelude under its book, and both books under one set.
const bookOne = ["Danseuses de Delphes", "Voiles", "Le vent dans la plaine"];
const bookTwo = ["Brouillards", "Feuilles mortes"];
export const zimerman = album("zimerman-debussy", {
  title: "Préludes",
  artist: "Krystian Zimerman",
  composer: "Claude Debussy",
  kind: "titles only; MusicBrainz names the books",
  tracks: [
    ...bookOne.map((title, i) => [1, i + 1, title, min(3, 0), { recordingMbid: `zim-1-${i + 1}` }]),
    ...bookTwo.map((title, i) => [2, i + 1, title, min(3, 0), { recordingMbid: `zim-2-${i + 1}` }]),
  ],
  musicbrainz: {
    recordings: Object.fromEntries([...bookOne.map((_, i) => [`zim-1-${i + 1}`, `mb-livre-1-${i + 1}`]), ...bookTwo.map((_, i) => [`zim-2-${i + 1}`, `mb-livre-2-${i + 1}`])]),
    works: {
      "mb-preludes": { title: "Préludes" },
      "mb-livre-1": { title: "Préludes, Livre I", parent: "mb-preludes" },
      "mb-livre-2": { title: "Préludes, Livre II", parent: "mb-preludes" },
      ...Object.fromEntries(bookOne.map((title, i) => [`mb-livre-1-${i + 1}`, { title: `Préludes, Livre I: ${["I", "II", "III"][i]}. ${title}`, parent: "mb-livre-1" }])),
      ...Object.fromEntries(bookTwo.map((title, i) => [`mb-livre-2-${i + 1}`, { title: `Préludes, Livre II: ${["I", "II"][i]}. ${title}`, parent: "mb-livre-2" }])),
    },
  },
  expect: {
    groups: [
      ["Préludes, Livre I", bookOne],
      ["Préludes, Livre II", bookTwo],
    ],
  },
});

// A recital with some of Chopin's Op. 28: the set is the work.
export const argerichPreludes = album("argerich-op28", {
  title: "Chopin",
  artist: "Martha Argerich",
  composer: "Frédéric Chopin",
  kind: "MusicBrainz names a set the titles only number",
  tracks: [
    [1, 1, "24 Préludes, op. 28 no. 6 in B minor", min(1, 48), { recordingMbid: "arg-6" }],
    [1, 2, "24 Préludes, op. 28 no. 10 in C-sharp minor", min(0, 24), { recordingMbid: "arg-10" }],
  ],
  musicbrainz: {
    recordings: { "arg-6": "mb-op28-6", "arg-10": "mb-op28-10" },
    works: {
      "mb-op28": { title: "24 Préludes, op. 28" },
      "mb-op28-6": { title: "24 Préludes, op. 28: no. 6 in B minor", parent: "mb-op28" },
      "mb-op28-10": { title: "24 Préludes, op. 28: no. 10 in C-sharp minor", parent: "mb-op28" },
    },
  },
  expect: { groups: [["24 Préludes, op. 28", ["No. 6 in B minor", "No. 10 in C-sharp minor"]]] },
});

export const albums = [levit, lugansky, recital, recitalPicard, cello, symphonies, seventh, songCycle, compilation, pop, trifonovArrival, trifonovArranged, groupingCompilation, kobayashi, zimerman, argerichPreludes];
