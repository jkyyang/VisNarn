// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

function Toggle() {
  const [on, setOn] = useState(false);
  return (
    <button type="button" aria-pressed={on} onClick={() => setOn(!on)}>
      {on ? "Shown" : "Hidden"}
    </button>
  );
}

describe("page tests in jsdom", () => {
  it("a click on a button changes what the user sees", async () => {
    const user = userEvent.setup();
    render(<Toggle />);
    const button = screen.getByRole("button", { name: "Hidden" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    expect(screen.getByRole("button", { name: "Shown" })).toHaveAttribute("aria-pressed", "true");
  });

  it("each test starts from an empty page", () => {
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
