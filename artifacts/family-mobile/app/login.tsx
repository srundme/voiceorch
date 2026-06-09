import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/useAuth";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { login } = useAuth();

  const [agentCode, setAgentCode] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    const success = await login(agentCode, email, mobile);
    setLoading(false);
    if (!success) {
      Alert.alert("Login Failed", "Invalid credentials. Try FAM001 / agent@family.ai / 9999999999");
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Welcome back</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Log in to manage your agents and campaigns</Text>
      </View>
      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.foreground }]}>Agent Code</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          placeholder="FAM001"
          placeholderTextColor={colors.mutedForeground}
          value={agentCode}
          onChangeText={setAgentCode}
          autoCapitalize="characters"
        />

        <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          placeholder="agent@family.ai"
          placeholderTextColor={colors.mutedForeground}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={[styles.label, { color: colors.foreground }]}>Mobile</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          placeholder="9999999999"
          placeholderTextColor={colors.mutedForeground}
          value={mobile}
          onChangeText={setMobile}
          keyboardType="phone-pad"
        />

        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.primary, borderRadius: colors.radius }]} 
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Login</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  header: {
    marginTop: 64,
    marginBottom: 48,
  },
  title: {
    fontWeight: "700" as const,
    fontSize: 32,
    marginBottom: 8,
  },
  subtitle: {
    fontWeight: "400" as const,
    fontSize: 16,
  },
  form: {
    gap: 16,
  },
  label: {
    fontWeight: "600" as const,
    fontSize: 14,
    marginBottom: -8,
  },
  input: {
    fontWeight: "400" as const,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  button: {
    marginTop: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontWeight: "600" as const,
    fontSize: 16,
  },
});