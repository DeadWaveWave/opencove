import type { NotificationSound } from '@contexts/settings/domain/agentSettings'

/** What a test run heard: `playNotificationSound` records here instead of playing. */
type NotificationSoundTestEntry = { sound: NotificationSound; volume: number }

declare global {
  interface Window {
    __opencoveNotificationSoundTestLog?: NotificationSoundTestEntry[]
  }
}

type Voice = {
  type?: OscillatorType
  freq: number
  /** Seconds after the sound starts. */
  offset?: number
  attack?: number
  decay?: number
  gain?: number
  glide?: { to: number; time: number }
}

/** Synthesised, no files: tide (two soft tones), pebble (one drop) and bit (the pixel default). */
const SOUNDS: Record<NotificationSound, { voices: Voice[]; lowpass: number }> = {
  tide: {
    lowpass: 4000,
    voices: [
      { freq: 659.25, gain: 0.22 },
      { type: 'triangle', freq: 1318.5, gain: 0.03, decay: 0.35 },
      { freq: 987.77, offset: 0.09, gain: 0.2 },
      { type: 'triangle', freq: 1975.5, offset: 0.09, gain: 0.025, decay: 0.4 },
    ],
  },
  pebble: {
    lowpass: 4000,
    voices: [{ freq: 880, gain: 0.22, decay: 0.22, glide: { to: 840, time: 0.03 } }],
  },
  bit: {
    lowpass: 2500,
    voices: [1046.5, 1318.5, 1568].map((freq, index) => ({
      type: 'square' as const,
      freq,
      offset: index * 0.055,
      attack: 0.004,
      decay: 0.09,
      gain: 0.07,
    })),
  },
}

function scheduleVoice(context: AudioContext, output: AudioNode, start: number, voice: Voice) {
  const { type = 'sine', freq, attack = 0.008, decay = 0.6, gain = 0.2, glide } = voice
  const at = start + (voice.offset ?? 0)
  const oscillator = context.createOscillator()
  const envelope = context.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(freq, at)
  if (glide) {
    oscillator.frequency.exponentialRampToValueAtTime(glide.to, at + glide.time)
  }
  envelope.gain.setValueAtTime(0.0001, at)
  envelope.gain.exponentialRampToValueAtTime(gain, at + attack)
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
  oscillator.connect(envelope).connect(output)
  oscillator.start(at)
  oscillator.stop(at + attack + decay + 0.05)
}

/** Schedules one sound on `context`: master gain (volume) → lowpass → speakers. */
export function scheduleNotificationSound(
  context: AudioContext,
  sound: NotificationSound,
  volume: number,
): void {
  const { voices, lowpass } = SOUNDS[sound]
  const start = context.currentTime + 0.02
  const master = context.createGain()
  const filter = context.createBiquadFilter()
  master.gain.setValueAtTime(volume / 100, start)
  filter.type = 'lowpass'
  filter.frequency.value = lowpass
  master.connect(filter).connect(context.destination)
  voices.forEach(voice => scheduleVoice(context, master, start, voice))
}

// One context for the app's lifetime: browsers cap how many may be open.
let sharedContext: AudioContext | null = null

/** Plays the alert once. Test runs record it on `window` instead, so CI makes no sound. */
export function playNotificationSound(sound: NotificationSound, volume: number): void {
  if (volume <= 0) {
    return
  }
  if (window.opencoveApi?.meta?.isTest === true) {
    window.__opencoveNotificationSoundTestLog ??= []
    window.__opencoveNotificationSoundTestLog.push({ sound, volume })
    return
  }
  if (typeof AudioContext === 'undefined') {
    return
  }

  sharedContext ??= new AudioContext()
  if (sharedContext.state === 'suspended') {
    void sharedContext.resume().catch(() => undefined)
  }
  scheduleNotificationSound(sharedContext, sound, volume)
}

export function resetNotificationSoundForTests(): void {
  sharedContext = null
}
