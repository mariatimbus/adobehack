import { createRequire } from "node:module";
import { dirname } from "node:path";
import { run } from "@adobe/ccweb-add-on-scripts";
import { IContainer, ITypes } from "@adobe/ccweb-add-on-scripts/dist/config/index.js";
import { backendProxy } from "./backend-proxy.mjs";

// Extend the installed Adobe CLI server without changing node_modules. Keep
// its certificates, file watching, manifest hosting and sandbox websocket.
const app = IContainer.get(ITypes.ExpressApp);
app.use("/api/v1", backendProxy);
const require = createRequire(import.meta.url);
const root = dirname(require.resolve("@adobe/ccweb-add-on-scripts/package.json"));
await run(["start", ...process.argv.slice(2)], { root });
