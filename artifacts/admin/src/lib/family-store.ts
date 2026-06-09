import { useState, useEffect } from 'react';

export type CompanyCategory = 'health' | 'general' | 'life';
export type AgentStatus = 'draft' | 'training' | 'testing' | 'approved' | 'published';
export type PolicyProductType = 'motor' | 'health' | 'life' | 'travel' | 'home' | 'other';

export interface InsuranceCompany {
  id: string;
  name: string;
  logoColor: string;
  category: CompanyCategory;
}

export interface InsurancePolicy {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  description?: string;
  productType: PolicyProductType;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface PolicyDocument {
  id: string;
  policyId: string;
  policyName: string;
  companyName: string;
  title: string;
  content: string;
  sourceType: 'text' | 'pdf_text' | 'url' | 'faq';
  chunkCount: number;
  indexed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptVariable {
  key: string;
  defaultValue: string;
  description?: string;
}

export interface CallTransferTool {
  type: 'call_transfer';
  name: string;
  description: string;
  transferTo: string;
  warmHandoffMessage?: string;
  transferMode?: 'cold' | 'warm_summary';
  summaryPrompt?: string;
}

export interface DispositionField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'choice';
  required?: boolean;
  options?: string;
}

export type AgentType = 'general_purpose' | 'outbound_sales' | 'inbound_support' | 'appointment_booking' | 'lead_qualification';

export interface InsuranceAgent {
  id: string;
  companyId: string;
  companyName: string;
  policyId?: string;
  policyName?: string;
  name: string;
  description?: string;
  status: AgentStatus;
  systemPrompt: string;
  voiceId: string;
  kbEntries: number;
  totalCalls: number;
  successfulCalls: number;
  conversionRate: number;
  avgDurationSeconds: number;
  lastUpdated: string;

  agentType?: AgentType;
  agentMode?: 'managed' | 'byop';

  /* Backend link — set when agent is provisioned for webcall testing */
  backendAgentId?: number;

  /* Memory */
  memoryEnabled?: boolean;
  crossCallMemoryEnabled?: boolean;
  contextWindowMessages?: number;

  /* Auto Callback */
  autoCallbackEnabled?: boolean;
  autoCallbackRetries?: number;
  autoCallbackDelaySeconds?: number;

  /* Ambient noise */
  ambientSoundId?: string;

  asrProvider?: string;
  asrModel?: string;
  asrLanguage?: string;
  asrBackgroundDenoising?: boolean;
  asrConfidenceThreshold?: number;
  asrEndOfTurnConfidence?: number;
  asrEndOfTurnTimeout?: number;
  asrKeyterms?: string;
  asrSmartEndpointing?: 'off' | 'vapi' | 'livekit';
  asrAutoFallback?: boolean;

  llmProvider?: string;
  llmModel?: string;
  temperature?: number;

  ttsProvider?: string;
  ttsVoice?: string;
  ttsModel?: string;

  telephonyProvider?: string;

  language?: string;
  timezone?: string;
  greetingMessage?: string;
  endCallPhrases?: string;
  silenceTimeoutSeconds?: number;
  backchannelingEnabled?: boolean;
  backchannelingFrequency?: number;
  backchannelPhrases?: string;
  noiseCancellationEnabled?: boolean;
  inactivityMessage?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  maxDuration?: number;
  maxConcurrentCalls?: number;
  monthlySpendLimitCents?: number;

  vadSilenceMs?: number;
  bargeInEnabled?: boolean;
  bargeInEnergyThreshold?: number;
  bargeInMinFrames?: number;

  promptVariables?: PromptVariable[];
  tools?: CallTransferTool[];
  dispositionSchema?: DispositionField[];
}

/* ── Call record ─────────────────────────────────────────────────────────── */

export type CallStatus = 'completed' | 'failed' | 'missed' | 'in_progress';

export interface InsuranceCall {
  id: string;
  agentId: string;
  status: CallStatus;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  callerPhone?: string;
  /* Transcript — each line is "role: text" */
  transcript?: string;
  summary?: string;
  recordingUrl?: string;
  metadata?: Record<string, string>;
  /* Disposition data keyed by DispositionField.key */
  dispositionData?: Record<string, string | number | boolean>;
  /* Backend call ID from the calls table, if available */
  backendCallId?: number;
}

export const DEFAULT_COMPANIES: InsuranceCompany[] = [
  { id: '1',  name: 'ICICI Lombard',        logoColor: '#F26522', category: 'general' },
  { id: '2',  name: 'HDFC ERGO',            logoColor: '#B61F24', category: 'general' },
  { id: '3',  name: 'Star Health',          logoColor: '#00539B', category: 'health'  },
  { id: '4',  name: 'Niva Bupa',            logoColor: '#5C2D91', category: 'health'  },
  { id: '5',  name: 'Tata AIG',             logoColor: '#17519E', category: 'general' },
  { id: '6',  name: 'SBI General',          logoColor: '#0033A0', category: 'general' },
  { id: '7',  name: 'Bajaj Allianz',        logoColor: '#0079C1', category: 'general' },
  { id: '8',  name: 'Reliance General',     logoColor: '#E31837', category: 'general' },
  { id: '9',  name: 'United India',         logoColor: '#005A9C', category: 'general' },
  { id: '10', name: 'New India Assurance',  logoColor: '#1B3F95', category: 'general' },
  { id: '11', name: 'National Insurance',   logoColor: '#E31837', category: 'general' },
  { id: '12', name: 'Oriental Insurance',   logoColor: '#006B3F', category: 'general' },
  { id: '13', name: 'Future Generali',      logoColor: '#E31837', category: 'general' },
  { id: '14', name: 'Iffco Tokio',          logoColor: '#F37021', category: 'general' },
  { id: '15', name: 'Royal Sundaram',       logoColor: '#004A8F', category: 'general' },
  { id: '16', name: 'Liberty General',      logoColor: '#003DA5', category: 'general' },
  { id: '17', name: 'Magma HDI',            logoColor: '#EC1C24', category: 'general' },
  { id: '18', name: 'Cholamandalam',        logoColor: '#002E6D', category: 'general' },
  { id: '19', name: 'Shriram General',      logoColor: '#D0232A', category: 'general' },
  { id: '20', name: 'Digit Insurance',      logoColor: '#FF6600', category: 'general' },
  { id: '21', name: 'Acko',                 logoColor: '#36B37E', category: 'general' },
  { id: '22', name: 'Go Digit',             logoColor: '#FF6600', category: 'general' },
  { id: '23', name: 'Care Health',          logoColor: '#E31837', category: 'health'  },
  { id: '24', name: 'Max Bupa',             logoColor: '#00704A', category: 'health'  },
  { id: '25', name: 'Aditya Birla Health',  logoColor: '#C4122E', category: 'health'  },
  { id: '26', name: 'ManipalCigna',         logoColor: '#E31837', category: 'health'  },
  { id: '27', name: 'Religare Health',      logoColor: '#003DA5', category: 'health'  },
  { id: '28', name: 'Apollo Munich',        logoColor: '#005DAA', category: 'health'  },
  { id: '29', name: 'Edelweiss General',    logoColor: '#143C8C', category: 'general' },
  { id: '30', name: 'Universal Sompo',      logoColor: '#D31145', category: 'general' },
  { id: '31', name: 'Kotak General',        logoColor: '#ED1C24', category: 'general' },
  { id: '32', name: 'Zuno General',         logoColor: '#00A9E0', category: 'general' },
];

const STORE_VERSION = 'v4';

export function useFamilyStore() {
  const [companies] = useState<InsuranceCompany[]>(DEFAULT_COMPANIES);
  const [agents, setAgents] = useState<InsuranceAgent[]>([]);
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [documents, setDocuments] = useState<PolicyDocument[]>([]);
  const [calls, setCalls] = useState<InsuranceCall[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('family_store_version') !== STORE_VERSION) {
      localStorage.removeItem('family_agents');
      localStorage.removeItem('family_kb');
      localStorage.removeItem('family_policies');
      localStorage.removeItem('family_docs');
      localStorage.removeItem('family_calls');
      localStorage.setItem('family_store_version', STORE_VERSION);
    }

    const storedAgents   = localStorage.getItem('family_agents');
    const storedPolicies = localStorage.getItem('family_policies');
    const storedDocs     = localStorage.getItem('family_docs');
    const storedCalls    = localStorage.getItem('family_calls');

    setAgents(storedAgents   ? (JSON.parse(storedAgents)   as InsuranceAgent[])  : []);
    setPolicies(storedPolicies ? (JSON.parse(storedPolicies) as InsurancePolicy[]) : []);
    setDocuments(storedDocs  ? (JSON.parse(storedDocs)     as PolicyDocument[])  : []);
    setCalls(storedCalls     ? (JSON.parse(storedCalls)    as InsuranceCall[])   : []);
    setIsLoaded(true);
  }, []);

  const saveAgents = (next: InsuranceAgent[]) => {
    setAgents(next);
    localStorage.setItem('family_agents', JSON.stringify(next));
  };

  const savePolicies = (next: InsurancePolicy[]) => {
    setPolicies(next);
    localStorage.setItem('family_policies', JSON.stringify(next));
  };

  const saveDocuments = (next: PolicyDocument[]) => {
    setDocuments(next);
    localStorage.setItem('family_docs', JSON.stringify(next));
  };

  const saveCalls = (next: InsuranceCall[]) => {
    setCalls(next);
    localStorage.setItem('family_calls', JSON.stringify(next));
  };

  const addCall = (call: InsuranceCall) => {
    const next = [call, ...calls];
    saveCalls(next);
  };

  const updateCall = (id: string, patch: Partial<InsuranceCall>) => {
    const next = calls.map(c => c.id === id ? { ...c, ...patch } : c);
    saveCalls(next);
  };

  return {
    companies, agents, policies, documents, calls,
    saveAgents, savePolicies, saveDocuments, saveCalls, addCall, updateCall,
    isLoaded,
  };
}
