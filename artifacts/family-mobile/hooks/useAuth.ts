import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";

const AUTH_KEY = "family_app_auth_session";

export function useAuth() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    AsyncStorage.getItem(AUTH_KEY).then((data) => {
      if (data) {
        setIsAuthenticated(true);
        setUser(JSON.parse(data));
      }
      setIsReady(true);
    });
  }, []);

  const login = async (agentCode: string, email: string, mobile: string) => {
    if (agentCode === "FAM001" && email === "agent@family.ai" && mobile === "9999999999") {
      const userData = { agentCode, email, mobile, name: "Varsha" };
      await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(userData));
      setIsAuthenticated(true);
      setUser(userData);
      router.replace("/(tabs)");
      return true;
    }
    return false;
  };

  const logout = async () => {
    await AsyncStorage.removeItem(AUTH_KEY);
    setIsAuthenticated(false);
    setUser(null);
    router.replace("/login");
  };

  return { isReady, isAuthenticated, user, login, logout };
}