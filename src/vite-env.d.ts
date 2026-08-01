/// <reference types="vite/client" />

declare module '*.fsm?raw' {
  const content: string;
  export default content;
}
