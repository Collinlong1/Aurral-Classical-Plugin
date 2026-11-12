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

export const albums = [levit, lugansky, recital, cello, symphonies, seventh, songCycle, compilation, pop];
