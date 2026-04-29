import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import {
  clearAndSeedWorkspace,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  createSineWaveWavBuffer,
  SPACE_EXPLORER_OGG_BASE64,
  SPACE_EXPLORER_MP3_BASE64,
  SPACE_EXPLORER_MP4_BASE64,
  SPACE_EXPLORER_WEBM_BASE64,
} from './workspace-canvas.media.fixtures'

test.describe('Workspace Canvas - Space Explorer Media', () => {
  test('previews and opens VS Code built-in media files as playable document windows', async () => {
    const fixtureDir = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'space-explorer-media',
      randomUUID(),
    )
    const fixtureAudioPath = path.join(fixtureDir, 'tone.mp3')
    const fixtureOggPath = path.join(fixtureDir, 'tone.ogg')
    const fixtureWavPath = path.join(fixtureDir, 'tone.wav')
    const fixtureVideoPath = path.join(fixtureDir, 'clip.mp4')
    const fixtureWebmPath = path.join(fixtureDir, 'clip.webm')
    const fixtureAudioUri = toFileUri(fixtureAudioPath)
    const fixtureOggUri = toFileUri(fixtureOggPath)
    const fixtureWavUri = toFileUri(fixtureWavPath)
    const fixtureVideoUri = toFileUri(fixtureVideoPath)
    const fixtureWebmUri = toFileUri(fixtureWebmPath)

    await mkdir(fixtureDir, { recursive: true })
    await writeFile(fixtureAudioPath, Buffer.from(SPACE_EXPLORER_MP3_BASE64, 'base64'))
    await writeFile(fixtureOggPath, Buffer.from(SPACE_EXPLORER_OGG_BASE64, 'base64'))
    await writeFile(fixtureWavPath, createSineWaveWavBuffer())
    await writeFile(fixtureVideoPath, Buffer.from(SPACE_EXPLORER_MP4_BASE64, 'base64'))
    await writeFile(fixtureWebmPath, Buffer.from(SPACE_EXPLORER_WEBM_BASE64, 'base64'))

    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-explorer-media-anchor',
            title: 'Anchor note',
            position: { x: 380, y: 320 },
            width: 320,
            height: 220,
            kind: 'note',
            task: {
              text: 'Keep this space alive',
            },
          },
        ],
        {
          spaces: [
            {
              id: 'space-explorer-media',
              name: 'Explorer Space',
              directoryPath: fixtureDir,
              nodeIds: ['space-explorer-media-anchor'],
              rect: {
                x: 340,
                y: 280,
                width: 960,
                height: 520,
              },
            },
          ],
          activeSpaceId: 'space-explorer-media',
        },
      )

      await window.locator('[data-testid="workspace-space-switch-space-explorer-media"]').click()
      await window.locator('[data-testid="workspace-space-files-space-explorer-media"]').click()

      const explorer = window.locator('[data-testid="workspace-space-explorer"]')
      await expect(explorer).toBeVisible()

      const audioEntry = window.locator(
        `[data-testid="workspace-space-explorer-entry-space-explorer-media-${encodeURIComponent(fixtureAudioUri)}"]`,
      )
      await audioEntry.click()

      const previewWindow = window.locator('[data-testid="workspace-space-quick-preview"]')
      await expect(previewWindow).toBeVisible()
      await expect(previewWindow).toHaveAttribute('data-preview-kind', 'audio')

      const audioPreview = previewWindow.locator(
        '[data-testid="workspace-space-quick-preview-audio"]',
      )
      await expect(audioPreview).toBeVisible()
      await expect
        .poll(
          async () =>
            await audioPreview.evaluate(element => (element as HTMLAudioElement).readyState),
        )
        .toBeGreaterThan(0)
      await expect
        .poll(
          async () => await audioPreview.evaluate(element => (element as HTMLAudioElement).paused),
        )
        .toBe(true)

      const previewAudioPlay = await audioPreview.evaluate(async element => {
        const audio = element as HTMLAudioElement
        try {
          await audio.play()
          await new Promise(resolve => window.setTimeout(resolve, 160))
          const didAdvance = audio.currentTime > 0 || audio.ended || audio.paused === false
          audio.pause()
          return { didAdvance, error: null }
        } catch (error) {
          return {
            didAdvance: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })
      expect(previewAudioPlay.error).toBeNull()
      expect(previewAudioPlay.didAdvance).toBe(true)

      await audioEntry.dblclick()

      const audioNode = window.locator('.document-node').filter({ hasText: 'tone.mp3' }).first()
      await expect(audioNode).toBeVisible()
      const audioNodePlayer = audioNode.locator('[data-testid="document-node-audio"]')
      await expect(audioNodePlayer).toBeVisible()

      const nodeAudioPlay = await audioNodePlayer.evaluate(async element => {
        const audio = element as HTMLAudioElement
        try {
          await audio.play()
          await new Promise(resolve => window.setTimeout(resolve, 160))
          const didAdvance = audio.currentTime > 0 || audio.ended || audio.paused === false
          audio.pause()
          return { didAdvance, error: null }
        } catch (error) {
          return {
            didAdvance: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })
      expect(nodeAudioPlay.error).toBeNull()
      expect(nodeAudioPlay.didAdvance).toBe(true)

      const wavEntry = window.locator(
        `[data-testid="workspace-space-explorer-entry-space-explorer-media-${encodeURIComponent(fixtureWavUri)}"]`,
      )
      await wavEntry.click()
      await expect(previewWindow).toHaveAttribute('data-preview-kind', 'audio')

      const wavPreview = previewWindow.locator(
        '[data-testid="workspace-space-quick-preview-audio"]',
      )
      await expect(wavPreview).toBeVisible()
      await expect
        .poll(
          async () =>
            await wavPreview.evaluate(element => (element as HTMLAudioElement).readyState),
        )
        .toBeGreaterThan(0)

      const previewWavPlay = await wavPreview.evaluate(async element => {
        const audio = element as HTMLAudioElement
        try {
          await audio.play()
          await new Promise(resolve => window.setTimeout(resolve, 160))
          const didAdvance = audio.currentTime > 0 || audio.ended || audio.paused === false
          audio.pause()
          return { didAdvance, error: null }
        } catch (error) {
          return {
            didAdvance: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })
      expect(previewWavPlay.error).toBeNull()
      expect(previewWavPlay.didAdvance).toBe(true)

      await wavEntry.dblclick()

      const wavNode = window.locator('.document-node').filter({ hasText: 'tone.wav' }).first()
      await expect(wavNode).toBeVisible()
      const wavNodePlayer = wavNode.locator('[data-testid="document-node-audio"]')
      await expect(wavNodePlayer).toBeVisible()

      const nodeWavPlay = await wavNodePlayer.evaluate(async element => {
        const audio = element as HTMLAudioElement
        try {
          await audio.play()
          await new Promise(resolve => window.setTimeout(resolve, 160))
          const didAdvance = audio.currentTime > 0 || audio.ended || audio.paused === false
          audio.pause()
          return { didAdvance, error: null }
        } catch (error) {
          return {
            didAdvance: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })
      expect(nodeWavPlay.error).toBeNull()
      expect(nodeWavPlay.didAdvance).toBe(true)

      const oggEntry = window.locator(
        `[data-testid="workspace-space-explorer-entry-space-explorer-media-${encodeURIComponent(fixtureOggUri)}"]`,
      )
      await oggEntry.click()
      await expect(previewWindow).toHaveAttribute('data-preview-kind', 'audio')

      const oggPreview = previewWindow.locator(
        '[data-testid="workspace-space-quick-preview-audio"]',
      )
      await expect(oggPreview).toBeVisible()
      await expect
        .poll(
          async () =>
            await oggPreview.evaluate(element => (element as HTMLAudioElement).readyState),
        )
        .toBeGreaterThan(0)

      const previewOggPlay = await oggPreview.evaluate(async element => {
        const audio = element as HTMLAudioElement
        try {
          await audio.play()
          await new Promise(resolve => window.setTimeout(resolve, 160))
          const didAdvance = audio.currentTime > 0 || audio.ended || audio.paused === false
          audio.pause()
          return { didAdvance, error: null }
        } catch (error) {
          return {
            didAdvance: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })
      expect(previewOggPlay.error).toBeNull()
      expect(previewOggPlay.didAdvance).toBe(true)

      await oggEntry.dblclick()

      const oggNode = window.locator('.document-node').filter({ hasText: 'tone.ogg' }).first()
      await expect(oggNode).toBeVisible()
      const oggNodePlayer = oggNode.locator('[data-testid="document-node-audio"]')
      await expect(oggNodePlayer).toBeVisible()

      const nodeOggPlay = await oggNodePlayer.evaluate(async element => {
        const audio = element as HTMLAudioElement
        try {
          await audio.play()
          await new Promise(resolve => window.setTimeout(resolve, 160))
          const didAdvance = audio.currentTime > 0 || audio.ended || audio.paused === false
          audio.pause()
          return { didAdvance, error: null }
        } catch (error) {
          return {
            didAdvance: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })
      expect(nodeOggPlay.error).toBeNull()
      expect(nodeOggPlay.didAdvance).toBe(true)

      const videoEntry = window.locator(
        `[data-testid="workspace-space-explorer-entry-space-explorer-media-${encodeURIComponent(fixtureVideoUri)}"]`,
      )
      await videoEntry.click()
      await expect(previewWindow).toHaveAttribute('data-preview-kind', 'video')

      const videoPreview = previewWindow.locator(
        '[data-testid="workspace-space-quick-preview-video"]',
      )
      await expect(videoPreview).toBeVisible()
      await expect
        .poll(
          async () =>
            await videoPreview.evaluate(element => {
              const video = element as HTMLVideoElement
              return {
                readyState: video.readyState,
                width: video.videoWidth,
                height: video.videoHeight,
              }
            }),
        )
        .toEqual({
          readyState: expect.any(Number),
          width: 96,
          height: 54,
        })

      await videoEntry.dblclick()

      const videoNode = window.locator('.document-node').filter({ hasText: 'clip.mp4' }).first()
      await expect(videoNode).toBeVisible()

      const videoNodePlayer = videoNode.locator('[data-testid="document-node-video"]')
      await expect(videoNodePlayer).toBeVisible()
      await expect
        .poll(
          async () =>
            await videoNodePlayer.evaluate(element => {
              const video = element as HTMLVideoElement
              return {
                width: video.videoWidth,
                height: video.videoHeight,
              }
            }),
        )
        .toEqual({ width: 96, height: 54 })

      const videoNodeBox = await videoNode.boundingBox()
      if (!videoNodeBox) {
        throw new Error('Video document node bounding box unavailable')
      }

      expect(videoNodeBox.width).toBeGreaterThan(videoNodeBox.height)

      const nodeVideoPlay = await videoNodePlayer.evaluate(async element => {
        const video = element as HTMLVideoElement
        try {
          await video.play()
          await new Promise(resolve => window.setTimeout(resolve, 160))
          const didAdvance = video.currentTime > 0 || video.ended || video.paused === false
          video.pause()
          return { didAdvance, error: null }
        } catch (error) {
          return {
            didAdvance: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })
      expect(nodeVideoPlay.error).toBeNull()
      expect(nodeVideoPlay.didAdvance).toBe(true)

      const webmEntry = window.locator(
        `[data-testid="workspace-space-explorer-entry-space-explorer-media-${encodeURIComponent(fixtureWebmUri)}"]`,
      )
      await webmEntry.click()
      await expect(previewWindow).toHaveAttribute('data-preview-kind', 'video')

      const webmPreview = previewWindow.locator(
        '[data-testid="workspace-space-quick-preview-video"]',
      )
      await expect(webmPreview).toBeVisible()
      await expect
        .poll(
          async () =>
            await webmPreview.evaluate(element => {
              const video = element as HTMLVideoElement
              return {
                readyState: video.readyState,
                width: video.videoWidth,
                height: video.videoHeight,
              }
            }),
        )
        .toEqual({
          readyState: expect.any(Number),
          width: 96,
          height: 54,
        })

      await webmEntry.dblclick()

      const webmNode = window.locator('.document-node').filter({ hasText: 'clip.webm' }).first()
      await expect(webmNode).toBeVisible()

      const webmNodePlayer = webmNode.locator('[data-testid="document-node-video"]')
      await expect(webmNodePlayer).toBeVisible()
      await expect
        .poll(
          async () =>
            await webmNodePlayer.evaluate(element => {
              const video = element as HTMLVideoElement
              return {
                width: video.videoWidth,
                height: video.videoHeight,
              }
            }),
        )
        .toEqual({ width: 96, height: 54 })

      const webmNodeBox = await webmNode.boundingBox()
      if (!webmNodeBox) {
        throw new Error('WebM document node bounding box unavailable')
      }

      expect(webmNodeBox.width).toBeGreaterThan(webmNodeBox.height)

      const nodeWebmPlay = await webmNodePlayer.evaluate(async element => {
        const video = element as HTMLVideoElement
        try {
          await video.play()
          await new Promise(resolve => window.setTimeout(resolve, 160))
          const didAdvance = video.currentTime > 0 || video.ended || video.paused === false
          video.pause()
          return { didAdvance, error: null }
        } catch (error) {
          return {
            didAdvance: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })
      expect(nodeWebmPlay.error).toBeNull()
      expect(nodeWebmPlay.didAdvance).toBe(true)
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })
})
