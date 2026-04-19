declare module "ink" {
  export const Box: any;
  export const Text: any;
  export const useInput: any;
  export const useStdout: any;
  export function render(tree: any, options?: any): {
    unmount(): void;
    clear?(): void;
    waitUntilExit?(): Promise<void>;
  };
}

declare module "react" {
  const React: any;
  export default React;
  export const Fragment: any;
  export const createElement: any;
  export const useEffect: any;
  export const useState: any;
}
