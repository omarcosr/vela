/** `import x from "./a.png" with { type: "file" }` gives a path (embedded in compiled builds). */
declare module "*.png" {
  const path: string;
  export default path;
}
