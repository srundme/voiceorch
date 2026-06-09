import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useCampaigns } from "@/hooks/useData";

export default function CampaignDetailScreen() {
  const { id } = useLocalSearchParams();
  const colors = useColors();
  const { campaigns, updateCampaign } = useCampaigns();
  const campaign = campaigns.find(c => c.id === id);

  if (!campaign) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground }}>Campaign not found</Text>
      </View>
    );
  }

  const toggleStatus = async () => {
    const newStatus = campaign.status === "active" ? "paused" : "active";
    await updateCampaign(campaign.id, { status: newStatus });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>{campaign.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: campaign.status === "active" ? "rgba(34, 197, 94, 0.1)" : colors.muted }]}>
            <Text style={[styles.statusText, { color: campaign.status === "active" ? "#22C55E" : colors.mutedForeground }]}>
              {campaign.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>{campaign.totalLeads}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>{campaign.callsMade}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Called</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{campaign.qualified}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Qualified</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Activity</Text>
          <View style={[styles.activityItem, { borderBottomColor: colors.border }]}>
            <Feather name="phone-outgoing" size={20} color={colors.mutedForeground} />
            <View style={styles.activityContent}>
              <Text style={[styles.activityTitle, { color: colors.foreground }]}>Call to +91 98765 43210</Text>
              <Text style={[styles.activitySub, { color: colors.mutedForeground }]}>Connected - Interested in health plan</Text>
            </View>
          </View>
          <View style={styles.activityItem}>
            <Feather name="phone-missed" size={20} color={colors.destructive} />
            <View style={styles.activityContent}>
              <Text style={[styles.activityTitle, { color: colors.foreground }]}>Call to +91 87654 32109</Text>
              <Text style={[styles.activitySub, { color: colors.mutedForeground }]}>Voicemail</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: campaign.status === "active" ? colors.muted : colors.primary }]}
          onPress={toggleStatus}
        >
          <Text style={[styles.buttonText, { color: campaign.status === "active" ? colors.mutedForeground : colors.primaryForeground }]}>
            {campaign.status === "active" ? "Pause Campaign" : "Resume Campaign"}
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 20,
    gap: 24,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontWeight: "700" as const,
    fontSize: 24,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    fontWeight: "600" as const,
    fontSize: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statItem: {
    alignItems: "center",
  },
  statValue: {
    fontWeight: "700" as const,
    fontSize: 24,
  },
  statLabel: {
    fontWeight: "500" as const,
    fontSize: 14,
    marginTop: 4,
  },
  section: {
    gap: 16,
  },
  sectionTitle: {
    fontWeight: "600" as const,
    fontSize: 18,
  },
  activityItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    fontWeight: "500" as const,
    fontSize: 16,
  },
  activitySub: {
    fontWeight: "400" as const,
    fontSize: 14,
    marginTop: 2,
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