function normalizeDueDateValue(value) {
  return value ? value : null;
}

export function createSaveQueue({
  put,
  getCurrentUserId,
  expectedUserId,
  delayMs = 600,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onDone,
} = {}) {
  let timerId = null;
  let hasPending = false;
  let pendingValue = null;
  let inFlight = false;
  let generation = 0;

  function clearPendingTimer() {
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
  }

  async function flush() {
    if (inFlight || !hasPending) return;

    const valueToSend = normalizeDueDateValue(pendingValue);
    hasPending = false;
    pendingValue = null;

    const currentUserId =
      typeof getCurrentUserId === 'function' ? getCurrentUserId() : null;
    if (currentUserId !== expectedUserId) {
      clearPendingTimer();
      hasPending = false;
      pendingValue = null;
      if (typeof onDone === 'function') {
        onDone({ kind: 'user_changed' });
      }
      return;
    }

    inFlight = true;
    const gen = generation;
    let result;
    try {
      result = await put(valueToSend);
    } catch {
      result = { kind: 'offline' };
    }

    if (gen !== generation) {
      return;
    }

    inFlight = false;

    if (!result || result.kind !== 'ok') {
      clearPendingTimer();
      hasPending = false;
      pendingValue = null;
      if (typeof onDone === 'function') {
        onDone(result || { kind: 'unavailable' }, valueToSend);
      }
      return;
    }

    if (hasPending) {
      clearPendingTimer();
      flush();
      return;
    }

    if (typeof onDone === 'function') {
      onDone(result, valueToSend);
    }
  }

  function schedule(value) {
    pendingValue = value;
    hasPending = true;
    clearPendingTimer();
    timerId = setTimer(() => {
      timerId = null;
      if (inFlight) {
        return;
      }
      flush();
    }, delayMs);
  }

  function cancel() {
    generation += 1;
    clearPendingTimer();
    hasPending = false;
    pendingValue = null;
    inFlight = false;
  }

  return { schedule, cancel };
}
