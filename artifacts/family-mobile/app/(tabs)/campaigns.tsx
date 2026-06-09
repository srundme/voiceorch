import React from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useCampaigns, useCompanies } from "@/hooks/useData";

export default function CampaignsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { campaigns } = useCampaigns();
  const companies = useCompanies();

  const renderItem = ({ item }: { item: any }) => {
    const company = companies.find(c => c.id === item.companyId);
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push(`/campaigns/${item.id}`)}
      >
        <View style={styles.cardHeader}>
          <View>
            <Text style={[styles.campaignName, { color: colors.foreground }]}>{item.name}</Text>
            <Text style={[styles.companyName, { color: colors.mutedForeground }]}>{company?.name || "Unknown Agent"}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: item.status === "active" ? "rgba(34, 197, 94, 0.1)" : colors.muted }]}>
            <Text style={[styles.statusText, { color: item.status === "active" ? "#22C55E" : colors.mutedForeground }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{item.totalLeads}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Leads</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{item.callsMade}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Calls</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{item.qualified}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Qualified</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Campaigns</Text>
      </View>
      
      {campaigns.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather name="inbox" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.foreground }]}>No campaigns yet</Text>
          <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>Create a campaign to start calling leads.</Text>
        </View>
      ) : (
        <FlatList
          data={campaigns}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      <TouchableOpacity 
        style={[styles.fab, { backgroundColor: colors.primary, bottom: insets.bottom + 80 }]}
        onPress={() => router.push("/campaigns/new")}
      >
        <Feather name="plus" size={24} color={colors.primaryForeground} />
      </TouchableOpacity>
    </View>
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
    fontFamily: "Inter_700Bold",
    fontSize: 28,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
    gap: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  campaignName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    marginBottom: 4,
  },
  companyName: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statBox: {
    alignItems: "center",
  },
  statValue: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 20,
  },
  statLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
  },
  emptySubtext: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
});