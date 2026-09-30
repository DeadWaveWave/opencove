const clock = document.querySelector('#backend-result')
const refresh = document.querySelector('#invoke')
const countOutput = document.querySelector('#count')
const increment = document.querySelector('#increment')
const save = document.querySelector('#save')
const label = document.querySelector('#label')
const status = document.querySelector('#status')
const api = window.opencovePlugin
let context
let count = 0

function showError(error) {
  status.textContent = error instanceof Error ? error.message : String(error)
}

function showTheme(theme) {
  document.querySelector('#description').textContent =
    `Read the time from this plugin's Node backend. Current theme: ${theme}.`
}

async function initialize() {
  if (!api) {
    throw new Error('Open this plugin through OpenCove, not as a standalone HTML file.')
  }
  context = await api.ready
  document.querySelector('#mode').textContent = context.preview
    ? 'INTERACTIVE SAMPLE'
    : 'HELLO CLOCK'
  const saved = await api.storage.get('label.v1')
  const savedCount = await api.storage.get('count.v1')
  count = Number.isSafeInteger(savedCount) && savedCount >= 0 ? savedCount : 0
  countOutput.textContent = String(count)
  label.value = typeof saved === 'string' ? saved : ''
  if (label.value) {
    await api.setTitle(label.value)
  }
  showTheme(context.theme)
  const unsubscribe = api.onThemeChange(showTheme)
  const startedAt = Date.now()
  const timer = setInterval(() => {
    document.querySelector('#ticks').textContent = String(
      Math.floor((Date.now() - startedAt) / 1000),
    )
  }, 1000)
  window.addEventListener(
    'pagehide',
    () => {
      unsubscribe()
      clearInterval(timer)
    },
    { once: true },
  )
  refresh.disabled = false
  save.disabled = false
  increment.disabled = false
  status.textContent = context.preview
    ? 'Preview uses sample time and temporary storage.'
    : 'Ready. Saved labels are shared between this plugin’s windows.'
}

refresh.addEventListener('click', async () => {
  refresh.disabled = true
  try {
    const result = await api.invoke('clock.now')
    clock.textContent = new Date(result.iso).toLocaleTimeString()
    clock.dataset.platform = result.platform
    clock.dataset.startupId = result.startupId
    clock.dataset.iso = result.iso
    status.textContent = result.preview ? 'Sample time; real data is untouched.' : result.iso
  } catch (error) {
    showError(error)
  } finally {
    refresh.disabled = false
  }
})

increment.addEventListener('click', async () => {
  increment.disabled = true
  try {
    const next = count + 1
    await api.storage.set('count.v1', next)
    count = next
    countOutput.textContent = String(count)
    status.textContent = context.preview ? 'Count saved only in this preview.' : 'Count saved.'
  } catch (error) {
    showError(error)
  } finally {
    increment.disabled = false
  }
})

document.querySelector('#label-form').addEventListener('submit', async event => {
  event.preventDefault()
  save.disabled = true
  try {
    const value = label.value.trim()
    await api.storage.set('label.v1', value)
    await api.setTitle(value || 'Hello Clock')
    status.textContent = context.preview ? 'Saved only in this preview.' : 'Label saved.'
  } catch (error) {
    showError(error)
  } finally {
    save.disabled = false
  }
})

void initialize().catch(showError)
