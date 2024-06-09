import React, { useEffect } from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim";
import {
  defaultParse,
  defaultStringify,
  defaultIsEmptySearchParam,
  isWindowUndefined,
} from "./helpers";

function useStableCallback<Cb extends (...args: any[]) => any>(cb: Cb): Cb {
  const cbRef = React.useRef(cb);
  React.useEffect(() => {
    cbRef.current = cb;
  }, [cb]);

  return React.useCallback(
    function (...args) {
      return cbRef.current.call(this, ...args);
    } as Cb,
    [],
  );
}

function useStableValue<Val>(val: Val) {
  return useStableCallback(() => val);
}

interface UseSearchParamStateOptions<TVal> {
  /**
   * @param `unsanitized` The raw string pulled from the URL search param.
   * @returns The sanitized string.
   */
  sanitize?: (unsanitized: string) => string;

  /**
   * @param `unparsed` The result of `sanitize` is passed as `unparsed`.
   * @returns A parsed value of the type `TVal` i.e. the type of `initialState`.
   */
  parse?: (unparsed: string) => TVal;

  /**
   * `validate` is expected to validate and return the `unvalidated` argument passed to it (presumably of type `TVal`), or throw an error. If an error is thrown, `onError` is called and `useSearchParamState` returns the initial state.
   *
   * @param `unvalidated` The result of `parse` is passed as `unvalidated`.
   * @returns The `unvalidated` argument, now validated as of type `TVal`.
   */
  validate?: (unvalidated: unknown) => TVal;

  /**
   * @param `valToStringify` The search param to stringify before setting it in the URL.
   * @returns The stringified search param.
   */
  stringify?: (valToStringify: TVal) => string;

  /**
   * A `boolean`.
   *
   * When calling the `setState` function returned by `useSearchParamState`, if `deleteEmptySearchParam` is set to `true` and `isEmptySearchParam` returns `true`, the search param will be deleted from the URL.
   */
  deleteEmptySearchParam?: boolean;

  /**
   * When calling the `setState` function returned by `useSearchParamState`, if `deleteEmptySearchParam` is `true` and `isEmptySearchParam` returns `true`, the search param will be deleted from the URL.
   *
   * @param `searchParamVal` When setting the state, the new state is passed as `searchParamVal`.
   * @returns A boolean.
   */
  isEmptySearchParam?: (searchParamVal: TVal) => boolean;

  /**
   * A value of type `string` - any valid string input to the `URL` constructor.
   *
   * When passed, `serverSideURL` will be used when `window` is `undefined` to access the URL search param. This is useful for generating content on the server, i.e. with Next.js.
   */
  serverSideURL?: string;

  /**
   * A `boolean`.
   *
   * When calling the `setState` function returned by `useSearchParamState`, `pushState` will be called to set the URL search param with the latest React state value. If setting the search param in the URL throws an error, and `rollbackOnError` is set to `true`, the local React state will "rollback" to its previous value.
   */
  rollbackOnError?: boolean;

  /**
   * @param `href` The `href` to set as the URL when calling the `setState` function returned by `useSearchParamState`.
   * @returns
   */
  pushState?: (stringifiedSearchParams: string) => void;

  /**
   * @param `e` The error caught in one of `useSearchParamState`'s `try` `catch` blocks.
   * @returns
   */
  onError?: (e: unknown) => void;
}

export type SearchParamStateProviderOptions = Omit<
  UseSearchParamStateOptions<unknown>,
  "validate" | "serverSideURL"
>;
// TODO: deprecate next major version
export type UseBuildSearchParamStateOptions = SearchParamStateProviderOptions;

type GlobalSearchParams = Record<
  string,
  { val: unknown; stringifiedVal: string; showSearchParam: boolean }
>;

const SearchParamStateContext = React.createContext<
  | {
      buildOptions: SearchParamStateProviderOptions;
      globalSearchParams: GlobalSearchParams;
      setGlobalSearchParams: React.Dispatch<
        React.SetStateAction<GlobalSearchParams>
      >;
    }
  | undefined
>(undefined);

function SearchParamStateProvider({
  children,
  options: buildOptions = {},
}: {
  children: React.ReactNode;
  options?: SearchParamStateProviderOptions;
}) {
  const [globalSearchParams, setGlobalSearchParams] =
    React.useState<GlobalSearchParams>({});

  return (
    <SearchParamStateContext.Provider
      value={{ buildOptions, globalSearchParams, setGlobalSearchParams }}
    >
      {children}
    </SearchParamStateContext.Provider>
  );
}

function useSearchParamState<TVal>(
  /**
   * The name of the URL search param to read from and write to.
   *
   * See MDN's documentation on [URLSearchParams](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams) for more info.
   */
  searchParam: string,

  /**
   * The initial state returned by `useSearchParamState` if no valid URL search param is present to read from.
   *
   * Note that if `sanitize`, `parse`, or `validate` throw an error, the initial state is set in the URL and returned by `useSearchParamState`.
   */
  initialState: TVal,

  /**
   * Options passed by a particular instance of `useSearchParamState`.
   *
   * When an option is passed to both `useSearchParamState` and `SearchParamStateProvider`, only the option passed to `useSearchParamState` is respected. The exception is an `onError` option passed to both, in which case both `onError`s are called.
   */
  hookOptions: UseSearchParamStateOptions<TVal> = {},
) {
  const maybeContext = React.useContext(SearchParamStateContext);
  if (maybeContext === undefined) {
    throw new Error(
      "useSearchParamState can only be called by a component that is a child of SearchParamStateProvider.",
    );
  }
  return useSearchParamStateInner<TVal>(searchParam, initialState, hookOptions);
}

const nativeEventNames = ["popstate"] as const;
const customEventNames = ["pushState", "replaceState"] as const;
const eventNames = [...nativeEventNames, ...customEventNames];

// TODO: move this somewhere where it'll be executed once
// from Wouter, originally from https://stackoverflow.com/a/4585031
if (typeof history !== "undefined") {
  for (const eventName of customEventNames) {
    const original = history[eventName];
    history[eventName] = function (...args) {
      dispatchEvent(new Event(eventName));
      return original.apply(this, args);
    };
  }
}

// from Wouter: https://github.com/molefrog/wouter/blob/e106a9dd27cde242b139e27fa8ac2fdb218fc523/packages/wouter/src/use-browser-location.js#L17
const subscribeToEventUpdates = (callback: (event: Event) => void) => {
  for (const eventName of eventNames) {
    window.addEventListener(eventName, callback);
  }
  return () => {
    for (const eventName of eventNames) {
      window.removeEventListener(eventName, callback);
    }
  };
};

function useSearchParamStateInner<TVal>(
  searchParam: string,
  initialState: TVal,
  hookOptions: UseSearchParamStateOptions<TVal>,
) {
  const { buildOptions, globalSearchParams, setGlobalSearchParams } =
    React.useContext(SearchParamStateContext)!;

  const stringifyOption =
    hookOptions.stringify ?? buildOptions.stringify ?? defaultStringify;
  const parseOption =
    hookOptions.parse ??
    (buildOptions.parse as UseSearchParamStateOptions<TVal>["parse"]) ??
    (defaultParse as Required<UseSearchParamStateOptions<TVal>>["parse"]);
  const rollbackOnError =
    hookOptions.rollbackOnError ?? buildOptions.rollbackOnError ?? false;
  const pushStateOption =
    hookOptions.pushState ??
    buildOptions.pushState ??
    ((stringifiedSearchParams: string) => {
      window.history.pushState({}, "", stringifiedSearchParams);
    });
  const sanitizeOption =
    hookOptions.sanitize ??
    buildOptions.sanitize ??
    ((unsanitized: string) => unsanitized);
  const deleteEmptySearchParam =
    hookOptions.deleteEmptySearchParam ??
    buildOptions.deleteEmptySearchParam ??
    false;
  const isEmptySearchParamOption =
    hookOptions.isEmptySearchParam ??
    buildOptions.isEmptySearchParam ??
    defaultIsEmptySearchParam;
  const validateOption =
    hookOptions.validate ?? ((unvalidated: unknown) => unvalidated as TVal);
  const buildOnErrorOption = buildOptions.onError ?? (() => {});
  const hookOnErrorOption = hookOptions.onError ?? (() => {});
  const { serverSideURL } = hookOptions;

  const stringify = useStableCallback(stringifyOption);
  const pushState = useStableCallback(pushStateOption);
  const isEmptySearchParam = useStableCallback(isEmptySearchParamOption);
  const buildOnError = useStableCallback(buildOnErrorOption);
  const hookOnError = useStableCallback(hookOnErrorOption);
  const getInitialState = useStableValue(initialState);

  const setState = React.useCallback(
    (newVal: TVal) => {
      setGlobalSearchParams((prev) => {
        return {
          ...prev,
          [searchParam]: {
            stringifiedVal: stringify(newVal),
            val: newVal,
            showSearchParam: !(
              deleteEmptySearchParam && isEmptySearchParam(newVal)
            ),
          },
        };
      });
    },
    [
      deleteEmptySearchParam,
      isEmptySearchParam,
      searchParam,
      setGlobalSearchParams,
      stringify,
    ],
  );

  const maybeGetHref = React.useCallback(() => {
    if (isWindowUndefined()) {
      if (typeof serverSideURL === "string") {
        return serverSideURL;
      }
      return null;
    }
    return window.location.href;
  }, [serverSideURL]);

  const safelySetUrlState = React.useCallback(
    (val: TVal) => {
      try {
        const href = maybeGetHref();
        if (href === null) {
          return { success: false };
        }
        const unrelatedSearchParams = Object.fromEntries(
          Array.from(new URL(href).searchParams.entries()).filter(
            ([searchParam]) => !Object.hasOwn(globalSearchParams, searchParam),
          ),
        );

        const stringifiedGlobalSearchParams: Record<string, string> =
          Object.keys(globalSearchParams).reduce((accum, currSearchParam) => {
            if (!globalSearchParams[currSearchParam]!.showSearchParam) {
              return accum;
            }

            return {
              ...accum,
              [currSearchParam]:
                globalSearchParams[currSearchParam]!.stringifiedVal,
            };
          }, unrelatedSearchParams);

        const searchParamsObj = new URLSearchParams(
          stringifiedGlobalSearchParams,
        );

        if (deleteEmptySearchParam && isEmptySearchParam(val)) {
          searchParamsObj.delete(searchParam);
          if (searchParamsObj.toString().length > 0) {
            // URLSearchParams.toString() does not include a `?`
            pushState(`?${searchParamsObj.toString()}`);
          }
          return { success: true };
        }

        const stringified = stringify(val);
        searchParamsObj.set(searchParam, stringified);
        if (searchParamsObj.toString().length > 0) {
          // URLSearchParams.toString() does not include a `?`
          pushState(`?${searchParamsObj.toString()}`);
        }
        return { success: true };
      } catch (e) {
        hookOnError(e);
        buildOnError(e);
        return { success: false };
      }
    },
    [
      buildOnError,
      deleteEmptySearchParam,
      globalSearchParams,
      hookOnError,
      isEmptySearchParam,
      maybeGetHref,
      pushState,
      searchParam,
      stringify,
    ],
  );

  const getProccessedSearchParamVal = React.useCallback(
    (rawSearchParamVal: string) => {
      try {
        const sanitized = sanitizeOption(rawSearchParamVal);
        const parsed = parseOption(sanitized);
        const validated = validateOption(parsed);

        return validated;
      } catch (e) {
        hookOnError(e);
        buildOnError(e);
        return getInitialState();
      }
    },
    [
      buildOnError,
      getInitialState,
      hookOnError,
      parseOption,
      sanitizeOption,
      validateOption,
    ],
  );

  const getRawSearchParamVal = () => {
    try {
      const href = maybeGetHref();
      if (href === null) {
        return null;
      }

      const url = new URL(href);
      const urlParams = url.searchParams;
      const rawSearchParamVal = urlParams.get(searchParam);
      if (rawSearchParamVal === null) {
        return null;
      }
      return rawSearchParamVal;
    } catch (e) {
      hookOnError(e);
      buildOnError(e);
      return null;
    }
  };

  const getSnapshot = () => getRawSearchParamVal();
  const rawSearchParamVal = useSyncExternalStore<string | null>(
    subscribeToEventUpdates,
    getSnapshot,
    getSnapshot,
  );
  const currSearchParamState = React.useMemo(
    () =>
      rawSearchParamVal === null
        ? getInitialState()
        : getProccessedSearchParamVal(rawSearchParamVal),
    [getInitialState, getProccessedSearchParamVal, rawSearchParamVal],
  );

  useEffect(() => {
    setState(currSearchParamState);
  }, [currSearchParamState, setState]);

  const wrappedSetState = React.useCallback(
    (newVal: TVal | ((currVal: TVal) => TVal)) => {
      if (newVal instanceof Function) {
        const { success } = safelySetUrlState(newVal(currSearchParamState));

        if (success || !rollbackOnError) {
          setState(newVal(currSearchParamState));
        }
        return;
      }

      const { success } = safelySetUrlState(newVal);
      if (success || !rollbackOnError) {
        setState(newVal);
      }
    },
    [currSearchParamState, rollbackOnError, safelySetUrlState, setState],
  );

  return [currSearchParamState, wrappedSetState] as const;
}

export { SearchParamStateProvider, useSearchParamState };
export type { UseSearchParamStateOptions };
