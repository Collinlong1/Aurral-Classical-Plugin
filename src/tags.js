// Reads and writes tags the way Aurral does (backend/services/audioTags.ts):
// node-taglib-sharp, Picard's field names, only the fields that change, and a
// copy beside the file that is renamed into place.
import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ByteVector,
  File,
  Id3v2FrameClassType,
  Id3v2FrameIdentifiers,
  Id3v2Settings,
  Id3v2UserTextInformationFrame,
  ReadStyle,
  StringType,
  TagTypes,
} from "node-taglib-sharp";

Id3v2Settings.useNumericGenres = false;
const READ_STYLE = ReadStyle.None | ReadStyle.PictureLazy;
// Reading also needs the audio's length, which ReadStyle.None skips.
const READ_WITH_PROPERTIES = ReadStyle.Average | ReadStyle.PictureLazy;
const ADDED_TAG_TYPES = TagTypes.Id3v1 | TagTypes.Ape | TagTypes.MovieId | TagTypes.DivX;
const ITUNES_MEAN = "com.apple.iTunes";
const MUSICBRAINZ_UFID_OWNER = "http://musicbrainz.org";

export const AUDIO_EXTENSIONS = new Set([".flac", ".mp3", ".m4a", ".mp4", ".ogg", ".oga", ".opus"]);
export const isAudioPath = (file) => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase());

const text = (value) => (value == null ? "" : String(value).trim());
const texts = (value) => (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
const positive = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
};

const xiphOf = (file) => file.getTag(TagTypes.Xiph, false);
const id3Of = (file) => file.getTag(TagTypes.Id3v2, false);
const appleOf = (file) => file.getTag(TagTypes.Apple, false);

function userTextFrames(id3, description) {
  const wanted = description.toLowerCase();
  return id3
    .getFramesByClassType(Id3v2FrameClassType.UserTextInformationFrame)
    .filter((frame) => frame.description.toLowerCase() === wanted);
}

// A tag taglib has no property for, named as MusicBrainz Picard writes it: a
// Vorbis comment, an ID3 TXXX frame, and an iTunes atom (a QuickTime box such
// as ©wrk, or a freeform ----:com.apple.iTunes:<name> atom).
function textField(xiphName, id3Description, apple) {
  const box = apple.box ? ByteVector.fromString(apple.box, StringType.Latin1) : null;
  return {
    read(file) {
      const xiph = xiphOf(file);
      const id3 = id3Of(file);
      const appleTag = appleOf(file);
      for (const values of [
        xiph?.getField(xiphName),
        id3 && userTextFrames(id3, id3Description).flatMap((frame) => frame.text || []),
        appleTag && (box ? appleTag.getQuickTimeStrings(box) : appleTag.getItunesStrings(ITUNES_MEAN, apple.name)),
      ]) {
        const found = texts(values ?? []);
        if (found.length) return found;
      }
      return [];
    },
    write(file, values) {
      const xiph = xiphOf(file);
      if (xiph) xiph.setFieldAsStrings(xiphName, ...values);
      const appleTag = appleOf(file);
      if (appleTag) {
        if (box) appleTag.setQuickTimeStrings(box, values);
        else appleTag.setItunesStrings(ITUNES_MEAN, apple.name, ...values);
      }
      const id3 = id3Of(file);
      if (id3) {
        for (const frame of userTextFrames(id3, id3Description)) id3.removeFrame(frame);
        if (values.length) {
          const frame = Id3v2UserTextInformationFrame.fromDescription(id3Description);
          frame.text = values;
          id3.addFrame(frame);
        }
      }
    },
  };
}

const workField = textField("WORK", "WORK", { box: "©wrk" });
const workIdField = textField("MUSICBRAINZ_WORKID", "MusicBrainz Work Id", { name: "MusicBrainz Work Id" });
const artistIdsField = textField("MUSICBRAINZ_ARTISTID", "MusicBrainz Artist Id", { name: "MusicBrainz Artist Id" });
const albumArtistIdsField = textField("MUSICBRAINZ_ALBUMARTISTID", "MusicBrainz Album Artist Id", { name: "MusicBrainz Album Artist Id" });

// The disc's own title ("Livre - Heft - Book I"), as Picard writes it: a
// DISCSUBTITLE comment or iTunes atom, or the ID3v2.4 TSST frame (TXXX in
// files from taggers that keep to ID3v2.3).
const discSubtitleField = textField("DISCSUBTITLE", "DISCSUBTITLE", { name: "DISCSUBTITLE" });
function readDiscSubtitle(file) {
  const tsst = id3Of(file)?.getTextAsString(Id3v2FrameIdentifiers.TSST);
  return text(tsst) || (discSubtitleField.read(file)[0] ?? "");
}

// Fields the plugin writes. Each value is a list of strings.
const WRITERS = {
  title: {
    read: (file) => texts(file.tag.title),
    write: (file, values) => (file.tag.title = values[0] ?? undefined),
  },
  artist: {
    read: (file) => texts(file.tag.performers),
    write: (file, values) => (file.tag.performers = values),
  },
  albumArtist: {
    read: (file) => texts(file.tag.albumArtists),
    write: (file, values) => (file.tag.albumArtists = values),
  },
  composer: {
    read: (file) => texts(file.tag.composers),
    write: (file, values) => (file.tag.composers = values),
  },
  work: { read: (file) => workField.read(file), write: (file, values) => workField.write(file, values) },
  workId: { read: (file) => workIdField.read(file), write: (file, values) => workIdField.write(file, values) },
  recordingMbid: {
    read: (file) => texts(file.tag.musicBrainzTrackId),
    write: (file, values) => {
      const id3 = id3Of(file);
      for (const frame of id3?.getFramesByClassType(Id3v2FrameClassType.UniqueFileIdentifierFrame) || []) {
        if (frame.owner === MUSICBRAINZ_UFID_OWNER) id3.removeFrame(frame);
      }
      file.tag.musicBrainzTrackId = values[0] ?? undefined;
    },
  },
};

// taglib grows the header of a fragmented MP4 without moving the data offsets
// its fragments point at, which breaks the audio. Aurral refuses them too.
function isFragmentedMp4(filePath) {
  const fd = openSync(filePath, "r");
  try {
    const size = fstatSync(fd).size;
    const header = Buffer.alloc(16);
    for (let offset = 0; offset + 8 <= size; ) {
      readSync(fd, header, 0, 16, offset);
      const type = header.toString("latin1", 4, 8);
      if (offset === 0 && type !== "ftyp") return false;
      if (type === "moof") return true;
      const boxSize = header.readUInt32BE(0);
      const length = boxSize === 1 ? Number(header.readBigUInt64BE(8)) : boxSize === 0 ? size - offset : boxSize;
      if (length < 8) return false;
      offset += length;
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

export class UnsupportedFormat extends Error {}

// `asPath` names the format when the file itself is a temp copy.
function openFile(filePath, readStyle = READ_STYLE, asPath = filePath) {
  if (!isAudioPath(asPath)) throw new UnsupportedFormat(`can't tag ${path.extname(asPath) || "this kind of"} files`);
  if (isFragmentedMp4(filePath)) throw new UnsupportedFormat("can't tag fragmented MP4 files");
  try {
    return File.createFromPath(filePath, `taglib/${path.extname(asPath).slice(1).toLowerCase()}`, readStyle);
  } catch (error) {
    if (/unsupported format/i.test(String(error?.message))) throw new UnsupportedFormat("can't tag this kind of file");
    throw error;
  }
}

// The current values of fields the plugin writes: { field: string[] }.
export function readValues(filePath, fields) {
  const file = openFile(filePath);
  try {
    return Object.fromEntries(fields.map((field) => [field, WRITERS[field].read(file)]));
  } finally {
    file.dispose();
  }
}

// What the plugin needs to know about a file.
export function readTags(filePath) {
  const file = openFile(filePath, READ_WITH_PROPERTIES);
  try {
    const tag = file.tag;
    return {
      title: text(tag.title),
      artist: text(tag.performers?.[0]),
      albumArtist: text(tag.albumArtists?.[0]),
      album: text(tag.album),
      recordingMbid: text(tag.musicBrainzTrackId),
      releaseMbid: text(tag.musicBrainzReleaseId),
      releaseGroupMbid: text(tag.musicBrainzReleaseGroupId),
      // Every album artist ID: taglib's own property has only the first.
      albumArtistMbids: [...new Set([...albumArtistIdsField.read(file), text(tag.musicBrainzReleaseArtistId)].flatMap((v) => texts(v.split(/[;/]/))))],
      artistMbids: artistIdsField.read(file).flatMap((value) => texts(value.split(/[;/]/))),
      genres: texts(tag.genres ?? []).flatMap((genre) => texts(genre.split(";"))),
      composer: texts(tag.composers ?? []),
      work: workField.read(file)[0] ?? "",
      // Some taggers put the work here and leave WORK empty.
      grouping: text(tag.grouping),
      workId: workIdField.read(file)[0] ?? "",
      discSubtitle: readDiscSubtitle(file),
      trackNumber: positive(tag.track),
      discNumber: positive(tag.disc),
      durationMs: Math.round(file.properties?.durationMilliseconds || 0),
    };
  } finally {
    file.dispose();
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Writes `values` ({ field: string[] }) and returns the fields that changed.
// Every other tag, cover art included, stays as it was. Writes to a copy
// beside the file and moves it into place, so a crash never leaves half a
// file, and a hardlinked file gets its own copy while the other link keeps
// its tags.
export async function writeTags(filePath, values) {
  const source = path.resolve(filePath);
  const preview = openFile(source);
  let changed;
  try {
    changed = Object.keys(values).filter((field) => !same(WRITERS[field].read(preview), texts(values[field])));
  } finally {
    preview.dispose();
  }
  if (!changed.length) return [];
  // The copy has no audio extension, so a Library scan running meanwhile
  // never indexes it: a scan that did kept the old artist on the track,
  // since the copy's path sorts first, until a full rescan.
  const extension = path.extname(source);
  const working = path.join(path.dirname(source), `.${path.basename(source, extension)}.${randomUUID()}.tagging`);
  await fs.copyFile(source, working, fs.constants.COPYFILE_FICLONE);
  try {
    const file = openFile(working, READ_STYLE, source);
    try {
      file.removeTags(ADDED_TAG_TYPES & ~file.tagTypesOnDisk);
      const id3 = id3Of(file);
      if (id3 && !(file.tagTypesOnDisk & TagTypes.Id3v2)) id3.version = 4;
      for (const field of changed) WRITERS[field].write(file, texts(values[field]));
      file.save();
    } finally {
      file.dispose();
    }
    const verified = openFile(working, READ_STYLE, source);
    try {
      for (const field of changed) {
        if (!same(WRITERS[field].read(verified), texts(values[field])))
          throw new Error(`Tag verification failed for ${field}`);
      }
    } finally {
      verified.dispose();
    }
    await fs.rename(working, source);
  } catch (error) {
    await fs.rm(working, { force: true }).catch(() => {});
    throw error;
  }
  return changed;
}
