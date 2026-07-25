export interface VisionAnalysisRequest {
  imageData: Buffer | null; // null if urlRef
  urlRef?: string;
  mimeType: string;
  prompt: string;
  outputSchema?: Record<string, unknown>; // for structured extraction
}

export interface VisionAnalysisResult {
  text: string;
  parsed?: Record<string, unknown>; // populated when outputSchema provided
  providerModel: string;
  cachedHit: boolean;
}

export interface IVisionProvider {
  name: string;
  analyze(req: VisionAnalysisRequest): Promise<VisionAnalysisResult>;
}
