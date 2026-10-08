import { describe, expect, it } from "vitest";
import { buildRecorderArgs, RECORDER_REQUIREMENTS } from "../src/services/recording/recorders/index.js";

const base = { outputPath: "C:/meetai/recordings/1/meeting.mp4", frameRate: 15, maxSeconds: 3600 };

describe("buildRecorderArgs", () => {
  it("builds a Windows gdigrab + dshow command", () => {
    const args = buildRecorderArgs("ffmpeg-windows", { ...base, audioDevice: "Stereo Mix (Realtek Audio)" });
    expect(args.join(" ")).toContain("-f gdigrab");
    expect(args.join(" ")).toContain("-i desktop");
    expect(args).toContain("audio=Stereo Mix (Realtek Audio)");
    expect(args).toContain("-c:a");
    expect(args.at(-1)).toBe(base.outputPath);
  });

  it("omits the audio input when no device is configured", () => {
    const args = buildRecorderArgs("ffmpeg-windows", { ...base, audioDevice: "" });
    expect(args.join(" ")).not.toContain("dshow");
    expect(args).not.toContain("-c:a");
  });

  it("caps the recording length when maxSeconds is set", () => {
    const args = buildRecorderArgs("ffmpeg-windows", { ...base, audioDevice: "Mic", maxSeconds: 60 });
    const index = args.indexOf("-t");
    expect(index).toBeGreaterThan(-1);
    expect(args[index + 1]).toBe("60");
  });

  it("builds an x11grab command on Linux", () => {
    const args = buildRecorderArgs("ffmpeg-linux", { ...base, audioDevice: "default.monitor" });
    expect(args.join(" ")).toContain("-f x11grab");
    expect(args.join(" ")).toContain("-f pulse");
  });

  it("builds an avfoundation command on macOS", () => {
    const args = buildRecorderArgs("ffmpeg-macos", { ...base, audioDevice: "2" });
    expect(args.join(" ")).toContain("avfoundation");
    expect(args).toContain("1:2");
  });

  it("rejects an unknown recorder mode", () => {
    expect(() => buildRecorderArgs("ffmpeg-atari", base)).toThrow(/Unsupported recorder mode/);
  });

  it("documents the OS-level requirements for every supported mode", () => {
    for (const mode of ["ffmpeg-windows", "ffmpeg-linux", "ffmpeg-macos"]) {
      expect(RECORDER_REQUIREMENTS[mode]).toBeTruthy();
    }
  });
});

describe("dshow device parsing", () => {
  it("parses FFmpeg 9 device listings (which exit 0) and de-duplicates", async () => {
    const { parseDshowAudioDevices } = await import("../src/services/media/ffmpeg.js");
    const output = [
      '[in#0 @ 000002] "USB2.0 HD UVC WebCam" (video)',
      '[in#0 @ 000002] "Microphone Array (Realtek(R) Audio)" (audio)',
      '[in#0 @ 000002]   Alternative name "@device_cm_{33D9A762}\wave_{ABC}"',
      '[in#0 @ 000002] "Stereo Mix (Realtek(R) Audio)" (audio)',
      '[in#0 @ 000002] "Stereo Mix (Realtek(R) Audio)" (audio)'
    ].join("\n");
    expect(parseDshowAudioDevices(output)).toEqual(["Microphone Array (Realtek(R) Audio)", "Stereo Mix (Realtek(R) Audio)"]);
    expect(parseDshowAudioDevices("")).toEqual([]);
  });
});
