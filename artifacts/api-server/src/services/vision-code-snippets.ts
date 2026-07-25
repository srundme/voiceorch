export function generateCodeSnippets(
  agentId: number,
  apiKey: string,
  baseUrl: string,
): {
  curl: string;
  javascript: string;
  python: string;
  webhook: string;
} {
  const stageUrl = `${baseUrl}/vision-agents/${agentId}/media/stage`;
  const sessionUrl = `${baseUrl}/agents/${agentId}/sessions`;

  const curl = `# Stage an image before a call
curl -X POST "${stageUrl}" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "mimeType": "image/jpeg",
    "data": "<base64-encoded-image>",
    "fileName": "document.jpg",
    "phone": "+911234567890"
  }'

# The agent will automatically use this image when the caller dials in
# To trigger a session manually:
curl -X POST "${sessionUrl}" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ "phone": "+911234567890" }'`;

  const javascript = `// Vision Agent — JavaScript SDK pattern (no external dependencies)

const API_BASE = "${baseUrl}";
const API_KEY = "${apiKey}";
const AGENT_ID = ${agentId};

async function stageImage(imagePath, phone) {
  const fs = await import("fs");
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString("base64");
  const mimeType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

  const response = await fetch(\`\${API_BASE}/vision-agents/\${AGENT_ID}/media/stage\`, {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mimeType, data: base64, phone }),
  });

  if (!response.ok) throw new Error(\`Stage failed: \${response.status}\`);
  return response.json(); // { mediaId, url }
}

async function listMedia() {
  const response = await fetch(\`\${API_BASE}/vision-agents/\${AGENT_ID}/media\`, {
    headers: { "Authorization": \`Bearer \${API_KEY}\` },
  });
  return response.json();
}

// Usage
const { mediaId, url } = await stageImage("./document.jpg", "+911234567890");
console.log("Staged media ID:", mediaId, "URL:", url);`;

  const python = `import base64
import requests

API_BASE = "${baseUrl}"
API_KEY = "${apiKey}"
AGENT_ID = ${agentId}
HEADERS = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

def stage_image(image_path: str, phone: str) -> dict:
    """Stage an image for a vision agent call."""
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    mime_type = "image/png" if image_path.endswith(".png") else "image/jpeg"

    resp = requests.post(
        f"{API_BASE}/vision-agents/{AGENT_ID}/media/stage",
        headers=HEADERS,
        json={"mimeType": mime_type, "data": image_data, "phone": phone},
    )
    resp.raise_for_status()
    return resp.json()  # { mediaId, url }

def list_media() -> list:
    """List recent media for this agent."""
    resp = requests.get(f"{API_BASE}/vision-agents/{AGENT_ID}/media", headers=HEADERS)
    resp.raise_for_status()
    return resp.json()

# Usage
result = stage_image("document.jpg", "+911234567890")
print(f"Staged media ID: {result['mediaId']}, URL: {result['url']}")`;

  const webhook = `// Sample webhook payload sent by the vision agent to your connections
// when a vision_extract tool completes with saveToDbSchemaId configured.
//
// Your endpoint will receive a POST to your configured webhook URL with:
{
  "event": "extract_complete",
  "agentId": ${agentId},
  "callId": 1234,
  "mediaId": 42,
  "schemaId": 1,
  "extractedData": {
    "name": "John Doe",
    "date_of_birth": "1990-05-15",
    "id_number": "DL1234567",
    "expiry": "2030-12-31"
  },
  "confidence": "high",
  "timestamp": "2025-01-01T12:00:00.000Z"
}

// Respond with HTTP 200 to acknowledge receipt.
// The agent will retry up to 3 times on non-2xx responses.`;

  return { curl, javascript, python, webhook };
}
