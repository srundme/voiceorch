"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface WebGLErrorBoundaryProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
}

interface WebGLErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render/runtime errors thrown by the WebGL canvas (unsupported
 * context, lost context, driver quirks) and swaps in a static gradient so the
 * surrounding UI never crashes.
 */
export class WebGLErrorBoundary extends React.Component<
  WebGLErrorBoundaryProps,
  WebGLErrorBoundaryState
> {
  constructor(props: WebGLErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): WebGLErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // Intentionally swallowed — the fallback already communicates the failure.
  }

  render(): React.ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

/**
 * Static, dependency-free stand-in for the animated aurora. Uses layered
 * radial gradients in the same satin palette so a no-WebGL environment still
 * looks intentional.
 */
export function WebGLFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("bg-[#060609]", className)}
      style={{
        backgroundImage:
          "radial-gradient(ellipse 70% 55% at 72% 30%, rgba(124,108,240,0.18), transparent 60%)," +
          "radial-gradient(ellipse 60% 50% at 20% 78%, rgba(216,220,236,0.10), transparent 62%)," +
          "linear-gradient(180deg, #0a0b12 0%, #060609 100%)",
      }}
    />
  );
}
