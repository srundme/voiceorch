import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useCompanies } from "@/hooks/useData";

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams();
  const colors = useColors();
  const companies = useCompanies();
  const agent = companies.find(c => c.id === id);

  if (!agent) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground }}>Agent not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={[styles.brandCircle, { backgroundColor: agent.color }]} />
          <Text style={[styles.title, { color: colors.foreground }]}>{agent.name}</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>{agent.description}</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>AI Capabilities</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.featureRow}>
              <Feather name="check-circle" size={16} color={colors.primary} />
              <Text style={[styles.featureText, { color: colors.foreground }]}>Lead Qualification</Text>
            </View>
            <View style={styles.featureRow}>
              <Feather name="check-circle" size={16} color={colors.primary} />
              <Text style={[styles.featureText, { color: colors.foreground }]}>Policy Explanation</Text>
            </View>
            <View style={styles.featureRow}>
              <Feather name="check-circle" size={16} color={colors.primary} />
              <Text style={[styles.featureText, { color: colors.foreground }]}>Objection Handling</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Sample Conversation</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.bubble, { backgroundColor: colors.muted, color: colors.foreground }]}>
              Hello, is this regarding the health insurance inquiry?
            </Text>
            <Text style={[styles.bubble, styles.agentBubble, { backgroundColor: agent.color, color: "#fff" }]}>
              Yes, I'm calling on behalf of {agent.name}. I saw you were looking for family cover.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={() => router.push({ pathname: "/campaigns/new", params: { companyId: agent.id } })}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Start Campaign</Text>
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
  scrollContent: {
    padding: 20,
    gap: 32,
  },
  header: {
    alignItems: "center",
    gap: 16,
  },
  brandCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
  },
  description: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    textAlign: "center",
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  featureText: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
  },
  bubble: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    padding: 12,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    alignSelf: "flex-start",
    maxWidth: "85%",
  },
  agentBubble: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
    alignSelf: "flex-end",
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
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
});