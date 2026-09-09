export function readProfileConfig(env = process.env) {
  function integer(key, fallback, min, max) {
    const raw = env[`OPENCOVE_PROFILE_${key}`]
    const value = raw === undefined ? fallback : Number(raw)
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`OPENCOVE_PROFILE_${key} must be an integer in [${min}, ${max}]`)
    }
    return value
  }
  const scenario = env.OPENCOVE_PROFILE_SCENARIO ?? 'pan'
  if (!['idle', 'pan', 'manual'].includes(scenario)) {
    throw new Error('OPENCOVE_PROFILE_SCENARIO must be idle, pan, or manual')
  }
  return {
    scenario,
    terminalCount: integer('TERMINAL_COUNT', 1, 0, 30),
    sampleDurationMs: integer('SAMPLE_DURATION_MS', 10_000, 1_000, 120_000),
    outputIntervalMs: integer('OUTPUT_INTERVAL_MS', 100, 10, 10_000),
    outputPayloadBytes: integer('OUTPUT_PAYLOAD_BYTES', 160, 1, 10_000),
    trace: env.OPENCOVE_PROFILE_TRACE !== '0',
  }
}

export function distribution(values) {
  if (values.length === 0) {
    return { count: 0, p50: null, p95: null, max: null }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = ratio => sorted[Math.ceil(sorted.length * ratio) - 1]
  return { count: values.length, p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) }
}

export function summarizeCapture(renderer, main) {
  const groups = new Map()
  for (const sample of main.samples) {
    for (const metric of sample.metrics) {
      const key = `${metric.pid}:${metric.type}`
      const group = groups.get(key) ?? { pid: metric.pid, type: metric.type, cpu: [] }
      group.cpu.push(metric.cpu.percentCPUUsage)
      groups.set(key, group)
    }
  }
  return {
    // Background/suspended frame gaps are retained separately, never classified as CPU stalls.
    visibleFocusedFramesMs: distribution(
      renderer.frames.filter(frame => frame.visible && frame.focused).map(frame => frame.deltaMs),
    ),
    otherFramesMs: distribution(
      renderer.frames.filter(frame => !frame.visible || !frame.focused).map(frame => frame.deltaMs),
    ),
    longTasksMs: distribution(renderer.longTasks.map(task => task.duration)),
    mainTimerDelayMs: distribution(main.samples.map(sample => sample.timerDelayMs)),
    processCpuPercent: [...groups.values()].map(({ cpu, ...identity }) => ({
      ...identity,
      ...distribution(cpu),
    })),
    focusTransitions: renderer.events.filter(event => ['focus', 'blur'].includes(event.name)),
    lostSamples: { renderer: renderer.dropped, main: main.dropped },
  }
}
