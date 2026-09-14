import { afterEach, describe, expect, it, vi } from "vitest";
import { SarvamLLM } from "./sarvam.js";

afterEach(() => vi.unstubAllGlobals());
function stream(reason: string | null, done = true) {
  return new Response([
    'data:{"choices":[{"delta":{"content":"Can I hel"}}]}\n\n',
    reason ? `data: {"choices":[{"finish_reason":"${reason}","delta":{}}]}\n\n` : "",
    done ? "data: [DONE]\n\n" : "",
  ].join(""));
}
function completed(text = "Can I help?") {
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: text } }] });
}
describe("Sarvam incomplete response recovery", () => {
  it("never dispatches a truncated tool response even if its JSON arguments parse", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"1","function":{"name":"book","arguments":"{}"}}]},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'));
    vi.stubGlobal("fetch", fetcher);
    const onToolCall = vi.fn();
    await expect(new SarvamLLM("test", null).chat([], "", () => {}, () => {}, { onToolCall })).rejects.toThrow("tool not executed");
    expect(onToolCall).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["length", null])("repairs %s once, appending only an exact-prefix suffix", async (reason) => {
    const fetcher = vi.fn().mockResolvedValueOnce(stream(reason, reason !== null)).mockResolvedValueOnce(completed());
    vi.stubGlobal("fetch", fetcher);
    const tokens: string[] = []; const done = vi.fn();
    await new SarvamLLM("test", null).chat([], "Be concise", t => tokens.push(t), done);
    expect(tokens.join("")).toBe("Can I help?");
    expect(done).toHaveBeenCalledWith("Can I help?", undefined);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body.stream).toBe(false);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
  it("does not replay a rewritten answer", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(stream("length")).mockResolvedValueOnce(completed("Would you like help?"));
    vi.stubGlobal("fetch", fetcher);
    const tokens: string[] = [];
    const done = vi.fn();
    await expect(new SarvamLLM("test", null).chat([], "", t => tokens.push(t), done)).rejects.toThrow("truncated");
    expect(done).not.toHaveBeenCalled();
    expect(tokens.join("")).toBe("Can I hel");
  });
  it("does not repair a normally terminated stream", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(stream("stop"));
    vi.stubGlobal("fetch", fetcher);
    await new SarvamLLM("test", null).chat([], "", () => {}, () => {});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("repairs a stream that reports stop but omits the completion sentinel", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(stream("stop", false)).mockResolvedValueOnce(completed());
    vi.stubGlobal("fetch", fetcher);
    const done = vi.fn();
    await new SarvamLLM("test", null).chat([], "", () => {}, done);
    expect(done).toHaveBeenCalledWith("Can I help?", undefined);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("discards repair output after barge-in", async () => {
    const llm = new SarvamLLM("test", null);
    const fetcher = vi.fn().mockResolvedValueOnce(stream("length")).mockImplementationOnce(async () => {
      llm.cancelInFlight();
      return completed();
    });
    vi.stubGlobal("fetch", fetcher);
    const tokens: string[] = []; const done = vi.fn();
    await llm.chat([], "", t => tokens.push(t), done);
    expect(tokens.join("")).toBe("Can I hel");
    expect(done).not.toHaveBeenCalled();
  });
});
