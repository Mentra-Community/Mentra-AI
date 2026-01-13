import { AppSession, logger as _logger } from '@mentra/sdk';
import { wrapText } from '../utils';

const logger = _logger.child({ service: 'AudioPlaybackManager' });

const PROCESSING_SOUND_URL = process.env.PROCESSING_SOUND_URL;
const START_LISTENING_SOUND_URL = process.env.START_LISTENING_SOUND_URL;
const CANCEL_MIRA_SOUND_URL = process.env.CANCEL_MIRA_SOUND_URL;

/**
 * Manages audio playback and text-to-speech for the session
 */
export class AudioPlaybackManager {
  private session: AppSession;
  private sessionId: string;
  private isShuttingDown: boolean = false;

  constructor(session: AppSession, sessionId: string) {
    this.session = session;
    this.sessionId = sessionId;
  }

  /**
   * Play the start listening sound effect
   */
  async playStartListening(): Promise<void> {
    const hasScreen = this.session.capabilities?.hasDisplay;
    if (this.session.settings.get<boolean>("speak_response") || !hasScreen) {
      try {
        await this.session.audio.playAudio({ audioUrl: START_LISTENING_SOUND_URL });
      } catch (err) {
        logger.debug('Start listening audio failed:', err);
      }
    }
  }

  /**
   * Play the cancellation sound effect
   */
  async playCancellation(): Promise<void> {
    const hasScreen = this.session.capabilities?.hasDisplay;
    if (this.session.settings.get<boolean>("speak_response") || !hasScreen) {
      try {
        await this.session.audio.playAudio({ audioUrl: CANCEL_MIRA_SOUND_URL });
      } catch (err) {
        logger.debug('Cancellation audio failed:', err);
      }
    }
  }

  /**
   * Play processing sounds in a loop while query is being processed
   */
  async playProcessingSounds(): Promise<() => void> {
    let isRunning = true;
    const hasScreen = this.session.capabilities?.hasDisplay;

    if (this.session.settings.get<boolean>("speak_response") || !hasScreen) {
      // Chain 5 processing sounds
      const playChain = async () => {
        for (let i = 1; i <= 5 && isRunning; i++) {
          try {
            await this.session.audio.playAudio({ audioUrl: PROCESSING_SOUND_URL });
          } catch (err) {
            logger.debug(`Processing audio ${i} failed:`, err);
          }
        }
      };

      playChain();
    }

    // Return a function to stop the processing sounds
    return () => {
      isRunning = false;
    };
  }

  /**
   * Show text on display and optionally speak it
   */
  async showOrSpeakText(text: string): Promise<void> {
    // Check if session is shutting down
    if (this.isShuttingDown) {
      logger.warn(`Session shutting down, skipping message: ${text.substring(0, 50)}`);
      return;
    }

    // Check WebSocket connection state before trying to send
    if ((this.session as any).ws?.readyState !== 1) {
      logger.warn(`WebSocket not connected (state: ${(this.session as any).ws?.readyState}), skipping message: ${text.substring(0, 50)}`);
      return;
    }

    try {
      this.session.layouts.showTextWall(wrapText(text, 30), { durationMs: 5000 });
    } catch (error) {
      logger.error(error, `Failed to show text wall`);
      return;
    }

    const hasScreen = this.session.capabilities?.hasDisplay;
    if (this.session.settings.get<boolean>("speak_response") || !hasScreen) {
      // Double-check connection state before speaking
      if (this.isShuttingDown || (this.session as any).ws?.readyState !== 1) {
        logger.warn(`Session unavailable before speaking, skipping audio`);
        return;
      }

      try {
        const result = await this.session.audio.speak(text, { 
          stopOtherAudio: true,
          voice_settings: {
            stability: 0.5,
            speed: 1.0
          }
        });
        if (result.error) {
          logger.error({ error: result.error }, `[Session ${this.sessionId}]: Error speaking text:`);
        }
      } catch (error) {
        logger.error(error, `[Session ${this.sessionId}]: Error speaking text:`);
      }
    }
  }

  /**
   * Set shutdown flag to prevent audio operations during cleanup
   */
  setShuttingDown(value: boolean): void {
    this.isShuttingDown = value;
  }
}
