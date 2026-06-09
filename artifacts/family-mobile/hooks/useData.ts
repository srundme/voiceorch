import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Company = {
  id: string;
  name: string;
  color: string;
  status: "Available" | "Coming Soon";
  policiesTrained: number;
  description: string;
};

export type Campaign = {
  id: string;
  name: string;
  companyId: string;
  status: "active" | "paused" | "completed";
  totalLeads: number;
  callsMade: number;
  connected: number;
  qualified: number;
  createdAt: string;
};

const SEED_COMPANIES: Company[] = [
  { id: "1", name: "ICICI Lombard", color: "#C62828", status: "Available", policiesTrained: 12400, description: "Leading private general insurance company in India." },
  { id: "2", name: "HDFC ERGO", color: "#B71C1C", status: "Available", policiesTrained: 9800, description: "Offers a complete range of general insurance products." },
  { id: "3", name: "Star Health", color: "#1565C0", status: "Available", policiesTrained: 15600, description: "India's first standalone health insurance provider." },
  { id: "4", name: "Niva Bupa", color: "#E65100", status: "Available", policiesTrained: 8200, description: "Providing comprehensive health insurance." },
  { id: "5", name: "Tata AIG", color: "#004D40", status: "Coming Soon", policiesTrained: 0, description: "A joint venture between the Tata Group and American International Group." },
  { id: "6", name: "SBI General", color: "#01579B", status: "Available", policiesTrained: 5400, description: "General insurance company backed by State Bank of India." },
  { id: "7", name: "Digit Insurance", color: "#FF6F00", status: "Available", policiesTrained: 4300, description: "Making insurance simple and transparent." },
  { id: "8", name: "Bajaj Allianz", color: "#0277BD", status: "Coming Soon", policiesTrained: 0, description: "One of the leading private general insurers." },
  { id: "9", name: "Acko", color: "#3E2723", status: "Available", policiesTrained: 2100, description: "Digital-first insurance company." },
  { id: "10", name: "Care Health", color: "#2E7D32", status: "Available", policiesTrained: 6700, description: "Specialized health insurance services." },
  { id: "11", name: "Max Bupa", color: "#006064", status: "Coming Soon", policiesTrained: 0, description: "Renamed to Niva Bupa, but older policies remain." },
  { id: "12", name: "Aditya Birla Health", color: "#BF360C", status: "Available", policiesTrained: 3200, description: "Health insurance arm of Aditya Birla Capital." },
];

export function useCompanies() {
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    AsyncStorage.getItem("family_companies").then((data) => {
      if (!data) {
        AsyncStorage.setItem("family_companies", JSON.stringify(SEED_COMPANIES));
        setCompanies(SEED_COMPANIES);
      } else {
        setCompanies(JSON.parse(data));
      }
    });
  }, []);

  return companies;
}

export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const load = async () => {
    const data = await AsyncStorage.getItem("family_campaigns");
    if (data) {
      setCampaigns(JSON.parse(data));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addCampaign = async (campaign: Campaign) => {
    const newCampaigns = [campaign, ...campaigns];
    await AsyncStorage.setItem("family_campaigns", JSON.stringify(newCampaigns));
    setCampaigns(newCampaigns);
  };

  const updateCampaign = async (id: string, updates: Partial<Campaign>) => {
    const newCampaigns = campaigns.map(c => c.id === id ? { ...c, ...updates } : c);
    await AsyncStorage.setItem("family_campaigns", JSON.stringify(newCampaigns));
    setCampaigns(newCampaigns);
  };

  return { campaigns, addCampaign, updateCampaign, reload: load };
}