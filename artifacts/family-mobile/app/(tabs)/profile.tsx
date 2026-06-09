import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/useAuth";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, logout } = useAuth();

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Profile</Text>
      </View>
      
      <View style={styles.content}>
        <View style={styles.avatarSection}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>
              {user?.name?.[0] || "A"}
            </Text>
          </View>
          <Text style={[styles.name, { color: colors.foreground }]}>{user?.name || "Agent"}</Text>
          <Text style={[styles.code, { color: colors.mutedForeground }]}>Code: {user?.agentCode}</Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <Feather name="mail" size={20} color={colors.mutedForeground} />
            <Text style={[styles.rowText, { color: colors.foreground }]}>{user?.email}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Feather name="phone" size={20} color={colors.mutedForeground} />
            <Text style={[styles.rowText, { color: colors.foreground }]}>{user?.mobile}</Text>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <Feather name="credit-card" size={20} color={colors.mutedForeground} />
            <Text style={[styles.rowText, { color: colors.foreground, flex: 1 }]}>Wallet Balance</Text>
            <Text style={[styles.rowValue, { color: colors.primary }]}>₹ 12,450</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Feather name="award" size={20} color={colors.mutedForeground} />
            <Text style={[styles.rowText, { color: colors.foreground, flex: 1 }]}>Subscription</Text>
            <Text style={[styles.rowValue, { color: colors.foreground }]}>Pro Tier</Text>
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.logoutButton, { backgroundColor: colors.destructive }]} 
          onPress={logout}
        >
          <Text style={[styles.logoutText, { color: colors.destructiveForeground }]}>Logout</Text>
        </TouchableOpacity>
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
    fontFamily: "Inter_700Bold",
    fontSize: 28,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 24,
  },
  avatarSection: {
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  avatarText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 32,
  },
  name: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
  },
  code: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
  },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 16,
  },
  rowText: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
  },
  rowValue: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(0,0,0,0.05)",
    marginLeft: 52,
  },
  logoutButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 16,
  },
  logoutText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
});