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

export interface InsuranceAgent {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  status: AgentStatus;
  systemPrompt: string;
  voiceId: string;
  kbEntries: number;
  totalCalls: number;
  conversionRate: number;
  lastUpdated: string;
}

export interface KnowledgeEntry {
  id: string;
  agentId: string;
  type: KBType;
  question: string;
  answer: string;
  updatedAt: string;
}

const DEFAULT_COMPANIES: InsuranceCompany[] = [
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
  { id: '30', name: 'Universal Sompo', logoColor: '#D31145', category: 'general' }
];

const DEFAULT_AGENTS: InsuranceAgent[] = [
  {
    id: 'a1',
    companyId: '1',
    companyName: 'ICICI Lombard',
    name: 'ICICI Sales Agent',
    status: 'published',
    systemPrompt: 'You are an agent for ICICI Lombard.',
    voiceId: 'v1',
    kbEntries: 42,
    totalCalls: 12500,
    conversionRate: 45.2,
    lastUpdated: new Date().toISOString()
  },
  {
    id: 'a2',
    companyId: '3',
    companyName: 'Star Health',
    name: 'Star Health Renewal',
    status: 'testing',
    systemPrompt: 'You are a renewal agent for Star Health.',
    voiceId: 'v2',
    kbEntries: 18,
    totalCalls: 340,
    conversionRate: 12.5,
    lastUpdated: new Date().toISOString()
  }
];

export function useStore() {
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [agents, setAgents] = useState<InsuranceAgent[]>([]);
  const [kbEntries, setKbEntries] = useState<KnowledgeEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const storedCompanies = localStorage.getItem('family_companies');
    const storedAgents = localStorage.getItem('family_agents');
    const storedKb = localStorage.getItem('family_kb');

    if (!storedCompanies) {
      localStorage.setItem('family_companies', JSON.stringify(DEFAULT_COMPANIES));
      setCompanies(DEFAULT_COMPANIES);
    } else {
      setCompanies(JSON.parse(storedCompanies));
    }

    if (!storedAgents) {
      localStorage.setItem('family_agents', JSON.stringify(DEFAULT_AGENTS));
      setAgents(DEFAULT_AGENTS);
    } else {
      setAgents(JSON.parse(storedAgents));
    }

    if (!storedKb) {
      localStorage.setItem('family_kb', JSON.stringify([]));
      setKbEntries([]);
    } else {
      setKbEntries(JSON.parse(storedKb));
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

  return {
    companies,
    agents,
    kbEntries,
    saveAgents,
    saveKbEntries,
    isLoaded
  };
}
