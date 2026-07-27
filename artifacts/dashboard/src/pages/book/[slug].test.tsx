// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("wouter", () => ({
  useRoute: () => [true, { slug: "test-slug" }],
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetPublicEventType: vi.fn(),
    useGetPublicSlots: vi.fn(),
    useGetPublicNow: vi.fn(),
    useCreatePublicBooking: vi.fn(),
  };
});

import {
  useGetPublicEventType,
  useGetPublicSlots,
  useGetPublicNow,
  useCreatePublicBooking,
  ApiError,
  RequestTimeoutError,
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
  // Server "now" is before every mocked slot so slots stay bookable.
  vi.mocked(useGetPublicNow).mockReturnValue({
    data: { now: "2026-06-01T00:00:00.000Z" },
  } as any);
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

// ---------------------------------------------------------------------------
// Booking error path — formatApiError integration
// ---------------------------------------------------------------------------

function makeApiError(data: unknown, status = 400, statusText = "Bad Request"): ApiError {
  const response = new Response(null, { status, statusText });
  return new ApiError(response, data, { method: "POST", url: "/api/scheduling/public/bookings" });
}

describe("booking error path", () => {
  const MOCK_SLOT = "2026-06-15T09:00:00.000Z";

  beforeEach(() => {
    vi.mocked(useGetPublicEventType).mockReturnValue({
      data: MOCK_EVENT_TYPE,
      isLoading: false,
      error: null,
    } as any);
    vi.mocked(useGetPublicSlots).mockReturnValue({
      data: [{ slotStart: MOCK_SLOT }],
      isLoading: false,
    } as any);
  });

  async function fillAndSubmit() {
    render(<PublicBookingPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Jane Smith" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "jane@example.com" },
    });
    fireEvent.click(screen.getByText("9:00 AM"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm booking/i }));
    });
  }

  it("shows the server error string from a 409 ApiError (double-booking)", async () => {
    const err = makeApiError(
      { error: "This slot is no longer available" },
      409,
      "Conflict",
    );
    vi.mocked(MOCK_MUTATION.mutateAsync).mockRejectedValueOnce(err);
    await fillAndSubmit();
    expect(screen.getByText("This slot is no longer available")).toBeInTheDocument();
  });

  it("shows the first Zod issue from a 422 ApiError (validation)", async () => {
    const err = makeApiError(
      { issues: [{ path: ["attendeeEmail"], message: "Invalid email address" }] },
      422,
      "Unprocessable Entity",
    );
    vi.mocked(MOCK_MUTATION.mutateAsync).mockRejectedValueOnce(err);
    await fillAndSubmit();
    expect(screen.getByText("attendeeEmail: Invalid email address")).toBeInTheDocument();
  });

  it("shows the timeout message for a RequestTimeoutError", async () => {
    const err = new RequestTimeoutError(30_000);
    vi.mocked(MOCK_MUTATION.mutateAsync).mockRejectedValueOnce(err);
    await fillAndSubmit();
    expect(
      screen.getByText("Request timed out — please try again"),
    ).toBeInTheDocument();
  });

  it("shows the timeout message for an Error with name AbortError", async () => {
    const err = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
    vi.mocked(MOCK_MUTATION.mutateAsync).mockRejectedValueOnce(err);
    await fillAndSubmit();
    expect(
      screen.getByText("Request timed out — please try again"),
    ).toBeInTheDocument();
  });

  it("does not expose a raw HTTP status string for a 409 with no body", async () => {
    const err = makeApiError(null, 409, "Conflict");
    vi.mocked(MOCK_MUTATION.mutateAsync).mockRejectedValueOnce(err);
    await fillAndSubmit();
    const errorEl = screen.getByText(/Something went wrong with your request/i);
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).not.toMatch(/HTTP \d+/);
  });

  it("shows a friendly 5xx message instead of a raw status string", async () => {
    const err = makeApiError(null, 500, "Internal Server Error");
    vi.mocked(MOCK_MUTATION.mutateAsync).mockRejectedValueOnce(err);
    await fillAndSubmit();
    const errorEl = screen.getByText(/Something went wrong on our end/i);
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).not.toMatch(/HTTP \d+/);
  });
});
