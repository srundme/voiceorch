// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("wouter", () => ({
  useRoute: () => [true, { slug: "test-slug" }],
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetPublicEventType: vi.fn(),
  useGetPublicSlots: vi.fn(),
  useCreatePublicBooking: vi.fn(),
}));

import {
  useGetPublicEventType,
  useGetPublicSlots,
  useCreatePublicBooking,
} from "@workspace/api-client-react";

import PublicBookingPage from "./[slug]";

const MOCK_EVENT_TYPE = {
  id: 1,
  slug: "test-slug",
  name: "Intro Call",
  description: "A quick 30-min introduction",
  durationMinutes: 30,
  confirmationMode: "automatic",
};

const MOCK_MUTATION = {
  mutateAsync: vi.fn(),
  isPending: false,
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.mocked(useCreatePublicBooking).mockReturnValue(MOCK_MUTATION as any);
});

// ---------------------------------------------------------------------------
// Event-type loading path
// ---------------------------------------------------------------------------
describe("event-type loading path", () => {
  beforeEach(() => {
    vi.mocked(useGetPublicSlots).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);
  });

  it("shows the loading spinner while the event-type query is in flight", () => {
    vi.mocked(useGetPublicEventType).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    render(<PublicBookingPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows 'Page not found' when the event-type query returns an error", () => {
    vi.mocked(useGetPublicEventType).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("404"),
    } as any);

    render(<PublicBookingPage />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("shows 'Page not found' when the event type is null (slug not matched)", () => {
    vi.mocked(useGetPublicEventType).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as any);

    render(<PublicBookingPage />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("renders the event type name when the query succeeds", () => {
    vi.mocked(useGetPublicEventType).mockReturnValue({
      data: MOCK_EVENT_TYPE,
      isLoading: false,
      error: null,
    } as any);

    render(<PublicBookingPage />);
    expect(screen.getByText("Intro Call")).toBeInTheDocument();
  });

  it("renders the duration in the badge when the query succeeds", () => {
    vi.mocked(useGetPublicEventType).mockReturnValue({
      data: MOCK_EVENT_TYPE,
      isLoading: false,
      error: null,
    } as any);

    render(<PublicBookingPage />);
    // The badge renders an SVG + "30 min" text node; use regex to match
    // the visible text without requiring an exact full-element match.
    expect(screen.getByText(/30\s*min/)).toBeInTheDocument();
  });

  it("shows 'Requires host approval' badge for manual confirmation mode", () => {
    vi.mocked(useGetPublicEventType).mockReturnValue({
      data: { ...MOCK_EVENT_TYPE, confirmationMode: "manual" },
      isLoading: false,
      error: null,
    } as any);

    render(<PublicBookingPage />);
    expect(screen.getByText("Requires host approval")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Slot-fetching path
// ---------------------------------------------------------------------------
describe("slot-fetching path", () => {
  beforeEach(() => {
    vi.mocked(useGetPublicEventType).mockReturnValue({
      data: MOCK_EVENT_TYPE,
      isLoading: false,
      error: null,
    } as any);
  });

  it("shows 'Loading slots...' while the slots query is in flight", () => {
    vi.mocked(useGetPublicSlots).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    render(<PublicBookingPage />);
    expect(screen.getByText("Loading slots...")).toBeInTheDocument();
  });

  it("shows the no-slots message when the slot list is empty after loading", () => {
    vi.mocked(useGetPublicSlots).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);

    render(<PublicBookingPage />);
    expect(
      screen.getByText(/No available slots in the next 2 weeks/),
    ).toBeInTheDocument();
  });

  it("does not show the no-slots message while still loading", () => {
    vi.mocked(useGetPublicSlots).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    render(<PublicBookingPage />);
    expect(
      screen.queryByText(/No available slots/),
    ).not.toBeInTheDocument();
  });

  it("renders a slot button for each available slot", () => {
    vi.mocked(useGetPublicSlots).mockReturnValue({
      data: [
        { slotStart: "2026-06-15T09:00:00.000Z" },
        { slotStart: "2026-06-15T10:00:00.000Z" },
        { slotStart: "2026-06-15T14:30:00.000Z" },
      ],
      isLoading: false,
    } as any);

    render(<PublicBookingPage />);
    expect(screen.getByText("9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("10:00 AM")).toBeInTheDocument();
    expect(screen.getByText("2:30 PM")).toBeInTheDocument();
  });

  it("groups slots under their UTC calendar day — two days render independently", () => {
    vi.mocked(useGetPublicSlots).mockReturnValue({
      data: [
        { slotStart: "2026-06-15T09:00:00.000Z" },
        { slotStart: "2026-06-16T10:00:00.000Z" },
      ],
      isLoading: false,
    } as any);

    render(<PublicBookingPage />);
    expect(screen.getByText("9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("10:00 AM")).toBeInTheDocument();
  });

  it("places a midnight-UTC slot on the correct day (UTC boundary)", () => {
    vi.mocked(useGetPublicSlots).mockReturnValue({
      data: [
        { slotStart: "2026-06-15T23:30:00.000Z" },
        { slotStart: "2026-06-16T00:00:00.000Z" },
      ],
      isLoading: false,
    } as any);

    render(<PublicBookingPage />);
    expect(screen.getByText("11:30 PM")).toBeInTheDocument();
    expect(screen.getByText("12:00 AM")).toBeInTheDocument();
  });
});
