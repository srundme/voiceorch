import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useCampaigns } from "@/hooks/useData";

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { campaigns } = useCampaigns();

  const totalCampaigns = campaigns.length;
  const totalCalls = campaigns.reduce((acc, c) => acc + c.callsMade, 0);
  const totalConnected = campaigns.reduce((acc, c) => acc + c.connected, 0);
  const totalQualified = campaigns.reduce((acc, c) => acc + c.qualified, 0);

  const StatCard = ({ title, value, icon }: { title: string, value: number, icon: any }) => (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.iconContainer, { backgroundColor: colors.muted }]}>
        <Feather name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={[styles.statTitle, { color: colors.mutedForeground }]}>{title}</Text>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value.toLocaleString()}</Text>
    </View>
  );

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Analytics</Text>
      </View>
      <View style={styles.grid}>
        <StatCard title="Campaigns" value={totalCampaigns} icon="layers" />
        <StatCard title="Calls Made" value={totalCalls} icon="phone-outgoing" />
        <StatCard title="Connected" value={totalConnected} icon="phone-call" />
        <StatCard title="Qualified" value={totalQualified} icon="check-circle" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontWeight: "700" as const,
    fontSize: 28,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 10,
  },
  statCard: {
    width: "45%",
    margin: "2.5%",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  statTitle: {
    fontWeight: "500" as const,
    fontSize: 14,
  },
  statValue: {
    fontWeight: "700" as const,
    fontSize: 24,
  },
});