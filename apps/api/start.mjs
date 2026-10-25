// Plain-JavaScript entry point for hosts that start a Node app from a .js file
// (GoDaddy cPanel "Setup Node.js App", Passenger, pm2): loads the TypeScript API through tsx.
import { register } from "tsx/esm/api";

register();
await import("./src/index.ts");
