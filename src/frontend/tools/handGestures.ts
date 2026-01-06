/**
 * Hand Gesture Detection Module
 * Detects hand gestures on screen including the "up up down down" pattern
 */

import React from 'react';

export type GestureDirection = 'up' | 'down' | 'left' | 'right';

export interface GestureEvent {
  pattern: GestureDirection[];
  timestamp: number;
  completed: boolean;
}

export interface GestureDetectorOptions {
  threshold?: number; // Minimum distance to consider a movement
  timeout?: number; // Time window for gesture completion (ms)
  onGestureDetected?: (event: GestureEvent) => void;
}

export class HandGestureDetector {
  private gestures: GestureDirection[] = [];
  private startY: number = 0;
  private startX: number = 0;
  private lastMoveTime: number = 0;
  private threshold: number;
  private timeout: number;
  private onGestureDetected?: (event: GestureEvent) => void;
  private targetPattern: GestureDirection[] = ['up', 'up', 'down', 'down'];
  private isTracking: boolean = false;
  private isTouching: boolean = false;
  private currentDirection: GestureDirection | null = null;

  constructor(options: GestureDetectorOptions = {}) {
    this.threshold = options.threshold || 50; // pixels
    this.timeout = options.timeout || 3000; // 3 seconds
    this.onGestureDetected = options.onGestureDetected;
  }

  /**
   * Start tracking gestures on the given element
   */
  startTracking(element: HTMLElement): void {
    if (this.isTracking) return;

    this.isTracking = true;
    element.addEventListener('touchstart', this.handleTouchStart);
    element.addEventListener('touchmove', this.handleTouchMove);
    element.addEventListener('touchend', this.handleTouchEnd);

    // Also support mouse events for desktop testing
    element.addEventListener('mousedown', this.handleMouseDown);
    element.addEventListener('mousemove', this.handleMouseMove);
    element.addEventListener('mouseup', this.handleMouseUp);
  }

  /**
   * Stop tracking gestures
   */
  stopTracking(element: HTMLElement): void {
    if (!this.isTracking) return;

    this.isTracking = false;
    element.removeEventListener('touchstart', this.handleTouchStart);
    element.removeEventListener('touchmove', this.handleTouchMove);
    element.removeEventListener('touchend', this.handleTouchEnd);
    element.removeEventListener('mousedown', this.handleMouseDown);
    element.removeEventListener('mousemove', this.handleMouseMove);
    element.removeEventListener('mouseup', this.handleMouseUp);

    this.reset();
  }

  /**
   * Set a custom gesture pattern to detect
   */
  setTargetPattern(pattern: GestureDirection[]): void {
    this.targetPattern = pattern;
  }

  /**
   * Get the current gesture pattern being tracked
   */
  getCurrentPattern(): GestureDirection[] {
    return [...this.gestures];
  }

  /**
   * Reset the gesture tracking
   */
  reset(): void {
    this.gestures = [];
    this.startY = 0;
    this.startX = 0;
    this.lastMoveTime = 0;
  }

  private handleTouchStart = (e: TouchEvent): void => {
    const touch = e.touches[0];
    this.startGesture(touch.clientX, touch.clientY);
  };

  private handleTouchMove = (e: TouchEvent): void => {
    const touch = e.touches[0];
    this.trackMovement(touch.clientX, touch.clientY);
  };

  private handleTouchEnd = (): void => {
    this.endGesture();
  };

  private handleMouseDown = (e: MouseEvent): void => {
    this.startGesture(e.clientX, e.clientY);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (e.buttons === 1) { // Left mouse button is pressed
      this.trackMovement(e.clientX, e.clientY);
    }
  };

  private handleMouseUp = (): void => {
    this.endGesture();
  };

  private startGesture(x: number, y: number): void {
    this.startX = x;
    this.startY = y;
    this.lastMoveTime = Date.now();
    this.isTouching = true;
    this.currentDirection = null;
  }

  private trackMovement(x: number, y: number): void {
    const currentTime = Date.now();

    // Check if gesture timed out
    if (currentTime - this.lastMoveTime > this.timeout) {
      this.reset();
      this.startX = x;
      this.startY = y;
      this.lastMoveTime = currentTime;
      return;
    }

    const deltaX = x - this.startX;
    const deltaY = y - this.startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Check if movement exceeds threshold
    if (distance > this.threshold && !this.currentDirection) {
      const direction = this.getDirection(deltaX, deltaY);

      // Only register one direction per touch/swipe
      this.currentDirection = direction;
      console.log('Gesture detected:', direction, '- Pattern:', this.gestures);
    }
  }

  private endGesture(): void {
    // Add the detected direction to the pattern when touch ends
    if (this.currentDirection) {
      this.gestures.push(this.currentDirection);
      console.log('Gesture added:', this.currentDirection, '- Full Pattern:', this.gestures);

      // Check if pattern matches
      this.checkPattern();

      // Reset for next gesture
      this.currentDirection = null;
    }
    this.isTouching = false;
  }

  private getDirection(deltaX: number, deltaY: number): GestureDirection {
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Determine if movement is more vertical or horizontal
    if (absY > absX) {
      return deltaY < 0 ? 'up' : 'down';
    } else {
      return deltaX < 0 ? 'left' : 'right';
    }
  }

  private checkPattern(): void {
    // Check if current gestures match the target pattern
    if (this.gestures.length === this.targetPattern.length) {
      const matches = this.gestures.every((gesture, index) => gesture === this.targetPattern[index]);

      if (matches) {
        const event: GestureEvent = {
          pattern: [...this.gestures],
          timestamp: Date.now(),
          completed: true
        };

        console.log('🎉 Gesture pattern completed!', event);

        if (this.onGestureDetected) {
          this.onGestureDetected(event);
        }

        // Reset after successful detection
        this.reset();
      } else if (this.gestures.length >= this.targetPattern.length) {
        // Pattern doesn't match and we've exceeded the length, reset
        this.reset();
      }
    } else if (this.gestures.length > this.targetPattern.length) {
      // Too many gestures, reset
      this.reset();
    }
  }
}

/**
 * React Hook for Hand Gesture Detection
 */
export function useHandGesture(
  elementRef: React.RefObject<HTMLElement | null>,
  options: GestureDetectorOptions = {}
): {
  detector: HandGestureDetector;
  currentPattern: GestureDirection[];
} {
  const [detector] = React.useState(() => new HandGestureDetector(options));
  const [currentPattern, setCurrentPattern] = React.useState<GestureDirection[]>([]);

  // Update the callback when options change
  React.useEffect(() => {
    if (options.onGestureDetected) {
      detector['onGestureDetected'] = options.onGestureDetected;
    }
    if (options.threshold !== undefined) {
      detector['threshold'] = options.threshold;
    }
    if (options.timeout !== undefined) {
      detector['timeout'] = options.timeout;
    }
  }, [detector, options.onGestureDetected, options.threshold, options.timeout]);

  React.useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    // Update pattern state periodically
    const interval = setInterval(() => {
      setCurrentPattern(detector.getCurrentPattern());
    }, 100);

    detector.startTracking(element);

    return () => {
      clearInterval(interval);
      detector.stopTracking(element);
    };
  }, [elementRef, detector]);

  return { detector, currentPattern };
}

// Export a default instance for simple usage
export const defaultGestureDetector = new HandGestureDetector({
  threshold: 50,
  timeout: 3000,
  onGestureDetected: (event) => {
    console.log('Default detector: Gesture completed!', event);
  }
});
