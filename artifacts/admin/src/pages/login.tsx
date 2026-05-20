import { useState } from "react";
import { useLocation } from "wouter";
import { Terminal, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [token, setToken] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      toast({
        title: "Token required",
        description: "Please enter your admin access token.",
        variant: "destructive",
      });
      return;
    }
    
    localStorage.setItem("adminToken", token.trim());
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-mono">
      <Card className="w-full max-w-md shadow-2xl border-border">
        <CardHeader className="space-y-3 pb-6 text-center border-b border-border/50 mb-6">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
            <Terminal className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">System Access</CardTitle>
          <CardDescription className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
            VoiceOrch Internal Operations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2 relative">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="Enter admin token..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="pl-9 font-mono bg-muted/50 border-border focus-visible:ring-primary h-10"
                data-testid="input-admin-token"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full h-10 font-bold uppercase tracking-wider"
              data-testid="button-login"
            >
              Authenticate
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
