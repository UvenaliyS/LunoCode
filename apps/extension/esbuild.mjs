import esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "dist/extension.js",
  // bufferutil/utf-8-validate are optional native accelerators `ws` requires
  // dynamically — leave them external; ws falls back to its JS implementations.
  external: ["vscode", "bufferutil", "utf-8-validate"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[luno] esbuild watching...");
} else {
  await esbuild.build(options);
  console.log("[luno] build complete");
}
