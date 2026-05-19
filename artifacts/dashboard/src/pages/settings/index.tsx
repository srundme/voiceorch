import React from "react";
import { Link } from "wouter";
import { ShieldAlert, Settings, KeySquare, HelpCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Platform Settings</h2>
        <p className="text-muted-foreground">
          Manage your account settings, organization preferences, and billing.
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-primary" />
              General Profile
            </CardTitle>
            <CardDescription>
              Update your personal information and preferences.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted/50 p-6 rounded-lg text-center border border-dashed">
              <Settings className="h-8 w-8 mx-auto text-muted-foreground mb-3 opacity-50" />
              <p className="text-sm font-medium">Profile settings are coming soon.</p>
              <p className="text-xs text-muted-foreground mt-1">This section is currently under construction.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeySquare className="h-5 w-5 text-primary" />
              API & Webhooks
            </CardTitle>
            <CardDescription>
              Manage your VoiceOrch API keys and configured webhooks.
            </CardDescription>
          </CardHeader>
          <CardContent>
             <div className="bg-muted/50 p-6 rounded-lg text-center border border-dashed">
              <KeySquare className="h-8 w-8 mx-auto text-muted-foreground mb-3 opacity-50" />
              <p className="text-sm font-medium">Developer tools are coming soon.</p>
              <p className="text-xs text-muted-foreground mt-1">Provider API keys can be managed in the <Link href="/providers"><span className="text-primary hover:underline cursor-pointer">Providers tab</span></Link>.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
