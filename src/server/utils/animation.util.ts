/**
 * Animation utility class for displaying loading spinners
 *
 * This class provides a simple animated loader that displays frames in sequence
 * to show progress while processing user queries. Includes WebSocket connection
 * state checking to prevent errors when the session is disconnected.
 */

import { AppSession } from "@mentra/sdk";

export class Anim {
  /** Animation frames that create the spinning effect */
  private static readonly frames = ["·", "o", "O", "o"];

  /** Timer ID for the animation interval */
  private intervalId?: NodeJS.Timeout;

  /** Current frame index in the animation sequence */
  private frameIndex = 0;

  /** Flag to indicate if animation has been stopped */
  private stopped = false;

  /**
   * Creates a new animation instance
   * @param session - The app session used to display the animation
   */
  constructor(private session: AppSession) {}

  /**
   * Starts the animation with an optional message
   *
   * Displays animated frames at 100ms intervals. Each frame shows the spinner
   * with an optional message below it. Automatically stops if the WebSocket
   * connection is lost to prevent errors.
   *
   * @param message - Optional text to display below the spinner
   */
  start(message?: string): void {
    this.stopped = false;
    this.intervalId = setInterval(async () => {
      if (this.stopped) return;

      try {
        // Check if session is still connected before trying to send
        if ((this.session as any).ws?.readyState !== 1) {
          console.warn("WebSocket not connected, stopping animation");
          this.stop();
          return;
        }

        const display = Anim.frames[this.frameIndex] + (message ? "\n" + message : "");
        this.session.layouts.showTextWall(display);
        this.frameIndex = (this.frameIndex + 1) % Anim.frames.length;
      } catch (error) {
        if (!this.stopped) {
          console.warn("Session no longer available, stopping animation");
          this.stop();
        }
      }
    }, 100);
  }

  /**
   * Stops the animation immediately
   *
   * Clears the interval timer, sets the stopped flag to prevent
   * further animation frames from being displayed, and clears
   * the display to prevent the last frame from remaining visible.
   */
  stop(): void {
    this.stopped = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Clear the display to prevent last frame from staying visible
    try {
      if ((this.session as any).ws?.readyState === 1) {
        this.session.layouts.showTextWall("");
      }
    } catch (error) {
      // Silently handle cases where session is no longer available
    }
  }

  /**
   * Gets the current animation frame without starting the animation
   *
   * Uses time-based calculation to determine which frame should be shown
   * at the current moment, useful for one-off displays.
   *
   * @returns The current frame character
   */
  getCurrentFrame(): string {
    const now = Date.now();
    const index = Math.floor(now / 150) % Anim.frames.length;
    return Anim.frames[index];
  }
}