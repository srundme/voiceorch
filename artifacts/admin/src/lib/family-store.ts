import { useState, useEffect } from 'react';

export type CompanyCategory = 'health' | 'general' | 'life';
export type AgentStatus = 'draft' | 'training' | 'testing' | 'approved' | 'published';
export type KBType = 'policy' | 'faq' | 'objection' | 'pricing';

export interface InsuranceCompany {
  id: string;
  name: string;
  logoColor: string;
  category: CompanyCategory;
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

export interface InsuranceAgent {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  description?: string;
  status: AgentStatus;
  systemPrompt: string;
  voiceId: string;
  kbEntries: number;
  totalCalls: number;
  conversionRate: number;
  lastUpdated: string;

  agentMode?: 'managed' | 'byop';

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

export interface KnowledgeEntry {
  id: string;
  agentId: string;
  agentName: string;
  companyName: string;
  type: KBType;
  question: string;
  answer: string;
  updatedAt: string;
}

export const DEFAULT_COMPANIES: InsuranceCompany[] = [
  { id: '1', name: 'ICICI Lombard', logoColor: '#F26522', category: 'general' },
  { id: '2', name: 'HDFC ERGO', logoColor: '#B61F24', category: 'general' },
  { id: '3', name: 'Star Health', logoColor: '#00539B', category: 'health' },
  { id: '4', name: 'Niva Bupa', logoColor: '#5C2D91', category: 'health' },
  { id: '5', name: 'Tata AIG', logoColor: '#17519E', category: 'general' },
  { id: '6', name: 'SBI General', logoColor: '#0033A0', category: 'general' },
  { id: '7', name: 'Bajaj Allianz', logoColor: '#0079C1', category: 'general' },
  { id: '8', name: 'Reliance General', logoColor: '#E31837', category: 'general' },
  { id: '9', name: 'United India', logoColor: '#005A9C', category: 'general' },
  { id: '10', name: 'New India Assurance', logoColor: '#1B3F95', category: 'general' },
  { id: '11', name: 'National Insurance', logoColor: '#E31837', category: 'general' },
  { id: '12', name: 'Oriental Insurance', logoColor: '#006B3F', category: 'general' },
  { id: '13', name: 'Future Generali', logoColor: '#E31837', category: 'general' },
  { id: '14', name: 'Iffco Tokio', logoColor: '#F37021', category: 'general' },
  { id: '15', name: 'Royal Sundaram', logoColor: '#004A8F', category: 'general' },
  { id: '16', name: 'Liberty General', logoColor: '#003DA5', category: 'general' },
  { id: '17', name: 'Magma HDI', logoColor: '#EC1C24', category: 'general' },
  { id: '18', name: 'Cholamandalam', logoColor: '#002E6D', category: 'general' },
  { id: '19', name: 'Shriram General', logoColor: '#D0232A', category: 'general' },
  { id: '20', name: 'Digit Insurance', logoColor: '#FF6600', category: 'general' },
  { id: '21', name: 'Acko', logoColor: '#36B37E', category: 'general' },
  { id: '22', name: 'Go Digit', logoColor: '#FF6600', category: 'general' },
  { id: '23', name: 'Care Health', logoColor: '#E31837', category: 'health' },
  { id: '24', name: 'Max Bupa', logoColor: '#00704A', category: 'health' },
  { id: '25', name: 'Aditya Birla Health', logoColor: '#C4122E', category: 'health' },
  { id: '26', name: 'ManipalCigna', logoColor: '#E31837', category: 'health' },
  { id: '27', name: 'Religare Health', logoColor: '#003DA5', category: 'health' },
  { id: '28', name: 'Apollo Munich', logoColor: '#005DAA', category: 'health' },
  { id: '29', name: 'Edelweiss General', logoColor: '#143C8C', category: 'general' },
  { id: '30', name: 'Universal Sompo', logoColor: '#D31145', category: 'general' },
];

const DEFAULT_AGENTS: InsuranceAgent[] = [
  {
    id: 'a1', companyId: '1', companyName: 'ICICI Lombard', name: 'ICICI Sales Agent',
    status: 'published',
    agentMode: 'managed',
    asrProvider: 'deepgram', asrModel: 'nova-2',
    llmProvider: 'qwen', llmModel: 'qwen/qwen3-32b',
    ttsProvider: 'cartesia', ttsModel: 'sonic-3',
    telephonyProvider: 'twilio',
    language: 'en-IN',
    temperature: 0.7,
    greetingMessage: 'Namaste! Main ICICI Lombard se Priya bol rahi hun. Aapki kya madad kar sakti hun?',
    silenceTimeoutSeconds: 30,
    backchannelingEnabled: true,
    noiseCancellationEnabled: true,
    systemPrompt: `You are Priya, a friendly and professional sales agent for ICICI Lombard General Insurance. Your goal is to help customers understand their motor insurance renewal options and guide them to renew their policy.\n\nKey guidelines:\n- Always greet the customer warmly in Hindi or English depending on their preference\n- Focus on the benefits of renewing early (no inspection required, continuous NCB benefit)\n- Offer to explain any claim history or premium changes clearly\n- Never pressure the customer; build trust through information\n- If customer objects to price, highlight the coverage value and claim settlement ratio (98.7%)`,
    voiceId: 'v1', kbEntries: 6, totalCalls: 12500, conversionRate: 45.2,
    lastUpdated: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'a2', companyId: '3', companyName: 'Star Health', name: 'Star Health Renewal',
    status: 'testing',
    agentMode: 'managed',
    asrProvider: 'deepgram', asrModel: 'nova-2',
    llmProvider: 'qwen', llmModel: 'qwen/qwen3-32b',
    ttsProvider: 'cartesia', ttsModel: 'sonic-3',
    telephonyProvider: 'twilio',
    language: 'en-IN',
    temperature: 0.6,
    greetingMessage: 'Hello! I am Anjali from Star Health Insurance. How can I help you today?',
    silenceTimeoutSeconds: 30,
    backchannelingEnabled: true,
    noiseCancellationEnabled: true,
    systemPrompt: `You are Anjali, a health insurance specialist at Star Health and Allied Insurance. You help existing customers understand their health policy renewal and coverage details.\n\nKey guidelines:\n- Remind customers about the waiting period reset if they let their policy lapse\n- Highlight the network hospital count (14,000+ hospitals)\n- Mention the tax benefit under Section 80D\n- If customer mentions a pre-existing condition, assure them about coverage continuity on renewal\n- Keep the conversation warm and empathetic — health insurance is personal`,
    voiceId: 'v2', kbEntries: 4, totalCalls: 340, conversionRate: 12.5,
    lastUpdated: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'a3', companyId: '4', companyName: 'Niva Bupa', name: 'Niva Bupa Upsell',
    status: 'approved',
    agentMode: 'byop',
    asrProvider: 'sarvam', asrModel: 'saaras:v3',
    llmProvider: 'sarvam', llmModel: 'sarvam-30b',
    ttsProvider: 'sarvam', ttsVoice: 'meera',
    telephonyProvider: 'vobiz',
    language: 'hi',
    temperature: 0.7,
    greetingMessage: 'Namaste! Main Rahul, Niva Bupa Health Insurance se. Aapka waqt milne ke liye shukriya.',
    silenceTimeoutSeconds: 35,
    backchannelingEnabled: true,
    noiseCancellationEnabled: true,
    systemPrompt: `You are Rahul, an insurance advisor at Niva Bupa Health Insurance. Your role is to reach out to existing basic plan holders and explain the benefits of upgrading to ReAssure or Health Companion plans.\n\nKey guidelines:\n- Start by acknowledging their current plan and thanking them for being a valued customer\n- Explain how their healthcare needs may have grown since they first enrolled\n- Highlight the key upgrade benefits: higher sum insured, OPD cover, restoration benefit\n- Be ready to calculate the premium difference on the spot\n- If they are hesitant, offer to send a detailed comparison on WhatsApp`,
    voiceId: 'v1', kbEntries: 5, totalCalls: 890, conversionRate: 31.8,
    lastUpdated: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 'a4', companyId: '7', companyName: 'Bajaj Allianz', name: 'Bajaj Motor Renewal',
    status: 'training',
    agentMode: 'managed',
    asrProvider: 'deepgram', asrModel: 'nova-2',
    llmProvider: 'qwen', llmModel: 'qwen/qwen3-32b',
    ttsProvider: 'cartesia', ttsModel: 'sonic-3',
    telephonyProvider: 'twilio',
    language: 'en-IN',
    temperature: 0.7,
    silenceTimeoutSeconds: 30,
    backchannelingEnabled: true,
    noiseCancellationEnabled: true,
    systemPrompt: `You are Vikram, a motor insurance specialist for Bajaj Allianz General Insurance. You handle outbound calls for two-wheeler and four-wheeler policy renewals.\n\nKey guidelines:\n- Always verify the vehicle registration number at the start of the call\n- Explain the difference between third-party and comprehensive coverage clearly\n- Mention the Bajaj Allianz Motor On-the-Spot (OTS) claim settlement feature\n- If customer wants to compare, focus on the 24x7 roadside assistance benefit\n- For lapsed policies, explain the inspection requirement and process`,
    voiceId: 'v3', kbEntries: 3, totalCalls: 0, conversionRate: 0,
    lastUpdated: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: 'a5', companyId: '5', companyName: 'Tata AIG', name: 'Tata AIG Travel Agent',
    status: 'draft',
    agentMode: 'managed',
    asrProvider: 'deepgram', asrModel: 'nova-2',
    llmProvider: 'qwen', llmModel: 'qwen/qwen3-32b',
    ttsProvider: 'cartesia', ttsModel: 'sonic-3',
    telephonyProvider: 'twilio',
    language: 'en-IN',
    temperature: 0.7,
    silenceTimeoutSeconds: 30,
    backchannelingEnabled: true,
    noiseCancellationEnabled: true,
    systemPrompt: `You are Sanya, a travel insurance specialist at Tata AIG General Insurance. You help customers choose the right travel insurance plan for their upcoming international trips.\n\nKey guidelines:\n- Ask about destination, duration, and number of travelers upfront\n- Explain the medical emergency coverage and evacuation benefits\n- Highlight the trip cancellation and baggage loss protection\n- For senior citizens, specifically mention the dedicated claims helpline\n- Mention tie-up with 5 million+ hospitals globally`,
    voiceId: 'v2', kbEntries: 0, totalCalls: 0, conversionRate: 0,
    lastUpdated: new Date(Date.now() - 259200000).toISOString(),
  },
];

const DEFAULT_KB: KnowledgeEntry[] = [
  { id: 'kb1', agentId: 'a1', agentName: 'ICICI Sales Agent', companyName: 'ICICI Lombard', type: 'faq', question: 'What is the last date to renew my motor policy?', answer: 'Your policy can be renewed up to 90 days before expiry without any inspection. If it has already expired, it must be renewed within 90 days — after which a vehicle inspection will be required.', updatedAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 'kb2', agentId: 'a1', agentName: 'ICICI Sales Agent', companyName: 'ICICI Lombard', type: 'objection', question: 'The premium has increased this year. Why?', answer: 'Premium changes are based on updated actuarial calculations, fuel prices, and repair cost indices. However, your No-Claim Bonus (NCB) of up to 50% is still protecting your premium. We also have a loyalty discount for long-standing customers — let me check what applies to your policy.', updatedAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 'kb3', agentId: 'a1', agentName: 'ICICI Sales Agent', companyName: 'ICICI Lombard', type: 'policy', question: 'What does the comprehensive plan cover?', answer: 'Our comprehensive motor policy covers: (1) Own damage from accidents, fire, natural calamities, theft (2) Third-party liability including injury and property damage (3) Personal accident cover for the owner-driver (4) Optional add-ons: zero depreciation, engine protect, return to invoice, roadside assistance.', updatedAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 'kb4', agentId: 'a1', agentName: 'ICICI Sales Agent', companyName: 'ICICI Lombard', type: 'pricing', question: 'Can I get a discount on my renewal?', answer: 'Yes! Discounts available: (1) No-Claim Bonus: 20-50% based on consecutive claim-free years (2) IRDAI-mandated anti-theft device discount (3) Automobile Association membership discount (4) Voluntary deductible discount. Your exact eligibility will be shown in the renewal quote.', updatedAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 'kb5', agentId: 'a1', agentName: 'ICICI Sales Agent', companyName: 'ICICI Lombard', type: 'faq', question: 'How do I file a claim?', answer: 'For claims: (1) Call our 24x7 helpline 1800-2666 immediately after any incident (2) Do NOT move the vehicle if it is involved in an accident — wait for our surveyor (3) We have 6,000+ cashless garages across India (4) Claims are settled within 7 working days for straightforward cases.', updatedAt: new Date(Date.now() - 172800000).toISOString() },
  { id: 'kb6', agentId: 'a1', agentName: 'ICICI Sales Agent', companyName: 'ICICI Lombard', type: 'objection', question: 'I want to switch to a different insurer.', answer: 'I completely understand. Before you decide, I want to share that ICICI Lombard has a 98.7% claim settlement ratio, one of the highest in the industry. Switching insurers may also reset your NCB benefit. Would it help if I shared a detailed comparison? Many customers who consider switching end up staying when they see the full picture.', updatedAt: new Date(Date.now() - 172800000).toISOString() },
  { id: 'kb7', agentId: 'a2', agentName: 'Star Health Renewal', companyName: 'Star Health', type: 'policy', question: 'What happens if I do not renew my health policy on time?', answer: 'If your Star Health policy lapses: (1) All accumulated waiting period benefits reset (2) You may lose the No-Claim Bonus accumulated (3) Continuous coverage benefit for pre-existing conditions is lost (4) Re-enrollment may require fresh medical underwriting. We strongly recommend renewing before the due date.', updatedAt: new Date(Date.now() - 3600000).toISOString() },
  { id: 'kb8', agentId: 'a2', agentName: 'Star Health Renewal', companyName: 'Star Health', type: 'faq', question: 'How many hospitals are in your network?', answer: 'Star Health has a network of 14,000+ hospitals across India, including leading hospitals like Apollo, Fortis, Max, Manipal, and Narayana. You can search for network hospitals near you on our app or website, or call our 24x7 helpline at 1800-425-2255.', updatedAt: new Date(Date.now() - 3600000).toISOString() },
  { id: 'kb9', agentId: 'a2', agentName: 'Star Health Renewal', companyName: 'Star Health', type: 'pricing', question: 'What is the tax benefit on health insurance premium?', answer: 'Under Section 80D of the Income Tax Act: (1) Self, spouse, and children: up to ₹25,000 deduction (2) Parents below 60 years: additional ₹25,000 (3) Senior citizen parents (60+): additional ₹50,000 (4) Maximum total deduction possible: ₹1,00,000.', updatedAt: new Date(Date.now() - 7200000).toISOString() },
  { id: 'kb10', agentId: 'a2', agentName: 'Star Health Renewal', companyName: 'Star Health', type: 'objection', question: 'My pre-existing condition was not covered last time.', answer: 'I understand your concern. For most pre-existing conditions, there is a 2-4 year waiting period after which they are fully covered. If you have been continuously insured with us, you may already be nearing or past your waiting period. Let me pull up your policy details to confirm the exact coverage status for your condition.', updatedAt: new Date(Date.now() - 7200000).toISOString() },
  { id: 'kb11', agentId: 'a3', agentName: 'Niva Bupa Upsell', companyName: 'Niva Bupa', type: 'policy', question: 'What is the ReAssure plan?', answer: "ReAssure is Niva Bupa's flagship health plan offering: (1) Sum insured restoration — if you use your cover, it gets restored for future claims in the same year (2) Unlimited restoration for unrelated illnesses (3) No room rent capping (4) No co-payment for most age groups (5) OPD consultations included in higher variants.", updatedAt: new Date(Date.now() - 7200000).toISOString() },
  { id: 'kb12', agentId: 'a3', agentName: 'Niva Bupa Upsell', companyName: 'Niva Bupa', type: 'objection', question: 'The upgrade premium seems too high.', answer: 'The upgrade typically costs ₹2,000-5,000 more per year, which is ₹6-14 per day. In return, you get: unlimited sum insured restoration, OPD cover worth ₹10,000-20,000, and no room capping at private hospitals. Most customers find the math works in their favor — one additional hospital visit often covers the upgrade cost.', updatedAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 'kb13', agentId: 'a3', agentName: 'Niva Bupa Upsell', companyName: 'Niva Bupa', type: 'faq', question: 'What is the sum insured restoration benefit?', answer: 'Restoration benefit means: if your entire sum insured is used in a claim, it gets automatically restored to 100% for future claims in the same policy year — at no extra cost. This is especially valuable for families where multiple members may have health events in the same year.', updatedAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 'kb14', agentId: 'a4', agentName: 'Bajaj Motor Renewal', companyName: 'Bajaj Allianz', type: 'faq', question: 'What is OTS claim settlement?', answer: 'Bajaj Allianz Motor On-the-Spot (OTS) allows you to get a claim settled on-site for minor damages without a workshop visit. Our surveyor visits, assesses the damage, and transfers money directly to your account within 20 minutes using our mobile app.', updatedAt: new Date(Date.now() - 172800000).toISOString() },
  { id: 'kb15', agentId: 'a4', agentName: 'Bajaj Motor Renewal', companyName: 'Bajaj Allianz', type: 'policy', question: 'Does comprehensive cover include engine damage due to waterlogging?', answer: 'Standard comprehensive cover does NOT include engine damage from hydrostatic lock (waterlogging). However, you can add the Engine Protect add-on for ₹800-1,500/year. Given the monsoon conditions in many Indian cities, we strongly recommend this add-on.', updatedAt: new Date(Date.now() - 172800000).toISOString() },
];

export function useFamilyStore() {
  const [companies] = useState<InsuranceCompany[]>(DEFAULT_COMPANIES);
  const [agents, setAgents] = useState<InsuranceAgent[]>([]);
  const [kbEntries, setKbEntries] = useState<KnowledgeEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const storedAgents = localStorage.getItem('family_agents');
    const storedKb = localStorage.getItem('family_kb');

    if (storedAgents) {
      setAgents(JSON.parse(storedAgents));
    } else {
      setAgents(DEFAULT_AGENTS);
      localStorage.setItem('family_agents', JSON.stringify(DEFAULT_AGENTS));
    }

    if (storedKb) {
      const parsed: KnowledgeEntry[] = JSON.parse(storedKb);
      if (parsed.length === 0) {
        setKbEntries(DEFAULT_KB);
        localStorage.setItem('family_kb', JSON.stringify(DEFAULT_KB));
      } else {
        setKbEntries(parsed);
      }
    } else {
      setKbEntries(DEFAULT_KB);
      localStorage.setItem('family_kb', JSON.stringify(DEFAULT_KB));
    }

    setIsLoaded(true);
  }, []);

  const saveAgents = (newAgents: InsuranceAgent[]) => {
    setAgents(newAgents);
    localStorage.setItem('family_agents', JSON.stringify(newAgents));
  };

  const saveKbEntries = (newKb: KnowledgeEntry[]) => {
    setKbEntries(newKb);
    localStorage.setItem('family_kb', JSON.stringify(newKb));
  };

  return { companies, agents, kbEntries, saveAgents, saveKbEntries, isLoaded };
}
