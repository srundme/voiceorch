"""Fine-tune Whisper on human-transcribed Indian English.

Source: ishands/commonvoice-indian_accent (Mozilla Common Voice, CC0).
Saves a separate checkpoint. Does not replace the ear that is on calls.
"""
from __future__ import annotations

import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import soxr
import torch
from peft import LoraConfig, get_peft_model
from torch.utils.data import DataLoader, Dataset
from transformers import WhisperForConditionalGeneration, WhisperProcessor

DATA = Path("/workspace/voices/stt-data/cv-india/data")
CLIP_DIR = Path("/workspace/voices/stt-data/cv-india/clips")
MANIFEST = Path("/workspace/voices/stt-data/cv-india/manifest.jsonl")
MODEL_ID = "/workspace/models/whisper-large-v3-turbo-hf"
OUT_DIR = Path("/workspace/voices/stt-ft/whisper-cv-india-2026-09-27")
TRAIN_BUDGET_MS = 20 * 3600 * 1000
PER_SPEAKER_MS = 60_000
CHECK_N = 16


def speaker_bucket(client_id: str) -> int:
    return int(client_id[:8], 16) % 20


def decode_mp3(blob: bytes) -> np.ndarray:
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"],
        input=blob,
        capture_output=True,
        check=True,
    )
    audio = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    narrow = soxr.resample(audio, 16000, 8000).astype(np.float32)
    return soxr.resample(narrow, 8000, 16000).astype(np.float32)


def write_wav(path: Path, audio: np.ndarray) -> None:
    pcm = np.clip(audio * 32768.0, -32768, 32767).astype(np.int16)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(pcm.tobytes())


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as handle:
        frames = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16)
    return frames.astype(np.float32) / 32768.0


def build_manifest() -> list[dict]:
    if MANIFEST.exists() and CLIP_DIR.exists() and any(CLIP_DIR.glob("*.wav")):
        rows = [json.loads(line) for line in MANIFEST.read_text().splitlines() if line.strip()]
        print(json.dumps({"manifest": len(rows), "reused": True}), flush=True)
        return rows

    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    speaker_ms: dict[str, int] = {}
    train_ms = 0
    holdout: list[dict] = []
    rows: list[dict] = []
    files = sorted(DATA.glob("*.parquet"))
    for path in files:
        table = pq.read_table(path, columns=["client_id", "sentence", "duration_ms", "audio"])
        clients = table.column("client_id").to_pylist()
        sentences = table.column("sentence").to_pylist()
        durations = table.column("duration_ms").to_pylist()
        audios = table.column("audio").to_pylist()
        for index, (client, sentence, duration, audio) in enumerate(zip(clients, sentences, durations, audios)):
            text = (sentence or "").strip()
            duration = int(duration or 0)
            if not client or not text or duration < 800 or duration > 12000:
                continue
            blob = audio.get("bytes") if isinstance(audio, dict) else None
            if not blob:
                continue
            split = "holdout" if speaker_bucket(client) == 0 else "train"
            if split == "train":
                if train_ms >= TRAIN_BUDGET_MS:
                    continue
                used = speaker_ms.get(client, 0)
                if used >= PER_SPEAKER_MS:
                    continue
                speaker_ms[client] = used + duration
                train_ms += duration
            else:
                if len(holdout) >= CHECK_N:
                    continue
            clip_id = f"{path.stem}-{index}"
            wav_path = CLIP_DIR / f"{clip_id}.wav"
            try:
                write_wav(wav_path, decode_mp3(blob))
            except subprocess.CalledProcessError:
                continue
            row = {"id": clip_id, "file": wav_path.name, "text": text, "split": split, "ms": duration}
            rows.append(row)
            if split == "holdout":
                holdout.append(row)
        del table, audios
        print(json.dumps({"file": path.name, "kept": len(rows), "train_hours": round(train_ms / 3600000, 2)}), flush=True)
        if train_ms >= TRAIN_BUDGET_MS and len(holdout) >= CHECK_N:
            break

    MANIFEST.write_text("".join(json.dumps(row) + "\n" for row in rows))
    print(json.dumps({
        "clips": len(rows),
        "train": sum(1 for row in rows if row["split"] == "train"),
        "holdout": sum(1 for row in rows if row["split"] == "holdout"),
        "train_hours": round(train_ms / 3600000, 2),
        "speakers": len(speaker_ms),
    }), flush=True)
    return rows


class ClipDataset(Dataset):
    def __init__(self, rows: list[dict]):
        self.rows = rows

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict:
        row = self.rows[index]
        return {"audio": read_wav(CLIP_DIR / row["file"]), "text": row["text"]}


class Collator:
    def __init__(self, processor: WhisperProcessor):
        self.processor = processor

    def __call__(self, features: list[dict]) -> dict:
        inputs = self.processor.feature_extractor(
            [feature["audio"] for feature in features],
            sampling_rate=16000,
            return_tensors="pt",
            padding="max_length",
            truncation=True,
        )
        labels = self.processor.tokenizer(
            [feature["text"] for feature in features],
            return_tensors="pt",
            padding=True,
        ).input_ids
        labels[labels == self.processor.tokenizer.pad_token_id] = -100
        return {"input_features": inputs.input_features, "labels": labels}


def transcribe(model, processor, audio: np.ndarray) -> str:
    inputs = processor.feature_extractor(
        audio, sampling_rate=16000, return_tensors="pt", padding="max_length", truncation=True
    )
    features = inputs.input_features.to(model.device, dtype=next(model.parameters()).dtype)
    with torch.no_grad():
        ids = model.generate(features, language="en", task="transcribe", max_new_tokens=128)
    return processor.batch_decode(ids, skip_special_tokens=True)[0].strip()


def report(model, processor, rows: list[dict], title: str) -> None:
    print(title, flush=True)
    for row in rows:
        heard = transcribe(model, processor, read_wav(CLIP_DIR / row["file"]))
        print(json.dumps({"id": row["id"], "target": row["text"], "heard": heard}), flush=True)


def main() -> None:
    torch.cuda.set_per_process_memory_fraction(0.22)
    rows = build_manifest()
    train_rows = [row for row in rows if row["split"] == "train"]
    check_rows = [row for row in rows if row["split"] == "holdout"][:CHECK_N]
    if not train_rows or not check_rows:
        raise SystemExit("no training clips")

    processor = WhisperProcessor.from_pretrained(MODEL_ID, language="en", task="transcribe")
    base = WhisperForConditionalGeneration.from_pretrained(MODEL_ID, dtype=torch.bfloat16)
    base.config.use_cache = False
    base.generation_config.language = "en"
    base.generation_config.task = "transcribe"
    base.generation_config.forced_decoder_ids = None
    base.cuda()
    base.eval()
    report(base, processor, check_rows, "--- before ---")
    del base
    torch.cuda.empty_cache()

    model = WhisperForConditionalGeneration.from_pretrained(MODEL_ID, dtype=torch.bfloat16)
    model.config.use_cache = False
    model.generation_config.language = "en"
    model.generation_config.task = "transcribe"
    model.generation_config.forced_decoder_ids = None
    model = get_peft_model(
        model,
        LoraConfig(r=16, lora_alpha=32, target_modules=["q_proj", "v_proj"], lora_dropout=0.05, bias="none"),
    )
    model.enable_input_require_grads()
    model.gradient_checkpointing_enable()
    model.print_trainable_parameters()
    model.cuda()

    loader = DataLoader(ClipDataset(train_rows), batch_size=2, shuffle=True, collate_fn=Collator(processor), num_workers=0)
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=3e-5)
    for epoch in range(1):
        model.train()
        total = 0.0
        steps = 0
        for batch in loader:
            batch = {key: value.cuda() for key, value in batch.items()}
            batch["input_features"] = batch["input_features"].to(dtype=torch.bfloat16)
            loss = model(**batch).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            total += float(loss.item())
            steps += 1
            if steps % 50 == 0:
                print(f"epoch {epoch} step {steps} loss {total / steps:.4f}", flush=True)
        print(f"epoch {epoch} loss {total / max(steps, 1):.4f}", flush=True)
        model.eval()
        report(model, processor, check_rows, f"--- epoch {epoch} ---")

    merged = model.merge_and_unload()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    merged.save_pretrained(OUT_DIR)
    processor.save_pretrained(OUT_DIR)
    print(json.dumps({"saved": str(OUT_DIR)}), flush=True)


if __name__ == "__main__":
    sys.exit(main() or 0)
