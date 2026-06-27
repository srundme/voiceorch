import type { Chapter } from "../types";

export const speakerRecognition: Chapter = {
  slug: "speaker-recognition",
  moduleId: "m12",
  number: "13.2",
  title: "Speaker Recognition with ECAPA-TDNN",
  summary:
    "How SnapServe builds a voiceprint for enrolled users and verifies them in real time — the ECAPA-TDNN architecture and the embedding database.",
  estMinutes: 20,
  fileRef: "artifacts/gender-service/main.py",
  prerequisites: ["gender-detection"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Beyond gender: who is this person?",
      paragraphs: [
        "Gender detection answers 'is this caller male or female?' Speaker recognition answers a harder question: 'is this caller specifically Priya Sharma, who enrolled last month?' These are fundamentally different problems. Gender is a broad category; speaker identity is an individual.",
        "SnapServe uses speaker recognition for **voiceprint-based authentication** — confirming that the caller is who they claim to be by comparing their voice to a previously enrolled sample. This is useful for call centre agents that handle sensitive operations (account changes, high-value transactions) where PIN-based verification is too slow or fraud-prone.",
        "The technology powering this is **ECAPA-TDNN** (Emphasised Channel Attention, Propagation and Aggregation in Time-Delay Neural Networks), a neural architecture from SpeechBrain that produces a 192-dimensional speaker embedding vector from a short audio clip. Two clips from the same speaker produce similar vectors; clips from different speakers produce dissimilar vectors.",
      ],
    },
    {
      kind: "concept",
      title: "How speaker embeddings work",
      body: [
        "A **speaker embedding** is a compact numerical fingerprint of a voice. Feed any audio clip from a speaker into the ECAPA-TDNN model, and it produces a 192-number vector. The model is trained on thousands of speakers so that embeddings from the same speaker cluster tightly, and embeddings from different speakers are far apart.",
        "The 'far apart' and 'close together' are measured by **cosine similarity** — a number between -1 and 1, where 1 means identical vectors, 0 means unrelated, and -1 means opposite. In practice, genuine matches score > 0.85; impostors score < 0.6. The threshold between 'accept' and 'reject' is configurable per use case.",
        "Enrollment: record a 3-5 second clip from the user, run it through ECAPA-TDNN, and store the 192-float vector in the database. Verification: capture a 2-3 second clip from the live call, produce a fresh embedding, and compute cosine similarity against the stored enrollment embedding. Above threshold → verified.",
      ],
    },
    {
      kind: "code",
      filename: "gender-service/main.py",
      language: "python",
      intro:
        "Enrollment endpoint: receive audio, compute embedding, store in the database. The `spkrec_model` is the ECAPA-TDNN model loaded from SpeechBrain at startup.",
      code: `@app.post("/enroll")
async def enroll_speaker(request: EnrollRequest) -> EnrollResult:
    # Decode PCM bytes
    pcm = np.frombuffer(request.audio_bytes, dtype=np.int16).astype(np.float32)
    pcm_tensor = torch.tensor(pcm / 32768.0).unsqueeze(0)  # [1, samples]

    with torch.no_grad():
        embedding = spkrec_model.encode_batch(pcm_tensor)
        embedding_np = embedding.squeeze().cpu().numpy()  # shape: (192,)

    # Normalise to unit sphere (required for cosine similarity)
    norm = np.linalg.norm(embedding_np)
    embedding_norm = embedding_np / (norm + 1e-8)

    # Persist in voice_prints table as JSON text
    await db.execute(
        "INSERT INTO voice_prints (user_id, agent_id, embedding, created_at) "
        "VALUES ($1, $2, $3, now()) ON CONFLICT (user_id, agent_id) DO UPDATE "
        "SET embedding = excluded.embedding, created_at = now()",
        request.user_id, request.agent_id,
        json.dumps(embedding_norm.tolist())
    )

    return EnrollResult(success=True, dims=len(embedding_norm))`,
      lines: [
        {
          lines: "4-5",
          label: "PCM → tensor",
          explanation:
            "PyTorch tensors are what ECAPA-TDNN consumes. The int16 PCM buffer is normalised to float32 [-1, 1] and given a batch dimension: `unsqueeze(0)` turns `[samples]` into `[1, samples]`. The model processes batches, so shape `[batch, samples]` is required.",
        },
        {
          lines: "7-8",
          label: "encode_batch",
          explanation:
            "`spkrec_model.encode_batch()` is SpeechBrain's ECAPA-TDNN embedding extractor. It returns a tensor of shape `[batch, time, 192]`. `squeeze()` removes the batch and time dimensions (for a single clip, these are 1). The result is a 192-float numpy array — the speaker fingerprint.",
        },
        {
          lines: "11-12",
          label: "L2 normalisation",
          explanation:
            "Normalising to the unit sphere (L2 norm = 1) transforms cosine similarity into a dot product: `sim = embed_a @ embed_b`. Dot products are faster than the full cosine formula and numerically identical for normalised vectors. The `1e-8` prevents division by zero for silent audio.",
        },
        {
          lines: "14-21",
          label: "UPSERT into voice_prints",
          explanation:
            "The embedding is stored as a JSON array of 192 floats in the `voice_prints` table. An UPSERT (INSERT … ON CONFLICT … DO UPDATE) means re-enrolling overwrites the existing print. There's exactly one voiceprint per `(user_id, agent_id)` pair.",
        },
      ],
    },
    {
      kind: "code",
      filename: "gender-service/main.py",
      language: "python",
      intro:
        "The verification endpoint: compute a fresh embedding from the caller's audio and compare it to the enrolled voiceprint via cosine similarity.",
      code: `@app.post("/verify")
async def verify_speaker(request: VerifyRequest) -> VerifyResult:
    # Load enrolled embedding from DB
    row = await db.fetchrow(
        "SELECT embedding FROM voice_prints "
        "WHERE user_id = $1 AND agent_id = $2",
        request.user_id, request.agent_id
    )
    if not row:
        return VerifyResult(verified=False, score=0.0, reason="not_enrolled")

    enrolled = np.array(json.loads(row["embedding"]), dtype=np.float32)

    # Compute fresh embedding from caller audio
    pcm = np.frombuffer(request.audio_bytes, dtype=np.int16).astype(np.float32)
    pcm_tensor = torch.tensor(pcm / 32768.0).unsqueeze(0)
    with torch.no_grad():
        live_embed = spkrec_model.encode_batch(pcm_tensor)
        live_np = live_embed.squeeze().cpu().numpy()
        live_norm = live_np / (np.linalg.norm(live_np) + 1e-8)

    # Cosine similarity = dot product of normalised vectors
    score = float(np.dot(enrolled, live_norm))
    verified = score >= VERIFICATION_THRESHOLD  # default 0.82

    return VerifyResult(verified=verified, score=score)`,
      lines: [
        {
          lines: "22",
          label: "cosine similarity as dot product",
          explanation:
            "Both vectors are normalised to unit length. The dot product of two unit vectors is their cosine similarity. This avoids the full `cos θ = (a·b) / (|a||b|)` formula — division by norms that are already 1.0.",
        },
        {
          lines: "23",
          label: "VERIFICATION_THRESHOLD",
          explanation:
            "The 0.82 threshold is empirically chosen. At 0.82, false acceptance rate (impostors accepted) is < 1% on the training set. Raise the threshold for higher security (more false rejections); lower it for more lenient verification (more false acceptances). It's tunable via an env var.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Voice prints in the database",
      paragraphs: [
        "The `voice_prints` table has three key columns: `user_id` (the SnapServe user), `agent_id` (which agent's voiceprint this is for — the same user might have different prints for different agents, e.g. one for their sales agent, one for their support agent), `embedding` (192 floats as JSON text).",
        "Storing embeddings as JSON text in PostgreSQL is unconventional. A more performant system would use pgvector's `vector(192)` column type and build an IVFFLAT index for approximate nearest-neighbour search. For SnapServe's current scale (one enrolled user per agent, exact cosine match), JSON text + in-Python dot product is perfectly sufficient and requires no extension.",
        "The enrollment and verification endpoints run on the gender service's FastAPI server (port 5000), the same server as the gender detector. They share the ECAPA-TDNN model to avoid loading it twice.",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Ephemeral vs. persistent voice prints",
      body: [
        "The in-call speaker verifier (covered in the next chapter) uses an **ephemeral** voice print: a reference embedding computed at session start from a pre-enrolled clip, cached in Node.js process memory for the call's lifetime. The DB-persisted prints in `voice_prints` are for persistent enrollment — a print that survives across calls and can be re-used each time the same user calls.",
        "The two systems are independent. An agent can use ephemeral-only (anonymous callers verified against a clip stored in the session), persistent-only (enrolled users verified against the DB), or both.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why are speaker embeddings normalised to the unit sphere before storing?",
          choices: [
            "To reduce storage size from 192 floats to 192 bytes",
            "So cosine similarity reduces to a dot product, which is faster and numerically stable",
            "Because ECAPA-TDNN requires normalised inputs",
            "To prevent the embedding values from exceeding PostgreSQL's float range",
          ],
          correctIndex: 1,
          explanation:
            "Normalising to unit length means `cos θ = a·b` (because |a|=|b|=1). The dot product is computationally cheaper than the full cosine formula and numerically identical for unit vectors.",
        },
        {
          prompt: "What does a cosine similarity score of 0.9 between two speaker embeddings indicate?",
          choices: [
            "The speakers share 90% of the same phonemes",
            "The voices are 90% the same gender",
            "The two audio clips are very likely from the same speaker",
            "The embedding model is 90% confident",
          ],
          correctIndex: 2,
          explanation:
            "Cosine similarity of 0.9 (on a -1 to 1 scale) is very high similarity. For ECAPA-TDNN embeddings, a score above ~0.82 indicates the two clips are from the same speaker with high probability.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "ECAPA-TDNN (SpeechBrain) produces a 192-dimensional speaker embedding — a compact voice fingerprint",
        "Enrollment: audio → embedding → normalise → store as JSON in `voice_prints`",
        "Verification: live audio → fresh embedding → cosine similarity vs. enrolled → above threshold = verified",
        "L2-normalise embeddings so cosine similarity = dot product (faster, numerically stable)",
        "JSON text storage is sufficient for current scale; pgvector would be needed for thousands of enrolled speakers",
      ],
    },
  ],
};
