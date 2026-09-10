import { useEffect, useState } from 'react';

export interface AsyncState<TValue> {
  status: 'idle' | 'loading' | 'success' | 'error';
  value: TValue | null;
  error: string | null;
}

const IDLE: AsyncState<never> = { status: 'idle', value: null, error: null };

/**
 * Runs `load` whenever `deps` change, aborting the previous request.
 *
 * Passing `null` for `load` parks the hook in the idle state -- used when
 * nothing is selected yet, so the caller does not need a second code path.
 */
export function useAsync<TValue>(
  load: ((signal: AbortSignal) => Promise<TValue>) | null,
  deps: readonly unknown[],
): AsyncState<TValue> {
  const [state, setState] = useState<AsyncState<TValue>>(IDLE);

  useEffect(() => {
    if (load === null) {
      setState(IDLE);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading', value: null, error: null });

    load(controller.signal)
      .then((value) => {
        if (active) setState({ status: 'success', value, error: null });
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState({
          status: 'error',
          value: null,
          error: error instanceof Error ? error.message : 'Request failed',
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
    // `load` is rebuilt every render by design; `deps` is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
