import React from "react";
import { render, act, screen } from "@testing-library/react";
import { renderHook as _renderHook } from "@testing-library/react-hooks";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "@jest/globals";
import { SearchParamStateProvider, useSearchParamState } from "./index";
import type { UseBuildSearchParamStateOptions } from "./index";
import * as helpers from "./helpers";
import { z } from "zod";

function expectPushStateToHaveBeenCalledWith(href: string) {
  expect(window.history.pushState).toHaveBeenCalledWith({}, "", href);
}

describe("useSearchParamState", () => {
  let buildOptions: UseBuildSearchParamStateOptions;
  beforeEach(() => {
    jest.spyOn(window.history, "pushState");
    jest.spyOn(helpers, "isWindowUndefined").mockReturnValue(false);

    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "http://localhost:3000/" },
    });
    buildOptions = {};
  });

  function wrappedRenderHook<TProps, TResult>(
    cb: Parameters<typeof _renderHook<TProps, TResult>>[0],
  ) {
    const wrapper = ({ children }: { children?: React.ReactNode }) => (
      <SearchParamStateProvider options={buildOptions}>
        {children}
      </SearchParamStateProvider>
    );

    return _renderHook<TProps, TResult>(cb, { wrapper });
  }

  describe("default state", () => {
    describe("with window undefined", () => {
      beforeEach(() => {
        jest.spyOn(helpers, "isWindowUndefined").mockReturnValue(true);
      });

      it("with a serverSideURL, it should dehydrate the search param", () => {
        const { result } = wrappedRenderHook(() =>
          useSearchParamState("counter", 0, {
            serverSideURL: "http://localhost:3000/?counter=1",
          }),
        );
        expect(result.current[0]).toBe(1);
      });

      it("without a serverSideURL, it should return the initialState arg", () => {
        const { result } = wrappedRenderHook(() =>
          useSearchParamState("counter", 0),
        );
        expect(result.current[0]).toBe(0);
      });
    });

    it("with no search param in the url, it should return the initialState arg", () => {
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0),
      );
      expect(result.current[0]).toBe(0);
      expect(window.history.pushState).not.toHaveBeenCalled();
    });

    it.each([["sanitize"], ["parse"], ["validate"]])(
      "when %s errors, it should return the initialState arg",
      (fnName) => {
        const { result } = wrappedRenderHook(() =>
          useSearchParamState("counter", 0, {
            [fnName]: () => {
              throw new Error();
            },
          }),
        );
        expect(result.current[0]).toBe(0);
        expect(window.history.pushState).not.toHaveBeenCalled();
      },
    );

    it("with a search param in the url, it should dehydrate the search param", () => {
      Object.defineProperty(window, "location", {
        writable: true,
        value: { href: "http://localhost:3000/?counter=1" },
      });

      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0),
      );
      expect(result.current[0]).toBe(1);
    });
  });

  describe("setState", () => {
    function expectSetStateToWork(setStateArg: number | (() => number)) {
      describe("when setting the url succeeds", () => {
        it("should set the state", () => {
          const { result } = wrappedRenderHook(() =>
            useSearchParamState("counter", 0),
          );
          expect(result.current[0]).toBe(0);
          act(() => {
            result.current[1](setStateArg);
          });
          expect(result.current[0]).toBe(10);
          expectPushStateToHaveBeenCalledWith("?counter=10");
        });

        it("should not override unrelated search params", () => {
          Object.defineProperty(window, "location", {
            writable: true,
            value: { href: "http://localhost:3000/?asdf=1" },
          });
          const { result } = wrappedRenderHook(() =>
            useSearchParamState("counter", 0),
          );
          expect(result.current[0]).toBe(0);
          act(() => {
            result.current[1](setStateArg);
          });
          expect(result.current[0]).toBe(10);
          expectPushStateToHaveBeenCalledWith("?asdf=1&counter=10");
        });
      });

      describe("when setting the url fails", () => {
        it("should still set the state", () => {
          const { result } = wrappedRenderHook(() =>
            useSearchParamState("counter", 0, {
              pushState: () => {
                throw new Error();
              },
            }),
          );
          expect(result.current[0]).toBe(0);
          act(() => {
            result.current[1](setStateArg);
          });
          expect(result.current[0]).toBe(10);
        });

        it("when a local rollbackOnError option is true, it should not set the state", () => {
          const { result } = wrappedRenderHook(() =>
            useSearchParamState("counter", 0, {
              pushState: () => {
                throw new Error();
              },
              rollbackOnError: true,
            }),
          );
          expect(result.current[0]).toBe(0);
          act(() => {
            result.current[1](setStateArg);
          });
          expect(result.current[0]).toBe(0);
        });

        it("when a build rollbackOnError option is true, it should not set the state", () => {
          buildOptions = {
            rollbackOnError: true,
          };
          const { result } = wrappedRenderHook(() =>
            useSearchParamState("counter", 0, {
              pushState: () => {
                throw new Error();
              },
            }),
          );
          expect(result.current[0]).toBe(0);
          act(() => {
            result.current[1](setStateArg);
          });
          expect(result.current[0]).toBe(0);
        });
      });

      it("when deleteEmptySearchParam is true and the new state is empty, it should delete the search param", () => {
        const { result } = wrappedRenderHook(() =>
          useSearchParamState("counter", 0, {
            deleteEmptySearchParam: true,
            isEmptySearchParam: (val) => val === 10,
          }),
        );
        expect(result.current[0]).toBe(0);
        act(() => {
          result.current[1](setStateArg);
        });
        expect(window.history.pushState).toHaveBeenCalledTimes(0);
        expect(result.current[0]).toBe(10);
      });
    }

    expectSetStateToWork(10);
    expectSetStateToWork(() => 10);
  });

  describe("hook options", () => {
    beforeEach(() => {
      Object.defineProperty(window, "location", {
        writable: true,
        value: { href: "http://localhost:3000/?counter=1" },
      });
    });

    it("when a stringify option is passed, it should use it", () => {
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0, {
          stringify: () => "10",
        }),
      );
      act(() => {
        result.current[1](1);
      });
      expect(result.current[0]).toBe(1);
      expectPushStateToHaveBeenCalledWith("?counter=10");
    });

    it("when a sanitize option is passed, it should use it", () => {
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0, {
          sanitize: (unsanitized) => `${unsanitized}2`,
        }),
      );
      expect(result.current[0]).toBe(12);
    });

    it("when a parse option is passed, it should use it", () => {
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0, {
          parse: (unparsed) => (JSON.parse(unparsed) as number) + 1,
        }),
      );
      expect(result.current[0]).toBe(2);
    });

    it("when a validate option is passed, it should use it", () => {
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0, {
          validate: (unvalidated) => (unvalidated as number) + 1,
        }),
      );
      expect(result.current[0]).toBe(2);
    });

    it("when a pushState option is passed, it should use it", () => {
      const pushState = jest.fn();
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0, {
          pushState,
        }),
      );
      act(() => {
        result.current[1](1);
      });
      expect(result.current[0]).toBe(1);
      expect(pushState).toHaveBeenCalledWith("?counter=1");
    });

    it("when an onError option is passed, it should use it", () => {
      const onError = jest.fn();
      const schema = z.string();
      wrappedRenderHook(() =>
        useSearchParamState("counter", 0 as unknown as string, {
          onError,
          validate: schema.parse,
        }),
      );
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe("build options", () => {
    beforeEach(() => {
      Object.defineProperty(window, "location", {
        writable: true,
        value: { href: "http://localhost:3000/?counter=1" },
      });
    });

    it("when a stringify option is passed, it should use it", () => {
      buildOptions = {
        stringify: () => "10",
      };
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0),
      );
      act(() => {
        result.current[1](1);
      });
      expect(result.current[0]).toBe(1);
      expectPushStateToHaveBeenCalledWith("?counter=10");
    });

    it("when a sanitize option is passed, it should use it", () => {
      buildOptions = {
        sanitize: (unsanitized) => `${unsanitized}2`,
      };
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0),
      );
      expect(result.current[0]).toBe(12);
    });

    it("when a parse option is passed, it should use it", () => {
      buildOptions = {
        parse: (unparsed) => (JSON.parse(unparsed) as number) + 1,
      };
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0),
      );
      expect(result.current[0]).toBe(2);
    });

    it("when a pushState option is passed, it should use it", () => {
      const pushState = jest.fn();
      buildOptions = {
        pushState,
      };
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0),
      );
      act(() => {
        result.current[1](1);
      });
      expect(result.current[0]).toBe(1);
      expect(pushState).toHaveBeenCalledWith("?counter=1");
    });

    it("when an onError option is passed, it should use it", () => {
      const onError = jest.fn();
      buildOptions = {
        onError,
      };
      const schema = z.string();
      wrappedRenderHook(() =>
        useSearchParamState("counter", 0 as unknown as string, {
          validate: schema.parse,
        }),
      );
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe("build options with overriding hook options", () => {
    beforeEach(() => {
      Object.defineProperty(window, "location", {
        writable: true,
        value: { href: "http://localhost:3000/?counter=1" },
      });
    });

    it("when a stringify option is passed, it should use the hook option", () => {
      buildOptions = {
        stringify: () => "11",
      };
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0, {
          stringify: () => "10",
        }),
      );
      act(() => {
        result.current[1](1);
      });
      expect(result.current[0]).toBe(1);
      expectPushStateToHaveBeenCalledWith("?counter=10");
    });

    it("when a sanitize option is passed, it should use the hook option", () => {
      buildOptions = {
        sanitize: (unsanitized) => `${unsanitized}1`,
      };
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0, {
          sanitize: (unsanitized) => `${unsanitized}2`,
        }),
      );
      expect(result.current[0]).toBe(12);
    });

    it("when a parse option is passed, it should use the hook option", () => {
      buildOptions = {
        parse: (unparsed) => (JSON.parse(unparsed) as number) + 2,
      };
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0, {
          parse: (unparsed) => (JSON.parse(unparsed) as number) + 1,
        }),
      );
      expect(result.current[0]).toBe(2);
    });

    it("when a pushState option is passed, it should use the hook option", () => {
      const buildPushState = jest.fn();
      const hookPushState = jest.fn();
      buildOptions = {
        pushState: buildPushState,
      };
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0, {
          pushState: hookPushState,
        }),
      );
      act(() => {
        result.current[1](1);
      });
      expect(result.current[0]).toBe(1);
      expect(hookPushState).toHaveBeenCalledWith("?counter=1");
      expect(buildPushState).not.toHaveBeenCalled();
    });

    it("when an onError option is passed, it should use both options", () => {
      const hookOnError = jest.fn();
      const buildOnError = jest.fn();
      buildOptions = {
        onError: buildOnError,
      };
      const schema = z.string();
      wrappedRenderHook(() =>
        useSearchParamState("counter", 0 as unknown as string, {
          validate: schema.parse,
          onError: hookOnError,
        }),
      );
      expect(buildOnError).toHaveBeenCalledTimes(1);
      expect(hookOnError).toHaveBeenCalledTimes(1);
    });

    it("when an isEmptySearchParam is passed, it should use the hook option", () => {
      buildOptions = {
        deleteEmptySearchParam: true,
        isEmptySearchParam: (val) => val === 1,
      };
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0, {
          isEmptySearchParam: (val) => val === 0,
        }),
      );
      expect(result.current[0]).toBe(1);
      expect(window.history.pushState).not.toHaveBeenCalled();
    });

    it("when a deleteEmptySearchParam is passed, it should use the hook option", () => {
      buildOptions = {
        deleteEmptySearchParam: false,
        isEmptySearchParam: (val) => val === 0,
      };
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0, {
          deleteEmptySearchParam: true,
        }),
      );
      expect(result.current[0]).toBe(1);
      expect(window.history.pushState).not.toHaveBeenCalled();
    });
  });

  describe("events", () => {
    beforeEach(() => {
      Object.defineProperty(window, "location", {
        writable: true,
        value: { href: "http://localhost:3000/?counter=1" },
      });
    });

    it("should update the state on the popstate event", () => {
      const { result } = wrappedRenderHook(() =>
        useSearchParamState("counter", 0),
      );
      expect(result.current[0]).toBe(1);

      Object.defineProperty(window, "location", {
        writable: true,
        value: { href: "http://localhost:3000/?counter=2" },
      });
      act(() => {
        dispatchEvent(new Event("popstate"));
      });
      expect(result.current[0]).toBe(2);
    });
  });

  it("multiple hooks sharing a single param should both mutate the same param", async () => {
    function Parent() {
      return (
        <SearchParamStateProvider>
          <Child />
        </SearchParamStateProvider>
      );
    }
    function Child() {
      const [counter1, setCounter1] = useSearchParamState("counter", 0);
      const [counter2, setCounter2] = useSearchParamState("counter", 0);

      return (
        <div>
          <span>{counter1}</span>
          <span>{counter2}</span>
          <button
            onClick={() => {
              setCounter1((p) => p + 1);
            }}
          >
            increase counter1
          </button>
          <button
            onClick={() => {
              setCounter2((p) => p + 1);
            }}
          >
            increase counter2
          </button>
        </div>
      );
    }

    render(<Parent />);
    expect(screen.getAllByText("0")).toHaveLength(2);
    await userEvent.click(screen.getByText("increase counter1"));
    expect(screen.getAllByText("1")).toHaveLength(2);
    await userEvent.click(screen.getByText("increase counter2"));
    expect(screen.getAllByText("2")).toHaveLength(2);
  });
});
