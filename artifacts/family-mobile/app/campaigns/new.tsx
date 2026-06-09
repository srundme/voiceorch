import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useCampaigns, useCompanies, Campaign } from "@/hooks/useData";

export default function NewCampaignScreen() {
  const { companyId } = useLocalSearchParams();
  const colors = useColors();
  const companies = useCompanies();
  const { addCampaign } = useCampaigns();

  const [step, setStep] = useState(companyId ? 2 : 1);
  const [selectedCompany, setSelectedCompany] = useState<string | null>((companyId as string) || null);
  const [name, setName] = useState("");
  const [leadsCount, setLeadsCount] = useState<number | null>(null);

  const handleNext = () => {
    if (step === 1 && !selectedCompany) {
      Alert.alert("Error", "Please select an agent.");
      return;
    }
    if (step === 2 && (!name || !leadsCount)) {
      Alert.alert("Error", "Please enter name and mock upload leads.");
      return;
    }
    setStep(step + 1);
  };

  const handleUploadLeads = () => {
    // Mock file picker
    setTimeout(() => {
      setLeadsCount(Math.floor(Math.random() * 500) + 50);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 500);
  };

  const handleLaunch = async () => {
    if (!selectedCompany) return;
    const campaign: Campaign = {
      id: Date.now().toString(),
      name,
      companyId: selectedCompany,
      status: "active",
      totalLeads: leadsCount || 0,
      callsMade: 0,
      connected: 0,
      qualified: 0,
      createdAt: new Date().toISOString(),
    };
    await addCampaign(campaign);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace(`/campaigns/${campaign.id}`);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.stepText, { color: colors.mutedForeground }]}>Step {step} of 3</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {step === 1 && (
          <View style={styles.stepContainer}>
            <Text style={[styles.title, { color: colors.foreground }]}>Select Agent</Text>
            {companies.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.optionCard,
                  { backgroundColor: colors.card, borderColor: selectedCompany === c.id ? colors.primary : colors.border }
                ]}
                onPress={() => setSelectedCompany(c.id)}
              >
                <View style={[styles.brandCircle, { backgroundColor: c.color }]} />
                <Text style={[styles.optionText, { color: colors.foreground }]}>{c.name}</Text>
                {selectedCompany === c.id && <Feather name="check" size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {step === 2 && (
          <View style={styles.stepContainer}>
            <Text style={[styles.title, { color: colors.foreground }]}>Campaign Details</Text>
            <Text style={[styles.label, { color: colors.foreground }]}>Campaign Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              placeholder="e.g. October Renewals"
              placeholderTextColor={colors.mutedForeground}
              value={name}
              onChangeText={setName}
            />

            <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Lead List</Text>
            <TouchableOpacity 
              style={[styles.uploadBox, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={handleUploadLeads}
            >
              <Feather name="upload-cloud" size={32} color={colors.primary} />
              <Text style={[styles.uploadText, { color: colors.foreground }]}>
                {leadsCount ? `${leadsCount} leads loaded` : "Tap to upload CSV"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 3 && (
          <View style={styles.stepContainer}>
            <Text style={[styles.title, { color: colors.foreground }]}>Review & Launch</Text>
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Agent</Text>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>{companies.find(c => c.id === selectedCompany)?.name}</Text>
              
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground, marginTop: 12 }]}>Campaign Name</Text>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>{name}</Text>
              
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground, marginTop: 12 }]}>Total Leads</Text>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>{leadsCount}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={step === 3 ? handleLaunch : handleNext}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            {step === 3 ? "Launch Campaign" : "Next"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    alignItems: "center",
  },
  stepText: {
    fontWeight: "500" as const,
    fontSize: 14,
  },
  content: {
    padding: 20,
    gap: 24,
  },
  stepContainer: {
    gap: 16,
  },
  title: {
    fontWeight: "700" as const,
    fontSize: 24,
    marginBottom: 8,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    gap: 12,
  },
  brandCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  optionText: {
    fontWeight: "500" as const,
    fontSize: 16,
    flex: 1,
  },
  label: {
    fontWeight: "600" as const,
    fontSize: 14,
  },
  input: {
    fontWeight: "400" as const,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  uploadBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 32,
    alignItems: "center",
    gap: 12,
  },
  uploadText: {
    fontWeight: "500" as const,
    fontSize: 16,
  },
  summaryCard: {
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
  },
  summaryLabel: {
    fontWeight: "500" as const,
    fontSize: 14,
  },
  summaryValue: {
    fontWeight: "600" as const,
    fontSize: 18,
    marginTop: 4,
  },
  footer: {
    padding: 20,
    paddingBottom: 40,
    borderTopWidth: 1,
  },
  button: {
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: {
    fontWeight: "600" as const,
    fontSize: 16,
  },
});