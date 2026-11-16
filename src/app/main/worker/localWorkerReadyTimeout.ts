// How long main waits for a spawned Worker to print its ready payload before it kills the Worker.
// A Desktop-started Worker takes the Home Worker configuration lease before it is ready, so the
// lease's acquisition deadline plus the Worker's boot time must fit inside this value. A unit test
// pins that relation.
export const LOCAL_WORKER_READY_TIMEOUT_MS = 7_500
