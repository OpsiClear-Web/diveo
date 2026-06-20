import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayUrlResponse } from "../services/types";

// `dash.ts` only exports functions that ultimately call into
// `expo-file-system/legacy`. We mock that module so the pure MPD-building and
// stream/audio-selection logic (internal `buildMpdXml` / `escapeXml`) can be
// exercised through the public `buildDashMpdUri` / `cleanupDashMpd` API in
// plain node, capturing the XML that would have been written to disk.
const writeAsStringAsync = vi.fn(async (..._args: unknown[]): Promise<void> => {});
const readDirectoryAsync = vi.fn(async (..._args: unknown[]): Promise<string[]> => []);
const deleteAsync = vi.fn(async (..._args: unknown[]): Promise<void> => {});

vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  EncodingType: { UTF8: "utf8" },
  writeAsStringAsync: (...args: unknown[]) => writeAsStringAsync(...args),
  readDirectoryAsync: (...args: unknown[]) => readDirectoryAsync(...args),
  deleteAsync: (...args: unknown[]) => deleteAsync(...args),
}));

// Imported after the mock is registered (vi.mock is hoisted, but keep order clear).
import { buildDashMpdUri, cleanupDashMpd } from "./dash";

/** Build a minimal but representative PlayUrlResponse-like fixture. */
function makePlayData(overrides: Partial<PlayUrlResponse> = {}): PlayUrlResponse {
  return {
    quality: 80,
    accept_quality: [80, 64],
    accept_description: ["1080P", "720P"],
    dash: {
      duration: 142,
      video: [
        {
          id: 64,
          baseUrl: "https://cdn.example/v720.m4s",
          bandwidth: 1_200_000,
          mimeType: "video/mp4",
          codecs: "avc1.640028",
          width: 1280,
          height: 720,
          stat: null,
          frameRate: "25",
          segment_base: { initialization: "0-100", index_range: "101-200" },
        },
        {
          id: 80,
          baseUrl: "https://cdn.example/v1080.m4s",
          bandwidth: 3_000_000,
          mimeType: "video/mp4",
          codecs: "avc1.640032",
          width: 1920,
          height: 1080,
          stat: null,
          frameRate: "30",
          segment_base: { initialization: "0-110", index_range: "111-220" },
        },
      ],
      audio: [
        {
          id: 30216,
          baseUrl: "https://cdn.example/a-low.m4s",
          bandwidth: 64_000,
          mimeType: "audio/mp4",
          codecs: "mp4a.40.2",
          segment_base: { initialization: "0-50", index_range: "51-90" },
        },
        {
          id: 30280,
          baseUrl: "https://cdn.example/a-high.m4s",
          bandwidth: 192_000,
          mimeType: "audio/mp4",
          codecs: "mp4a.40.2",
          segment_base: { initialization: "0-60", index_range: "61-99" },
        },
      ],
    },
    ...overrides,
  };
}

/** Pull the XML string passed to the mocked writeAsStringAsync. */
function lastWrittenXml(): string {
  const calls = writeAsStringAsync.mock.calls;
  return calls[calls.length - 1][1] as string;
}

beforeEach(() => {
  writeAsStringAsync.mockClear();
  readDirectoryAsync.mockClear();
  deleteAsync.mockClear();
});

describe("buildDashMpdUri - file path / uri", () => {
  it("derives the cache path with bvid + qn suffix", async () => {
    const uri = await buildDashMpdUri(makePlayData(), 80, "BV1xx411c7mD");
    expect(uri).toBe("file:///cache/bili_dash_BV1xx411c7mD_80.mpd");
    expect(writeAsStringAsync).toHaveBeenCalledOnce();
    const [path, , opts] = writeAsStringAsync.mock.calls[0];
    expect(path).toBe("file:///cache/bili_dash_BV1xx411c7mD_80.mpd");
    expect(opts).toEqual({ encoding: "utf8" });
  });

  it("falls back to just qn when no bvid is provided", async () => {
    const uri = await buildDashMpdUri(makePlayData(), 64);
    expect(uri).toBe("file:///cache/bili_dash_64.mpd");
  });
});

describe("buildDashMpdUri - MPD structure & stream selection", () => {
  it("selects the video stream whose id matches qn and highest-bandwidth audio", async () => {
    await buildDashMpdUri(makePlayData(), 80, "BV1");
    const xml = lastWrittenXml();

    // qn=80 -> the 1080p representation.
    expect(xml).toContain('<BaseURL>https://cdn.example/v1080.m4s</BaseURL>');
    expect(xml).toContain('width="1920" height="1080"');
    expect(xml).toContain('frameRate="30"');
    expect(xml).toContain('bandwidth="3000000"');
    expect(xml).not.toContain("v720.m4s");

    // Highest-bandwidth audio (192000) wins over the 64000 track.
    expect(xml).toContain('<BaseURL>https://cdn.example/a-high.m4s</BaseURL>');
    expect(xml).toContain('bandwidth="192000"');
    expect(xml).not.toContain("a-low.m4s");
  });

  it("falls back to the first video stream when qn matches nothing", async () => {
    await buildDashMpdUri(makePlayData(), 99999, "BV1");
    const xml = lastWrittenXml();
    // First entry in the array is the 720p stream.
    expect(xml).toContain('<BaseURL>https://cdn.example/v720.m4s</BaseURL>');
    expect(xml).toContain('width="1280" height="720"');
  });

  it("produces a well-formed static on-demand MPD skeleton with duration", async () => {
    await buildDashMpdUri(makePlayData(), 80, "BV1");
    const xml = lastWrittenXml();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="urn:mpeg:dash:schema:mpd:2011"');
    expect(xml).toContain('type="static"');
    expect(xml).toContain('mediaPresentationDuration="PT142S"');
    expect(xml).toContain('<Period duration="PT142S">');
    expect(xml).toContain('<AdaptationSet id="1"');
    expect(xml).toContain('<AdaptationSet id="2"');
    expect(xml).toContain('<Representation id="v1"');
    expect(xml).toContain('<Representation id="a1"');
    expect(xml.trimEnd().endsWith("</MPD>")).toBe(true);
  });

  it("emits SegmentBase init/index ranges for video and audio when present", async () => {
    await buildDashMpdUri(makePlayData(), 80, "BV1");
    const xml = lastWrittenXml();
    expect(xml).toContain(
      '<SegmentBase indexRange="111-220"><Initialization range="0-110"/></SegmentBase>',
    );
    expect(xml).toContain(
      '<SegmentBase indexRange="61-99"><Initialization range="0-60"/></SegmentBase>',
    );
  });

  it("omits SegmentBase when segment_base is absent", async () => {
    const data = makePlayData();
    delete data.dash!.video[1].segment_base;
    delete data.dash!.audio[1].segment_base;
    await buildDashMpdUri(data, 80, "BV1");
    const xml = lastWrittenXml();
    expect(xml).not.toContain("<SegmentBase");
    expect(xml).not.toContain("<Initialization");
  });
});

describe("buildDashMpdUri - Dolby / HDR / Dolby Vision", () => {
  it("prefers a Dolby Atmos audio track over regular dash audio", async () => {
    const data = makePlayData({
      dolby: {
        type: 1,
        audio: [
          {
            id: 30250,
            baseUrl: "https://cdn.example/dolby-atmos.m4s",
            bandwidth: 768_000,
            mimeType: "audio/mp4",
            codecs: "ec-3",
            segment_base: { initialization: "0-70", index_range: "71-130" },
          },
        ],
      },
    });
    await buildDashMpdUri(data, 80, "BV1");
    const xml = lastWrittenXml();
    expect(xml).toContain('<BaseURL>https://cdn.example/dolby-atmos.m4s</BaseURL>');
    expect(xml).toContain('codecs="ec-3"');
    expect(xml).toContain('bandwidth="768000"');
    // Regular high-bandwidth audio must be ignored when Dolby is present.
    expect(xml).not.toContain("a-high.m4s");
  });

  it("ignores an empty dolby.audio array and falls back to dash audio", async () => {
    const data = makePlayData({ dolby: { type: 1, audio: [] } });
    await buildDashMpdUri(data, 80, "BV1");
    const xml = lastWrittenXml();
    expect(xml).toContain('<BaseURL>https://cdn.example/a-high.m4s</BaseURL>');
  });

  it("adds the Dolby Vision SupplementalProperty for dvh1/dvhe codecs", async () => {
    const data = makePlayData();
    data.dash!.video[1].codecs = "dvh1.05.06";
    await buildDashMpdUri(data, 80, "BV1");
    const xml = lastWrittenXml();
    expect(xml).toContain(
      '<SupplementalProperty schemeIdUri="tag:dolby.com,2016:dash:dolby_vision_profile:2014" value="dvh1.05.06"/>',
    );
  });

  it("does not add the Dolby Vision property for ordinary avc/hevc codecs", async () => {
    await buildDashMpdUri(makePlayData(), 80, "BV1");
    const xml = lastWrittenXml();
    expect(xml).not.toContain("dolby_vision_profile");
  });
});

describe("buildDashMpdUri - escapeXml on BaseURL", () => {
  it("escapes &, <, > and \" in stream URLs", async () => {
    const data = makePlayData();
    data.dash!.video[1].baseUrl =
      'https://cdn.example/v.m4s?a=1&b=2&c=<x>"q"';
    await buildDashMpdUri(data, 80, "BV1");
    const xml = lastWrittenXml();
    expect(xml).toContain(
      "<BaseURL>https://cdn.example/v.m4s?a=1&amp;b=2&amp;c=&lt;x&gt;&quot;q&quot;</BaseURL>",
    );
    // The raw, unescaped form must not survive into the document.
    expect(xml).not.toContain("c=<x>");
  });
});

describe("cleanupDashMpd", () => {
  it("deletes only this bvid's dash mpd cache files", async () => {
    readDirectoryAsync.mockResolvedValueOnce([
      "bili_dash_BV1_80.mpd",
      "bili_dash_BV1_64.mpd",
      "bili_dash_BV2_80.mpd",
      "bili_dash_BV1_80.txt",
      "unrelated.bin",
    ]);
    await cleanupDashMpd("BV1");
    const deleted = deleteAsync.mock.calls.map((c) => c[0]);
    expect(deleted).toEqual([
      "file:///cache/bili_dash_BV1_80.mpd",
      "file:///cache/bili_dash_BV1_64.mpd",
    ]);
    expect(deleteAsync).toHaveBeenCalledWith(
      "file:///cache/bili_dash_BV1_80.mpd",
      { idempotent: true },
    );
  });

  it("no-ops for an empty bvid without touching the filesystem", async () => {
    await cleanupDashMpd("");
    expect(readDirectoryAsync).not.toHaveBeenCalled();
    expect(deleteAsync).not.toHaveBeenCalled();
  });

  it("swallows filesystem errors", async () => {
    readDirectoryAsync.mockRejectedValueOnce(new Error("boom"));
    await expect(cleanupDashMpd("BV1")).resolves.toBeUndefined();
    expect(deleteAsync).not.toHaveBeenCalled();
  });
});
