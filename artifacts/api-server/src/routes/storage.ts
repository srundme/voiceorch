/**
 * Minimal object storage serving route for call recordings.
 * Streams objects directly from GCS to the client.
 *
 * GET /storage/objects/*  — serve a stored object (e.g. a recording WAV)
 */
import { Router, type IRouter } from "express";
import { Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeGcsClient(): Storage {
  return new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${SIDECAR}/token`,
      type: "external_account",
      credential_source: {
        url: `${SIDECAR}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    } as any,
    projectId: "",
  });
}

const gcs = makeGcsClient();

const router: IRouter = Router();

router.get("/storage/objects/*path", async (req, res): Promise<void> => {
  const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!bucketId) {
    res.status(503).json({ error: "Object storage not configured" });
    return;
  }

  const raw = (req.params as { path?: string | string[] }).path ?? "";
  const objectPath = Array.isArray(raw) ? raw.join("/") : raw;
  if (!objectPath) {
    res.status(400).json({ error: "Missing object path" });
    return;
  }

  try {
    const file = gcs.bucket(bucketId).file(objectPath);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    const [meta] = await file.getMetadata();
    const contentType = (meta["contentType"] as string | undefined) ?? "application/octet-stream";
    const size        = meta["size"] as string | number | undefined;

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=86400");
    if (size != null) res.setHeader("Content-Length", String(size));

    file.createReadStream().pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to serve object" });
    }
  }
});

export default router;
