import React, { useState } from "react";
import { useLocation } from "wouter";

export function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email === "admin@family.ai" && password === "admin123") {
      localStorage.setItem("family_auth", "true");
      setLocation("/dashboard");
    } else {
      setError("Invalid credentials. Use admin@family.ai / admin123");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8 border border-border bg-card rounded-lg shadow-xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Family Admin</h1>
          <p className="text-muted-foreground mt-2">Mission Control</p>
        </div>
        
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input 
              type="email" 
              className="w-full bg-input border border-border rounded px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input 
              type="password" 
              className="w-full bg-input border border-border rounded px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="w-full bg-primary text-primary-foreground font-medium py-2 px-4 rounded hover:bg-primary/90 transition-colors">
            Access Terminal
          </button>
        </form>
      </div>
    </div>
  );
}
