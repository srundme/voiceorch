import React from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useCompanies } from "@/hooks/useData";

export default function AgentsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const companies = useCompanies();

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => router.push(`/agent/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={[styles.cardHeader, { borderBottomColor: colors.border }]}>
        <View style={styles.brandRow}>
          <View style={[styles.brandCircle, { backgroundColor: item.color }]} />
          <Text style={[styles.companyName, { color: colors.foreground }]}>{item.name}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: item.status === "Available" ? "rgba(34, 197, 94, 0.1)" : colors.muted }]}>
          <Text style={[styles.statusText, { color: item.status === "Available" ? "#22C55E" : colors.mutedForeground }]}>
            {item.status}
          </Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.statRow}>
          <Feather name="file-text" size={16} color={colors.mutedForeground} />
          <Text style={[styles.statText, { color: colors.mutedForeground }]}>
            {item.policiesTrained.toLocaleString()} policies trained
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>AI Agents</Text>
      </View>
      <FlatList
        data={companies}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
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
    fontWeight: "700" as const,
    fontSize: 28,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardHeader: {
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brandCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  companyName: {
    fontWeight: "600" as const,
    fontSize: 18,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontWeight: "500" as const,
    fontSize: 12,
  },
  cardBody: {
    padding: 16,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statText: {
    fontWeight: "500" as const,
    fontSize: 14,
  },
});