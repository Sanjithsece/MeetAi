"""Local transcription helper for MeetAI.

Runs faster-whisper (CTranslate2) entirely offline once the model weights have
been downloaded, and writes plain text to the output path. Invoked by
server/src/services/transcription/whisper.js - not meant to be run by hand.
"""
import argparse
import sys


def transcribe(args, device: str, compute_type: str) -> int:
    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device=device, compute_type=compute_type)
    segments, _info = model.transcribe(
        args.audio,
        language=args.language or None,
        vad_filter=True,
    )

    lines = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            lines.append(text)
            print(f"progress {segment.end:.0f}s", file=sys.stderr, flush=True)

    with open(args.output, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
        if lines:
            handle.write("\n")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default="")
    parser.add_argument("--device", default="cpu", help="cpu | cuda | auto")
    args = parser.parse_args()

    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        print("faster-whisper is not installed", file=sys.stderr)
        return 2

    device = args.device or "cpu"
    compute_type = "float16" if device == "cuda" else "int8"

    try:
        return transcribe(args, device, compute_type)
    except Exception as error:  # noqa: BLE001 - any GPU failure should fall back
        if device == "cpu":
            print(f"transcription failed: {error}", file=sys.stderr)
            return 1
        # A missing or mismatched CUDA/cuBLAS install is common on Windows.
        print(f"{device} transcription failed ({error}); retrying on CPU", file=sys.stderr, flush=True)
        try:
            return transcribe(args, "cpu", "int8")
        except Exception as cpu_error:  # noqa: BLE001
            print(f"transcription failed on CPU as well: {cpu_error}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
