import { describe, it, expect, vi, afterEach } from "vitest";
import { CartesiaTTS } from "./cartesia.js";

/**
 * Regression test for the Cartesia emotion-voice-control bug: Cartesia can
 * reject `__experimental_controls.emotion` with a 400 ("invalid emotion
 * level: medium" / "invalid voice controls: ...") for a level our mapping
 * sends. This must no longer propagate as a fatal error — the adapter should
 * retry the same sentence once with emotion controls stripped and still
 * produce audio, so a call carrying `<emotion value="content">` completes
 * normally instead of ending with `reason: "failed"`.
 */
describe("CartesiaTTS emotion voice-control fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("synthesize() retries without emotion controls when Cartesia rejects them", async () => {
    let callCount = 0;
    const audioBytes = new Uint8Array([1, 2, 3, 4]).buffer;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        callCount++;
        const body = JSON.parse(init.body as string) as { generation_config?: { emotion?: string } };
        const hasEmotion = !!body.generation_config?.emotion;
        if (hasEmotion) {
          return {
            ok: false,
            status: 400,
            text: async () => "invalid voice controls: invalid emotion level: medium",
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => audioBytes,
        } as unknown as Response;
      }),
    );

    const tts = new CartesiaTTS("test-key", null, null, null, null);
    const result = await tts.synthesize("Great news!", ["positivity:medium"]);

    expect(callCount).toBe(2); // first rejected w/ emotion, second succeeds without
    expect(result.audio.length).toBe(4);
  });

  it("synthesize() still throws for unrelated Cartesia errors (no silent swallow)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "internal server error",
      }) as unknown as Response),
    );

    const tts = new CartesiaTTS("test-key", null, null, null, null);
    await expect(tts.synthesize("Hello", ["positivity:low"])).rejects.toThrow(/Cartesia TTS error 500/);
  });

  it("synthesize() with no emotions passes through unaffected on success", async () => {
    const audioBytes = new Uint8Array([9, 9]).buffer;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => audioBytes,
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const tts = new CartesiaTTS("test-key", null, null, null, null);
    const result = await tts.synthesize("Plain sentence.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.audio.length).toBe(2);
  });

  it("setLanguage() updates the language tag on subsequent synthesize() calls", async () => {
    const audioBytes = new Uint8Array([1]).buffer;
    const languages: Array<string | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { language?: string };
        languages.push(body.language);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => audioBytes,
        } as unknown as Response;
      }),
    );

    const tts = new CartesiaTTS("test-key", null, null, "en-IN", null);
    await tts.synthesize("Hello");
    tts.setLanguage("ta-IN");
    await tts.synthesize("வணக்கம்");

    expect(languages).toEqual(["en", "ta"]);
  });
});
