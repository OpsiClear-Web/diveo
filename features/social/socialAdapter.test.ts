import { describe, expect, it, vi } from "vitest";

import {
  loadChannelFollowerCount,
  loadIsChannelFollowed,
  loadSavedVideoIds,
  updateChannelFollowed,
  updateVideoSaved,
} from "./socialAdapter";

vi.mock("../../services/supabase", () => ({
  supabase: {},
}));

type MockResult = { data?: unknown; error: { message: string } | null };
type MockChain = {
  select: (...a: unknown[]) => MockChain;
  insert: (...a: unknown[]) => MockChain;
  upsert: (...a: unknown[]) => MockChain;
  delete: (...a: unknown[]) => MockChain;
  eq: (...a: unknown[]) => MockChain;
  maybeSingle: () => Promise<MockResult>;
  single: () => Promise<MockResult>;
  then: (onF: (v: MockResult) => unknown, onR?: (e: unknown) => unknown) => Promise<unknown>;
};

function mockClient(result: MockResult) {
  const ops: string[] = [];
  const makeChain = (): MockChain => {
    const chain: MockChain = {
      select: (..._a) => (ops.push("select"), chain),
      insert: (..._a) => (ops.push("insert"), chain),
      upsert: (..._a) => (ops.push("upsert"), chain),
      delete: (..._a) => (ops.push("delete"), chain),
      eq: (..._a) => (ops.push("eq"), chain),
      maybeSingle: () => (ops.push("maybeSingle"), Promise.resolve(result)),
      single: () => (ops.push("single"), Promise.resolve(result)),
      then: (onF, onR) => Promise.resolve(result).then(onF, onR),
    };
    return chain;
  };
  const client = {
    from: (table: string) => (ops.push(`from:${table}`), makeChain()),
  };
  return { client, ops };
}

describe("socialAdapter", () => {
  it("upserts saved videos when saving", async () => {
    const { client, ops } = mockClient({ error: null });
    await updateVideoSaved("u1", "v1", true, client as never);
    expect(ops).toEqual(["from:saved_videos", "upsert"]);
  });

  it("deletes saved videos by profile and video when unsaving", async () => {
    const { client, ops } = mockClient({ error: null });
    await updateVideoSaved("u1", "v1", false, client as never);
    expect(ops).toEqual(["from:saved_videos", "delete", "eq", "eq"]);
  });

  it("maps saved video rows to id strings", async () => {
    const { client } = mockClient({ data: [{ video_id: "a" }, { video_id: 2 }], error: null });
    expect(await loadSavedVideoIds("u1", client as never)).toEqual(["a", "2"]);
  });

  it("reads public channel follower counts", async () => {
    const { client } = mockClient({ data: { follower_count: 12 }, error: null });
    expect(await loadChannelFollowerCount("c1", client as never)).toBe(12);
  });

  it("reflects channel follow row presence", async () => {
    const present = mockClient({ data: { channel_id: "c1" }, error: null });
    const absent = mockClient({ data: null, error: null });
    expect(await loadIsChannelFollowed("u1", "c1", present.client as never)).toBe(true);
    expect(await loadIsChannelFollowed("u1", "c1", absent.client as never)).toBe(false);
  });

  it("propagates follow backend errors with a labeled message", async () => {
    const { client } = mockClient({ error: { message: "denied" } });
    await expect(updateChannelFollowed("u1", "c1", true, client as never)).rejects.toThrow("follow channel: denied");
  });
});
